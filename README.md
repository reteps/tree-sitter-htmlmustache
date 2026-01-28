# tree-sitter-htmlmustache

[![CI][ci]](https://github.com/reteps/tree-sitter-htmlmustache/actions/workflows/ci.yml)

HTML with Mustache/Handlebars template syntax grammar for [tree-sitter](https://github.com/tree-sitter/tree-sitter).

This grammar extends standard HTML parsing to support Mustache constructs:

- Variables: `{{name}}`, `{{{unescaped}}}`
- Sections: `{{#items}}...{{/items}}`
- Inverted sections: `{{^items}}...{{/items}}`
- Comments: `{{! comment }}`
- Partials: `{{> partial}}`

## Installation

### VS Code Extension

Download `htmlmustache-lsp.vsix` from the [latest release](https://github.com/reteps/tree-sitter-htmlmustache/releases) and install via:

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

[ci]: https://img.shields.io/github/actions/workflow/status/reteps/tree-sitter-htmlmustache/ci.yml?logo=github&label=CI
