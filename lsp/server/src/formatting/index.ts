/**
 * IR-Based Formatter for HTML with Mustache templates.
 *
 * Architecture: AST Node → Doc IR → String
 *
 * Three phases:
 * 1. Classification - Determine node type (block/inline/preserve)
 * 2. AST → IR - Convert nodes to formatting commands
 * 3. IR → String - Print with proper indentation
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { Tree } from '../parser.js';
import type { TextDocument } from 'vscode-languageserver-textdocument';

/** Formatting options (structurally compatible with LSP FormattingOptions). */
export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}

/** A position in a text document (0-based line and character). */
export interface Position {
  line: number;
  character: number;
}

/** A range in a text document. */
export interface Range {
  start: Position;
  end: Position;
}

/** A text edit to apply to a document. */
export interface TextEdit {
  range: Range;
  newText: string;
}

import { print } from './printer.js';
import { formatDocument as formatDocumentToDoc, FormatterContext } from './formatters.js';
import { mergeOptions, createIndentUnit } from './editorconfig.js';
import type { HtmlMustacheConfig, NoBreakDelimiter } from '../configFile.js';
import { findContainingNode, calculateIndentLevel } from './utils.js';
import { isBlockLevel, getContentNodes, hasImplicitEndTags } from './classifier.js';
import type { CustomCodeTagConfig } from '../customCodeTags.js';

export interface FormatDocumentParams {
  customTags?: CustomCodeTagConfig[];
  printWidth?: number;
  embeddedFormatted?: Map<number, string>;
  mustacheSpaces?: boolean;
  noBreakDelimiters?: NoBreakDelimiter[];
  configFile?: HtmlMustacheConfig | null;
}

/**
 * Build a Map<string, CustomCodeTagConfig> from the customTags array.
 */
function buildCustomTagMap(customTags?: CustomCodeTagConfig[]): Map<string, CustomCodeTagConfig> | undefined {
  if (!customTags || customTags.length === 0) return undefined;
  const map = new Map<string, CustomCodeTagConfig>();
  for (const config of customTags) {
    map.set(config.name.toLowerCase(), config);
  }
  return map;
}

/**
 * Format an entire document.
 */
export function formatDocument(
  tree: Tree,
  document: TextDocument,
  options: FormattingOptions,
  params: FormatDocumentParams = {},
): TextEdit[] {
  const { printWidth = 80, embeddedFormatted, mustacheSpaces, noBreakDelimiters, configFile } = params;
  const mergedOptions = mergeOptions(options, document.uri, configFile);
  const indentUnit = createIndentUnit(mergedOptions);

  // Bail out if the tree has parse errors to avoid mangling content
  if (tree.rootNode.hasError) {
    return [];
  }

  const customTagMap = buildCustomTagMap(params.customTags);
  const context: FormatterContext = {
    document,
    customTags: customTagMap,
    embeddedFormatted,
    mustacheSpaces,
    noBreakDelimiters,
  };
  const doc = formatDocumentToDoc(tree.rootNode, context);
  const formatted = print(doc, { indentUnit, printWidth });

  // Return a single edit that replaces the entire document
  const fullRange: Range = {
    start: { line: 0, character: 0 },
    end: document.positionAt(document.getText().length),
  };

  return [{ range: fullRange, newText: formatted }];
}

/**
 * Format a range within a document.
 */
export function formatDocumentRange(
  tree: Tree,
  document: TextDocument,
  range: Range,
  options: FormattingOptions,
  params: FormatDocumentParams = {},
): TextEdit[] {
  const { customTags, printWidth = 80, embeddedFormatted, mustacheSpaces, noBreakDelimiters, configFile } = params;
  const mergedOptions = mergeOptions(options, document.uri, configFile);
  const indentUnit = createIndentUnit(mergedOptions);

  // Bail out if the tree has parse errors to avoid mangling content
  if (tree.rootNode.hasError) {
    return [];
  }

  const customTagMap = buildCustomTagMap(customTags);

  // Find nodes that overlap with the range
  const startOffset = document.offsetAt(range.start);
  const endOffset = document.offsetAt(range.end);

  // Find the smallest node that contains the entire range
  let targetNode = findContainingNode(tree.rootNode, startOffset, endOffset);
  if (!targetNode) {
    targetNode = tree.rootNode;
  }

  // Expand to include complete block-level elements
  while (
    targetNode.parent &&
    !isBlockLevel(targetNode, customTagMap) &&
    targetNode.type !== 'document'
  ) {
    targetNode = targetNode.parent;
  }

  // Calculate the indent level of the target node
  const indentLevel = calculateIndentLevel(
    targetNode,
    isBlockLevel,
    hasImplicitEndTags,
    getContentNodes
  );

  const context: FormatterContext = {
    document,
    customTags: customTagMap,
    embeddedFormatted,
    mustacheSpaces,
    noBreakDelimiters,
  };
  const doc = formatNodeForRange(targetNode, context);
  const formatted = print(doc, { indentUnit, printWidth });

  // Apply the base indent level
  const indentedFormatted = applyBaseIndent(formatted, indentLevel, indentUnit);

  const nodeRange: Range = {
    start: {
      line: targetNode.startPosition.row,
      character: targetNode.startPosition.column,
    },
    end: {
      line: targetNode.endPosition.row,
      character: targetNode.endPosition.column,
    },
  };

  return [{ range: nodeRange, newText: indentedFormatted }];
}

/**
 * Format a single node for range formatting (without the document wrapper).
 */
import { formatNode } from './formatters.js';

function formatNodeForRange(
  node: SyntaxNode,
  context: FormatterContext
): import('./ir.js').Doc {
  return formatNode(node, context);
}

function applyBaseIndent(
  formatted: string,
  indentLevel: number,
  indentUnit: string
): string {
  if (indentLevel === 0) {
    return formatted;
  }

  const baseIndent = indentUnit.repeat(indentLevel);
  return formatted
    .split('\n')
    .map((line, index) => {
      // Don't indent empty lines or the first line (it's at the node position)
      if (line.trim() === '' || index === 0) {
        return line;
      }
      return baseIndent + line;
    })
    .join('\n');
}
