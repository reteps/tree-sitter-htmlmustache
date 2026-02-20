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

    it('allows same-name section open/close pairs', () => {
      const tree = parseText('{{#s}}<div>{{/s}} {{#s}}</div>{{/s}}');
      const diagnostics = getDiagnostics(tree);

      expect(diagnostics.length).toBe(0);
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
});
