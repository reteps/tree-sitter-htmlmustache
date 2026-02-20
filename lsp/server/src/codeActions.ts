import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  TextEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { TextReplacement } from './mustacheChecks';

interface DiagnosticFixData {
  fix: TextReplacement[];
  fixDescription: string;
}

function hasFix(data: unknown): data is DiagnosticFixData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.fix) && typeof d.fixDescription === 'string';
}

export function getCodeActions(params: CodeActionParams, document: TextDocument): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diagnostic of params.context.diagnostics) {
    if (!hasFix(diagnostic.data)) continue;
    const { fix, fixDescription } = diagnostic.data;

    const edits: TextEdit[] = fix.map(r => ({
      range: {
        start: document.positionAt(r.startIndex),
        end: document.positionAt(r.endIndex),
      },
      newText: r.newText,
    }));

    actions.push({
      title: fixDescription,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [params.textDocument.uri]: edits,
        },
      },
    });
  }

  return actions;
}
