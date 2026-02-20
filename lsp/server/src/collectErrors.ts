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
  checkDuplicateAttributes,
} from './mustacheChecks';
import type { TextReplacement } from './mustacheChecks';

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

/**
 * Collect all errors from a parsed tree: syntax errors, balance errors,
 * unclosed tags, and mustache lint checks.
 */
export function collectErrors(tree: WalkableTree): CheckError[] {
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

  // Mustache-specific lint checks
  const sourceText = tree.rootNode.text;
  const mustacheChecks = [
    ...checkNestedSameNameSections(tree.rootNode),
    ...checkUnquotedMustacheAttributes(tree.rootNode),
    ...checkConsecutiveSameNameSections(tree.rootNode, sourceText),
    ...checkDuplicateAttributes(tree.rootNode),
  ];
  for (const error of mustacheChecks) {
    errors.push({
      node: error.node,
      message: error.message,
      severity: error.severity,
      fix: error.fix,
      fixDescription: error.fixDescription,
    });
  }

  return errors;
}
