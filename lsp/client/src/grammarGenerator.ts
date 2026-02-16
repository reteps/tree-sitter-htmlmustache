import * as crypto from 'crypto';

export interface CustomCodeTagConfig {
  name: string;
  syntaxAttribute?: string;
  languageMap?: Record<string, string>;
  defaultLanguage?: string;
}

interface LanguageEntry {
  scope: string;
  languageId: string;
}

const LANGUAGE_MAP: Record<string, LanguageEntry> = {
  python: { scope: 'source.python', languageId: 'python' },
  javascript: { scope: 'source.js', languageId: 'javascript' },
  typescript: { scope: 'source.ts', languageId: 'typescript' },
  c: { scope: 'source.c', languageId: 'c' },
  cpp: { scope: 'source.cpp', languageId: 'cpp' },
  java: { scope: 'source.java', languageId: 'java' },
  ruby: { scope: 'source.ruby', languageId: 'ruby' },
  go: { scope: 'source.go', languageId: 'go' },
  rust: { scope: 'source.rust', languageId: 'rust' },
  php: { scope: 'source.php', languageId: 'php' },
  perl: { scope: 'source.perl', languageId: 'perl' },
  lua: { scope: 'source.lua', languageId: 'lua' },
  sql: { scope: 'source.sql', languageId: 'sql' },
  html: { scope: 'text.html.basic', languageId: 'html' },
  css: { scope: 'source.css', languageId: 'css' },
  json: { scope: 'source.json', languageId: 'json' },
  xml: { scope: 'text.xml', languageId: 'xml' },
  yaml: { scope: 'source.yaml', languageId: 'yaml' },
  toml: { scope: 'source.toml', languageId: 'toml' },
  markdown: { scope: 'text.html.markdown', languageId: 'markdown' },
  bash: { scope: 'source.shell', languageId: 'shellscript' },
  dockerfile: { scope: 'source.dockerfile', languageId: 'dockerfile' },
  swift: { scope: 'source.swift', languageId: 'swift' },
  kotlin: { scope: 'source.kotlin', languageId: 'kotlin' },
  haskell: { scope: 'source.haskell', languageId: 'haskell' },
  r: { scope: 'source.r', languageId: 'r' },
  csharp: { scope: 'source.cs', languageId: 'csharp' },
  matlab: { scope: 'source.matlab', languageId: 'matlab' },
};

function resolveLanguage(name: string): LanguageEntry | undefined {
  return LANGUAGE_MAP[name.toLowerCase()];
}

export function parseCustomCodeTags(
  settings: CustomCodeTagConfig[]
): { tagNames: string[]; syntaxTags: CustomCodeTagConfig[] } {
  const tagNames: string[] = [];
  const syntaxTags: CustomCodeTagConfig[] = [];

  for (const item of settings) {
    if (item && typeof item === 'object' && item.name) {
      tagNames.push(item.name);
      if (item.syntaxAttribute || item.defaultLanguage) {
        syntaxTags.push(item);
      }
    }
  }

  return { tagNames, syntaxTags };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function makeBeginCaptures() {
  return {
    '1': { name: 'punctuation.definition.tag.begin.html' },
    '2': { name: 'entity.name.tag.html' },
    '3': { patterns: [{ include: '#tag-stuff' }] },
    '4': { name: 'punctuation.definition.tag.end.html' },
  };
}

function makeEndCaptures() {
  return {
    '1': { name: 'punctuation.definition.tag.end.html' },
    '2': { name: 'entity.name.tag.html' },
    '3': { name: 'punctuation.definition.tag.end.html' },
  };
}

interface TmPattern {
  begin: string;
  end: string;
  contentName: string;
  beginCaptures: ReturnType<typeof makeBeginCaptures>;
  endCaptures: ReturnType<typeof makeEndCaptures>;
  patterns: { include: string }[];
}

function makePattern(
  tagName: string,
  attrRegex: string | null,
  lang: LanguageEntry,
): TmPattern {
  const escapedTag = escapeRegex(tagName);
  const attrPart = attrRegex
    ? `([^>]*\\s${attrRegex}[^>]*)`
    : '([^>]*)';

  return {
    begin: `(?i)(<)(${escapedTag})\\b${attrPart}(>)`,
    end: `(?i)(</)(${escapedTag})\\s*(>)`,
    contentName: `meta.embedded.block.${lang.languageId}`,
    beginCaptures: makeBeginCaptures(),
    endCaptures: makeEndCaptures(),
    patterns: [{ include: lang.scope }],
  };
}

function generatePatternsForTag(tag: CustomCodeTagConfig): TmPattern[] {
  const patterns: TmPattern[] = [];

  if (tag.syntaxAttribute) {
    const escapedAttr = escapeRegex(tag.syntaxAttribute);

    if (tag.languageMap) {
      // Explicit language map: generate a pattern for each mapping
      for (const [attrValue, langName] of Object.entries(tag.languageMap)) {
        const lang = resolveLanguage(langName);
        if (!lang) continue;
        const escapedVal = escapeRegex(attrValue);
        const attrRegex = `${escapedAttr}\\s*=\\s*(?:"${escapedVal}"|'${escapedVal}')`;
        patterns.push(makePattern(tag.name, attrRegex, lang));
      }
    } else {
      // No language map: match against all known language names
      for (const [key, lang] of Object.entries(LANGUAGE_MAP)) {
        const escapedKey = escapeRegex(key);
        const attrRegex = `${escapedAttr}\\s*=\\s*(?:"${escapedKey}"|'${escapedKey}')`;
        patterns.push(makePattern(tag.name, attrRegex, lang));
      }
    }
  }

  // Default language pattern (no attribute check, lower priority since it's added last)
  if (tag.defaultLanguage) {
    const lang = resolveLanguage(tag.defaultLanguage);
    if (lang) {
      patterns.push(makePattern(tag.name, null, lang));
    }
  }

  return patterns;
}

const TAG_STUFF_REPOSITORY = {
  'tag-stuff': {
    patterns: [
      {
        match: '\\s([a-zA-Z\\-:]+)',
        name: 'entity.other.attribute-name.html',
      },
      {
        match: '=',
        name: 'punctuation.separator.key-value.html',
      },
      {
        begin: '"',
        end: '"',
        name: 'string.quoted.double.html',
      },
      {
        begin: "'",
        end: "'",
        name: 'string.quoted.single.html',
      },
    ],
  },
};

export function generateInjectionGrammar(syntaxTags: CustomCodeTagConfig[]): string {
  const allPatterns: TmPattern[] = [];

  for (const tag of syntaxTags) {
    allPatterns.push(...generatePatternsForTag(tag));
  }

  const grammar = {
    scopeName: 'text.html.htmlmustache.embedded',
    injectionSelector: 'L:text.html.htmlmustache',
    patterns: allPatterns,
    repository: TAG_STUFF_REPOSITORY,
  };

  return JSON.stringify(grammar, null, 2) + '\n';
}

export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
