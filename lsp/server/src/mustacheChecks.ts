import type { BalanceNode, BalanceError } from './htmlBalanceChecker';
import { getSectionName } from './htmlBalanceChecker';

export interface TextReplacement {
  startIndex: number;
  endIndex: number;
  newText: string;
}

export interface FixableError extends BalanceError {
  severity?: 'error' | 'warning';
  fix?: TextReplacement[];
  fixDescription?: string;
}

// 1. Nested same-name sections
export function checkNestedSameNameSections(rootNode: BalanceNode): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode, ancestors: Set<string>) {
    if (node.type === 'mustache_section' || node.type === 'mustache_inverted_section') {
      const name = getSectionName(node);
      if (name) {
        if (ancestors.has(name)) {
          const beginNode = node.children.find(
            c => c.type === 'mustache_section_begin' || c.type === 'mustache_inverted_section_begin',
          );
          errors.push({
            node: beginNode ?? node,
            message: `Nested duplicate section: {{#${name}}} is already open in an ancestor`,
          });
        }
        const next = new Set(ancestors);
        next.add(name);
        for (const child of node.children) {
          visit(child, next);
        }
        return;
      }
    }

    for (const child of node.children) {
      visit(child, ancestors);
    }
  }

  visit(rootNode, new Set());
  return errors;
}

// 2. Unquoted mustache attribute value
export function checkUnquotedMustacheAttributes(rootNode: BalanceNode): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode) {
    if (node.type === 'html_attribute') {
      const mustacheNode = node.children.find(c => c.type === 'mustache_interpolation');
      if (mustacheNode) {
        errors.push({
          node: mustacheNode,
          message: `Unquoted mustache attribute value: ${mustacheNode.text}`,
          fix: [{
            startIndex: mustacheNode.startIndex,
            endIndex: mustacheNode.endIndex,
            newText: `"${mustacheNode.text}"`,
          }],
          fixDescription: 'Wrap mustache value in quotes',
        });
      }
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return errors;
}

// 3. Consecutive same-name same-type sections
export function checkConsecutiveSameNameSections(rootNode: BalanceNode, sourceText: string): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode) {
    const children = node.children;
    for (let i = 0; i < children.length - 1; i++) {
      const current = children[i];
      const next = children[i + 1];

      // Both must be the same section type
      if (
        (current.type !== 'mustache_section' && current.type !== 'mustache_inverted_section') ||
        current.type !== next.type
      ) {
        continue;
      }

      const currentName = getSectionName(current);
      const nextName = getSectionName(next);
      if (!currentName || !nextName || currentName !== nextName) continue;

      // Check that the gap between them is whitespace-only
      const gap = sourceText.slice(current.endIndex, next.startIndex);
      if (gap.length > 0 && !/^\s*$/.test(gap)) continue;

      // Find the end tag of current section and begin tag of next section
      const endTagType = current.type === 'mustache_section'
        ? 'mustache_section_end'
        : 'mustache_inverted_section_end';
      const beginTagType = next.type === 'mustache_section'
        ? 'mustache_section_begin'
        : 'mustache_inverted_section_begin';

      const currentEndTag = current.children.find(c => c.type === endTagType);
      const nextBeginTag = next.children.find(c => c.type === beginTagType);

      if (!currentEndTag || !nextBeginTag) continue;

      const sectionTypeStr = current.type === 'mustache_section' ? '#' : '^';
      const nextBeginNode = next.children.find(
        c => c.type === 'mustache_section_begin' || c.type === 'mustache_inverted_section_begin',
      );

      errors.push({
        node: nextBeginNode ?? next,
        message: `Consecutive duplicate section: {{${sectionTypeStr}${nextName}}} can be merged with previous {{${sectionTypeStr}${nextName}}}`,
        severity: 'warning',
        fix: [{
          startIndex: currentEndTag.startIndex,
          endIndex: nextBeginTag.endIndex,
          newText: '',
        }],
        fixDescription: 'Merge consecutive sections',
      });
    }

    // Recurse into children
    for (const child of children) {
      visit(child);
    }
  }

  visit(rootNode);
  return errors;
}
