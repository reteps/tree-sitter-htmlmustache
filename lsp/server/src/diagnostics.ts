import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import type { Tree } from './parser.js';
import { collectErrors } from '../../../src/core/collectErrors.js';
import type { RulesConfig, CustomRule } from '../../../src/core/configSchema.js';

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
    data: error.fix || error.ruleName
      ? { fix: error.fix, fixDescription: error.fixDescription, ruleName: error.ruleName }
      : undefined,
  }));
}
