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
(mustache_comment) @comment

[
  "{{"
  "}}"
  "{{{"
  "}}}"
  "{{!"
  "{{>"
  "{{#"
  "{{/"
  "{{^"
] @keyword
`;

/**
 * Semantic token types - these are VS Code's standard types.
 * The order matters as it defines the index used in the protocol.
 */
const TokenType = {
  namespace: 0,
  type: 1,
  class: 2,
  enum: 3,
  interface: 4,
  struct: 5,
  typeParameter: 6,
  parameter: 7,
  variable: 8,
  property: 9,
  enumMember: 10,
  event: 11,
  function: 12,
  method: 13,
  macro: 14,
  keyword: 15,
  modifier: 16,
  comment: 17,
  string: 18,
  number: 19,
  regexp: 20,
  operator: 21,
  decorator: 22,
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
 */
const captureNameToTokenType: Record<string, number> = {
  'tag': TokenType.type,
  'tag.error': TokenType.type,
  'attribute': TokenType.property,
  'string': TokenType.string,
  'comment': TokenType.comment,
  'constant': TokenType.keyword,
  'punctuation.bracket': TokenType.operator,
  'variable': TokenType.variable,
  'keyword': TokenType.keyword,
};

/**
 * Build semantic tokens using tree-sitter query captures.
 */
export function buildSemanticTokens(tree: Tree, query: Query): SemanticTokensBuilder {
  const builder = new SemanticTokensBuilder();
  const captures = query.captures(tree.rootNode);

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
      builder.push(startRow, node.startPosition.column, length, tokenType, 0);
    } else {
      // Multi-line token: emit one token per line
      const text = node.text;
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length === 0) continue;

        const row = startRow + i;
        const col = i === 0 ? node.startPosition.column : 0;
        builder.push(row, col, line.length, tokenType, 0);
      }
    }
  }

  return builder;
}
