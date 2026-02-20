import { describe, it, expect } from 'vitest';
import { CodeActionKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseText, createMockDocument } from './setup';
import { getDiagnostics } from '../src/diagnostics';
import { getCodeActions } from '../src/codeActions';

function makeParams(document: TextDocument, diagnostics: ReturnType<typeof getDiagnostics>) {
  return {
    textDocument: { uri: document.uri },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    context: { diagnostics },
  };
}

describe('Code Actions', () => {
  describe('unquoted attribute quickfix', () => {
    it('produces TextEdit that wraps value in quotes', () => {
      const source = '<div class={{foo}}></div>';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      const unquoted = diagnostics.find(d => d.message.includes('Unquoted mustache'));
      expect(unquoted).toBeDefined();

      const actions = getCodeActions(makeParams(document, [unquoted!]), document);
      expect(actions.length).toBe(1);
      expect(actions[0].kind).toBe(CodeActionKind.QuickFix);
      expect(actions[0].title).toBe('Wrap mustache value in quotes');

      const edits = actions[0].edit!.changes![document.uri];
      expect(edits.length).toBe(1);
      expect(edits[0].newText).toBe('"{{foo}}"');
    });
  });

  describe('consecutive section merge quickfix', () => {
    it('produces TextEdit that removes closing/opening tags between sections', () => {
      const source = '{{#x}}a{{/x}}{{#x}}b{{/x}}';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      const consecutive = diagnostics.find(d => d.message.includes('Consecutive duplicate section'));
      expect(consecutive).toBeDefined();

      const actions = getCodeActions(makeParams(document, [consecutive!]), document);
      expect(actions.length).toBe(1);
      expect(actions[0].kind).toBe(CodeActionKind.QuickFix);
      expect(actions[0].title).toBe('Merge consecutive sections');

      const edits = actions[0].edit!.changes![document.uri];
      expect(edits.length).toBe(1);
      // The edit should remove {{/x}}{{#x}} (the gap between the two sections)
      expect(edits[0].newText).toBe('');
    });

    it('applying the edit produces merged content', () => {
      const source = '{{#x}}a{{/x}}{{#x}}b{{/x}}';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      const consecutive = diagnostics.find(d => d.message.includes('Consecutive duplicate section'));
      const actions = getCodeActions(makeParams(document, [consecutive!]), document);
      const edit = actions[0].edit!.changes![document.uri][0];

      // Manually apply the edit
      const startOffset = document.offsetAt(edit.range.start);
      const endOffset = document.offsetAt(edit.range.end);
      const result = source.slice(0, startOffset) + edit.newText + source.slice(endOffset);
      expect(result).toBe('{{#x}}ab{{/x}}');
    });
  });

  describe('no actions for unfixable diagnostics', () => {
    it('returns empty array for diagnostic without fix data', () => {
      const source = '{{#x}}{{#x}}inner{{/x}}{{/x}}';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      // Nested section diagnostic has no fix
      const nested = diagnostics.find(d => d.message.includes('Nested duplicate section'));
      expect(nested).toBeDefined();

      const actions = getCodeActions(makeParams(document, [nested!]), document);
      expect(actions.length).toBe(0);
    });
  });
});
