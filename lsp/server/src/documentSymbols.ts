import Parser from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentSymbol, SymbolKind, Range } from 'vscode-languageserver/node';

/**
 * Extract document symbols (outline) from the syntax tree.
 * Shows HTML elements and Mustache sections in the outline.
 */
export function getDocumentSymbols(
  tree: Parser.Tree,
  document: TextDocument
): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  walkForSymbols(tree.rootNode, symbols, document);

  return symbols;
}

function walkForSymbols(
  node: Parser.SyntaxNode,
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
  node: Parser.SyntaxNode,
  _document: TextDocument
): DocumentSymbol | null {
  const type = node.type;

  // HTML elements
  if (type === 'html_element') {
    const tagName = findTagName(node);
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
    const tagName = findTagName(node);
    if (tagName) {
      return {
        name: `<${tagName} />`,
        kind: SymbolKind.Class,
        range: toRange(node),
        selectionRange: toRange(node),
      };
    }
  }

  // Mustache sections
  if (type === 'mustache_section' || type === 'mustache_inverted_section') {
    const sectionName = findMustacheSectionName(node);
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

  // Script elements
  if (type === 'html_script_element') {
    return {
      name: '<script>',
      kind: SymbolKind.Module,
      range: toRange(node),
      selectionRange: toRange(node.child(0) ?? node),
    };
  }

  // Style elements
  if (type === 'html_style_element') {
    return {
      name: '<style>',
      kind: SymbolKind.Module,
      range: toRange(node),
      selectionRange: toRange(node.child(0) ?? node),
    };
  }

  return null;
}

function findTagName(node: Parser.SyntaxNode): string | null {
  // Look for html_tag_name in start_tag or the element itself
  const startTag = node.childForFieldName('start_tag') ?? node.child(0);
  if (startTag) {
    for (let i = 0; i < startTag.childCount; i++) {
      const child = startTag.child(i);
      if (child?.type === 'html_tag_name') {
        return child.text;
      }
    }
  }

  // Direct search
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'html_tag_name') {
      return child.text;
    }
  }

  return null;
}

function findMustacheSectionName(node: Parser.SyntaxNode): string | null {
  // Look for mustache_tag_name in section_begin
  const begin = node.child(0);
  if (begin) {
    for (let i = 0; i < begin.childCount; i++) {
      const child = begin.child(i);
      if (child?.type === 'mustache_tag_name') {
        return child.text;
      }
    }
  }
  return null;
}

function toRange(node: Parser.SyntaxNode): Range {
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
