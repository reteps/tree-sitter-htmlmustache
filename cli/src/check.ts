#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { Tree } from './wasm';
import { initializeParser, parseDocument } from './wasm';
import { findConfigFile, parseJsonc, validateConfig } from '../../lsp/server/src/configFile';
import type { HtmlMustacheConfig } from '../../lsp/server/src/configFile';
import { checkHtmlBalance } from '../../lsp/server/src/htmlBalanceChecker';

// ── Types ──

export interface CheckError {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  nodeText: string;
}

export interface CheckResult {
  file: string;
  errors: CheckError[];
}

// ── Error collection ──

interface SyntaxNode {
  type: string;
  isMissing: boolean;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: SyntaxNode[];
}

interface TreeCursor {
  currentNode: SyntaxNode;
  nodeType: string;
  nodeIsMissing: boolean;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

function errorMessageForNode(nodeType: string, node: SyntaxNode): string {
  if (nodeType === 'mustache_erroneous_section_end' || nodeType === 'mustache_erroneous_inverted_section_end') {
    const tagNameNode = node.children.find((c: SyntaxNode) => c.type === 'mustache_erroneous_tag_name');
    return `Mismatched mustache section: {{/${tagNameNode?.text || '?'}}}`;
  }
  if (nodeType === 'ERROR') {
    return 'Syntax error';
  }
  // isMissing node
  return `Missing ${nodeType}`;
}

const ERROR_NODE_TYPES = new Set([
  'ERROR',
  'mustache_erroneous_section_end',
  'mustache_erroneous_inverted_section_end',
]);

export function collectErrors(tree: Tree, file: string): CheckError[] {
  const errors: CheckError[] = [];
  const cursor = tree.walk() as unknown as TreeCursor;

  function visit() {
    const node = cursor.currentNode;
    const nodeType = cursor.nodeType;

    if (ERROR_NODE_TYPES.has(nodeType) || cursor.nodeIsMissing) {
      errors.push({
        file,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
        message: errorMessageForNode(nodeType, node),
        nodeText: node.text,
      });

      // Don't recurse into ERROR nodes — the children are not meaningful
      if (nodeType === 'ERROR') return;
    }

    if (cursor.gotoFirstChild()) {
      do { visit(); } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  }

  visit();

  // Run balance checker for HTML tag mismatch detection across mustache paths
  const rootNode = tree.rootNode as unknown as SyntaxNode;
  const balanceErrors = checkHtmlBalance(rootNode);
  for (const error of balanceErrors) {
    errors.push({
      file,
      line: error.node.startPosition.row + 1,
      column: error.node.startPosition.column + 1,
      endLine: error.node.endPosition.row + 1,
      endColumn: error.node.endPosition.column + 1,
      message: error.message,
      nodeText: error.node.text,
    });
  }

  return errors;
}

// ── Formatting ──

export function formatError(error: CheckError, source: string): string {
  const lines = source.split('\n');
  const errorLine = error.line - 1; // 0-based index

  // Location header
  const header = chalk.bold(`${error.file}:${error.line}:${error.column}`) +
    ' ' + chalk.red('error') + ': ' + error.message;

  // Context lines: up to 2 before + the error line(s)
  const contextStart = Math.max(0, errorLine - 2);
  const contextEnd = Math.min(lines.length - 1, error.endLine - 1);

  const gutterWidth = String(contextEnd + 1).length;
  const pad = (n: number) => String(n).padStart(gutterWidth);

  const outputLines: string[] = [header];
  outputLines.push(chalk.dim(' '.repeat(gutterWidth) + ' |'));

  for (let i = contextStart; i <= contextEnd; i++) {
    const lineNum = i + 1;
    outputLines.push(chalk.dim(`${pad(lineNum)} |`) + ' ' + lines[i]);
  }

  // Underline: only on the last displayed line of the error
  const lastErrorLineIdx = error.endLine - 1;
  const lastLine = lines[lastErrorLineIdx] || '';

  let underlineStart: number;
  let underlineEnd: number;

  if (error.line === error.endLine) {
    // Single-line error
    underlineStart = error.column - 1;
    underlineEnd = error.endColumn - 1;
  } else {
    // Multi-line: underline to end of last line
    underlineStart = 0;
    underlineEnd = lastLine.length;
  }

  const underlineLength = Math.max(1, underlineEnd - underlineStart);
  const underline = ' '.repeat(underlineStart) + '^'.repeat(underlineLength) +
    ' ' + error.message;

  outputLines.push(chalk.dim(' '.repeat(gutterWidth) + ' |') + ' ' + chalk.red(underline));

  return outputLines.join('\n');
}

export function formatSummary(totalErrors: number, filesWithErrors: number, totalFiles: number): string {
  if (totalErrors === 0) {
    return chalk.green(`No errors found (${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} checked)`);
  }
  const errStr = totalErrors === 1 ? 'error' : 'errors';
  const errFileStr = filesWithErrors === 1 ? 'file' : 'files';
  const totalStr = totalFiles === 1 ? 'file' : 'files';
  return chalk.red(`${totalErrors} ${errStr} in ${filesWithErrors} ${errFileStr}`) +
    ` (${totalFiles} ${totalStr} checked)`;
}

// ── Glob expansion ──

export function expandGlobs(patterns: string[]): string[] {
  const files: Set<string> = new Set();
  const cwd = process.cwd();
  for (const pattern of patterns) {
    // If the pattern is an exact file path, use it directly
    if (!pattern.includes('*') && !pattern.includes('?')) {
      const resolved = path.resolve(cwd, pattern);
      if (fs.existsSync(resolved)) {
        files.add(resolved);
      }
    } else {
      for (const match of fs.globSync(pattern, { cwd })) {
        files.add(path.resolve(cwd, match));
      }
    }
  }
  return [...files].sort();
}

// ── File resolution ──

const DEFAULT_EXCLUDE_SEGMENTS = ['/node_modules/', '/.git/'];

export function resolveFiles(cliPatterns: string[]): { files: string[]; config: HtmlMustacheConfig | null } {
  // Load config from cwd
  const configPath = findConfigFile(process.cwd());
  let config: HtmlMustacheConfig | null = null;
  if (configPath) {
    try {
      const text = fs.readFileSync(configPath, 'utf-8');
      const raw = parseJsonc(text);
      config = validateConfig(raw);
    } catch {
      config = null;
    }
  }

  // Determine include patterns
  let patterns: string[];
  if (cliPatterns.length > 0) {
    patterns = cliPatterns;
  } else if (config?.include && config.include.length > 0) {
    patterns = config.include;
  } else {
    return { files: [], config };
  }

  // Expand globs
  let files = expandGlobs(patterns);

  // Apply default excludes
  files = files.filter(f => !DEFAULT_EXCLUDE_SEGMENTS.some(seg => f.includes(seg)));

  // Apply config excludes
  if (config?.exclude && config.exclude.length > 0) {
    const cwd = process.cwd();
    const excludeSet = new Set<string>();
    for (const pattern of config.exclude) {
      if (!pattern.includes('*') && !pattern.includes('?')) {
        excludeSet.add(path.resolve(cwd, pattern));
      } else {
        for (const match of fs.globSync(pattern, { cwd })) {
          excludeSet.add(path.resolve(cwd, match));
        }
      }
    }
    files = files.filter(f => !excludeSet.has(f));
  }

  return { files, config };
}

// ── Main ──

const USAGE = `Usage: htmlmustache check [patterns...]

Check HTML Mustache templates for errors.

Arguments:
  patterns  One or more glob patterns (optional if "include" is set in config)

Options:
  --help    Show this help message

Examples:
  htmlmustache check '**/*.mustache'
  htmlmustache check 'templates/**/*.hbs' 'partials/**/*.mustache'
  htmlmustache check                       (uses "include" from .htmlmustache.jsonc)`;

export async function run(args: string[]): Promise<number> {
  // Strip "check" subcommand if present
  if (args[0] === 'check') {
    args = args.slice(1);
  }

  if (args.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  const { files, config } = resolveFiles(args);

  if (files.length === 0) {
    if (args.length === 0 && (!config?.include || config.include.length === 0)) {
      console.log(USAGE);
      return 1;
    }
    const patterns = args.length > 0 ? args : config?.include ?? [];
    console.error(chalk.yellow('No files matched the given patterns:'));
    for (const p of patterns) {
      console.error(chalk.yellow(`  ${p}`));
    }
    return 1;
  }

  await initializeParser();

  let totalErrors = 0;
  let filesWithErrors = 0;

  const cwd = process.cwd();

  const errorOutput: string[] = [];

  for (const file of files) {
    const displayPath = path.relative(cwd, file) || file;
    const source = fs.readFileSync(file, 'utf-8');
    const tree = parseDocument(source);
    const errors = collectErrors(tree, displayPath);

    if (errors.length > 0) {
      filesWithErrors++;
      totalErrors += errors.length;

      for (const error of errors) {
        errorOutput.push(formatError(error, source));
      }
    }
    console.log(errors.length > 0
      ? chalk.red(displayPath)
      : chalk.dim(displayPath));
  }

  if (errorOutput.length > 0) {
    console.log();
    for (const output of errorOutput) {
      console.log(output);
      console.log();
    }
  }

  console.log(formatSummary(totalErrors, filesWithErrors, files.length));
  return totalErrors > 0 ? 1 : 0;
}
