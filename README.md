<p align="center">
  <img src="lsp/icon.png" alt="HTML Mustache Logo" width="128">
</p>

<h1 align="center">HTML Mustache</h1>

<p align="center">
  <strong>Full language support for HTML with Mustache/Handlebars templates</strong>
</p>

<p align="center">
  <a href="https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/lint.yml"><img src="https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/lint.yml?logo=github&label=Lint" alt="Lint"></a>
  <a href="https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/lsp.yml"><img src="https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/lsp.yml?logo=github&label=LSP" alt="LSP"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=reteps.htmlmustache-lsp"><img src="https://img.shields.io/visual-studio-marketplace/v/reteps.htmlmustache-lsp?logo=visualstudiocode&label=VS%20Code" alt="VS Code Marketplace"></a>
</p>

---

## Features

- **Syntax Highlighting** — Full semantic highlighting for HTML and Mustache, plus embedded JS/TS in `<script>` and CSS in `<style>`
- **Document Formatting** — Auto-format with EditorConfig and config file support
- **CLI Linter & Formatter** — Check and format templates from the command line
- **Document Symbols** — Outline view and breadcrumb navigation
- **Folding** — Collapse HTML elements and Mustache sections
- **Hover Information** — Tag and attribute documentation

### Supported Mustache Syntax

| Syntax                    | Description            |
| ------------------------- | ---------------------- |
| `{{name}}`                | Variable interpolation |
| `{{{html}}}`              | Unescaped HTML         |
| `{{#items}}...{{/items}}` | Sections               |
| `{{^items}}...{{/items}}` | Inverted sections      |
| `{{! comment }}`          | Comments               |
| `{{> partial}}`           | Partials               |

## VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=reteps.htmlmustache-lsp) or search for "HTML Mustache" in the Extensions view.

What you get out of the box:

- Syntax highlighting (including embedded JS/TS and CSS)
- Document formatting (format on save, format selection)
- Error diagnostics (parse errors, mismatched tags)
- Document outline and breadcrumbs
- Hover information for HTML tags and attributes
- Code folding for HTML elements and Mustache sections

### Using with `.html` Files

By default, the extension activates for `.mustache`, `.hbs`, and `.handlebars` files. To use it with `.html` files, add this to your VS Code settings:

```json
{
  "files.associations": {
    "*.html": "htmlmustache"
  }
}
```

You can also change the language mode for a single file by clicking the language indicator in the status bar and selecting "HTML Mustache".

## CLI

Install globally or run via `npx`:

```
npm install -g @reteps/tree-sitter-htmlmustache
```

### `htmlmustache check`

Check templates for parse errors:

```
htmlmustache check '**/*.mustache' '**/*.hbs'
```

If `include` is configured in `.htmlmustache.jsonc`, patterns are optional:

```
htmlmustache check
```

```
file.mustache:3:3 error: Mismatched mustache section: {{/wrong}}
  |
1 | {{#items}}
2 |   <li>{{name}}
3 |   {{/wrong}}
  |   ^^^^^^^^^^ Mismatched mustache section: {{/wrong}}

1 error in 1 file (5 files checked)
```

Detects parse errors, mismatched Mustache sections, mismatched HTML end tags, and missing tokens.

### `htmlmustache format`

Format templates:

```
htmlmustache format --write '**/*.mustache'
```

If `include` is configured in `.htmlmustache.jsonc`, patterns are optional:

```
htmlmustache format --write
```

Check formatting in CI (exits 1 if any files would change):

```
htmlmustache format --check 'templates/**/*.hbs'
```

Read from stdin:

```
echo '<div><p>hi</p></div>' | htmlmustache format --stdin
```

**Options:**

| Flag                | Description                                      |
| ------------------- | ------------------------------------------------ |
| `--write`           | Modify files in-place (default: print to stdout) |
| `--check`           | Exit 1 if any files would change (for CI)        |
| `--stdin`           | Read from stdin, write to stdout                 |
| `--indent-size N`   | Spaces per indent level (default: 2)             |
| `--print-width N`   | Max line width (default: 80)                     |
| `--mustache-spaces` | Add spaces inside mustache delimiters            |

## Format Ignore

Skip formatting for specific regions using ignore directives. Both HTML and Mustache comment forms are supported.

### Ignore Next Node

Place a comment immediately before the element to preserve its original formatting:

```html
<!-- htmlmustache-ignore -->
<div class="a" id="b">manually formatted</div>
```

```html
{{! htmlmustache-ignore }}
<table>
  <tr>
    <td>compact</td>
    <td>table</td>
  </tr>
</table>
```

Only the immediately following sibling node is ignored. Subsequent nodes are formatted normally.

### Ignore Region

Wrap a region in start/end comments to preserve everything between them:

```html
<!-- htmlmustache-ignore-start -->
<div class="a">content</div>
<p>kept as-is</p>
<!-- htmlmustache-ignore-end -->
```

```html
{{! htmlmustache-ignore-start }} {{#items}}
<li>{{name}}</li>
{{/items}} {{! htmlmustache-ignore-end }}
```

If `ignore-start` has no matching `ignore-end`, all remaining siblings in the current scope are preserved as raw text.

## Configuration

### `.htmlmustache.jsonc`

Create a `.htmlmustache.jsonc` file in your project root to configure formatting options. Both the VS Code extension and CLI will pick it up automatically (the file is found by walking up from the formatted file).

```jsonc
{
  // File patterns for CLI commands (used when no patterns are passed as arguments)
  "include": ["**/*.mustache", "**/*.hbs"],

  // Patterns to always exclude (node_modules and .git are excluded by default)
  "exclude": ["**/vendor/**"],

  // Max line width before wrapping (default: 80)
  "printWidth": 100,

  // Spaces per indent level (default: 2)
  "indentSize": 4,

  // Add spaces inside mustache delimiters: {{ foo }} vs {{foo}} (default: false)
  "mustacheSpaces": true,

  // Treat custom tags as raw code blocks (like <script>/<style>)
  "customCodeTags": [
    {
      "name": "x-code",
      "languageDefault": "javascript",
    },
  ],
}
```

### Lint Rules

The following checks are always enabled and report as errors:

- **Syntax errors** — invalid or unparseable template syntax
- **Missing tokens** — e.g. a missing closing `>`
- **Mismatched mustache sections** — `{{/wrong}}` closing a different section than was opened
- **Mismatched HTML tags** — closing tags that don't match their opening tag, including across mustache branches
- **Unclosed HTML tags** — non-void elements that are never closed

Additionally, the following rules are configurable. Set their severities (`"error"`, `"warning"`, or `"off"`) in the `rules` object:

```jsonc
{
  "rules": {
    "consecutiveDuplicateSections": "off",
    "preferMustacheComments": "warning"
  }
}
```

<!-- RULES_TABLE_START -->

| Rule | Default | Description |
| --- | --- | --- |
| `nestedDuplicateSections` | `error` | Flags `{{#name}}` nested inside another `{{#name}}` with the same name |
| `unquotedMustacheAttributes` | `error` | Requires quotes around mustache expressions used as attribute values |
| `consecutiveDuplicateSections` | `warning` | Warns when adjacent same-name sections can be merged |
| `selfClosingNonVoidTags` | `error` | Disallows self-closing syntax on non-void HTML elements (e.g. `<div/>`) |
| `duplicateAttributes` | `error` | Detects duplicate HTML attributes on the same element |
| `unescapedEntities` | `warning` | Flags unescaped `&` and `>` characters in text content |
| `preferMustacheComments` | `off` | Suggests replacing HTML comments with mustache comments |

<!-- RULES_TABLE_END -->

### EditorConfig

Both the CLI and VS Code extension respect your `.editorconfig` file for indentation settings (`indent_style`, `indent_size`). EditorConfig values override `.htmlmustache.jsonc` for indentation, and CLI flags override everything.

**Priority order:** defaults < `.htmlmustache.jsonc` < `.editorconfig` (indent only) < CLI flags

## Acknowledgments

This project is based on [tree-sitter-html](https://github.com/tree-sitter/tree-sitter-html) by Max Brunsfeld and Amaan Qureshi.
