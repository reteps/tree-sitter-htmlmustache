/**
 * Utility functions for formatting.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';

/**
 * Get the tag name from an HTML element node.
 */
export function getTagName(node: SyntaxNode): string | null {
  // Look for html_start_tag or html_self_closing_tag child
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_start_tag' || child.type === 'html_self_closing_tag') {
      // Find the html_tag_name within
      for (let j = 0; j < child.childCount; j++) {
        const tagChild = child.child(j);
        if (tagChild && tagChild.type === 'html_tag_name') {
          return tagChild.text;
        }
      }
    }
  }

  return null;
}

/**
 * Normalize text content - collapse horizontal whitespace while preserving line breaks.
 */
export function normalizeText(text: string): string {
  // Split by newlines, normalize each line, then rejoin
  // This preserves intentional line breaks while collapsing spaces
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, i, arr) => line || (i > 0 && i < arr.length - 1)) // Keep non-empty lines
    .join('\n');
}

/**
 * Get visible children of a node (excluding anonymous nodes starting with _).
 */
export function getVisibleChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.type.startsWith('_')) {
      children.push(child);
    }
  }
  return children;
}

/**
 * Calculate the indent level of a node based on its parent chain.
 */
export function calculateIndentLevel(
  node: SyntaxNode,
  isBlockLevel: (node: SyntaxNode) => boolean,
  hasImplicitEndTags: (nodes: SyntaxNode[]) => boolean,
  getContentNodes: (node: SyntaxNode) => SyntaxNode[]
): number {
  let level = 0;
  let current = node.parent;
  while (current) {
    if (isBlockLevel(current)) {
      // Mustache sections only increase indentation if they have complete HTML
      // (no implicit end tags crossing boundaries)
      if (
        current.type === 'mustache_section' ||
        current.type === 'mustache_inverted_section'
      ) {
        const contentNodes = getContentNodes(current);
        if (!hasImplicitEndTags(contentNodes)) {
          level++;
        }
      } else {
        level++;
      }
    }
    current = current.parent;
  }
  return level;
}

/**
 * Find the smallest node that contains the entire range.
 */
export function findContainingNode(
  node: SyntaxNode,
  startOffset: number,
  endOffset: number
): SyntaxNode | null {
  if (node.startIndex > endOffset || node.endIndex < startOffset) {
    return null;
  }

  // Check children first for a more specific match
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.startIndex <= startOffset && child.endIndex >= endOffset) {
      const deeper = findContainingNode(child, startOffset, endOffset);
      if (deeper) return deeper;
    }
  }

  // This node contains the range
  if (node.startIndex <= startOffset && node.endIndex >= endOffset) {
    return node;
  }

  return null;
}
