import { Node as SyntaxNode } from 'web-tree-sitter';
import type { Tree } from './parser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentSymbol, SymbolKind, Range } from 'vscode-languageserver/node';
import { getTagName, getSectionName, isMustacheSection, isRawContentElement } from './nodeHelpers';

/**
 * Extract document symbols (outline) from the syntax tree.
 * Shows HTML elements and Mustache sections in the outline.
 */
export function getDocumentSymbols(
  tree: Tree,
  document: TextDocument
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  walkForSymbols(tree.rootNode, symbols, document);

  return symbols;
}

function walkForSymbols(
  node: SyntaxNode,
  symbols: DocumentSymbol[],
  document: TextDocument
): void {
  const symbol = nodeToSymbol(node, document);

  if (symbol) {
    // Recursively get children symbols
    const children: DocumentSymbol[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        walkForSymbols(child, children, document);
      }
    }
    symbol.children = children.length > 0 ? children : undefined;
    symbols.push(symbol);
  } else {
    // No symbol for this node, but check children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        walkForSymbols(child, symbols, document);
      }
    }
  }
}

function nodeToSymbol(
  node: SyntaxNode,
  _document: TextDocument
): DocumentSymbol | null {
  const type = node.type;

  // HTML elements
  if (type === 'html_element') {
    const tagName = getTagName(node);
    if (tagName) {
      return {
        name: `<${tagName}>`,
        kind: SymbolKind.Class,
        range: toRange(node),
        selectionRange: toRange(node.child(0) ?? node), // Start tag
      };
    }
  }

  // Void elements (self-closing)
  if (type === 'html_void_element') {
    const tagName = getTagName(node);
    if (tagName) {
      return {
        name: `<${tagName}>`,
        kind: SymbolKind.Class,
        range: toRange(node),
        selectionRange: toRange(node),
      };
    }
  }

  // Mustache sections
  if (isMustacheSection(node)) {
    const sectionName = getSectionName(node);
    if (sectionName) {
      const prefix = type === 'mustache_inverted_section' ? '{{^' : '{{#';
      return {
        name: `${prefix}${sectionName}}}`,
        kind: SymbolKind.Namespace,
        range: toRange(node),
        selectionRange: toRange(node.child(0) ?? node), // Section begin
      };
    }
  }

  // Script, style, and raw elements
  if (isRawContentElement(node)) {
    const tagName = getTagName(node);
    const displayName = tagName ? `<${tagName}>` : type === 'html_script_element' ? '<script>' : type === 'html_style_element' ? '<style>' : '<raw>';
    return {
      name: displayName,
      kind: SymbolKind.Module,
      range: toRange(node),
      selectionRange: toRange(node.child(0) ?? node),
    };
  }

  return null;
}

function toRange(node: SyntaxNode): Range {
  return {
    start: {
      line: node.startPosition.row,
      character: node.startPosition.column,
    },
    end: {
      line: node.endPosition.row,
      character: node.endPosition.column,
    },
  };
}
