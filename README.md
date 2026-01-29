<p align="center">
  <img src="lsp/icon.png" alt="HTML Mustache Logo" width="128">
</p>

# tree-sitter-htmlmustache

[![Lint][lint-badge]][lint]
[![LSP][lsp-badge]][lsp]
[![VS Code Marketplace][marketplace-badge]][marketplace]

HTML with Mustache/Handlebars template syntax grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter).

This grammar extends standard HTML parsing to support Mustache constructs:

- Variables: `{{name}}`, `{{{unescaped}}}`
- Sections: `{{#items}}...{{/items}}`
- Inverted sections: `{{^items}}...{{/items}}`
- Comments: `{{! comment }}`
- Partials: `{{> partial}}`

## Installation

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=reteps.htmlmustache-lsp) or search for "HTML Mustache" in the Extensions view.

Alternatively, download `htmlmustache-lsp.vsix` from the [latest release](https://github.com/reteps/tree-sitter-htmlmustache/releases) and install via:

```
code --install-extension htmlmustache-lsp.vsix
```

### WASM

Download `tree-sitter-htmlmustache.wasm` from the [latest release](https://github.com/reteps/tree-sitter-htmlmustache/releases).

## Acknowledgments

This project is based on [tree-sitter-html](https://github.com/tree-sitter/tree-sitter-html) by Max Brunsfeld and Amaan Qureshi.

## References

- [The HTML5 Spec](https://www.w3.org/TR/html5/syntax.html)
- [Mustache Manual](https://mustache.github.io/mustache.5.html)
- [Handlebars Language Guide](https://handlebarsjs.com/guide/)

[lint-badge]: https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/lint.yml?logo=github&label=Lint
[lint]: https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/lint.yml
[lsp-badge]: https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/lsp.yml?logo=github&label=LSP
[lsp]: https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/lsp.yml
[marketplace-badge]: https://img.shields.io/visual-studio-marketplace/v/reteps.htmlmustache-lsp?logo=visualstudiocode&label=VS%20Code
[marketplace]: https://marketplace.visualstudio.com/items?itemName=reteps.htmlmustache-lsp
