import * as path from 'path';
import Parser from 'web-tree-sitter';

let parser: Parser | null = null;
let language: Parser.Language | null = null;

/**
 * Initialize the tree-sitter parser with the htmlmustache grammar.
 * Must be called once before parsing any documents.
 */
export async function initializeParser(): Promise<void> {
  await Parser.init();
  parser = new Parser();

  // Load the WASM file from the parent project
  // In production, this should be bundled with the extension
  const wasmPath = path.resolve(__dirname, '..', '..', '..', 'tree-sitter-htmlmustache.wasm');

  try {
    language = await Parser.Language.load(wasmPath);
    parser.setLanguage(language);
  } catch (error) {
    console.error(`Failed to load tree-sitter-htmlmustache.wasm from ${wasmPath}:`, error);
    throw error;
  }
}

/**
 * Parse a document and return the syntax tree.
 */
export function parseDocument(text: string): Parser.Tree | null {
  if (!parser) {
    console.error('Parser not initialized. Call initializeParser() first.');
    return null;
  }
  return parser.parse(text);
}

/**
 * Incrementally update a parse tree with edits.
 * This is more efficient than reparsing the entire document.
 */
export function updateTree(
  oldTree: Parser.Tree,
  text: string,
  edits: Parser.Edit[]
): Parser.Tree | null {
  if (!parser) {
    console.error('Parser not initialized. Call initializeParser() first.');
    return null;
  }

  // Apply edits to the old tree
  for (const edit of edits) {
    oldTree.edit(edit);
  }

  // Reparse with the edited tree for incremental parsing
  return parser.parse(text, oldTree);
}

/**
 * Get the current parser language for running queries.
 */
export function getLanguage(): Parser.Language | null {
  return language;
}

/**
 * Create a tree-sitter query from a query string.
 */
export function createQuery(queryString: string): Parser.Query | null {
  if (!language) {
    console.error('Language not loaded. Call initializeParser() first.');
    return null;
  }
  return language.query(queryString);
}

/**
 * Convert LSP position changes to tree-sitter edits.
 */
export function toTreeSitterEdit(
  startOffset: number,
  oldEndOffset: number,
  newEndOffset: number,
  startPosition: { line: number; character: number },
  oldEndPosition: { line: number; character: number },
  newEndPosition: { line: number; character: number }
): Parser.Edit {
  return {
    startIndex: startOffset,
    oldEndIndex: oldEndOffset,
    newEndIndex: newEndOffset,
    startPosition: { row: startPosition.line, column: startPosition.character },
    oldEndPosition: { row: oldEndPosition.line, column: oldEndPosition.character },
    newEndPosition: { row: newEndPosition.line, column: newEndPosition.character },
  };
}
