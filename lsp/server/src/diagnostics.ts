import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { Tree } from './parser';
import { checkHtmlBalance, checkUnclosedTags } from './htmlBalanceChecker';
import {
  checkNestedSameNameSections,
  checkUnquotedMustacheAttributes,
  checkConsecutiveSameNameSections,
  checkDuplicateAttributes,
} from './mustacheChecks';
import type { FixableError } from './mustacheChecks';

export function getDiagnostics(tree: Tree): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const cursor = tree.walk();

  function visit() {
    const node = cursor.currentNode;

    if (node.type === 'mustache_erroneous_section_end' ||
        node.type === 'mustache_erroneous_inverted_section_end') {
      const tagNameNode = node.children.find(c => c.type === 'mustache_erroneous_tag_name');

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: node.startPosition.row, character: node.startPosition.column },
          end: { line: node.endPosition.row, character: node.endPosition.column }
        },
        message: `Mismatched mustache section: {{/${tagNameNode?.text || '?'}}}`,
        source: 'htmlmustache'
      });
    }

    // Also report generic tree-sitter ERROR nodes
    if (node.type === 'ERROR') {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: node.startPosition.row, character: node.startPosition.column },
          end: { line: node.endPosition.row, character: node.endPosition.column }
        },
        message: 'Syntax error',
        source: 'htmlmustache'
      });
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
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: error.node.startPosition.row, character: error.node.startPosition.column },
        end: { line: error.node.endPosition.row, character: error.node.endPosition.column },
      },
      message: error.message,
      source: 'htmlmustache',
    });
  }

  // Check for unclosed non-void HTML tags
  const unclosedErrors = checkUnclosedTags(tree.rootNode);
  for (const error of unclosedErrors) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: error.node.startPosition.row, character: error.node.startPosition.column },
        end: { line: error.node.endPosition.row, character: error.node.endPosition.column },
      },
      message: error.message,
      source: 'htmlmustache',
    });
  }

  // Mustache-specific lint checks
  const sourceText = tree.rootNode.text;
  const mustacheChecks: FixableError[] = [
    ...checkNestedSameNameSections(tree.rootNode),
    ...checkUnquotedMustacheAttributes(tree.rootNode),
    ...checkConsecutiveSameNameSections(tree.rootNode, sourceText),
    ...checkDuplicateAttributes(tree.rootNode),
  ];
  for (const error of mustacheChecks) {
    diagnostics.push({
      severity: error.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
      range: {
        start: { line: error.node.startPosition.row, character: error.node.startPosition.column },
        end: { line: error.node.endPosition.row, character: error.node.endPosition.column },
      },
      message: error.message,
      source: 'htmlmustache',
      data: error.fix ? { fix: error.fix, fixDescription: error.fixDescription } : undefined,
    });
  }

  return diagnostics;
}
