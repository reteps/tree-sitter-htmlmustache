/**
 * CSS-like selector parser and tree matcher for custom lint rules.
 *
 * Supports: tag, *, #name, #, ancestor descendant, parent > child,
 * [attr], [attr=value], :not([attr]), and combinations thereof.
 */

import type { BalanceNode } from './htmlBalanceChecker';
import { getTagName, getSectionName, MUSTACHE_SECTION_TYPES, HTML_ELEMENT_TYPES } from './nodeHelpers';

// --- Types ---

export interface AttributeConstraint {
  name: string;       // lowercased
  value?: string;     // exact match value
  negated: boolean;   // true when inside :not()
}

export interface SelectorSegment {
  kind: 'html' | 'mustache';
  name: string | null;  // lowercased tag/section name, null = wildcard
  attributes: AttributeConstraint[];
  combinator: 'descendant' | 'child'; // relation to the PREVIOUS segment
}

export interface SelectorAlternative {
  segments: SelectorSegment[];
}

export interface ParsedSelector {
  alternatives: SelectorAlternative[];
}

// --- Selector Parsing ---

function isNameChar(ch: string): boolean {
  return /[a-zA-Z0-9\-_]/.test(ch);
}

function parseAttributes(raw: string, pos: { i: number }): AttributeConstraint[] {
  const attrs: AttributeConstraint[] = [];
  while (pos.i < raw.length) {
    // Check for :not([...])
    if (raw[pos.i] === ':') {
      if (raw.slice(pos.i, pos.i + 6).toLowerCase() !== ':not([') return attrs;
      pos.i += 6; // skip :not([
      const attr = parseOneAttribute(raw, pos, true);
      if (!attr) return attrs;
      // expect ])
      if (raw[pos.i] !== ']' || raw[pos.i + 1] !== ')') return attrs;
      pos.i += 2;
      attrs.push(attr);
    } else if (raw[pos.i] === '[') {
      pos.i++; // skip [
      const attr = parseOneAttribute(raw, pos, false);
      if (!attr) return attrs;
      // expect ]
      if (raw[pos.i] !== ']') return attrs;
      pos.i++;
      attrs.push(attr);
    } else {
      break;
    }
  }
  return attrs;
}

function parseOneAttribute(raw: string, pos: { i: number }, negated: boolean): AttributeConstraint | null {
  let name = '';
  while (pos.i < raw.length && isNameChar(raw[pos.i])) {
    name += raw[pos.i];
    pos.i++;
  }
  if (name.length === 0) return null;

  let value: string | undefined;
  if (raw[pos.i] === '=') {
    pos.i++; // skip =
    value = '';
    // Value can be quoted or unquoted
    if (raw[pos.i] === '"' || raw[pos.i] === "'") {
      const quote = raw[pos.i];
      pos.i++;
      while (pos.i < raw.length && raw[pos.i] !== quote) {
        value += raw[pos.i];
        pos.i++;
      }
      if (pos.i < raw.length) pos.i++; // skip closing quote
    } else {
      while (pos.i < raw.length && raw[pos.i] !== ']') {
        value += raw[pos.i];
        pos.i++;
      }
    }
  }

  return { name: name.toLowerCase(), value, negated };
}

export function parseSelector(raw: string): ParsedSelector | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Split on commas for selector lists (e.g. "div, span")
  const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length === 0) return null;

  const alternatives: SelectorAlternative[] = [];
  for (const part of parts) {
    const alt = parseSingleSelector(part);
    if (!alt) return null;
    alternatives.push(alt);
  }

  return { alternatives };
}

function parseSingleSelector(raw: string): SelectorAlternative | null {
  const segments: SelectorSegment[] = [];
  let i = 0;
  let nextCombinator: 'descendant' | 'child' = 'descendant';

  while (i < raw.length) {
    // Skip whitespace
    while (i < raw.length && raw[i] === ' ') i++;
    if (i >= raw.length) break;

    // Check for > combinator
    if (raw[i] === '>') {
      if (segments.length === 0) return null; // leading >
      nextCombinator = 'child';
      i++;
      // skip whitespace after >
      while (i < raw.length && raw[i] === ' ') i++;
      if (i >= raw.length) return null; // trailing >
      continue;
    }

    const pos = { i };
    const segment = parseOneSegment(raw, pos);
    if (!segment) return null;
    i = pos.i;

    segment.combinator = nextCombinator;
    nextCombinator = 'descendant';
    segments.push(segment);
  }

  if (segments.length === 0) return null;
  return { segments };
}

function parseOneSegment(raw: string, pos: { i: number }): SelectorSegment | null {
  let kind: 'html' | 'mustache';
  let name: string | null;

  if (raw[pos.i] === '#') {
    // Mustache section
    kind = 'mustache';
    pos.i++; // skip #
    name = '';
    while (pos.i < raw.length && isNameChar(raw[pos.i])) {
      name += raw[pos.i];
      pos.i++;
    }
    if (name.length === 0) name = null; // bare # = wildcard
    else name = name.toLowerCase();
    return { kind, name, attributes: [], combinator: 'descendant' };
  }

  if (raw[pos.i] === '*') {
    // Wildcard HTML element
    kind = 'html';
    name = null;
    pos.i++;
    const attrs = parseAttributes(raw, pos);
    return { kind, name, attributes: attrs, combinator: 'descendant' };
  }

  if (raw[pos.i] === '[' || raw[pos.i] === ':') {
    // Attribute-only selector (no tag name) — matches any HTML element
    kind = 'html';
    name = null;
    const attrs = parseAttributes(raw, pos);
    if (attrs.length === 0) return null;
    return { kind, name, attributes: attrs, combinator: 'descendant' };
  }

  // HTML tag name
  if (!isNameChar(raw[pos.i])) return null;
  kind = 'html';
  name = '';
  while (pos.i < raw.length && isNameChar(raw[pos.i])) {
    name += raw[pos.i];
    pos.i++;
  }
  name = name.toLowerCase();

  // Parse trailing attributes
  const attrs = parseAttributes(raw, pos);

  return { kind, name, attributes: attrs, combinator: 'descendant' };
}

// --- Tree Matching ---

interface AncestorEntry {
  kind: 'html' | 'mustache';
  name: string; // lowercased
  node: BalanceNode;
}

function getNodeAttributes(node: BalanceNode): { name: string; value?: string }[] {
  // node is the element; find the start tag
  const startTag = node.children.find(
    c => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
  );
  if (!startTag) return [];

  const attrs: { name: string; value?: string }[] = [];
  for (const child of startTag.children) {
    if (child.type === 'html_attribute') {
      let attrName = '';
      let attrValue: string | undefined;
      for (const part of child.children) {
        if (part.type === 'html_attribute_name') {
          attrName = part.text.toLowerCase();
        } else if (part.type === 'html_quoted_attribute_value') {
          attrValue = part.text.replace(/^["']|["']$/g, '');
        } else if (part.type === 'html_attribute_value') {
          attrValue = part.text;
        }
      }
      if (attrName) attrs.push({ name: attrName, value: attrValue });
    }
  }
  return attrs;
}

function checkAttributes(node: BalanceNode, constraints: AttributeConstraint[]): boolean {
  if (constraints.length === 0) return true;
  const nodeAttrs = getNodeAttributes(node);
  for (const constraint of constraints) {
    const found = nodeAttrs.find(a => a.name === constraint.name);
    if (constraint.negated) {
      // :not([attr]) — attribute must NOT exist
      if (found) return false;
    } else if (constraint.value !== undefined) {
      // [attr=value] — attribute must exist with exact value
      if (!found || found.value !== constraint.value) return false;
    } else {
      // [attr] — attribute must exist
      if (!found) return false;
    }
  }
  return true;
}

function nodeMatchesSegment(node: BalanceNode, segment: SelectorSegment): boolean {
  if (segment.kind === 'html') {
    if (!HTML_ELEMENT_TYPES.has(node.type)) return false;
    if (segment.name !== null) {
      const tagName = getTagName(node)?.toLowerCase();
      if (tagName !== segment.name) return false;
    }
    return checkAttributes(node, segment.attributes);
  }
  // mustache
  if (!MUSTACHE_SECTION_TYPES.has(node.type)) return false;
  if (segment.name !== null) {
    const sectionName = getSectionName(node)?.toLowerCase();
    if (sectionName !== segment.name) return false;
  }
  return true;
}

/**
 * Check if the ancestor stack satisfies the remaining selector segments.
 * `childCombinator` is the combinator between segment[segIdx] and the
 * already-matched segment to its right (i.e. the combinator of segment[segIdx+1]).
 */
function checkAncestors(
  ancestors: AncestorEntry[],
  segments: SelectorSegment[],
  segIdx: number,
  childCombinator: 'descendant' | 'child',
): boolean {
  if (segIdx < 0) return true; // all segments matched

  const segment = segments[segIdx];

  if (childCombinator === 'child') {
    // Walk ancestors, skip nodes of the "other kind", the first node of the matching kind must match
    for (let a = ancestors.length - 1; a >= 0; a--) {
      const entry = ancestors[a];
      if (entry.kind !== segment.kind) continue; // skip other-kind nodes
      // First node of matching kind must match
      if (segment.name !== null && entry.name !== segment.name) return false;
      // For HTML nodes, also check attributes
      if (segment.kind === 'html' && segment.attributes.length > 0) {
        if (!checkAttributes(entry.node, segment.attributes)) return false;
      }
      return checkAncestors(ancestors.slice(0, a), segments, segIdx - 1, segment.combinator);
    }
    return false; // no ancestor of matching kind found
  }

  // Descendant combinator: any ancestor of matching kind can satisfy
  for (let a = ancestors.length - 1; a >= 0; a--) {
    const entry = ancestors[a];
    if (entry.kind !== segment.kind) continue;
    if (segment.name !== null && entry.name !== segment.name) continue;
    if (segment.kind === 'html' && segment.attributes.length > 0) {
      if (!checkAttributes(entry.node, segment.attributes)) continue;
    }
    if (checkAncestors(ancestors.slice(0, a), segments, segIdx - 1, segment.combinator)) {
      return true;
    }
  }
  return false;
}

function getReportNode(node: BalanceNode): BalanceNode {
  if (HTML_ELEMENT_TYPES.has(node.type)) {
    const startTag = node.children.find(
      c => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
    );
    return startTag ?? node;
  }
  if (MUSTACHE_SECTION_TYPES.has(node.type)) {
    const begin = node.children.find(
      c => c.type === 'mustache_section_begin' || c.type === 'mustache_inverted_section_begin',
    );
    return begin ?? node;
  }
  return node;
}

function matchAlternative(rootNode: BalanceNode, alt: SelectorAlternative): BalanceNode[] {
  const results: BalanceNode[] = [];
  const lastSegment = alt.segments[alt.segments.length - 1];

  function walk(node: BalanceNode, ancestors: AncestorEntry[]) {
    // Check if this node matches the last segment
    if (nodeMatchesSegment(node, lastSegment)) {
      // Verify remaining segments against ancestors
      if (alt.segments.length === 1 || checkAncestors(ancestors, alt.segments, alt.segments.length - 2, lastSegment.combinator)) {
        results.push(getReportNode(node));
      }
    }

    // Build ancestor entry for this node if it's an HTML element or mustache section
    let newAncestors = ancestors;
    if (HTML_ELEMENT_TYPES.has(node.type)) {
      const tagName = getTagName(node)?.toLowerCase();
      if (tagName) {
        newAncestors = [...ancestors, { kind: 'html', name: tagName, node }];
      }
    } else if (MUSTACHE_SECTION_TYPES.has(node.type)) {
      const sectionName = getSectionName(node)?.toLowerCase();
      if (sectionName) {
        newAncestors = [...ancestors, { kind: 'mustache', name: sectionName, node }];
      }
    }

    // Recurse into children
    for (const child of node.children) {
      walk(child, newAncestors);
    }
  }

  walk(rootNode, []);
  return results;
}

export function matchSelector(rootNode: BalanceNode, selector: ParsedSelector): BalanceNode[] {
  const allResults: BalanceNode[] = [];
  const seen = new Set<BalanceNode>();
  for (const alt of selector.alternatives) {
    for (const node of matchAlternative(rootNode, alt)) {
      if (!seen.has(node)) {
        seen.add(node);
        allResults.push(node);
      }
    }
  }
  return allResults;
}
