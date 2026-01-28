import { describe, it, expect } from 'vitest';
import { SymbolKind } from 'vscode-languageserver/node';
import { parseText, createMockDocument } from './setup';
import { getDocumentSymbols } from '../src/documentSymbols';

describe('Document Symbols', () => {
  function getSymbols(content: string) {
    const tree = parseText(content);
    const document = createMockDocument(content);
    return getDocumentSymbols(tree, document);
  }

  describe('HTML elements', () => {
    it('extracts symbol for simple HTML element', () => {
      const symbols = getSymbols('<div>content</div>');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('<div>');
      expect(symbols[0].kind).toBe(SymbolKind.Class);
    });

    it('extracts symbols for nested HTML elements', () => {
      const symbols = getSymbols('<div><span>text</span></div>');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('<div>');
      expect(symbols[0].children?.length).toBe(1);
      expect(symbols[0].children?.[0].name).toBe('<span>');
    });

    it('extracts symbols for void elements', () => {
      const symbols = getSymbols('<input type="text">');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('<input>');
    });

    it('extracts symbol for script element', () => {
      const symbols = getSymbols('<script>console.log("hi");</script>');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('<script>');
      expect(symbols[0].kind).toBe(SymbolKind.Module);
    });

    it('extracts symbol for style element', () => {
      const symbols = getSymbols('<style>.foo { color: red; }</style>');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('<style>');
      expect(symbols[0].kind).toBe(SymbolKind.Module);
    });
  });

  describe('Mustache sections', () => {
    it('extracts symbol for mustache section', () => {
      const symbols = getSymbols('{{#items}}content{{/items}}');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('{{#items}}');
      expect(symbols[0].kind).toBe(SymbolKind.Namespace);
    });

    it('extracts symbol for inverted section', () => {
      const symbols = getSymbols('{{^empty}}content{{/empty}}');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('{{^empty}}');
      expect(symbols[0].kind).toBe(SymbolKind.Namespace);
    });

    it('extracts nested mustache sections', () => {
      const symbols = getSymbols('{{#outer}}{{#inner}}nested{{/inner}}{{/outer}}');
      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('{{#outer}}');
      expect(symbols[0].children?.length).toBe(1);
      expect(symbols[0].children?.[0].name).toBe('{{#inner}}');
    });
  });

  describe('mixed content', () => {
    it('extracts symbols for HTML with mustache sections', () => {
      const content = `<ul>
  {{#items}}
  <li>{{name}}</li>
  {{/items}}
</ul>`;
      const symbols = getSymbols(content);

      expect(symbols.length).toBe(1);
      expect(symbols[0].name).toBe('<ul>');

      // ul should contain mustache section
      const ulChildren = symbols[0].children ?? [];
      const sectionSymbol = ulChildren.find((s) => s.name === '{{#items}}');
      expect(sectionSymbol).toBeDefined();

      // section should contain li
      const sectionChildren = sectionSymbol?.children ?? [];
      const liSymbol = sectionChildren.find((s) => s.name === '<li>');
      expect(liSymbol).toBeDefined();
    });

    it('extracts symbols for complex document', () => {
      const content = `<!DOCTYPE html>
<html>
<head>
  <title>{{title}}</title>
</head>
<body>
  <header>
    {{#user}}
    <nav>Menu</nav>
    {{/user}}
  </header>
  <main>
    {{#items}}
    <article>{{name}}</article>
    {{/items}}
  </main>
</body>
</html>`;
      const symbols = getSymbols(content);

      // Should have html element at top level
      const htmlSymbol = symbols.find((s) => s.name === '<html>');
      expect(htmlSymbol).toBeDefined();
    });
  });

  describe('symbol ranges', () => {
    it('includes correct range for symbols', () => {
      const content = '<div>content</div>';
      const symbols = getSymbols(content);

      expect(symbols[0].range.start.line).toBe(0);
      expect(symbols[0].range.start.character).toBe(0);
      expect(symbols[0].range.end.line).toBe(0);
      expect(symbols[0].range.end.character).toBe(content.length);
    });

    it('includes selection range for symbols', () => {
      const symbols = getSymbols('<div>content</div>');
      // Selection range should be the start tag
      expect(symbols[0].selectionRange).toBeDefined();
      expect(symbols[0].selectionRange.start.line).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty document', () => {
      const symbols = getSymbols('');
      expect(symbols).toEqual([]);
    });

    it('handles text only document', () => {
      const symbols = getSymbols('just text');
      expect(symbols).toEqual([]);
    });

    it('handles mustache interpolation (no symbol)', () => {
      const symbols = getSymbols('{{variable}}');
      // Interpolations don't create symbols (only sections do)
      expect(symbols).toEqual([]);
    });
  });
});
