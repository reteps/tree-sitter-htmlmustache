/**
 * Node classifier - determines how to format different node types.
 *
 * This module uses CSS display values to classify HTML elements, matching
 * Prettier's approach to whitespace sensitivity in HTML formatting.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getTagName } from './utils';

// Module-level custom code tags configuration
let customCodeTags: Set<string> = new Set();

export function setCustomCodeTags(tags: string[]): void {
  customCodeTags = new Set(tags.map((t) => t.toLowerCase()));
}

export function getCustomCodeTags(): Set<string> {
  return customCodeTags;
}

export type CSSDisplay =
  | 'block'
  | 'inline'
  | 'inline-block'
  | 'table-row'
  | 'table-cell'
  | 'table'
  | 'table-row-group'
  | 'table-header-group'
  | 'table-footer-group'
  | 'table-column'
  | 'table-column-group'
  | 'table-caption'
  | 'list-item'
  | 'ruby'
  | 'ruby-base'
  | 'ruby-text'
  | 'none';

/**
 * Default CSS display values for HTML elements, matching browser defaults.
 * Elements not in this map default to 'inline'.
 */
const CSS_DISPLAY_MAP: Record<string, CSSDisplay> = {
  // Block elements
  address: 'block',
  article: 'block',
  aside: 'block',
  blockquote: 'block',
  body: 'block',
  center: 'block',
  dd: 'block',
  details: 'block',
  dialog: 'block',
  dir: 'block',
  div: 'block',
  dl: 'block',
  dt: 'block',
  fieldset: 'block',
  figcaption: 'block',
  figure: 'block',
  footer: 'block',
  form: 'block',
  h1: 'block',
  h2: 'block',
  h3: 'block',
  h4: 'block',
  h5: 'block',
  h6: 'block',
  header: 'block',
  hgroup: 'block',
  hr: 'block',
  html: 'block',
  legend: 'block',
  listing: 'block',
  main: 'block',
  menu: 'block',
  nav: 'block',
  ol: 'block',
  p: 'block',
  plaintext: 'block',
  pre: 'block',
  search: 'block',
  section: 'block',
  summary: 'block',
  ul: 'block',
  xmp: 'block',

  // List items
  li: 'list-item',

  // Table elements
  table: 'table',
  caption: 'table-caption',
  colgroup: 'table-column-group',
  col: 'table-column',
  thead: 'table-header-group',
  tbody: 'table-row-group',
  tfoot: 'table-footer-group',
  tr: 'table-row',
  td: 'table-cell',
  th: 'table-cell',

  // Inline-block elements
  button: 'inline-block',
  img: 'inline-block',
  input: 'inline-block',
  select: 'inline-block',
  textarea: 'inline-block',
  video: 'inline-block',
  audio: 'inline-block',
  canvas: 'inline-block',
  embed: 'inline-block',
  iframe: 'inline-block',
  object: 'inline-block',

  // None
  head: 'none',
  link: 'none',
  meta: 'none',
  script: 'none',
  style: 'none',
  title: 'none',
  template: 'none',

  // Ruby
  ruby: 'ruby',
  rb: 'ruby-base',
  rt: 'ruby-text',
  rp: 'none',
};

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
 * Get the CSS display value for a node.
 */
export function getCSSDisplay(node: SyntaxNode): CSSDisplay {
  const type = node.type;

  if (type === 'html_element') {
    const tagName = getTagName(node);
    if (tagName) {
      if (customCodeTags.has(tagName.toLowerCase())) {
        return 'block';
      }
      return CSS_DISPLAY_MAP[tagName.toLowerCase()] ?? 'inline';
    }
    return 'block'; // Unknown elements default to block
  }

  if (
    type === 'html_script_element' ||
    type === 'html_style_element' ||
    type === 'html_raw_element'
  ) {
    return 'block';
  }

  if (type === 'mustache_section' || type === 'mustache_inverted_section') {
    return hasBlockContent(node) ? 'block' : 'inline';
  }

  // Text, interpolation, comments, etc. are inline
  return 'inline';
}

/**
 * Check if a display value means the element is whitespace-insensitive
 * (i.e., we can freely add/remove whitespace around it).
 */
export function isWhitespaceInsensitive(display: CSSDisplay): boolean {
  switch (display) {
    case 'block':
    case 'list-item':
    case 'table':
    case 'table-row':
    case 'table-row-group':
    case 'table-header-group':
    case 'table-footer-group':
    case 'table-column':
    case 'table-column-group':
    case 'table-caption':
    case 'table-cell':
    case 'none':
      return true;
    default:
      return false;
  }
}

/**
 * Check if a node represents a block-level element that should cause indentation.
 * Delegates to getCSSDisplay for classification.
 */
export function isBlockLevel(node: SyntaxNode): boolean {
  const type = node.type;

  // Mustache sections are block-level only if they contain block-level content
  if (type === 'mustache_section' || type === 'mustache_inverted_section') {
    return hasBlockContent(node);
  }

  // HTML elements: check CSS display
  if (type === 'html_element') {
    const display = getCSSDisplay(node);
    return isWhitespaceInsensitive(display);
  }

  // Script, style, and raw elements are block-level
  if (
    type === 'html_script_element' ||
    type === 'html_style_element' ||
    type === 'html_raw_element'
  ) {
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
  const display = getCSSDisplay(node);
  return !isWhitespaceInsensitive(display);
}

/**
 * Check if element content should be preserved as-is.
 */
export function shouldPreserveContent(node: SyntaxNode): boolean {
  const type = node.type;

  if (
    type === 'html_script_element' ||
    type === 'html_style_element' ||
    type === 'html_raw_element'
  ) {
    return true;
  }

  if (type === 'html_element') {
    const tagName = getTagName(node);
    if (!tagName) return false;
    const lower = tagName.toLowerCase();
    return PRESERVE_CONTENT_ELEMENTS.has(lower) || customCodeTags.has(lower);
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

  // Script/style/raw are block-level
  if (
    type === 'html_script_element' ||
    type === 'html_style_element' ||
    type === 'html_raw_element'
  ) {
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
    let hasContentChildren = false;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      if (child.type === 'html_start_tag') hasStartTag = true;
      else if (child.type === 'html_end_tag') hasEndTag = true;
      else if (child.type === 'html_forced_end_tag') return true;
      else if (!child.type.startsWith('_')) hasContentChildren = true;
    }
    // Void elements (start tag only, no content, no end tag) aren't boundary-crossing
    if (hasStartTag && !hasEndTag && hasContentChildren) return true;
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
 * Check if a node is inline content that participates in text flow.
 * Mustache interpolation, triple, and partial nodes behave like text.
 */
function isInlineContentNode(node: SyntaxNode): boolean {
  if (node.type === 'text') return node.text.trim().length > 0;
  return (
    node.type === 'mustache_interpolation' ||
    node.type === 'mustache_triple' ||
    node.type === 'mustache_partial'
  );
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
 * Check if there's inline content (mustache interpolation, non-empty text, etc.)
 * adjacent to the node at `index`, looking past whitespace-only text nodes.
 */
function hasAdjacentInlineContent(
  index: number,
  nodes: SyntaxNode[]
): boolean {
  // Look backward past whitespace-only text
  for (let i = index - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.type === 'text' && n.text.trim().length === 0) continue;
    if (isInlineContentNode(n)) return true;
    break;
  }
  // Look forward past whitespace-only text
  for (let i = index + 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'text' && n.text.trim().length === 0) continue;
    if (isInlineContentNode(n)) return true;
    break;
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

  // Check for adjacent inline content (mustache interpolation, text, etc.)
  // past whitespace-only text nodes — e.g., <i>icon</i>\n    {{partial}}%
  if (hasAdjacentInlineContent(index, nodes)) {
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
    node.type === 'html_style_element' ||
    node.type === 'html_raw_element';
  const isMustacheSection =
    node.type === 'mustache_section' ||
    node.type === 'mustache_inverted_section';

  return (
    (isHtmlElement && !shouldHtmlElementStayInline(node, index, nodes)) ||
    (isMustacheSection && !isInTextFlow(node, index, nodes)) ||
    (isBlockLevel(node) && !isInTextFlow(node, index, nodes))
  );
}
