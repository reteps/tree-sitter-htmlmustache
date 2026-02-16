/**
 * Tests for embedded script/style formatting via pre-formatted content map.
 * Uses prettier to format JS/CSS, then passes results through the formatter pipeline.
 */

import { describe, it, expect } from 'vitest';
import { format as prettierFormat } from 'prettier';
import { FormattingOptions } from 'vscode-languageserver/node';
import { parseText, createMockDocument } from '../setup';
import { formatDocument } from '../../src/formatting';
import type { Node as SyntaxNode } from 'web-tree-sitter';

const defaultOptions: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

/**
 * Get the embedded language ID for a script/style element node.
 */
function getEmbeddedLanguageId(node: SyntaxNode): string {
  if (node.type === 'html_style_element') return 'css';
  return 'javascript';
}

/**
 * Walk the tree to find html_raw_text nodes inside script/style elements,
 * format each with prettier, and build the embeddedFormatted map.
 */
async function buildEmbeddedMap(rootNode: SyntaxNode): Promise<Map<number, string>> {
  const map = new Map<number, string>();

  const walk = async (node: SyntaxNode) => {
    if (node.type === 'html_script_element' || node.type === 'html_style_element') {
      const languageId = getEmbeddedLanguageId(node);
      const parser = languageId === 'css' ? 'css' : 'babel';

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'html_raw_text') {
          try {
            const formatted = await prettierFormat(child.text, {
              parser,
              tabWidth: 2,
              useTabs: false,
              printWidth: 80,
            });
            map.set(child.startIndex, formatted);
          } catch {
            // Prettier failed (e.g. mustache syntax) — skip, fallback to preserve
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) await walk(child);
    }
  };

  await walk(rootNode);
  return map;
}

/**
 * Format content with embedded script/style formatting via prettier.
 */
async function formatWithEmbedded(content: string): Promise<string> {
  const tree = parseText(content);
  const document = createMockDocument(content);
  const embeddedFormatted = await buildEmbeddedMap(tree.rootNode);
  const edits = formatDocument(tree, document, defaultOptions, undefined, 80, embeddedFormatted);
  expect(edits.length).toBe(1);
  return edits[0].newText;
}

/**
 * Format content without embedded formatting (fallback behavior).
 */
function formatWithoutEmbedded(content: string): string {
  const tree = parseText(content);
  const document = createMockDocument(content);
  const edits = formatDocument(tree, document, defaultOptions);
  expect(edits.length).toBe(1);
  return edits[0].newText;
}

describe('Embedded Script/Style Formatting', () => {
  describe('Script tags', () => {
    it('formats embedded JS with prettier', async () => {
      const result = await formatWithEmbedded(
        '<script>\nconst   x={a:1,   b:2}\n</script>'
      );
      expect(result).toBe('<script>\n  const x = { a: 1, b: 2 };\n</script>\n');
    });

    it('formats multi-line JS with proper indentation', async () => {
      const result = await formatWithEmbedded(
        '<script>\nfunction foo() {\nconst x = 1;\nreturn x;\n}\n</script>'
      );
      expect(result).toBe(
        '<script>\n  function foo() {\n    const x = 1;\n    return x;\n  }\n</script>\n'
      );
    });

    it('formats script nested inside div with correct indentation', async () => {
      const result = await formatWithEmbedded(
        '<div><script>\nconst   x=1\n</script></div>'
      );
      expect(result).toBe(
        '<div>\n  <script>\n    const x = 1;\n  </script>\n</div>\n'
      );
    });

    it('formats deeply nested script with cumulative indentation', async () => {
      const result = await formatWithEmbedded(
        '<div><div><script>\nconst   x=1\n</script></div></div>'
      );
      expect(result).toBe(
        '<div>\n  <div>\n    <script>\n      const x = 1;\n    </script>\n  </div>\n</div>\n'
      );
    });
  });

  describe('Style tags', () => {
    it('formats embedded CSS with prettier', async () => {
      const result = await formatWithEmbedded(
        '<style>\n.foo{color:red;display:block}\n</style>'
      );
      expect(result).toBe(
        '<style>\n  .foo {\n    color: red;\n    display: block;\n  }\n</style>\n'
      );
    });

    it('formats multi-rule CSS', async () => {
      const result = await formatWithEmbedded(
        '<style>\n.a{color:red}.b{color:blue}\n</style>'
      );
      expect(result).toBe(
        '<style>\n  .a {\n    color: red;\n  }\n  .b {\n    color: blue;\n  }\n</style>\n'
      );
    });
  });

  describe('Multiple embedded tags', () => {
    it('formats multiple script tags in one document', async () => {
      const result = await formatWithEmbedded(
        '<script>\nconst a=1\n</script>\n<script>\nconst b=2\n</script>'
      );
      expect(result).toBe(
        '<script>\n  const a = 1;\n</script>\n<script>\n  const b = 2;\n</script>\n'
      );
    });

    it('formats script and style tags in same document', async () => {
      const result = await formatWithEmbedded(
        '<style>\n.foo{color:red}\n</style>\n<script>\nconst x=1\n</script>'
      );
      expect(result).toBe(
        '<style>\n  .foo {\n    color: red;\n  }\n</style>\n<script>\n  const x = 1;\n</script>\n'
      );
    });
  });

  describe('Empty content', () => {
    it('handles empty script tag', async () => {
      const result = await formatWithEmbedded('<script></script>');
      expect(result).toBe('<script></script>\n');
    });

    it('handles script with only whitespace', async () => {
      const result = await formatWithEmbedded('<script>\n\n</script>');
      // Prettier formats whitespace-only content to "\n", which trims to empty
      expect(result).toBe('<script></script>\n');
    });
  });

  describe('Fallback behavior', () => {
    it('preserves content when no embeddedFormatted map entry exists', () => {
      const result = formatWithoutEmbedded(
        '<script>const x = 1;</script>'
      );
      expect(result).toBe('<script>const x = 1;</script>\n');
    });

    it('preserves html_raw_element content (custom raw tags)', async () => {
      // html_raw_element nodes are not included in embedded formatting
      const content = '<svg><path d="M 0 0" /></svg>';
      const result = await formatWithEmbedded(content);
      const fallback = formatWithoutEmbedded(content);
      // Should behave the same since svg is not script/style
      expect(result).toBe(fallback);
    });
  });
});
