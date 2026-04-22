/**
 * Node-only configuration discovery helpers.
 *
 * Pure schema types + parseJsonc + validateConfig live in
 * `src/core/configSchema.ts` and are the browser-safe surface.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { parseJsonc, validateConfig } from '../../../src/core/configSchema.js';
import type { HtmlMustacheConfig } from '../../../src/core/configSchema.js';

const CONFIG_FILENAME = '.htmlmustache.jsonc';

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
