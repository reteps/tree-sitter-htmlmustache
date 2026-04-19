import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { CustomCodeTagConfig, CustomCodeTagIndentMode } from './customCodeTags.js';
import type { CSSDisplay } from './formatting/classifier.js';
import { KNOWN_RULE_NAMES } from './ruleMetadata.js';

const VALID_CSS_DISPLAY_VALUES = new Set<string>([
  'block', 'inline', 'inline-block', 'table-row', 'table-cell', 'table',
  'table-row-group', 'table-header-group', 'table-footer-group', 'table-column',
  'table-column-group', 'table-caption', 'list-item', 'ruby', 'ruby-base',
  'ruby-text', 'none',
]);

export type RuleSeverity = 'error' | 'warning' | 'off';

export interface ElementContentTooLongOptions {
  elements: Array<{ tag: string; maxBytes: number }>;
}

export type RuleEntry = RuleSeverity | { severity: RuleSeverity };
export type RuleEntryWithOptions<TOptions> = RuleSeverity | ({ severity: RuleSeverity } & TOptions);

export interface RulesConfig {
  nestedDuplicateSections?: RuleEntry;
  unquotedMustacheAttributes?: RuleEntry;
  consecutiveDuplicateSections?: RuleEntry;
  selfClosingNonVoidTags?: RuleEntry;
  duplicateAttributes?: RuleEntry;
  unescapedEntities?: RuleEntry;
  preferMustacheComments?: RuleEntry;
  unrecognizedHtmlTags?: RuleEntry;
  elementContentTooLong?: RuleEntryWithOptions<ElementContentTooLongOptions>;
}

const VALID_RULE_SEVERITIES = new Set<string>(['error', 'warning', 'off']);

function parseElementContentTooLongOptions(raw: Record<string, unknown>): ElementContentTooLongOptions | null {
  if (!Array.isArray(raw.elements)) return null;
  const elements: ElementContentTooLongOptions['elements'] = [];
  for (const entry of raw.elements) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.tag !== 'string' || e.tag.length === 0) continue;
    if (typeof e.maxBytes !== 'number' || !Number.isFinite(e.maxBytes) || e.maxBytes < 0) continue;
    elements.push({ tag: e.tag, maxBytes: e.maxBytes });
  }
  return { elements };
}

const OPTION_PARSERS: Partial<Record<keyof RulesConfig, (raw: Record<string, unknown>) => object | null>> = {
  elementContentTooLong: parseElementContentTooLongOptions,
};

function parseRuleEntry(
  key: keyof RulesConfig,
  value: unknown,
): RuleSeverity | { severity: RuleSeverity; [k: string]: unknown } | null {
  if (typeof value === 'string') {
    return VALID_RULE_SEVERITIES.has(value) ? (value as RuleSeverity) : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.severity !== 'string' || !VALID_RULE_SEVERITIES.has(obj.severity)) return null;
  const severity = obj.severity as RuleSeverity;
  const parser = OPTION_PARSERS[key];
  if (!parser) return { severity };
  const options = parser(obj);
  if (!options) return { severity };
  return { severity, ...options };
}

export interface CustomRule {
  id: string;
  selector: string;
  message: string;
  severity?: RuleSeverity;
}

export interface NoBreakDelimiter {
  start: string;
  end: string;
}

export interface HtmlMustacheConfig {
  printWidth?: number;
  indentSize?: number;
  mustacheSpaces?: boolean;
  noBreakDelimiters?: NoBreakDelimiter[];
  customTags?: CustomCodeTagConfig[];
  include?: string[];
  exclude?: string[];
  rules?: RulesConfig;
  customRules?: CustomRule[];
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
 * Parse an array of custom tag entries from raw config.
 */
function parseCustomTagArray(arr: unknown): CustomCodeTagConfig[] {
  if (!Array.isArray(arr)) return [];
  const tags: CustomCodeTagConfig[] = [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object' && 'name' in entry) {
      const e = entry as Record<string, unknown>;
      if (typeof e.name !== 'string' || e.name.length === 0) continue;
      const tag: CustomCodeTagConfig = { name: e.name };
      if (typeof e.display === 'string' && VALID_CSS_DISPLAY_VALUES.has(e.display)) {
        tag.display = e.display as CSSDisplay;
      }
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
  return tags;
}

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

  if (Array.isArray(obj.noBreakDelimiters)) {
    const items: NoBreakDelimiter[] = [];
    for (const entry of obj.noBreakDelimiters) {
      if (
        entry && typeof entry === 'object' && !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).start === 'string' &&
        (entry as Record<string, unknown>).start !== '' &&
        typeof (entry as Record<string, unknown>).end === 'string' &&
        (entry as Record<string, unknown>).end !== ''
      ) {
        items.push({ start: (entry as Record<string, unknown>).start as string, end: (entry as Record<string, unknown>).end as string });
      }
    }
    if (items.length > 0) config.noBreakDelimiters = items;
  }

  if (Array.isArray(obj.include)) {
    const items = obj.include.filter((s: unknown) => typeof s === 'string' && s.length > 0);
    if (items.length > 0) config.include = items as string[];
  }
  if (Array.isArray(obj.exclude)) {
    const items = obj.exclude.filter((s: unknown) => typeof s === 'string' && s.length > 0);
    if (items.length > 0) config.exclude = items as string[];
  }

  // Parse both customCodeTags (legacy key) and customTags, merge into customTags.
  // customTags entries override customCodeTags entries by name.
  const parsedCodeTags = parseCustomTagArray(obj.customCodeTags);
  const parsedCustomTags = parseCustomTagArray(obj.customTags);

  if (parsedCodeTags.length > 0 || parsedCustomTags.length > 0) {
    const mergedMap = new Map<string, CustomCodeTagConfig>();
    for (const tag of parsedCodeTags) {
      mergedMap.set(tag.name.toLowerCase(), tag);
    }
    for (const tag of parsedCustomTags) {
      mergedMap.set(tag.name.toLowerCase(), tag);
    }
    config.customTags = Array.from(mergedMap.values());
  }

  if (obj.rules && typeof obj.rules === 'object' && !Array.isArray(obj.rules)) {
    const rawRules = obj.rules as Record<string, unknown>;
    const rules: RulesConfig = {};
    let hasRules = false;
    for (const [key, value] of Object.entries(rawRules)) {
      if (!KNOWN_RULE_NAMES.has(key)) continue;
      const entry = parseRuleEntry(key as keyof RulesConfig, value);
      if (entry === null) continue;
      (rules as Record<string, unknown>)[key] = entry;
      hasRules = true;
    }
    if (hasRules) config.rules = rules;
  }

  if (Array.isArray(obj.customRules)) {
    const rules: CustomRule[] = [];
    for (const entry of obj.customRules) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.id !== 'string' || e.id.length === 0) continue;
      if (typeof e.selector !== 'string' || e.selector.length === 0) continue;
      if (typeof e.message !== 'string' || e.message.length === 0) continue;
      const rule: CustomRule = { id: e.id, selector: e.selector, message: e.message };
      if (typeof e.severity === 'string' && VALID_RULE_SEVERITIES.has(e.severity)) {
        rule.severity = e.severity as RuleSeverity;
      }
      rules.push(rule);
    }
    if (rules.length > 0) config.customRules = rules;
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
