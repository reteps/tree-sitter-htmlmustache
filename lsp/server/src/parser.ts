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

  // Find web-tree-sitter.wasm for Parser.init()
  // Try multiple potential locations since paths differ between dev and packaged extension
  const potentialWebTsWasmPaths = [
    // Development: relative to server/out
    path.resolve(__dirname, '..', '..', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
    // pnpm structure
    path.resolve(__dirname, '..', '..', 'node_modules', '.pnpm', 'web-tree-sitter@0.26.3', 'node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
    // Try using require.resolve to find it
    (() => {
      try {
        const webTsPath = require.resolve('web-tree-sitter');
        return path.resolve(path.dirname(webTsPath), 'web-tree-sitter.wasm');
      } catch {
        return '';
      }
    })(),
  ];

  let webTreeSitterWasmPath = '';
  for (const p of potentialWebTsWasmPaths) {
    if (p && fs.existsSync(p)) {
      webTreeSitterWasmPath = p;
      break;
    }
  }

  log(`Checked web-tree-sitter.wasm paths:`);
  for (const p of potentialWebTsWasmPaths) {
    log(`  ${p}: ${p && fs.existsSync(p) ? 'EXISTS' : 'not found'}`);
  }
  log(`Using: ${webTreeSitterWasmPath || 'NONE FOUND'}`);

  if (!webTreeSitterWasmPath) {
    const error = 'Could not find web-tree-sitter.wasm in any expected location';
    log(error);
    throw new Error(error);
  }

  try {
    await Parser.init({
      locateFile: (scriptName: string) => {
        log(`Parser.init locateFile called for: ${scriptName}`);
        if (scriptName === 'web-tree-sitter.wasm') {
          return webTreeSitterWasmPath;
        }
        return scriptName;
      },
    });
    log(`Parser.init() completed successfully`);
  } catch (error) {
    log(`Parser.init() failed: ${error}`);
    throw error;
  }

  parser = new Parser();

  // Load the grammar WASM file - copied to lsp/ directory during build
  // Try multiple potential locations
  const potentialGrammarWasmPaths = [
    path.resolve(__dirname, '..', '..', 'tree-sitter-htmlmustache.wasm'),
    path.resolve(__dirname, '..', 'tree-sitter-htmlmustache.wasm'),
    path.resolve(__dirname, 'tree-sitter-htmlmustache.wasm'),
  ];

  let grammarWasmPath = '';
  for (const p of potentialGrammarWasmPaths) {
    if (fs.existsSync(p)) {
      grammarWasmPath = p;
      break;
    }
  }

  log(`Checked grammar WASM paths:`);
  for (const p of potentialGrammarWasmPaths) {
    log(`  ${p}: ${fs.existsSync(p) ? 'EXISTS' : 'not found'}`);
  }
  log(`Using: ${grammarWasmPath || 'NONE FOUND'}`);

  if (!grammarWasmPath) {
    const error = 'Could not find tree-sitter-htmlmustache.wasm in any expected location';
    log(error);
    throw new Error(error);
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
