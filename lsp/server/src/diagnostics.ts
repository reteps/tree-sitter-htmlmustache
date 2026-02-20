import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import type { Tree } from './parser';
import { collectErrors } from './collectErrors';

export function getDiagnostics(tree: Tree): Diagnostic[] {
  const errors = collectErrors(tree);
  return errors.map(error => ({
    severity: error.severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
    range: {
      start: { line: error.node.startPosition.row, character: error.node.startPosition.column },
      end: { line: error.node.endPosition.row, character: error.node.endPosition.column },
    },
    message: error.message,
    source: 'htmlmustache',
    data: error.fix ? { fix: error.fix, fixDescription: error.fixDescription } : undefined,
  }));
}
