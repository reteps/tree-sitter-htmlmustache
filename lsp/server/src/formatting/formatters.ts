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
  fill,
  hardline,
  softline,
  line,
  indent,
  indentN,
  group,
  text,
  empty,
  ifBreak,
  isLine,
} from './ir.js';
import {
  isBlockLevel,
  shouldPreserveContent,
  hasImplicitEndTags,
  isInTextFlow,
  shouldTreatAsBlock,
  getCSSDisplay,
  isWhitespaceInsensitive,
} from './classifier.js';
import { normalizeText, getVisibleChildren, normalizeMustacheWhitespace, normalizeMustacheWhitespaceAll, getIgnoreDirective, getTagName } from './utils.js';
import type { CustomCodeTagConfig } from '../customCodeTags.js';
import { getAttributeValue } from '../customCodeTags.js';
import { isRawContentElement } from '../nodeHelpers.js';
import type { NoBreakDelimiter } from '../configFile.js';

export interface FormatterContext {
  document: TextDocument;
  customTags?: Map<string, CustomCodeTagConfig>;
  embeddedFormatted?: Map<number, string>;
  mustacheSpaces?: boolean;
  noBreakDelimiters?: NoBreakDelimiter[];
}

/**
 * Check if an attribute value is truthy (not null, empty, "false", or "0").
 */
export function isAttributeTruthy(value: string | null): boolean {
  if (value === null || value === '' || value === 'false' || value === '0') {
    return false;
  }
  return true;
}

/**
 * Dedent content by stripping leading/trailing empty lines and removing the
 * minimum common indentation from all non-empty lines.
 */
export function dedentContent(rawContent: string): string {
  const lines = rawContent.split('\n');

  // Strip leading empty lines
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  // Strip trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) return '';

  // Find minimum indentation across non-empty lines
  let minIndent = Infinity;
  for (const l of lines) {
    if (l.trim() === '') continue;
    const match = l.match(/^(\s*)/);
    if (match && match[1].length < minIndent) {
      minIndent = match[1].length;
    }
  }
  if (minIndent === Infinity) minIndent = 0;

  // Strip common indent
  return lines.map(l => l.trim() === '' ? '' : l.slice(minIndent)).join('\n');
}

/**
 * Resolve whether a custom code tag's content should be indented.
 */
function resolveIndentMode(
  node: SyntaxNode,
  config: CustomCodeTagConfig
): boolean {
  const mode = config.indent ?? 'never';
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  // mode === 'attribute'
  if (!config.indentAttribute) return false;
  const value = getAttributeValue(node, config.indentAttribute);
  return isAttributeTruthy(value);
}

function getTagNameFromStartTag(startTag: SyntaxNode): string | null {
  for (let i = 0; i < startTag.childCount; i++) {
    const child = startTag.child(i);
    if (child?.type === 'html_tag_name') return child.text.toLowerCase();
  }
  return null;
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
      return formatHtmlElement(node, context, forceInline);

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
export function formatHtmlElement(node: SyntaxNode, context: FormatterContext, forceInline = false): Doc {
  const tags = context.customTags;
  const display = getCSSDisplay(node, tags);
  const isBlock = isWhitespaceInsensitive(display);
  const preserveContent = shouldPreserveContent(node, tags);

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
      isRawContentElement(child) ||
      isBlockLevel(child, tags)
  );

  // Handle content
  if (preserveContent) {
    // Check if this custom code tag should be indented
    const tagNameLower = startTag ? getTagNameFromStartTag(startTag) : null;
    const tagConfig = tagNameLower ? context.customTags?.get(tagNameLower) : undefined;
    const shouldIndent = tagConfig ? resolveIndentMode(node, tagConfig) : false;

    if (shouldIndent && startTag && endTag) {
      const rawContent = context.document.getText().slice(
        startTag.endIndex,
        endTag.startIndex
      );
      const dedented = dedentContent(rawContent);
      if (dedented.length > 0) {
        const contentLines = dedented.split('\n');
        const lineDocs: Doc[] = [];
        for (let j = 0; j < contentLines.length; j++) {
          if (j > 0) {
            if (contentLines[j] === '') {
              // Empty line: literal \n avoids indentation from the printer
              lineDocs.push('\n');
            } else {
              lineDocs.push(hardline);
            }
          }
          if (contentLines[j] !== '') {
            lineDocs.push(text(contentLines[j]));
          }
        }
        parts.push(indent(concat([hardline, ...lineDocs])));
        parts.push(hardline);
      }
    } else if (startTag && endTag) {
      // Use raw document text to preserve all whitespace, since tree-sitter
      // text nodes strip boundary whitespace from regular html_element children
      const rawContent = context.document.getText().slice(
        startTag.endIndex,
        endTag.startIndex
      );
      // For block-level elements, replace trailing newline+whitespace with
      // a hardline so the closing tag gets proper indentation from the printer
      const trailingMatch = isBlock ? rawContent.match(/\n[\t ]*$/) : null;
      if (trailingMatch) {
        parts.push(text(rawContent.slice(0, -trailingMatch[0].length)));
        parts.push(hardline);
      } else {
        parts.push(text(rawContent));
      }
    } else {
      for (const child of contentNodes) {
        parts.push(text(child.text));
      }
    }
  } else if (!isBlock && (!hasHtmlElementChildren || (forceInline && display !== 'inline-block' && !contentNodes.some(
    (child) => isRawContentElement(child) || isBlockLevel(child, tags)
  )))) {
    // Standalone element with attributes: use outer group wrapping so content
    // goes on its own line when attributes wrap (matches Prettier's printTag)
    if (!forceInline && startTag && startTagHasAttributes(startTag)) {
      const formattedContent = formatBlockChildren(contentNodes, context);
      if (hasDocContent(formattedContent)) {
        const bareStartTag = formatStartTag(startTag, context, true);
        const outerParts: Doc[] = [
          group(bareStartTag),
          indent(concat([softline, formattedContent])),
        ];
        if (hasRealEndTag) {
          outerParts.push(softline);
        }
        if (endTag) {
          outerParts.push(formatEndTag(endTag));
        }
        return group(concat(outerParts));
      }
    }

    // Inline element with only text/interpolation content - keep tight
    // Preserve whitespace gaps between sibling nodes (e.g. space between
    // mustache_interpolation and text that tree-sitter puts in the gap)
    let prevEnd = startTag ? startTag.endIndex : -1;
    for (const child of contentNodes) {
      if (prevEnd >= 0 && child.startIndex > prevEnd) {
        const gap = context.document.getText().slice(prevEnd, child.startIndex);
        if (/\s/.test(gap)) {
          parts.push(text(' '));
        }
      }
      parts.push(formatNode(child, context, forceInline));
      prevEnd = child.endIndex;
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
        if (!shouldTreatAsBlock(child, i, contentNodes, tags)) {
          return false;
        }
        const childDisplay = getCSSDisplay(child, tags);
        return isWhitespaceInsensitive(childDisplay) || isRawContentElement(child);
      });

      if (isBlock && !hasBlockChildren) {
        // Block element with only inline content: wrap in group so short ones stay flat
        // e.g. <div>x</div> stays on one line, <div>long content...</div> breaks
        const hasAttrs = startTag && startTagHasAttributes(startTag);

        if (hasAttrs && startTag) {
          // Outer group wrapping: match Prettier's printTag pattern
          // group([group(openTag), indent([softline, content]), softline, closingTag])
          const bareStartTag = formatStartTag(startTag, context, true);
          const outerParts: Doc[] = [
            group(bareStartTag),
            indent(concat([softline, formattedContent])),
          ];
          if (hasRealEndTag) {
            outerParts.push(softline);
          }
          if (endTag) {
            outerParts.push(formatEndTag(endTag));
          }
          return group(concat(outerParts));
        }

        // No attributes — existing logic
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
        // Check if this is a custom code tag that should be indented
        if (node.type === 'html_raw_element') {
          const startTagNode = node.child(0);
          const tagNameLower = startTagNode?.type === 'html_start_tag' ? getTagNameFromStartTag(startTagNode) : null;
          const tagConfig = tagNameLower ? context.customTags?.get(tagNameLower) : undefined;
          if (tagConfig && resolveIndentMode(node, tagConfig)) {
            const dedented = dedentContent(child.text);
            if (dedented.length > 0) {
              const contentLines = dedented.split('\n');
              const lineDocs: Doc[] = [];
              for (let j = 0; j < contentLines.length; j++) {
                if (j > 0) {
                  if (contentLines[j] === '') {
                    lineDocs.push('\n');
                  } else {
                    lineDocs.push(hardline);
                  }
                }
                if (contentLines[j] !== '') {
                  lineDocs.push(text(contentLines[j]));
                }
              }
              parts.push(indent(concat([hardline, ...lineDocs])));
              parts.push(hardline);
            }
          } else {
            parts.push(text(child.text));
          }
        } else {
          // Script/style fallback: dedent and re-emit with hardlines so the
          // printer can apply proper indentation from parent context.
          const dedented = dedentContent(child.text);
          if (dedented.length > 0) {
            const contentLines = dedented.split('\n');
            const lineDocs: Doc[] = [];
            for (let j = 0; j < contentLines.length; j++) {
              if (j > 0) {
                if (contentLines[j] === '') {
                  lineDocs.push('\n');
                } else {
                  lineDocs.push(hardline);
                }
              }
              if (contentLines[j] !== '') {
                lineDocs.push(text(contentLines[j]));
              }
            }
            parts.push(indent(concat([hardline, ...lineDocs])));
            parts.push(hardline);
          }
        }
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

  // Staircase indentation: when content includes erroneous end tags (closing tags
  // from a cross-section split). Each erroneous end tag gets a descending indent
  // level so the outermost closing tag aligns at indent 0 (matching its opening).
  // Non-erroneous content between erroneous end tags is indented one level deeper
  // than the surrounding erroneous tags (it's a child of that scope).
  const erroneousCount = contentNodes.filter(n => n.type === 'html_erroneous_end_tag').length;
  const hasStaircase = !hasImplicit && erroneousCount > 0;

  if (hasStaircase) {
    let virtualDepth = erroneousCount - 1;
    const groupNodes: SyntaxNode[] = [];
    let lastNodeEnd = -1;
    let pendingBlankLine = false;
    let groupBlankLine = false;

    const emitGroup = () => {
      if (groupNodes.length === 0) return;
      const formatted = formatBlockChildren(groupNodes, context);
      if (hasDocContent(formatted)) {
        if (groupBlankLine) parts.push('\n');
        const depth = Math.max(0, virtualDepth + 1);
        parts.push(depth > 0
          ? indentN(concat([hardline, formatted]), depth)
          : concat([hardline, formatted]));
      }
      groupNodes.length = 0;
      groupBlankLine = false;
    };

    for (const node of contentNodes) {
      if (lastNodeEnd >= 0 && node.startIndex > lastNodeEnd) {
        const gap = context.document.getText().slice(lastNodeEnd, node.startIndex);
        if ((gap.match(/\n/g) || []).length >= 2) {
          pendingBlankLine = true;
        }
      }

      if (node.type === 'html_erroneous_end_tag') {
        emitGroup();
        if (pendingBlankLine) parts.push('\n');
        pendingBlankLine = false;
        const formatted = formatNode(node, context);
        const depth = Math.max(0, virtualDepth);
        parts.push(depth > 0
          ? indentN(concat([hardline, formatted]), depth)
          : concat([hardline, formatted]));
        virtualDepth--;
      } else {
        if (groupNodes.length === 0) {
          groupBlankLine = pendingBlankLine;
          pendingBlankLine = false;
        }
        groupNodes.push(node);
      }
      lastNodeEnd = node.endIndex;
    }
    emitGroup();
    parts.push(hardline);
  } else {
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
        if (!shouldTreatAsBlock(child, i, contentNodes, context.customTags)) {
          return false;
        }
        const childDisplay = getCSSDisplay(child, context.customTags);
        return isWhitespaceInsensitive(childDisplay) || isRawContentElement(child);
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
  }

  // Closing tag
  if (endNode) {
    parts.push(text(mustacheText(endNode.text, context)));
  }

  // Wrap in group so inline-only content can stay flat
  return group(concat(parts));
}

/**
 * Check if a start tag has any attributes.
 */
function startTagHasAttributes(startTag: SyntaxNode): boolean {
  for (let i = 0; i < startTag.childCount; i++) {
    const child = startTag.child(i);
    if (!child) continue;
    if (
      child.type === 'html_attribute' ||
      child.type === 'mustache_attribute' ||
      child.type === 'mustache_interpolation' ||
      child.type === 'mustache_triple'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Format a start tag with attributes.
 * Wraps in a group so attributes break onto separate lines when
 * the tag exceeds print width.
 * When `bare` is true, returns the tag IR without the outer group wrapper.
 */
export function formatStartTag(node: SyntaxNode, context?: FormatterContext, bare = false): Doc {
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

  // In break mode, self-closing /> has no leading space (aligns with <tagName)
  const breakClosingBracket = isSelfClosing ? '/>' : '>';

  // Wrap tag in group: flat puts attrs on one line, break wraps them
  const inner = concat([
    text('<'),
    text(tagNameText),
    indent(concat([line, concat(attrParts)])),
    ifBreak(concat([hardline, text(breakClosingBracket)]), text(closingBracket)),
  ]);
  return bare ? inner : group(inner);
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
      if (context?.mustacheSpaces !== undefined) {
        parts.push(text(normalizeMustacheWhitespaceAll(child.text, context.mustacheSpaces)));
      } else {
        parts.push(text(child.text));
      }
    } else if (child.type === 'mustache_interpolation') {
      parts.push(text('='));
      parts.push(text(context ? mustacheText(child.text, context) : child.text));
    }
  }

  return concat(parts);
}

/**
 * Split a single-line text string into alternating words and `line` separators.
 * Returns an array of fill-ready parts to spread into `currentLine`.
 */
function textWords(str: string): Doc[] {
  const words = str.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const parts: Doc[] = [words[0]];
  for (let i = 1; i < words.length; i++) {
    parts.push(line);
    parts.push(words[i]);
  }
  return parts;
}

/**
 * Replace `line` separators with `" "` inside delimited regions so the
 * fill algorithm treats delimited content as unbreakable.
 *
 * Scans string parts for delimiter boundaries. Between an opening and closing
 * delimiter, any `line` separator is replaced with a literal space string.
 * Delimiters are matched longest-first to handle e.g. `$$` before `$`.
 */
export function collapseDelimitedRegions(parts: Doc[], delimiters: NoBreakDelimiter[]): Doc[] {
  if (delimiters.length === 0) return parts;

  // Sort longest-first by max(start.length, end.length) so $$ is checked before $
  const sorted = [...delimiters].sort(
    (a, b) => Math.max(b.start.length, b.end.length) - Math.max(a.start.length, a.end.length)
  );

  const result = [...parts];
  let activeDelimiter: NoBreakDelimiter | null = null;

  for (let i = 0; i < result.length; i++) {
    const part = result[i];

    if (typeof part === 'string') {
      if (activeDelimiter === null) {
        // Look for an opening delimiter
        for (const delim of sorted) {
          const startIdx = part.indexOf(delim.start);
          if (startIdx >= 0) {
            // Check if it also closes in the same string
            const afterOpen = startIdx + delim.start.length;
            const closeIdx = part.indexOf(delim.end, afterOpen);
            if (closeIdx >= 0) {
              // Self-contained (e.g. "$x$") — no state change, already atomic
              continue;
            }
            activeDelimiter = delim;
            break;
          }
        }
      } else {
        // Look for the closing delimiter
        if (part.includes(activeDelimiter.end)) {
          activeDelimiter = null;
        }
      }
    } else if (activeDelimiter !== null && isLine(part)) {
      // Inside a delimited region: replace line with non-breaking space
      result[i] = ' ';
    }
  }

  return result;
}

/**
 * Convert inline content parts into a fill Doc that wraps at word boundaries.
 *
 * `currentLine` is already fill-ready: text nodes are pre-split into
 * alternating word/`line` parts by `textWords`, and inter-node gaps are
 * `line` separators. This function enforces proper alternating
 * content/separator structure, concatenates adjacent content, and attaches
 * leading punctuation to the preceding content.
 */
function inlineContentToFill(parts: Doc[]): Doc {
  if (parts.length === 0) return empty;
  if (parts.length === 1) return parts[0];

  const fillParts: Doc[] = [];
  for (const item of parts) {
    if (isLine(item)) {
      // Only push separator after content (skip leading/duplicate separators)
      if (fillParts.length > 0 && !isLine(fillParts[fillParts.length - 1])) {
        fillParts.push(item);
      }
    } else {
      const lastIdx = fillParts.length - 1;
      if (lastIdx >= 0 && !isLine(fillParts[lastIdx])) {
        // Adjacent content (no separator) — concat with previous
        fillParts[lastIdx] = concat([fillParts[lastIdx], item]);
      } else if (
        typeof item === 'string' &&
        /^[,.:;!?)\]]/.test(item) &&
        lastIdx >= 0 &&
        isLine(fillParts[lastIdx])
      ) {
        // Punctuation after separator — attach to preceding content
        fillParts.pop();
        if (fillParts.length > 0) {
          fillParts[fillParts.length - 1] = concat([
            fillParts[fillParts.length - 1],
            item,
          ]);
        } else {
          fillParts.push(item);
        }
      } else {
        fillParts.push(item);
      }
    }
  }

  // Remove trailing separator
  if (fillParts.length > 0 && isLine(fillParts[fillParts.length - 1])) {
    fillParts.pop();
  }

  return fill(fillParts);
}

/**
 * Format block-level children with display-aware separators.
 */
export function formatBlockChildren(
  nodes: SyntaxNode[],
  context: FormatterContext
): Doc {
  const lines: { doc: Doc; blankLineBefore: boolean; rawLine?: boolean }[] = [];
  let currentLine: Doc[] = [];
  let lastNodeEnd = -1;
  let pendingBlankLine = false;
  let blankLineBeforeCurrentLine = false;
  let ignoreNext = false;
  let inIgnoreRegion = false;
  let ignoreRegionStartIndex = -1;

  const noBreakDelims = context.noBreakDelimiters;
  function flushCurrentLine(): Doc {
    const parts = noBreakDelims ? collapseDelimitedRegions(currentLine, noBreakDelims) : currentLine;
    return inlineContentToFill(parts);
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Detect blank lines in gap between nodes (before directive handling)
    if (lastNodeEnd >= 0 && node.startIndex > lastNodeEnd && !inIgnoreRegion) {
      const gap = context.document.getText().slice(lastNodeEnd, node.startIndex);
      const newlineCount = (gap.match(/\n/g) || []).length;
      if (newlineCount >= 2) {
        pendingBlankLine = true;
      }
    }

    const directive = getIgnoreDirective(node);

    // --- Ignore directive handling ---

    // ignore-end: close a region
    if (directive === 'ignore-end' && inIgnoreRegion) {
      // Flush any pending inline content
      if (currentLine.length > 0) {
        const lineContent = trimDoc(flushCurrentLine());
        if (hasDocContent(lineContent)) {
          lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
        }
        currentLine = [];
        blankLineBeforeCurrentLine = false;
      }
      // Emit raw text from region start to this comment, trimming boundary newlines
      const rawText = context.document.getText().slice(ignoreRegionStartIndex, node.startIndex)
        .replace(/^\n/, '').replace(/\n$/, '');
      if (rawText.length > 0) {
        lines.push({ doc: text(rawText), blankLineBefore: false, rawLine: true });
      }
      // Emit the ignore-end comment itself (rawLine to avoid adding indent after raw text)
      const commentText = node.type === 'mustache_comment' ? mustacheText(node.text, context) : node.text;
      lines.push({ doc: text(commentText), blankLineBefore: false, rawLine: true });
      inIgnoreRegion = false;
      ignoreRegionStartIndex = -1;
      lastNodeEnd = node.endIndex;
      continue;
    }

    // Inside ignore region: skip (content captured as raw text at ignore-end)
    if (inIgnoreRegion) {
      lastNodeEnd = node.endIndex;
      continue;
    }

    // ignore-start: begin a region
    if (directive === 'ignore-start') {
      if (currentLine.length > 0) {
        const lineContent = trimDoc(flushCurrentLine());
        if (hasDocContent(lineContent)) {
          lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
        }
        currentLine = [];
        blankLineBeforeCurrentLine = false;
      }
      const commentText = node.type === 'mustache_comment' ? mustacheText(node.text, context) : node.text;
      lines.push({ doc: text(commentText), blankLineBefore: pendingBlankLine });
      pendingBlankLine = false;
      inIgnoreRegion = true;
      ignoreRegionStartIndex = node.endIndex;
      lastNodeEnd = node.endIndex;
      continue;
    }

    // ignore (next-node): emit the comment, set flag
    if (directive === 'ignore') {
      if (currentLine.length > 0) {
        const lineContent = trimDoc(flushCurrentLine());
        if (hasDocContent(lineContent)) {
          lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
        }
        currentLine = [];
        blankLineBeforeCurrentLine = false;
      }
      const commentText = node.type === 'mustache_comment' ? mustacheText(node.text, context) : node.text;
      lines.push({ doc: text(commentText), blankLineBefore: pendingBlankLine });
      pendingBlankLine = false;
      ignoreNext = true;
      lastNodeEnd = node.endIndex;
      continue;
    }

    // Ignored next-node: emit raw text, clear flag
    if (ignoreNext) {
      lines.push({ doc: text(node.text), blankLineBefore: pendingBlankLine });
      pendingBlankLine = false;
      ignoreNext = false;
      lastNodeEnd = node.endIndex;
      continue;
    }

    // ignore-end without ignore-start: treat as normal comment (fall through)

    const treatAsBlock = shouldTreatAsBlock(node, i, nodes, context.customTags);

    // Check for whitespace between nodes in original document (inline gap handling)
    if (lastNodeEnd >= 0 && node.startIndex > lastNodeEnd) {
      const prevNode = nodes[i - 1];
      const prevTreatAsBlock = shouldTreatAsBlock(prevNode, i - 1, nodes, context.customTags);

      if (!prevTreatAsBlock && !treatAsBlock) {
        const gap = context.document.getText().slice(lastNodeEnd, node.startIndex);
        if (/\s/.test(gap)) {
          currentLine.push(line);
        }
      }
    }

    if (treatAsBlock) {
      // Flush current inline content
      if (currentLine.length > 0) {
        const lineContent = trimDoc(flushCurrentLine());
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
      // Comments on their own line if multi-line or on their own line in source
      const isMultiline = node.startPosition.row !== node.endPosition.row;
      const isOnOwnLine = i > 0 && node.startPosition.row > nodes[i - 1].endPosition.row;
      if (isMultiline || isOnOwnLine) {
        if (currentLine.length > 0) {
          const lineContent = trimDoc(flushCurrentLine());
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
        const contentLines = formatted.split('\n');
        const isTextNode = node.type === 'text';

        if (isTextNode) {
          // Re-flow: treat source newlines as word boundaries, only flush at
          // blank lines. This lets the fill algorithm handle all wrapping.
          for (let j = 0; j < contentLines.length; j++) {
            const trimmed = contentLines[j].trim();
            if (!trimmed) {
              // Empty line = paragraph break — flush current inline flow
              if (currentLine.length > 0) {
                const lineContent = trimDoc(flushCurrentLine());
                if (hasDocContent(lineContent)) {
                  lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
                  blankLineBeforeCurrentLine = false;
                }
                currentLine = [];
              }
              pendingBlankLine = true;
            } else {
              if (currentLine.length === 0) {
                blankLineBeforeCurrentLine = pendingBlankLine;
                pendingBlankLine = false;
              }
              // Add a line separator between joined source lines (j > 0),
              // but not before the first line — it continues the existing flow
              if (j > 0 && currentLine.length > 0) {
                currentLine.push(line);
              }
              currentLine.push(...textWords(trimmed));
            }
          }
        } else {
          // Non-text nodes (force-inline mustache sections, etc.):
          // preserve source newlines as hard line breaks.
          const firstTrimmed = contentLines[0].trim();
          if (firstTrimmed) {
            currentLine.push(firstTrimmed);
          }

          if (currentLine.length > 0) {
            const lineContent = trimDoc(flushCurrentLine());
            if (hasDocContent(lineContent)) {
              lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
              blankLineBeforeCurrentLine = pendingBlankLine;
              pendingBlankLine = false;
            }
            currentLine = [];
          }

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
        }
      } else {
        // For text nodes, spread word/line parts directly into currentLine
        if (node.type === 'text' && typeof formatted === 'string') {
          const words = textWords(formatted);
          if (words.length > 0) {
            currentLine.push(...words);
          } else if (node.text.trim() === '' && currentLine.length > 0) {
            // Whitespace-only text between inline content: preserve as line separator
            currentLine.push(line);
          }
        } else {
          currentLine.push(formatted);
        }
      }
    }

    // Force line break after <br> tags
    if (node.type === 'html_element' && currentLine.length > 0) {
      const tagName = getTagName(node);
      if (tagName?.toLowerCase() === 'br') {
        const lineContent = trimDoc(flushCurrentLine());
        if (hasDocContent(lineContent)) {
          lines.push({ doc: lineContent, blankLineBefore: blankLineBeforeCurrentLine });
          blankLineBeforeCurrentLine = false;
        }
        currentLine = [];
      }
    }

    lastNodeEnd = node.endIndex;
  }

  // Handle unterminated ignore region: emit remaining raw text
  if (inIgnoreRegion && nodes.length > 0) {
    const lastNode = nodes[nodes.length - 1];
    const rawText = context.document.getText().slice(ignoreRegionStartIndex, lastNode.endIndex)
      .replace(/^\n/, '');
    if (rawText.length > 0) {
      lines.push({ doc: text(rawText), blankLineBefore: false, rawLine: true });
    }
  }

  // Flush remaining inline content
  if (currentLine.length > 0) {
    const lineContent = trimDoc(flushCurrentLine());
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
      if (lines[i].rawLine) {
        // Raw lines (ignored regions): literal \n to avoid adding indentation
        parts.push('\n');
      } else {
        parts.push(hardline);
      }
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
