import Parser from 'web-tree-sitter';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Hover, Position, MarkupKind } from 'vscode-languageserver/node';

/**
 * Provide hover information for nodes in the document.
 */
export function getHoverInfo(
  tree: Parser.Tree,
  document: TextDocument,
  position: Position
): Hover | null {
  // Convert LSP position to tree-sitter point
  const point: Parser.Point = {
    row: position.line,
    column: position.character,
  };

  // Find the node at the cursor position
  const node = tree.rootNode.descendantForPosition(point);
  if (!node) {
    return null;
  }

  // Generate hover content based on node type
  const content = getHoverContent(node, document);
  if (!content) {
    return null;
  }

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: content,
    },
    range: {
      start: {
        line: node.startPosition.row,
        character: node.startPosition.column,
      },
      end: {
        line: node.endPosition.row,
        character: node.endPosition.column,
      },
    },
  };
}

function getHoverContent(node: Parser.SyntaxNode, _document: TextDocument): string | null {
  const type = node.type;

  // HTML tag names
  if (type === 'html_tag_name') {
    const tagName = node.text.toLowerCase();
    const description = htmlTagDescriptions[tagName];
    if (description) {
      return `**\`<${tagName}>\`** - HTML Element\n\n${description}`;
    }
    return `**\`<${tagName}>\`** - HTML Element`;
  }

  // HTML attributes
  if (type === 'html_attribute_name') {
    const attrName = node.text;
    const description = htmlAttributeDescriptions[attrName];
    if (description) {
      return `**\`${attrName}\`** - HTML Attribute\n\n${description}`;
    }
    return `**\`${attrName}\`** - HTML Attribute`;
  }

  // Mustache identifiers
  if (type === 'mustache_identifier' || type === 'mustache_tag_name') {
    return `**\`${node.text}\`** - Mustache Variable/Helper`;
  }

  // Mustache section begin
  if (type === 'mustache_section_begin') {
    return '**Mustache Section** `{{#...}}`\n\nRenders the block if the value is truthy or iterates over arrays.';
  }

  // Mustache inverted section begin
  if (type === 'mustache_inverted_section_begin') {
    return '**Mustache Inverted Section** `{{^...}}`\n\nRenders the block only if the value is falsy or the array is empty.';
  }

  // Mustache interpolation
  if (type === 'mustache_interpolation') {
    return '**Mustache Interpolation** `{{...}}`\n\nOutputs the HTML-escaped value of the expression.';
  }

  // Mustache triple
  if (type === 'mustache_triple') {
    return '**Mustache Unescaped** `{{{...}}}`\n\nOutputs the raw, unescaped value. Use with caution!';
  }

  // Mustache comment
  if (type === 'mustache_comment') {
    return '**Mustache Comment** `{{!...}}`\n\nComments are not rendered in the output.';
  }

  // Mustache partial
  if (type === 'mustache_partial') {
    return '**Mustache Partial** `{{>...}}`\n\nIncludes another template at this location.';
  }

  return null;
}

// Common HTML tag descriptions
const htmlTagDescriptions: Record<string, string> = {
  'div': 'Generic container for flow content.',
  'span': 'Generic inline container.',
  'p': 'Paragraph element.',
  'a': 'Anchor element for hyperlinks.',
  'img': 'Embeds an image.',
  'ul': 'Unordered list.',
  'ol': 'Ordered list.',
  'li': 'List item.',
  'table': 'Table element.',
  'tr': 'Table row.',
  'td': 'Table data cell.',
  'th': 'Table header cell.',
  'form': 'Form for user input.',
  'input': 'Input control.',
  'button': 'Clickable button.',
  'h1': 'Level 1 heading.',
  'h2': 'Level 2 heading.',
  'h3': 'Level 3 heading.',
  'h4': 'Level 4 heading.',
  'h5': 'Level 5 heading.',
  'h6': 'Level 6 heading.',
  'header': 'Header section.',
  'footer': 'Footer section.',
  'nav': 'Navigation section.',
  'main': 'Main content area.',
  'section': 'Generic section.',
  'article': 'Self-contained content.',
  'aside': 'Sidebar content.',
  'script': 'Embeds or references JavaScript.',
  'style': 'Embeds CSS styles.',
  'link': 'Links to external resources.',
  'meta': 'Document metadata.',
};

// Common HTML attribute descriptions
const htmlAttributeDescriptions: Record<string, string> = {
  'id': 'Unique identifier for the element.',
  'class': 'Space-separated list of CSS classes.',
  'style': 'Inline CSS styles.',
  'href': 'URL for links.',
  'src': 'URL for embedded content.',
  'alt': 'Alternative text for images.',
  'title': 'Advisory title/tooltip.',
  'name': 'Name of the element (forms, anchors).',
  'value': 'Value of form elements.',
  'type': 'Type of input or button.',
  'placeholder': 'Placeholder text for inputs.',
  'disabled': 'Disables the element.',
  'readonly': 'Makes input read-only.',
  'required': 'Makes input required.',
  'data-*': 'Custom data attributes.',
};
