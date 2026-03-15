import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { formatDocument } from '../../lsp/server/src/formatting/index';
import type { FormattingOptions, FormatDocumentParams } from '../../lsp/server/src/formatting/index';
import { getEditorConfigOptions } from '../../lsp/server/src/formatting/editorconfig';
import { loadConfigFileForPath } from '../../lsp/server/src/configFile';
import type { NoBreakDelimiter } from '../../lsp/server/src/configFile';
import type { CustomCodeTagConfig } from '../../lsp/server/src/customCodeTags';
import { collectEmbeddedRegions } from '../../lsp/server/src/embeddedRegions';
import { initializeParser, parseDocument } from './wasm';
import { resolveFiles } from './check';

const USAGE = `Usage: htmlmustache format [options] [patterns...]

Format HTML Mustache templates.

Arguments:
  patterns          One or more glob patterns (optional if "include" is set in config)

Options:
  --write           Modify files in-place (default: print to stdout)
  --check           Exit 1 if any files would change (for CI)
  --stdin           Read from stdin, write to stdout
  --indent-size N   Spaces per indent level (default: 2)
  --print-width N   Max line width (default: 80)
  --mustache-spaces Add spaces inside mustache delimiters
  --help            Show this help message

Examples:
  htmlmustache format --write '**/*.mustache'
  htmlmustache format --check 'templates/**/*.hbs'
  htmlmustache format --write                       (uses "include" from .htmlmustache.jsonc)
  echo '<div><p>hi</p></div>' | htmlmustache format --stdin`;

interface FormatFlags {
  write: boolean;
  check: boolean;
  stdin: boolean;
  indentSize: number | undefined;
  printWidth: number | undefined;
  mustacheSpaces: boolean | undefined;
  patterns: string[];
}

function parseFlags(args: string[]): FormatFlags {
  const flags: FormatFlags = {
    write: false,
    check: false,
    stdin: false,
    indentSize: undefined,
    printWidth: undefined,
    mustacheSpaces: undefined,
    patterns: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case '--write':
        flags.write = true;
        break;
      case '--check':
        flags.check = true;
        break;
      case '--stdin':
        flags.stdin = true;
        break;
      case '--indent-size':
        i++;
        flags.indentSize = parseInt(args[i], 10);
        if (isNaN(flags.indentSize)) {
          console.error(chalk.red('Error: --indent-size requires a number'));
          process.exit(1);
        }
        break;
      case '--print-width':
        i++;
        flags.printWidth = parseInt(args[i], 10);
        if (isNaN(flags.printWidth)) {
          console.error(chalk.red('Error: --print-width requires a number'));
          process.exit(1);
        }
        break;
      case '--mustache-spaces':
        flags.mustacheSpaces = true;
        break;
      default:
        flags.patterns.push(arg);
        break;
    }
    i++;
  }

  return flags;
}

/**
 * Resolve all settings for a file with the full priority chain:
 *   defaults < .htmlmustache.jsonc < .editorconfig (indent only) < CLI flags
 */
function resolveSettings(flags: FormatFlags, filePath?: string): {
  options: FormattingOptions;
} & FormatDocumentParams {
  // 1. Defaults
  let tabSize = 2;
  let insertSpaces = true;
  let printWidth = 80;
  let mustacheSpaces: boolean | undefined = false;
  let customTags: CustomCodeTagConfig[] | undefined;

  // 2. Config file overrides defaults
  const configFile = filePath ? loadConfigFileForPath(filePath) : null;
  let noBreakDelimiters: NoBreakDelimiter[] | undefined;
  if (configFile) {
    if (configFile.indentSize !== undefined) tabSize = configFile.indentSize;
    if (configFile.printWidth !== undefined) printWidth = configFile.printWidth;
    if (configFile.mustacheSpaces !== undefined) mustacheSpaces = configFile.mustacheSpaces;
    if (configFile.noBreakDelimiters) noBreakDelimiters = configFile.noBreakDelimiters;
    if (configFile.customTags && configFile.customTags.length > 0) {
      customTags = configFile.customTags;
    }
  }

  // 3. Editorconfig overrides config file (indent only)
  if (filePath) {
    const uri = pathToFileURL(filePath).href;
    const ecOptions = getEditorConfigOptions(uri);
    if (ecOptions.tabSize !== undefined) tabSize = ecOptions.tabSize;
    if (ecOptions.insertSpaces !== undefined) insertSpaces = ecOptions.insertSpaces;
  }

  // 4. CLI flags override everything
  if (flags.indentSize !== undefined) tabSize = flags.indentSize;
  if (flags.printWidth !== undefined) printWidth = flags.printWidth;
  if (flags.mustacheSpaces !== undefined) mustacheSpaces = flags.mustacheSpaces;

  return {
    options: { tabSize, insertSpaces },
    printWidth,
    mustacheSpaces,
    noBreakDelimiters,
    customTags,
    configFile,
  };
}

const LANGUAGE_TO_PRETTIER_PARSER: Record<string, string> = {
  javascript: 'babel',
  typescript: 'typescript',
  css: 'css',
};

let prettierModule: typeof import('prettier') | null | undefined;

async function getPrettier(): Promise<typeof import('prettier') | null> {
  if (prettierModule !== undefined) return prettierModule;
  try {
    prettierModule = await import('prettier');
    return prettierModule;
  } catch {
    prettierModule = null;
    return null;
  }
}

/** @internal Override the cached prettier module (for testing). Pass undefined to reset. */
export function _setPrettierForTesting(value: typeof import('prettier') | null | undefined) {
  prettierModule = value;
}

async function formatEmbeddedRegions(
  tree: ReturnType<typeof parseDocument>,
  options: FormattingOptions,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const prettier = await getPrettier();
  if (!prettier) return result;

  const regions = collectEmbeddedRegions(tree.rootNode);
  if (regions.length === 0) return result;

  await Promise.all(
    regions.map(async (region) => {
      const parser = LANGUAGE_TO_PRETTIER_PARSER[region.languageId];
      if (!parser) return;
      try {
        const formatted = await prettier.format(region.content, {
          parser,
          tabWidth: options.tabSize,
          useTabs: !options.insertSpaces,
        });
        result.set(region.startIndex, formatted);
      } catch {
        // Formatting failed (e.g. syntax error in snippet) — skip
      }
    })
  );

  return result;
}

export async function formatSource(
  source: string,
  options: FormattingOptions,
  params: FormatDocumentParams = {},
): Promise<string> {
  const tree = parseDocument(source);
  const embeddedFormatted = await formatEmbeddedRegions(tree, options);
  const document = TextDocument.create('file:///stdin', 'htmlmustache', 1, source);
  const edits = formatDocument(tree, document, options, {
    ...params,
    embeddedFormatted: embeddedFormatted.size > 0 ? embeddedFormatted : undefined,
  });
  if (edits.length === 0) return source;
  return edits[0].newText;
}

export async function run(args: string[]): Promise<number> {
  if (args[0] === 'format') {
    args = args.slice(1);
  }

  if (args.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const flags = parseFlags(args);

  // Stdin mode
  if (flags.stdin) {
    await initializeParser();
    const { options, ...params } = resolveSettings(flags);
    const source = fs.readFileSync(0, 'utf-8');
    const formatted = await formatSource(source, options, params);
    process.stdout.write(formatted);
    return 0;
  }

  // File mode
  const { files, config } = resolveFiles(flags.patterns);

  if (files.length === 0) {
    if (flags.patterns.length === 0 && (!config?.include || config.include.length === 0)) {
      console.log(USAGE);
      return 1;
    }
    const patterns = flags.patterns.length > 0 ? flags.patterns : config?.include ?? [];
    console.error(chalk.yellow('No files matched the given patterns:'));
    for (const pattern of patterns) {
      console.error(chalk.yellow(`  ${pattern}`));
    }
    return 1;
  }

  await initializeParser();

  const cwd = process.cwd();
  let changedCount = 0;

  for (const file of files) {
    const displayPath = path.relative(cwd, file) || file;
    const source = fs.readFileSync(file, 'utf-8');
    const { options, ...params } = resolveSettings(flags, file);
    const formatted = await formatSource(source, options, params);
    const changed = formatted !== source;

    if (changed) changedCount++;

    if (flags.check) {
      console.log(changed ? chalk.red(displayPath) : chalk.dim(displayPath));
    } else if (flags.write) {
      if (changed) {
        fs.writeFileSync(file, formatted);
      }
      console.log(changed ? chalk.green(displayPath) : chalk.dim(displayPath));
    } else {
      // Default: print to stdout
      process.stdout.write(formatted);
    }
  }

  if (flags.check && changedCount > 0) {
    console.log(
      chalk.red(`\n${changedCount} ${changedCount === 1 ? 'file' : 'files'} would be reformatted`)
    );
    return 1;
  }

  if (flags.check) {
    console.log(chalk.green(`All ${files.length} ${files.length === 1 ? 'file' : 'files'} already formatted`));
  }

  return 0;
}
