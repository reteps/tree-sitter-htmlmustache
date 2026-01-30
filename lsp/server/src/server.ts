import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { initializeParser, parseDocument, getLanguage, createQuery, Tree, Query, setLogger } from './parser';
import {
  buildSemanticTokens,
  tokenTypesLegend,
  tokenModifiersLegend,
  HIGHLIGHT_QUERY,
  RAW_TEXT_QUERY,
} from './semanticTokens';
import { getDocumentSymbols } from './documentSymbols';
import { getHoverInfo } from './hover';
import { getFoldingRanges } from './folding';
import { formatDocument, formatDocumentRange } from './formatting/index';
import { getDiagnostics } from './diagnostics';

// Create connection and document manager
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Cache parsed trees for each document
const trees = new Map<string, Tree>();

// Highlight query (loaded from highlights.scm)
let highlightQuery: Query | null = null;

// Raw text query for finding Mustache in script/style tags
let rawTextQuery: Query | null = null;

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
  connection.console.log(`Document opened: ${event.document.uri} (language: ${event.document.languageId})`);
  const tree = parseAndCacheDocument(event.document);
  if (tree) {
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: getDiagnostics(tree) });
  }
});

// Reparse on content change
documents.onDidChangeContent((change) => {
  const tree = parseAndCacheDocument(change.document);
  if (tree) {
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics: getDiagnostics(tree) });
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
connection.languages.semanticTokens.on((params) => {
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

  const result = buildSemanticTokens(tree, highlightQuery, rawTextQuery ?? undefined).build();
  // Each semantic token is encoded as 5 integers (deltaLine, deltaStart, length, type, modifiers)
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
