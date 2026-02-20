/**
 * Utility functions for formatting.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';

// Re-export getTagName from the canonical location
export { getTagName } from '../nodeHelpers';

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
 * Normalize whitespace inside a single mustache expression.
 * Handles triple ({{{...}}}), prefixed ({{#, {{/, {{^, {{!, {{>), and plain ({{...}}).
 * For multiline comments, preserves internal newlines, only normalizes space adjacent to delimiters.
 */
export function normalizeMustacheWhitespace(raw: string, addSpaces: boolean): string {
  const space = addSpaces ? ' ' : '';

  // Triple mustache: {{{...}}}
  const tripleMatch = raw.match(/^\{\{\{([\s\S]*)\}\}\}$/);
  if (tripleMatch) {
    const inner = tripleMatch[1].trim();
    return `{{{${space}${inner}${space}}}}`;
  }

  // Prefixed: {{#, {{/, {{^, {{!, {{>
  const prefixedMatch = raw.match(/^\{\{([#/^!>])([\s\S]*)\}\}$/);
  if (prefixedMatch) {
    const prefix = prefixedMatch[1];
    const inner = prefixedMatch[2];

    // Multiline comments: preserve internal newlines, always use spaces
    if (prefix === '!' && inner.includes('\n')) {
      const lines = inner.split('\n');
      const first = lines[0].trimStart();
      const last = lines[lines.length - 1].trimEnd();
      if (lines.length === 1) {
        return `{{${prefix} ${first} }}`;
      }
      const middle = lines.slice(1, -1);
      return `{{${prefix} ${first}\n${middle.join('\n')}\n${last} }}`;
    }

    const trimmed = inner.trim();
    // Comments always get spaces for readability, regardless of mustacheSpaces setting
    const s = prefix === '!' ? ' ' : space;
    return `{{${prefix}${s}${trimmed}${s}}}`;
  }

  // Plain: {{...}}
  const plainMatch = raw.match(/^\{\{([\s\S]*)\}\}$/);
  if (plainMatch) {
    const inner = plainMatch[1].trim();
    return `{{${space}${inner}${space}}}`;
  }

  return raw;
}

/**
 * Normalize whitespace in ALL mustache expressions within a string.
 * Used for force-inlined sections where the full section text (e.g. `{{#plural}}s{{/plural}}`)
 * is emitted as one string.
 */
export function normalizeMustacheWhitespaceAll(raw: string, addSpaces: boolean): string {
  // Match triple mustache first, then double
  return raw.replace(/\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g, (match) => {
    return normalizeMustacheWhitespace(match, addSpaces);
  });
}

/**
 * Check if a node is a format-ignore directive comment.
 * Returns the directive type or null if not a directive.
 */
export function getIgnoreDirective(
  node: SyntaxNode
): 'ignore' | 'ignore-start' | 'ignore-end' | null {
  if (node.type !== 'html_comment' && node.type !== 'mustache_comment') {
    return null;
  }

  let inner: string | null = null;

  if (node.type === 'html_comment') {
    // <!-- ... -->
    const match = node.text.match(/^<!--([\s\S]*)-->$/);
    if (match) {
      inner = match[1].trim();
    }
  } else {
    // {{! ... }}
    const match = node.text.match(/^\{\{!([\s\S]*)\}\}$/);
    if (match) {
      inner = match[1].trim();
    }
  }

  if (!inner) return null;

  if (inner === 'htmlmustache-ignore') return 'ignore';
  if (inner === 'htmlmustache-ignore-start') return 'ignore-start';
  if (inner === 'htmlmustache-ignore-end') return 'ignore-end';

  return null;
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
