import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type { Tree, Query } from './parser';

/**
 * Highlight query source - kept in sync with queries/highlights.scm
 */
export const HIGHLIGHT_QUERY = `
; HTML
(html_tag_name) @tag
(html_erroneous_end_tag_name) @tag.error
(html_doctype) @constant
(html_attribute_name) @attribute
(html_attribute_value) @string
(html_comment) @comment

[
  "<"
  ">"
  "</"
  "/>"
] @punctuation.bracket

; Mustache
(mustache_tag_name) @variable
(mustache_identifier) @variable
(mustache_partial_content) @variable
(mustache_comment) @comment

[
  "{{"
  "}}"
  "{{{"
  "}}}"
  "{{>"
  "{{#"
  "{{/"
  "{{^"
] @keyword
`;

/**
 * Semantic token types - includes both VS Code standard types and custom HTML/Mustache types.
 * The order matters as it defines the index used in the protocol.
 *
 * Custom types are mapped to TextMate scopes in the extension's package.json semanticTokenScopes.
 */
const TokenType = {
  // Custom HTML types - mapped to html scopes
  tag: 0,
  attributeName: 1,
  attributeValue: 2,
  delimiter: 3,
  // Custom Mustache types - mapped to handlebars scopes
  mustacheVariable: 4,
  mustacheDelimiter: 5,
  // Standard VS Code types
  namespace: 6,
  type: 7,
  class: 8,
  enum: 9,
  interface: 10,
  struct: 11,
  typeParameter: 12,
  parameter: 13,
  variable: 14,
  property: 15,
  enumMember: 16,
  event: 17,
  function: 18,
  method: 19,
  macro: 20,
  keyword: 21,
  modifier: 22,
  comment: 23,
  string: 24,
  number: 25,
  regexp: 26,
  operator: 27,
  decorator: 28,
} as const;

/**
 * Token types legend for LSP - must match TokenType order.
 */
export const tokenTypesLegend = Object.keys(TokenType);

/**
 * Token modifiers legend for LSP.
 */
export const tokenModifiersLegend: string[] = [];

/**
 * Map highlight.scm capture names to semantic token types.
 *
 * Note: Mustache delimiters ({{, }}, etc.) are NOT included here.
 * They are handled by the TextMate grammar instead, which gives
 * better theme compatibility for keyword.control coloring.
 */
const captureNameToTokenType: Record<string, number> = {
  // HTML tokens
  'tag': TokenType.tag,
  'tag.error': TokenType.tag,
  'attribute': TokenType.attributeName,
  'string': TokenType.attributeValue,
  'punctuation.bracket': TokenType.delimiter,
  // Mustache tokens
  'variable': TokenType.mustacheVariable,
  'keyword': TokenType.keyword,
  'comment': TokenType.comment,
  'constant': TokenType.tag, // DOCTYPE uses same color as tags
};

interface TokenInfo {
  row: number;
  col: number;
  length: number;
  tokenType: number;
}

/**
 * Build semantic tokens using tree-sitter query captures.
 */
export function buildSemanticTokens(tree: Tree, query: Query): SemanticTokensBuilder {
  const builder = new SemanticTokensBuilder();
  const captures = query.captures(tree.rootNode);

  // Collect all tokens first
  const tokens: TokenInfo[] = [];

  for (const capture of captures) {
    const { node, name } = capture;
    const tokenType = captureNameToTokenType[name];

    if (tokenType === undefined) {
      continue;
    }

    const startRow = node.startPosition.row;
    const endRow = node.endPosition.row;

    if (startRow === endRow) {
      // Single-line token
      const length = node.endPosition.column - node.startPosition.column;
      tokens.push({ row: startRow, col: node.startPosition.column, length, tokenType });
    } else {
      // Multi-line token: emit one token per line
      const text = node.text;
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length === 0) continue;

        const row = startRow + i;
        const col = i === 0 ? node.startPosition.column : 0;
        tokens.push({ row, col, length: line.length, tokenType });
      }
    }
  }

  // Sort tokens by position
  tokens.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  // Push tokens, skipping overlaps
  let lastRow = -1;
  let lastEnd = 0;

  for (const token of tokens) {
    // Reset tracking on new row
    if (token.row !== lastRow) {
      lastRow = token.row;
      lastEnd = 0;
    }

    // Skip if this token overlaps with previous
    if (token.col < lastEnd) {
      continue;
    }

    builder.push(token.row, token.col, token.length, token.tokenType, 0);
    lastEnd = token.col + token.length;
  }

  return builder;
}
