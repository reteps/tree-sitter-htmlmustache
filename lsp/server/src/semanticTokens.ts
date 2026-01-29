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
 * Query to find raw text content in script and style tags.
 * Used to scan for Mustache patterns that the tree-sitter parser
 * doesn't recognize (since they appear inside raw text nodes).
 */
export const RAW_TEXT_QUERY = `
(html_script_element (html_raw_text) @raw)
(html_style_element (html_raw_text) @raw)
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
 * Regex patterns for detecting Mustache syntax in raw text (script/style tags).
 * Each pattern captures: opening delimiter, content, closing delimiter.
 * Order matters - more specific patterns (triple mustache) must come before general ones.
 *
 * Token types match the regular Mustache highlighting:
 * - Variables/unescaped: keyword delimiters, variable content
 * - Sections: keyword delimiters, variable content
 * - Partials: keyword delimiters, variable content
 * - Comments: comment for entire construct
 */
interface MustachePattern {
  pattern: RegExp;
  openLen: number;
  closeLen: number;
  delimiterType: number;
  contentType: number;
}

const MUSTACHE_PATTERNS: MustachePattern[] = [
  // {{{...}}} unescaped - keyword delimiters, variable content
  { pattern: /\{\{\{([^}]*)\}\}\}/g, openLen: 3, closeLen: 3, delimiterType: TokenType.keyword, contentType: TokenType.mustacheVariable },
  // {{#...}} section start - keyword delimiters, variable content
  { pattern: /\{\{#([^}]*)\}\}/g, openLen: 3, closeLen: 2, delimiterType: TokenType.keyword, contentType: TokenType.mustacheVariable },
  // {{/...}} section end - keyword delimiters, variable content
  { pattern: /\{\{\/([^}]*)\}\}/g, openLen: 3, closeLen: 2, delimiterType: TokenType.keyword, contentType: TokenType.mustacheVariable },
  // {{^...}} inverted section - keyword delimiters, variable content
  { pattern: /\{\{\^([^}]*)\}\}/g, openLen: 3, closeLen: 2, delimiterType: TokenType.keyword, contentType: TokenType.mustacheVariable },
  // {{>...}} partial - keyword delimiters, variable content
  { pattern: /\{\{>([^}]*)\}\}/g, openLen: 3, closeLen: 2, delimiterType: TokenType.keyword, contentType: TokenType.mustacheVariable },
  // {{!...}} comment - all comment colored
  { pattern: /\{\{!([^}]*)\}\}/g, openLen: 3, closeLen: 2, delimiterType: TokenType.comment, contentType: TokenType.comment },
  // {{...}} variable (no special char after {{) - keyword delimiters, variable content
  { pattern: /\{\{([^#\/^>!{}][^}]*)\}\}/g, openLen: 2, closeLen: 2, delimiterType: TokenType.keyword, contentType: TokenType.mustacheVariable },
];

/**
 * Convert a character offset within text to row/col position,
 * given a starting row/col for the text.
 */
function offsetToPosition(
  text: string,
  offset: number,
  startRow: number,
  startCol: number
): { row: number; col: number } {
  let row = startRow;
  let col = startCol;

  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      row++;
      col = 0;
    } else {
      col++;
    }
  }

  return { row, col };
}

/**
 * Scan raw text (e.g., inside <script> or <style> tags) for Mustache patterns
 * and add tokens for each match. Emits separate tokens for delimiters and content.
 */
function scanMustacheInRawText(
  text: string,
  startRow: number,
  startCol: number,
  tokens: TokenInfo[]
): void {
  // Track matched ranges to avoid duplicates from overlapping patterns
  const matched = new Set<string>();

  for (const { pattern, openLen, closeLen, delimiterType, contentType } of MUSTACHE_PATTERNS) {
    // Reset regex state for each pattern
    pattern.lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const key = `${match.index}:${match[0].length}`;
      if (matched.has(key)) continue;
      matched.add(key);

      const content = match[1] || '';
      const totalLen = match[0].length;

      // Opening delimiter token (e.g., "{{", "{{{", "{{#")
      const openPos = offsetToPosition(text, match.index, startRow, startCol);
      tokens.push({
        row: openPos.row,
        col: openPos.col,
        length: openLen,
        tokenType: delimiterType,
      });

      // Content token (variable name) - only if non-empty
      if (content.length > 0) {
        const contentPos = offsetToPosition(text, match.index + openLen, startRow, startCol);
        tokens.push({
          row: contentPos.row,
          col: contentPos.col,
          length: content.length,
          tokenType: contentType,
        });
      }

      // Closing delimiter token (e.g., "}}", "}}}")
      const closePos = offsetToPosition(text, match.index + totalLen - closeLen, startRow, startCol);
      tokens.push({
        row: closePos.row,
        col: closePos.col,
        length: closeLen,
        tokenType: delimiterType,
      });
    }
  }
}

/**
 * Build semantic tokens using tree-sitter query captures.
 */
export function buildSemanticTokens(tree: Tree, query: Query, rawTextQuery?: Query): SemanticTokensBuilder {
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

  // Scan raw text in script/style tags for Mustache patterns
  if (rawTextQuery) {
    const rawCaptures = rawTextQuery.captures(tree.rootNode);
    for (const capture of rawCaptures) {
      const node = capture.node;
      scanMustacheInRawText(
        node.text,
        node.startPosition.row,
        node.startPosition.column,
        tokens
      );
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
