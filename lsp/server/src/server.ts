import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { initializeParser, parseDocument, getLanguage, createQuery, Tree, Query } from './parser';
import {
  buildSemanticTokens,
  tokenTypesLegend,
  tokenModifiersLegend,
  HIGHLIGHT_QUERY,
} from './semanticTokens';
import { getDocumentSymbols } from './documentSymbols';
import { getHoverInfo } from './hover';
import { getFoldingRanges } from './folding';
import { formatDocument, formatDocumentRange } from './formatting/index';

// Create connection and document manager
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Cache parsed trees for each document
const trees = new Map<string, Tree>();

// Highlight query (loaded from highlights.scm)
let highlightQuery: Query | null = null;

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  // Initialize tree-sitter parser
  try {
    await initializeParser();
    connection.console.log('Tree-sitter parser initialized successfully');

    // Load highlight query
    const language = getLanguage();
    if (language) {
      try {
        highlightQuery = createQuery(HIGHLIGHT_QUERY);
      } catch (e) {
        connection.console.warn(`Failed to create highlight query: ${e}`);
      }
    }
  } catch (error) {
    connection.console.error(`Failed to initialize parser: ${error}`);
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
  parseAndCacheDocument(event.document);
});

// Reparse on content change
documents.onDidChangeContent((change) => {
  parseAndCacheDocument(change.document);
});

// Clean up when document is closed
documents.onDidClose((event) => {
  trees.delete(event.document.uri);
});

/**
 * Parse a document and cache the tree.
 */
function parseAndCacheDocument(document: TextDocument): Tree | null {
  const text = document.getText();
  const tree = parseDocument(text);

  if (tree) {
    trees.set(document.uri, tree);
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
connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return { data: [] };
  }

  const tree = getTree(document);
  if (!tree) {
    return { data: [] };
  }

  if (!highlightQuery) {
    return { data: [] };
  }

  return buildSemanticTokens(tree, highlightQuery).build();
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

// Document formatting handler
connection.onDocumentFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const tree = getTree(document);
  if (!tree) {
    return [];
  }

  return formatDocument(tree, document, params.options);
});

// Document range formatting handler
connection.onDocumentRangeFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const tree = getTree(document);
  if (!tree) {
    return [];
  }

  return formatDocumentRange(tree, document, params.range, params.options);
});

// Listen on the documents and connection
documents.listen(connection);
connection.listen();
