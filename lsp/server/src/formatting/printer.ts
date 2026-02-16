/**
 * Printer module - converts Doc IR to formatted string.
 *
 * The printer traverses the Doc tree and produces a string with proper
 * indentation and line breaks.
 */

import type { Doc } from './ir';

export interface PrinterOptions {
  /** The indentation string (e.g., '  ' for 2 spaces or '\t' for tab) */
  indentUnit: string;
  /** Maximum line width before breaking (used for group fitting) */
  printWidth?: number;
}

interface PrintState {
  indentLevel: number;
  mode: 'flat' | 'break';
}

/**
 * Print a Doc to a string with the given options.
 */
export function print(doc: Doc, options: PrinterOptions): string {
  const output: string[] = [];
  const state: PrintState = { indentLevel: 0, mode: 'break' };

  printDoc(doc, state, output, options);

  return output.join('');
}

/**
 * Walk the output buffer backward to find the current column position
 * (characters since the last newline).
 */
function currentColumn(output: string[]): number {
  let col = 0;
  for (let i = output.length - 1; i >= 0; i--) {
    const chunk = output[i];
    const nlIndex = chunk.lastIndexOf('\n');
    if (nlIndex !== -1) {
      col += chunk.length - nlIndex - 1;
      return col;
    }
    col += chunk.length;
  }
  return col;
}

/**
 * Check if a Doc tree contains a breakParent anywhere.
 */
function containsBreakParent(doc: Doc): boolean {
  if (typeof doc === 'string') return false;
  switch (doc.type) {
    case 'breakParent':
      return true;
    case 'concat':
      return doc.parts.some(containsBreakParent);
    case 'indent':
      return containsBreakParent(doc.contents);
    case 'group':
      return containsBreakParent(doc.contents);
    case 'fill':
      return doc.parts.some(containsBreakParent);
    case 'ifBreak':
      return (
        containsBreakParent(doc.breakContents) ||
        containsBreakParent(doc.flatContents)
      );
    default:
      return false;
  }
}

function printDoc(
  doc: Doc,
  state: PrintState,
  output: string[],
  options: PrinterOptions
): void {
  if (typeof doc === 'string') {
    output.push(doc);
    return;
  }

  switch (doc.type) {
    case 'concat':
      for (const part of doc.parts) {
        printDoc(part, state, output, options);
      }
      break;

    case 'indent':
      state.indentLevel++;
      printDoc(doc.contents, state, output, options);
      state.indentLevel--;
      break;

    case 'hardline':
      output.push('\n');
      output.push(makeIndent(state.indentLevel, options));
      break;

    case 'softline':
      if (state.mode === 'break') {
        output.push('\n');
        output.push(makeIndent(state.indentLevel, options));
      }
      // In flat mode, softline produces nothing
      break;

    case 'line':
      if (state.mode === 'break') {
        output.push('\n');
        output.push(makeIndent(state.indentLevel, options));
      } else {
        // In flat mode, line produces a space
        output.push(' ');
      }
      break;

    case 'group': {
      if (doc.break || containsBreakParent(doc.contents)) {
        // Forced break
        const prevMode = state.mode;
        state.mode = 'break';
        printDoc(doc.contents, state, output, options);
        state.mode = prevMode;
      } else {
        // Try to fit on one line
        const flatOutput: string[] = [];
        const flatState: PrintState = { ...state, mode: 'flat' };
        printDoc(doc.contents, flatState, flatOutput, options);

        const flatContent = flatOutput.join('');
        const printWidth = options.printWidth ?? 80;
        const col = currentColumn(output);

        // Check if it fits (no newlines and within width from current column)
        if (
          !flatContent.includes('\n') &&
          col + flatContent.length <= printWidth
        ) {
          output.push(flatContent);
        } else {
          // Break mode
          const prevMode = state.mode;
          state.mode = 'break';
          printDoc(doc.contents, state, output, options);
          state.mode = prevMode;
        }
      }
      break;
    }

    case 'fill':
      printFill(doc.parts, state, output, options);
      break;

    case 'ifBreak':
      if (state.mode === 'break') {
        printDoc(doc.breakContents, state, output, options);
      } else {
        printDoc(doc.flatContents, state, output, options);
      }
      break;

    case 'breakParent':
      // breakParent is handled by containsBreakParent() in group evaluation.
      // If we reach here outside a group, force break mode.
      state.mode = 'break';
      break;
  }
}

/**
 * Print fill: content and separator pairs, keeping items on the same line
 * when they fit, breaking when they don't.
 * Parts alternate: [content, separator, content, separator, ..., content]
 */
function printFill(
  parts: Doc[],
  state: PrintState,
  output: string[],
  options: PrinterOptions
): void {
  if (parts.length === 0) return;

  const printWidth = options.printWidth ?? 80;

  for (let i = 0; i < parts.length; i++) {
    const content = parts[i];
    const separator = i + 1 < parts.length ? parts[i + 1] : null;

    // Print the content
    printDoc(content, state, output, options);

    if (separator === null) break;

    // Try printing separator + next content flat
    const nextContent = i + 2 < parts.length ? parts[i + 2] : null;
    if (nextContent !== null) {
      const testOutput: string[] = [];
      const flatState: PrintState = { ...state, mode: 'flat' };
      printDoc(separator, flatState, testOutput, options);
      printDoc(nextContent, flatState, testOutput, options);
      const testStr = testOutput.join('');
      const col = currentColumn(output);

      if (!testStr.includes('\n') && col + testStr.length <= printWidth) {
        // Fits: print separator flat
        const sepOutput: string[] = [];
        printDoc(separator, flatState, sepOutput, options);
        output.push(sepOutput.join(''));
      } else {
        // Doesn't fit: print separator in break mode
        printDoc(separator, { ...state, mode: 'break' }, output, options);
      }
    } else {
      // Last separator with no following content, print in current mode
      printDoc(separator, state, output, options);
    }

    // Skip the separator in the loop
    i++;
  }
}

function makeIndent(level: number, options: PrinterOptions): string {
  return options.indentUnit.repeat(level);
}
