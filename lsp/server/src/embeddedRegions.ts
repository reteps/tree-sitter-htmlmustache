import type { Node as SyntaxNode } from 'web-tree-sitter';

export interface EmbeddedRegion {
  startIndex: number;
  content: string;
  languageId: string;
}

/**
 * Get the language ID for a script or style element.
 * Returns "javascript" for script (or "typescript" if type="text/typescript"),
 * "css" for style.
 */
function getEmbeddedLanguageId(node: SyntaxNode): string {
  if (node.type === 'html_style_element') {
    return 'css';
  }
  // Check for type attribute on script elements
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
            if (part?.type === 'html_quoted_attribute_value') value = part.text.replace(/^["']|["']$/g, '').toLowerCase();
            if (part?.type === 'html_attribute_value') value = part.text.toLowerCase();
          }
          if (name === 'type' && (value === 'text/typescript' || value === 'ts')) {
            return 'typescript';
          }
        }
      }
    }
  }
  return 'javascript';
}

/**
 * Walk the tree to collect embedded script/style regions.
 * Skips html_raw_element (custom raw tags).
 */
export function collectEmbeddedRegions(rootNode: SyntaxNode): EmbeddedRegion[] {
  const regions: EmbeddedRegion[] = [];
  const walk = (node: SyntaxNode) => {
    if (node.type === 'html_script_element' || node.type === 'html_style_element') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'html_raw_text') {
          regions.push({
            startIndex: child.startIndex,
            content: child.text,
            languageId: getEmbeddedLanguageId(node),
          });
        }
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  };
  walk(rootNode);
  return regions;
}
