import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import type { Tree } from './parser';
import { collectErrors } from './collectErrors';
import type { RulesConfig, CustomRule } from './configFile';

export function getDiagnostics(tree: Tree, rules?: RulesConfig, customTagNames?: string[], customRules?: CustomRule[]): Diagnostic[] {
  const errors = collectErrors(tree, rules, customTagNames, customRules);
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
