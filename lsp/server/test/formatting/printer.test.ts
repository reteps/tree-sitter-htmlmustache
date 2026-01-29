import { describe, it, expect } from 'vitest';
import { print } from '../../src/formatting/printer';
import {
  text,
  concat,
  indent,
  group,
  fill,
  hardline,
  softline,
  line,
} from '../../src/formatting/ir';

const defaultOptions = { indentUnit: '  ' };
const tabOptions = { indentUnit: '\t' };

describe('Printer', () => {
  describe('basic printing', () => {
    it('prints plain text', () => {
      expect(print('hello', defaultOptions)).toBe('hello');
    });

    it('prints empty string', () => {
      expect(print('', defaultOptions)).toBe('');
    });

    it('prints concatenated text', () => {
      const doc = concat(['hello', ' ', 'world']);
      expect(print(doc, defaultOptions)).toBe('hello world');
    });
  });

  describe('hardline', () => {
    it('prints newline with no indent at level 0', () => {
      const doc = concat(['a', hardline, 'b']);
      expect(print(doc, defaultOptions)).toBe('a\nb');
    });

    it('prints newline with indent inside indent block', () => {
      const doc = concat(['a', indent(concat([hardline, 'b']))]);
      expect(print(doc, defaultOptions)).toBe('a\n  b');
    });

    it('uses tab indent when configured', () => {
      const doc = concat(['a', indent(concat([hardline, 'b']))]);
      expect(print(doc, tabOptions)).toBe('a\n\tb');
    });

    it('handles nested indents', () => {
      const doc = concat([
        'a',
        indent(concat([hardline, 'b', indent(concat([hardline, 'c']))])),
      ]);
      expect(print(doc, defaultOptions)).toBe('a\n  b\n    c');
    });

    it('handles multiple consecutive hardlines', () => {
      const doc = concat(['a', hardline, hardline, 'b']);
      expect(print(doc, defaultOptions)).toBe('a\n\nb');
    });
  });

  describe('softline', () => {
    it('prints newline in break mode (default)', () => {
      const doc = concat(['a', softline, 'b']);
      expect(print(doc, defaultOptions)).toBe('a\nb');
    });
  });

  describe('line', () => {
    it('prints newline in break mode (default)', () => {
      const doc = concat(['a', line, 'b']);
      expect(print(doc, defaultOptions)).toBe('a\nb');
    });
  });

  describe('group', () => {
    it('prints flat when content fits', () => {
      const doc = group(concat(['a', line, 'b']));
      expect(print(doc, { ...defaultOptions, printWidth: 80 })).toBe('a b');
    });

    it('breaks when content does not fit', () => {
      const doc = group(concat(['a', line, 'b']));
      expect(print(doc, { ...defaultOptions, printWidth: 2 })).toBe('a\nb');
    });

    it('always breaks when shouldBreak is true', () => {
      const doc = group(concat(['a', line, 'b']), true);
      expect(print(doc, { ...defaultOptions, printWidth: 80 })).toBe('a\nb');
    });

    it('handles nested groups', () => {
      const inner = group(concat(['inner1', line, 'inner2']));
      const outer = group(concat(['outer', line, inner]));
      expect(print(outer, { ...defaultOptions, printWidth: 80 })).toBe(
        'outer inner1 inner2'
      );
    });
  });

  describe('fill', () => {
    it('prints parts concatenated', () => {
      const doc = fill(['a', 'b', 'c']);
      expect(print(doc, defaultOptions)).toBe('abc');
    });
  });

  describe('complex documents', () => {
    it('formats HTML-like structure', () => {
      const doc = concat([
        '<div>',
        indent(concat([hardline, '<p>', indent(concat([hardline, 'text'])), hardline, '</p>'])),
        hardline,
        '</div>',
      ]);
      expect(print(doc, defaultOptions)).toBe('<div>\n  <p>\n    text\n  </p>\n</div>');
    });

    it('formats nested elements with proper indentation', () => {
      const doc = concat([
        '<ul>',
        indent(
          concat([
            hardline,
            '<li>',
            indent(concat([hardline, 'item 1'])),
            hardline,
            '</li>',
            hardline,
            '<li>',
            indent(concat([hardline, 'item 2'])),
            hardline,
            '</li>',
          ])
        ),
        hardline,
        '</ul>',
      ]);
      expect(print(doc, defaultOptions)).toBe(
        '<ul>\n  <li>\n    item 1\n  </li>\n  <li>\n    item 2\n  </li>\n</ul>'
      );
    });
  });

  describe('indent levels', () => {
    it('handles 4-space indent', () => {
      const doc = concat(['a', indent(concat([hardline, 'b']))]);
      expect(print(doc, { indentUnit: '    ' })).toBe('a\n    b');
    });

    it('handles deeply nested indents', () => {
      const doc = concat([
        'level0',
        indent(
          concat([
            hardline,
            'level1',
            indent(
              concat([
                hardline,
                'level2',
                indent(concat([hardline, 'level3'])),
              ])
            ),
          ])
        ),
      ]);
      expect(print(doc, defaultOptions)).toBe(
        'level0\n  level1\n    level2\n      level3'
      );
    });
  });
});
