import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { CustomCodeTagConfig, CustomCodeTagIndentMode } from './customCodeTags';

export interface HtmlMustacheConfig {
  printWidth?: number;
  indentSize?: number;
  mustacheSpaces?: boolean;
  customCodeTags?: CustomCodeTagConfig[];
  include?: string[];
  exclude?: string[];
}

const CONFIG_FILENAME = '.htmlmustache.jsonc';

/**
 * Strip // line comments, block comments, and trailing commas from JSONC text,
 * then JSON.parse(). Preserves comments inside strings.
 */
export function parseJsonc(text: string): unknown {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal — copy verbatim
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          result += text[i] + (text[i + 1] ?? '');
          i += 2;
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
      continue;
    }
    // Line comment
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; // skip */
      continue;
    }
    result += text[i];
    i++;
  }

  // Remove trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(result);
}

/**
 * Walk up directories from `startDir` looking for `.htmlmustache.jsonc`.
 * Returns the absolute path if found, or null.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // not found, keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
}

const VALID_INDENT_MODES = new Set<string>(['never', 'always', 'attribute']);

/**
 * Validate a raw parsed config object and return a typed HtmlMustacheConfig.
 * Ignores unknown keys and invalid values.
 */
export function validateConfig(raw: unknown): HtmlMustacheConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const config: HtmlMustacheConfig = {};

  if (typeof obj.printWidth === 'number' && obj.printWidth > 0) {
    config.printWidth = obj.printWidth;
  }
  if (typeof obj.indentSize === 'number' && obj.indentSize > 0) {
    config.indentSize = obj.indentSize;
  }
  if (typeof obj.mustacheSpaces === 'boolean') {
    config.mustacheSpaces = obj.mustacheSpaces;
  }

  if (Array.isArray(obj.include)) {
    const items = obj.include.filter((s: unknown) => typeof s === 'string' && s.length > 0);
    if (items.length > 0) config.include = items as string[];
  }
  if (Array.isArray(obj.exclude)) {
    const items = obj.exclude.filter((s: unknown) => typeof s === 'string' && s.length > 0);
    if (items.length > 0) config.exclude = items as string[];
  }

  if (Array.isArray(obj.customCodeTags)) {
    const tags: CustomCodeTagConfig[] = [];
    for (const entry of obj.customCodeTags) {
      if (entry && typeof entry === 'object' && 'name' in entry) {
        const e = entry as Record<string, unknown>;
        if (typeof e.name !== 'string' || e.name.length === 0) continue;
        const tag: CustomCodeTagConfig = { name: e.name };
        if (typeof e.languageAttribute === 'string') tag.languageAttribute = e.languageAttribute;
        if (e.languageMap && typeof e.languageMap === 'object' && !Array.isArray(e.languageMap)) {
          tag.languageMap = e.languageMap as Record<string, string>;
        }
        if (typeof e.languageDefault === 'string') tag.languageDefault = e.languageDefault;
        if (typeof e.indent === 'string' && VALID_INDENT_MODES.has(e.indent)) {
          tag.indent = e.indent as CustomCodeTagIndentMode;
        }
        if (typeof e.indentAttribute === 'string') tag.indentAttribute = e.indentAttribute;
        tags.push(tag);
      }
    }
    if (tags.length > 0) config.customCodeTags = tags;
  }

  return config;
}

/**
 * Load config file for a file:// URI. Returns the parsed config or null.
 */
export function loadConfigFile(uri: string): HtmlMustacheConfig | null {
  if (!uri.startsWith('file://')) return null;
  try {
    const filePath = fileURLToPath(uri);
    return loadConfigFileForPath(filePath);
  } catch {
    return null;
  }
}

/**
 * Load config file for a filesystem path. Returns the parsed config or null.
 */
export function loadConfigFileForPath(filePath: string): HtmlMustacheConfig | null {
  const dir = path.dirname(path.resolve(filePath));
  const configPath = findConfigFile(dir);
  if (!configPath) return null;
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const raw = parseJsonc(text);
    return validateConfig(raw);
  } catch {
    return null;
  }
}
