import type { Node as SyntaxNode } from 'web-tree-sitter';

export type CustomCodeTagIndentMode = 'never' | 'always' | 'attribute';

export interface CustomCodeTagConfig {
  name: string;
  languageAttribute?: string;
  languageMap?: Record<string, string>;
  languageDefault?: string;
  indent?: CustomCodeTagIndentMode;
  indentAttribute?: string;
}

export interface CustomCodeTagContent {
  text: string;
  languageId: string;
  startRow: number;
  startCol: number;
}

/**
 * Parse customCodeTags settings, extracting tag names and full configs.
 */
const VALID_INDENT_MODES = new Set<string>(['never', 'always', 'attribute']);

export function parseCustomCodeTagSettings(tags: unknown[]): { tagNames: string[]; configs: CustomCodeTagConfig[] } {
  const tagNames: string[] = [];
  const configs: CustomCodeTagConfig[] = [];
  for (const tag of tags) {
    if (tag && typeof tag === 'object' && 'name' in tag && typeof (tag as { name: unknown }).name === 'string') {
      const t = tag as Record<string, unknown>;
      const config: CustomCodeTagConfig = { name: t.name as string };
      if (typeof t.languageAttribute === 'string') config.languageAttribute = t.languageAttribute;
      if (t.languageMap && typeof t.languageMap === 'object') config.languageMap = t.languageMap as Record<string, string>;
      if (typeof t.languageDefault === 'string') config.languageDefault = t.languageDefault;
      if (typeof t.indent === 'string' && VALID_INDENT_MODES.has(t.indent)) {
        config.indent = t.indent as CustomCodeTagIndentMode;
      }
      if (typeof t.indentAttribute === 'string') config.indentAttribute = t.indentAttribute;
      tagNames.push(config.name);
      configs.push(config);
    }
  }
  return { tagNames, configs };
}

/**
 * Get the attribute value for a given attribute name from an element's start tag.
 */
export function getAttributeValue(node: SyntaxNode, attrName: string): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'html_start_tag') {
      for (let j = 0; j < child.childCount; j++) {
        const attr = child.child(j);
        if (attr?.type === 'html_attribute') {
          let name = '';
          let value = '';
          for (let k = 0; k < attr.childCount; k++) {
            const part = attr.child(k);
            if (part?.type === 'html_attribute_name') name = part.text.toLowerCase();
            if (part?.type === 'html_quoted_attribute_value') value = part.text.replace(/^["']|["']$/g, '');
            if (part?.type === 'html_attribute_value') value = part.text;
          }
          if (name === attrName.toLowerCase()) {
            return value;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Resolve the language ID for a custom code tag element.
 */
function resolveCustomCodeLanguage(node: SyntaxNode, config: CustomCodeTagConfig): string | null {
  if (config.languageAttribute) {
    const attrValue = getAttributeValue(node, config.languageAttribute);
    if (attrValue) {
      if (config.languageMap && config.languageMap[attrValue]) {
        return config.languageMap[attrValue];
      }
      return attrValue.toLowerCase();
    }
  }
  return config.languageDefault?.toLowerCase() ?? null;
}

/**
 * Walk the tree to find custom code tag elements and extract their content + language.
 */
export function findCustomCodeTagContent(
  rootNode: SyntaxNode,
  configs: CustomCodeTagConfig[],
): CustomCodeTagContent[] {
  if (configs.length === 0) return [];

  const configsByName = new Map<string, CustomCodeTagConfig>();
  for (const config of configs) {
    if (config.languageAttribute || config.languageDefault) {
      configsByName.set(config.name.toLowerCase(), config);
    }
  }
  if (configsByName.size === 0) return [];

  const results: CustomCodeTagContent[] = [];

  const walk = (node: SyntaxNode) => {
    if (node.type === 'html_element' || node.type === 'html_raw_element') {
      let tagName = '';
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'html_start_tag') {
          for (let j = 0; j < child.childCount; j++) {
            const nameNode = child.child(j);
            if (nameNode?.type === 'html_tag_name') {
              tagName = nameNode.text.toLowerCase();
              break;
            }
          }
          break;
        }
      }

      const config = configsByName.get(tagName);
      if (config) {
        const languageId = resolveCustomCodeLanguage(node, config);
        if (languageId) {
          let startTag: SyntaxNode | null = null;
          let endTag: SyntaxNode | null = null;
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child?.type === 'html_start_tag') startTag = child;
            if (child?.type === 'html_end_tag') endTag = child;
            if (child?.type === 'html_raw_text') {
              results.push({
                text: child.text,
                languageId,
                startRow: child.startPosition.row,
                startCol: child.startPosition.column,
              });
            }
          }

          if (startTag && node.type === 'html_element') {
            const contentStartIndex = startTag.endIndex;
            const contentEndIndex = endTag ? endTag.startIndex : node.endIndex;
            const contentText = node.tree.rootNode.text.slice(contentStartIndex, contentEndIndex);
            if (contentText.length > 0) {
              results.push({
                text: contentText,
                languageId,
                startRow: startTag.endPosition.row,
                startCol: startTag.endPosition.column,
              });
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  };

  walk(rootNode);
  return results;
}
