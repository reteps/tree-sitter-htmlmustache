import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { Tree } from './parser';

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
  return diagnostics;
}
