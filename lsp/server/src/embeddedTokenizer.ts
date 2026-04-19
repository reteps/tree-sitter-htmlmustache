import type { IGrammar, IRawGrammar, IOnigLib, RegistryOptions } from 'vscode-textmate';
import { Registry, parseRawGrammar, INITIAL } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import * as fs from 'fs';
import { scopeMatchTable } from './tokenLegend.js';

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
  tokenModifiers?: number;
}

/**
 * Map a TextMate scope stack to a semantic token type.
 * Returns the token type index, or -1 if no mapping found.
 */
function scopeToTokenType(scopes: string[]): number {
  // Walk scopes from most specific (last) to least specific
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    for (const [prefix, tokenType] of scopeMatchTable) {
      if (scope.startsWith(prefix)) {
        return tokenType;
      }
    }
  }
  return -1;
}

/**
 * Strip common leading whitespace from all non-empty lines.
 * This prevents indentation-sensitive grammars (e.g., markdown) from
 * misinterpreting document indentation as meaningful syntax (like code blocks).
 */
export function dedentText(text: string): { dedented: string; indent: number } {
  const lines = text.split('\n');

  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    minIndent = Math.min(minIndent, indent);
  }

  if (minIndent === 0 || minIndent === Infinity) {
    return { dedented: text, indent: 0 };
  }

  const dedented = lines.map(line => {
    if (line.trim().length === 0) return line;
    return line.slice(minIndent);
  }).join('\n');

  return { dedented, indent: minIndent };
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
const grammarCache = new Map<string, IGrammar | null>();

type GrammarFetcher = (scopeName: string) => Promise<{ content: string; format: 'json' | 'plist' } | null>;
type Logger = (msg: string) => void;

let _grammarFetcher: GrammarFetcher | null = null;
let _log: Logger = () => {};

/**
 * Set the logger function for embedded tokenizer.
 */
export function setEmbeddedTokenizerLogger(logger: Logger): void {
  _log = logger;
}

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

  _log(`Loading onig.wasm from: ${wasmPath}`);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`onig.wasm not found at ${wasmPath}`);
  }

  // Read the WASM binary and create a proper Uint8Array.
  // Node.js Buffers can share underlying ArrayBuffers (pool allocation),
  // so buf.buffer may not start at the right offset. Using Uint8Array
  // with explicit offset/length ensures we pass exactly the WASM bytes.
  const buf = fs.readFileSync(wasmPath);
  _log(`onig.wasm size: ${buf.length} bytes`);
  const wasmBin = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  await loadWASM({ data: wasmBin });
  _log('onig.wasm loaded successfully');

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
      _log(`Fetching grammar for scope: ${scopeName}`);
      const result = await _grammarFetcher(scopeName);
      if (!result) {
        _log(`No grammar found for scope: ${scopeName}`);
        return null;
      }
      _log(`Got grammar for ${scopeName} (${result.format}, ${result.content.length} chars)`);
      return parseRawGrammar(result.content, result.format === 'json' ? 'grammar.json' : 'grammar.plist');
    },
  };

  registry = new Registry(options);
  _log('TextMate registry created');
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
  dot: 'source.dot',
  graphviz: 'source.dot',
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
    if (grammar) {
      grammarCache.set(scopeName, grammar);
    }
    // Don't cache null — grammar might become available later (extension install, transient failure)
    return grammar;
  } catch (e) {
    _log(`Failed to load grammar ${scopeName}: ${e}`);
    // Don't cache failures — allow retry on next request
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
 * @param languageModifier - Bitmask for the language modifier (from getLanguageModifier)
 * @returns Tokens mapped back to original document positions, or empty array
 */
export async function tokenizeEmbeddedContent(
  entityEncodedText: string,
  languageId: string,
  startRow: number,
  startCol: number,
  languageModifier?: number,
): Promise<EmbeddedToken[]> {
  _log(`tokenizeEmbeddedContent: lang=${languageId}, row=${startRow}, col=${startCol}, text=${entityEncodedText.length} chars`);
  const grammar = await getGrammar(languageId);
  if (!grammar) {
    _log(`tokenizeEmbeddedContent: no grammar for ${languageId}`);
    return [];
  }

  const { decoded, offsetMap } = decodeEntities(entityEncodedText);
  _log(`tokenizeEmbeddedContent: decoded ${entityEncodedText.length} -> ${decoded.length} chars`);

  // Dedent to prevent indentation-sensitive grammars (markdown) from
  // misinterpreting document indentation as syntax (e.g., 4-space code blocks).
  const { dedented, indent } = dedentText(decoded);
  if (indent > 0) {
    _log(`tokenizeEmbeddedContent: dedented by ${indent} chars`);
  }

  const decodedTokens = tokenizeDecoded(dedented, grammar);
  _log(`tokenizeEmbeddedContent: ${decodedTokens.length} decoded tokens`);

  // Shift columns back so positions reference the original decoded text
  if (indent > 0) {
    for (const token of decodedTokens) {
      token.col += indent;
    }
  }

  const mapped = mapTokenPositions(decodedTokens, offsetMap, decoded, startRow, startCol, entityEncodedText);
  _log(`tokenizeEmbeddedContent: ${mapped.length} mapped tokens`);

  // Tag all tokens with the language modifier
  if (languageModifier) {
    for (const token of mapped) {
      token.tokenModifiers = languageModifier;
    }
  }

  return mapped;
}
