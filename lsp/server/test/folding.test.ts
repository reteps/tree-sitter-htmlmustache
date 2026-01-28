import { describe, it, expect } from 'vitest';
import { FoldingRangeKind } from 'vscode-languageserver/node';
import { parseText } from './setup';
import { getFoldingRanges } from '../src/folding';

describe('Folding Ranges', () => {
  function getRanges(content: string) {
    const tree = parseText(content);
    return getFoldingRanges(tree);
  }

  describe('HTML elements', () => {
    it('returns folding range for multi-line element', () => {
      const content = `<div>
  content
</div>`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].startLine).toBe(0);
      expect(ranges[0].endLine).toBe(2);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Region);
    });

    it('returns no range for single-line element', () => {
      const ranges = getRanges('<div>content</div>');
      expect(ranges).toEqual([]);
    });

    it('returns nested folding ranges', () => {
      const content = `<div>
  <span>
    nested
  </span>
</div>`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(2);
      // Both div and span should have folding ranges
      const lines = ranges.map((r) => [r.startLine, r.endLine]);
      expect(lines).toContainEqual([0, 4]); // div
      expect(lines).toContainEqual([1, 3]); // span
    });

    it('returns folding range for script element', () => {
      const content = `<script>
  console.log("hello");
</script>`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Region);
    });

    it('returns folding range for style element', () => {
      const content = `<style>
  .foo { color: red; }
</style>`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Region);
    });
  });

  describe('Mustache sections', () => {
    it('returns folding range for multi-line section', () => {
      const content = `{{#items}}
  <li>{{name}}</li>
{{/items}}`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].startLine).toBe(0);
      expect(ranges[0].endLine).toBe(2);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Region);
    });

    it('returns folding range for inverted section', () => {
      const content = `{{^items}}
  <p>No items</p>
{{/items}}`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Region);
    });

    it('returns no range for single-line section', () => {
      const ranges = getRanges('{{#show}}visible{{/show}}');
      expect(ranges).toEqual([]);
    });
  });

  describe('comments', () => {
    it('returns folding range for multi-line HTML comment', () => {
      const content = `<!--
  This is a
  multi-line comment
-->`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Comment);
    });

    it('returns folding range for multi-line mustache comment', () => {
      const content = `{{!
  This is a
  multi-line comment
}}`;
      const ranges = getRanges(content);

      expect(ranges.length).toBe(1);
      expect(ranges[0].kind).toBe(FoldingRangeKind.Comment);
    });

    it('returns no range for single-line comment', () => {
      const ranges = getRanges('<!-- comment -->');
      expect(ranges).toEqual([]);
    });
  });

  describe('mixed content', () => {
    it('returns folding ranges for HTML and mustache', () => {
      const content = `<ul>
  {{#items}}
  <li>
    {{name}}
  </li>
  {{/items}}
</ul>`;
      const ranges = getRanges(content);

      // Should have ranges for: ul, mustache section, li
      expect(ranges.length).toBe(3);
    });

    it('returns folding ranges for complex document', () => {
      const content = `<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
</head>
<body>
  {{#items}}
  <div>
    {{name}}
  </div>
  {{/items}}
</body>
</html>`;
      const ranges = getRanges(content);

      // Should have multiple folding ranges
      expect(ranges.length).toBeGreaterThan(0);

      // All should be Region or Comment kind
      for (const range of ranges) {
        expect([FoldingRangeKind.Region, FoldingRangeKind.Comment]).toContain(range.kind);
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty document', () => {
      const ranges = getRanges('');
      expect(ranges).toEqual([]);
    });

    it('handles text only document', () => {
      const ranges = getRanges('just text');
      expect(ranges).toEqual([]);
    });

    it('handles mustache interpolation (no folding)', () => {
      const ranges = getRanges('{{variable}}');
      expect(ranges).toEqual([]);
    });
  });
});
