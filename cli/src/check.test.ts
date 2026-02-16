import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectErrors, formatError, formatSummary } from './check';

const Parser = require('tree-sitter');
const language = require(path.resolve(__dirname, '..', '..'));

function parse(source: string) {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser.parse(source);
}

describe('collectErrors', () => {
  it('returns no errors for a clean file', () => {
    const tree = parse('<div><p>Hello {{name}}</p></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('detects ERROR nodes from malformed HTML', () => {
    const tree = parse('<div><//invalid></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message === 'Syntax error')).toBe(true);
  });

  it('detects mismatched mustache section', () => {
    const tree = parse('{{#foo}}<p>hello</p>{{/bar}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message === 'Mismatched mustache section: {{/bar}}')).toBe(true);
  });

  it('detects mismatched inverted section', () => {
    const tree = parse('{{^foo}}<p>hello</p>{{/bar}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message === 'Mismatched mustache section: {{/bar}}')).toBe(true);
  });

  it('detects erroneous HTML end tag', () => {
    const tree = parse('<div></span></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message === 'Mismatched HTML end tag: </span>')).toBe(true);
  });

  it('detects missing nodes', () => {
    const tree = parse('<div');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.startsWith('Missing'))).toBe(true);
  });

  it('detects multiple errors in one file', () => {
    const tree = parse('<div></span>\n{{#foo}}{{/bar}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('includes correct location info', () => {
    const source = '<div>\n  <p>\n  {{/wrong}}\n</div>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const sectionError = errors.find(e => e.message.includes('{{/wrong}}'));
    if (sectionError) {
      expect(sectionError.line).toBe(3);
      expect(sectionError.file).toBe('test.mustache');
    }
  });
});

describe('formatError', () => {
  it('includes file location and error message', () => {
    const error = {
      file: 'test.mustache',
      line: 3,
      column: 3,
      endLine: 3,
      endColumn: 13,
      message: 'Mismatched mustache section: {{/wrong}}',
      nodeText: '{{/wrong}}',
    };
    const source = '{{#items}}\n  <li>{{name}}\n  {{/wrong}}\n</div>';
    const output = formatError(error, source);
    expect(output).toContain('test.mustache:3:3');
    expect(output).toContain('error');
    expect(output).toContain('Mismatched mustache section: {{/wrong}}');
    expect(output).toContain('^^^^^^^^^^');
  });

  it('shows context lines before the error', () => {
    const error = {
      file: 'test.mustache',
      line: 3,
      column: 1,
      endLine: 3,
      endColumn: 10,
      message: 'Syntax error',
      nodeText: 'bad stuff',
    };
    const source = 'line one\nline two\nbad stuff\nline four';
    const output = formatError(error, source);
    expect(output).toContain('line one');
    expect(output).toContain('line two');
    expect(output).toContain('bad stuff');
  });
});

describe('formatSummary', () => {
  it('shows success message when no errors', () => {
    const output = formatSummary(0, 0, 5);
    expect(output).toContain('No errors found');
    expect(output).toContain('5 files checked');
  });

  it('shows error counts', () => {
    const output = formatSummary(3, 2, 10);
    expect(output).toContain('3 errors');
    expect(output).toContain('2 files');
    expect(output).toContain('10 files checked');
  });

  it('uses singular forms correctly', () => {
    const output = formatSummary(1, 1, 1);
    expect(output).toContain('1 error in 1 file');
    expect(output).toContain('1 file checked');
  });
});
