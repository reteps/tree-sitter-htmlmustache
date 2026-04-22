import type { BalanceNode, BalanceError } from './htmlBalanceChecker.js';
import { getSectionName } from './htmlBalanceChecker.js';
import { isMustacheSection } from './nodeHelpers.js';

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

// 4. Self-closing non-void tags
const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'command',
  'embed', 'frame', 'hr', 'image', 'img', 'input', 'isindex',
  'keygen', 'link', 'menuitem', 'meta', 'nextid', 'param',
  'source', 'track', 'wbr',
]);

export function checkSelfClosingNonVoidTags(rootNode: BalanceNode): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode) {
    if (node.type === 'html_self_closing_tag') {
      const tagNameNode = node.children.find(c => c.type === 'html_tag_name');
      const tagName = tagNameNode?.text.toLowerCase();
      if (tagName && !VOID_ELEMENTS.has(tagName)) {
        errors.push({
          node,
          message: `Self-closing non-void element: <${tagNameNode!.text}/>`,
          fix: [{
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            newText: node.text.replace(/\s*\/>$/, '>') + `</${tagNameNode!.text}>`,
          }],
          fixDescription: 'Replace self-closing syntax with explicit close tag',
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

// 5. Duplicate attributes (including across mustache conditionals)
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

// 6. Unescaped HTML entities in text content
export function checkUnescapedEntities(rootNode: BalanceNode): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode) {
    if (node.type === 'text') {
      // Bare & (from _text_ampersand rule — node text is exactly "&")
      if (node.text === '&') {
        errors.push({
          node,
          message: 'Unescaped "&" in text content — use &amp; instead',
          severity: 'warning',
          fix: [{
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            newText: '&amp;',
          }],
          fixDescription: 'Replace & with &amp;',
        });
        return;
      }

      // > characters in text (from the text rule which allows >)
      if (node.text.includes('>')) {
        const fixes: TextReplacement[] = [];
        let searchFrom = 0;
        const text = node.text;
        while (true) {
          const idx = text.indexOf('>', searchFrom);
          if (idx === -1) break;
          fixes.push({
            startIndex: node.startIndex + idx,
            endIndex: node.startIndex + idx + 1,
            newText: '&gt;',
          });
          searchFrom = idx + 1;
        }
        errors.push({
          node,
          message: 'Unescaped ">" in text content — use &gt; instead',
          severity: 'warning',
          fix: fixes,
          fixDescription: 'Replace > with &gt;',
        });
        return;
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return errors;
}

// 7. Prefer mustache comments over HTML comments
export function checkHtmlComments(rootNode: BalanceNode): FixableError[] {
  const errors: FixableError[] = [];

  function visit(node: BalanceNode) {
    if (node.type === 'html_comment') {
      // Extract text between <!-- and -->
      const raw = node.text;
      let content = raw;
      if (content.startsWith('<!--')) content = content.slice(4);
      if (content.endsWith('-->')) content = content.slice(0, -3);
      content = content.trim();

      errors.push({
        node,
        message: `HTML comment found — use mustache comment {{! ... }} instead`,
        severity: 'warning',
        fix: [{
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          newText: `{{! ${content} }}`,
        }],
        fixDescription: 'Replace HTML comment with mustache comment',
      });
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return errors;
}

// 8. Unrecognized HTML tags
const KNOWN_HTML_TAGS = new Set([
  // Void elements
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'command',
  'embed', 'frame', 'hr', 'image', 'img', 'input', 'isindex',
  'keygen', 'link', 'menuitem', 'meta', 'nextid', 'param',
  'source', 'track', 'wbr',
  // Non-void elements
  'a', 'abbr', 'address', 'article', 'aside', 'audio',
  'b', 'bdi', 'bdo', 'blockquote', 'body', 'button',
  'canvas', 'caption', 'cite', 'code', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
  'em',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'html',
  'i', 'iframe', 'ins',
  'kbd',
  'label', 'legend', 'li',
  'main', 'map', 'mark', 'math', 'menu', 'meter',
  'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'picture', 'pre', 'progress',
  'q',
  'rb', 'rp', 'rt', 'rtc', 'ruby',
  's', 'samp', 'script', 'search', 'section', 'select', 'slot', 'small', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'u', 'ul',
  'var', 'video',
]);

export function checkUnrecognizedHtmlTags(rootNode: BalanceNode, customTagNames?: string[]): FixableError[] {
  const errors: FixableError[] = [];
  const customSet = customTagNames ? new Set(customTagNames.map(n => n.toLowerCase())) : undefined;

  function visit(node: BalanceNode) {
    if (node.type === 'html_element' || node.type === 'html_self_closing_tag') {
      // Check tag name for svg/math to skip their subtrees
      const tagNameNode = node.type === 'html_self_closing_tag'
        ? node.children.find(c => c.type === 'html_tag_name')
        : node.children.find(c => c.type === 'html_start_tag')?.children.find(c => c.type === 'html_tag_name');
      const tagName = tagNameNode?.text.toLowerCase();
      if (tagName === 'svg' || tagName === 'math') return;
    }

    if (node.type === 'html_start_tag' || node.type === 'html_self_closing_tag') {
      const tagNameNode = node.children.find(c => c.type === 'html_tag_name');
      if (tagNameNode) {
        const tagName = tagNameNode.text.toLowerCase();
        if (
          !KNOWN_HTML_TAGS.has(tagName) &&
          !customSet?.has(tagName)
        ) {
          errors.push({
            node: tagNameNode,
            message: `Unrecognized HTML tag: <${tagNameNode.text}>`,
          });
        }
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

export function checkElementContentTooLong(
  rootNode: BalanceNode,
  elements: ReadonlyArray<{ tag: string; maxBytes: number }>,
): FixableError[] {
  const errors: FixableError[] = [];
  if (elements.length === 0) return errors;

  const thresholds = new Map<string, number>();
  for (const { tag, maxBytes } of elements) {
    const key = tag.toLowerCase();
    const existing = thresholds.get(key);
    if (existing === undefined || maxBytes < existing) thresholds.set(key, maxBytes);
  }

  function visit(node: BalanceNode) {
    if (node.type === 'html_element') {
      const startTag = node.children.find(c => c.type === 'html_start_tag');
      const endTag = node.children.find(c => c.type === 'html_end_tag');
      const tagNameNode = startTag?.children.find(c => c.type === 'html_tag_name');
      const tagName = tagNameNode?.text.toLowerCase();
      if (tagName && startTag && endTag) {
        const maxBytes = thresholds.get(tagName);
        if (maxBytes !== undefined) {
          const innerBytes = endTag.startIndex - startTag.endIndex;
          if (innerBytes > maxBytes) {
            errors.push({
              node: startTag,
              message: `<${tagName}> content is ${innerBytes} bytes, exceeds limit of ${maxBytes}`,
            });
          }
        }
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(rootNode);
  return errors;
}
