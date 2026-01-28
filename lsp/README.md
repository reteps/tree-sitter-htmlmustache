# HTML Mustache Language Server

A VS Code language server for HTML with Mustache template syntax, powered by tree-sitter.

## Features

- **Semantic Highlighting** - Context-aware syntax highlighting using tree-sitter
- **Document Symbols** - Outline view showing HTML elements and Mustache sections
- **Hover Information** - Documentation for HTML tags, attributes, and Mustache constructs
- **Folding Ranges** - Collapse HTML elements, Mustache sections, and comments

## Quick Start

```bash
# 1. From the project root, build the WASM parser
tree-sitter build --wasm

# 2. Install LSP dependencies
cd lsp
npm install

# 3. Build the LSP
npm run build

# 4. Test in VS Code (see below)
```

## Building the WASM Parser

The LSP requires the tree-sitter grammar compiled to WebAssembly. From the **project root**:

```bash
# Make sure tree-sitter CLI is installed
npm install -g tree-sitter-cli

# Build the WASM file (creates tree-sitter-htmlmustache.wasm)
tree-sitter build --wasm
```

This creates `tree-sitter-htmlmustache.wasm` in the project root, which the LSP server loads at runtime.

## Installing & Building the LSP

```bash
cd lsp

# Install all dependencies (client + server)
npm install

# Build both client and server
npm run build
```

### Development Mode

For active development, use watch mode to auto-rebuild on changes:

```bash
npm run watch
```

## Testing in VS Code

### Option 1: Launch Configuration (Recommended)

1. Open the **project root** (`tree-sitter-htmlmustache/`) in VS Code
2. Go to Run and Debug (Cmd+Shift+D)
3. Select "Launch LSP Extension" from the dropdown
4. Press F5

This opens a new VS Code window with the extension loaded. Open any `.mustache`, `.hbs`, or `.handlebars` file to test.

### Option 2: Manual

1. Open the `lsp/` folder in VS Code
2. Press F5 to launch Extension Development Host
3. In the new window, open a `.mustache` file

### Verifying It Works

Once running, you should see:
- Syntax highlighting for HTML and Mustache constructs
- Outline view (Cmd+Shift+O) showing HTML elements and Mustache sections
- Hover tooltips when hovering over tags, attributes, or Mustache expressions
- Folding arrows for collapsible regions

## Troubleshooting

### "Failed to load tree-sitter-htmlmustache.wasm"

The WASM file wasn't found. Make sure you built it:
```bash
cd /path/to/tree-sitter-htmlmustache
tree-sitter build --wasm
ls *.wasm  # Should show tree-sitter-htmlmustache.wasm
```

### No syntax highlighting

1. Check the Output panel (View > Output) and select "HTML Mustache Language Server"
2. Verify the file has a supported extension (`.mustache`, `.hbs`, `.handlebars`)
3. Make sure semantic highlighting is enabled in VS Code settings

### Type errors during build

Run `npm install` in the `lsp/` directory to install dependencies.

## Architecture

```
lsp/
├── client/                 # VS Code extension client
│   └── src/
│       └── extension.ts    # Extension entry point
├── server/                 # Language server
│   └── src/
│       ├── server.ts       # Main LSP server
│       ├── parser.ts       # Tree-sitter integration
│       ├── semanticTokens.ts # Syntax highlighting
│       ├── documentSymbols.ts # Outline view
│       ├── hover.ts        # Hover information
│       └── folding.ts      # Folding ranges
└── package.json            # Extension manifest
```

## How It Works

1. **Parsing**: Documents are parsed with tree-sitter on open and on every change
2. **Caching**: Parse trees are cached per-document for efficiency
3. **Feature Extraction**: Each LSP feature walks the syntax tree to extract information

The server loads `tree-sitter-htmlmustache.wasm` from the parent directory and uses it to parse documents into syntax trees.

## Adding Features

To add a new LSP feature:

1. Create a new file in `server/src/` (e.g., `completion.ts`)
2. Implement the feature using the cached parse tree
3. Register the handler in `server.ts`
4. Add the capability to the `InitializeResult`

## Related

- [tree-sitter-htmlmustache](../) - The tree-sitter grammar
- [VS Code LSP Guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)
