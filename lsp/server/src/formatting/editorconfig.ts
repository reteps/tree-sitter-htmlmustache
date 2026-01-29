/**
 * EditorConfig integration for formatting options.
 */

import { FormattingOptions } from 'vscode-languageserver/node';
import { parseSync as parseEditorConfig, Props as EditorConfigProps } from 'editorconfig';
import { fileURLToPath } from 'url';

/**
 * Get formatting options from .editorconfig file.
 */
export function getEditorConfigOptions(uri: string): Partial<FormattingOptions> {
  try {
    // Convert file:// URI to file path
    if (!uri.startsWith('file://')) {
      return {};
    }

    const filePath = fileURLToPath(uri);
    const config: EditorConfigProps = parseEditorConfig(filePath);

    const result: Partial<FormattingOptions> = {};

    // Map editorconfig indent_style to insertSpaces
    if (config.indent_style === 'space') {
      result.insertSpaces = true;
    } else if (config.indent_style === 'tab') {
      result.insertSpaces = false;
    }

    // Map editorconfig indent_size to tabSize
    if (typeof config.indent_size === 'number') {
      result.tabSize = config.indent_size;
    } else if (config.indent_size === 'tab' && typeof config.tab_width === 'number') {
      result.tabSize = config.tab_width;
    }

    return result;
  } catch {
    // If editorconfig parsing fails, return empty options
    return {};
  }
}

/**
 * Merge editor config options with LSP options.
 * EditorConfig provides defaults, LSP options override.
 */
export function mergeOptions(
  lspOptions: FormattingOptions,
  uri: string
): FormattingOptions {
  const editorConfigOptions = getEditorConfigOptions(uri);

  return {
    tabSize: editorConfigOptions.tabSize ?? lspOptions.tabSize,
    insertSpaces: editorConfigOptions.insertSpaces ?? lspOptions.insertSpaces,
  };
}

/**
 * Create the indent unit string based on formatting options.
 */
export function createIndentUnit(options: FormattingOptions): string {
  return options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
}
