import * as path from 'path';
import * as fs from 'fs';
import { Parser, Language, Query, Tree, Edit } from 'web-tree-sitter';

let parser: Parser | null = null;
let language: Language | null = null;

// Logger function - will be set by server.ts
let log: (message: string) => void = console.log;

export function setLogger(logger: (message: string) => void): void {
  log = logger;
}

// Re-export types for other modules
export type { Tree, Query, Edit };

/**
 * Initialize the tree-sitter parser with the htmlmustache grammar.
 * Must be called once before parsing any documents.
 */
export async function initializeParser(): Promise<void> {
  log(`Parser initialization starting...`);
  log(`__dirname: ${__dirname}`);

  // Find web-tree-sitter.wasm - it's copied to server/out during build
  const webTsWasmPath = path.resolve(__dirname, 'web-tree-sitter.wasm');
  log(`web-tree-sitter.wasm path: ${webTsWasmPath}`);
  log(`web-tree-sitter.wasm exists: ${fs.existsSync(webTsWasmPath)}`);

  if (!fs.existsSync(webTsWasmPath)) {
    throw new Error(`web-tree-sitter.wasm not found at ${webTsWasmPath}`);
  }

  // Initialize web-tree-sitter with explicit WASM binary
  try {
    log(`Reading web-tree-sitter.wasm...`);
    const wasmBinary = fs.readFileSync(webTsWasmPath);
    log(`WASM binary size: ${wasmBinary.length} bytes`);

    log(`Calling Parser.init() with wasmBinary...`);
    // Pass both wasmBinary and locateFile to handle all code paths
    await Parser.init({
      wasmBinary: wasmBinary.buffer,
      locateFile: (scriptName: string, scriptDirectory: string) => {
        log(`locateFile called: scriptName=${scriptName}, scriptDirectory=${scriptDirectory}`);
        // Return the path to our copied WASM file
        return path.resolve(__dirname, scriptName);
      },
    });
    log(`Parser.init() completed successfully`);
  } catch (error) {
    log(`Parser.init() failed: ${error}`);
    throw error;
  }

  parser = new Parser();

  // Load the grammar WASM file - copied to extension root during build
  // server/out -> server -> extension root
  const grammarWasmPath = path.resolve(__dirname, '..', '..', 'tree-sitter-htmlmustache.wasm');
  log(`Grammar WASM path: ${grammarWasmPath}`);
  log(`Grammar WASM exists: ${fs.existsSync(grammarWasmPath)}`);

  if (!fs.existsSync(grammarWasmPath)) {
    throw new Error(`tree-sitter-htmlmustache.wasm not found at ${grammarWasmPath}`);
  }

  try {
    language = await Language.load(grammarWasmPath);
    log(`Language.load() completed successfully`);
    parser.setLanguage(language);
    log(`Parser language set successfully`);
  } catch (error) {
    log(`Failed to load tree-sitter-htmlmustache.wasm from ${grammarWasmPath}: ${error}`);
    throw error;
  }
}

/**
 * Parse a document and return the syntax tree.
 */
export function parseDocument(text: string): Tree | null {
  if (!parser) {
    console.error('Parser not initialized. Call initializeParser() first.');
    return null;
  }
  return parser.parse(text);
}

/**
 * Get the current parser language for running queries.
 */
export function getLanguage(): Language | null {
  return language;
}

/**
 * Create a tree-sitter query from a query string.
 */
export function createQuery(queryString: string): Query | null {
  if (!language) {
    console.error('Language not loaded. Call initializeParser() first.');
    return null;
  }
  return new Query(language, queryString);
}

/**
 * Incrementally update a parse tree with edits.
 * This is more efficient than reparsing the entire document.
 */
export function updateTree(
  oldTree: Tree,
  text: string,
  edits: Edit[]
): Tree | null {
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
 * Convert LSP position changes to tree-sitter edits.
 */
export function toTreeSitterEdit(
  startIndex: number,
  oldEndIndex: number,
  newEndIndex: number,
  startPosition: { line: number; character: number },
  oldEndPosition: { line: number; character: number },
  newEndPosition: { line: number; character: number }
): Edit {
  return new Edit({
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition: { row: startPosition.line, column: startPosition.character },
    oldEndPosition: { row: oldEndPosition.line, column: oldEndPosition.character },
    newEndPosition: { row: newEndPosition.line, column: newEndPosition.character },
  });
}
