import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initializeParser } from './wasm';
import { formatSource, _setPrettierForTesting } from './format';
import type { FormattingOptions } from '../../src/core/formatting/index';
import type { HtmlMustacheConfig } from '../../src/core/configSchema';
import { mergeOptions } from '../../src/core/formatting/mergeOptions';

beforeAll(async () => {
  await initializeParser();
});

const defaultOptions: FormattingOptions = { tabSize: 2, insertSpaces: true };

describe('formatSource', () => {
  describe('basic HTML', () => {
    it('formats nested block elements', async () => {
      const result = await formatSource('<div><p>hello</p></div>', defaultOptions);
      expect(result).toBe('<div>\n  <p>hello</p>\n</div>\n');
    });

    it('keeps short inline content flat', async () => {
      const result = await formatSource('<span>text</span>', defaultOptions);
      expect(result).toBe('<span>text</span>\n');
    });

    it('formats attributes', async () => {
      const result = await formatSource('<div class="foo" id="bar">content</div>', defaultOptions);
      expect(result).toBe('<div class="foo" id="bar">content</div>\n');
    });
  });

  describe('mustache templates', () => {
    it('formats mustache sections as blocks', async () => {
      const result = await formatSource(
        '<div>{{#items}}<p>{{name}}</p>{{/items}}</div>',
        defaultOptions,
      );
      expect(result).toBe(
        '<div>\n  {{#items}}\n    <p>{{name}}</p>\n  {{/items}}\n</div>\n'
      );
    });

    it('formats inverted sections', async () => {
      const result = await formatSource(
        '<div>{{^items}}<p>No items</p>{{/items}}</div>',
        defaultOptions,
      );
      expect(result).toBe(
        '<div>\n  {{^items}}\n    <p>No items</p>\n  {{/items}}\n</div>\n'
      );
    });

    it('formats mustache variables inline', async () => {
      const result = await formatSource('<p>Hello {{name}}</p>', defaultOptions);
      expect(result).toBe('<p>Hello {{name}}</p>\n');
    });
  });

  describe('options', () => {
    it('respects indent-size', async () => {
      const result = await formatSource(
        '<div><p>hello</p></div>',
        { tabSize: 4, insertSpaces: true },
      );
      expect(result).toBe('<div>\n    <p>hello</p>\n</div>\n');
    });

    it('respects mustache-spaces', async () => {
      const result = await formatSource(
        '<p>{{name}}</p>',
        defaultOptions,
        { mustacheSpaces: true },
      );
      expect(result).toBe('<p>{{ name }}</p>\n');
    });

    it('respects print-width', async () => {
      const result = await formatSource(
        '<p>Some text that is short</p>',
        defaultOptions,
        { printWidth: 20 },
      );
      // Should still work (formatter wraps when needed)
      expect(result).toContain('<p>');
      expect(result).toContain('</p>');
    });
  });

  describe('idempotency', () => {
    it('formatting already-formatted content produces same output', async () => {
      const input = '<div>\n  <p>hello</p>\n</div>\n';
      const first = await formatSource(input, defaultOptions);
      const second = await formatSource(first, defaultOptions);
      expect(second).toBe(first);
    });

    it('double-format of mustache content is stable', async () => {
      const input = '<div>\n  {{#items}}\n    <p>{{name}}</p>\n  {{/items}}\n</div>\n';
      const first = await formatSource(input, defaultOptions);
      const second = await formatSource(first, defaultOptions);
      expect(second).toBe(first);
    });
  });

  describe('script and style in mustache conditionals', () => {
    it('re-indents script content inside mustache section', async () => {
      const input = [
        '{{#show}}',
        '<script>',
        'const x = 1;',
        'const y = 2;',
        '</script>',
        '{{/show}}',
      ].join('\n');
      const result = await formatSource(input, defaultOptions);
      expect(result).toBe(
        [
          '{{#show}}',
          '  <script>',
          '    const x = 1;',
          '    const y = 2;',
          '  </script>',
          '{{/show}}',
          '',
        ].join('\n')
      );
    });

    it('re-indents style content inside mustache section', async () => {
      const input = [
        '{{#show}}',
        '<style>',
        '.foo { color: red; }',
        '.bar { color: blue; }',
        '</style>',
        '{{/show}}',
      ].join('\n');
      const result = await formatSource(input, defaultOptions);
      // Prettier formats the CSS (expanding declarations to multiline)
      expect(result).toBe(
        [
          '{{#show}}',
          '  <style>',
          '    .foo {',
          '      color: red;',
          '    }',
          '    .bar {',
          '      color: blue;',
          '    }',
          '  </style>',
          '{{/show}}',
          '',
        ].join('\n')
      );
    });
  });

  describe('embedded formatting with prettier', () => {
    afterEach(() => {
      _setPrettierForTesting(undefined);
    });

    it('formats javascript inside script tags', async () => {
      const input = [
        '<script>',
        'const   x=1;const y =  2;',
        '</script>',
      ].join('\n');
      const result = await formatSource(input, defaultOptions);
      expect(result).toBe(
        [
          '<script>',
          '  const x = 1;',
          '  const y = 2;',
          '</script>',
          '',
        ].join('\n')
      );
    });

    it('falls back to re-indent when prettier is unavailable', async () => {
      _setPrettierForTesting(null);

      const input = [
        '<script>',
        'const   x=1;const y =  2;',
        '</script>',
      ].join('\n');
      const result = await formatSource(input, defaultOptions);
      // Without prettier, content is re-indented but not reformatted
      expect(result).toBe(
        [
          '<script>',
          '  const   x=1;const y =  2;',
          '</script>',
          '',
        ].join('\n')
      );
    });
  });

  describe('config file integration', () => {
    it('applies config file settings via pre-resolved options', async () => {
      const config: HtmlMustacheConfig = { indentSize: 4 };
      const result = await formatSource(
        '<div><p>hello</p></div>',
        mergeOptions(defaultOptions, config),
      );
      expect(result).toBe('<div>\n    <p>hello</p>\n</div>\n');
    });

    it('applies mustacheSpaces from config file via caller', async () => {
      // Caller resolves mustacheSpaces + indentSize from config before calling formatSource.
      const config: HtmlMustacheConfig = { mustacheSpaces: true };
      const result = await formatSource(
        '<p>{{name}}</p>',
        defaultOptions,
        { mustacheSpaces: config.mustacheSpaces },
      );
      expect(result).toBe('<p>{{ name }}</p>\n');
    });

    it('editorConfig overrides config file indentSize', async () => {
      // config says 4, editorconfig says 2 — editorconfig wins.
      const config: HtmlMustacheConfig = { indentSize: 4 };
      const result = await formatSource(
        '<div><p>hello</p></div>',
        mergeOptions(defaultOptions, config, { tabSize: 2 }),
      );
      expect(result).toBe('<div>\n  <p>hello</p>\n</div>\n');
    });
  });
});
