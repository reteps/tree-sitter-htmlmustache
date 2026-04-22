/**
 * Browser entry point for `@reteps/tree-sitter-htmlmustache`.
 *
 * Exposes `createLinter({ locateWasm, prettier? })` returning a handle with
 * `lint(source, config)` and `format(source, config, opts)`. Internally reuses
 * the shared rule engine and formatter in `src/core/` — browser-safe, no fs.
 */

import { Parser, Language } from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { collectErrors } from '../core/collectErrors.js';
import type { WalkableTree } from '../core/collectErrors.js';
import { formatDocument } from '../core/formatting/index.js';
import type { FormattingOptions } from '../core/formatting/index.js';
import { mergeOptions } from '../core/formatting/mergeOptions.js';
import { formatEmbeddedRegions } from '../core/formatting/embedded.js';
import type { PrettierLike } from '../core/formatting/embedded.js';
import { RULE_DEFAULTS } from '../core/ruleMetadata.js';
import { toDiagnostic } from '../core/diagnostic.js';
import type { Diagnostic } from '../core/diagnostic.js';
import { GRAMMAR_WASM_FILENAME } from '../core/grammar.js';
import type {
  HtmlMustacheConfig,
  RulesConfig,
  RuleSeverity,
  CustomRule as CustomRuleType,
} from '../core/configSchema.js';
import type { CustomCodeTagConfig } from '../core/customCodeTags.js';

export type Config = Omit<HtmlMustacheConfig, 'include' | 'exclude'>;
export type CustomRule = CustomRuleType;
export type CustomTag = CustomCodeTagConfig;
export type { RulesConfig, RuleSeverity, PrettierLike, Diagnostic };

export type LocateWasm = string | ((filename: string) => string);

export interface CreateLinterOptions {
  /**
   * Locates the grammar WASM (`tree-sitter-htmlmustache.wasm`). If a string,
   * treated as the URL for the grammar — web-tree-sitter's own
   * `tree-sitter.wasm` will resolve via its default `locateFile`. Pass a
   * callback to resolve both names explicitly.
   */
  locateWasm: LocateWasm;
  /** Default prettier used for embedded-region formatting. */
  prettier?: PrettierLike;
}

export interface FormatOptions {
  /** Override the factory-level prettier for this call. */
  prettier?: PrettierLike;
}

export interface Linter {
  lint(source: string, config?: Config): Diagnostic[];
  format(source: string, config?: Config, opts?: FormatOptions): Promise<string>;
}

/** Default severities for every built-in rule. */
export const DEFAULT_CONFIG: Config = { rules: RULE_DEFAULTS as RulesConfig };

const DEFAULT_FORMATTING_OPTIONS: FormattingOptions = { tabSize: 2, insertSpaces: true };

function toLocateFile(locateWasm: LocateWasm): ((name: string) => string) | undefined {
  // String form resolves only the grammar; runtime `tree-sitter.wasm` falls
  // through to web-tree-sitter's own default `locateFile`.
  return typeof locateWasm === 'function' ? (name) => locateWasm(name) : undefined;
}

function resolveGrammarUrl(locateWasm: LocateWasm): string {
  return typeof locateWasm === 'string' ? locateWasm : locateWasm(GRAMMAR_WASM_FILENAME);
}

/**
 * Create a linter/formatter handle. Consumers should cache the result — each
 * call reloads the grammar WASM.
 */
export async function createLinter(opts: CreateLinterOptions): Promise<Linter> {
  const { locateWasm, prettier: factoryPrettier } = opts;
  const locateFile = toLocateFile(locateWasm);
  // `Parser.init` is itself idempotent (Emscripten caches the runtime globally),
  // so repeated calls with different `locateFile` are safe — the first wins.
  await Parser.init(locateFile ? { locateFile } : undefined);
  const parser = new Parser();
  const language = await Language.load(resolveGrammarUrl(locateWasm));
  parser.setLanguage(language);

  return {
    lint(source, config) {
      const tree = parser.parse(source);
      if (!tree) throw new Error('Failed to parse document');
      try {
        const customTagNames = config?.customTags?.map((t) => t.name);
        const errors = collectErrors(
          tree as unknown as WalkableTree,
          config?.rules,
          customTagNames,
          config?.customRules,
        );
        return errors.map(toDiagnostic);
      } finally {
        tree.delete();
      }
    },

    async format(source, config, callOpts) {
      const prettier = callOpts?.prettier ?? factoryPrettier;
      const options = mergeOptions(DEFAULT_FORMATTING_OPTIONS, config ?? null);
      const tree = parser.parse(source);
      if (!tree) throw new Error('Failed to parse document');
      try {
        const embeddedFormatted = await formatEmbeddedRegions(tree.rootNode, options, prettier);
        const document = TextDocument.create('file:///input', 'htmlmustache', 1, source);
        const edits = formatDocument(tree, document, options, {
          customTags: config?.customTags,
          printWidth: config?.printWidth,
          mustacheSpaces: config?.mustacheSpaces,
          noBreakDelimiters: config?.noBreakDelimiters,
          embeddedFormatted: embeddedFormatted.size > 0 ? embeddedFormatted : undefined,
        });
        return edits.length === 0 ? source : edits[0].newText;
      } finally {
        tree.delete();
      }
    },
  };
}
