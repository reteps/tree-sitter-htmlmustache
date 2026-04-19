/**
 * CSS-like selector parser and tree matcher for custom lint rules.
 *
 * Mustache constructs are written literally in selectors — `{{foo}}`,
 * `{{{foo}}}`, `{{#foo}}`, `{{^foo}}`, `{{!foo}}`, `{{>foo}}`. A preprocessor
 * substitutes each form into an internal `:m-*` pseudo-class marker, then the
 * rewritten string is handed to parsel-js. This keeps users in Mustache
 * vocabulary without reinventing a selector parser.
 *
 * Supported user-facing syntax:
 *   - Tag names (`div`), universal (`*`), classes (`.foo`), ids (`#foo`)
 *   - Attributes: `[attr]`, `[attr=v]`, `[attr^=v]`, `[attr*=v]`, `[attr$=v]`, `[attr~=v]`
 *   - Descendant (space) and child (`>`) combinators
 *   - Mustache variables: `{{path}}` and `{{{path}}}` (raw)
 *   - Mustache sections: `{{#name}}` and `{{^name}}` (inverted)
 *   - Mustache comments: `{{!content}}`
 *   - Mustache partials: `{{>name}}`
 *   - Glob wildcard `*` inside the argument: `{{options.*}}`, `{{*.deprecated}}`, `{{*}}`
 *   - `:has(selector)` — element has a matching descendant
 *   - `:not(...)` over any attribute/class/id/:has form
 *   - `:root` — the tree-sitter fragment root (the whole document). Unlike
 *     browser CSS where `:root` matches `<html>`, this matches the parse-tree
 *     root so it works on partials/fragments too. Useful as a document-scoped
 *     anchor, e.g. `:root:has(pl-question-panel):not(:has(pl-answer-panel))`
 *     matches the root iff a `pl-question-panel` is present anywhere but no
 *     `pl-answer-panel` is. Cannot combine with tag/class/id/attribute in the
 *     same compound (only with `:has` / `:not(:has(...))`). Inside `:has(...)`,
 *     `:root` refers to the element being checked, not the document.
 *   - Comma-separated alternatives
 *
 * Unsupported (parseSelector returns null, rule is skipped):
 *   - Sibling combinators (`+`, `~`)
 *   - `[attr|=v]`, case-insensitive `i` flag
 *   - Mixed HTML + Mustache kinds in one compound (e.g. `img{{foo}}`)
 *   - `{{/end}}` (end tags aren't standalone nodes)
 *   - `{{=<% %>=}}` (delimiter changes aren't grammar-tracked)
 *   - Mustache literals inside `:not(...)` (only attribute/class/id/:has)
 */

import { parse as parselParse, type AST, type Token, type AttributeToken, type ClassToken, type IdToken } from 'parsel-js';
import type { BalanceNode } from './htmlBalanceChecker.js';
import {
  getTagName,
  getSectionName,
  getInterpolationPath,
  getCommentContent,
  getPartialName,
  HTML_ELEMENT_TYPES,
} from './nodeHelpers.js';

// --- Types ---

export type AttributeOperator = '=' | '^=' | '*=' | '$=' | '~=';

export type SegmentKind =
  | 'html'
  | 'section'
  | 'inverted'
  | 'variable'
  | 'raw'
  | 'comment'
  | 'partial';

export interface AttributeConstraint {
  name: string;               // lowercased
  op: AttributeOperator;      // meaningful only when value !== undefined
  value?: string;             // quotes stripped; undefined => presence check
  negated: boolean;           // true when inside :not()
}

export interface DescendantCheck {
  selector: ParsedSelector;   // :has(selector) — must match a descendant
  negated: boolean;           // true for :not(:has(...))
}

export interface Segment {
  kind: SegmentKind;
  rootOnly: boolean;          // true for `:root` — matches only the tree-sitter fragment root
  name: string | null;        // lowercased identifier/path, null = wildcard
  pathRegex?: RegExp;         // compiled glob when `name` contains `*`
  attributes: AttributeConstraint[];
  descendantChecks: DescendantCheck[];
  combinator: 'descendant' | 'child';
}

/** A parsed selector is a list of alternatives (from comma-separated parts). */
export type ParsedSelector = Segment[][];

// --- Mustache preprocessor ---

const MUSTACHE_KIND_PSEUDO = new Set([
  'm-section', 'm-inverted', 'm-variable', 'm-raw', 'm-comment', 'm-partial',
]);

/**
 * Rewrite Mustache-literal tokens (`{{...}}` forms) in the selector string into
 * internal `:m-*` pseudo-class markers so parsel-js can handle them. Returns
 * null if the string contains an unsupported or malformed Mustache token.
 *
 * Skips content inside `"..."` and `'...'` so that literal `{{...}}` embedded
 * in CSS attribute-value strings is preserved unchanged.
 */
export function preprocessMustacheLiterals(raw: string): string | null {
  let out = '';
  let i = 0;
  const len = raw.length;

  while (i < len) {
    const ch = raw[i];

    // Pass through quoted strings verbatim.
    if (ch === '"' || ch === "'") {
      out += ch;
      i++;
      while (i < len && raw[i] !== ch) {
        if (raw[i] === '\\' && i + 1 < len) {
          out += raw[i] + raw[i + 1];
          i += 2;
        } else {
          out += raw[i];
          i++;
        }
      }
      if (i < len) {
        out += raw[i]; // closing quote
        i++;
      }
      continue;
    }

    if (ch !== '{' || raw[i + 1] !== '{') {
      out += ch;
      i++;
      continue;
    }

    // Triple-brace: {{{path}}}
    if (raw[i + 2] === '{') {
      const end = raw.indexOf('}}}', i + 3);
      if (end < 0) return null;
      const inner = raw.slice(i + 3, end).trim();
      if (inner.length === 0) return null;
      out += `:m-raw(${inner})`;
      i = end + 3;
      continue;
    }

    // Double-brace: {{...}}
    const end = raw.indexOf('}}', i + 2);
    if (end < 0) return null;
    const body = raw.slice(i + 2, end);
    i = end + 2;

    const sigil = body.trimStart()[0];
    const content = body.replace(/^\s*[#^!>/]\s*/, '').replace(/^\s+|\s+$/g, '');

    switch (sigil) {
      case '#':
        if (content.length === 0) return null;
        out += `:m-section(${content})`;
        break;
      case '^':
        if (content.length === 0) return null;
        out += `:m-inverted(${content})`;
        break;
      case '!':
        if (content.length === 0) return null;
        out += `:m-comment(${content})`;
        break;
      case '>':
        if (content.length === 0) return null;
        out += `:m-partial(${content})`;
        break;
      case '/':
        // Standalone end tags are not a selectable node.
        return null;
      case '=':
        // Delimiter changes are not a grammar-tracked node.
        return null;
      default: {
        const path = body.trim();
        if (path.length === 0) return null;
        out += `:m-variable(${path})`;
        break;
      }
    }
  }

  return out;
}

// --- Selector parsing ---

export function parseSelector(raw: string): ParsedSelector | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  const preprocessed = preprocessMustacheLiterals(raw);
  if (preprocessed === null) return null;

  let ast: AST | undefined;
  try {
    ast = parselParse(preprocessed);
  } catch {
    return null;
  }
  if (!ast) return null;

  const tops = ast.type === 'list' ? ast.list : [ast];
  const alts: Segment[][] = [];
  for (const top of tops) {
    const segments: Segment[] = [];
    if (!collectSegments(top, 'descendant', segments)) return null;
    if (segments.length === 0) return null;
    alts.push(segments);
  }
  return alts.length > 0 ? alts : null;
}

function collectSegments(
  ast: AST,
  combinator: 'descendant' | 'child',
  out: Segment[],
): boolean {
  if (ast.type === 'complex') {
    const mapped = mapCombinator(ast.combinator);
    if (!mapped) return false;
    return collectSegments(ast.left, 'descendant', out)
        && collectSegments(ast.right, mapped, out);
  }
  if (ast.type === 'list' || ast.type === 'relative') return false;

  const segment = segmentFromCompound(ast);
  if (!segment) return false;
  segment.combinator = combinator;
  out.push(segment);
  return true;
}

function mapCombinator(c: string): 'descendant' | 'child' | null {
  const trimmed = c.trim();
  if (trimmed === '') return 'descendant';
  if (trimmed === '>') return 'child';
  return null;
}

function segmentFromCompound(ast: AST): Segment | null {
  const tokens: Token[] = ast.type === 'compound' ? ast.list : [ast as Token];

  let kind: SegmentKind | undefined;
  let name: string | null = null;
  let pathRegex: RegExp | undefined;
  let rootOnly = false;
  const attributes: AttributeConstraint[] = [];
  const descendantChecks: DescendantCheck[] = [];

  // Once a Mustache kind is picked, no other kind tokens may appear.
  const forbidChange = (requested: SegmentKind): boolean => {
    if (kind === undefined) return false;
    if (kind === requested) return false;
    // html and Mustache kinds never mix
    return true;
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'type':
        if (forbidChange('html')) return null;
        kind = 'html';
        name = token.name.toLowerCase();
        break;
      case 'universal':
        if (forbidChange('html')) return null;
        kind = 'html';
        name = null;
        break;
      case 'class':
        if (forbidChange('html')) return null;
        kind = 'html';
        attributes.push(classConstraint(token, false));
        break;
      case 'id':
        if (forbidChange('html')) return null;
        kind = 'html';
        attributes.push(idConstraint(token, false));
        break;
      case 'attribute': {
        // Attribute selectors only apply to HTML segments.
        if (forbidChange('html')) return null;
        if (kind === undefined) kind = 'html';
        const c = attributeConstraint(token, false);
        if (!c) return null;
        attributes.push(c);
        break;
      }
      case 'pseudo-class': {
        if (MUSTACHE_KIND_PSEUDO.has(token.name)) {
          const mustacheKind = mustacheKindFromMarker(token.name);
          if (mustacheKind === null) return null;
          if (forbidChange(mustacheKind)) return null;
          kind = mustacheKind;
          const glob = parseGlob(token.argument ?? '');
          name = glob.name;
          pathRegex = glob.pathRegex;
          break;
        }
        if (token.name === 'has') {
          const sel = subtreeToSelector(token.subtree);
          if (!sel) return null;
          descendantChecks.push({ selector: sel, negated: false });
          break;
        }
        if (token.name === 'not') {
          if (!applyNegatedSubtree(token.subtree, attributes, descendantChecks)) return null;
          break;
        }
        if (token.name === 'root') {
          rootOnly = true;
          if (kind === undefined) kind = 'html';
          break;
        }
        return null;
      }
      default:
        // pseudo-element, comma, combinator, unknown → unsupported
        return null;
    }
  }

  if (kind === undefined) {
    kind = 'html';
  }

  if (rootOnly) {
    // `:root` is only meaningful on its own (optionally with :has / :not(:has)).
    // Reject tag/attribute/class/id combinations — the root isn't an HTML element.
    if (name !== null || attributes.length > 0 || kind !== 'html') return null;
  }

  const isHtml = kind === 'html';
  const finalAttrs = isHtml ? attributes : [];
  return { kind, rootOnly, name, pathRegex, attributes: finalAttrs, descendantChecks, combinator: 'descendant' };
}

function mustacheKindFromMarker(name: string): SegmentKind | null {
  switch (name) {
    case 'm-section':  return 'section';
    case 'm-inverted': return 'inverted';
    case 'm-variable': return 'variable';
    case 'm-raw':      return 'raw';
    case 'm-comment':  return 'comment';
    case 'm-partial':  return 'partial';
    default: return null;
  }
}

/**
 * Parse a Mustache-literal argument into an exact name or a compiled glob.
 * The '*' character is the only wildcard. Bare '*' or empty string returns
 * { name: null } — a wildcard that matches any value.
 */
function parseGlob(arg: string): { name: string | null; pathRegex?: RegExp } {
  const trimmed = arg.trim();
  if (trimmed === '' || trimmed === '*') {
    return { name: null }; // wildcard — matches anything
  }
  if (!trimmed.includes('*')) {
    return { name: trimmed.toLowerCase() };
  }
  // Escape regex metacharacters except `*`, then substitute `*` → `.*`.
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const pathRegex = new RegExp(`^${escaped}$`, 'i');
  return { name: trimmed.toLowerCase(), pathRegex };
}

function attributeConstraint(token: AttributeToken, negated: boolean): AttributeConstraint | null {
  const name = token.name.toLowerCase();
  if (token.operator === undefined) {
    return { name, op: '=', value: undefined, negated };
  }
  let op: AttributeOperator;
  switch (token.operator) {
    case '=':  op = '=';  break;
    case '^=': op = '^='; break;
    case '*=': op = '*='; break;
    case '$=': op = '$='; break;
    case '~=': op = '~='; break;
    default: return null;
  }
  return { name, op, value: stripQuotes(token.value ?? ''), negated };
}

function classConstraint(token: ClassToken, negated: boolean): AttributeConstraint {
  return { name: 'class', op: '~=', value: token.name, negated };
}

function idConstraint(token: IdToken, negated: boolean): AttributeConstraint {
  return { name: 'id', op: '=', value: token.name, negated };
}

function applyNegatedSubtree(
  subtree: AST | undefined,
  attributes: AttributeConstraint[],
  descendantChecks: DescendantCheck[],
): boolean {
  if (!subtree) return false;
  if (subtree.type === 'attribute') {
    const c = attributeConstraint(subtree, true);
    if (!c) return false;
    attributes.push(c);
    return true;
  }
  if (subtree.type === 'class') {
    attributes.push(classConstraint(subtree, true));
    return true;
  }
  if (subtree.type === 'id') {
    attributes.push(idConstraint(subtree, true));
    return true;
  }
  if (subtree.type === 'pseudo-class' && subtree.name === 'has') {
    const sel = subtreeToSelector(subtree.subtree);
    if (!sel) return false;
    descendantChecks.push({ selector: sel, negated: true });
    return true;
  }
  return false;
}

function subtreeToSelector(subtree: AST | undefined): ParsedSelector | null {
  if (!subtree) return null;
  const tops = subtree.type === 'list' ? subtree.list : [subtree];
  const alts: Segment[][] = [];
  for (const top of tops) {
    const segments: Segment[] = [];
    if (!collectSegments(top, 'descendant', segments)) return null;
    if (segments.length === 0) return null;
    alts.push(segments);
  }
  return alts.length > 0 ? alts : null;
}

function stripQuotes(raw: string): string {
  if (raw.length < 2) return raw;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return raw.slice(1, -1);
  }
  return raw;
}

// --- Tree matching ---

interface AncestorEntry {
  kind: AncestorKind;
  name: string; // lowercased
  node: BalanceNode;
}

type AncestorKind = 'html' | 'section' | 'inverted' | 'root';

function ancestorKindForNode(node: BalanceNode): AncestorKind | null {
  if (HTML_ELEMENT_TYPES.has(node.type)) return 'html';
  if (node.type === 'mustache_section') return 'section';
  if (node.type === 'mustache_inverted_section') return 'inverted';
  return null;
}

function getHtmlAttributes(node: BalanceNode): { name: string; value?: string }[] {
  const startTag = node.children.find(
    c => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
  );
  if (!startTag) return [];

  const attrs: { name: string; value?: string }[] = [];
  for (const child of startTag.children) {
    if (child.type !== 'html_attribute') continue;
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
  return attrs;
}

function matchesAttributeValue(has: string | undefined, c: AttributeConstraint): boolean {
  if (has === undefined || c.value === undefined) return false;
  const v = c.value;
  if (v === '') return false;
  switch (c.op) {
    case '=':  return has === v;
    case '^=': return has.startsWith(v);
    case '*=': return has.includes(v);
    case '$=': return has.endsWith(v);
    case '~=': return has.split(/\s+/).includes(v);
  }
}

function checkAttributes(node: BalanceNode, constraints: AttributeConstraint[]): boolean {
  if (constraints.length === 0) return true;
  const nodeAttrs = getHtmlAttributes(node);
  for (const c of constraints) {
    const found = nodeAttrs.find(a => a.name === c.name);
    if (c.negated) {
      if (!found) continue;
      if (c.value === undefined) return false;
      if (matchesAttributeValue(found.value, c)) return false;
      continue;
    }
    if (c.value === undefined) {
      if (!found) return false;
      continue;
    }
    if (!found || !matchesAttributeValue(found.value, c)) return false;
  }
  return true;
}

function checkDescendants(node: BalanceNode, checks: DescendantCheck[]): boolean {
  if (checks.length === 0) return true;
  for (const check of checks) {
    const present = hasDescendantMatch(node, check.selector);
    if (check.negated ? present : !present) return false;
  }
  return true;
}

function hasDescendantMatch(node: BalanceNode, selector: ParsedSelector): boolean {
  for (const child of node.children) {
    if (matchSelector(child, selector).length > 0) return true;
  }
  return false;
}

function matchesName(actual: string | null, segment: Segment): boolean {
  if (segment.name === null) return true; // wildcard
  if (actual === null) return false;
  if (segment.pathRegex) return segment.pathRegex.test(actual);
  return actual === segment.name;
}

function nodeMatchesSegment(node: BalanceNode, segment: Segment, rootNode: BalanceNode): boolean {
  if (segment.rootOnly) {
    if (node !== rootNode) return false;
    return checkDescendants(node, segment.descendantChecks);
  }
  switch (segment.kind) {
    case 'html': {
      if (!HTML_ELEMENT_TYPES.has(node.type)) return false;
      if (segment.name !== null) {
        const tagName = getTagName(node)?.toLowerCase();
        if (tagName !== segment.name) return false;
      }
      return checkAttributes(node, segment.attributes) && checkDescendants(node, segment.descendantChecks);
    }
    case 'section':
      if (node.type !== 'mustache_section') return false;
      if (!matchesName(getSectionName(node)?.toLowerCase() ?? null, segment)) return false;
      return checkDescendants(node, segment.descendantChecks);
    case 'inverted':
      if (node.type !== 'mustache_inverted_section') return false;
      if (!matchesName(getSectionName(node)?.toLowerCase() ?? null, segment)) return false;
      return checkDescendants(node, segment.descendantChecks);
    case 'variable':
      if (node.type !== 'mustache_interpolation') return false;
      if (!matchesName(getInterpolationPath(node)?.toLowerCase() ?? null, segment)) return false;
      return checkDescendants(node, segment.descendantChecks);
    case 'raw':
      if (node.type !== 'mustache_triple') return false;
      if (!matchesName(getInterpolationPath(node)?.toLowerCase() ?? null, segment)) return false;
      return checkDescendants(node, segment.descendantChecks);
    case 'comment':
      if (node.type !== 'mustache_comment') return false;
      if (!matchesName(getCommentContent(node)?.toLowerCase() ?? null, segment)) return false;
      return checkDescendants(node, segment.descendantChecks);
    case 'partial':
      if (node.type !== 'mustache_partial') return false;
      if (!matchesName(getPartialName(node)?.toLowerCase() ?? null, segment)) return false;
      return checkDescendants(node, segment.descendantChecks);
  }
}

/** Does the ancestor stack satisfy remaining segments? */
function checkAncestors(
  ancestors: AncestorEntry[],
  segments: Segment[],
  segIdx: number,
  childCombinator: 'descendant' | 'child',
): boolean {
  if (segIdx < 0) return true;
  const segment = segments[segIdx];
  const ancestorKind = ancestorKindForSegment(segment);
  if (ancestorKind === null) return false; // variable/raw/comment/partial can't be ancestors

  if (childCombinator === 'child') {
    for (let a = ancestors.length - 1; a >= 0; a--) {
      const entry = ancestors[a];
      if (entry.kind !== ancestorKind) {
        // For `:root > X` (ancestorKind='root'), any html ancestor between
        // X and the document root breaks the direct-child relationship.
        // Mustache sections are transparent (existing braided semantics).
        if (ancestorKind === 'root' && entry.kind === 'html') return false;
        continue;
      }
      if (!matchesName(entry.name, segment)) return false;
      if (segment.kind === 'html' && !checkAttributes(entry.node, segment.attributes)) return false;
      if (!checkDescendants(entry.node, segment.descendantChecks)) return false;
      return checkAncestors(ancestors.slice(0, a), segments, segIdx - 1, segment.combinator);
    }
    return false;
  }

  for (let a = ancestors.length - 1; a >= 0; a--) {
    const entry = ancestors[a];
    if (entry.kind !== ancestorKind) continue;
    if (!matchesName(entry.name, segment)) continue;
    if (segment.kind === 'html' && !checkAttributes(entry.node, segment.attributes)) continue;
    if (!checkDescendants(entry.node, segment.descendantChecks)) continue;
    if (checkAncestors(ancestors.slice(0, a), segments, segIdx - 1, segment.combinator)) {
      return true;
    }
  }
  return false;
}

function ancestorKindForSegment(segment: Segment): AncestorKind | null {
  if (segment.rootOnly) return 'root';
  if (segment.kind === 'html') return 'html';
  if (segment.kind === 'section') return 'section';
  if (segment.kind === 'inverted') return 'inverted';
  return null;
}

function getReportNode(node: BalanceNode, rootNode?: BalanceNode): BalanceNode {
  if (HTML_ELEMENT_TYPES.has(node.type)) {
    const startTag = node.children.find(
      c => c.type === 'html_start_tag' || c.type === 'html_self_closing_tag',
    );
    return startTag ?? node;
  }
  if (node.type === 'mustache_section' || node.type === 'mustache_inverted_section') {
    const begin = node.children.find(
      c => c.type === 'mustache_section_begin' || c.type === 'mustache_inverted_section_begin',
    );
    return begin ?? node;
  }
  // When `:root` matches, the node covers the whole document. Narrow the
  // reported range to a 1-char span at the document start so the diagnostic
  // squiggle isn't the entire file.
  if (rootNode && node === rootNode) {
    return {
      type: node.type,
      text: '',
      startPosition: node.startPosition,
      endPosition: { row: node.startPosition.row, column: node.startPosition.column + 1 },
      startIndex: node.startIndex,
      endIndex: Math.min(node.startIndex + 1, node.endIndex),
      children: [],
    };
  }
  return node;
}

function matchAlternative(rootNode: BalanceNode, segments: Segment[]): BalanceNode[] {
  const results: BalanceNode[] = [];
  const lastSegment = segments[segments.length - 1];

  function walk(node: BalanceNode, ancestors: AncestorEntry[]) {
    if (nodeMatchesSegment(node, lastSegment, rootNode)) {
      if (
        segments.length === 1 ||
        checkAncestors(ancestors, segments, segments.length - 2, lastSegment.combinator)
      ) {
        results.push(getReportNode(node, rootNode));
      }
    }

    let newAncestors = ancestors;
    const ancestorKind = ancestorKindForNode(node);
    if (ancestorKind !== null) {
      const name =
        ancestorKind === 'html' ? getTagName(node)?.toLowerCase() :
        getSectionName(node)?.toLowerCase();
      if (name) {
        newAncestors = [...ancestors, { kind: ancestorKind, name, node }];
      }
    }

    for (const child of node.children) walk(child, newAncestors);
  }

  // Seed the ancestor stack with a root entry so `:root X` / `:root > X`
  // can find the document root as an ancestor. The root node itself is
  // never an html/section/inverted node, so it's otherwise never pushed.
  walk(rootNode, [{ kind: 'root', name: '', node: rootNode }]);
  return results;
}

export function matchSelector(rootNode: BalanceNode, selector: ParsedSelector): BalanceNode[] {
  const allResults: BalanceNode[] = [];
  const seen = new Set<BalanceNode>();
  for (const alt of selector) {
    for (const node of matchAlternative(rootNode, alt)) {
      if (!seen.has(node)) {
        seen.add(node);
        allResults.push(node);
      }
    }
  }
  return allResults;
}
