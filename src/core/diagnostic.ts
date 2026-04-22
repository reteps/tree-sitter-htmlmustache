/**
 * Shared CheckError → public `Diagnostic` projection used by the browser
 * entry and the CLI wrapper. 1-based line/column per the public contract;
 * multi-edit fix array; severity defaults to `'error'` when the source
 * checker didn't set one (parse errors, balance errors).
 */

import type { CheckError } from './collectErrors.js';
import type { TextReplacement } from './mustacheChecks.js';

export interface DiagnosticFix {
  range: [number, number];
  newText: string;
}

export interface Diagnostic {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning';
  ruleName?: string;
  fix?: DiagnosticFix[];
  fixDescription?: string;
}

function toFix(r: TextReplacement): DiagnosticFix {
  return { range: [r.startIndex, r.endIndex], newText: r.newText };
}

export function toDiagnostic(err: CheckError): Diagnostic {
  const { node } = err;
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
    message: err.message,
    severity: err.severity ?? 'error',
    ruleName: err.ruleName,
    fix: err.fix && err.fix.length > 0 ? err.fix.map(toFix) : undefined,
    fixDescription: err.fixDescription,
  };
}
