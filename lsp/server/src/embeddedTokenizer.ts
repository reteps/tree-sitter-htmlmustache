import type { IGrammar, IRawGrammar, IOnigLib, RegistryOptions } from 'vscode-textmate';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import * as fs from 'fs';
import * as path from 'path';

// Scope-to-semantic-token-type mapping.
// Uses the same TokenType indices from semanticTokens.ts.
// We import the numeric values directly to avoid circular deps.
const ScopeTokenMap: [string, number][] = [
  // Order matters: more specific prefixes first
  ['comment.block.documentation', 23],
  ['comment.line', 23],
  ['comment.block', 23],
  ['comment', 23],
  ['string.quoted', 24],
  ['string.template', 24],
  ['string.regexp', 26],
  ['string', 24],
  ['constant.numeric', 25],
  ['constant.language', 21],
  ['constant.character.escape', 24],
  ['constant', 25],
  ['keyword.operator', 27],
  ['keyword.control', 21],
  ['keyword', 21],
  ['storage.type', 21],
  ['storage.modifier', 22],
  ['storage', 21],
  ['entity.name.function', 18],
  ['entity.name.type', 7],
  ['entity.name.tag', 0],       // tag
  ['entity.other.attribute-name', 1],  // attributeName
  ['entity.other.inherited-class', 7],
  ['entity.name', 14],
  ['variable.parameter', 13],
  ['variable.language', 21],
  ['variable.other.constant', 14],
  ['variable', 14],
  ['support.function', 18],
  ['support.class', 7],
  ['support.type', 7],
  ['support.constant', 25],
  ['support.variable', 14],
  ['meta.tag', 0],               // tag
  ['punctuation.definition.tag', 3],  // delimiter
  ['punctuation.definition.string', 24],
  ['punctuation.definition.comment', 23],
  ['punctuation.separator', 27],
  ['punctuation.accessor', 27],
  ['punctuation.terminator', 27],
  ['punctuation', 3],            // delimiter
];

/**
 * Decode HTML entities in text and build a mapping from decoded positions
 * back to original positions.
 *
 * Returns the decoded text and an offset map where offsetMap[decodedIndex]
 * gives the corresponding index in the original text.
 */
export function decodeEntities(text: string): { decoded: string; offsetMap: number[] } {
  const decoded: string[] = [];
  const offsetMap: number[] = [];

  // Named entities
  const NAMED_ENTITIES: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': '\u00A0',
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === '&') {
      let matched = false;

      // Try named entities
      for (const [entity, char] of Object.entries(NAMED_ENTITIES)) {
        if (text.startsWith(entity, i)) {
          // Map all characters of the decoded output to the start of the entity
          for (let c = 0; c < char.length; c++) {
            offsetMap.push(i);
          }
          decoded.push(char);
          i += entity.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Try numeric entities: &#123; or &#x1F;
        const numMatch = text.slice(i).match(/^&#(x[0-9a-fA-F]+|[0-9]+);/);
        if (numMatch) {
          const isHex = numMatch[1].startsWith('x');
          const codePoint = parseInt(isHex ? numMatch[1].slice(1) : numMatch[1], isHex ? 16 : 10);
          const char = String.fromCodePoint(codePoint);
          for (let c = 0; c < char.length; c++) {
            offsetMap.push(i);
          }
          decoded.push(char);
          i += numMatch[0].length;
        } else {
          // Not a recognized entity, keep as-is
          offsetMap.push(i);
          decoded.push(text[i]);
          i++;
        }
      }
    } else {
      offsetMap.push(i);
      decoded.push(text[i]);
      i++;
    }
  }

  return { decoded: decoded.join(''), offsetMap };
}

export interface EmbeddedToken {
  row: number;
  col: number;
  length: number;
  tokenType: number;
}

/**
 * Map a TextMate scope stack to a semantic token type.
 * Returns the token type index, or -1 if no mapping found.
 */
function scopeToTokenType(scopes: string[]): number {
  // Walk scopes from most specific (last) to least specific
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    for (const [prefix, tokenType] of ScopeTokenMap) {
      if (scope.startsWith(prefix)) {
        return tokenType;
      }
    }
  }
  return -1;
}

/**
 * Tokenize decoded text using a vscode-textmate grammar.
 * Returns tokens with positions in the decoded text (line/col based).
 */
function tokenizeDecoded(decoded: string, grammar: IGrammar): EmbeddedToken[] {
  const lines = decoded.split('\n');
  const tokens: EmbeddedToken[] = [];
  let ruleStack = INITIAL;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const result = grammar.tokenizeLine(line, ruleStack);

    for (const token of result.tokens) {
      const length = token.endIndex - token.startIndex;
      if (length === 0) continue;

      // Decode scopes
      const scopes = token.scopes;
      const tokenType = scopeToTokenType(scopes);
      if (tokenType < 0) continue;

      tokens.push({
        row: lineIdx,
        col: token.startIndex,
        length,
        tokenType,
      });
    }

    ruleStack = result.ruleStack;
  }

  return tokens;
}

/**
 * Map token positions from decoded text back to original entity-encoded text.
 *
 * @param tokens - Tokens with positions in the decoded text
 * @param offsetMap - Map from decoded char index to original char index
 * @param decodedText - The decoded text (for computing line offsets)
 * @param startRow - Starting row of the content in the document
 * @param startCol - Starting column of the content in the document
 * @param originalText - The original entity-encoded text (for computing line offsets)
 */
function mapTokenPositions(
  tokens: EmbeddedToken[],
  offsetMap: number[],
  decodedText: string,
  startRow: number,
  startCol: number,
  originalText: string,
): EmbeddedToken[] {
  // Build line start offsets for decoded text
  const decodedLineStarts = [0];
  for (let i = 0; i < decodedText.length; i++) {
    if (decodedText[i] === '\n') {
      decodedLineStarts.push(i + 1);
    }
  }

  // Build line start offsets for original text
  const origLineStarts = [0];
  for (let i = 0; i < originalText.length; i++) {
    if (originalText[i] === '\n') {
      origLineStarts.push(i + 1);
    }
  }

  const mapped: EmbeddedToken[] = [];

  for (const token of tokens) {
    // Convert decoded row/col to decoded char index
    const decodedCharStart = decodedLineStarts[token.row] + token.col;
    const decodedCharEnd = decodedCharStart + token.length;

    if (decodedCharStart >= offsetMap.length) continue;

    // Map to original char indices
    const origCharStart = offsetMap[decodedCharStart];
    const origCharEnd = decodedCharEnd <= offsetMap.length
      ? (decodedCharEnd < offsetMap.length ? offsetMap[decodedCharEnd] : originalText.length)
      : originalText.length;

    // Convert original char index to row/col in the document
    // Find which line in originalText this falls on
    let origLine = 0;
    for (let l = origLineStarts.length - 1; l >= 0; l--) {
      if (origCharStart >= origLineStarts[l]) {
        origLine = l;
        break;
      }
    }
    const origCol = origCharStart - origLineStarts[origLine];

    // Compute length in original text
    const origLength = origCharEnd - origCharStart;
    if (origLength <= 0) continue;

    mapped.push({
      row: startRow + origLine,
      col: origLine === 0 ? startCol + origCol : origCol,
      length: origLength,
      tokenType: token.tokenType,
    });
  }

  return mapped;
}

// --- Registry management ---

let onigLib: IOnigLib | null = null;
let registry: Registry | null = null;
let grammarCache = new Map<string, IGrammar | null>();

type GrammarFetcher = (scopeName: string) => Promise<{ content: string; format: 'json' | 'plist' } | null>;

let _grammarFetcher: GrammarFetcher | null = null;

/**
 * Initialize the vscode-textmate registry with vscode-oniguruma.
 * Must be called once at server startup.
 *
 * @param wasmPath - Path to the onig.wasm file
 * @param grammarFetcher - Function to fetch TextMate grammar content by scope name
 */
export async function initializeTextMateRegistry(
  wasmPath: string,
  grammarFetcher: GrammarFetcher,
): Promise<void> {
  _grammarFetcher = grammarFetcher;

  const wasmBin = fs.readFileSync(wasmPath).buffer;
  await loadWASM({ data: wasmBin });

  onigLib = {
    createOnigScanner(patterns: string[]) {
      return createOnigScanner(patterns);
    },
    createOnigString(s: string) {
      return createOnigString(s);
    },
  };

  const options: RegistryOptions = {
    onigLib: Promise.resolve(onigLib),
    async loadGrammar(scopeName: string): Promise<IRawGrammar | null> {
      if (!_grammarFetcher) return null;
      const result = await _grammarFetcher(scopeName);
      if (!result) return null;
      return parseRawGrammar(result.content, result.format === 'json' ? 'grammar.json' : 'grammar.plist');
    },
  };

  registry = new Registry(options);
}

/**
 * Check if the TextMate registry has been initialized.
 */
export function isTextMateReady(): boolean {
  return registry !== null;
}

// Map language IDs to TextMate scope names
const LANGUAGE_TO_SCOPE: Record<string, string> = {
  python: 'source.python',
  javascript: 'source.js',
  typescript: 'source.ts',
  c: 'source.c',
  cpp: 'source.cpp',
  java: 'source.java',
  ruby: 'source.ruby',
  go: 'source.go',
  rust: 'source.rust',
  php: 'text.html.php',
  perl: 'source.perl',
  lua: 'source.lua',
  sql: 'source.sql',
  html: 'text.html.basic',
  css: 'source.css',
  json: 'source.json',
  xml: 'text.xml',
  yaml: 'source.yaml',
  toml: 'source.toml',
  markdown: 'text.html.markdown',
  bash: 'source.shell',
  shellscript: 'source.shell',
  dockerfile: 'source.dockerfile',
  swift: 'source.swift',
  kotlin: 'source.kotlin',
  haskell: 'source.haskell',
  r: 'source.r',
  csharp: 'source.cs',
  matlab: 'source.matlab',
};

/**
 * Get or load a grammar for a language ID.
 */
async function getGrammar(languageId: string): Promise<IGrammar | null> {
  if (!registry) return null;

  const scopeName = LANGUAGE_TO_SCOPE[languageId.toLowerCase()];
  if (!scopeName) return null;

  if (grammarCache.has(scopeName)) {
    return grammarCache.get(scopeName) ?? null;
  }

  try {
    const grammar = await registry.loadGrammar(scopeName);
    grammarCache.set(scopeName, grammar);
    return grammar;
  } catch {
    grammarCache.set(scopeName, null);
    return null;
  }
}

/**
 * Tokenize entity-encoded content from a custom code tag.
 *
 * @param entityEncodedText - The raw text with HTML entities
 * @param languageId - The target language (e.g., "python", "html")
 * @param startRow - Row of the content start in the document
 * @param startCol - Column of the content start in the document
 * @returns Tokens mapped back to original document positions, or empty array
 */
export async function tokenizeEmbeddedContent(
  entityEncodedText: string,
  languageId: string,
  startRow: number,
  startCol: number,
): Promise<EmbeddedToken[]> {
  const grammar = await getGrammar(languageId);
  if (!grammar) return [];

  const { decoded, offsetMap } = decodeEntities(entityEncodedText);
  const decodedTokens = tokenizeDecoded(decoded, grammar);
  return mapTokenPositions(decodedTokens, offsetMap, decoded, startRow, startCol, entityEncodedText);
}
