import { describe, it, expect } from 'vitest';
import { CodeActionKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseText, createMockDocument } from './setup.js';
import { getDiagnostics } from '../src/diagnostics.js';
import { getCodeActions } from '../src/codeActions.js';

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
      const fixAction = actions.find(a => a.title === 'Wrap mustache value in quotes');
      expect(fixAction).toBeDefined();
      expect(fixAction!.kind).toBe(CodeActionKind.QuickFix);

      const edits = fixAction!.edit!.changes![document.uri];
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
      const fixAction = actions.find(a => a.title === 'Merge consecutive sections');
      expect(fixAction).toBeDefined();
      expect(fixAction!.kind).toBe(CodeActionKind.QuickFix);

      const edits = fixAction!.edit!.changes![document.uri];
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
      const fixAction = actions.find(a => a.title === 'Merge consecutive sections')!;
      const edit = fixAction.edit!.changes![document.uri][0];

      // Manually apply the edit
      const startOffset = document.offsetAt(edit.range.start);
      const endOffset = document.offsetAt(edit.range.end);
      const result = source.slice(0, startOffset) + edit.newText + source.slice(endOffset);
      expect(result).toBe('{{#x}}ab{{/x}}');
    });
  });

  describe('no actions for unfixable diagnostics', () => {
    it('returns only disable action for diagnostic without fix data', () => {
      const source = '{{#x}}{{#x}}inner{{/x}}{{/x}}';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      // Nested section diagnostic has no fix
      const nested = diagnostics.find(d => d.message.includes('Nested duplicate section'));
      expect(nested).toBeDefined();

      const actions = getCodeActions(makeParams(document, [nested!]), document);
      expect(actions.length).toBe(1);
      expect(actions[0].title).toBe('Disable nestedDuplicateSections for this file');
    });
  });

  describe('disable rule for file', () => {
    it('produces a disable comment action for rule-based diagnostics', () => {
      const source = '<div class={{foo}}></div>';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      const unquoted = diagnostics.find(d => d.message.includes('Unquoted mustache'));
      expect(unquoted).toBeDefined();

      const actions = getCodeActions(makeParams(document, [unquoted!]), document);
      const disableAction = actions.find(a => a.title.startsWith('Disable '));
      expect(disableAction).toBeDefined();
      expect(disableAction!.title).toBe('Disable unquotedMustacheAttributes for this file');
      expect(disableAction!.kind).toBe(CodeActionKind.QuickFix);

      const edits = disableAction!.edit!.changes![document.uri];
      expect(edits.length).toBe(1);
      expect(edits[0].range.start).toEqual({ line: 0, character: 0 });
      expect(edits[0].range.end).toEqual({ line: 0, character: 0 });
      expect(edits[0].newText).toBe('{{! htmlmustache-disable unquotedMustacheAttributes }}\n');
    });

    it('does not produce disable action for syntax errors', () => {
      const source = '<div';
      const document = createMockDocument(source);
      const tree = parseText(source);
      const diagnostics = getDiagnostics(tree);

      // Filter to only syntax errors (no ruleName in data)
      const syntaxErrors = diagnostics.filter(d => !d.data || !(d.data as Record<string, unknown>).ruleName);
      expect(syntaxErrors.length).toBeGreaterThan(0);

      const actions = getCodeActions(makeParams(document, syntaxErrors), document);
      const disableActions = actions.filter(a => a.title.startsWith('Disable '));
      expect(disableActions.length).toBe(0);
    });
  });
});
