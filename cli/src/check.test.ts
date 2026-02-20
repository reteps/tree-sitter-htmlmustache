import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectErrors, formatError, formatSummary, resolveFiles, applyFixes } from './check';
import type { CheckError } from './check';
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

  it('detects orphan erroneous end tags inside mustache sections', () => {
    const tree = parse('{{#inline}}</span>{{/inline}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('detects orphan erroneous end tags inside inverted mustache sections', () => {
    const tree = parse('{{^inline}}</span>{{/inline}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
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

describe('HTML balance checker', () => {
  it('allows same-name section open/close pairs (only warning for consecutive)', () => {
    const tree = parse('{{#s}}<div>{{/s}} {{#s}}</div>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    // The only error should be the consecutive section warning
    expect(errors.every(e => e.severity === 'warning')).toBe(true);
  });

  it('detects inverted section open/close mismatch with path info', () => {
    const tree = parse('{{#s}}<div>{{/s}} {{^s}}</div>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    // Errors should include the failing condition
    expect(errors.some(e => e.message.includes('when s is'))).toBe(true);
  });

  it('allows if/else balanced patterns', () => {
    const tree = parse('{{#s}}<span>{{/s}}{{^s}}<div>{{/s}} {{#s}}</span>{{/s}}{{^s}}</div>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('detects if/else swapped close tags with path info', () => {
    const tree = parse('{{#s}}<span>{{/s}}{{^s}}<div>{{/s}} {{#s}}</div>{{/s}}{{^s}}</span>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.includes('when s is'))).toBe(true);
  });

  it('detects standalone orphan close in section with path info', () => {
    const tree = parse('{{#s}}</span>{{/s}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.includes('when s is truthy'))).toBe(true);
  });

  it('reports no path info for unconditional mismatches', () => {
    const tree = parse('<div></span></div>');
    const errors = collectErrors(tree, 'test.mustache');
    const mismatch = errors.find(e => e.message.includes('</span>'));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toBe('Mismatched HTML end tag: </span>');
    expect(mismatch!.message).not.toContain('when');
  });

  it('detects mismatch in nested conditional with else fallback', () => {
    // if start: <div>, else: <span>
    // if baz: (if start: </div>, else: </span>), else: </span>
    //
    // start=T baz=T → [OPEN(div), CLOSE(div)] balanced
    // start=F baz=T → [OPEN(span), CLOSE(span)] balanced
    // start=F baz=F → [OPEN(span), CLOSE(span)] balanced
    // start=T baz=F → [OPEN(div), CLOSE(span)] MISMATCH
    const source = [
      '{{#start}}<div>{{/start}}',
      '{{^start}}<span>{{/start}}',
      '{{#baz}}',
      '  {{#start}}</div>{{/start}}',
      '  {{^start}}</span>{{/start}}',
      '{{/baz}}',
      '{{^baz}}',
      '  </span>',
      '{{/baz}}',
    ].join('\n');
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.length).toBeGreaterThan(0);
    const mismatch = errors.find(e => e.message.includes('Mismatched HTML end tag'));
    expect(mismatch).toBeDefined();
    expect(mismatch!.message).toContain('</span>');
    expect(mismatch!.message).toContain('start is truthy');
    expect(mismatch!.message).toContain('baz is falsy');
  });

  it('detects nested same-section even with balanced inner tags', () => {
    const tree = parse('{{#items}}<div>{{#items}}<span></span>{{/items}}</div>{{/items}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Nested duplicate section'))).toBe(true);
  });

  it('detects if/else open with same-type close (button/span bug)', () => {
    // {{#s}} opens <button>, {{^s}} opens <span>
    // but both closing tags are in {{#s}} — the second should be {{^s}}
    const source = [
      '{{#s}}<button><i></i>{{/s}}',
      '{{^s}}<span>{{/s}}',
      'text',
      '{{#s}}</button>{{/s}}',
      '{{#s}}</span>{{/s}}',
    ].join('\n');
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    // Should detect errors — </span> mismatched on truthy path, <span> unclosed on falsy path
    const nonWarnings = errors.filter(e => e.severity !== 'warning');
    expect(nonWarnings.length).toBeGreaterThan(0);
    // Balance checker should include path condition info
    expect(nonWarnings.some(e => e.message.includes('when s is'))).toBe(true);
  });

  it('detects consecutive sections in button/span pattern', () => {
    // Isolated test: two consecutive {{#s}} sections with whitespace gap
    const source = '{{#s}}</button>{{/s}}\n{{#s}}</span>{{/s}}';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section') && e.severity === 'warning')).toBe(true);
  });
});

describe('Unclosed tag detection', () => {
  it('detects unclosed canvas tag', () => {
    const tree = parse('<div><canvas></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message === 'Unclosed HTML tag: <canvas>')).toBe(true);
  });

  it('allows properly closed canvas tag', () => {
    const tree = parse('<div><canvas></canvas></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows void elements without close tags', () => {
    const tree = parse('<div><br><hr><img src="x"><input type="text"></div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows optional end tag elements', () => {
    const tree = parse('<ul><li>one<li>two</ul>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('allows p implicitly closed by block element', () => {
    const tree = parse('<p>text<div>block</div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors).toEqual([]);
  });

  it('detects unclosed span inside div', () => {
    const tree = parse('<div><span>text</div>');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message === 'Unclosed HTML tag: <span>')).toBe(true);
  });

  it('detects unclosed div at end of document', () => {
    const tree = parse('<div>content');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message === 'Unclosed HTML tag: <div>')).toBe(true);
  });
});

describe('Mustache lint checks', () => {
  describe('nested same-name sections', () => {
    it('detects nested duplicate section', () => {
      const tree = parse('{{#x}}{{#x}}inner{{/x}}{{/x}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Nested duplicate section') && e.message.includes('{{#x}}'))).toBe(true);
    });

    it('allows non-nested same-name sections (sequential)', () => {
      const tree = parse('{{#x}}first{{/x}}{{#x}}second{{/x}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Nested duplicate section'))).toBe(false);
    });

    it('detects deeply nested duplicate', () => {
      const tree = parse('{{#a}}{{#b}}{{#a}}deep{{/a}}{{/b}}{{/a}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Nested duplicate section') && e.message.includes('{{#a}}'))).toBe(true);
    });

    it('allows different-name nested sections', () => {
      const tree = parse('{{#a}}{{#b}}inner{{/b}}{{/a}}');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Nested duplicate section'))).toBe(false);
    });
  });

  describe('unquoted mustache attribute value', () => {
    it('detects unquoted mustache in attribute', () => {
      const tree = parse('<div class={{foo}}></div>');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Unquoted mustache attribute value'))).toBe(true);
    });

    it('allows quoted mustache in attribute', () => {
      const tree = parse('<div class="{{foo}}"></div>');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Unquoted mustache attribute value'))).toBe(false);
    });

    it('does not flag standalone mustache in tag', () => {
      const tree = parse('<div {{attrs}}></div>');
      const errors = collectErrors(tree, 'test.mustache');
      expect(errors.some(e => e.message.includes('Unquoted mustache attribute value'))).toBe(false);
    });

    it('detects unquoted mustache in multiple attributes', () => {
      const tree = parse('<div class={{foo}} id={{bar}}></div>');
      const errors = collectErrors(tree, 'test.mustache');
      const unquotedErrors = errors.filter(e => e.message.includes('Unquoted mustache attribute value'));
      expect(unquotedErrors.length).toBe(2);
    });
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

describe('consecutive same-name sections', () => {
  it('detects consecutive same-type same-name sections', () => {
    const tree = parse('{{#x}}a{{/x}}{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section') && e.severity === 'warning')).toBe(true);
  });

  it('detects consecutive inverted sections', () => {
    const tree = parse('{{^x}}a{{/x}}{{^x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section') && e.message.includes('{{^x}}'))).toBe(true);
  });

  it('does not flag different-type sections', () => {
    const tree = parse('{{#x}}a{{/x}}{{^x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section'))).toBe(false);
  });

  it('does not flag different-name sections', () => {
    const tree = parse('{{#x}}a{{/x}}{{#y}}b{{/y}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section'))).toBe(false);
  });

  it('flags with whitespace-only gap', () => {
    const tree = parse('{{#x}}a{{/x}}  \n  {{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section'))).toBe(true);
  });

  it('does not flag with non-whitespace between sections', () => {
    const tree = parse('{{#x}}a{{/x}}text{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    expect(errors.some(e => e.message.includes('Consecutive duplicate section'))).toBe(false);
  });

  it('severity is warning, not error', () => {
    const tree = parse('{{^foo}}a{{/foo}}{{^foo}}b{{/foo}}');
    const errors = collectErrors(tree, 'test.mustache');
    const consecutive = errors.find(e => e.message.includes('Consecutive duplicate section'));
    expect(consecutive).toBeDefined();
    expect(consecutive!.severity).toBe('warning');
  });

  it('provides fix data', () => {
    const tree = parse('{{#x}}a{{/x}}{{#x}}b{{/x}}');
    const errors = collectErrors(tree, 'test.mustache');
    const consecutive = errors.find(e => e.message.includes('Consecutive duplicate section'));
    expect(consecutive).toBeDefined();
    expect(consecutive!.fix).toBeDefined();
    expect(consecutive!.fix!.length).toBe(1);
    expect(consecutive!.fixDescription).toBe('Merge consecutive sections');
  });
});

describe('applyFixes', () => {
  it('applies unquoted attribute fix', () => {
    const source = '<div class={{foo}}></div>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('<div class="{{foo}}"></div>');
  });

  it('applies consecutive section merge fix', () => {
    const source = '{{#x}}a{{/x}}{{#x}}b{{/x}}';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe('{{#x}}ab{{/x}}');
  });

  it('applies multiple fixes in one file', () => {
    const source = '<div size={{s}}></div>\n{{^m}}a{{/m}}{{^m}}b{{/m}}';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toContain('"{{s}}"');
    expect(result).toContain('{{^m}}ab{{/m}}');
  });

  it('returns source unchanged when no fixes', () => {
    const source = '<div class="ok">text</div>';
    const tree = parse(source);
    const errors = collectErrors(tree, 'test.mustache');
    const result = applyFixes(source, errors);
    expect(result).toBe(source);
  });
});

describe('formatSummary with warnings', () => {
  it('shows only warnings', () => {
    const output = formatSummary(0, 1, 5, 2);
    expect(output).toContain('2 warnings');
    expect(output).not.toContain('error');
  });

  it('shows both errors and warnings', () => {
    const output = formatSummary(3, 2, 10, 1);
    expect(output).toContain('3 errors');
    expect(output).toContain('1 warning');
  });
});
