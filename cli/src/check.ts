#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { Tree } from './wasm';
import { initializeParser, parseDocument } from './wasm';
import { findConfigFile } from '../../lsp/server/src/configFile';
import { parseJsonc, validateConfig } from '../../src/core/configSchema';
import type { HtmlMustacheConfig, RulesConfig, CustomRule } from '../../src/core/configSchema';
import { collectErrors as collectTreeErrors } from '../../src/core/collectErrors';
import type { WalkableTree } from '../../src/core/collectErrors';
import { filterCustomRulesForPath } from '../../src/core/customRuleFilter';
import { toDiagnostic } from '../../src/core/diagnostic';
import type { Diagnostic } from '../../src/core/diagnostic';

// ── Types ──

export interface CheckError extends Diagnostic {
  file: string;
  nodeText: string;
}

export interface CheckResult {
  file: string;
  errors: CheckError[];
}

// ── Error collection ──

export function collectErrors(tree: Tree, file: string, rules?: RulesConfig, customTagNames?: string[], customRules?: CustomRule[]): CheckError[] {
  const errors = collectTreeErrors(tree as unknown as WalkableTree, rules, customTagNames, customRules);
  return errors.map(error => ({
    file,
    nodeText: error.node.text,
    ...toDiagnostic(error),
  }));
}

// ── Formatting ──

export function formatError(error: CheckError, source: string): string {
  const lines = source.split('\n');
  const errorLine = error.line - 1; // 0-based index

  // Location header
  const isWarning = error.severity === 'warning';
  const severityLabel = isWarning ? chalk.yellow('warning') : chalk.red('error');
  const colorFn = isWarning ? chalk.yellow : chalk.red;
  const header = chalk.bold(`${error.file}:${error.line}:${error.column}`) +
    ' ' + severityLabel + ': ' + error.message;

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

  outputLines.push(chalk.dim(' '.repeat(gutterWidth) + ' |') + ' ' + colorFn(underline));

  return outputLines.join('\n');
}

export function formatSummary(
  totalErrors: number,
  filesWithErrors: number,
  totalFiles: number,
  totalWarnings = 0,
): string {
  if (totalErrors === 0 && totalWarnings === 0) {
    return chalk.green(`No errors found (${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} checked)`);
  }
  const totalStr = totalFiles === 1 ? 'file' : 'files';
  const parts: string[] = [];
  if (totalErrors > 0) {
    const errStr = totalErrors === 1 ? 'error' : 'errors';
    parts.push(chalk.red(`${totalErrors} ${errStr}`));
  }
  if (totalWarnings > 0) {
    const warnStr = totalWarnings === 1 ? 'warning' : 'warnings';
    parts.push(chalk.yellow(`${totalWarnings} ${warnStr}`));
  }
  const errFileStr = filesWithErrors === 1 ? 'file' : 'files';
  return `${parts.join(', ')} in ${filesWithErrors} ${errFileStr}` +
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

export function resolveFiles(cliPatterns: string[]): { files: string[]; config: HtmlMustacheConfig | null; configDir: string | null } {
  // Load config from cwd
  const configPath = findConfigFile(process.cwd());
  let config: HtmlMustacheConfig | null = null;
  const configDir = configPath ? path.dirname(configPath) : null;
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
    return { files: [], config, configDir };
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

  return { files, config, configDir };
}

// ── Fix application ──

export function applyFixes(source: string, errors: CheckError[]): string {
  const replacements: Array<{ startIndex: number; endIndex: number; newText: string }> = [];
  for (const error of errors) {
    if (!error.fix) continue;
    for (const edit of error.fix) {
      replacements.push({ startIndex: edit.range[0], endIndex: edit.range[1], newText: edit.newText });
    }
  }

  if (replacements.length === 0) return source;

  replacements.sort((a, b) => b.startIndex - a.startIndex);

  let result = source;
  let minIndex = Infinity;
  for (const r of replacements) {
    if (r.endIndex > minIndex) continue; // overlaps with a later (already-applied) replacement
    result = result.slice(0, r.startIndex) + r.newText + result.slice(r.endIndex);
    minIndex = r.startIndex;
  }

  return result;
}

// ── Main ──

const USAGE = `Usage: htmlmustache check [options] [patterns...]

Check HTML Mustache templates for errors.

Arguments:
  patterns  One or more glob patterns (optional if "include" is set in config)

Options:
  --fix     Automatically fix fixable errors in-place
  --help    Show this help message

Examples:
  htmlmustache check '**/*.mustache'
  htmlmustache check --fix '**/*.mustache'
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

  const fixMode = args.includes('--fix');
  const patterns = args.filter(a => a !== '--fix');

  const { files, config, configDir } = resolveFiles(patterns);

  if (files.length === 0) {
    if (patterns.length === 0 && (!config?.include || config.include.length === 0)) {
      console.log(USAGE);
      return 1;
    }
    const displayPatterns = patterns.length > 0 ? patterns : config?.include ?? [];
    console.error(chalk.yellow('No files matched the given patterns:'));
    for (const p of displayPatterns) {
      console.error(chalk.yellow(`  ${p}`));
    }
    return 1;
  }

  await initializeParser();

  let totalErrors = 0;
  let totalWarnings = 0;
  let filesWithErrors = 0;

  const cwd = process.cwd();

  const errorOutput: string[] = [];

  const rules = config?.rules;
  const customTagNames = config?.customTags?.map(t => t.name);
  const customRules = config?.customRules;
  const ruleFilterBase = configDir ?? cwd;

  for (const file of files) {
    const displayPath = path.relative(cwd, file) || file;
    const ruleFilterPath = path.relative(ruleFilterBase, file) || displayPath;
    const applicableCustomRules = filterCustomRulesForPath(customRules, ruleFilterPath);
    let source = fs.readFileSync(file, 'utf-8');

    if (fixMode) {
      // Apply fixes, then re-parse to report remaining errors
      const tree = parseDocument(source);
      const errors = collectErrors(tree, displayPath, rules, customTagNames, applicableCustomRules);
      const fixed = applyFixes(source, errors);
      if (fixed !== source) {
        fs.writeFileSync(file, fixed, 'utf-8');
        source = fixed;
      }
    }

    const tree = parseDocument(source);
    const errors = collectErrors(tree, displayPath, rules, customTagNames, applicableCustomRules);

    const fileErrors = errors.filter(e => e.severity !== 'warning');
    const fileWarnings = errors.filter(e => e.severity === 'warning');

    if (errors.length > 0) {
      filesWithErrors++;
      totalErrors += fileErrors.length;
      totalWarnings += fileWarnings.length;

      for (const error of errors) {
        errorOutput.push(formatError(error, source));
      }
    }
    console.log(errors.length > 0
      ? (fileErrors.length > 0 ? chalk.red(displayPath) : chalk.yellow(displayPath))
      : chalk.dim(displayPath));
  }

  if (errorOutput.length > 0) {
    console.log();
    for (const output of errorOutput) {
      console.log(output);
      console.log();
    }
  }

  console.log(formatSummary(totalErrors, filesWithErrors, files.length, totalWarnings));
  // Only errors affect exit code, not warnings
  return totalErrors > 0 ? 1 : 0;
}
