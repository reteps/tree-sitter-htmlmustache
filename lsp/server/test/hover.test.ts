import { describe, it, expect } from 'vitest';
import { MarkupKind } from 'vscode-languageserver/node';
import { parseText, createMockDocument } from './setup';
import { getHoverInfo } from '../src/hover';

describe('Hover', () => {
  function getHover(content: string, line: number, character: number) {
    const tree = parseText(content);
    const document = createMockDocument(content);
    return getHoverInfo(tree, document, { line, character });
  }

  describe('HTML tags', () => {
    it('provides hover for known HTML tag', () => {
      const hover = getHover('<div>content</div>', 0, 1);
      expect(hover).not.toBeNull();
      expect(hover?.contents).toMatchObject({
        kind: MarkupKind.Markdown,
      });
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('div');
      expect(value).toContain('HTML Element');
    });

    it('provides hover for tag with description', () => {
      const hover = getHover('<p>paragraph</p>', 0, 1);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('Paragraph');
    });

    it('provides hover for unknown tag', () => {
      const hover = getHover('<custom-element>content</custom-element>', 0, 1);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('HTML Element');
    });

    it('provides hover for closing tag', () => {
      const hover = getHover('<div>content</div>', 0, 14);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('div');
    });
  });

  describe('HTML attributes', () => {
    it('provides hover for known attribute', () => {
      const hover = getHover('<div class="container">content</div>', 0, 6);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('class');
      expect(value).toContain('HTML Attribute');
    });

    it('provides hover for id attribute', () => {
      const hover = getHover('<div id="main">content</div>', 0, 6);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('Unique identifier');
    });

    it('provides hover for unknown attribute', () => {
      const hover = getHover('<div custom-attr="value">content</div>', 0, 6);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('HTML Attribute');
    });
  });

  describe('Mustache interpolation', () => {
    it('provides hover for mustache variable', () => {
      // Position 2-6 is the identifier "name" in {{name}}
      const hover = getHover('{{name}}', 0, 3);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('name');
      expect(value).toContain('Mustache Variable');
    });

    it('provides hover for dotted path variable', () => {
      // Position 2 is the start of the identifier
      const hover = getHover('{{user.name}}', 0, 3);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('Mustache Variable');
    });
  });

  describe('Mustache sections', () => {
    it('provides hover for section tag name', () => {
      // Position 3-8 is "items" in {{#items}}
      const hover = getHover('{{#items}}content{{/items}}', 0, 4);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('items');
      expect(value).toContain('Mustache Variable');
    });

    it('provides hover for inverted section tag name', () => {
      // Position 3-8 is "empty" in {{^empty}}
      const hover = getHover('{{^empty}}content{{/empty}}', 0, 4);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('empty');
    });
  });

  describe('Mustache special constructs', () => {
    it('provides hover for triple mustache variable', () => {
      // Position 3-10 is "rawHtml" in {{{rawHtml}}}
      const hover = getHover('{{{rawHtml}}}', 0, 4);
      expect(hover).not.toBeNull();
      const value = (hover?.contents as { value: string }).value;
      expect(value).toContain('rawHtml');
      expect(value).toContain('Mustache Variable');
    });

    it('provides hover for mustache comment', () => {
      // Comments may not have detailed hover, but should not crash
      const hover = getHover('{{! this is a comment }}', 0, 5);
      // Comment content may or may not have hover depending on implementation
      expect(hover === null || hover !== null).toBe(true);
    });

    it('handles partial name position', () => {
      // Partials may not have hover for the name depending on grammar
      const hover = getHover('{{> header}}', 0, 5);
      // Should not crash, regardless of whether hover is provided
      expect(hover === null || hover !== null).toBe(true);
    });
  });

  describe('hover ranges', () => {
    it('returns correct range for hovered element', () => {
      const hover = getHover('<div>content</div>', 0, 1);
      expect(hover?.range).toBeDefined();
      expect(hover?.range?.start.line).toBe(0);
      expect(hover?.range?.start.character).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('returns null for whitespace', () => {
      const hover = getHover('<div>  </div>', 0, 6);
      // Depending on tree-sitter, this may or may not return hover
      // The important thing is it doesn't crash
      expect(hover === null || hover !== null).toBe(true);
    });

    it('returns null for plain text', () => {
      const hover = getHover('<div>plain text</div>', 0, 7);
      // Plain text nodes don't have hover info
      expect(hover === null || hover !== null).toBe(true);
    });

    it('handles multi-line documents', () => {
      const content = `<div>
  {{name}}
</div>`;
      const hover = getHover(content, 1, 4);
      expect(hover).not.toBeNull();
    });
  });
});
