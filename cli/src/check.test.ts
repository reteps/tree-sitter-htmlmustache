import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectErrors, formatError, formatSummary, resolveFiles } from './check';
import { initializeParser, parseDocument } from './wasm';

beforeAll(async () => {
  await initializeParser();
});

function parse(source: string) {
  return parseDocument(source);
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

  it('allows erroneous end tags inside mustache sections (conditional closing tags)', () => {
    const tree = parse('{{#inline}}</span>{{/inline}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows erroneous end tags inside inverted mustache sections', () => {
    const tree = parse('{{^inline}}</span>{{/inline}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('still detects erroneous end tags outside mustache sections', () => {
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

describe('resolveFiles', () => {
  let tempDir: string;
  let origCwd: string;

  beforeAll(() => {
    origCwd = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolvefiles-test-'));

    // Create test files
    fs.writeFileSync(path.join(tempDir, 'a.mustache'), '<div>a</div>');
    fs.writeFileSync(path.join(tempDir, 'b.hbs'), '<div>b</div>');
    fs.mkdirSync(path.join(tempDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'sub', 'c.mustache'), '<div>c</div>');

    // Create vendor dir with a file
    fs.mkdirSync(path.join(tempDir, 'vendor'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'vendor', 'd.mustache'), '<div>d</div>');

    // Create node_modules dir with a file
    fs.mkdirSync(path.join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg', 'e.mustache'), '<div>e</div>');

    // Create .git dir with a file
    fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.git', 'f.mustache'), '<div>f</div>');

    process.chdir(tempDir);
  });

  afterAll(() => {
    process.chdir(origCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses CLI patterns when provided', () => {
    const { files } = resolveFiles(['*.mustache']);
    expect(files.map(f => path.basename(f))).toEqual(['a.mustache']);
  });

  it('uses config include when no CLI patterns', () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ include: ['**/*.mustache'] }),
    );
    const { files } = resolveFiles([]);
    const basenames = files.map(f => path.basename(f));
    expect(basenames).toContain('a.mustache');
    expect(basenames).toContain('c.mustache');
  });

  it('excludes node_modules by default', () => {
    const { files } = resolveFiles([]);
    const basenames = files.map(f => path.basename(f));
    expect(basenames).not.toContain('e.mustache');
  });

  it('excludes .git by default', () => {
    const { files } = resolveFiles([]);
    const basenames = files.map(f => path.basename(f));
    expect(basenames).not.toContain('f.mustache');
  });

  it('applies config exclude patterns', () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ include: ['**/*.mustache'], exclude: ['vendor/**'] }),
    );
    const { files } = resolveFiles([]);
    const basenames = files.map(f => path.basename(f));
    expect(basenames).toContain('a.mustache');
    expect(basenames).not.toContain('d.mustache');
  });

  it('applies exclude even with CLI patterns', () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ exclude: ['vendor/**'] }),
    );
    const { files } = resolveFiles(['**/*.mustache']);
    const basenames = files.map(f => path.basename(f));
    expect(basenames).toContain('a.mustache');
    expect(basenames).not.toContain('d.mustache');
  });

  it('returns empty files and null config when no patterns and no config', () => {
    // Remove config file
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

    const { files, config } = resolveFiles([]);
    expect(files).toEqual([]);
    expect(config).toBeNull();
  });

  it('returns empty files when config has no include and no CLI patterns', () => {
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      JSON.stringify({ printWidth: 100 }),
    );
    const { files, config } = resolveFiles([]);
    expect(files).toEqual([]);
    expect(config).not.toBeNull();
    expect(config!.include).toBeUndefined();
  });
});
