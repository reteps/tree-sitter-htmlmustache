/**
 * Shared error collection logic used by both the LSP diagnostics
 * and the CLI linter.
 */

import type { BalanceNode } from './htmlBalanceChecker';
import { checkHtmlBalance, checkUnclosedTags } from './htmlBalanceChecker';
import {
  checkNestedSameNameSections,
  checkUnquotedMustacheAttributes,
  checkConsecutiveSameNameSections,
  checkSelfClosingNonVoidTags,
  checkDuplicateAttributes,
  checkUnescapedEntities,
  checkHtmlComments,
  checkUnrecognizedHtmlTags,
} from './mustacheChecks';
import type { TextReplacement } from './mustacheChecks';
import type { RulesConfig, RuleSeverity } from './configFile';
import { RULE_DEFAULTS, KNOWN_RULE_NAMES } from './ruleMetadata';

/** A tree that provides walk() and rootNode, compatible with both web-tree-sitter and CLI wasm. */
export interface WalkableTree {
  walk(): TreeCursor;
  rootNode: BalanceNode;
}

interface TreeCursor {
  currentNode: BalanceNode;
  nodeType: string;
  nodeIsMissing: boolean;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

/** Unified error result from all checkers. */
export interface CheckError {
  node: BalanceNode;
  message: string;
  severity?: 'error' | 'warning';
  fix?: TextReplacement[];
  fixDescription?: string;
}

const ERROR_NODE_TYPES = new Set([
  'ERROR',
  'mustache_erroneous_section_end',
  'mustache_erroneous_inverted_section_end',
]);

function errorMessageForNode(nodeType: string, node: BalanceNode): string {
  if (nodeType === 'mustache_erroneous_section_end' || nodeType === 'mustache_erroneous_inverted_section_end') {
    const tagNameNode = node.children.find(c => c.type === 'mustache_erroneous_tag_name');
    return `Mismatched mustache section: {{/${tagNameNode?.text || '?'}}}`;
  }
  if (nodeType === 'ERROR') {
    return 'Syntax error';
  }
  // isMissing node
  return `Missing ${nodeType}`;
}

function resolveRuleSeverity(rules: RulesConfig | undefined, ruleName: keyof RulesConfig): RuleSeverity {
  return rules?.[ruleName] ?? RULE_DEFAULTS[ruleName] ?? 'off';
}

function parseDisableDirective(node: BalanceNode): string | null {
  if (node.type !== 'html_comment' && node.type !== 'mustache_comment') return null;
  let inner: string | null = null;
  if (node.type === 'html_comment') {
    const match = node.text.match(/^<!--([\s\S]*)-->$/);
    if (match) inner = match[1].trim();
  } else {
    const match = node.text.match(/^\{\{!([\s\S]*)\}\}$/);
    if (match) inner = match[1].trim();
  }
  if (!inner) return null;
  const prefix = 'htmlmustache-disable ';
  if (!inner.startsWith(prefix)) return null;
  const ruleName = inner.slice(prefix.length).trim();
  return KNOWN_RULE_NAMES.has(ruleName) ? ruleName : null;
}

function collectDisabledRules(rootNode: BalanceNode): Set<string> {
  const disabled = new Set<string>();
  function walk(node: BalanceNode) {
    const rule = parseDisableDirective(node);
    if (rule) { disabled.add(rule); return; }
    for (const child of node.children) walk(child);
  }
  walk(rootNode);
  return disabled;
}

/**
 * Collect all errors from a parsed tree: syntax errors, balance errors,
 * unclosed tags, and mustache lint checks.
 */
export function collectErrors(tree: WalkableTree, rules?: RulesConfig, customTagNames?: string[]): CheckError[] {
  const errors: CheckError[] = [];
  const cursor = tree.walk() as unknown as TreeCursor;

  function visit() {
    const node = cursor.currentNode;
    const nodeType = cursor.nodeType;

    if (ERROR_NODE_TYPES.has(nodeType) || cursor.nodeIsMissing) {
      errors.push({
        node,
        message: errorMessageForNode(nodeType, node),
      });

      // Don't recurse into ERROR nodes — the children are not meaningful
      if (nodeType === 'ERROR') return;
    }

    if (cursor.gotoFirstChild()) {
      do { visit(); } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  }

  visit();

  // Run balance checker for HTML tag mismatch detection across mustache paths
  const balanceErrors = checkHtmlBalance(tree.rootNode);
  for (const error of balanceErrors) {
    errors.push({ node: error.node, message: error.message });
  }

  // Check for unclosed non-void HTML tags
  const unclosedErrors = checkUnclosedTags(tree.rootNode);
  for (const error of unclosedErrors) {
    errors.push({ node: error.node, message: error.message });
  }

  // Collect inline disable directives and merge into effective rules
  const disabledRules = collectDisabledRules(tree.rootNode);
  const effectiveRules = { ...rules };
  for (const rule of disabledRules) {
    (effectiveRules as Record<string, string>)[rule] = 'off';
  }

  // Configurable lint checks
  const sourceText = tree.rootNode.text;

  const ruleChecks: { rule: keyof RulesConfig; errors: () => import('./mustacheChecks').FixableError[] }[] = [
    { rule: 'nestedDuplicateSections', errors: () => checkNestedSameNameSections(tree.rootNode) },
    { rule: 'unquotedMustacheAttributes', errors: () => checkUnquotedMustacheAttributes(tree.rootNode) },
    { rule: 'consecutiveDuplicateSections', errors: () => checkConsecutiveSameNameSections(tree.rootNode, sourceText) },
    { rule: 'selfClosingNonVoidTags', errors: () => checkSelfClosingNonVoidTags(tree.rootNode) },
    { rule: 'duplicateAttributes', errors: () => checkDuplicateAttributes(tree.rootNode) },
    { rule: 'unescapedEntities', errors: () => checkUnescapedEntities(tree.rootNode) },
    { rule: 'preferMustacheComments', errors: () => checkHtmlComments(tree.rootNode) },
    { rule: 'unrecognizedHtmlTags', errors: () => checkUnrecognizedHtmlTags(tree.rootNode, customTagNames) },
  ];

  for (const { rule, errors: getErrors } of ruleChecks) {
    const severity = resolveRuleSeverity(effectiveRules, rule);
    if (severity === 'off') continue;

    for (const error of getErrors()) {
      errors.push({
        node: error.node,
        message: error.message,
        severity,
        fix: error.fix,
        fixDescription: error.fixDescription,
      });
    }
  }

  // Filter out preferMustacheComments warnings on disable-directive comments themselves
  return errors.filter(e =>
    !(e.message.includes('HTML comment found') && parseDisableDirective(e.node) !== null)
  );
}
