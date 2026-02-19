# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a tree-sitter grammar for HTML with Mustache template syntax support. It extends the standard tree-sitter-html grammar to parse Mustache constructs (`{{...}}`, `{{#...}}`, `{{/...}}`, `{{^...}}`, `{{{...}}}`, `{{!...}}`, `{{>...}}`) embedded within HTML. The project also includes a VS Code extension with an LSP server and a CLI linter.

## Common Commands

```bash
# Generate parser from grammar (required after modifying grammar.js)
tree-sitter generate

# Run the parser test suite (166 tests in test/corpus/*.txt)
tree-sitter test

# Run a single test by name filter
tree-sitter test -f "test name pattern"

# Run Node.js binding tests
npm test

# Lint grammar.js
npm run lint

# Check formatting
npm run format:check

# Build CLI (compiles cli/src/check.ts -> cli/out/check.js)
npm run build:cli

# Run CLI tests (vitest)
npm run test:cli

# Build WASM and open playground for interactive testing
npm start
```

### LSP Development (in `lsp/` directory)

```bash
cd lsp
pnpm install

# Build the extension (esbuild + WASM copy)
pnpm run build

# Run LSP server tests (vitest)
pnpm run test

# Watch mode for LSP tests
pnpm run test:watch

# Typecheck client and server
pnpm run typecheck

# Lint LSP code
pnpm run lint
```

## Architecture

### Three Components

1. **Tree-sitter grammar** (root): Parser definition in `grammar.js` + external scanner in `src/scanner.c`. Published as `@reteps/tree-sitter-htmlmustache` on npm.
2. **LSP server + VS Code extension** (`lsp/`): Separate pnpm workspace. TypeScript-based language server providing formatting, diagnostics, semantic tokens, hover, folding, and document symbols.
3. **CLI linter** (`cli/`): `htmlmustache check` command for template validation. Built with TypeScript, tested with vitest.

### Grammar Core Files

- **grammar.js**: Main grammar definition combining HTML and Mustache rules. Uses tree-sitter DSL with `externals` for tokens requiring scanner state.

- **src/scanner.c**: External scanner handling context-sensitive tokens. Maintains two stacks:
  - `tags` (HTML tag stack) - tracks open HTML elements for implicit end tags
  - `mustache_tags` (Mustache section stack) - tracks open `{{#...}}`/`{{^...}}` sections

- **src/tag.h**: HTML tag type definitions and containment rules (which tags can nest inside others).

- **src/mustache_tag.h**: Mustache tag tracking with `html_tag_stack_size` to support cross-grammar implicit closures.

- **src/custom_raw_tags.h**: Compile-time definition of custom tags whose content is treated as raw text (not parsed as HTML/Mustache).

### Key Design: Cross-Grammar Implicit End Tags

When a Mustache section ends (`{{/...}}`), it may need to implicitly close HTML tags opened within that section. The scanner tracks `html_tag_stack_size` at mustache section start to know how many HTML tags to pop when the section closes. This enables parsing patterns like:

```html
{{#items}}
<li>
  {{name}}{{/items}}
  <!-- The </li> is implicit when {{/items}} is encountered -->
</li>
```

### LSP Architecture

The LSP server (`lsp/server/src/`) uses web-tree-sitter (WASM) to parse documents. Key modules:

- **formatting/**: Prettier-inspired formatter with an IR (intermediate representation). Pipeline: tree -> classifier -> IR doc -> printer -> text. The `ir.ts` defines the Doc type, `classifier.ts` maps syntax nodes to formatting behavior, `formatters.ts` builds IR docs, and `printer.ts` renders to text.
- **embeddedTokenizer.ts**: Uses TextMate grammars (via vscode-textmate + vscode-oniguruma) for syntax highlighting inside `<script>`, `<style>`, and custom code tags.
- **diagnostics.ts**: Reports parse errors, mismatched tags.
- **semanticTokens.ts**: Full semantic token provider using tree-sitter highlight queries.

### Test Files

- `test/corpus/*.txt`: Tree-sitter parser tests (name, input, expected S-expression).
- `cli/src/check.test.ts`: CLI linter tests (vitest).
- `lsp/server/test/*.test.ts`: LSP feature tests (vitest) — formatting, diagnostics, hover, folding, semantic tokens, etc.

### Query Files

- `queries/highlights.scm`: Syntax highlighting queries
- `queries/injections.scm`: Language injection queries (script/style content)

## Development Workflow

After modifying `grammar.js` or `src/scanner.c`, always run `tree-sitter generate` before `tree-sitter test`. The generate step produces `src/parser.c` and related files from the grammar definition.

The LSP depends on `tree-sitter-htmlmustache.wasm` (built via `tree-sitter build --wasm`). If you change the grammar, rebuild the WASM before testing LSP features.

Package manager: `pnpm` for the root package and the `lsp/` workspace. Node version 22.
