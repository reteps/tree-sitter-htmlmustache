import { describe, it, expect } from 'vitest';
import { filterCustomRulesForPath, ruleMatchesPath } from '../../../src/core/customRuleFilter.js';
import type { CustomRule } from '../../../src/core/configSchema.js';

function rule(partial: Partial<CustomRule> & Pick<CustomRule, 'id'>): CustomRule {
  return { id: partial.id, selector: 'div', message: 'm', ...partial };
}

describe('ruleMatchesPath', () => {
  it('returns true when neither include nor exclude is set', () => {
    expect(ruleMatchesPath(rule({ id: 'r' }), 'any/path.mustache')).toBe(true);
  });

  it('matches when path is in include', () => {
    expect(ruleMatchesPath(rule({ id: 'r', include: ['questions/**'] }), 'questions/q1/index.mustache')).toBe(true);
  });

  it('rejects when path is not in include', () => {
    expect(ruleMatchesPath(rule({ id: 'r', include: ['questions/**'] }), 'partials/header.mustache')).toBe(false);
  });

  it('rejects when path matches exclude', () => {
    expect(ruleMatchesPath(rule({ id: 'r', exclude: ['**/legacy/**'] }), 'questions/legacy/old.mustache')).toBe(false);
  });

  it('exclude wins over include (both defined, path matches both)', () => {
    const r = rule({ id: 'r', include: ['questions/**'], exclude: ['**/legacy/**'] });
    expect(ruleMatchesPath(r, 'questions/legacy/old.mustache')).toBe(false);
    expect(ruleMatchesPath(r, 'questions/q1/index.mustache')).toBe(true);
  });

  it('handles multiple include patterns as union', () => {
    const r = rule({ id: 'r', include: ['questions/**', 'elements/**'] });
    expect(ruleMatchesPath(r, 'questions/a.mustache')).toBe(true);
    expect(ruleMatchesPath(r, 'elements/b.mustache')).toBe(true);
    expect(ruleMatchesPath(r, 'docs/c.mustache')).toBe(false);
  });
});

describe('filterCustomRulesForPath', () => {
  it('returns undefined when input is undefined', () => {
    expect(filterCustomRulesForPath(undefined, 'any')).toBeUndefined();
  });

  it('filters out rules whose patterns exclude the path', () => {
    const rules = [
      rule({ id: 'a', include: ['questions/**'] }),
      rule({ id: 'b', exclude: ['partials/**'] }),
      rule({ id: 'c' }),
    ];
    const got = filterCustomRulesForPath(rules, 'partials/header.mustache');
    expect(got!.map(r => r.id)).toEqual(['c']);
  });

  it('keeps rules that match for the given path', () => {
    const rules = [
      rule({ id: 'a', include: ['questions/**'] }),
      rule({ id: 'b', exclude: ['partials/**'] }),
      rule({ id: 'c' }),
    ];
    const got = filterCustomRulesForPath(rules, 'questions/q1/index.mustache');
    expect(got!.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});
