import { describe, it, expect } from 'vitest';
import { parseText, createMockDocument } from '../setup.js';
import { print } from '../../src/formatting/printer.js';
import {
  formatDocument,
  formatNode,
  formatStartTag,
  formatEndTag,
  formatAttribute,
  FormatterContext,
} from '../../src/formatting/formatters.js';

const defaultPrinterOptions = { indentUnit: '  ', printWidth: 80 };

function formatToString(content: string): string {
  const tree = parseText(content);
  const document = createMockDocument(content);
  const context: FormatterContext = { document };
  const doc = formatDocument(tree.rootNode, context);
  return print(doc, defaultPrinterOptions);
}

describe('Formatters', () => {
  describe('formatDocument()', () => {
    it('formats document with trailing newline', () => {
      const result = formatToString('<div>content</div>');
      expect(result.endsWith('\n')).toBe(true);
    });

    it('handles empty document', () => {
      const result = formatToString('');
      expect(result).toBe('\n');
    });
  });

  describe('formatNode()', () => {
    it('formats text node', () => {
      const tree = parseText('hello world');
      const document = createMockDocument('hello world');
      const context: FormatterContext = { document };
      const textNode = tree.rootNode.child(0)!;
      const doc = formatNode(textNode, context);
      expect(print(doc, defaultPrinterOptions)).toBe('hello world');
    });

    it('formats interpolation as-is', () => {
      const tree = parseText('{{name}}');
      const document = createMockDocument('{{name}}');
      const context: FormatterContext = { document };
      const node = tree.rootNode.child(0)!;
      const doc = formatNode(node, context);
      expect(print(doc, defaultPrinterOptions)).toBe('{{name}}');
    });

    it('formats triple mustache as-is', () => {
      const tree = parseText('{{{html}}}');
      const document = createMockDocument('{{{html}}}');
      const context: FormatterContext = { document };
      const node = tree.rootNode.child(0)!;
      const doc = formatNode(node, context);
      expect(print(doc, defaultPrinterOptions)).toBe('{{{html}}}');
    });

    it('formats comment as-is', () => {
      const tree = parseText('<!-- comment -->');
      const document = createMockDocument('<!-- comment -->');
      const context: FormatterContext = { document };
      const node = tree.rootNode.child(0)!;
      const doc = formatNode(node, context);
      expect(print(doc, defaultPrinterOptions)).toBe('<!-- comment -->');
    });

    it('formats mustache comment as-is', () => {
      const tree = parseText('{{! comment }}');
      const document = createMockDocument('{{! comment }}');
      const context: FormatterContext = { document };
      const node = tree.rootNode.child(0)!;
      const doc = formatNode(node, context);
      expect(print(doc, defaultPrinterOptions)).toBe('{{! comment }}');
    });
  });

  describe('formatHtmlElement()', () => {
    it('keeps short block element flat', () => {
      const result = formatToString('<div>content</div>');
      expect(result).toBe('<div>content</div>\n');
    });

    it('formats inline element without extra newlines', () => {
      const result = formatToString('<span>text</span>');
      expect(result).toBe('<span>text</span>\n');
    });

    it('formats self-closing tag', () => {
      const result = formatToString('<br />');
      expect(result).toBe('<br />\n');
    });

    it('formats void element', () => {
      const result = formatToString('<img src="test.jpg">');
      expect(result).toBe('<img src="test.jpg">\n');
    });

    it('keeps short element with attributes flat', () => {
      const result = formatToString('<div class="container" id="main">content</div>');
      expect(result).toBe('<div class="container" id="main">content</div>\n');
    });

    it('breaks block children', () => {
      const result = formatToString('<div><p>text</p></div>');
      expect(result).toBe('<div>\n  <p>text</p>\n</div>\n');
    });

    it('formats empty block element', () => {
      const result = formatToString('<div></div>');
      expect(result).toBe('<div>\n</div>\n');
    });

    it('formats inline element with HTML children as block', () => {
      const result = formatToString('<span><a href="#">link</a></span>');
      expect(result).toBe('<span>\n  <a href="#">link</a>\n</span>\n');
    });
  });

  describe('formatMustacheSection()', () => {
    it('formats section with block content', () => {
      const result = formatToString('{{#items}}<li>item</li>{{/items}}');
      expect(result).toBe('{{#items}}\n  <li>item</li>\n{{/items}}\n');
    });

    it('formats inverted section', () => {
      const result = formatToString('{{^items}}<p>none</p>{{/items}}');
      expect(result).toBe('{{^items}}\n  <p>none</p>\n{{/items}}\n');
    });

    it('does not indent content with implicit end tags', () => {
      const result = formatToString('{{#inline}}<span>{{/inline}}');
      expect(result).toBe('{{#inline}}\n<span>\n{{/inline}}\n');
    });

    it('handles nested HTML inside section with implicit end tags', () => {
      const result = formatToString('{{#inline}}<div><p>text{{/inline}}');
      expect(result).toBe('{{#inline}}\n<div>\n  <p>text\n{{/inline}}\n');
    });
  });

  describe('formatStartTag()', () => {
    it('formats simple start tag', () => {
      const tree = parseText('<div>');
      createMockDocument('<div>');
      const divNode = tree.rootNode.child(0)!;
      const startTag = divNode.child(0)!;
      const doc = formatStartTag(startTag);
      expect(print(doc, defaultPrinterOptions)).toBe('<div>');
    });

    it('formats start tag with attributes', () => {
      const tree = parseText('<div class="test" id="main">');
      createMockDocument('<div class="test" id="main">');
      const divNode = tree.rootNode.child(0)!;
      const startTag = divNode.child(0)!;
      const doc = formatStartTag(startTag);
      expect(print(doc, defaultPrinterOptions)).toBe('<div class="test" id="main">');
    });

    it('formats self-closing tag', () => {
      const tree = parseText('<br />');
      createMockDocument('<br />');
      const brNode = tree.rootNode.child(0)!;
      const selfClosingTag = brNode.child(0)!;
      const doc = formatStartTag(selfClosingTag);
      expect(print(doc, defaultPrinterOptions)).toBe('<br />');
    });

    it('wraps long attributes onto multiple lines', () => {
      const longTag = '<div class="very-long-class-name-here" id="also-long-id-name" data-value="another-long-value">';
      const tree = parseText(longTag);
      createMockDocument(longTag);
      const divNode = tree.rootNode.child(0)!;
      const startTag = divNode.child(0)!;
      const doc = formatStartTag(startTag);
      const result = print(doc, defaultPrinterOptions);
      // Should break because it exceeds 80 chars
      expect(result).toContain('\n');
      expect(result).toContain('class="very-long-class-name-here"');
    });
  });

  describe('formatEndTag()', () => {
    it('formats end tag', () => {
      const tree = parseText('<div></div>');
      createMockDocument('<div></div>');
      const divNode = tree.rootNode.child(0)!;
      // Find end tag
      let endTag = null;
      for (let i = 0; i < divNode.childCount; i++) {
        if (divNode.child(i)?.type === 'html_end_tag') {
          endTag = divNode.child(i);
          break;
        }
      }
      expect(endTag).not.toBeNull();
      const doc = formatEndTag(endTag!);
      expect(print(doc, defaultPrinterOptions)).toBe('</div>');
    });
  });

  describe('formatBlockChildren()', () => {
    it('formats multiple block children with newlines', () => {
      const result = formatToString('<div></div><p></p>');
      expect(result).toBe('<div>\n</div>\n<p>\n</p>\n');
    });

    it('keeps text flow together', () => {
      const result = formatToString('<p>Hello <strong>World</strong>!</p>');
      expect(result).toBe('<p>Hello <strong>World</strong>!</p>\n');
    });

    it('keeps inline elements in text flow on one line', () => {
      const result = formatToString('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>');
      expect(result).toBe('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>\n');
    });
  });

  describe('formatAttribute()', () => {
    it('formats boolean attribute', () => {
      const tree = parseText('<input disabled>');
      createMockDocument('<input disabled>');
      const inputNode = tree.rootNode.child(0)!;
      const startTag = inputNode.child(0)!;
      // Find attribute
      let attr = null;
      for (let i = 0; i < startTag.childCount; i++) {
        if (startTag.child(i)?.type === 'html_attribute') {
          attr = startTag.child(i);
          break;
        }
      }
      expect(attr).not.toBeNull();
      const doc = formatAttribute(attr!);
      expect(print(doc, defaultPrinterOptions)).toBe('disabled');
    });

    it('formats attribute with value', () => {
      const tree = parseText('<div class="test">');
      createMockDocument('<div class="test">');
      const divNode = tree.rootNode.child(0)!;
      const startTag = divNode.child(0)!;
      let attr = null;
      for (let i = 0; i < startTag.childCount; i++) {
        if (startTag.child(i)?.type === 'html_attribute') {
          attr = startTag.child(i);
          break;
        }
      }
      expect(attr).not.toBeNull();
      const doc = formatAttribute(attr!);
      expect(print(doc, defaultPrinterOptions)).toBe('class="test"');
    });

    it('formats attribute with mustache value', () => {
      const tree = parseText('<div value={{variable}}>');
      createMockDocument('<div value={{variable}}>');
      const divNode = tree.rootNode.child(0)!;
      const startTag = divNode.child(0)!;
      let attr = null;
      for (let i = 0; i < startTag.childCount; i++) {
        if (startTag.child(i)?.type === 'html_attribute') {
          attr = startTag.child(i);
          break;
        }
      }
      expect(attr).not.toBeNull();
      const doc = formatAttribute(attr!);
      expect(print(doc, defaultPrinterOptions)).toBe('value={{variable}}');
    });
  });
});
