import * as path from 'path';
import { Parser, Language, Query, Tree } from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { beforeAll, vi } from 'vitest';

// Global instances shared across tests
let parser: Parser;
let language: Language;

/**
 * Get the initialized parser instance.
 */
export function getParser(): Parser {
  return parser;
}

/**
 * Get the loaded language instance.
 */
export function getTestLanguage(): Language {
  return language;
}

/**
 * Parse text into a tree-sitter Tree.
 */
export function parseText(text: string): Tree {
  return parser.parse(text);
}

/**
 * Create a query from the language.
 */
export function createTestQuery(queryString: string): Query {
  return new Query(language, queryString);
}

/**
 * Create a mock TextDocument for testing LSP features.
 */
export function createMockDocument(content: string, uri = 'file:///test.mustache'): TextDocument {
  return TextDocument.create(uri, 'htmlmustache', 1, content);
}

// Initialize tree-sitter before all tests
beforeAll(async () => {
  await Parser.init();
  parser = new Parser();

  // Path to WASM file relative to compiled test location (out/test/)
  const wasmPath = path.resolve(__dirname, '..', '..', '..', '..', 'tree-sitter-htmlmustache.wasm');

  try {
    language = await Language.load(wasmPath);
    parser.setLanguage(language);
  } catch (error) {
    console.error(`Failed to load tree-sitter-htmlmustache.wasm from ${wasmPath}:`, error);
    throw error;
  }
});
