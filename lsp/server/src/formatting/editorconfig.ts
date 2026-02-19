/**
 * EditorConfig integration for formatting options.
 */

import type { FormattingOptions } from './index';
import type { HtmlMustacheConfig } from '../configFile';
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
 * Merge options from multiple sources with priority:
 *   lspOptions (base) < configFile < editorconfig
 */
export function mergeOptions(
  lspOptions: FormattingOptions,
  uri: string,
  configFile?: HtmlMustacheConfig | null,
): FormattingOptions {
  // Start with LSP options as base
  let tabSize = lspOptions.tabSize;
  let insertSpaces = lspOptions.insertSpaces;

  // Config file overrides base
  if (configFile?.indentSize !== undefined) tabSize = configFile.indentSize;

  // Editorconfig overrides config file
  const ec = getEditorConfigOptions(uri);
  if (ec.tabSize !== undefined) tabSize = ec.tabSize;
  if (ec.insertSpaces !== undefined) insertSpaces = ec.insertSpaces;

  return { tabSize, insertSpaces };
}

/**
 * Create the indent unit string based on formatting options.
 */
export function createIndentUnit(options: FormattingOptions): string {
  return options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
}
