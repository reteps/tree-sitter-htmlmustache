/**
 * Intermediate Representation (IR) for document formatting.
 *
 * This module defines the Doc type and builder functions for creating
 * formatting commands. The IR is inspired by Prettier's document model.
 */

// Doc types - the IR for formatting
export type Doc =
  | string // literal text
  | Concat
  | Indent
  | Hardline
  | Softline
  | Line
  | Group
  | Fill
  | BreakParent;

export interface Concat {
  type: 'concat';
  parts: Doc[];
}

export interface Indent {
  type: 'indent';
  contents: Doc;
}

export interface Hardline {
  type: 'hardline';
}

export interface Softline {
  type: 'softline';
}

export interface Line {
  type: 'line';
}

export interface Group {
  type: 'group';
  contents: Doc;
  break?: boolean;
}

export interface Fill {
  type: 'fill';
  parts: Doc[];
}

export interface BreakParent {
  type: 'breakParent';
}

// Constants
export const hardline: Hardline = { type: 'hardline' };
export const softline: Softline = { type: 'softline' };
export const line: Line = { type: 'line' };
export const breakParent: BreakParent = { type: 'breakParent' };
export const empty = '';

/**
 * Create a literal text node.
 */
export function text(value: string): string {
  return value;
}

/**
 * Concatenate multiple docs into a single doc.
 */
export function concat(parts: Doc[]): Doc {
  // Flatten nested concats and filter empty strings
  const flattened: Doc[] = [];
  for (const part of parts) {
    if (part === '') continue;
    if (typeof part === 'object' && part.type === 'concat') {
      flattened.push(...part.parts);
    } else {
      flattened.push(part);
    }
  }

  if (flattened.length === 0) return '';
  if (flattened.length === 1) return flattened[0];

  return { type: 'concat', parts: flattened };
}

/**
 * Indent the contents by one level.
 */
export function indent(contents: Doc): Doc {
  if (contents === '') return '';
  return { type: 'indent', contents };
}

/**
 * Create a group that may be printed flat or broken across lines.
 * When `shouldBreak` is true, the group will always break.
 */
export function group(contents: Doc, shouldBreak = false): Doc {
  if (contents === '') return '';
  return { type: 'group', contents, break: shouldBreak || undefined };
}

/**
 * Create a fill for inline content that wraps when needed.
 * Parts alternate between content and separators.
 */
export function fill(parts: Doc[]): Doc {
  const filtered = parts.filter((p) => p !== '');
  if (filtered.length === 0) return '';
  if (filtered.length === 1) return filtered[0];
  return { type: 'fill', parts: filtered };
}

/**
 * Join docs with a separator.
 */
export function join(separator: Doc, docs: Doc[]): Doc {
  const parts: Doc[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (docs[i] === '') continue;
    if (parts.length > 0) {
      parts.push(separator);
    }
    parts.push(docs[i]);
  }
  return concat(parts);
}

// Type guards for working with Doc types
export function isConcat(doc: Doc): doc is Concat {
  return typeof doc === 'object' && doc.type === 'concat';
}

export function isIndent(doc: Doc): doc is Indent {
  return typeof doc === 'object' && doc.type === 'indent';
}

export function isHardline(doc: Doc): doc is Hardline {
  return typeof doc === 'object' && doc.type === 'hardline';
}

export function isSoftline(doc: Doc): doc is Softline {
  return typeof doc === 'object' && doc.type === 'softline';
}

export function isLine(doc: Doc): doc is Line {
  return typeof doc === 'object' && doc.type === 'line';
}

export function isGroup(doc: Doc): doc is Group {
  return typeof doc === 'object' && doc.type === 'group';
}

export function isFill(doc: Doc): doc is Fill {
  return typeof doc === 'object' && doc.type === 'fill';
}

export function isBreakParent(doc: Doc): doc is BreakParent {
  return typeof doc === 'object' && doc.type === 'breakParent';
}
