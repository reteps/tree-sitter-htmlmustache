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

- **Syntax Highlighting** — Full semantic highlighting for HTML and Mustache syntax
- **Document Formatting** — Auto-format with EditorConfig support
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

## Installation

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=reteps.htmlmustache-lsp) or search for "HTML Mustache" in the Extensions view.

Alternatively, download `htmlmustache-lsp.vsix` from the [latest release](https://github.com/reteps/tree-sitter-htmlmustache/releases) and install via:

```
code --install-extension htmlmustache-lsp.vsix
```

### WASM

Download `tree-sitter-htmlmustache.wasm` from the [latest release](https://github.com/reteps/tree-sitter-htmlmustache/releases).

## Using with `.html` Files

By default, the extension activates for `.mustache`, `.hbs`, and `.handlebars` files. To use it with `.html` files, add this to your VS Code settings:

```json
{
  "files.associations": {
    "*.html": "htmlmustache"
  }
}
```

You can also change the language mode for a single file by clicking the language indicator in the status bar and selecting "HTML Mustache".

## Acknowledgments

This project is based on [tree-sitter-html](https://github.com/tree-sitter/tree-sitter-html) by Max Brunsfeld and Amaan Qureshi.

## References

- [The HTML5 Spec](https://www.w3.org/TR/html5/syntax.html)
- [Mustache Manual](https://mustache.github.io/mustache.5.html)
- [Handlebars Language Guide](https://handlebarsjs.com/guide/)
