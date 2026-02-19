/**
 * Integration tests for the IR-based formatter.
 * These verify the full pipeline: AST → Doc IR → String.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FormattingOptions } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseText, createMockDocument } from '../setup';
import { formatDocument, formatDocumentRange } from '../../src/formatting';
import { setCustomCodeTags } from '../../src/formatting/classifier';
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

  function formatWithPrintWidth(content: string, printWidth: number): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, defaultOptions, undefined, printWidth);
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  describe('HTML elements', () => {
    it('keeps short block element on one line', () => {
      const result = format('<div>content</div>');
      expect(result).toBe('<div>content</div>\n');
    });

    it('keeps short nested inline element flat', () => {
      const result = format('<div><span>text</span></div>');
      expect(result).toBe('<div><span>text</span></div>\n');
    });

    it('breaks block children onto separate lines', () => {
      const result = format('<div><p><strong>text</strong></p></div>');
      expect(result).toBe('<div>\n  <p><strong>text</strong></p>\n</div>\n');
    });

    it('keeps short inline element with inline children flat', () => {
      const result = format('<p><span>inline</span></p>');
      expect(result).toBe('<p><span>inline</span></p>\n');
    });

    it('formats inline elements with nested HTML as blocks', () => {
      const result = format('<span class="container"><span>inner</span><a href="#">link</a></span>');
      expect(result).toBe('<span class="container">\n  <span>inner</span>\n  <a href="#">link</a>\n</span>\n');
    });

    it('formats complex nested inline elements', () => {
      const result = format('<span class="feedback"><span class="badge">Invalid<i class="icon"></i></span><a href="#">More info</a></span>');
      expect(result).toBe('<span class="feedback">\n  <span class="badge">\n    Invalid<i class="icon"></i>\n  </span>\n  <a href="#">More info</a>\n</span>\n');
    });

    it('keeps short text flow flat', () => {
      const result = format('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>');
      expect(result).toBe('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>\n');
    });

    it('breaks long text flow', () => {
      const result = format('<p>The answer must be a <i>double-precision</i> {{#complex}}or complex{{/complex}} number.</p>');
      expect(result).toBe('<p>\n  The answer must be a <i>double-precision</i>\n  {{#complex}}or complex{{/complex}} number.\n</p>\n');
    });

    it('reflows multi-line text content', () => {
      // Source newlines in text are treated as word boundaries; short content stays on one line
      const input = '<p>First line of text.\nSecond line of text.</p>';
      const result = format(input);
      expect(result).toBe('<p>First line of text. Second line of text.</p>\n');
    });

    it('keeps short element with attributes flat', () => {
      const result = format('<div class="container" id="main">content</div>');
      expect(result).toBe('<div class="container" id="main">content</div>\n');
    });

    it('keeps short block with self-closing child flat', () => {
      const result = format('<div><br /></div>');
      expect(result).toBe('<div><br /></div>\n');
    });

    it('keeps short block with void element flat', () => {
      const result = format('<div><img src="test.jpg"></div>');
      expect(result).toBe('<div><img src="test.jpg"></div>\n');
    });

    it('formats multiple sibling elements', () => {
      const result = format('<div></div><p></p>');
      expect(result).toBe('<div>\n</div>\n<p>\n</p>\n');
    });
  });

  describe('Mustache sections', () => {
    it('formats mustache section with block content', () => {
      const result = format('{{#items}}<li>item</li>{{/items}}');
      expect(result).toBe('{{#items}}\n  <li>item</li>\n{{/items}}\n');
    });

    it('formats inverted section with block content', () => {
      const result = format('{{^items}}<p>No items</p>{{/items}}');
      expect(result).toBe('{{^items}}\n  <p>No items</p>\n{{/items}}\n');
    });

    it('formats nested HTML and mustache sections', () => {
      const result = format('<ul>{{#items}}<li>{{name}}</li>{{/items}}</ul>');
      expect(result).toBe('<ul>\n  {{#items}}\n    <li>{{name}}</li>\n  {{/items}}\n</ul>\n');
    });

    it('formats complex nesting', () => {
      const input = '<div>{{#show}}<p>visible</p>{{/show}}</div>';
      const result = format(input);
      expect(result).toBe('<div>\n  {{#show}}\n    <p>visible</p>\n  {{/show}}\n</div>\n');
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
      expect(result).toBe('{{#inline}}\n<div>\n  <p>text\n{{/inline}}\n');
    });

    it('keeps text-only mustache sections inline', () => {
      const result = format('<p>figure{{#plural}}s{{/plural}}.</p>');
      expect(result).toBe('<p>figure{{#plural}}s{{/plural}}.</p>\n');
    });

    it('keeps inline-element mustache sections inline', () => {
      const result = format('<p>Hello {{#name}}<strong>{{value}}</strong>{{/name}}!</p>');
      expect(result).toBe('<p>Hello {{#name}}<strong>{{value}}</strong>{{/name}}!</p>\n');
    });

    it('formats standalone mustache sections with proper closing indentation', () => {
      const result = format('<p>{{#message}}{{{message}}}{{/message}} {{^message}}Default{{/message}}</p>');
      expect(result).toBe('<p>\n  {{#message}}{{{message}}}{{/message}}\n  {{^message}}Default{{/message}}\n</p>\n');
    });

    it('formats standalone mustache sections with inline HTML as blocks', () => {
      const result = format('<span class="input-group">{{#label}}<span>{{{label}}}</span>{{/label}}<input /></span>');
      expect(result).toBe('<span class="input-group">\n  {{#label}}<span>{{{label}}}</span>{{/label}}\n  <input />\n</span>\n');
    });
  });

  describe('Mustache interpolation', () => {
    it('keeps short element with interpolation flat', () => {
      const result = format('<p>Hello, {{name}}!</p>');
      expect(result).toBe('<p>Hello, {{name}}!</p>\n');
    });

    it('keeps short element with triple mustache flat', () => {
      const result = format('<div>{{{html}}}</div>');
      expect(result).toBe('<div>{{{html}}}</div>\n');
    });

    it('keeps short element with mustache attribute flat', () => {
      const result = format('<div value="{{variable}}">content</div>');
      expect(result).toBe('<div value="{{variable}}">content</div>\n');
    });

    it('keeps short element with unquoted mustache attribute flat', () => {
      const result = format('<div value={{variable}}>content</div>');
      expect(result).toBe('<div value={{variable}}>content</div>\n');
    });
  });

  describe('Comments', () => {
    it('keeps short element with HTML comment flat', () => {
      const result = format('<div><!-- comment --></div>');
      expect(result).toBe('<div><!-- comment --></div>\n');
    });

    it('keeps short element with mustache comment flat', () => {
      const result = format('<div>{{! comment }}</div>');
      expect(result).toBe('<div>{{! comment }}</div>\n');
    });
  });

  describe('Partials', () => {
    it('keeps short element with partial flat', () => {
      const result = format('<div>{{> header}}</div>');
      expect(result).toBe('<div>{{> header}}</div>\n');
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
      expect(result).toBe('<div>\n\t<p>text</p>\n</div>\n');
    });

    it('respects tabSize option', () => {
      const result = format('<div><p>text</p></div>', { tabSize: 4, insertSpaces: true });
      expect(result).toBe('<div>\n    <p>text</p>\n</div>\n');
    });

    it('respects printWidth option', () => {
      // This content fits in 80 columns but not in 40
      const content = '<p>Hello <strong>world</strong> this is text</p>';
      const wide = formatWithPrintWidth(content, 80);
      const narrow = formatWithPrintWidth(content, 40);
      expect(wide).toBe('<p>Hello <strong>world</strong> this is text</p>\n');
      // Fill wraps "text" to next line at print width 40
      expect(narrow).toBe('<p>\n  Hello <strong>world</strong> this is\n  text\n</p>\n');
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
      expect(result).toBe('<div>multiple spaces</div>\n');
    });

    it('handles entities', () => {
      const result = format('<div>&amp; &lt;</div>');
      expect(result).toBe('<div>&amp; &lt;</div>\n');
    });
  });

  describe('Blank line preservation', () => {
    it('preserves blank line between two block elements', () => {
      const result = format('<div>a</div>\n\n<div>b</div>');
      expect(result).toBe('<div>a</div>\n\n<div>b</div>\n');
    });

    it('collapses multiple blank lines to one', () => {
      const result = format('<div>a</div>\n\n\n\n<div>b</div>');
      expect(result).toBe('<div>a</div>\n\n<div>b</div>\n');
    });

    it('does not insert blank line when none in source', () => {
      const result = format('<div>a</div>\n<div>b</div>');
      expect(result).toBe('<div>a</div>\n<div>b</div>\n');
    });

    it('preserves content inside pre elements as-is', () => {
      const result = format('<pre>line1\n\nline2</pre>');
      expect(result).toBe('<pre>line1\n\nline2</pre>\n');
    });

    it('preserves blank line between nested block elements', () => {
      const result = format('<div>\n<p>first</p>\n\n<p>second</p>\n</div>');
      expect(result).toBe('<div>\n  <p>first</p>\n\n  <p>second</p>\n</div>\n');
    });

    it('preserves blank line in deeply nested structure', () => {
      const result = format('<ul>\n<li>a</li>\n\n<li>b</li>\n</ul>');
      expect(result).toBe('<ul>\n  <li>a</li>\n\n  <li>b</li>\n</ul>\n');
    });

    it('preserves blank line between block and mustache section', () => {
      const result = format('<div>a</div>\n\n{{#show}}\n<p>b</p>\n{{/show}}');
      expect(result).toBe('<div>a</div>\n\n{{#show}}\n  <p>b</p>\n{{/show}}\n');
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

describe('Custom Code Tags (Integration)', () => {
  afterAll(() => {
    setCustomCodeTags([]);
  });

  function formatWithCodeTags(content: string, tags: string[]): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, defaultOptions, tags);
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  it('preserves content of custom code tag', () => {
    const result = formatWithCodeTags(
      '<pl-code>  some   code  </pl-code>',
      ['pl-code']
    );
    expect(result).toBe('<pl-code>  some   code  </pl-code>\n');
  });

  it('treats custom code tag as block-level', () => {
    const result = formatWithCodeTags(
      '<div><pl-code>code</pl-code></div>',
      ['pl-code']
    );
    expect(result).toBe('<div>\n  <pl-code>code</pl-code>\n</div>\n');
  });

  it('preserves whitespace in custom code tag children', () => {
    const result = formatWithCodeTags(
      '<pl-file-editor>\n  line1\n  line2\n</pl-file-editor>',
      ['pl-file-editor']
    );
    expect(result).toBe('<pl-file-editor>\n  line1\n  line2\n</pl-file-editor>\n');
  });

  it('indents closing tag of nested custom code tag', () => {
    const result = formatWithCodeTags(
      '<div>\n<pl-code>\ndef square(x):\n    return x * x\n</pl-code>\n</div>',
      ['pl-code']
    );
    expect(result).toBe('<div>\n  <pl-code>\ndef square(x):\n    return x * x\n  </pl-code>\n</div>\n');
  });

  it('does not affect tags not in custom code tags list', () => {
    const result = formatWithCodeTags(
      '<div>  multiple   spaces  </div>',
      ['pl-code']
    );
    expect(result).toBe('<div>multiple spaces</div>\n');
  });

  it('handles case-insensitive matching', () => {
    const result = formatWithCodeTags(
      '<PL-CODE>  code  </PL-CODE>',
      ['pl-code']
    );
    expect(result).toBe('<PL-CODE>  code  </PL-CODE>\n');
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
    expect(result).toBe('<div>\n    <p>text</p>\n</div>\n');
  });

  it('uses tab indentation from .editorconfig for .html files', () => {
    const result = formatWithEditorConfig('<div><p>text</p></div>', 'test.html');
    expect(result).toBe('<div>\n\t<p>text</p>\n</div>\n');
  });

  it('falls back to LSP options when no .editorconfig exists', () => {
    const tree = parseText('<div><p>text</p></div>');
    const document = createMockDocument('<div><p>text</p></div>', 'file:///nonexistent/path/test.mustache');
    const edits = formatDocument(tree, document, { tabSize: 3, insertSpaces: true });
    expect(edits.length).toBe(1);
    expect(edits[0].newText).toBe('<div>\n   <p>text</p>\n</div>\n');
  });
});
