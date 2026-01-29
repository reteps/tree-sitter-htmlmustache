import { describe, it, expect, beforeAll } from 'vitest';
import { parseText } from '../setup';
import {
  isBlockLevel,
  isInlineElement,
  shouldPreserveContent,
  hasBlockContent,
  isBlockLevelContent,
  getContentNodes,
  hasImplicitEndTags,
  isInTextFlow,
  shouldHtmlElementStayInline,
  shouldTreatAsBlock,
  INLINE_ELEMENTS,
  PRESERVE_CONTENT_ELEMENTS,
} from '../../src/formatting/classifier';

describe('Classifier', () => {
  describe('INLINE_ELEMENTS', () => {
    it('contains common inline elements', () => {
      expect(INLINE_ELEMENTS.has('span')).toBe(true);
      expect(INLINE_ELEMENTS.has('a')).toBe(true);
      expect(INLINE_ELEMENTS.has('strong')).toBe(true);
      expect(INLINE_ELEMENTS.has('em')).toBe(true);
      expect(INLINE_ELEMENTS.has('code')).toBe(true);
      expect(INLINE_ELEMENTS.has('i')).toBe(true);
      expect(INLINE_ELEMENTS.has('b')).toBe(true);
    });

    it('does not contain block elements', () => {
      expect(INLINE_ELEMENTS.has('div')).toBe(false);
      expect(INLINE_ELEMENTS.has('p')).toBe(false);
      expect(INLINE_ELEMENTS.has('ul')).toBe(false);
      expect(INLINE_ELEMENTS.has('li')).toBe(false);
      expect(INLINE_ELEMENTS.has('h1')).toBe(false);
    });
  });

  describe('PRESERVE_CONTENT_ELEMENTS', () => {
    it('contains pre, code, textarea, script, style', () => {
      expect(PRESERVE_CONTENT_ELEMENTS.has('pre')).toBe(true);
      expect(PRESERVE_CONTENT_ELEMENTS.has('code')).toBe(true);
      expect(PRESERVE_CONTENT_ELEMENTS.has('textarea')).toBe(true);
      expect(PRESERVE_CONTENT_ELEMENTS.has('script')).toBe(true);
      expect(PRESERVE_CONTENT_ELEMENTS.has('style')).toBe(true);
    });
  });

  describe('isBlockLevel()', () => {
    it('returns true for block HTML elements', () => {
      const tree = parseText('<div>content</div>');
      const divNode = tree.rootNode.child(0);
      expect(divNode?.type).toBe('html_element');
      expect(isBlockLevel(divNode!)).toBe(true);
    });

    it('returns false for inline HTML elements', () => {
      const tree = parseText('<span>content</span>');
      const spanNode = tree.rootNode.child(0);
      expect(spanNode?.type).toBe('html_element');
      expect(isBlockLevel(spanNode!)).toBe(false);
    });

    it('returns true for script elements', () => {
      const tree = parseText('<script>code</script>');
      const scriptNode = tree.rootNode.child(0);
      expect(scriptNode?.type).toBe('html_script_element');
      expect(isBlockLevel(scriptNode!)).toBe(true);
    });

    it('returns true for style elements', () => {
      const tree = parseText('<style>.class{}</style>');
      const styleNode = tree.rootNode.child(0);
      expect(styleNode?.type).toBe('html_style_element');
      expect(isBlockLevel(styleNode!)).toBe(true);
    });

    it('returns true for mustache section with block content', () => {
      const tree = parseText('{{#items}}<li>item</li>{{/items}}');
      const sectionNode = tree.rootNode.child(0);
      expect(sectionNode?.type).toBe('mustache_section');
      expect(isBlockLevel(sectionNode!)).toBe(true);
    });

    it('returns false for mustache section with text-only content', () => {
      const tree = parseText('{{#show}}text{{/show}}');
      const sectionNode = tree.rootNode.child(0);
      expect(sectionNode?.type).toBe('mustache_section');
      expect(isBlockLevel(sectionNode!)).toBe(false);
    });
  });

  describe('isInlineElement()', () => {
    it('returns true for inline elements', () => {
      const tree = parseText('<span>content</span>');
      const spanNode = tree.rootNode.child(0);
      expect(isInlineElement(spanNode!)).toBe(true);
    });

    it('returns false for block elements', () => {
      const tree = parseText('<div>content</div>');
      const divNode = tree.rootNode.child(0);
      expect(isInlineElement(divNode!)).toBe(false);
    });

    it('returns false for non-HTML elements', () => {
      const tree = parseText('{{#section}}content{{/section}}');
      const sectionNode = tree.rootNode.child(0);
      expect(isInlineElement(sectionNode!)).toBe(false);
    });
  });

  describe('shouldPreserveContent()', () => {
    it('returns true for script elements', () => {
      const tree = parseText('<script>code</script>');
      const scriptNode = tree.rootNode.child(0);
      expect(shouldPreserveContent(scriptNode!)).toBe(true);
    });

    it('returns true for style elements', () => {
      const tree = parseText('<style>.class{}</style>');
      const styleNode = tree.rootNode.child(0);
      expect(shouldPreserveContent(styleNode!)).toBe(true);
    });

    it('returns true for pre elements', () => {
      const tree = parseText('<pre>  preformatted  </pre>');
      const preNode = tree.rootNode.child(0);
      expect(shouldPreserveContent(preNode!)).toBe(true);
    });

    it('returns false for regular elements', () => {
      const tree = parseText('<div>content</div>');
      const divNode = tree.rootNode.child(0);
      expect(shouldPreserveContent(divNode!)).toBe(false);
    });
  });

  describe('getContentNodes()', () => {
    it('extracts content from mustache section', () => {
      const tree = parseText('{{#items}}<li>item</li>{{/items}}');
      const sectionNode = tree.rootNode.child(0)!;
      const content = getContentNodes(sectionNode);
      expect(content.length).toBe(1);
      expect(content[0].type).toBe('html_element');
    });

    it('extracts multiple content nodes', () => {
      const tree = parseText('{{#items}}<li>a</li><li>b</li>{{/items}}');
      const sectionNode = tree.rootNode.child(0)!;
      const content = getContentNodes(sectionNode);
      expect(content.length).toBe(2);
    });

    it('extracts content from inverted section', () => {
      const tree = parseText('{{^items}}<p>none</p>{{/items}}');
      const sectionNode = tree.rootNode.child(0)!;
      const content = getContentNodes(sectionNode);
      expect(content.length).toBe(1);
    });
  });

  describe('hasImplicitEndTags()', () => {
    it('returns true when HTML has no explicit end tag', () => {
      const tree = parseText('{{#inline}}<span>{{/inline}}');
      const sectionNode = tree.rootNode.child(0)!;
      const content = getContentNodes(sectionNode);
      expect(hasImplicitEndTags(content)).toBe(true);
    });

    it('returns false when HTML has explicit end tag', () => {
      const tree = parseText('{{#items}}<li>item</li>{{/items}}');
      const sectionNode = tree.rootNode.child(0)!;
      const content = getContentNodes(sectionNode);
      expect(hasImplicitEndTags(content)).toBe(false);
    });
  });

  describe('isInTextFlow()', () => {
    it('returns true when node is between text', () => {
      const tree = parseText('Hello <strong>World</strong>!');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      // children: [text "Hello ", html_element, text "!"]
      expect(children.length).toBe(3);
      expect(isInTextFlow(children[1], 1, children)).toBe(true);
    });

    it('returns false when node is standalone', () => {
      const tree = parseText('<div>content</div>');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      expect(children.length).toBe(1);
      expect(isInTextFlow(children[0], 0, children)).toBe(false);
    });
  });

  describe('shouldHtmlElementStayInline()', () => {
    it('returns true when element is in text flow', () => {
      const tree = parseText('Hello <strong>World</strong>!');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      expect(shouldHtmlElementStayInline(children[1], 1, children)).toBe(true);
    });

    it('returns false when element is standalone', () => {
      const tree = parseText('<div>content</div>');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      expect(shouldHtmlElementStayInline(children[0], 0, children)).toBe(false);
    });

    it('returns false for non-HTML elements', () => {
      const tree = parseText('Hello {{#section}}World{{/section}}!');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      const sectionIndex = children.findIndex(c => c.type === 'mustache_section');
      expect(shouldHtmlElementStayInline(children[sectionIndex], sectionIndex, children)).toBe(false);
    });
  });

  describe('shouldTreatAsBlock()', () => {
    it('returns true for standalone HTML elements', () => {
      const tree = parseText('<div>content</div>');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      expect(shouldTreatAsBlock(children[0], 0, children)).toBe(true);
    });

    it('returns false for HTML elements in text flow', () => {
      const tree = parseText('Hello <strong>World</strong>!');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      expect(shouldTreatAsBlock(children[1], 1, children)).toBe(false);
    });

    it('returns true for standalone mustache sections with block content', () => {
      const tree = parseText('{{#items}}<li>item</li>{{/items}}');
      const children = Array.from({ length: tree.rootNode.childCount }, (_, i) =>
        tree.rootNode.child(i)!
      );
      expect(shouldTreatAsBlock(children[0], 0, children)).toBe(true);
    });
  });
});
