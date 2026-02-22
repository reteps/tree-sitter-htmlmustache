import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { parseText } from './setup';
import { getDiagnostics } from '../src/diagnostics';

describe('Diagnostics', () => {
  describe('mustache section mismatches', () => {
    it('reports mismatched section closing tag', () => {
      const tree = parseText('{{#foo}}content{{/bar}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
      expect(diagnostics[0].message).toContain('bar');
      expect(diagnostics[0].source).toBe('htmlmustache');
    });

    it('reports mismatched inverted section closing tag', () => {
      const tree = parseText('{{^foo}}content{{/bar}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].message).toContain('bar');
    });

    it('returns no diagnostics for correctly matched sections', () => {
      const tree = parseText('{{#items}}<li>{{name}}</li>{{/items}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });

    it('reports multiple mismatches', () => {
      const tree = parseText('{{#a}}{{#b}}{{/a}}{{/b}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(2);
    });

    it('includes correct range for error', () => {
      const tree = parseText('{{#foo}}\n{{/bar}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics[0].range.start.line).toBe(1);
      expect(diagnostics[0].range.start.character).toBe(0);
    });
  });

  describe('syntax errors', () => {
    it('reports tree-sitter ERROR nodes', () => {
      const tree = parseText('{{#unclosed');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Syntax error')).toBe(true);
    });
  });

  describe('valid templates', () => {
    it('returns empty for valid HTML', () => {
      const tree = parseText('<div><p>Hello</p></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });

    it('returns empty for valid nested mustache', () => {
      const tree = parseText(`
        {{#outer}}
          {{#inner}}
            {{value}}
          {{/inner}}
        {{/outer}}
      `);
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });
  });

  describe('HTML balance checker', () => {
    it('reports mismatched HTML end tag outside sections', () => {
      const tree = parseText('<div></span></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Mismatched HTML end tag: </span>')).toBe(true);
    });

    it('allows same-name section open/close pairs (only warning for consecutive)', () => {
      const tree = parseText('{{#s}}<div>{{/s}} {{#s}}</div>{{/s}}');
      const diagnostics = getDiagnostics(tree);

      // The only diagnostic should be the consecutive section warning
      expect(diagnostics.every(d => d.severity === DiagnosticSeverity.Warning)).toBe(true);
    });

    it('detects inverted section open/close mismatch', () => {
      const tree = parseText('{{#s}}<div>{{/s}} {{^s}}</div>{{/s}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it('allows if/else balanced patterns', () => {
      const tree = parseText('{{#s}}<span>{{/s}}{{^s}}<div>{{/s}} {{#s}}</span>{{/s}}{{^s}}</div>{{/s}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });

    it('detects if/else swapped close tags', () => {
      const tree = parseText('{{#s}}<span>{{/s}}{{^s}}<div>{{/s}} {{#s}}</div>{{/s}}{{^s}}</span>{{/s}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it('detects orphan close tag in section', () => {
      const tree = parseText('{{#s}}</span>{{/s}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('mustache lint checks', () => {
    it('detects nested same-name sections', () => {
      const tree = parseText('{{#x}}{{#x}}inner{{/x}}{{/x}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Nested duplicate section'))).toBe(true);
    });

    it('allows sequential same-name sections', () => {
      const tree = parseText('{{#x}}first{{/x}}{{#x}}second{{/x}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Nested duplicate section'))).toBe(false);
    });

    it('detects unquoted mustache attribute value', () => {
      const tree = parseText('<div class={{foo}}></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unquoted mustache attribute value'))).toBe(true);
    });

    it('allows quoted mustache attribute value', () => {
      const tree = parseText('<div class="{{foo}}"></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unquoted mustache attribute value'))).toBe(false);
    });

    it('does not flag standalone mustache in tag', () => {
      const tree = parseText('<div {{attrs}}></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unquoted mustache attribute value'))).toBe(false);
    });
  });

  describe('unclosed tag detection', () => {
    it('detects unclosed canvas tag', () => {
      const tree = parseText('<div><canvas></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Unclosed HTML tag: <canvas>')).toBe(true);
    });

    it('allows properly closed canvas tag', () => {
      const tree = parseText('<div><canvas></canvas></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });

    it('allows void elements without close tags', () => {
      const tree = parseText('<div><br><hr><img src="x"></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });

    it('allows optional end tag elements like li', () => {
      const tree = parseText('<ul><li>one<li>two</ul>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
    });

    it('detects unclosed span', () => {
      const tree = parseText('<div><span>text</div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Unclosed HTML tag: <span>')).toBe(true);
    });
  });

  describe('self-closing non-void tags', () => {
    it('detects self-closing div', () => {
      const tree = parseText('<div/>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Self-closing non-void element: <div/>')).toBe(true);
    });

    it('allows self-closing void elements', () => {
      const tree = parseText('<br/><img src="x"/>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(false);
    });

    it('reports as error severity', () => {
      const tree = parseText('<div/>');
      const diagnostics = getDiagnostics(tree);

      const err = diagnostics.find(d => d.message.includes('Self-closing non-void'));
      expect(err).toBeDefined();
      expect(err!.severity).toBe(DiagnosticSeverity.Error);
    });

    it('includes fix data in diagnostic', () => {
      const tree = parseText('<div/>');
      const diagnostics = getDiagnostics(tree);

      const err = diagnostics.find(d => d.message.includes('Self-closing non-void'));
      expect(err).toBeDefined();
      expect(err!.data).toBeDefined();
      const data = err!.data as { fix: unknown[]; fixDescription: string };
      expect(data.fix).toHaveLength(1);
      expect(data.fixDescription).toBe('Replace self-closing syntax with explicit close tag');
    });
  });

  describe('duplicate attributes', () => {
    it('detects plain duplicate attributes', () => {
      const tree = parseText('<div a="1" a="2"></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Duplicate attribute "a"')).toBe(true);
    });

    it('detects unconditional + conditional duplicate', () => {
      const tree = parseText('<div a="1" {{#foo}}a="2"{{/foo}}></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Duplicate attribute "a" (when foo is truthy)')).toBe(true);
    });

    it('detects duplicate across independent sections', () => {
      const tree = parseText('<div {{#foo}}a="1"{{/foo}} {{#bar}}a="2"{{/bar}}></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Duplicate attribute "a" (when foo is truthy, bar is truthy)')).toBe(true);
    });

    it('detects boolean attribute duplicate', () => {
      const tree = parseText('<input disabled {{#x}}disabled{{/x}}>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Duplicate attribute "disabled" (when x is truthy)')).toBe(true);
    });

    it('detects case-insensitive duplicates', () => {
      const tree = parseText('<div Class="a" class="b"></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message === 'Duplicate attribute "class"')).toBe(true);
    });

    it('allows mutually exclusive pair', () => {
      const tree = parseText('<div {{#x}}a="1"{{/x}} {{^x}}a="2"{{/x}}></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Duplicate attribute'))).toBe(false);
    });

    it('allows deeply nested exclusive on same variable', () => {
      const tree = parseText('<div {{#a}}{{#b}}x="1"{{/b}}{{/a}} {{^a}}x="2"{{/a}}></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Duplicate attribute'))).toBe(false);
    });

    it('does not flag bare interpolation', () => {
      const tree = parseText('<div {{attrs}} class="x"></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Duplicate attribute'))).toBe(false);
    });

    it('does not flag different attribute names', () => {
      const tree = parseText('<div a="1" b="2"></div>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Duplicate attribute'))).toBe(false);
    });

    it('reports as error severity', () => {
      const tree = parseText('<div a="1" a="2"></div>');
      const diagnostics = getDiagnostics(tree);

      const dup = diagnostics.find(d => d.message.includes('Duplicate attribute'));
      expect(dup).toBeDefined();
      expect(dup!.severity).toBe(DiagnosticSeverity.Error);
    });
  });

  describe('unescaped entities', () => {
    it('detects > in text content', () => {
      const tree = parseText('<p>a > b</p>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unescaped ">"'))).toBe(true);
    });

    it('detects bare & in text content', () => {
      const tree = parseText('<p>foo & bar</p>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unescaped "&"'))).toBe(true);
    });

    it('does not flag valid entities', () => {
      const tree = parseText('<p>&gt; &amp; &nbsp;</p>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unescaped'))).toBe(false);
    });

    it('does not flag > or & in attribute values', () => {
      const tree = parseText('<a title="a > b & c">link</a>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Unescaped'))).toBe(false);
    });

    it('reports as warning severity', () => {
      const tree = parseText('<p>a > b</p>');
      const diagnostics = getDiagnostics(tree);

      const unescaped = diagnostics.find(d => d.message.includes('Unescaped'));
      expect(unescaped).toBeDefined();
      expect(unescaped!.severity).toBe(DiagnosticSeverity.Warning);
    });

    it('includes fix data in diagnostic', () => {
      const tree = parseText('<p>a > b</p>');
      const diagnostics = getDiagnostics(tree);

      const unescaped = diagnostics.find(d => d.message.includes('Unescaped'));
      expect(unescaped).toBeDefined();
      expect(unescaped!.data).toBeDefined();
      const data = unescaped!.data as { fix: unknown[]; fixDescription: string };
      expect(data.fixDescription).toBe('Replace > with &gt;');
    });
  });

  describe('consecutive same-name sections', () => {
    it('detects consecutive same-name sections with Warning severity', () => {
      const tree = parseText('{{#x}}a{{/x}}{{#x}}b{{/x}}');
      const diagnostics = getDiagnostics(tree);

      const consecutive = diagnostics.find(d => d.message.includes('Consecutive duplicate section'));
      expect(consecutive).toBeDefined();
      expect(consecutive!.severity).toBe(DiagnosticSeverity.Warning);
    });

    it('does not flag different-type sections', () => {
      const tree = parseText('{{#x}}a{{/x}}{{^x}}b{{/x}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Consecutive duplicate section'))).toBe(false);
    });

    it('includes fix data in diagnostic', () => {
      const tree = parseText('{{#x}}a{{/x}}{{#x}}b{{/x}}');
      const diagnostics = getDiagnostics(tree);

      const consecutive = diagnostics.find(d => d.message.includes('Consecutive duplicate section'));
      expect(consecutive).toBeDefined();
      expect(consecutive!.data).toBeDefined();
      const data = consecutive!.data as { fix: unknown[]; fixDescription: string };
      expect(data.fix).toHaveLength(1);
      expect(data.fixDescription).toBe('Merge consecutive sections');
    });

    it('includes fix data for unquoted attribute', () => {
      const tree = parseText('<div class={{foo}}></div>');
      const diagnostics = getDiagnostics(tree);

      const unquoted = diagnostics.find(d => d.message.includes('Unquoted mustache'));
      expect(unquoted).toBeDefined();
      expect(unquoted!.data).toBeDefined();
      const data = unquoted!.data as { fix: unknown[]; fixDescription: string };
      expect(data.fixDescription).toBe('Wrap mustache value in quotes');
    });
  });

  describe('prefer mustache comments', () => {
    it('does not flag HTML comments by default', () => {
      const tree = parseText('<!-- a comment -->');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('HTML comment found'))).toBe(false);
    });

    it('flags HTML comments when rule is enabled', () => {
      const tree = parseText('<!-- a comment -->');
      const diagnostics = getDiagnostics(tree, { preferMustacheComments: 'warning' });

      expect(diagnostics.some(d => d.message.includes('HTML comment found'))).toBe(true);
    });

    it('uses configured severity', () => {
      const tree = parseText('<!-- a comment -->');
      const diagnostics = getDiagnostics(tree, { preferMustacheComments: 'error' });

      const err = diagnostics.find(d => d.message.includes('HTML comment found'));
      expect(err).toBeDefined();
      expect(err!.severity).toBe(DiagnosticSeverity.Error);
    });

    it('provides fix data', () => {
      const tree = parseText('<!-- a comment -->');
      const diagnostics = getDiagnostics(tree, { preferMustacheComments: 'warning' });

      const err = diagnostics.find(d => d.message.includes('HTML comment found'));
      expect(err).toBeDefined();
      expect(err!.data).toBeDefined();
      const data = err!.data as { fix: unknown[]; fixDescription: string };
      expect(data.fixDescription).toBe('Replace HTML comment with mustache comment');
    });

    it('handles multiline comments', () => {
      const tree = parseText('<!--\n  multi\n  line\n-->');
      const diagnostics = getDiagnostics(tree, { preferMustacheComments: 'warning' });

      expect(diagnostics.some(d => d.message.includes('HTML comment found'))).toBe(true);
    });

    it('handles empty comments', () => {
      const tree = parseText('<!---->');
      const diagnostics = getDiagnostics(tree, { preferMustacheComments: 'warning' });

      expect(diagnostics.some(d => d.message.includes('HTML comment found'))).toBe(true);
    });
  });

  describe('disable directives', () => {
    it('HTML comment disables a specific rule', () => {
      const tree = parseText('<!-- htmlmustache-disable selfClosingNonVoidTags -->\n<div/>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(false);
    });

    it('mustache comment disables a specific rule', () => {
      const tree = parseText('{{! htmlmustache-disable selfClosingNonVoidTags }}\n<div/>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(false);
    });

    it('multiple rules disabled with multiple comments', () => {
      const tree = parseText('<!-- htmlmustache-disable selfClosingNonVoidTags -->\n{{! htmlmustache-disable unescapedEntities }}\n<div/><p>a > b</p>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(false);
      expect(diagnostics.some(d => d.message.includes('Unescaped'))).toBe(false);
    });

    it('only the named rule is disabled, others still reported', () => {
      const tree = parseText('<!-- htmlmustache-disable unescapedEntities -->\n<div/><p>a > b</p>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(true);
      expect(diagnostics.some(d => d.message.includes('Unescaped'))).toBe(false);
    });

    it('unknown rule names are ignored', () => {
      const tree = parseText('<!-- htmlmustache-disable nonExistentRule -->\n<div/>');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(true);
    });

    it('disable comments themselves do not trigger preferMustacheComments', () => {
      const tree = parseText('<!-- htmlmustache-disable selfClosingNonVoidTags -->');
      const diagnostics = getDiagnostics(tree, { preferMustacheComments: 'warning' });

      expect(diagnostics.some(d => d.message.includes('HTML comment found'))).toBe(false);
    });
  });

  describe('rules config overrides', () => {
    it('disables unescaped entities when set to off', () => {
      const tree = parseText('<p>a > b</p>');
      const diagnostics = getDiagnostics(tree, { unescapedEntities: 'off' });

      expect(diagnostics.some(d => d.message.includes('Unescaped'))).toBe(false);
    });

    it('changes consecutive sections severity to error', () => {
      const tree = parseText('{{#x}}a{{/x}}{{#x}}b{{/x}}');
      const diagnostics = getDiagnostics(tree, { consecutiveDuplicateSections: 'error' });

      const consecutive = diagnostics.find(d => d.message.includes('Consecutive duplicate section'));
      expect(consecutive).toBeDefined();
      expect(consecutive!.severity).toBe(DiagnosticSeverity.Error);
    });

    it('disables self-closing non-void tag check', () => {
      const tree = parseText('<div/>');
      const diagnostics = getDiagnostics(tree, { selfClosingNonVoidTags: 'off' });

      expect(diagnostics.some(d => d.message.includes('Self-closing non-void'))).toBe(false);
    });
  });
});
