import * as path from 'node:path';
import { Parser, Language, Tree } from 'web-tree-sitter';
import { GRAMMAR_WASM_FILENAME } from '../../src/core/grammar';

let parser: Parser;

export type { Tree };

export async function initializeParser(): Promise<void> {
  await Parser.init();
  parser = new Parser();

  const wasmPath = path.resolve(__dirname, '..', '..', GRAMMAR_WASM_FILENAME);
  const language = await Language.load(wasmPath);
  parser.setLanguage(language);
}

export function parseDocument(source: string): Tree {
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error('Failed to parse document');
  }
  return tree;
}
