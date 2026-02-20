import type { BalanceNode, BalanceError } from './htmlBalanceChecker';
import { getSectionName } from './htmlBalanceChecker';
import { isMustacheSection } from './nodeHelpers';

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
    if (isMustacheSection(node)) {
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
      if (!isMustacheSection(current) || current.type !== next.type) {
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

// 4. Duplicate attributes (including across mustache conditionals)
interface Condition {
  name: string;
  inverted: boolean;
}

interface AttributeOccurrence {
  nameNode: BalanceNode;
  conditions: Condition[];
}

function areMutuallyExclusive(a: Condition[], b: Condition[]): boolean {
  // Two condition chains are mutually exclusive if some variable X
  // appears as truthy in one and falsy in the other
  for (const ac of a) {
    for (const bc of b) {
      if (ac.name === bc.name && ac.inverted !== bc.inverted) {
        return true;
      }
    }
  }
  return false;
}

function formatConditionClause(a: Condition[], b: Condition[]): string {
  // Combine conditions from both occurrences, deduplicating
  const seen = new Map<string, boolean>(); // name -> inverted
  for (const c of [...a, ...b]) {
    if (!seen.has(c.name)) {
      seen.set(c.name, c.inverted);
    }
  }
  if (seen.size === 0) return '';
  const parts: string[] = [];
  for (const [name, inverted] of seen) {
    parts.push(`${name} is ${inverted ? 'falsy' : 'truthy'}`);
  }
  return ` (when ${parts.join(', ')})`;
}

function collectAttributes(node: BalanceNode, conditions: Condition[], out: AttributeOccurrence[]) {
  for (const child of node.children) {
    if (child.type === 'html_attribute') {
      const nameNode = child.children.find(c => c.type === 'html_attribute_name');
      if (nameNode) {
        out.push({ nameNode, conditions: [...conditions] });
      }
    } else if (child.type === 'mustache_attribute') {
      // Descend into the mustache section/inverted section inside
      const section = child.children.find(c => isMustacheSection(c));
      if (section) {
        const name = getSectionName(section);
        if (name) {
          const inverted = section.type === 'mustache_inverted_section';
          collectAttributes(section, [...conditions, { name, inverted }], out);
        }
      }
    }
    // Skip mustache_interpolation / mustache_triple — dynamic, names unknown
  }
}

export function checkDuplicateAttributes(rootNode: BalanceNode): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode) {
    if (node.type === 'html_start_tag' || node.type === 'html_self_closing_tag') {
      const occurrences: AttributeOccurrence[] = [];
      collectAttributes(node, [], occurrences);

      // Group by attribute name (case-insensitive)
      const groups = new Map<string, AttributeOccurrence[]>();
      for (const occ of occurrences) {
        const key = occ.nameNode.text.toLowerCase();
        let group = groups.get(key);
        if (!group) {
          group = [];
          groups.set(key, group);
        }
        group.push(occ);
      }

      for (const [, group] of groups) {
        if (group.length < 2) continue;
        // Check each pair — report the later one if any non-exclusive pair exists
        for (let i = 1; i < group.length; i++) {
          let conflictIdx = -1;
          for (let j = 0; j < i; j++) {
            if (!areMutuallyExclusive(group[i].conditions, group[j].conditions)) {
              conflictIdx = j;
              break;
            }
          }
          if (conflictIdx >= 0) {
            const clause = formatConditionClause(group[conflictIdx].conditions, group[i].conditions);
            errors.push({
              node: group[i].nameNode,
              message: `Duplicate attribute "${group[i].nameNode.text}"${clause}`,
            });
          }
        }
      }
      return; // Don't recurse into tag children (already processed)
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return errors;
}
