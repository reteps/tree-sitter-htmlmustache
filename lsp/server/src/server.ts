import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CodeActionKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Node as SyntaxNode } from 'web-tree-sitter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { initializeParser, parseDocument, getLanguage, createQuery, Tree, Query, setLogger } from './parser.js';
import { tokenTypesLegend, tokenModifiersLegend, getLanguageModifier } from './tokenLegend.js';
import { buildSemanticTokens, HIGHLIGHT_QUERY, RAW_TEXT_QUERY } from './semanticTokens.js';
import type { TokenInfo } from './semanticTokens.js';
import { getDocumentSymbols } from './documentSymbols.js';
import { getHoverInfo } from './hover.js';
import { getFoldingRanges } from './folding.js';
import { formatDocument, formatDocumentRange } from '../../../src/core/formatting/index.js';
import { mergeOptions } from '../../../src/core/formatting/mergeOptions.js';
import { getEditorConfigOptions } from './formatting/editorconfig.js';
import { getDiagnostics } from './diagnostics.js';
import { getCodeActions } from './codeActions.js';
import { initializeTextMateRegistry, isTextMateReady, tokenizeEmbeddedContent, setEmbeddedTokenizerLogger } from './embeddedTokenizer.js';
import { findCustomCodeTagContent, isCodeTag } from '../../../src/core/customCodeTags.js';
import type { CustomCodeTagConfig } from '../../../src/core/customCodeTags.js';
import { loadConfigFile } from './configFile.js';
import type { HtmlMustacheConfig, NoBreakDelimiter } from '../../../src/core/configSchema.js';

// Create connection and document manager
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Cache parsed trees for each document
const trees = new Map<string, Tree>();

// Highlight query (loaded from highlights.scm)
let highlightQuery: Query | null = null;

// Raw text query for finding Mustache in script/style tags
let rawTextQuery: Query | null = null;

/**
 * Resolve config settings for a document URI.
 * Returns config file values with defaults applied.
 */
function resolveConfig(uri: string): {
  config: HtmlMustacheConfig | null;
  customTags: CustomCodeTagConfig[];
  printWidth: number;
  mustacheSpaces: boolean | undefined;
  noBreakDelimiters: NoBreakDelimiter[] | undefined;
} {
  const config = loadConfigFile(uri);
  return {
    config,
    customTags: config?.customTags ?? [],
    printWidth: config?.printWidth ?? 80,
    mustacheSpaces: config?.mustacheSpaces,
    noBreakDelimiters: config?.noBreakDelimiters,
  };
}

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  connection.console.log('onInitialize called');
  connection.console.log(`Client info: ${params.clientInfo?.name} ${params.clientInfo?.version}`);

  // Wire up parser logging to LSP connection
  setLogger((msg) => connection.console.log(msg));

  // Initialize tree-sitter parser
  try {
    connection.console.log('Initializing tree-sitter parser...');
    await initializeParser();
    connection.console.log('Tree-sitter parser initialized successfully');

    // Load highlight query
    const language = getLanguage();
    connection.console.log(`Language loaded: ${language ? 'yes' : 'no'}`);
    if (language) {
      try {
        highlightQuery = createQuery(HIGHLIGHT_QUERY);
        connection.console.log(`Highlight query created: ${highlightQuery ? 'yes' : 'no'}`);
      } catch (e) {
        connection.console.warn(`Failed to create highlight query: ${e}`);
      }
      try {
        rawTextQuery = createQuery(RAW_TEXT_QUERY);
        connection.console.log(`Raw text query created: ${rawTextQuery ? 'yes' : 'no'}`);
      } catch (e) {
        connection.console.warn(`Failed to create raw text query: ${e}`);
      }
    }
  } catch (error) {
    connection.console.error(`Failed to initialize parser: ${error}`);
  }

  // Initialize vscode-textmate for embedded language tokenization
  setEmbeddedTokenizerLogger((msg) => connection.console.log(`[embeddedTokenizer] ${msg}`));
  try {
    const wasmPath = path.join(__dirname, 'onig.wasm');
    await initializeTextMateRegistry(wasmPath, async (scopeName: string) => {
      try {
        connection.console.log(`Requesting grammar from client: ${scopeName}`);
        const result = await connection.sendRequest('htmlmustache/getGrammar', { scopeName });
        if (result) {
          const r = result as { content: string; format: 'json' | 'plist' };
          connection.console.log(`Got grammar from client: ${scopeName} (${r.format}, ${r.content.length} chars)`);
        } else {
          connection.console.log(`Client returned null for grammar: ${scopeName}`);
        }
        return result as { content: string; format: 'json' | 'plist' } | null;
      } catch (e) {
        connection.console.warn(`Failed to get grammar from client: ${scopeName}: ${e}`);
        return null;
      }
    });
    connection.console.log('vscode-textmate registry initialized');
  } catch (error) {
    connection.console.warn(`Failed to initialize vscode-textmate: ${error}`);
  }

  const capabilities = params.capabilities;

  // Check client capabilities
  const hasSemanticTokens = !!(
    capabilities.textDocument?.semanticTokens
  );

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,

      // Semantic tokens for syntax highlighting
      semanticTokensProvider: hasSemanticTokens
        ? {
            legend: {
              tokenTypes: tokenTypesLegend,
              tokenModifiers: tokenModifiersLegend,
            },
            full: true,
            range: false,
          }
        : undefined,

      // Document symbols for outline view
      documentSymbolProvider: true,

      // Hover information
      hoverProvider: true,

      // Folding ranges
      foldingRangeProvider: true,

      // Code actions (quick fixes)
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },

      // Document formatting
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,

      // TODO: Add more capabilities as needed
      // completionProvider: { resolveProvider: true },
      // definitionProvider: true,
      // referencesProvider: true,
    },
  };
});

connection.onInitialized(() => {
  connection.console.log('HTML Mustache Language Server initialized');
});

// Parse document on open
documents.onDidOpen((event) => {
  connection.console.log(`Document opened: ${event.document.uri} (language: ${event.document.languageId})`);
  const tree = parseAndCacheDocument(event.document);
  if (tree) {
    const { config } = resolveConfig(event.document.uri);
    const customTagNames = config?.customTags?.map(t => t.name);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: getDiagnostics(tree, config?.rules, customTagNames, config?.customRules) });
  }
});

// Reparse on content change
documents.onDidChangeContent((change) => {
  const tree = parseAndCacheDocument(change.document);
  if (tree) {
    const { config } = resolveConfig(change.document.uri);
    const customTagNames = config?.customTags?.map(t => t.name);
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics: getDiagnostics(tree, config?.rules, customTagNames, config?.customRules) });
  }
});

// Clean up when document is closed
documents.onDidClose((event) => {
  connection.console.log(`Document closed: ${event.document.uri}`);
  trees.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

/**
 * Parse a document and cache the tree.
 */
function parseAndCacheDocument(document: TextDocument): Tree | null {
  const text = document.getText();
  const tree = parseDocument(text);

  if (tree) {
    trees.set(document.uri, tree);
    connection.console.log(`Parsed document: ${document.uri} (${text.length} chars, root: ${tree.rootNode.type})`);
  } else {
    connection.console.log(`Failed to parse document: ${document.uri}`);
  }

  return tree;
}

/**
 * Get the cached tree for a document, parsing if necessary.
 */
function getTree(document: TextDocument): Tree | null {
  let tree = trees.get(document.uri);
  if (!tree) {
    tree = parseAndCacheDocument(document) ?? undefined;
  }
  return tree ?? null;
}

// Semantic tokens handler
connection.languages.semanticTokens.on(async (params) => {
  connection.console.log(`Semantic tokens requested for: ${params.textDocument.uri}`);

  const document = documents.get(params.textDocument.uri);
  if (!document) {
    connection.console.log('  -> No document found');
    return { data: [] };
  }

  const tree = getTree(document);
  if (!tree) {
    connection.console.log('  -> No parse tree available');
    return { data: [] };
  }

  if (!highlightQuery) {
    connection.console.log('  -> No highlight query available');
    return { data: [] };
  }

  // Load config for this document
  const { customTags } = resolveConfig(document.uri);

  // Tokenize embedded language content in custom code tags
  let embeddedTokens: TokenInfo[] = [];
  const codeTagConfigs = customTags.filter(isCodeTag);
  connection.console.log(`  -> TextMate ready: ${isTextMateReady()}, configs: ${codeTagConfigs.length}`);
  if (isTextMateReady() && codeTagConfigs.length > 0) {
    try {
      const codeTagContents = findCustomCodeTagContent(tree.rootNode, codeTagConfigs);
      connection.console.log(`  -> Found ${codeTagContents.length} custom code tag regions`);
      for (const c of codeTagContents) {
        connection.console.log(`     - lang=${c.languageId}, row=${c.startRow}, col=${c.startCol}, text=${JSON.stringify(c.text.slice(0, 80))}...`);
      }
      if (codeTagContents.length > 0) {
        const tokenArrays = await Promise.all(
          codeTagContents.map((content) =>
            tokenizeEmbeddedContent(content.text, content.languageId, content.startRow, content.startCol, getLanguageModifier(content.languageId))
          )
        );
        embeddedTokens = tokenArrays.flat();
        connection.console.log(`  -> Embedded tokens: ${embeddedTokens.length} from ${codeTagContents.length} regions`);
      }
    } catch (error) {
      connection.console.warn(`  -> Embedded tokenization failed: ${error}`);
      // Continue with normal tokens only - don't let embedded tokenization failure
      // prevent the rest of the semantic tokens from being returned
    }
  }

  const result = buildSemanticTokens(
    tree, highlightQuery, rawTextQuery ?? undefined, embeddedTokens.length > 0 ? embeddedTokens : undefined
  ).build();
  const tokenCount = result.data.length / 5;
  connection.console.log(`  -> Returning ${tokenCount} tokens`);
  return result;
});

// Document symbols handler (outline)
connection.onDocumentSymbol((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const tree = getTree(document);
  if (!tree) {
    return [];
  }

  return getDocumentSymbols(tree, document);
});

// Hover handler
connection.onHover((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const tree = getTree(document);
  if (!tree) {
    return null;
  }

  return getHoverInfo(tree, document, params.position);
});

// Folding ranges handler
connection.onFoldingRanges((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const tree = getTree(document);
  if (!tree) {
    return [];
  }

  return getFoldingRanges(tree);
});

// Code action handler (quick fixes)
connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  return getCodeActions(params, document);
});

// Embedded script/style formatting helpers

import { collectEmbeddedRegions } from '../../../src/core/embeddedRegions.js';

/**
 * Send embedded regions to the client for formatting via custom request.
 * Returns a map of startIndex → formatted content.
 */
async function formatEmbeddedRegions(
  rootNode: SyntaxNode,
  options: { tabSize: number; insertSpaces: boolean }
): Promise<Map<number, string>> {
  const regions = collectEmbeddedRegions(rootNode);
  const result = new Map<number, string>();

  if (regions.length === 0) return result;

  const responses = await Promise.all(
    regions.map(async (region) => {
      try {
        const response = await connection.sendRequest('htmlmustache/formatEmbedded', {
          content: region.content,
          languageId: region.languageId,
          options: {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          },
        });
        return { startIndex: region.startIndex, response: response as { formatted: string | null } };
      } catch {
        return { startIndex: region.startIndex, response: { formatted: null } };
      }
    })
  );

  for (const { startIndex, response } of responses) {
    if (response.formatted !== null) {
      result.set(startIndex, response.formatted);
    }
  }

  return result;
}

// Document formatting handler
connection.onDocumentFormatting(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const tree = getTree(document);
  if (!tree || tree.rootNode.hasError) {
    return [];
  }

  const { config, customTags, printWidth, mustacheSpaces, noBreakDelimiters } = resolveConfig(document.uri);
  const resolvedOptions = mergeOptions(params.options, config, getEditorConfigOptions(document.uri));
  const embeddedFormatted = await formatEmbeddedRegions(tree.rootNode, resolvedOptions);
  return formatDocument(tree, document, resolvedOptions, {
    customTags, printWidth, embeddedFormatted, mustacheSpaces, noBreakDelimiters,
  });
});

// Document range formatting handler
connection.onDocumentRangeFormatting(async (params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const tree = getTree(document);
  if (!tree || tree.rootNode.hasError) {
    return [];
  }

  const { config, customTags, printWidth, mustacheSpaces, noBreakDelimiters } = resolveConfig(document.uri);
  const resolvedOptions = mergeOptions(params.options, config, getEditorConfigOptions(document.uri));
  const embeddedFormatted = await formatEmbeddedRegions(tree.rootNode, resolvedOptions);
  return formatDocumentRange(tree, document, params.range, resolvedOptions, {
    customTags, printWidth, embeddedFormatted, mustacheSpaces, noBreakDelimiters,
  });
});

// Listen on the documents and connection
documents.listen(connection);
connection.listen();
