import Parser from 'web-tree-sitter';
import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';

/**
 * Extract folding ranges from the syntax tree.
 * Allows collapsing HTML elements, Mustache sections, and comments.
 */
export function getFoldingRanges(tree: Parser.Tree): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  walkForFolding(tree.rootNode, ranges);

  return ranges;
}

function walkForFolding(node: Parser.SyntaxNode, ranges: FoldingRange[]): void {
  const range = nodeToFoldingRange(node);

  if (range) {
    ranges.push(range);
  }

  // Recursively check children
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      walkForFolding(child, ranges);
    }
  }
}

function nodeToFoldingRange(node: Parser.SyntaxNode): FoldingRange | null {
  const type = node.type;

  // Only fold multi-line nodes
  if (node.startPosition.row === node.endPosition.row) {
    return null;
  }

  // HTML elements
  if (type === 'html_element' || type === 'html_script_element' || type === 'html_style_element') {
    return {
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      kind: FoldingRangeKind.Region,
    };
  }

  // Mustache sections
  if (type === 'mustache_section' || type === 'mustache_inverted_section') {
    return {
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      kind: FoldingRangeKind.Region,
    };
  }

  // HTML comments
  if (type === 'html_comment') {
    return {
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      kind: FoldingRangeKind.Comment,
    };
  }

  // Mustache comments
  if (type === 'mustache_comment') {
    return {
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      kind: FoldingRangeKind.Comment,
    };
  }

  return null;
}
