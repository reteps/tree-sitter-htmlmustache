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
import type { Tree } from '../parser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FormattingOptions, TextEdit, Range } from 'vscode-languageserver/node';

import { print } from './printer';
import { formatDocument as formatDocumentToDoc, FormatterContext } from './formatters';
import { mergeOptions, createIndentUnit } from './editorconfig';
import { findContainingNode, calculateIndentLevel } from './utils';
import { isBlockLevel, getContentNodes, hasImplicitEndTags } from './classifier';

/**
 * Format an entire document.
 */
export function formatDocument(
  tree: Tree,
  document: TextDocument,
  options: FormattingOptions
): TextEdit[] {
  const mergedOptions = mergeOptions(options, document.uri);
  const indentUnit = createIndentUnit(mergedOptions);

  const context: FormatterContext = { document };
  const doc = formatDocumentToDoc(tree.rootNode, context);
  const formatted = print(doc, { indentUnit });

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
  options: FormattingOptions
): TextEdit[] {
  const mergedOptions = mergeOptions(options, document.uri);
  const indentUnit = createIndentUnit(mergedOptions);

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
    !isBlockLevel(targetNode) &&
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

  const context: FormatterContext = { document };
  const doc = formatNodeForRange(targetNode, context);
  const formatted = print(doc, { indentUnit });

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
import { formatNode } from './formatters';

function formatNodeForRange(
  node: SyntaxNode,
  context: FormatterContext
): import('./ir').Doc {
  return formatNode(node, context);
}

/**
 * Apply base indentation to each line of formatted output.
 */
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
