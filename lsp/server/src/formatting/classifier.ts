/**
 * Node classifier - determines how to format different node types.
 *
 * This module extracts the classification logic from the original formatter,
 * determining whether nodes are block-level, inline, or should preserve content.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getTagName } from './utils';

// HTML inline elements that should not cause line breaks
export const INLINE_ELEMENTS = new Set([
  'a',
  'abbr',
  'acronym',
  'b',
  'bdo',
  'big',
  'br',
  'button',
  'cite',
  'code',
  'dfn',
  'em',
  'i',
  'img',
  'input',
  'kbd',
  'label',
  'map',
  'object',
  'output',
  'q',
  'samp',
  'script',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'textarea',
  'time',
  'tt',
  'u',
  'var',
  'wbr',
]);

// Elements whose content should be preserved as-is
export const PRESERVE_CONTENT_ELEMENTS = new Set([
  'pre',
  'code',
  'textarea',
  'script',
  'style',
]);

/**
 * Check if a node represents a block-level element that should cause indentation.
 */
export function isBlockLevel(node: SyntaxNode): boolean {
  const type = node.type;

  // Mustache sections are block-level only if they contain block-level content
  if (type === 'mustache_section' || type === 'mustache_inverted_section') {
    return hasBlockContent(node);
  }

  // HTML elements depend on the tag name
  if (type === 'html_element') {
    const tagName = getTagName(node);
    return tagName ? !INLINE_ELEMENTS.has(tagName.toLowerCase()) : true;
  }

  // Script and style elements are block-level
  if (type === 'html_script_element' || type === 'html_style_element') {
    return true;
  }

  return false;
}

/**
 * Check if an HTML element is an inline element.
 */
export function isInlineElement(node: SyntaxNode): boolean {
  if (node.type !== 'html_element') {
    return false;
  }
  const tagName = getTagName(node);
  return tagName ? INLINE_ELEMENTS.has(tagName.toLowerCase()) : false;
}

/**
 * Check if element content should be preserved as-is.
 */
export function shouldPreserveContent(node: SyntaxNode): boolean {
  const type = node.type;

  if (type === 'html_script_element' || type === 'html_style_element') {
    return true;
  }

  if (type === 'html_element') {
    const tagName = getTagName(node);
    return tagName
      ? PRESERVE_CONTENT_ELEMENTS.has(tagName.toLowerCase())
      : false;
  }

  return false;
}

/**
 * Check if a mustache section contains any block-level content.
 * A section has block content if:
 * - It contains block-level HTML elements, OR
 * - It contains any HTML elements with implicit end tags (HTML crossing boundaries)
 */
export function hasBlockContent(sectionNode: SyntaxNode): boolean {
  const contentNodes = getContentNodes(sectionNode);

  // Check for implicit end tags first - this makes the section block-level
  if (hasImplicitEndTags(contentNodes)) {
    return true;
  }

  // Check for block-level elements
  for (const node of contentNodes) {
    if (isBlockLevelContent(node)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a node is block-level content (for determining mustache section treatment).
 */
export function isBlockLevelContent(node: SyntaxNode): boolean {
  const type = node.type;

  // Any HTML element is considered block-level content for mustache sections
  // This ensures {{#section}}<span>...</span>{{/section}} gets formatted as a block
  if (type === 'html_element') {
    return true;
  }

  // Script/style are block-level
  if (type === 'html_script_element' || type === 'html_style_element') {
    return true;
  }

  // Nested mustache sections - recurse
  if (type === 'mustache_section' || type === 'mustache_inverted_section') {
    return hasBlockContent(node);
  }

  // Text, interpolation, comments, etc. are inline
  return false;
}

/**
 * Get the content nodes from a mustache section (excluding begin/end tags).
 */
export function getContentNodes(sectionNode: SyntaxNode): SyntaxNode[] {
  const isInverted = sectionNode.type === 'mustache_inverted_section';
  const beginType = isInverted
    ? 'mustache_inverted_section_begin'
    : 'mustache_section_begin';
  const endType = isInverted
    ? 'mustache_inverted_section_end'
    : 'mustache_section_end';
  const contentNodes: SyntaxNode[] = [];

  for (let i = 0; i < sectionNode.childCount; i++) {
    const child = sectionNode.child(i);
    if (!child) continue;
    if (
      child.type !== beginType &&
      child.type !== endType &&
      child.type !== 'mustache_erroneous_section_end' &&
      child.type !== 'mustache_erroneous_inverted_section_end' &&
      !child.type.startsWith('_')
    ) {
      contentNodes.push(child);
    }
  }
  return contentNodes;
}

/**
 * Check if any HTML elements in the given nodes have implicit end tags
 * (forced closed by mustache section end rather than explicit </tag>).
 */
export function hasImplicitEndTags(nodes: SyntaxNode[]): boolean {
  for (const node of nodes) {
    if (hasImplicitEndTagsRecursive(node)) {
      return true;
    }
  }
  return false;
}

function hasImplicitEndTagsRecursive(node: SyntaxNode): boolean {
  // Check if this HTML element has a forced/implicit end tag
  if (node.type === 'html_element') {
    let hasStartTag = false;
    let hasEndTag = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (child.type === 'html_start_tag') hasStartTag = true;
      if (child.type === 'html_end_tag') hasEndTag = true;
      if (child.type === 'html_forced_end_tag') return true; // Explicit implicit end
    }
    // If there's a start tag but no end tag at all, it's implicit
    if (hasStartTag && !hasEndTag) return true;
  }

  // Check children recursively
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && hasImplicitEndTagsRecursive(child)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a node is part of a text flow (adjacent to non-whitespace text).
 * Nodes that are part of text flow should stay inline.
 */
export function isInTextFlow(
  node: SyntaxNode,
  index: number,
  nodes: SyntaxNode[]
): boolean {
  // Check previous sibling
  if (index > 0) {
    const prev = nodes[index - 1];
    if (prev.type === 'text' && prev.text.trim().length > 0) {
      return true;
    }
  }

  // Check next sibling
  if (index < nodes.length - 1) {
    const next = nodes[index + 1];
    if (next.type === 'text' && next.text.trim().length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an HTML element should stay inline.
 * Elements stay inline if they're part of a text flow or adjacent to other inline elements.
 */
export function shouldHtmlElementStayInline(
  node: SyntaxNode,
  index: number,
  nodes: SyntaxNode[]
): boolean {
  if (node.type !== 'html_element') {
    return false;
  }

  // If the element is part of a text flow, keep it inline
  if (isInTextFlow(node, index, nodes)) {
    return true;
  }

  // If adjacent to another inline HTML element, stay inline (e.g., <code>5</code><code>-17</code>)
  // Check if there's a chain of HTML elements with text - they should all stay inline together
  if (index > 0) {
    const prev = nodes[index - 1];
    if (prev.type === 'html_element' && isInTextFlow(prev, index - 1, nodes)) {
      return true;
    }
  }
  if (index < nodes.length - 1) {
    const next = nodes[index + 1];
    if (next.type === 'html_element' && isInTextFlow(next, index + 1, nodes)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if a node should be treated as block-level for formatting purposes.
 */
export function shouldTreatAsBlock(
  node: SyntaxNode,
  index: number,
  nodes: SyntaxNode[]
): boolean {
  const isHtmlElement =
    node.type === 'html_element' ||
    node.type === 'html_script_element' ||
    node.type === 'html_style_element';
  const isMustacheSection =
    node.type === 'mustache_section' ||
    node.type === 'mustache_inverted_section';

  return (
    (isHtmlElement && !shouldHtmlElementStayInline(node, index, nodes)) ||
    (isMustacheSection && !isInTextFlow(node, index, nodes)) ||
    (isBlockLevel(node) && !isInTextFlow(node, index, nodes))
  );
}
