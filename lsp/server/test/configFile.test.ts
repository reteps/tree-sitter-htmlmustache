import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';

import { parseJsonc, findConfigFile, validateConfig, loadConfigFile, loadConfigFileForPath } from '../src/configFile';

describe('parseJsonc', () => {
  it('parses plain JSON', () => {
    expect(parseJsonc('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips line comments', () => {
    const input = `{
      // this is a comment
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it('strips block comments', () => {
    const input = `{
      /* block comment */
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it('strips multi-line block comments', () => {
    const input = `{
      /*
       * multi-line
       * block comment
       */
      "a": 1
    }`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it('removes trailing commas before }', () => {
    const input = '{"a": 1, "b": 2,}';
    expect(parseJsonc(input)).toEqual({ a: 1, b: 2 });
  });

  it('removes trailing commas before ]', () => {
    const input = '{"a": [1, 2, 3,]}';
    expect(parseJsonc(input)).toEqual({ a: [1, 2, 3] });
  });

  it('preserves comments inside strings', () => {
    const input = '{"a": "hello // world", "b": "foo /* bar */"}';
    const result = parseJsonc(input) as Record<string, string>;
    expect(result.a).toBe('hello // world');
    expect(result.b).toBe('foo /* bar */');
  });

  it('handles escaped quotes in strings', () => {
    const input = '{"a": "he said \\"hello\\""}';
    const result = parseJsonc(input) as Record<string, string>;
    expect(result.a).toBe('he said "hello"');
  });

  it('parses a realistic config', () => {
    const input = `{
      // Formatting
      "printWidth": 100,
      "indentSize": 4,
      "mustacheSpaces": true,

      // Custom code tags
      "customCodeTags": [
        {
          "name": "pl-code",
          "languageAttribute": "language",
          "languageMap": { "python3": "python" },
        },
      ],
    }`;
    const result = parseJsonc(input) as Record<string, unknown>;
    expect(result.printWidth).toBe(100);
    expect(result.indentSize).toBe(4);
    expect(result.mustacheSpaces).toBe(true);
    expect(result.customCodeTags).toHaveLength(1);
  });
});

describe('validateConfig', () => {
  it('returns empty config for null', () => {
    expect(validateConfig(null)).toEqual({});
  });

  it('returns empty config for non-object', () => {
    expect(validateConfig('string')).toEqual({});
    expect(validateConfig(42)).toEqual({});
  });

  it('returns empty config for array', () => {
    expect(validateConfig([1, 2])).toEqual({});
  });

  it('validates printWidth', () => {
    expect(validateConfig({ printWidth: 100 })).toEqual({ printWidth: 100 });
    expect(validateConfig({ printWidth: 0 })).toEqual({});
    expect(validateConfig({ printWidth: -1 })).toEqual({});
    expect(validateConfig({ printWidth: 'string' })).toEqual({});
  });

  it('validates indentSize', () => {
    expect(validateConfig({ indentSize: 4 })).toEqual({ indentSize: 4 });
    expect(validateConfig({ indentSize: 0 })).toEqual({});
    expect(validateConfig({ indentSize: 'string' })).toEqual({});
  });

  it('validates mustacheSpaces', () => {
    expect(validateConfig({ mustacheSpaces: true })).toEqual({ mustacheSpaces: true });
    expect(validateConfig({ mustacheSpaces: 'yes' })).toEqual({});
  });

  it('ignores unknown keys', () => {
    expect(validateConfig({ unknownKey: 'value', printWidth: 80 })).toEqual({ printWidth: 80 });
  });

  it('validates customCodeTags', () => {
    const result = validateConfig({
      customCodeTags: [
        { name: 'pl-code', languageAttribute: 'language', indent: 'always' },
        { name: '' }, // invalid: empty name
        { noName: true }, // invalid: no name
        'not-an-object', // invalid
      ],
    });
    expect(result.customCodeTags).toHaveLength(1);
    expect(result.customCodeTags![0].name).toBe('pl-code');
    expect(result.customCodeTags![0].languageAttribute).toBe('language');
    expect(result.customCodeTags![0].indent).toBe('always');
  });

  it('validates customCodeTags indent mode', () => {
    const result = validateConfig({
      customCodeTags: [
        { name: 'tag1', indent: 'never' },
        { name: 'tag2', indent: 'invalid' },
        { name: 'tag3', indent: 'attribute', indentAttribute: 'src' },
      ],
    });
    expect(result.customCodeTags).toHaveLength(3);
    expect(result.customCodeTags![0].indent).toBe('never');
    expect(result.customCodeTags![1].indent).toBeUndefined();
    expect(result.customCodeTags![2].indent).toBe('attribute');
    expect(result.customCodeTags![2].indentAttribute).toBe('src');
  });

  it('validates include array', () => {
    expect(validateConfig({ include: ['**/*.mustache', '**/*.hbs'] })).toEqual({
      include: ['**/*.mustache', '**/*.hbs'],
    });
  });

  it('filters invalid include entries', () => {
    const result = validateConfig({ include: ['**/*.mustache', '', 42, null, '**/*.hbs'] });
    expect(result.include).toEqual(['**/*.mustache', '**/*.hbs']);
  });

  it('omits include when all entries are invalid', () => {
    expect(validateConfig({ include: ['', 42, null] })).toEqual({});
  });

  it('ignores non-array include', () => {
    expect(validateConfig({ include: '**/*.mustache' })).toEqual({});
  });

  it('validates exclude array', () => {
    expect(validateConfig({ exclude: ['**/vendor/**'] })).toEqual({
      exclude: ['**/vendor/**'],
    });
  });

  it('filters invalid exclude entries', () => {
    const result = validateConfig({ exclude: ['**/vendor/**', '', 123] });
    expect(result.exclude).toEqual(['**/vendor/**']);
  });

  it('omits exclude when all entries are invalid', () => {
    expect(validateConfig({ exclude: [''] })).toEqual({});
  });

  it('ignores non-array exclude', () => {
    expect(validateConfig({ exclude: '**/vendor/**' })).toEqual({});
  });
});

describe('findConfigFile', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'configfile-test-'));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds config file in same directory', () => {
    const configPath = path.join(tempDir, '.htmlmustache.jsonc');
    fs.writeFileSync(configPath, '{}');
    expect(findConfigFile(tempDir)).toBe(configPath);
  });

  it('finds config file in parent directory', () => {
    const subDir = path.join(tempDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    // Config file was created in tempDir in the previous test
    expect(findConfigFile(subDir)).toBe(path.join(tempDir, '.htmlmustache.jsonc'));
  });

  it('returns null when no config file exists', () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-'));
    try {
      expect(findConfigFile(isolated)).toBeNull();
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe('loadConfigFile', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadconfig-test-'));
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      `{
        // My config
        "printWidth": 120,
        "mustacheSpaces": true,
      }`
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads config from file:// URI', () => {
    const uri = pathToFileURL(path.join(tempDir, 'test.mustache')).href;
    const config = loadConfigFile(uri);
    expect(config).not.toBeNull();
    expect(config!.printWidth).toBe(120);
    expect(config!.mustacheSpaces).toBe(true);
  });

  it('returns null for non-file URI', () => {
    expect(loadConfigFile('untitled:Untitled-1')).toBeNull();
  });
});

describe('loadConfigFileForPath', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loadconfigpath-test-'));
    fs.writeFileSync(
      path.join(tempDir, '.htmlmustache.jsonc'),
      `{ "indentSize": 8 }`
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads config for a file path', () => {
    const config = loadConfigFileForPath(path.join(tempDir, 'test.mustache'));
    expect(config).not.toBeNull();
    expect(config!.indentSize).toBe(8);
  });

  it('returns null when no config exists', () => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-path-'));
    try {
      expect(loadConfigFileForPath(path.join(isolated, 'test.mustache'))).toBeNull();
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});
