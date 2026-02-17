// Custom types for tree-sitter captures (HTML/Mustache)
// [id, themeScope] — no scope prefix matching, these come from tree-sitter
const CUSTOM_TOKENS: [string, string][] = [
  ['tag',               'entity.name.tag.html'],
  ['attributeName',     'entity.other.attribute-name.html'],
  ['attributeValue',    'string.quoted.double.html'],
  ['delimiter',         'punctuation.definition.tag.begin.html'],
  ['mustacheVariable',  'variable.other.constant'],
  ['mustacheDelimiter', 'keyword.control.handlebars'],
];

// Embedded language types — matched from TextMate scopes.
// Order matters: most specific prefix first (first startsWith match wins).
// [id, tmScopePrefix, themeScope?] — themeScope defaults to tmScopePrefix
const EMBEDDED_TOKENS: [string, string, string?][] = [
  ['comment',             'comment'],
  ['string',              'string'],
  ['regexp',              'string.regexp'],
  ['number',              'constant.numeric'],
  ['constantLanguage',    'constant.language'],
  ['operatorComparison',  'keyword.operator.comparison'],
  ['operatorArithmetic',  'keyword.operator.arithmetic'],
  ['operatorLogical',     'keyword.operator.logical'],
  ['operatorAssignment',  'keyword.operator.assignment'],
  ['operatorBitwise',     'keyword.operator.bitwise'],
  ['operatorWord',        'keyword.operator.word'],
  ['operator',            'keyword.operator'],
  ['keywordControl',      'keyword.control'],
  ['keyword',             'keyword'],
  ['storageType',         'storage.type'],
  ['modifier',            'storage.modifier'],
  ['function',            'entity.name.function'],
  ['functionCall',        'meta.function-call.generic'],
  ['supportFunction',     'support.function'],
  ['type',                'entity.name.type'],
  ['supportType',         'support.type'],
  ['property',            'meta.attribute'],
  ['indexedName',         'meta.indexed-name'],
  ['parameter',           'variable.parameter'],
  ['variableLanguage',    'variable.language'],
  ['variable',            'variable'],
  ['punctuation',         'punctuation'],
  // Markup scopes (markdown, rst, etc.)
  ['markupHeading',       'markup.heading'],
  ['markupBold',          'markup.bold'],
  ['markupItalic',        'markup.italic'],
  ['markupUnderline',     'markup.underline'],
  ['markupStrikethrough', 'markup.strikethrough'],
  ['markupInlineCode',    'markup.inline.raw'],
  ['markupFencedCode',    'markup.fenced_code'],
  ['markupLink',          'markup.underline.link'],
  ['markupList',          'markup.list'],
  ['markupQuote',         'markup.quote'],
  ['markupRaw',           'markup.raw'],
  ['markup',              'markup'],
];

// --- Derived exports ---

export const tokenTypesLegend: string[] = [
  ...CUSTOM_TOKENS.map(([id]) => id),
  ...EMBEDDED_TOKENS.map(([id]) => id),
];

export const tokenTypeIndex: Record<string, number> = {};
for (let i = 0; i < tokenTypesLegend.length; i++) {
  tokenTypeIndex[tokenTypesLegend[i]] = i;
}

// Scope prefix → token type index, for embeddedTokenizer
export const scopeMatchTable: [string, number][] = EMBEDDED_TOKENS.map(
  ([id, prefix]) => [prefix, tokenTypeIndex[id]],
);

// Insert specific punctuation overrides before the generic 'punctuation' entry.
// Without these, scopes like 'punctuation.definition.string.begin.python' match
// the generic 'punctuation' instead of 'string', causing quote chars and angle
// brackets (e.g. <iostream>) to get the wrong color.
const punctuationIdx = scopeMatchTable.findIndex(([prefix]) => prefix === 'punctuation');
if (punctuationIdx >= 0) {
  scopeMatchTable.splice(punctuationIdx, 0,
    ['punctuation.definition.string', tokenTypeIndex['string']],
    ['punctuation.definition.comment', tokenTypeIndex['comment']],
  );
}


// Token modifiers legend for LSP.
// Language modifiers allow theme-specific styling for embedded language tokens.
// Each modifier uses bit position = index in this array.
export const tokenModifiersLegend: string[] = [
  'c',           // bit 0
  'cpp',         // bit 1
  'python',      // bit 2
  'javascript',  // bit 3
  'typescript',  // bit 4
  'java',        // bit 5
  'go',          // bit 6
  'rust',        // bit 7
  'ruby',        // bit 8
  'css',         // bit 9
  'html',        // bit 10
  'sql',         // bit 11
  'php',         // bit 12
  'csharp',      // bit 13
];

const languageModifierBits: Record<string, number> = {};
for (let i = 0; i < tokenModifiersLegend.length; i++) {
  languageModifierBits[tokenModifiersLegend[i]] = 1 << i;
}

export function getLanguageModifier(languageId: string): number {
  return languageModifierBits[languageId.toLowerCase()] ?? 0;
}
