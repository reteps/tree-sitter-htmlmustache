/**
 * Shared node helper functions and type constants for working with
 * tree-sitter syntax nodes across the LSP and CLI.
 *
 * Uses a minimal interface compatible with both web-tree-sitter's SyntaxNode
 * and the BalanceNode interface from htmlBalanceChecker.
 */

/** Minimal node interface compatible with both SyntaxNode and BalanceNode. */
export interface MinimalNode {
  type: string;
  text: string;
  children: MinimalNode[];
}

// --- Node type constants ---

export const MUSTACHE_SECTION_TYPES = new Set([
  'mustache_section',
  'mustache_inverted_section',
]);

export const RAW_CONTENT_ELEMENT_TYPES = new Set([
  'html_script_element',
  'html_style_element',
  'html_raw_element',
]);

export const HTML_ELEMENT_TYPES = new Set([
  'html_element',
  'html_script_element',
  'html_style_element',
  'html_raw_element',
]);

// --- Node type predicates ---

export function isMustacheSection(node: MinimalNode): boolean {
  return MUSTACHE_SECTION_TYPES.has(node.type);
}

export function isRawContentElement(node: MinimalNode): boolean {
  return RAW_CONTENT_ELEMENT_TYPES.has(node.type);
}

export function isHtmlElementType(node: MinimalNode): boolean {
  return HTML_ELEMENT_TYPES.has(node.type);
}

// --- Node name extraction ---

/**
 * Get the tag name from an HTML element node.
 * Works with any node that has children with type 'html_start_tag' or
 * 'html_self_closing_tag' containing an 'html_tag_name' child.
 */
export function getTagName(node: MinimalNode): string | null {
  for (const child of node.children) {
    if (child.type === 'html_start_tag' || child.type === 'html_self_closing_tag') {
      const tagNameNode = child.children.find(c => c.type === 'html_tag_name');
      if (tagNameNode) return tagNameNode.text;
    }
  }
  return null;
}

/**
 * Get the section name from a mustache section node.
 * Looks for mustache_tag_name inside mustache_section_begin or
 * mustache_inverted_section_begin.
 */
export function getSectionName(node: MinimalNode): string | null {
  const beginNode = node.children.find(
    c => c.type === 'mustache_section_begin' || c.type === 'mustache_inverted_section_begin',
  );
  if (!beginNode) return null;
  const tagNameNode = beginNode.children.find(c => c.type === 'mustache_tag_name');
  return tagNameNode?.text ?? null;
}

/**
 * Get the tag name from an erroneous end tag node.
 */
export function getErroneousEndTagName(node: MinimalNode): string | null {
  const nameNode = node.children.find(c => c.type === 'html_erroneous_end_tag_name');
  return nameNode?.text?.toLowerCase() ?? null;
}
