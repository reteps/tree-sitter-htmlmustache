import { describe, it, expect } from 'vitest';
import { parseText, createTestQuery } from './setup';
import { buildSemanticTokens, HIGHLIGHT_QUERY } from '../src/semanticTokens';

describe('Semantic Tokens', () => {
  function getTokens(text: string) {
    const tree = parseText(text);
    const query = createTestQuery(HIGHLIGHT_QUERY);
    return buildSemanticTokens(tree, query).build();
  }

  describe('HTML tokens', () => {
    it('generates tokens for HTML tag names', () => {
      const tokens = getTokens('<div>content</div>');
      // Should have tokens for opening and closing tag names
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for HTML attributes', () => {
      const tokens = getTokens('<div class="container">content</div>');
      // Should include tokens for attribute name and value
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for HTML comments', () => {
      const tokens = getTokens('<!-- comment -->');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for doctype', () => {
      const tokens = getTokens('<!DOCTYPE html>');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for brackets', () => {
      const tokens = getTokens('<div></div>');
      // Should include tokens for < > </ brackets
      expect(tokens.data.length).toBeGreaterThan(0);
    });
  });

  describe('Mustache tokens', () => {
    it('generates tokens for mustache variable', () => {
      const tokens = getTokens('{{name}}');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for mustache section', () => {
      const tokens = getTokens('{{#items}}content{{/items}}');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for inverted section', () => {
      const tokens = getTokens('{{^empty}}has content{{/empty}}');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for triple mustache', () => {
      const tokens = getTokens('{{{rawHtml}}}');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for mustache comment', () => {
      const tokens = getTokens('{{! comment }}');
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for mustache partial', () => {
      const tokens = getTokens('{{> header}}');
      expect(tokens.data.length).toBeGreaterThan(0);
    });
  });

  describe('mixed content', () => {
    it('generates tokens for HTML with embedded mustache', () => {
      const tokens = getTokens('<div class="{{className}}">{{content}}</div>');
      // Should have tokens for both HTML and mustache elements
      expect(tokens.data.length).toBeGreaterThan(0);
    });

    it('generates tokens for complex template', () => {
      const template = `
<html>
<head>
  <title>{{title}}</title>
</head>
<body>
  {{#items}}
  <div class="item">{{name}}</div>
  {{/items}}
</body>
</html>`;
      const tokens = getTokens(template);
      expect(tokens.data.length).toBeGreaterThan(0);
    });
  });

  describe('token data format', () => {
    it('produces valid delta-encoded token data', () => {
      const tokens = getTokens('<div>{{name}}</div>');
      // Token data is an array of 5-tuples: [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
      expect(tokens.data.length % 5).toBe(0);
    });

    it('handles multi-line content', () => {
      const tokens = getTokens('<div>\n  {{name}}\n</div>');
      // Should handle line breaks correctly
      expect(tokens.data.length).toBeGreaterThan(0);
      expect(tokens.data.length % 5).toBe(0);
    });
  });
});
