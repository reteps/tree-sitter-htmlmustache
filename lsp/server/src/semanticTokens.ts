import { Node as SyntaxNode } from 'web-tree-sitter';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import type { Tree, Query } from './parser';

/**
 * Semantic token types supported by this server.
 * These map to VS Code's built-in semantic token types.
 */
export const tokenTypes = [
  'namespace',    // 0  - mustache helpers
  'type',         // 1  - HTML tag names
  'class',        // 2  -
  'enum',         // 3  -
  'interface',    // 4  -
  'struct',       // 5  -
  'typeParameter',// 6  -
  'parameter',    // 7  - mustache section names
  'variable',     // 8  - mustache identifiers
  'property',     // 9  - HTML attributes
  'enumMember',   // 10 -
  'event',        // 11 -
  'function',     // 12 -
  'method',       // 13 -
  'macro',        // 14 - mustache partials
  'keyword',      // 15 - mustache delimiters
  'modifier',     // 16 -
  'comment',      // 17 - comments
  'string',       // 18 - attribute values
  'number',       // 19 -
  'regexp',       // 20 -
  'operator',     // 21 - mustache operators (# ^ / >)
  'decorator',    // 22 -
] as const;

/**
 * Semantic token modifiers.
 */
export const tokenModifiers = [
  'declaration',
  'definition',
  'readonly',
  'deprecated',
  'modification',
  'documentation',
] as const;

export const tokenTypesLegend = tokenTypes as unknown as string[];
export const tokenModifiersLegend = tokenModifiers as unknown as string[];

// Map tree-sitter node types to semantic token types
const nodeTypeToTokenType: Record<string, number> = {
  // HTML tokens
  'html_tag_name': 1,              // type
  'html_attribute_name': 9,        // property
  'html_attribute_value': 18,      // string
  'html_comment': 17,              // comment
  'html_erroneous_end_tag_name': 1,// type (with error modifier ideally)

  // Mustache tokens
  'mustache_tag_name': 7,          // parameter
  'mustache_erroneous_tag_name': 7,// parameter
  'mustache_identifier': 8,        // variable
  'mustache_path_expression': 8,   // variable
  'mustache_comment': 17,          // comment
  'mustache_comment_content': 17,  // comment
  'mustache_partial_content': 14,  // macro
};

// Mustache delimiters to highlight
const mustacheDelimiters = new Set([
  '{{', '}}', '{{{', '}}}', '{{!', '{{>', '{{#', '{{/', '{{^',
]);

/**
 * Build semantic tokens for a parsed document.
 */
export function buildSemanticTokens(tree: Tree, text: string): SemanticTokensBuilder {
  const builder = new SemanticTokensBuilder();

  // Walk the tree and collect tokens
  walkTree(tree.rootNode, builder, text);

  return builder;
}

function walkTree(
  node: SyntaxNode,
  builder: SemanticTokensBuilder,
  text: string
): void {
  const nodeType = node.type;

  // Check if this node type should be highlighted
  const tokenType = nodeTypeToTokenType[nodeType];

  if (tokenType !== undefined) {
    // Add token for this node
    const startPosition = node.startPosition;
    const length = node.endIndex - node.startIndex;

    // SemanticTokensBuilder.push expects: line, char, length, tokenType, tokenModifiers
    builder.push(
      startPosition.row,
      startPosition.column,
      length,
      tokenType,
      0 // No modifiers for now
    );
  }

  // Check for mustache delimiters (literal tokens)
  if (mustacheDelimiters.has(nodeType)) {
    const startPosition = node.startPosition;
    const length = node.endIndex - node.startIndex;
    builder.push(
      startPosition.row,
      startPosition.column,
      length,
      21, // operator
      0
    );
  }

  // Recursively process children
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkTree(child, builder, text);
    }
  }
}

/**
 * Alternative: Use tree-sitter queries for highlighting.
 * This uses your highlights.scm file directly.
 */
export function buildSemanticTokensWithQuery(
  tree: Tree,
  query: Query,
  _text: string
): SemanticTokensBuilder {
  const builder = new SemanticTokensBuilder();

  const captures = query.captures(tree.rootNode);

  for (const capture of captures) {
    const { node, name } = capture;
    const tokenType = captureNameToTokenType(name);

    if (tokenType !== undefined) {
      builder.push(
        node.startPosition.row,
        node.startPosition.column,
        node.endIndex - node.startIndex,
        tokenType,
        0
      );
    }
  }

  return builder;
}

/**
 * Map highlight.scm capture names to semantic token types.
 */
function captureNameToTokenType(captureName: string): number | undefined {
  const mapping: Record<string, number> = {
    'tag': 1,               // type
    'tag.error': 1,         // type
    'attribute': 9,         // property
    'string': 18,           // string
    'comment': 17,          // comment
    'constant': 15,         // keyword (for doctype)
    'punctuation.bracket': 21, // operator
    'variable': 8,          // variable
    'keyword': 15,          // keyword
    'function': 12,         // function
  };

  return mapping[captureName];
}
