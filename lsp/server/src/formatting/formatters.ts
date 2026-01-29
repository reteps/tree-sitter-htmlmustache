/**
 * Formatters - convert AST nodes to Doc IR.
 *
 * This module contains functions that convert tree-sitter AST nodes
 * to the Doc intermediate representation for formatting.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { Doc, concat, hardline, indent, text, empty } from './ir';
import {
  isBlockLevel,
  shouldPreserveContent,
  hasImplicitEndTags,
  isInTextFlow,
  shouldTreatAsBlock,
  INLINE_ELEMENTS,
} from './classifier';
import { getTagName, normalizeText, getVisibleChildren } from './utils';

export interface FormatterContext {
  document: TextDocument;
}

/**
 * Format the document root node.
 */
export function formatDocument(node: SyntaxNode, context: FormatterContext): Doc {
  const children = getVisibleChildren(node);
  const content = formatBlockChildren(children, context);
  return concat([content, hardline]);
}

/**
 * Format a node based on its type.
 * @param forceInline - If true, format as inline even if content would normally be block-level
 */
export function formatNode(
  node: SyntaxNode,
  context: FormatterContext,
  forceInline = false
): Doc {
  const type = node.type;

  switch (type) {
    case 'document':
      return formatDocument(node, context);

    case 'html_element':
      return formatHtmlElement(node, context);

    case 'html_script_element':
    case 'html_style_element':
      return formatScriptStyleElement(node, context);

    case 'mustache_section':
    case 'mustache_inverted_section':
      if (forceInline) {
        // Inline mustache section - preserve as-is
        return text(node.text);
      }
      return formatMustacheSection(node, context);

    case 'mustache_interpolation':
    case 'mustache_triple':
    case 'mustache_partial':
    case 'mustache_comment':
    case 'html_comment':
    case 'html_doctype':
    case 'html_entity':
    case 'html_erroneous_end_tag':
      return text(node.text);

    case 'text':
      return formatText(node);

    default:
      return text(node.text);
  }
}

/**
 * Format a text node.
 */
export function formatText(node: SyntaxNode): Doc {
  return text(normalizeText(node.text));
}

/**
 * Format an HTML element.
 */
export function formatHtmlElement(node: SyntaxNode, context: FormatterContext): Doc {
  const tagName = getTagName(node);
  const isInline = tagName ? INLINE_ELEMENTS.has(tagName.toLowerCase()) : false;
  const preserveContent = shouldPreserveContent(node);

  // Self-closing tag
  const selfClosing =
    node.childCount === 1 && node.child(0)?.type === 'html_self_closing_tag';

  if (selfClosing) {
    const tag = node.child(0)!;
    return formatStartTag(tag);
  }

  // Get start tag, children, and end tag
  let startTag: SyntaxNode | null = null;
  let endTag: SyntaxNode | null = null;
  let hasRealEndTag = false;
  const contentNodes: SyntaxNode[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_start_tag') {
      startTag = child;
    } else if (child.type === 'html_end_tag') {
      endTag = child;
      hasRealEndTag = true;
    } else if (child.type === 'html_forced_end_tag') {
      endTag = child;
      // hasRealEndTag stays false - forced end tags shouldn't cause extra formatting
    } else if (!child.type.startsWith('_')) {
      contentNodes.push(child);
    }
  }

  const parts: Doc[] = [];

  // Format start tag
  if (startTag) {
    parts.push(formatStartTag(startTag));
  }

  // Check if content contains any HTML element children (including inline elements)
  // If an inline element contains other HTML elements, format it as a block for readability
  const hasHtmlElementChildren = contentNodes.some(
    (child) =>
      child.type === 'html_element' ||
      child.type === 'html_script_element' ||
      child.type === 'html_style_element' ||
      isBlockLevel(child)
  );

  // Handle content
  if (preserveContent) {
    // Preserve content as-is for pre, code, script, style, etc.
    for (const child of contentNodes) {
      parts.push(text(child.text));
    }
  } else if (isInline && !hasHtmlElementChildren) {
    // Inline element with only text/interpolation content - format without extra newlines
    for (const child of contentNodes) {
      parts.push(formatNode(child, context));
    }
  } else {
    // Block element - add newlines and indentation
    const formattedContent = formatBlockChildren(contentNodes, context);
    const hasContent = hasDocContent(formattedContent);

    if (hasContent) {
      // Put hardline INSIDE indent so content gets indented
      parts.push(indent(concat([hardline, formattedContent])));
      // Only add closing indent if there's a real end tag (not a forced/implicit one)
      if (hasRealEndTag) {
        parts.push(hardline);
      }
    } else if (contentNodes.length === 0 && hasRealEndTag) {
      // Empty block element with end tag - add newline for readability
      parts.push(hardline);
    }
  }

  // Format end tag
  if (endTag) {
    parts.push(formatEndTag(endTag));
  }

  return concat(parts);
}

/**
 * Format script or style element - preserves raw content.
 */
export function formatScriptStyleElement(
  node: SyntaxNode,
  _context: FormatterContext
): Doc {
  const parts: Doc[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_start_tag') {
      parts.push(formatStartTag(child));
    } else if (child.type === 'html_end_tag') {
      parts.push(formatEndTag(child));
    } else if (child.type === 'html_raw_text') {
      parts.push(text(child.text));
    }
  }

  return concat(parts);
}

/**
 * Format a mustache section ({{#...}} or {{^...}}).
 */
export function formatMustacheSection(
  node: SyntaxNode,
  context: FormatterContext
): Doc {
  const isInverted = node.type === 'mustache_inverted_section';
  const beginType = isInverted
    ? 'mustache_inverted_section_begin'
    : 'mustache_section_begin';
  const endType = isInverted
    ? 'mustache_inverted_section_end'
    : 'mustache_section_end';

  let beginNode: SyntaxNode | null = null;
  let endNode: SyntaxNode | null = null;
  const contentNodes: SyntaxNode[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === beginType) {
      beginNode = child;
    } else if (
      child.type === endType ||
      child.type === 'mustache_erroneous_section_end' ||
      child.type === 'mustache_erroneous_inverted_section_end'
    ) {
      endNode = child;
    } else if (!child.type.startsWith('_')) {
      contentNodes.push(child);
    }
  }

  const parts: Doc[] = [];

  // Opening tag
  if (beginNode) {
    parts.push(text(beginNode.text));
  }

  // Determine indentation: if content has implicit end tags (HTML crossing mustache
  // boundaries), don't indent. Otherwise, indent normally.
  const hasImplicit = hasImplicitEndTags(contentNodes);
  const formattedContent = formatBlockChildren(contentNodes, context);
  const hasContent = hasDocContent(formattedContent);

  if (hasContent) {
    if (hasImplicit) {
      // No indent for content with implicit end tags
      parts.push(hardline);
      parts.push(formattedContent);
      parts.push(hardline);
    } else {
      // Put hardline INSIDE indent so content gets indented
      parts.push(indent(concat([hardline, formattedContent])));
      parts.push(hardline);
    }
  }

  // Closing tag
  if (endNode) {
    parts.push(text(endNode.text));
  }

  return concat(parts);
}

/**
 * Format a start tag with attributes.
 */
export function formatStartTag(node: SyntaxNode): Doc {
  const parts: Doc[] = [text('<')];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_tag_name') {
      parts.push(text(child.text));
    } else if (child.type === 'html_attribute') {
      parts.push(text(' '));
      parts.push(formatAttribute(child));
    } else if (child.type === 'mustache_attribute') {
      parts.push(text(' '));
      parts.push(text(child.text));
    }
  }

  // Check if self-closing
  if (node.type === 'html_self_closing_tag') {
    parts.push(text(' />'));
  } else {
    parts.push(text('>'));
  }

  return concat(parts);
}

/**
 * Format an end tag.
 */
export function formatEndTag(node: SyntaxNode): Doc {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && child.type === 'html_tag_name') {
      return text('</' + child.text + '>');
    }
  }
  return text(node.text);
}

/**
 * Format an HTML attribute.
 */
export function formatAttribute(node: SyntaxNode): Doc {
  const parts: Doc[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_attribute_name') {
      parts.push(text(child.text));
    } else if (child.type === 'html_attribute_value') {
      parts.push(text('='));
      parts.push(text(child.text));
    } else if (child.type === 'html_quoted_attribute_value') {
      parts.push(text('='));
      parts.push(text(child.text));
    } else if (child.type === 'mustache_interpolation') {
      parts.push(text('='));
      parts.push(text(child.text));
    }
  }

  return concat(parts);
}

/**
 * Format block-level children (handles text flow and indentation).
 */
export function formatBlockChildren(
  nodes: SyntaxNode[],
  context: FormatterContext
): Doc {
  const lines: Doc[] = [];
  let currentLine: Doc[] = [];
  let lastNodeEnd = -1;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    const treatAsBlock = shouldTreatAsBlock(node, i, nodes);

    // Check for whitespace between nodes in original document
    if (lastNodeEnd >= 0 && node.startIndex > lastNodeEnd) {
      const prevNode = nodes[i - 1];
      const prevTreatAsBlock = shouldTreatAsBlock(prevNode, i - 1, nodes);

      // If there was any whitespace between this node and the previous one,
      // and both are inline, add a single space
      if (!prevTreatAsBlock && !treatAsBlock) {
        const gap = context.document.getText().slice(lastNodeEnd, node.startIndex);
        if (/\s/.test(gap)) {
          currentLine.push(text(' '));
        }
      }
    }

    if (treatAsBlock) {
      // Flush current inline content
      if (currentLine.length > 0) {
        const lineContent = trimDoc(concat(currentLine));
        if (hasDocContent(lineContent)) {
          lines.push(lineContent);
        }
        currentLine = [];
      }
      // Add block element
      lines.push(formatNode(node, context));
    } else if (node.type === 'html_comment' || node.type === 'mustache_comment') {
      // Comments on their own line if multi-line
      const isMultiline = node.startPosition.row !== node.endPosition.row;
      if (isMultiline) {
        if (currentLine.length > 0) {
          const lineContent = trimDoc(concat(currentLine));
          if (hasDocContent(lineContent)) {
            lines.push(lineContent);
          }
          currentLine = [];
        }
        lines.push(text(node.text));
      } else {
        currentLine.push(text(node.text));
      }
    } else {
      // Inline content
      // Force inline formatting for mustache sections that are part of text flow
      const forceInline = isInTextFlow(node, i, nodes);
      const formatted = formatNode(node, context, forceInline);

      // Check if formatted content contains newlines (multi-line text)
      if (typeof formatted === 'string' && formatted.includes('\n')) {
        // Flush current line first
        if (currentLine.length > 0) {
          const lineContent = trimDoc(concat(currentLine));
          if (hasDocContent(lineContent)) {
            lines.push(lineContent);
          }
          currentLine = [];
        }
        // Add each line of multi-line content
        const contentLines = formatted.split('\n');
        for (const contentLine of contentLines) {
          const trimmed = contentLine.trim();
          if (trimmed) {
            lines.push(text(trimmed));
          }
        }
      } else {
        currentLine.push(formatted);
      }
    }

    lastNodeEnd = node.endIndex;
  }

  // Flush remaining inline content
  if (currentLine.length > 0) {
    const lineContent = trimDoc(concat(currentLine));
    if (hasDocContent(lineContent)) {
      lines.push(lineContent);
    }
  }

  // Join lines with hardlines
  if (lines.length === 0) {
    return empty;
  }

  const parts: Doc[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      parts.push(hardline);
    }
    parts.push(lines[i]);
  }

  return concat(parts);
}

/**
 * Check if a Doc has any meaningful content.
 */
function hasDocContent(doc: Doc): boolean {
  if (typeof doc === 'string') {
    return doc.trim().length > 0;
  }
  if (doc.type === 'concat') {
    return doc.parts.some(hasDocContent);
  }
  if (doc.type === 'indent') {
    return hasDocContent(doc.contents);
  }
  if (doc.type === 'group') {
    return hasDocContent(doc.contents);
  }
  if (doc.type === 'fill') {
    return doc.parts.some(hasDocContent);
  }
  // hardline, softline, line, breakParent are structural
  return false;
}

/**
 * Trim whitespace from the beginning and end of a Doc string.
 */
function trimDoc(doc: Doc): Doc {
  if (typeof doc === 'string') {
    return doc.trim();
  }
  return doc;
}
