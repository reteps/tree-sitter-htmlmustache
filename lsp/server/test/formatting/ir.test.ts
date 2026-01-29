import { describe, it, expect } from 'vitest';
import {
  text,
  concat,
  indent,
  group,
  fill,
  join,
  hardline,
  softline,
  line,
  breakParent,
  empty,
  isConcat,
  isIndent,
  isHardline,
  isGroup,
  isFill,
} from '../../src/formatting/ir';

describe('IR Builders', () => {
  describe('text()', () => {
    it('returns the string as-is', () => {
      expect(text('hello')).toBe('hello');
    });

    it('handles empty string', () => {
      expect(text('')).toBe('');
    });
  });

  describe('concat()', () => {
    it('concatenates multiple parts', () => {
      const doc = concat(['a', 'b', 'c']);
      expect(isConcat(doc)).toBe(true);
      if (isConcat(doc)) {
        expect(doc.parts).toEqual(['a', 'b', 'c']);
      }
    });

    it('filters out empty strings', () => {
      const doc = concat(['a', '', 'b', '', 'c']);
      expect(isConcat(doc)).toBe(true);
      if (isConcat(doc)) {
        expect(doc.parts).toEqual(['a', 'b', 'c']);
      }
    });

    it('returns empty string for empty array', () => {
      expect(concat([])).toBe('');
    });

    it('returns single element for single-element array', () => {
      expect(concat(['only'])).toBe('only');
    });

    it('flattens nested concats', () => {
      const inner = concat(['a', 'b']);
      const outer = concat([inner, 'c']);
      expect(isConcat(outer)).toBe(true);
      if (isConcat(outer)) {
        expect(outer.parts).toEqual(['a', 'b', 'c']);
      }
    });
  });

  describe('indent()', () => {
    it('wraps content in indent', () => {
      const doc = indent('content');
      expect(isIndent(doc)).toBe(true);
      if (isIndent(doc)) {
        expect(doc.contents).toBe('content');
      }
    });

    it('returns empty for empty content', () => {
      expect(indent('')).toBe('');
    });

    it('handles complex content', () => {
      const content = concat(['a', hardline, 'b']);
      const doc = indent(content);
      expect(isIndent(doc)).toBe(true);
      if (isIndent(doc)) {
        expect(doc.contents).toBe(content);
      }
    });
  });

  describe('group()', () => {
    it('wraps content in group', () => {
      const doc = group('content');
      expect(isGroup(doc)).toBe(true);
      if (isGroup(doc)) {
        expect(doc.contents).toBe('content');
        expect(doc.break).toBeUndefined();
      }
    });

    it('sets break flag when shouldBreak is true', () => {
      const doc = group('content', true);
      expect(isGroup(doc)).toBe(true);
      if (isGroup(doc)) {
        expect(doc.break).toBe(true);
      }
    });

    it('returns empty for empty content', () => {
      expect(group('')).toBe('');
    });
  });

  describe('fill()', () => {
    it('creates fill with parts', () => {
      const doc = fill(['a', 'b', 'c']);
      expect(isFill(doc)).toBe(true);
      if (isFill(doc)) {
        expect(doc.parts).toEqual(['a', 'b', 'c']);
      }
    });

    it('filters out empty strings', () => {
      const doc = fill(['a', '', 'b']);
      expect(isFill(doc)).toBe(true);
      if (isFill(doc)) {
        expect(doc.parts).toEqual(['a', 'b']);
      }
    });

    it('returns empty for empty array', () => {
      expect(fill([])).toBe('');
    });

    it('returns single element for single-element array', () => {
      expect(fill(['only'])).toBe('only');
    });
  });

  describe('join()', () => {
    it('joins docs with separator', () => {
      const doc = join(' ', ['a', 'b', 'c']);
      expect(isConcat(doc)).toBe(true);
      if (isConcat(doc)) {
        expect(doc.parts).toEqual(['a', ' ', 'b', ' ', 'c']);
      }
    });

    it('handles empty docs', () => {
      const doc = join(' ', ['a', '', 'b']);
      expect(isConcat(doc)).toBe(true);
      if (isConcat(doc)) {
        expect(doc.parts).toEqual(['a', ' ', 'b']);
      }
    });

    it('returns empty for empty array', () => {
      expect(join(' ', [])).toBe('');
    });

    it('returns single element without separator', () => {
      expect(join(' ', ['only'])).toBe('only');
    });

    it('works with hardline separator', () => {
      const doc = join(hardline, ['a', 'b']);
      expect(isConcat(doc)).toBe(true);
      if (isConcat(doc)) {
        expect(doc.parts).toHaveLength(3);
        expect(doc.parts[1]).toBe(hardline);
      }
    });
  });

  describe('constants', () => {
    it('hardline has correct type', () => {
      expect(isHardline(hardline)).toBe(true);
      expect(hardline.type).toBe('hardline');
    });

    it('softline has correct type', () => {
      expect(softline.type).toBe('softline');
    });

    it('line has correct type', () => {
      expect(line.type).toBe('line');
    });

    it('breakParent has correct type', () => {
      expect(breakParent.type).toBe('breakParent');
    });

    it('empty is empty string', () => {
      expect(empty).toBe('');
    });
  });
});
