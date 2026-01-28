import { describe, it, expect } from 'vitest';
import { parseText, getTestLanguage } from './setup';

describe('Parser', () => {
  describe('initialization', () => {
    it('loads the WASM parser successfully', () => {
      const language = getTestLanguage();
      expect(language).toBeDefined();
    });

    it('parses empty document', () => {
      const tree = parseText('');
      expect(tree).toBeDefined();
      expect(tree.rootNode.type).toBe('document');
    });
  });

  describe('HTML parsing', () => {
    it('parses basic HTML element', () => {
      const tree = parseText('<div>content</div>');
      expect(tree.rootNode.type).toBe('document');

      const element = tree.rootNode.child(0);
      expect(element?.type).toBe('html_element');
    });

    it('parses nested HTML elements', () => {
      const tree = parseText('<div><span>text</span></div>');
      const div = tree.rootNode.child(0);
      expect(div?.type).toBe('html_element');

      // Find span inside div
      let foundSpan = false;
      for (let i = 0; i < (div?.childCount ?? 0); i++) {
        const child = div?.child(i);
        if (child?.type === 'html_element') {
          foundSpan = true;
          break;
        }
      }
      expect(foundSpan).toBe(true);
    });

    it('parses void elements', () => {
      const tree = parseText('<br><input type="text">');
      expect(tree.rootNode.childCount).toBeGreaterThan(0);
    });

    it('parses HTML attributes', () => {
      const tree = parseText('<div class="container" id="main">content</div>');
      const element = tree.rootNode.child(0);
      expect(element?.type).toBe('html_element');

      // Check for attributes in start tag
      const text = tree.rootNode.text;
      expect(text).toContain('class="container"');
      expect(text).toContain('id="main"');
    });

    it('parses HTML comments', () => {
      const tree = parseText('<!-- comment -->');
      const comment = tree.rootNode.child(0);
      expect(comment?.type).toBe('html_comment');
    });

    it('parses doctype', () => {
      const tree = parseText('<!DOCTYPE html><html></html>');
      const doctype = tree.rootNode.child(0);
      expect(doctype?.type).toBe('html_doctype');
    });
  });

  describe('Mustache parsing', () => {
    it('parses mustache interpolation', () => {
      const tree = parseText('{{name}}');
      const interpolation = tree.rootNode.child(0);
      expect(interpolation?.type).toBe('mustache_interpolation');
    });

    it('parses triple mustache (unescaped)', () => {
      const tree = parseText('{{{rawHtml}}}');
      const triple = tree.rootNode.child(0);
      expect(triple?.type).toBe('mustache_triple');
    });

    it('parses mustache section', () => {
      const tree = parseText('{{#items}}content{{/items}}');
      const section = tree.rootNode.child(0);
      expect(section?.type).toBe('mustache_section');
    });

    it('parses inverted section', () => {
      const tree = parseText('{{^items}}no items{{/items}}');
      const section = tree.rootNode.child(0);
      expect(section?.type).toBe('mustache_inverted_section');
    });

    it('parses mustache comment', () => {
      const tree = parseText('{{! this is a comment }}');
      const comment = tree.rootNode.child(0);
      expect(comment?.type).toBe('mustache_comment');
    });

    it('parses mustache partial', () => {
      const tree = parseText('{{> header}}');
      const partial = tree.rootNode.child(0);
      expect(partial?.type).toBe('mustache_partial');
    });

    it('parses dotted path in interpolation', () => {
      const tree = parseText('{{user.name}}');
      const interpolation = tree.rootNode.child(0);
      expect(interpolation?.type).toBe('mustache_interpolation');
      expect(interpolation?.text).toBe('{{user.name}}');
    });
  });

  describe('mixed HTML and Mustache', () => {
    it('parses mustache inside HTML element', () => {
      const tree = parseText('<div>{{content}}</div>');
      const div = tree.rootNode.child(0);
      expect(div?.type).toBe('html_element');

      // Check that mustache is part of the content
      const text = div?.text;
      expect(text).toContain('{{content}}');
    });

    it('parses mustache in HTML attribute', () => {
      const tree = parseText('<div class="{{className}}">content</div>');
      expect(tree.rootNode.text).toContain('{{className}}');
    });

    it('parses HTML inside mustache section', () => {
      const tree = parseText('{{#show}}<div>visible</div>{{/show}}');
      const section = tree.rootNode.child(0);
      expect(section?.type).toBe('mustache_section');
    });

    it('parses complex nested structure', () => {
      const content = `
<ul>
  {{#items}}
  <li>{{name}}</li>
  {{/items}}
</ul>`;
      const tree = parseText(content);
      expect(tree.rootNode.type).toBe('document');

      // Should not have errors for valid nested structure
      expect(tree.rootNode.hasError).toBe(false);
    });
  });
});
