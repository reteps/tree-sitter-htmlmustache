#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

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

// ── Parser loading ──

interface TreeSitterParser {
  parse(input: string): TreeSitterTree;
  setLanguage(lang: unknown): void;
}

interface TreeSitterTree {
  walk(): TreeSitterCursor;
}

interface TreeSitterPoint {
  row: number;
  column: number;
}

interface TreeSitterNode {
  type: string;
  isMissing: boolean;
  text: string;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  children: TreeSitterNode[];
}

interface TreeSitterCursor {
  currentNode: TreeSitterNode;
  nodeType: string;
  nodeIsMissing: boolean;
  gotoFirstChild(): boolean;
  gotoNextSibling(): boolean;
  gotoParent(): boolean;
}

function loadParser(): TreeSitterParser {
  let Parser: new () => TreeSitterParser;
  try {
    Parser = require('tree-sitter');
  } catch {
    console.error(
      chalk.red('Error: tree-sitter is not installed.\n') +
      'Install it with: npm install tree-sitter'
    );
    process.exit(1);
  }

  let language: unknown;
  try {
    language = require(path.resolve(__dirname, '..', '..'));
  } catch {
    console.error(
      chalk.red('Error: could not load tree-sitter-htmlmustache bindings.\n') +
      'Run "npm install" in the tree-sitter-htmlmustache root first.'
    );
    process.exit(1);
  }

  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

// ── Error collection ──

function errorMessageForNode(nodeType: string, node: TreeSitterNode): string {
  if (nodeType === 'mustache_erroneous_section_end' || nodeType === 'mustache_erroneous_inverted_section_end') {
    const tagNameNode = node.children.find((c: TreeSitterNode) => c.type === 'mustache_erroneous_tag_name');
    return `Mismatched mustache section: {{/${tagNameNode?.text || '?'}}}`;
  }
  if (nodeType === 'html_erroneous_end_tag') {
    const tagNameNode = node.children.find((c: TreeSitterNode) => c.type === 'html_erroneous_end_tag_name');
    return `Mismatched HTML end tag: </${tagNameNode?.text || '?'}>`;
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
  'html_erroneous_end_tag',
]);

export function collectErrors(tree: TreeSitterTree, file: string): CheckError[] {
  const errors: CheckError[] = [];
  const cursor = tree.walk();

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

// ── Main ──

const USAGE = `Usage: htmlmustache check <patterns...>

Check HTML Mustache templates for errors.

Arguments:
  patterns  One or more glob patterns (e.g. '**/*.mustache' '**/*.hbs')

Options:
  --help    Show this help message

Examples:
  htmlmustache check '**/*.mustache'
  htmlmustache check 'templates/**/*.hbs' 'partials/**/*.mustache'`;

export function run(args: string[]): number {
  // Strip "check" subcommand if present
  if (args[0] === 'check') {
    args = args.slice(1);
  }

  if (args.includes('--help') || args.length === 0) {
    console.log(USAGE);
    return args.includes('--help') ? 0 : 1;
  }

  const files = expandGlobs(args);

  if (files.length === 0) {
    console.error(chalk.yellow('No files matched the given patterns:'));
    for (const arg of args) {
      console.error(chalk.yellow(`  ${arg}`));
    }
    return 1;
  }

  const parser = loadParser();
  let totalErrors = 0;
  let filesWithErrors = 0;

  const cwd = process.cwd();

  const errorOutput: string[] = [];

  for (const file of files) {
    const displayPath = path.relative(cwd, file) || file;
    const source = fs.readFileSync(file, 'utf-8');
    const tree = parser.parse(source);
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

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] !== 'check' && !args.includes('--help')) {
    if (args.length === 0) {
      console.log(USAGE);
      process.exit(1);
    }
    console.error(chalk.red(`Unknown command: ${args[0]}`));
    console.error('Run "htmlmustache --help" for usage.');
    process.exit(1);
  }

  const code = run(args);
  process.exit(code);
}
