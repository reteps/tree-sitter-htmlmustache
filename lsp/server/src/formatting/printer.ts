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
      if (doc.break) {
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

        // Check if it fits (no newlines and within width)
        if (!flatContent.includes('\n') && flatContent.length <= printWidth) {
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
      // Fill prints parts inline, wrapping when needed
      // For now, just concat them (can be enhanced for wrapping)
      for (const part of doc.parts) {
        printDoc(part, state, output, options);
      }
      break;

    case 'breakParent':
      // This is a signal to parent groups to break
      // The effect is handled when evaluating groups
      state.mode = 'break';
      break;
  }
}

function makeIndent(level: number, options: PrinterOptions): string {
  return options.indentUnit.repeat(level);
}
