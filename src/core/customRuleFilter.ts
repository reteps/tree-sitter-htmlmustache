/**
 * Filter custom lint rules by per-rule `include` / `exclude` glob patterns.
 *
 * Patterns are matched against a path relative to the config file's directory.
 * Path separators are normalized to forward slashes so cross-platform patterns
 * like `questions/**` work regardless of host OS.
 *
 * Uses Node's `path.matchesGlob` (available since Node 22.5), so this module
 * is Node-only — the browser entrypoint does not import it.
 */

import * as path from 'node:path';
import type { CustomRule } from './configSchema.js';

export function ruleMatchesPath(rule: CustomRule, relPath: string): boolean {
  const normalized = relPath.split(path.sep).join('/');
  if (rule.exclude && rule.exclude.some(p => path.matchesGlob(normalized, p))) {
    return false;
  }
  if (rule.include && rule.include.length > 0) {
    return rule.include.some(p => path.matchesGlob(normalized, p));
  }
  return true;
}

export function filterCustomRulesForPath(
  rules: CustomRule[] | undefined,
  relPath: string,
): CustomRule[] | undefined {
  if (!rules) return rules;
  return rules.filter(r => ruleMatchesPath(r, relPath));
}
