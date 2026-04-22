import type { RuleSeverity } from './configSchema.js';

export interface RuleDefinition {
  name: string;
  defaultSeverity: RuleSeverity;
  description: string;
}

export const RULES: RuleDefinition[] = [
  {
    name: 'nestedDuplicateSections',
    defaultSeverity: 'error',
    description: 'Flags `{{#name}}` nested inside another `{{#name}}` with the same name',
  },
  {
    name: 'unquotedMustacheAttributes',
    defaultSeverity: 'error',
    description: 'Requires quotes around mustache expressions used as attribute values',
  },
  {
    name: 'consecutiveDuplicateSections',
    defaultSeverity: 'warning',
    description: 'Warns when adjacent same-name sections can be merged',
  },
  {
    name: 'selfClosingNonVoidTags',
    defaultSeverity: 'error',
    description: 'Disallows self-closing syntax on non-void HTML elements (e.g. `<div/>`)',
  },
  {
    name: 'duplicateAttributes',
    defaultSeverity: 'error',
    description: 'Detects duplicate HTML attributes on the same element',
  },
  {
    name: 'unescapedEntities',
    defaultSeverity: 'warning',
    description: 'Flags unescaped `&` and `>` characters in text content',
  },
  {
    name: 'preferMustacheComments',
    defaultSeverity: 'off',
    description: 'Suggests replacing HTML comments with mustache comments',
  },
  {
    name: 'unrecognizedHtmlTags',
    defaultSeverity: 'error',
    description: 'Flags HTML tags that are not standard HTML elements or valid custom elements',
  },
  {
    name: 'elementContentTooLong',
    defaultSeverity: 'off',
    description: 'Flags configured elements whose inner content exceeds a byte-length threshold (opt-in; requires `elements: [{ tag, maxBytes }]` option)',
  },
];

/** Set of all known rule names (for config validation). */
export const KNOWN_RULE_NAMES = new Set<string>(RULES.map(r => r.name));

/** Default severity for each rule (for runtime resolution). */
export const RULE_DEFAULTS: Record<string, RuleSeverity> = Object.fromEntries(
  RULES.map(r => [r.name, r.defaultSeverity]),
);
