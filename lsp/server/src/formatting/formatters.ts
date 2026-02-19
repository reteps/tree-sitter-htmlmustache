/**
 * Formatters - convert AST nodes to Doc IR.
 *
 * This module converts tree-sitter AST nodes to the Doc intermediate
 * representation. It uses CSS display-based classification to determine
 * whitespace sensitivity and wraps elements in groups so the printer
 * can decide flat vs break based on print width.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  Doc,
  concat,
  hardline,
  softline,
  line,
  indent,
  group,
  text,
  empty,
  ifBreak,
} from './ir';
import {
  isBlockLevel,
  shouldPreserveContent,
  hasImplicitEndTags,
  isInTextFlow,
  shouldTreatAsBlock,
  getCSSDisplay,
  isWhitespaceInsensitive,
} from './classifier';
import { normalizeText, getVisibleChildren, normalizeMustacheWhitespace, normalizeMustacheWhitespaceAll } from './utils';

export interface FormatterContext {
  document: TextDocument;
  customCodeTags?: Set<string>;
  embeddedFormatted?: Map<number, string>;
  mustacheSpaces?: boolean;
}

function mustacheText(raw: string, context: FormatterContext): string {
  if (context.mustacheSpaces !== undefined) {
    return normalizeMustacheWhitespace(raw, context.mustacheSpaces);
  }
  return raw;
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
    case 'html_raw_element':
      return formatScriptStyleElement(node, context);

    case 'mustache_section':
    case 'mustache_inverted_section':
      if (forceInline) {
        if (context.mustacheSpaces !== undefined) {
          return text(normalizeMustacheWhitespaceAll(node.text, context.mustacheSpaces));
        }
        return text(node.text);
      }
      return formatMustacheSection(node, context);

    case 'mustache_interpolation':
    case 'mustache_triple':
    case 'mustache_partial':
    case 'mustache_comment':
      return text(mustacheText(node.text, context));

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
  const display = getCSSDisplay(node);
  const isBlock = isWhitespaceInsensitive(display);
  const preserveContent = shouldPreserveContent(node);

  // Self-closing tag
  const selfClosing =
    node.childCount === 1 && node.child(0)?.type === 'html_self_closing_tag';

  if (selfClosing) {
    const tag = node.child(0)!;
    return formatStartTag(tag, context);
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
    } else if (!child.type.startsWith('_')) {
      contentNodes.push(child);
    }
  }

  const parts: Doc[] = [];

  // Format start tag
  if (startTag) {
    parts.push(formatStartTag(startTag, context));
  }

  // Check if content contains any HTML element children
  const hasHtmlElementChildren = contentNodes.some(
    (child) =>
      child.type === 'html_element' ||
      child.type === 'html_script_element' ||
      child.type === 'html_style_element' ||
      child.type === 'html_raw_element' ||
      isBlockLevel(child)
  );

  // Handle content
  if (preserveContent) {
    // Use raw document text to preserve all whitespace, since tree-sitter
    // text nodes strip boundary whitespace from regular html_element children
    if (startTag && endTag) {
      const rawContent = context.document.getText().slice(
        startTag.endIndex,
        endTag.startIndex
      );
      parts.push(text(rawContent));
    } else {
      for (const child of contentNodes) {
        parts.push(text(child.text));
      }
    }
  } else if (!isBlock && !hasHtmlElementChildren) {
    // Inline element with only text/interpolation content - keep tight
    for (const child of contentNodes) {
      parts.push(formatNode(child, context));
    }
  } else {
    // Block element or inline-with-block-children: use hardline + indent
    const formattedContent = formatBlockChildren(contentNodes, context);
    const hasContent = hasDocContent(formattedContent);

    if (hasContent) {
      // Check if content has CSS-block children that would be treated as block
      // by formatBlockChildren. Nodes in text flow (e.g. mustache sections
      // adjacent to text) are inline regardless of their content.
      const hasBlockChildren = contentNodes.some((child, i) => {
        if (!shouldTreatAsBlock(child, i, contentNodes)) {
          return false;
        }
        const childDisplay = getCSSDisplay(child);
        return (
          isWhitespaceInsensitive(childDisplay) ||
          child.type === 'html_script_element' ||
          child.type === 'html_style_element' ||
          child.type === 'html_raw_element'
        );
      });

      if (isBlock && !hasBlockChildren) {
        // Block element with only inline content: wrap in group so short ones stay flat
        // e.g. <div>x</div> stays on one line, <div>long content...</div> breaks
        const doc = group(
          concat([
            indent(concat([softline, formattedContent])),
            softline,
          ])
        );
        parts.push(doc);
        // If no real end tag, don't add closing softline
        if (!hasRealEndTag && endTag) {
          // Remove the trailing softline we just added — content goes
          // right up to forced end
          parts.pop();
          parts.push(
            group(
              concat([
                indent(concat([softline, formattedContent])),
              ])
            )
          );
        }
      } else {
        // Has block children: always break
        parts.push(indent(concat([hardline, formattedContent])));
        if (hasRealEndTag) {
          parts.push(hardline);
        }
      }
    } else if (contentNodes.length === 0 && hasRealEndTag) {
      // Empty block element: <div>\n</div>
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
 * Format script or style element.
 * Uses pre-formatted content from embeddedFormatted map when available,
 * otherwise preserves raw content as-is.
 */
export function formatScriptStyleElement(
  node: SyntaxNode,
  context: FormatterContext
): Doc {
  const parts: Doc[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_start_tag') {
      parts.push(formatStartTag(child, context));
    } else if (child.type === 'html_end_tag') {
      parts.push(formatEndTag(child));
    } else if (child.type === 'html_raw_text') {
      const formatted = context.embeddedFormatted?.get(child.startIndex);
      if (formatted !== undefined) {
        const trimmed = formatted.replace(/^\n+/, '').replace(/\n+$/, '');
        if (trimmed.length === 0) {
          // Empty content — no lines between tags
        } else {
          const lines = trimmed.split('\n');
          const lineDocs: Doc[] = [];
          for (let j = 0; j < lines.length; j++) {
            if (j > 0) {
              lineDocs.push(hardline);
            }
            lineDocs.push(text(lines[j]));
          }
          parts.push(indent(concat([hardline, ...lineDocs])));
          parts.push(hardline);
        }
      } else {
        // Fallback: preserve raw content as-is (also used for html_raw_element)
        parts.push(text(child.text));
      }
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
    parts.push(text(mustacheText(beginNode.text, context)));
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
      // Check if content has CSS-block children (accounting for text flow)
      const hasBlockChildren = contentNodes.some((child, i) => {
        if (!shouldTreatAsBlock(child, i, contentNodes)) {
          return false;
        }
        const childDisplay = getCSSDisplay(child);
        return (
          isWhitespaceInsensitive(childDisplay) ||
          child.type === 'html_script_element' ||
          child.type === 'html_style_element' ||
          child.type === 'html_raw_element'
        );
      });

      if (!hasBlockChildren) {
        // Inline content only: use group so short sections stay flat
        parts.push(indent(concat([softline, formattedContent])));
        parts.push(softline);
      } else {
        // Block content: always break
        parts.push(indent(concat([hardline, formattedContent])));
        parts.push(hardline);
      }
    }
  }

  // Closing tag
  if (endNode) {
    parts.push(text(mustacheText(endNode.text, context)));
  }

  // Wrap in group so inline-only content can stay flat
  return group(concat(parts));
}

/**
 * Format a start tag with attributes.
 * Wraps in a group so attributes break onto separate lines when
 * the tag exceeds print width.
 */
export function formatStartTag(node: SyntaxNode, context?: FormatterContext): Doc {
  let tagNameText = '';
  const attrs: Doc[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === 'html_tag_name') {
      tagNameText = child.text;
    } else if (child.type === 'html_attribute') {
      attrs.push(formatAttribute(child, context));
    } else if (child.type === 'mustache_attribute') {
      if (context?.mustacheSpaces !== undefined) {
        attrs.push(text(normalizeMustacheWhitespaceAll(child.text, context.mustacheSpaces)));
      } else {
        attrs.push(text(child.text));
      }
    } else if (child.type === 'mustache_interpolation' || child.type === 'mustache_triple') {
      attrs.push(text(context ? mustacheText(child.text, context) : child.text));
    }
  }

  const isSelfClosing = node.type === 'html_self_closing_tag';
  const closingBracket = isSelfClosing ? ' />' : '>';

  if (attrs.length === 0) {
    return text('<' + tagNameText + closingBracket);
  }

  // Build attribute list with line separators
  const attrParts: Doc[] = [];
  for (let i = 0; i < attrs.length; i++) {
    if (i > 0) {
      attrParts.push(line);
    }
    attrParts.push(attrs[i]);
  }

  // Wrap tag in group: flat puts attrs on one line, break wraps them
  return group(
    concat([
      text('<'),
      text(tagNameText),
      indent(concat([line, concat(attrParts)])),
      ifBreak(concat([hardline, text(closingBracket)]), text(closingBracket)),
    ])
  );
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
export function formatAttribute(node: SyntaxNode, context?: FormatterContext): Doc {
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
      parts.push(text(context ? mustacheText(child.text, context) : child.text));
    }
  }

  return concat(parts);
}

/**
 * Format block-level children with display-aware separators.
 */
export function formatBlockChildren(
  nodes: SyntaxNode[],
  context: FormatterContext
): Doc {
  const lines: { doc: Doc; blankLineBefore: boolean }[] = [];
  let currentLine: Doc[] = [];
  let lastNodeEnd = -1;
  let pendingBlankLine = false;
  let blankLineBeforeCurrentLine = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    const treatAsBlock = shouldTreatAsBlock(node, i, nodes);

    // Check for whitespace between nodes in original document
    if (lastNodeEnd >= 0 && node.startIndex > lastNodeEnd) {
      const gap = context.document.getText().slice(lastNodeEnd, node.startIndex);
      const prevNode = nodes[i - 1];
      const prevTreatAsBlock = shouldTreatAsBlock(prevNode, i - 1, nodes);

      // Detect blank lines (≥2 newlines) in any gap between nodes
      const newlineCount = (gap.match(/\n/g) || []).length;
      if (newlineCount >= 2) {
        pendingBlankLine = true;
      }

      if (!prevTreatAsBlock && !treatAsBlock) {
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
          lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
        }
        currentLine = [];
        blankLineBeforeCurrentLine = false;
      }
      // Add block element
      lines.push({ doc: formatNode(node, context), blankLineBefore: pendingBlankLine });
      pendingBlankLine = false;
    } else if (node.type === 'html_comment' || node.type === 'mustache_comment') {
      // Comments on their own line if multi-line
      const isMultiline = node.startPosition.row !== node.endPosition.row;
      if (isMultiline) {
        if (currentLine.length > 0) {
          const lineContent = trimDoc(concat(currentLine));
          if (hasDocContent(lineContent)) {
            lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
          }
          currentLine = [];
          blankLineBeforeCurrentLine = false;
        }
        const commentText = node.type === 'mustache_comment' ? mustacheText(node.text, context) : node.text;
        lines.push({ doc: text(commentText), blankLineBefore: pendingBlankLine });
        pendingBlankLine = false;
      } else {
        if (currentLine.length === 0) {
          blankLineBeforeCurrentLine = pendingBlankLine;
          pendingBlankLine = false;
        }
        const commentText = node.type === 'mustache_comment' ? mustacheText(node.text, context) : node.text;
        currentLine.push(text(commentText));
      }
    } else {
      // Inline content
      if (currentLine.length === 0) {
        blankLineBeforeCurrentLine = pendingBlankLine;
        pendingBlankLine = false;
      }
      const forceInline = isInTextFlow(node, i, nodes);
      const formatted = formatNode(node, context, forceInline);

      // Check if formatted content contains newlines (multi-line text)
      if (typeof formatted === 'string' && formatted.includes('\n')) {
        // Split text into lines. The first part joins the current line
        // (preserving text flow with preceding inline elements), and the
        // last part becomes the new current line (so subsequent inline
        // elements like <code> can join it).
        const contentLines = formatted.split('\n');

        // First part continues the current inline flow
        const firstTrimmed = contentLines[0].trim();
        if (firstTrimmed) {
          currentLine.push(firstTrimmed);
        }

        // Flush current line before adding subsequent lines
        if (currentLine.length > 0) {
          const lineContent = trimDoc(concat(currentLine));
          if (hasDocContent(lineContent)) {
            lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
            blankLineBeforeCurrentLine = pendingBlankLine;
            pendingBlankLine = false;
          }
          currentLine = [];
        }

        // Middle parts (index 1 to length-2) become separate lines
        let sawBlankLine = false;
        for (let j = 1; j < contentLines.length - 1; j++) {
          const trimmed = contentLines[j].trim();
          if (trimmed) {
            lines.push({ doc: text(trimmed), blankLineBefore: blankLineBeforeCurrentLine || sawBlankLine });
            blankLineBeforeCurrentLine = false;
            sawBlankLine = false;
          } else {
            sawBlankLine = true;
          }
        }

        // Last part starts a new current line (subsequent inline elements join it)
        if (contentLines.length > 1) {
          const lastTrimmed = contentLines[contentLines.length - 1].trim();
          if (lastTrimmed) {
            blankLineBeforeCurrentLine = sawBlankLine;
            sawBlankLine = false;
            currentLine = [lastTrimmed];
          }
          if (sawBlankLine) {
            pendingBlankLine = true;
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
      lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
    }
  }

  // Join lines with hardlines
  if (lines.length === 0) {
    return empty;
  }

  const parts: Doc[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      if (lines[i].blankLineBefore) {
        // Emit a blank line: literal \n (no indent) + hardline (with indent)
        parts.push('\n');
      }
      parts.push(hardline);
    }
    parts.push(lines[i].doc);
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
  if (doc.type === 'ifBreak') {
    return hasDocContent(doc.breakContents) || hasDocContent(doc.flatContents);
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
