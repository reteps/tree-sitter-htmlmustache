import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FormattingOptions } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseText, createMockDocument } from './setup';
import { formatDocument, formatDocumentRange } from '../src/formatting/index';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

const defaultOptions: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
};

describe('Document Formatting', () => {
  function format(content: string, options: FormattingOptions = defaultOptions): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, options);

    // Apply edits (there should be exactly one edit replacing the whole document)
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
      // When an inline element like <span> contains other HTML elements, format as block
      const result = format('<span class="container"><span>inner</span><a href="#">link</a></span>');
      expect(result).toBe('<span class="container">\n  <span>inner</span>\n  <a href="#">link</a>\n</span>\n');
    });

    it('formats complex nested inline elements', () => {
      // Complex nested spans with HTML children get expanded
      // But text with adjacent inline elements stays together (text flow)
      const result = format('<span class="feedback"><span class="badge">Invalid<i class="icon"></i></span><a href="#">More info</a></span>');
      expect(result).toBe('<span class="feedback">\n  <span class="badge">\n    Invalid<i class="icon"></i>\n  </span>\n  <a href="#">More info</a>\n</span>\n');
    });

    it('keeps short text flow flat', () => {
      const result = format('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>');
      expect(result).toBe('<p>Example <i>valid</i> inputs: <code>5</code><code>-17</code></p>\n');
    });

    it('breaks long text flow', () => {
      // This content exceeds 80 chars so the group breaks
      const result = format('<p>The answer must be a <i>double-precision</i> {{#complex}}or complex{{/complex}} number.</p>');
      expect(result).toBe('<p>\n  The answer must be a <i>double-precision</i> {{#complex}}or complex{{/complex}} number.\n</p>\n');
    });

    it('preserves multi-line text content', () => {
      // Content on multiple lines should stay on multiple lines
      const input = '<p>First line of text.\nSecond line of text.</p>';
      const result = format(input);
      expect(result).toBe('<p>\n  First line of text.\n  Second line of text.\n</p>\n');
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
      // When HTML crosses mustache boundaries (implicit end tag), don't indent
      const result = format('{{#inline}}<span class="test">{{/inline}}');
      expect(result).toBe('{{#inline}}\n<span class="test">\n{{/inline}}\n');
    });

    it('does not indent inverted section with implicit end tags', () => {
      const result = format('{{^inline}}<span>{{/inline}}');
      expect(result).toBe('{{^inline}}\n<span>\n{{/inline}}\n');
    });

    it('still indents nested block HTML inside mustache section with implicit end tags', () => {
      // Block HTML inside block HTML should still be indented, even when outer has implicit end
      const result = format('{{#inline}}<div><p>text{{/inline}}');
      expect(result).toBe('{{#inline}}\n<div>\n  <p>text\n{{/inline}}\n');
    });

    it('keeps text-only mustache sections inline', () => {
      // Mustache sections with only text should stay inline
      const result = format('<p>figure{{#plural}}s{{/plural}}.</p>');
      expect(result).toBe('<p>figure{{#plural}}s{{/plural}}.</p>\n');
    });

    it('keeps inline-element mustache sections inline', () => {
      // Mustache sections with only inline elements should stay inline
      const result = format('<p>Hello {{#name}}<strong>{{value}}</strong>{{/name}}!</p>');
      expect(result).toBe('<p>Hello {{#name}}<strong>{{value}}</strong>{{/name}}!</p>\n');
    });

    it('formats standalone mustache sections with proper closing indentation', () => {
      // Standalone mustache sections that are short stay flat
      const result = format('<p>{{#message}}{{{message}}}{{/message}} {{^message}}Default{{/message}}</p>');
      expect(result).toBe('<p>\n  {{#message}}{{{message}}}{{/message}}\n  {{^message}}Default{{/message}}\n</p>\n');
    });

    it('formats standalone mustache sections with inline HTML as blocks', () => {
      // Mustache sections that are NOT part of text flow should be formatted as blocks
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

    it('formats bare mustache interpolation as attribute', () => {
      const result = format('<div {{ dynamic_attrs }}></div>');
      expect(result).toBe('<div {{ dynamic_attrs }}>\n</div>\n');
    });

    it('formats bare mustache triple as attribute', () => {
      const result = format('<div {{{ raw_attrs }}}></div>');
      expect(result).toBe('<div {{{ raw_attrs }}}>\n</div>\n');
    });

    it('formats bare mustache interpolation mixed with regular attributes', () => {
      const result = format('<div class="a" {{attrs}} id="b">text</div>');
      expect(result).toBe('<div class="a" {{attrs}} id="b">text</div>\n');
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

  describe('Prose with inline code elements', () => {
    it('keeps inline elements attached to surrounding text across newlines', () => {
      const input = `{{#net-correct}}
You must select {{{insert_text}}} You will receive a score of <code>100% * (t - f) / n</code>,
where <code>t</code> is the number of true options that you select, <code>f</code>
is the number of false options that you select, and <code>n</code> is the total number of true options.
At minimum, you will receive a score of 0%.
{{/net-correct}}`;
      const result = format(input);
      // Comma stays with </code>, "where" stays with <code>t</code>, etc.
      expect(result).toBe(
        '{{#net-correct}}\n' +
        '  You must select {{{insert_text}}} You will receive a score of <code>100% * (t - f) / n</code>,\n' +
        '  where <code>t</code> is the number of true options that you select, <code>f</code> is the number of false options that you select, and <code>n</code> is the total number of true options.\n' +
        '  At minimum, you will receive a score of 0%.\n' +
        '{{/net-correct}}\n'
      );
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

  describe('Print width breaking', () => {
    it('keeps short block element on one line', () => {
      const result = format('<div>short</div>');
      expect(result).toBe('<div>short</div>\n');
    });

    it('breaks long block element content', () => {
      const longText = 'x'.repeat(80);
      const result = format(`<div>${longText}</div>`);
      expect(result).toBe(`<div>\n  ${longText}\n</div>\n`);
    });

    it('keeps short nested structure flat', () => {
      const result = format('<ul><li>item</li></ul>');
      expect(result).toBe('<ul>\n  <li>item</li>\n</ul>\n');
    });
  });

  describe('Attribute wrapping', () => {
    it('keeps short attributes on one line', () => {
      const result = format('<div class="a" id="b">text</div>');
      expect(result).toBe('<div class="a" id="b">text</div>\n');
    });

    it('wraps long attributes', () => {
      const result = format('<div class="very-long-class-name-that-goes-on-forever" id="also-a-long-identifier" data-value="something-else">text</div>');
      // When attributes wrap, closing > goes on its own line
      expect(result).toContain('<div\n');
      expect(result).toContain('class="very-long-class-name-that-goes-on-forever"');
    });
  });

  describe('Whitespace sensitivity', () => {
    it('preserves space between inline elements', () => {
      const result = format('<p>Hello <strong>World</strong>!</p>');
      // Short enough to stay flat
      expect(result).toBe('<p>Hello <strong>World</strong>!</p>\n');
    });

    it('breaks block elements with block children', () => {
      const result = format('<div><p>text</p></div>');
      expect(result).toBe('<div>\n  <p>text</p>\n</div>\n');
    });
  });
});

describe('Document Range Formatting', () => {
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

describe('Mustache Spaces', () => {
  function formatWithSpaces(content: string, mustacheSpaces?: boolean): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, defaultOptions, undefined, 80, undefined, mustacheSpaces);
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  describe('spaces: true (add spaces)', () => {
    it('adds spaces to interpolation', () => {
      const result = formatWithSpaces('<p>{{name}}</p>', true);
      expect(result).toBe('<p>{{ name }}</p>\n');
    });

    it('adds spaces to triple mustache', () => {
      const result = formatWithSpaces('<div>{{{html}}}</div>', true);
      expect(result).toBe('<div>{{{ html }}}</div>\n');
    });

    it('adds spaces to section begin and end', () => {
      const result = formatWithSpaces('{{#items}}<li>item</li>{{/items}}', true);
      expect(result).toBe('{{# items }}\n  <li>item</li>\n{{/ items }}\n');
    });

    it('adds spaces to inverted section', () => {
      const result = formatWithSpaces('{{^items}}<p>No items</p>{{/items}}', true);
      expect(result).toBe('{{^ items }}\n  <p>No items</p>\n{{/ items }}\n');
    });

    it('adds spaces to partial', () => {
      const result = formatWithSpaces('<div>{{>header}}</div>', true);
      expect(result).toBe('<div>{{> header }}</div>\n');
    });

    it('adds spaces to comment', () => {
      const result = formatWithSpaces('<div>{{!comment}}</div>', true);
      expect(result).toBe('<div>{{! comment }}</div>\n');
    });

    it('adds spaces to mustache section attribute', () => {
      const result = formatWithSpaces('<div {{#show}}class="active"{{/show}}>content</div>', true);
      expect(result).toBe('<div {{# show }}class="active"{{/ show }}>content</div>\n');
    });

    it('adds spaces to unquoted mustache attribute value', () => {
      const result = formatWithSpaces('<div value={{variable}}>content</div>', true);
      expect(result).toBe('<div value={{ variable }}>content</div>\n');
    });

    it('adds spaces to quoted mustache attribute value', () => {
      const result = formatWithSpaces('<div value="{{variable}}">content</div>', true);
      expect(result).toBe('<div value="{{ variable }}">content</div>\n');
    });

    it('adds spaces to force-inlined sections', () => {
      const result = formatWithSpaces('<p>figure{{#plural}}s{{/plural}}.</p>', true);
      expect(result).toBe('<p>figure{{# plural }}s{{/ plural }}.</p>\n');
    });
  });

  describe('spaces: false (remove spaces)', () => {
    it('removes spaces from interpolation', () => {
      const result = formatWithSpaces('<p>{{ name }}</p>', false);
      expect(result).toBe('<p>{{name}}</p>\n');
    });

    it('removes spaces from triple mustache', () => {
      const result = formatWithSpaces('<div>{{{ html }}}</div>', false);
      expect(result).toBe('<div>{{{html}}}</div>\n');
    });

    it('removes spaces from section begin and end', () => {
      const result = formatWithSpaces('{{# items }}<li>item</li>{{/ items }}', false);
      expect(result).toBe('{{#items}}\n  <li>item</li>\n{{/items}}\n');
    });

    it('removes spaces from inverted section', () => {
      const result = formatWithSpaces('{{^ items }}<p>No items</p>{{/ items }}', false);
      expect(result).toBe('{{^items}}\n  <p>No items</p>\n{{/items}}\n');
    });

    it('removes spaces from partial', () => {
      const result = formatWithSpaces('<div>{{> header }}</div>', false);
      expect(result).toBe('<div>{{>header}}</div>\n');
    });

    it('removes spaces from comment', () => {
      const result = formatWithSpaces('<div>{{! comment }}</div>', false);
      expect(result).toBe('<div>{{!comment}}</div>\n');
    });

    it('removes spaces from force-inlined sections', () => {
      const result = formatWithSpaces('<p>figure{{# plural }}s{{/ plural }}.</p>', false);
      expect(result).toBe('<p>figure{{#plural}}s{{/plural}}.</p>\n');
    });

    it('removes spaces from quoted mustache attribute value', () => {
      const result = formatWithSpaces('<div alt="{{ img-alt  }}">content</div>', false);
      expect(result).toBe('<div alt="{{img-alt}}">content</div>\n');
    });
  });

  describe('default (undefined) preserves original', () => {
    it('preserves no-space interpolation', () => {
      const result = formatWithSpaces('<p>{{name}}</p>', undefined);
      expect(result).toBe('<p>{{name}}</p>\n');
    });

    it('preserves spaced interpolation', () => {
      const result = formatWithSpaces('<p>{{ name }}</p>', undefined);
      expect(result).toBe('<p>{{ name }}</p>\n');
    });

    it('preserves no-space section tags', () => {
      const result = formatWithSpaces('{{#items}}<li>item</li>{{/items}}', undefined);
      expect(result).toBe('{{#items}}\n  <li>item</li>\n{{/items}}\n');
    });

    it('preserves spaced section tags', () => {
      const result = formatWithSpaces('{{# items }}<li>item</li>{{/ items }}', undefined);
      expect(result).toBe('{{# items }}\n  <li>item</li>\n{{/ items }}\n');
    });
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
    expect(result).toBe('<div>\n    <p>text</p>\n</div>\n');
  });

  it('uses tab indentation from .editorconfig for .html files', () => {
    const result = formatWithEditorConfig('<div><p>text</p></div>', 'test.html');
    // Should use tab indent from .editorconfig
    expect(result).toBe('<div>\n\t<p>text</p>\n</div>\n');
  });

  it('falls back to LSP options when no .editorconfig exists', () => {
    const tree = parseText('<div><p>text</p></div>');
    // Use a path that won't have .editorconfig
    const document = createMockDocument('<div><p>text</p></div>', 'file:///nonexistent/path/test.mustache');
    const edits = formatDocument(tree, document, { tabSize: 3, insertSpaces: true });
    expect(edits.length).toBe(1);
    // Should fall back to 3-space indent from LSP options
    expect(edits[0].newText).toBe('<div>\n   <p>text</p>\n</div>\n');
  });
});
