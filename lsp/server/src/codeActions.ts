import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  TextEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { TextReplacement } from './mustacheChecks.js';

interface DiagnosticFixData {
  fix?: TextReplacement[];
  fixDescription?: string;
  ruleName?: string;
}

function hasFixData(data: unknown): data is DiagnosticFixData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (Array.isArray(d.fix) && typeof d.fixDescription === 'string') || typeof d.ruleName === 'string';
}

export function getCodeActions(params: CodeActionParams, document: TextDocument): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diagnostic of params.context.diagnostics) {
    if (!hasFixData(diagnostic.data)) continue;
    const { fix, fixDescription, ruleName } = diagnostic.data;

    if (fix && fixDescription) {
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

    if (ruleName) {
      actions.push({
        title: `Disable ${ruleName} for this file`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [params.textDocument.uri]: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: `{{! htmlmustache-disable ${ruleName} }}\n`,
              },
            ],
          },
        },
      });
    }
  }

  return actions;
}
