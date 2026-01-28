# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a tree-sitter grammar for HTML with Mustache template syntax support. It extends the standard tree-sitter-html grammar to parse Mustache constructs (`{{...}}`, `{{#...}}`, `{{/...}}`, `{{^...}}`, `{{{...}}}`, `{{!...}}`, `{{>...}}`) embedded within HTML.

## Common Commands

```bash
# Generate parser from grammar (required after modifying grammar.js)
tree-sitter generate

# Run the test suite
tree-sitter test

# Run Node.js binding tests
npm test

# Lint grammar.js
npm run lint

# Build WASM and open playground for interactive testing
npm start
```

## Architecture

### Core Files

- **grammar.js**: Main grammar definition combining HTML and Mustache rules. Uses tree-sitter DSL with `externals` for tokens requiring scanner state.

- **src/scanner.c**: External scanner handling context-sensitive tokens. Maintains two stacks:
  - `tags` (HTML tag stack) - tracks open HTML elements for implicit end tags
  - `mustache_tags` (Mustache section stack) - tracks open `{{#...}}`/`{{^...}}` sections

- **src/tag.h**: HTML tag type definitions and containment rules (which tags can nest inside others).

- **src/mustache_tag.h**: Mustache tag tracking with `html_tag_stack_size` to support cross-grammar implicit closures.

### Key Design: Cross-Grammar Implicit End Tags

When a Mustache section ends (`{{/...}}`), it may need to implicitly close HTML tags opened within that section. The scanner tracks `html_tag_stack_size` at mustache section start to know how many HTML tags to pop when the section closes. This enables parsing patterns like:

```html
{{#items}}<li>{{name}}{{/items}}
<!-- The </li> is implicit when {{/items}} is encountered -->
```

### Test Files

Tests live in `test/corpus/*.txt` using tree-sitter's test format:
- Each test has a name, input, and expected S-expression tree
- `htmlmustache.txt` contains Mustache-specific tests
- `errors.txt` and `errors2.txt` test error recovery

### Query Files

- `queries/highlights.scm`: Syntax highlighting queries
- `queries/injections.scm`: Language injection queries (script/style content)
