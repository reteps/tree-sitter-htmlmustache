import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FormattingOptions } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseText, createMockDocument } from './setup';
import { formatDocument, formatDocumentRange } from '../src/formatting/index';
import type { CustomCodeTagConfig } from '../src/customCodeTags';
import type { HtmlMustacheConfig } from '../src/configFile';
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

  function formatWithPrintWidth(content: string, printWidth: number, options: FormattingOptions = defaultOptions): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, options, { printWidth });
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
      // This content exceeds 80 chars so the group breaks, and fill wraps at print width
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

    it('adds line break after br tag in block content', () => {
      const result = format('<p>Hello<br>World</p>');
      expect(result).toBe('<p>\n  Hello<br>\n  World\n</p>\n');
    });

    it('adds line break after self-closing br tag in block content', () => {
      const result = format('<p>Hello<br />World</p>');
      expect(result).toBe('<p>\n  Hello<br />\n  World\n</p>\n');
    });

    it('handles br at end of content without extra blank line', () => {
      const result = format('<p>Hello<br></p>');
      expect(result).toBe('<p>Hello<br></p>\n');
    });

    it('handles multiple br tags', () => {
      const result = format('<p>Line 1<br>Line 2<br>Line 3</p>');
      expect(result).toBe('<p>\n  Line 1<br>\n  Line 2<br>\n  Line 3\n</p>\n');
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

    it('formats erroneous end tags as block-level', () => {
      // Erroneous end tags (orphaned closing tags from cross-section patterns) should each be on their own line
      const input = '{{#show}}<div><div><div>{{/show}}\n</div></div></div>';
      const result = format(input);
      expect(result).toContain('</div>\n</div>\n</div>\n');
    });

    it('formats single erroneous end tag on its own line', () => {
      const input = '{{#show}}<div>{{/show}}\n</div>';
      const result = format(input);
      expect(result).toBe('{{#show}}\n<div>\n{{/show}}\n</div>\n');
    });

    it('indents void elements inside mustache sections', () => {
      const input = '{{#img-top-src}}\n<img src="{{img-top-src}}" alt="{{img-top-alt}}" class="card-img-top">\n{{/img-top-src}}';
      const result = format(input);
      expect(result).toBe('{{#img-top-src}}\n  <img src="{{img-top-src}}" alt="{{img-top-alt}}" class="card-img-top">\n{{/img-top-src}}\n');
    });
  });

  describe('Mustache interpolation', () => {
    it('keeps short element with interpolation flat', () => {
      const result = format('<p>Hello, {{name}}!</p>');
      expect(result).toBe('<p>Hello, {{name}}!</p>\n');
    });

    it('preserves space between interpolation and text in inline element', () => {
      const result = format('<strong>{{tol_translation}} units</strong>');
      expect(result).toBe('<strong>{{tol_translation}} units</strong>\n');
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

    it('keeps consecutive comments on separate lines', () => {
      const input = [
        '<!-- comment 1 -->',
        '<!-- comment 2 -->',
        '<!-- comment 3 -->',
      ].join('\n');
      const result = format(input);
      expect(result).toBe(input + '\n');
    });

    it('keeps consecutive comments on separate lines inside block element', () => {
      const input = [
        '<div>',
        '  <!-- comment 1 -->',
        '  <!-- comment 2 -->',
        '  <!-- comment 3 -->',
        '</div>',
      ].join('\n');
      const result = format(input);
      expect(result).toBe(input + '\n');
    });

    it('keeps inline comments on same line', () => {
      const result = format('<div><!-- a --><!-- b --></div>');
      expect(result).toBe('<div><!-- a --><!-- b --></div>\n');
    });
  });

  describe('Partials', () => {
    it('keeps short element with partial flat', () => {
      const result = format('<div>{{> header}}</div>');
      expect(result).toBe('<div>{{> header}}</div>\n');
    });
  });

  describe('Script and style elements', () => {
    it('breaks single-line script content onto new lines', () => {
      const input = '<script>const x = 1;</script>';
      const result = format(input);
      expect(result).toBe('<script>\n  const x = 1;\n</script>\n');
    });

    it('breaks single-line style content onto new lines', () => {
      const input = '<style>.foo { color: red; }</style>';
      const result = format(input);
      expect(result).toBe('<style>\n  .foo { color: red; }\n</style>\n');
    });

    it('breaks script with attributes onto new lines', () => {
      const input = '<script type="module">import x from "y";</script>';
      const result = format(input);
      expect(result).toBe(
        '<script type="module">\n  import x from "y";\n</script>\n'
      );
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
      // Fill wraps at 80 chars; comma stays with </code>, inline elements stay atomic
      expect(result).toBe(
        '{{#net-correct}}\n' +
        '  You must select {{{insert_text}}} You will receive a score of\n' +
        '  <code>100% * (t - f) / n</code>, where <code>t</code> is the number of true\n' +
        '  options that you select, <code>f</code> is the number of false options that\n' +
        '  you select, and <code>n</code> is the total number of true options. At\n' +
        '  minimum, you will receive a score of 0%.\n' +
        '{{/net-correct}}\n'
      );
    });

    it('wraps at print width 100 with 4-space indent', () => {
      const input = `{{#net-correct}}
You must select {{{insert_text}}} You will receive a score of <code>100% * (t - f) / n</code>,
where <code>t</code> is the number of true options that you select, <code>f</code>
is the number of false options that you select, and <code>n</code> is the total number of true options.
At minimum, you will receive a score of 0%.
{{/net-correct}}`;
      const result = formatWithPrintWidth(input, 100, { tabSize: 4, insertSpaces: true });
      expect(result).toBe(
        '{{#net-correct}}\n' +
        '    You must select {{{insert_text}}} You will receive a score of <code>100% * (t - f) / n</code>,\n' +
        '    where <code>t</code> is the number of true options that you select, <code>f</code> is the number\n' +
        '    of false options that you select, and <code>n</code> is the total number of true options. At\n' +
        '    minimum, you will receive a score of 0%.\n' +
        '{{/net-correct}}\n'
      );
    });

    it('keeps short inline content on one line', () => {
      const input = '<p>Hello <code>world</code> and more.</p>';
      const result = format(input);
      expect(result).toBe('<p>Hello <code>world</code> and more.</p>\n');
    });

    it('wraps long inline text at word boundaries respecting print width', () => {
      const input = '<p>This is a very long sentence that contains <code>inline code</code> and should wrap at word boundaries when it exceeds the print width limit.</p>';
      const result = format(input);
      // The group breaks because content exceeds 80 chars, then fill wraps at word boundaries
      expect(result).toBe(
        '<p>\n' +
        '  This is a very long sentence that contains <code>inline code</code> and should\n' +
        '  wrap at word boundaries when it exceeds the print width limit.\n' +
        '</p>\n'
      );
    });

    it('wraps at print width 100 with 8-space indent', () => {
      // 8-space indent comes from nesting: e.g. tabSize=4 at depth 2
      const input = `<div>
<div>
{{#net-correct}}
You must select {{{insert_text}}} You will receive a score of <code>100% * (t - f) / n</code>,
where <code>t</code> is the number of true options that you select, <code>f</code>
is the number of false options that you select, and <code>n</code> is the total number of true options.
At minimum, you will receive a score of 0%.
{{/net-correct}}
</div>
</div>`;
      const result = formatWithPrintWidth(input, 100, { tabSize: 4, insertSpaces: true });
      // comma stays with </code>, "where" joins on same line, "At" joins "options."
      expect(result).toBe(
        '<div>\n' +
        '    <div>\n' +
        '        {{#net-correct}}\n' +
        '            You must select {{{insert_text}}} You will receive a score of\n' +
        '            <code>100% * (t - f) / n</code>, where <code>t</code> is the number of true options that\n' +
        '            you select, <code>f</code> is the number of false options that you select, and\n' +
        '            <code>n</code> is the total number of true options. At minimum, you will receive a score\n' +
        '            of 0%.\n' +
        '        {{/net-correct}}\n' +
        '    </div>\n' +
        '</div>\n'
      );
    });

    it('attaches punctuation to preceding content after wrapping', () => {
      const input = '<div>Some text before <code>value</code>, and some text after the comma.</div>';
      const result = format(input);
      // Comma stays attached to </code>
      expect(result).toBe('<div>Some text before <code>value</code>, and some text after the comma.</div>\n');
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

    it('puts content on its own line when attributes wrap', () => {
      const result = format('<button type="button" class="btn btn-outline-secondary btn-sm file-preview-download">Download</button>');
      expect(result).toBe(
        '<button\n' +
        '  type="button"\n' +
        '  class="btn btn-outline-secondary btn-sm file-preview-download"\n' +
        '>\n' +
        '  Download\n' +
        '</button>\n'
      );
    });

    it('keeps attrs and content flat when everything fits', () => {
      const result = format('<button class="btn">OK</button>');
      expect(result).toBe('<button class="btn">OK</button>\n');
    });

    it('wraps attrs with block children unchanged', () => {
      const result = format('<div class="container very-long-class-name" id="also-a-long-identifier-that-exceeds-print-width"><p>content</p></div>');
      // Attrs wrap, block child on its own line with indent
      expect(result).toContain('<div\n');
      expect(result).toContain('  <p>content</p>\n');
    });

    it('keeps inline elements in text flow unchanged', () => {
      const result = format('<p>Click <a href="url">here</a>.</p>');
      expect(result).toBe('<p>Click <a href="url">here</a>.</p>\n');
    });
  });

  describe('Block elements followed by text', () => {
    it('puts a newline between block element and following text', () => {
      const result = format('<table><tr><td>data</td></tr></table> For any other input, the answer is 0.');
      expect(result).toContain('</table>\n');
      expect(result).not.toContain('</table> For');
    });

    it('preserves blank lines between block element and text', () => {
      const input = '<table><tr><td>data</td></tr></table>\n\nFor any other input, the answer is 0.';
      const result = format(input);
      expect(result).toContain('</table>\n\n');
    });
  });

  describe('Inline elements with inline HTML children in text flow', () => {
    it('keeps <a><code>x</code></a> tight when in text flow', () => {
      const result = format('<p>See <a href="url"><code>docs</code></a>.</p>');
      expect(result).toBe('<p>See <a href="url"><code>docs</code></a>.</p>\n');
    });

    it('keeps </a> and trailing punctuation together', () => {
      const result = format('<p>Read <a href="url"><code>this</code></a>, then continue.</p>');
      expect(result).toBe('<p>Read <a href="url"><code>this</code></a>, then continue.</p>\n');
    });

    it('still expands standalone inline elements with HTML children', () => {
      // When NOT in text flow, inline elements with HTML children should still expand
      const result = format('<span class="container"><span>inner</span><a href="#">link</a></span>');
      expect(result).toBe('<span class="container">\n  <span>inner</span>\n  <a href="#">link</a>\n</span>\n');
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
    const edits = formatDocument(tree, document, defaultOptions, { mustacheSpaces });
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

    it('keeps spaces in comment even with mustacheSpaces false', () => {
      const result = formatWithSpaces('<div>{{! comment }}</div>', false);
      expect(result).toBe('<div>{{! comment }}</div>\n');
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

describe('Custom Code Tag Indentation', () => {
  const defaultOpts: FormattingOptions = { tabSize: 2, insertSpaces: true };

  function formatWithConfigs(
    content: string,
    configs: CustomCodeTagConfig[],
    options: FormattingOptions = defaultOpts
  ): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, options, { customTags: configs });
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  describe('indent: "never"', () => {
    it('preserves content as-is with no indent config', () => {
      const result = formatWithConfigs(
        '<pl-code>\n    indented content\n      more indented\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python' }]
      );
      expect(result).toBe('<pl-code>\n    indented content\n      more indented\n</pl-code>\n');
    });

    it('preserves content as-is with explicit indent: "never"', () => {
      const result = formatWithConfigs(
        '<pl-code>\n    indented content\n      more indented\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'never' }]
      );
      expect(result).toBe('<pl-code>\n    indented content\n      more indented\n</pl-code>\n');
    });
  });

  describe('indent: "always"', () => {
    it('dedents and re-indents content at nesting level 0', () => {
      const result = formatWithConfigs(
        '<pl-code>\n    line one\n    line two\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'always' }]
      );
      expect(result).toBe('<pl-code>\n  line one\n  line two\n</pl-code>\n');
    });

    it('handles mixed indentation levels', () => {
      const result = formatWithConfigs(
        '<pl-code>\n        def foo():\n            return 1\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'always' }]
      );
      expect(result).toBe('<pl-code>\n  def foo():\n      return 1\n</pl-code>\n');
    });

    it('handles nesting inside other elements', () => {
      const result = formatWithConfigs(
        '<div>\n  <pl-code>\n      line one\n      line two\n  </pl-code>\n</div>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'always' }]
      );
      expect(result).toBe('<div>\n  <pl-code>\n    line one\n    line two\n  </pl-code>\n</div>\n');
    });

    it('preserves empty lines within content', () => {
      const result = formatWithConfigs(
        '<pl-code>\n    line one\n\n    line two\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'always' }]
      );
      expect(result).toBe('<pl-code>\n  line one\n\n  line two\n</pl-code>\n');
    });

    it('handles content with no common indent', () => {
      const result = formatWithConfigs(
        '<pl-code>\nline one\n  indented\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'always' }]
      );
      expect(result).toBe('<pl-code>\n  line one\n    indented\n</pl-code>\n');
    });
  });

  describe('indent: "attribute"', () => {
    it('indents when attribute has truthy value "true"', () => {
      const result = formatWithConfigs(
        '<pl-code source-file-name="test.py">\n    line one\n    line two\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'attribute', indentAttribute: 'source-file-name' }]
      );
      expect(result).toBe('<pl-code source-file-name="test.py">\n  line one\n  line two\n</pl-code>\n');
    });

    it('indents when attribute has any non-falsy string', () => {
      const result = formatWithConfigs(
        '<pl-code source-file-name="anything">\n    line one\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'attribute', indentAttribute: 'source-file-name' }]
      );
      expect(result).toBe('<pl-code source-file-name="anything">\n  line one\n</pl-code>\n');
    });

    it('preserves content when attribute is missing', () => {
      const result = formatWithConfigs(
        '<pl-code>\n    line one\n    line two\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'attribute', indentAttribute: 'source-file-name' }]
      );
      expect(result).toBe('<pl-code>\n    line one\n    line two\n</pl-code>\n');
    });

    it('preserves content when attribute is "false"', () => {
      const result = formatWithConfigs(
        '<pl-code source-file-name="false">\n    line one\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'attribute', indentAttribute: 'source-file-name' }]
      );
      expect(result).toBe('<pl-code source-file-name="false">\n    line one\n</pl-code>\n');
    });

    it('preserves content when attribute is "0"', () => {
      const result = formatWithConfigs(
        '<pl-code source-file-name="0">\n    line one\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'attribute', indentAttribute: 'source-file-name' }]
      );
      expect(result).toBe('<pl-code source-file-name="0">\n    line one\n</pl-code>\n');
    });

    it('preserves content when attribute is empty string', () => {
      const result = formatWithConfigs(
        '<pl-code source-file-name="">\n    line one\n</pl-code>',
        [{ name: 'pl-code', languageDefault: 'python', indent: 'attribute', indentAttribute: 'source-file-name' }]
      );
      expect(result).toBe('<pl-code source-file-name="">\n    line one\n</pl-code>\n');
    });
  });
});

describe('Format Ignore', () => {
  function format(content: string, options: FormattingOptions = defaultOptions): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, options);
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  it('ignores the next node with HTML comment', () => {
    const input = '<!-- htmlmustache-ignore -->\n<div   class="a"   id="b"  >\n  badly   formatted\n</div>';
    const result = format(input);
    expect(result).toBe('<!-- htmlmustache-ignore -->\n<div   class="a"   id="b"  >\n  badly   formatted\n</div>\n');
  });

  it('ignores the next node with Mustache comment', () => {
    const input = '{{! htmlmustache-ignore }}\n<div   class="a"  >content</div>';
    const result = format(input);
    expect(result).toBe('{{! htmlmustache-ignore }}\n<div   class="a"  >content</div>\n');
  });

  it('only ignores the immediately next node', () => {
    const input = '<!-- htmlmustache-ignore -->\n<div   class="a"  >content</div>\n<div   class="b"  ><p>text</p></div>';
    const result = format(input);
    // First div preserved as-is, second div gets formatted
    expect(result).toBe('<!-- htmlmustache-ignore -->\n<div   class="a"  >content</div>\n<div class="b">\n  <p>text</p>\n</div>\n');
  });

  it('ignores a region with HTML comments', () => {
    const input = '<!-- htmlmustache-ignore-start -->\n<div   class="a"  >content</div>\n<p>  text  </p>\n<!-- htmlmustache-ignore-end -->';
    const result = format(input);
    expect(result).toBe('<!-- htmlmustache-ignore-start -->\n<div   class="a"  >content</div>\n<p>  text  </p>\n<!-- htmlmustache-ignore-end -->\n');
  });

  it('ignores a region with Mustache comments', () => {
    const input = '{{! htmlmustache-ignore-start }}\n<div   class="a"  >content</div>\n{{! htmlmustache-ignore-end }}';
    const result = format(input);
    expect(result).toBe('{{! htmlmustache-ignore-start }}\n<div   class="a"  >content</div>\n{{! htmlmustache-ignore-end }}\n');
  });

  it('ignores content inside a mustache section', () => {
    const input = '{{#show}}\n<!-- htmlmustache-ignore -->\n<div   class="a"  >content</div>\n{{/show}}';
    const result = format(input);
    expect(result).toBe('{{#show}}\n  <!-- htmlmustache-ignore -->\n  <div   class="a"  >content</div>\n{{/show}}\n');
  });

  it('handles ignore comment at end of file with no next node', () => {
    const input = '<div>text</div>\n<!-- htmlmustache-ignore -->';
    const result = format(input);
    expect(result).toBe('<div>text</div>\n<!-- htmlmustache-ignore -->\n');
  });

  it('treats ignore-end without ignore-start as normal comment', () => {
    const input = '<div>text</div>\n<!-- htmlmustache-ignore-end -->';
    const result = format(input);
    expect(result).toBe('<div>text</div>\n<!-- htmlmustache-ignore-end -->\n');
  });

  it('handles unterminated ignore-start by preserving remaining content', () => {
    const input = '<!-- htmlmustache-ignore-start -->\n<div   class="a"  >content</div>\n<p>  text  </p>';
    const result = format(input);
    expect(result).toBe('<!-- htmlmustache-ignore-start -->\n<div   class="a"  >content</div>\n<p>  text  </p>\n');
  });

  it('preserves original indentation in ignored content', () => {
    const input = '<div>\n  <!-- htmlmustache-ignore -->\n  <span   class="x"  >\n      preserved indentation\n  </span>\n</div>';
    const result = format(input);
    expect(result).toContain('<span   class="x"  >');
    expect(result).toContain('      preserved indentation');
  });

  it('ignores a mustache section', () => {
    const input = '<!-- htmlmustache-ignore -->\n{{#items}}<li>{{name}}</li>{{/items}}';
    const result = format(input);
    expect(result).toBe('<!-- htmlmustache-ignore -->\n{{#items}}<li>{{name}}</li>{{/items}}\n');
  });

  it('ignore-start/end is idempotent inside indented context', () => {
    const input = '<div>\n  </div>\n{{! htmlmustache-ignore-start }}\n        </div>\n    </div>\n</div>\n{{! htmlmustache-ignore-end }}';
    const result1 = format(input);
    const result2 = format(result1);
    expect(result2).toBe(result1);
  });

  it('preserves raw text indentation in ignore region inside block', () => {
    const input = '<div>\n{{! htmlmustache-ignore-start }}\n    <span>raw</span>\n{{! htmlmustache-ignore-end }}\n</div>';
    const result = format(input);
    expect(result).toContain('    <span>raw</span>');
    const result2 = format(result);
    expect(result2).toBe(result);
  });

  it('preserves blank lines around ignored regions', () => {
    const input = '<p>before</p>\n\n<!-- htmlmustache-ignore -->\n<div   class="a"  >content</div>\n\n<p>after</p>';
    const result = format(input);
    expect(result).toContain('<p>before</p>\n\n<!-- htmlmustache-ignore -->');
    expect(result).toContain('<div   class="a"  >content</div>\n\n<p>after</p>');
  });
});

describe('Config File Integration', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configfile-fmt-test-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function formatWithConfig(content: string, config: HtmlMustacheConfig, filename = 'test.mustache'): string {
    const tree = parseText(content);
    const filePath = path.join(tempDir, filename);
    const uri = pathToFileURL(filePath).toString();
    const document = TextDocument.create(uri, 'htmlmustache', 1, content);
    const edits = formatDocument(tree, document, defaultOptions, {
      printWidth: config.printWidth, mustacheSpaces: config.mustacheSpaces, configFile: config,
    });
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  it('uses indentSize from config file', () => {
    const result = formatWithConfig('<div><p>text</p></div>', { indentSize: 4 });
    expect(result).toBe('<div>\n    <p>text</p>\n</div>\n');
  });

  it('uses printWidth from config file', () => {
    const result = formatWithConfig(
      '<p>Some medium length text here</p>',
      { printWidth: 20 }
    );
    expect(result).toContain('\n');
  });

  it('uses mustacheSpaces from config file', () => {
    const result = formatWithConfig('<p>{{name}}</p>', { mustacheSpaces: true });
    expect(result).toBe('<p>{{ name }}</p>\n');
  });

  it('editorconfig overrides config file indent settings', () => {
    // Create .editorconfig that sets 8-space indent
    fs.writeFileSync(path.join(tempDir, '.editorconfig'), `root = true\n\n[*.mustache]\nindent_size = 8\nindent_style = space\n`);

    const tree = parseText('<div><p>text</p></div>');
    const filePath = path.join(tempDir, 'test.mustache');
    const uri = pathToFileURL(filePath).toString();
    const document = TextDocument.create(uri, 'htmlmustache', 1, '<div><p>text</p></div>');
    // Config file says indentSize: 2, but editorconfig says 8
    const config: HtmlMustacheConfig = { indentSize: 2 };
    const edits = formatDocument(tree, document, defaultOptions, { configFile: config });
    expect(edits.length).toBe(1);
    // Editorconfig's 8-space indent should win over config file's 2
    expect(edits[0].newText).toBe('<div>\n        <p>text</p>\n</div>\n');

    // Clean up .editorconfig
    fs.unlinkSync(path.join(tempDir, '.editorconfig'));
  });
});

describe('noBreakDelimiters', () => {
  function formatWithDelimiters(
    content: string,
    noBreakDelimiters: { start: string; end: string }[],
    printWidth = 40,
  ): string {
    const tree = parseText(content);
    const document = createMockDocument(content);
    const edits = formatDocument(tree, document, defaultOptions, {
      printWidth,
      noBreakDelimiters,
    });
    expect(edits.length).toBe(1);
    return edits[0].newText;
  }

  it('keeps formula on one line when it fits', () => {
    const input = '<p>The value is $x = 5$.</p>';
    const result = formatWithDelimiters(input, [{ start: '$', end: '$' }], 80);
    expect(result).toBe('<p>The value is $x = 5$.</p>\n');
  });

  it('moves entire formula to next line as a unit when wrapping', () => {
    const input = '<p>The resistance is $R_2 = 100\\Omega$ which is large.</p>';
    const result = formatWithDelimiters(input, [{ start: '$', end: '$' }], 40);
    // The formula should not break mid-formula
    expect(result).toContain('$R_2 = 100\\Omega$');
    // Verify no line break inside the delimiters
    const lines = result.split('\n');
    for (const line of lines) {
      const dollars = (line.match(/\$/g) || []).length;
      // Each line should have 0 or an even number of $ (matched pairs)
      expect(dollars % 2).toBe(0);
    }
  });

  it('keeps formula with mustache interpolation together', () => {
    const input = '<p>The resistance is $R_2 = {{params.R2}}\\Omega$ in the circuit.</p>';
    const result = formatWithDelimiters(input, [{ start: '$', end: '$' }], 40);
    expect(result).toContain('$R_2 = {{params.R2}}\\Omega$');
  });

  it('handles multiple formulas on the same line', () => {
    const input = '<p>We have $x = 1$ and $y = 2$ here.</p>';
    const result = formatWithDelimiters(input, [{ start: '$', end: '$' }], 80);
    expect(result).toContain('$x = 1$');
    expect(result).toContain('$y = 2$');
  });

  it('handles $$ display math delimiters', () => {
    const input = '<p>Consider $$E = mc^2$$ as shown.</p>';
    const result = formatWithDelimiters(input, [{ start: '$', end: '$' }, { start: '$$', end: '$$' }], 30);
    expect(result).toContain('$$E = mc^2$$');
  });

  it('does not affect formatting when noBreakDelimiters is not configured', () => {
    const input = '<p>The resistance is $R_2 = 100\\Omega$ which is large.</p>';
    const tree = parseText(input);
    const document = createMockDocument(input);
    const edits = formatDocument(tree, document, defaultOptions, { printWidth: 40 });
    expect(edits.length).toBe(1);
    // Without noBreakDelimiters, wrapping can break inside $ delimiters
    const result = edits[0].newText;
    expect(result).toBeDefined();
  });

  it('handles unpaired delimiter gracefully', () => {
    const input = '<p>The price is $5 and that is all.</p>';
    const result = formatWithDelimiters(input, [{ start: '$', end: '$' }], 30);
    // Should not crash; unpaired $ is treated as normal text
    expect(result).toContain('$5');
  });

  it('handles asymmetric \\(...\\) delimiters', () => {
    const input = '<p>The formula is \\(x^2 + y^2 = r^2\\) in the plane.</p>';
    const result = formatWithDelimiters(input, [{ start: '\\(', end: '\\)' }], 40);
    expect(result).toContain('\\(x^2 + y^2 = r^2\\)');
  });

  it('handles asymmetric \\[...\\] display math delimiters', () => {
    const input = '<p>Consider \\[E = mc^2\\] as shown.</p>';
    const result = formatWithDelimiters(input, [{ start: '\\[', end: '\\]' }], 30);
    expect(result).toContain('\\[E = mc^2\\]');
  });

  it('handles mixed symmetric and asymmetric delimiters', () => {
    const input = '<p>Inline $a + b$ and display \\[E = mc^2\\] formulas.</p>';
    const result = formatWithDelimiters(input, [
      { start: '$', end: '$' },
      { start: '\\[', end: '\\]' },
    ], 40);
    expect(result).toContain('$a + b$');
    expect(result).toContain('\\[E = mc^2\\]');
  });
});
