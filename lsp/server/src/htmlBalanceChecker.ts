// Minimal syntax node interface for balance checking.
// Compatible with web-tree-sitter's SyntaxNode.
export interface BalanceNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: BalanceNode[];
}

export interface BalanceError {
  node: BalanceNode;
  message: string;
}

// --- Internal types ---

interface TagEvent {
  type: 'open' | 'close';
  tagName: string;
  node: BalanceNode;
}

interface ConditionalFork {
  type: 'fork';
  sectionName: string;
  truthy: PathItem[];
  falsy: PathItem[];
}

type PathItem = TagEvent | ConditionalFork;

// --- Phase 1: Extract tag events from parse tree ---

function getTagName(element: BalanceNode): string | null {
  const startTag = element.children.find(c => c.type === 'html_start_tag');
  if (!startTag) return null;
  const tagNameNode = startTag.children.find(c => c.type === 'html_tag_name');
  return tagNameNode?.text?.toLowerCase() ?? null;
}

function getErroneousEndTagName(node: BalanceNode): string | null {
  const nameNode = node.children.find(c => c.type === 'html_erroneous_end_tag_name');
  return nameNode?.text?.toLowerCase() ?? null;
}

export function getSectionName(node: BalanceNode): string | null {
  const beginNode = node.children.find(
    c => c.type === 'mustache_section_begin' || c.type === 'mustache_inverted_section_begin',
  );
  if (!beginNode) return null;
  const tagNameNode = beginNode.children.find(c => c.type === 'mustache_tag_name');
  return tagNameNode?.text ?? null;
}

function hasForcedEndTag(element: BalanceNode): boolean {
  return element.children.some(c => c.type === 'html_forced_end_tag');
}

function extractFromNodes(nodes: BalanceNode[]): PathItem[] {
  const items: PathItem[] = [];
  for (const node of nodes) {
    items.push(...extractFromNode(node));
  }
  return items;
}

function extractFromNode(node: BalanceNode): PathItem[] {
  if (node.type === 'html_element') {
    const contentChildren = node.children.filter(
      c =>
        c.type !== 'html_start_tag' &&
        c.type !== 'html_end_tag' &&
        c.type !== 'html_forced_end_tag',
    );

    if (hasForcedEndTag(node)) {
      const tagName = getTagName(node);
      const items: PathItem[] = [];
      if (tagName) {
        const startTag = node.children.find(c => c.type === 'html_start_tag');
        items.push({ type: 'open', tagName, node: startTag ?? node });
      }
      items.push(...extractFromNodes(contentChildren));
      return items;
    }

    // Balanced or implicit close — recurse into content for inner forks
    return extractFromNodes(contentChildren);
  }

  if (node.type === 'html_self_closing_tag') {
    return [];
  }

  if (node.type === 'html_erroneous_end_tag') {
    const tagName = getErroneousEndTagName(node);
    if (tagName) {
      return [{ type: 'close', tagName, node }];
    }
    return [];
  }

  if (node.type === 'mustache_section') {
    const sectionName = getSectionName(node);
    if (sectionName) {
      const contentChildren = node.children.filter(
        c =>
          c.type !== 'mustache_section_begin' &&
          c.type !== 'mustache_section_end' &&
          c.type !== 'mustache_erroneous_section_end',
      );
      return [
        {
          type: 'fork',
          sectionName,
          truthy: extractFromNodes(contentChildren),
          falsy: [],
        },
      ];
    }
    return [];
  }

  if (node.type === 'mustache_inverted_section') {
    const sectionName = getSectionName(node);
    if (sectionName) {
      const contentChildren = node.children.filter(
        c =>
          c.type !== 'mustache_inverted_section_begin' &&
          c.type !== 'mustache_inverted_section_end' &&
          c.type !== 'mustache_erroneous_inverted_section_end',
      );
      return [
        {
          type: 'fork',
          sectionName,
          truthy: [],
          falsy: extractFromNodes(contentChildren),
        },
      ];
    }
    return [];
  }

  // For any other node type, recurse into children
  return extractFromNodes(node.children);
}

// --- Phase 2: Merge adjacent same-named forks ---

function mergeAdjacentForks(items: PathItem[]): PathItem[] {
  if (items.length === 0) return items;

  const result: PathItem[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    if (item.type !== 'fork') {
      result.push(item);
      i++;
      continue;
    }

    // Merge consecutive forks with the same section name
    const truthy = [...item.truthy];
    const falsy = [...item.falsy];
    let j = i + 1;
    while (j < items.length) {
      const next = items[j];
      if (next.type !== 'fork' || next.sectionName !== item.sectionName) break;
      truthy.push(...next.truthy);
      falsy.push(...next.falsy);
      j++;
    }

    // Recursively merge within branches
    result.push({
      type: 'fork',
      sectionName: item.sectionName,
      truthy: mergeAdjacentForks(truthy),
      falsy: mergeAdjacentForks(falsy),
    });
    i = j;
  }

  return result;
}

// --- Phase 3: Enumerate paths and validate balance ---

/**
 * Check if a list of path items contains any TagEvents (opens/closes),
 * either directly or inside nested forks.
 */
function hasTagEvents(items: PathItem[]): boolean {
  for (const item of items) {
    if (item.type !== 'fork') return true; // It's a TagEvent
    if (hasTagEvents(item.truthy) || hasTagEvents(item.falsy)) return true;
  }
  return false;
}

/**
 * Collect only section names that affect HTML tag balance.
 * A fork only matters if at least one of its branches contains tag events.
 * Forks with balanced HTML (like {{#correct}}<span>...</span>{{/correct}})
 * produce empty branches after extraction and are skipped.
 * This reduces 2^N enumeration to only the relevant variables.
 */
function collectSectionNames(items: PathItem[]): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    if (item.type === 'fork') {
      if (hasTagEvents(item.truthy) || hasTagEvents(item.falsy)) {
        names.add(item.sectionName);
      }
      for (const name of collectSectionNames(item.truthy)) names.add(name);
      for (const name of collectSectionNames(item.falsy)) names.add(name);
    }
  }
  return names;
}

function flattenPath(items: PathItem[], assignment: Map<string, boolean>): TagEvent[] {
  const events: TagEvent[] = [];
  for (const item of items) {
    if (item.type === 'fork') {
      const value = assignment.get(item.sectionName) ?? true;
      const branch = value ? item.truthy : item.falsy;
      events.push(...flattenPath(branch, assignment));
    } else {
      events.push(item);
    }
  }
  return events;
}

function formatCondition(assignment: Map<string, boolean>): string {
  if (assignment.size === 0) return '';
  const parts: string[] = [];
  for (const [name, value] of assignment) {
    parts.push(`${name} is ${value ? 'truthy' : 'falsy'}`);
  }
  return ` (when ${parts.join(', ')})`;
}

function validateBalance(events: TagEvent[], condition: string): BalanceError[] {
  const errors: BalanceError[] = [];
  const stack: TagEvent[] = [];

  for (const event of events) {
    if (event.type === 'open') {
      stack.push(event);
    } else {
      if (stack.length === 0) {
        errors.push({
          node: event.node,
          message: `Mismatched HTML end tag: </${event.tagName}>${condition}`,
        });
      } else {
        const top = stack[stack.length - 1];
        if (top.tagName !== event.tagName) {
          errors.push({
            node: event.node,
            message: `Mismatched HTML end tag: </${event.tagName}>${condition}`,
          });
        } else {
          stack.pop();
        }
      }
    }
  }

  for (const event of stack) {
    errors.push({
      node: event.node,
      message: `Unclosed HTML tag: <${event.tagName}>${condition}`,
    });
  }

  return errors;
}

// --- Unclosed tag detection ---

const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'command',
  'embed', 'frame', 'hr', 'image', 'img', 'input', 'isindex',
  'keygen', 'link', 'menuitem', 'meta', 'nextid', 'param',
  'source', 'track', 'wbr',
]);

const OPTIONAL_END_TAG_ELEMENTS = new Set([
  'li', 'dt', 'dd', 'p', 'colgroup',
  'rb', 'rt', 'rp', 'rtc',
  'optgroup', 'option',
  'tr', 'td', 'th',
  'thead', 'tbody', 'tfoot',
  'caption',
  'html', 'head', 'body',
]);

export function checkUnclosedTags(rootNode: BalanceNode): BalanceError[] {
  const errors: BalanceError[] = [];

  function visit(node: BalanceNode) {
    if (node.type === 'html_element') {
      const hasEndTag = node.children.some(c => c.type === 'html_end_tag');
      const hasForcedEnd = node.children.some(c => c.type === 'html_forced_end_tag');

      if (!hasEndTag && !hasForcedEnd) {
        const tagName = getTagName(node);
        if (tagName && !VOID_ELEMENTS.has(tagName) && !OPTIONAL_END_TAG_ELEMENTS.has(tagName)) {
          const startTag = node.children.find(c => c.type === 'html_start_tag');
          errors.push({
            node: startTag ?? node,
            message: `Unclosed HTML tag: <${tagName}>`,
          });
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

const MAX_SECTION_NAMES = 15;

export function checkHtmlBalance(rootNode: BalanceNode): BalanceError[] {
  // Phase 1: Extract tag events
  const rawItems = extractFromNode(rootNode);

  // Phase 2: Merge adjacent same-named forks
  const items = mergeAdjacentForks(rawItems);

  // Phase 3: Enumerate all boolean paths and validate
  const sectionNames = [...collectSectionNames(items)];
  if (sectionNames.length > MAX_SECTION_NAMES) {
    return []; // Safety valve: too many combinations
  }

  const allErrors: BalanceError[] = [];
  const errorNodes = new Set<BalanceNode>();
  const totalPaths = 1 << sectionNames.length;

  for (let mask = 0; mask < totalPaths; mask++) {
    const assignment = new Map<string, boolean>();
    for (let i = 0; i < sectionNames.length; i++) {
      assignment.set(sectionNames[i], (mask & (1 << i)) !== 0);
    }

    const events = flattenPath(items, assignment);
    const condition = formatCondition(assignment);
    const pathErrors = validateBalance(events, condition);

    for (const error of pathErrors) {
      if (!errorNodes.has(error.node)) {
        errorNodes.add(error.node);
        allErrors.push(error);
      }
    }
  }

  return allErrors;
}
