/**
 * Integration tests for the IR-based formatter.
 * These are migrated from the original formatting.test.ts to verify
 * the new implementation produces identical output.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FormattingOptions } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseText, createMockDocument } from '../setup';
import { formatDocument, formatDocumentRange } from '../../src/formatting';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

const defaultOptions: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

describe('Document Formatting (Integration)', () => {
  function format(content: string, options: FormattingOptions = defaultOptions): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, options);

    // Apply edits (there should be exactly one edit replacing the whole document)
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  describe('HTML elements', () => {
    it('formats single HTML element on one line', () => {
      const result = format('<div>content</div>');
      expect(result).toBe('<div>\n  content\n</div>\n');
    });

    it('formats nested HTML elements', () => {
      const result = format('<div><span>text</span></div>');
      expect(result).toBe('<div>\n  <span>text</span>\n</div>\n');
    });

    it('formats deeply nested elements', () => {
      const result = format('<div><p><strong>text</strong></p></div>');
      expect(result).toBe('<div>\n  <p>\n    <strong>text</strong>\n  </p>\n</div>\n');
    });

    it('preserves inline elements on single line', () => {
      const result = format('<p><span>inline</span></p>');
      expect(result).toBe('<p>\n  <span>inline</span>\n</p>\n');
    });

    it('formats inline elements with nested HTML as blocks', () => {
      const result = format('<span class="container"><span>inner</span><a href="#">link</a></span>');
      expect(result).toBe('<span class="container">\n  <span>inner</span>\n  <a href="#">link</a>\n</span>\n');
    });

    it('formats complex nested inline elements', () => {
      const result = format('<span class="feedback"><span class="badge">Invalid<i class="icon"></i></span><a href="#">More info</a></span>');
      expect(result).toBe('<span class="feedback">\n  <span class="badge">\n    Invalid<i class="icon"></i>\n  </span>\n  <a href="#">More info</a>\n</span>\n');
    });

    it('keeps inline elements in text flow on one line', () => {
      const result = format('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>');
      expect(result).toBe('<p>\n  Example <i>valid</i> inputs: <code>5</code><code>-17</code>\n</p>\n');
    });

    it('preserves single-line text content', () => {
      const result = format('<p>The answer must be a <i>double-precision</i> {{#complex}}or complex{{/complex}} number.</p>');
      expect(result).toBe('<p>\n  The answer must be a <i>double-precision</i> {{#complex}}or complex{{/complex}} number.\n</p>\n');
    });

    it('preserves multi-line text content', () => {
      const input = '<p>First line of text.\nSecond line of text.</p>';
      const result = format(input);
      expect(result).toBe('<p>\n  First line of text.\n  Second line of text.\n</p>\n');
    });

    it('formats element with attributes', () => {
      const result = format('<div class="container" id="main">content</div>');
      expect(result).toBe('<div class="container" id="main">\n  content\n</div>\n');
    });

    it('formats self-closing tags', () => {
      const result = format('<div><br /></div>');
      expect(result).toBe('<div>\n  <br />\n</div>\n');
    });

    it('formats void elements', () => {
      const result = format('<div><img src="test.jpg"></div>');
      expect(result).toBe('<div>\n  <img src="test.jpg">\n</div>\n');
    });

    it('formats multiple sibling elements', () => {
      const result = format('<div></div><p></p>');
      expect(result).toBe('<div>\n</div>\n<p>\n</p>\n');
    });
  });

  describe('Mustache sections', () => {
    it('formats mustache section as block', () => {
      const result = format('{{#items}}<li>item</li>{{/items}}');
      expect(result).toBe('{{#items}}\n  <li>\n    item\n  </li>\n{{/items}}\n');
    });

    it('formats inverted section as block', () => {
      const result = format('{{^items}}<p>No items</p>{{/items}}');
      expect(result).toBe('{{^items}}\n  <p>\n    No items\n  </p>\n{{/items}}\n');
    });

    it('formats nested HTML and mustache sections', () => {
      const result = format('<ul>{{#items}}<li>{{name}}</li>{{/items}}</ul>');
      expect(result).toBe('<ul>\n  {{#items}}\n    <li>\n      {{name}}\n    </li>\n  {{/items}}\n</ul>\n');
    });

    it('formats complex nesting', () => {
      const input = '<div>{{#show}}<p>visible</p>{{/show}}</div>';
      const result = format(input);
      expect(result).toBe('<div>\n  {{#show}}\n    <p>\n      visible\n    </p>\n  {{/show}}\n</div>\n');
    });

    it('does not indent content when HTML has implicit end tags', () => {
      const result = format('{{#inline}}<span class="test">{{/inline}}');
      expect(result).toBe('{{#inline}}\n<span class="test">\n{{/inline}}\n');
    });

    it('does not indent inverted section with implicit end tags', () => {
      const result = format('{{^inline}}<span>{{/inline}}');
      expect(result).toBe('{{^inline}}\n<span>\n{{/inline}}\n');
    });

    it('still indents nested block HTML inside mustache section with implicit end tags', () => {
      const result = format('{{#inline}}<div><p>text{{/inline}}');
      expect(result).toBe('{{#inline}}\n<div>\n  <p>\n    text\n{{/inline}}\n');
    });

    it('keeps text-only mustache sections inline', () => {
      const result = format('<p>figure{{#plural}}s{{/plural}}.</p>');
      expect(result).toBe('<p>\n  figure{{#plural}}s{{/plural}}.\n</p>\n');
    });

    it('keeps inline-element mustache sections inline', () => {
      const result = format('<p>Hello {{#name}}<strong>{{value}}</strong>{{/name}}!</p>');
      expect(result).toBe('<p>\n  Hello {{#name}}<strong>{{value}}</strong>{{/name}}!\n</p>\n');
    });

    it('formats standalone mustache sections with proper closing indentation', () => {
      const result = format('<p>{{#message}}{{{message}}}{{/message}} {{^message}}Default{{/message}}</p>');
      expect(result).toBe('<p>\n  {{#message}}\n    {{{message}}}\n  {{/message}}\n  {{^message}}\n    Default\n  {{/message}}\n</p>\n');
    });

    it('formats standalone mustache sections with inline HTML as blocks', () => {
      const result = format('<span class="input-group">{{#label}}<span>{{{label}}}</span>{{/label}}<input /></span>');
      expect(result).toBe('<span class="input-group">\n  {{#label}}\n    <span>{{{label}}}</span>\n  {{/label}}\n  <input />\n</span>\n');
    });
  });

  describe('Mustache interpolation', () => {
    it('preserves inline interpolation', () => {
      const result = format('<p>Hello, {{name}}!</p>');
      expect(result).toBe('<p>\n  Hello, {{name}}!\n</p>\n');
    });

    it('preserves triple mustache', () => {
      const result = format('<div>{{{html}}}</div>');
      expect(result).toBe('<div>\n  {{{html}}}\n</div>\n');
    });

    it('preserves mustache in attributes', () => {
      const result = format('<div value="{{variable}}">content</div>');
      expect(result).toBe('<div value="{{variable}}">\n  content\n</div>\n');
    });

    it('preserves unquoted mustache attributes', () => {
      const result = format('<div value={{variable}}>content</div>');
      expect(result).toBe('<div value={{variable}}>\n  content\n</div>\n');
    });
  });

  describe('Comments', () => {
    it('preserves HTML comments', () => {
      const result = format('<div><!-- comment --></div>');
      expect(result).toBe('<div>\n  <!-- comment -->\n</div>\n');
    });

    it('preserves mustache comments', () => {
      const result = format('<div>{{! comment }}</div>');
      expect(result).toBe('<div>\n  {{! comment }}\n</div>\n');
    });
  });

  describe('Partials', () => {
    it('preserves mustache partials', () => {
      const result = format('<div>{{> header}}</div>');
      expect(result).toBe('<div>\n  {{> header}}\n</div>\n');
    });
  });

  describe('Script and style elements', () => {
    it('preserves script content', () => {
      const input = '<script>const x = 1;</script>';
      const result = format(input);
      expect(result).toBe('<script>const x = 1;</script>\n');
    });

    it('preserves style content', () => {
      const input = '<style>.foo { color: red; }</style>';
      const result = format(input);
      expect(result).toBe('<style>.foo { color: red; }</style>\n');
    });

    it('preserves script with attributes', () => {
      const input = '<script type="module">import x from "y";</script>';
      const result = format(input);
      expect(result).toBe('<script type="module">import x from "y";</script>\n');
    });
  });

  describe('Doctype', () => {
    it('preserves doctype', () => {
      const result = format('<!DOCTYPE html><html></html>');
      expect(result).toBe('<!DOCTYPE html>\n<html>\n</html>\n');
    });
  });

  describe('Formatting options', () => {
    it('uses tab indentation when insertSpaces is false', () => {
      const result = format('<div><p>text</p></div>', { tabSize: 2, insertSpaces: false });
      expect(result).toBe('<div>\n\t<p>\n\t\ttext\n\t</p>\n</div>\n');
    });

    it('respects tabSize option', () => {
      const result = format('<div><p>text</p></div>', { tabSize: 4, insertSpaces: true });
      expect(result).toBe('<div>\n    <p>\n        text\n    </p>\n</div>\n');
    });
  });

  describe('Edge cases', () => {
    it('handles empty document', () => {
      const result = format('');
      expect(result).toBe('\n');
    });

    it('handles text only', () => {
      const result = format('just text');
      expect(result).toBe('just text\n');
    });

    it('handles whitespace normalization', () => {
      const result = format('<div>  multiple   spaces  </div>');
      expect(result).toBe('<div>\n  multiple spaces\n</div>\n');
    });

    it('handles entities', () => {
      const result = format('<div>&amp; &lt;</div>');
      expect(result).toBe('<div>\n  &amp; &lt;\n</div>\n');
    });
  });

  describe('Complex documents', () => {
    it('formats a complete HTML document', () => {
      const input = '<!DOCTYPE html><html><head><title>Test</title></head><body><div>{{#items}}<p>{{name}}</p>{{/items}}</div></body></html>';
      const result = format(input);

      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('<html>');
      expect(result).toContain('  <head>');
      expect(result).toContain('    <title>');
      expect(result).toContain('{{#items}}');
    });

    it('formats mixed content with mustache', () => {
      const input = '<ul>{{#users}}<li><a href="{{url}}">{{name}}</a></li>{{/users}}</ul>';
      const result = format(input);

      expect(result).toContain('<ul>');
      expect(result).toContain('{{#users}}');
      expect(result).toContain('<li>');
      expect(result).toContain('<a href="{{url}}">{{name}}</a>');
    });
  });
});

describe('Document Range Formatting (Integration)', () => {
  function formatRange(content: string, startLine: number, startChar: number, endLine: number, endChar: number): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const range = {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    };
    const edits = formatDocumentRange(tree, document, range, defaultOptions);

    if (edits.length === 0) return content;

    // Apply edits
    let result = content;
    for (const edit of edits.reverse()) {
      const start = document.offsetAt(edit.range.start);
      const end = document.offsetAt(edit.range.end);
      result = result.slice(0, start) + edit.newText + result.slice(end);
    }
    return result;
  }

  it('formats a range containing a complete element', () => {
    const content = '<body>\n<div>content</div>\n</body>';
    const result = formatRange(content, 1, 0, 1, 21);

    expect(result).toContain('<div>');
  });
});

describe('EditorConfig Integration', () => {
  let tempDir: string;

  beforeAll(() => {
    // Create temp directory with .editorconfig
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'editorconfig-test-'));

    // Create .editorconfig with 4-space indentation for mustache files
    const editorConfig = `root = true

[*.mustache]
indent_style = space
indent_size = 4

[*.html]
indent_style = tab
`;
    fs.writeFileSync(path.join(tempDir, '.editorconfig'), editorConfig);
  });

  afterAll(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function formatWithEditorConfig(content: string, filename: string): string {
    const tree = parseText(content);
    const filePath = path.join(tempDir, filename);
    const uri = pathToFileURL(filePath).toString();
    const document = TextDocument.create(uri, 'htmlmustache', 1, content);
    // Pass default options - editorconfig should override
    const edits = formatDocument(tree, document, { tabSize: 2, insertSpaces: true });
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  it('uses 4-space indentation from .editorconfig for .mustache files', () => {
    const result = formatWithEditorConfig('<div><p>text</p></div>', 'test.mustache');
    // Should use 4-space indent from .editorconfig
    expect(result).toBe('<div>\n    <p>\n        text\n    </p>\n</div>\n');
  });

  it('uses tab indentation from .editorconfig for .html files', () => {
    const result = formatWithEditorConfig('<div><p>text</p></div>', 'test.html');
    // Should use tab indent from .editorconfig
    expect(result).toBe('<div>\n\t<p>\n\t\ttext\n\t</p>\n</div>\n');
  });

  it('falls back to LSP options when no .editorconfig exists', () => {
    const tree = parseText('<div><p>text</p></div>');
    // Use a path that won't have .editorconfig
    const document = createMockDocument('<div><p>text</p></div>', 'file:///nonexistent/path/test.mustache');
    const edits = formatDocument(tree, document, { tabSize: 3, insertSpaces: true });
    expect(edits.length).toBe(1);
    // Should fall back to 3-space indent from LSP options
    expect(edits[0].newText).toBe('<div>\n   <p>\n      text\n   </p>\n</div>\n');
  });
});
