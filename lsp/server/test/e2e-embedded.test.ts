/**
 * End-to-end test for embedded language highlighting in custom code tags.
 *
 * Exercises the exact same code path as the real LSP server:
 *   1. Parse document with tree-sitter
 *   2. Find custom code tag elements (findCustomCodeTagContent)
 *   3. Tokenize embedded content with vscode-textmate (tokenizeEmbeddedContent)
 *   4. Build final semantic tokens (buildSemanticTokens with additionalTokens)
 *   5. Verify the delta-encoded output contains the expected tokens
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseText, createTestQuery } from './setup';
import { findCustomCodeTagContent } from '../src/customCodeTags';
import type { CustomCodeTagConfig } from '../src/customCodeTags';
import {
  initializeTextMateRegistry,
  isTextMateReady,
  tokenizeEmbeddedContent,
} from '../src/embeddedTokenizer';
import { buildSemanticTokens, HIGHLIGHT_QUERY, RAW_TEXT_QUERY } from '../src/semanticTokens';
import type { TokenInfo } from '../src/semanticTokens';
import { tokenTypesLegend, tokenTypeIndex } from '../src/tokenLegend';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal C++ grammar for testing
const MINIMAL_CPP_GRAMMAR = JSON.stringify({
  scopeName: 'source.cpp',
  patterns: [
    { match: '//.*$', name: 'comment.line.double-slash.cpp' },
    { match: '\\b(int|double|float|char|void|bool|auto|const|static|unsigned|signed|long|short|return|if|else|while|for|do|switch|case|break|continue|namespace|using|class|struct|template|typename|public|private|protected|virtual|override|inline|extern|sizeof|new|delete|try|catch|throw|nullptr|true|false|include)\\b', name: 'keyword.control.cpp' },
    { match: '\\b(cout|cin|cerr|clog|endl|fixed|setprecision|setw|setfill|left|right|hex|oct|dec|boolalpha|scientific|printf|scanf)\\b', name: 'support.function.cpp' },
    { begin: '"', end: '"', name: 'string.quoted.double.cpp', patterns: [
      { match: '\\\\.', name: 'constant.character.escape.cpp' },
    ]},
    { begin: "'", end: "'", name: 'string.quoted.single.cpp' },
    { match: '\\b[0-9]+(?:\\.[0-9]+)?\\b', name: 'constant.numeric.cpp' },
    { match: '<<|>>|<=|>=|==|!=|&&|\\|\\||\\+\\+|--|->|::', name: 'keyword.operator.cpp' },
    { match: '[+\\-*/%=<>!&|^~]', name: 'keyword.operator.cpp' },
  ],
});

const T = tokenTypeIndex;

/** Decode delta-encoded semantic token data into absolute positions. */
function decodeTokenData(data: Uint32Array): Array<{
  row: number; col: number; length: number; tokenType: number; typeName: string;
}> {
  const tokens = [];
  let row = 0, col = 0;
  for (let i = 0; i < data.length; i += 5) {
    row += data[i];
    if (data[i] > 0) col = 0;
    col += data[i + 1];
    tokens.push({
      row,
      col,
      length: data[i + 2],
      tokenType: data[i + 3],
      typeName: tokenTypesLegend[data[i + 3]] || `unknown(${data[i + 3]})`,
    });
  }
  return tokens;
}

/** Run the full server-side pipeline for a document. */
async function runFullPipeline(
  html: string,
  configs: CustomCodeTagConfig[],
): Promise<ReturnType<typeof decodeTokenData>> {
  // Step 1: Parse with tree-sitter
  const tree = parseText(html);

  // Step 2: Find custom code tag content (exact same function as server)
  const codeTagContents = findCustomCodeTagContent(tree.rootNode, configs);

  // Step 3: Tokenize embedded content with vscode-textmate
  let embeddedTokens: TokenInfo[] = [];
  if (isTextMateReady() && codeTagContents.length > 0) {
    const tokenArrays = await Promise.all(
      codeTagContents.map((content) =>
        tokenizeEmbeddedContent(content.text, content.languageId, content.startRow, content.startCol)
      )
    );
    embeddedTokens = tokenArrays.flat();
  }

  // Step 4: Build semantic tokens (exact same function as server)
  const query = createTestQuery(HIGHLIGHT_QUERY);
  const rawTextQuery = createTestQuery(RAW_TEXT_QUERY);
  const result = buildSemanticTokens(
    tree, query, rawTextQuery, embeddedTokens.length > 0 ? embeddedTokens : undefined
  ).build();

  // Step 5: Decode and return
  return decodeTokenData(result.data);
}

const PL_CODE_CONFIG: CustomCodeTagConfig[] = [
  { name: 'pl-code', languageAttribute: 'language' },
];

// Minimal DOT/Graphviz grammar for testing
const MINIMAL_DOT_GRAMMAR = JSON.stringify({
  scopeName: 'source.dot',
  patterns: [
    { match: '//.*$', name: 'comment.line.double-slash.dot' },
    { match: '/\\*[\\s\\S]*?\\*/', name: 'comment.block.dot' },
    { match: '\\b(digraph|graph|subgraph|node|edge|strict)\\b', name: 'keyword.control.dot' },
    { match: '\\b(shape|label|color|style|fillcolor|fontcolor|fontsize|fontname|rankdir|rank|dir|weight|arrowhead|arrowtail|bgcolor|concentrate|compound|clusterrank|margin|pad|ranksep|nodesep|size|ratio)\\b', name: 'support.type.attribute.dot' },
    { begin: '"', end: '"', name: 'string.quoted.double.dot', patterns: [
      { match: '\\\\.', name: 'constant.character.escape.dot' },
    ]},
    { match: '->', name: 'keyword.operator.dot' },
    { match: '--', name: 'keyword.operator.dot' },
    { match: '\\b[0-9]+(?:\\.[0-9]+)?\\b', name: 'constant.numeric.dot' },
  ],
});

// Minimal Markdown grammar for testing
const MINIMAL_MARKDOWN_GRAMMAR = JSON.stringify({
  scopeName: 'text.html.markdown',
  patterns: [
    { match: '^#{1,6}\\s+.*$', name: 'markup.heading.markdown' },
    { match: '```\\w*', name: 'markup.fenced_code.block.markdown' },
    { match: '\\*\\*[^*]+\\*\\*', name: 'markup.bold.markdown' },
    { match: '\\*[^*]+\\*', name: 'markup.italic.markdown' },
    { match: '`[^`]+`', name: 'markup.inline.raw.markdown' },
  ],
});

describe('e2e: embedded language highlighting', () => {
  beforeAll(async () => {
    const wasmPath = path.resolve(__dirname, '..', '..', 'server', 'out', 'onig.wasm');
    await initializeTextMateRegistry(wasmPath, async (scopeName: string) => {
      if (scopeName === 'source.cpp') {
        return { content: MINIMAL_CPP_GRAMMAR, format: 'json' as const };
      }
      if (scopeName === 'source.dot') {
        return { content: MINIMAL_DOT_GRAMMAR, format: 'json' as const };
      }
      if (scopeName === 'text.html.markdown') {
        return { content: MINIMAL_MARKDOWN_GRAMMAR, format: 'json' as const };
      }
      return null;
    });
  });

  describe('cin &gt;&gt; price (user-reported issue)', () => {
    const DOC = `<pl-code language="cpp">
cin &gt;&gt; price;
</pl-code>`;

    it('findCustomCodeTagContent extracts the content with correct language', () => {
      const tree = parseText(DOC);
      const contents = findCustomCodeTagContent(tree.rootNode, PL_CODE_CONFIG);
      expect(contents).toHaveLength(1);
      expect(contents[0].languageId).toBe('cpp');
      expect(contents[0].text).toBe('\ncin &gt;&gt; price;\n');
    });

    it('tokenizeEmbeddedContent produces operator token for &gt;&gt;', async () => {
      const tree = parseText(DOC);
      const contents = findCustomCodeTagContent(tree.rootNode, PL_CODE_CONFIG);
      const tokens = await tokenizeEmbeddedContent(
        contents[0].text, contents[0].languageId,
        contents[0].startRow, contents[0].startCol,
      );

      // >> should be an operator
      const opTokens = tokens.filter(t => t.tokenType === T.operator);
      expect(opTokens.length).toBeGreaterThanOrEqual(1);

      // The >> operator comes from &gt;&gt; which is 8 chars in the original
      const shiftOp = opTokens.find(t => t.length === 8);
      expect(shiftOp).toBeDefined();
      expect(shiftOp!.row).toBe(1); // line 1 of document (0=<pl-code>, 1=cin...)

      // cin should be a support.function token → supportFunction
      const funcTokens = tokens.filter(t => t.tokenType === T.supportFunction);
      const cinToken = funcTokens.find(t => t.length === 3);
      expect(cinToken).toBeDefined();
    });

    it('full pipeline produces correct semantic tokens', async () => {
      const allTokens = await runFullPipeline(DOC, PL_CODE_CONFIG);

      // Verify HTML tokens for <pl-code> tags
      const tagTokens = allTokens.filter(t => t.tokenType === T.tag);
      expect(tagTokens.length).toBeGreaterThanOrEqual(2); // pl-code in start + end

      // Verify embedded operator token for >> (&gt;&gt;)
      const opTokens = allTokens.filter(t => t.tokenType === T.operator);
      expect(opTokens.length).toBeGreaterThanOrEqual(1);
      const shiftOp = opTokens.find(t => t.length === 8);
      expect(shiftOp).toBeDefined();
      expect(shiftOp!.row).toBe(1);

      // Verify cin is highlighted (support.function → supportFunction)
      const funcTokens = allTokens.filter(t => t.tokenType === T.supportFunction);
      expect(funcTokens.find(t => t.length === 3)).toBeDefined(); // cin

      // Verify price has some token (identifier/variable — our minimal grammar
      // won't tokenize bare identifiers, so just check ; isn't an issue)

      // Print all tokens for debugging
      console.log('--- cin >> price; tokens ---');
      for (const t of allTokens) {
        console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
      }
    });
  });

  describe('cout &lt;&lt; with multiple operators', () => {
    const DOC = `<pl-code language="cpp">
cout &lt;&lt; fixed &lt;&lt; setprecision(2) &lt;&lt; price + tax &lt;&lt; endl;
</pl-code>`;

    it('full pipeline highlights all << operators', async () => {
      const allTokens = await runFullPipeline(DOC, PL_CODE_CONFIG);

      // Each &lt;&lt; is 8 chars and should be operator
      const shiftOps = allTokens.filter(t => t.tokenType === T.operator && t.length === 8);
      expect(shiftOps.length).toBe(4); // 4 occurrences of <<

      // cout, fixed, setprecision, endl should be supportFunction tokens
      const funcTokens = allTokens.filter(t => t.tokenType === T.supportFunction);
      expect(funcTokens.length).toBeGreaterThanOrEqual(3); // cout, fixed, endl at minimum

      console.log('--- cout << tokens ---');
      for (const t of allTokens) {
        console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
      }
    });
  });

  describe('multiline document with multiple pl-code blocks', () => {
    const DOC = `<h1>Test</h1>
<pl-code language="cpp">
int x = 42;
if (x &gt; 0) {
  cout &lt;&lt; "positive" &lt;&lt; endl;
}
</pl-code>
<p>Some text</p>
<pl-code language="cpp">
cin &gt;&gt; price;
double tax = price * 0.08;
</pl-code>`;

    it('finds both code blocks', () => {
      const tree = parseText(DOC);
      const contents = findCustomCodeTagContent(tree.rootNode, PL_CODE_CONFIG);
      expect(contents).toHaveLength(2);
      expect(contents[0].languageId).toBe('cpp');
      expect(contents[1].languageId).toBe('cpp');
    });

    it('full pipeline produces tokens for both blocks', async () => {
      const allTokens = await runFullPipeline(DOC, PL_CODE_CONFIG);

      // Should have keywordControl tokens (int, if, double — keyword.control.cpp)
      const kwTokens = allTokens.filter(t => t.tokenType === T.keywordControl);
      expect(kwTokens.length).toBeGreaterThanOrEqual(3);

      // Should have number tokens (42, 0, 0.08)
      const numTokens = allTokens.filter(t => t.tokenType === T.number);
      expect(numTokens.length).toBeGreaterThanOrEqual(2);

      // Should have operator tokens for << and >>
      const opTokens = allTokens.filter(t => t.tokenType === T.operator);
      expect(opTokens.length).toBeGreaterThanOrEqual(3); // 2x<<, 1x>>, plus >, *, =

      // Should have string token for "positive"
      const strTokens = allTokens.filter(t => t.tokenType === T.string);
      expect(strTokens.length).toBeGreaterThanOrEqual(1);

      // Should have HTML tokens for h1, p, pl-code
      const htmlTagTokens = allTokens.filter(t => t.tokenType === T.tag);
      expect(htmlTagTokens.length).toBeGreaterThanOrEqual(4); // h1, pl-code x2, p at minimum

      // All tokens should be in order
      for (let i = 1; i < allTokens.length; i++) {
        const prev = allTokens[i - 1];
        const curr = allTokens[i];
        if (curr.row === prev.row) {
          expect(curr.col).toBeGreaterThanOrEqual(prev.col);
        } else {
          expect(curr.row).toBeGreaterThan(prev.row);
        }
      }

      console.log('--- multiline doc tokens ---');
      for (const t of allTokens) {
        console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
      }
    });
  });

  describe('no embedded tokens without config', () => {
    const DOC = `<pl-code language="cpp">
cin &gt;&gt; price;
</pl-code>`;

    it('returns only HTML tokens when no custom tag configs are provided', async () => {
      const allTokens = await runFullPipeline(DOC, []);

      // Should have HTML tokens but NO embedded tokens
      const opTokens = allTokens.filter(t => t.tokenType === T.operator);
      expect(opTokens).toHaveLength(0);

      const funcTokens = allTokens.filter(t => t.tokenType === T.supportFunction);
      expect(funcTokens).toHaveLength(0);

      // HTML tokens should still exist
      const tagTokens = allTokens.filter(t => t.tokenType === T.tag);
      expect(tagTokens.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('second request returns same tokens (no regression)', () => {
    const DOC = `<pl-code language="cpp">
int x = 10;
</pl-code>`;

    it('two consecutive pipeline runs produce identical output', async () => {
      const tokens1 = await runFullPipeline(DOC, PL_CODE_CONFIG);
      const tokens2 = await runFullPipeline(DOC, PL_CODE_CONFIG);
      expect(tokens1).toEqual(tokens2);
    });
  });

  describe('defaultLanguage config (no syntaxAttribute)', () => {
    const DEFAULT_LANG_CONFIGS: CustomCodeTagConfig[] = [
      { name: 'markdown', languageDefault: 'markdown' },
      { name: 'pl-graph', languageDefault: 'dot' },
    ];

    describe('pl-graph with defaultLanguage: "dot"', () => {
      const DOC = `<pl-graph>
digraph G {
  A -> B
  B -> C
}
</pl-graph>`;

      it('findCustomCodeTagContent extracts content with language=dot', () => {
        const tree = parseText(DOC);
        const contents = findCustomCodeTagContent(tree.rootNode, DEFAULT_LANG_CONFIGS);
        expect(contents.length).toBeGreaterThanOrEqual(1);
        const dotContent = contents.find(c => c.languageId === 'dot');
        expect(dotContent).toBeDefined();
        expect(dotContent!.text).toContain('digraph G');
        expect(dotContent!.text).toContain('A -> B');
      });

      it('tokenizes DOT keywords and operators', async () => {
        const allTokens = await runFullPipeline(DOC, DEFAULT_LANG_CONFIGS);

        console.log('--- pl-graph dot tokens ---');
        for (const t of allTokens) {
          console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
        }

        // 'digraph' should be keywordControl (keyword.control.dot)
        const kwTokens = allTokens.filter(t => t.tokenType === T.keywordControl);
        expect(kwTokens.length).toBeGreaterThanOrEqual(1);
        const digraphToken = kwTokens.find(t => t.length === 7); // "digraph"
        expect(digraphToken).toBeDefined();

        // '->' should be operator (keyword.operator.dot)
        const opTokens = allTokens.filter(t => t.tokenType === T.operator);
        expect(opTokens.length).toBeGreaterThanOrEqual(2); // A -> B, B -> C
      });
    });

    describe('markdown with defaultLanguage: "markdown"', () => {
      const DOC = `<markdown>
# Graph 1

\`\`\`html
hello
\`\`\`

</markdown>`;

      it('findCustomCodeTagContent extracts content with language=markdown', () => {
        const tree = parseText(DOC);
        const contents = findCustomCodeTagContent(tree.rootNode, DEFAULT_LANG_CONFIGS);
        expect(contents.length).toBeGreaterThanOrEqual(1);
        const mdContent = contents.find(c => c.languageId === 'markdown');
        expect(mdContent).toBeDefined();
        expect(mdContent!.text).toContain('# Graph 1');
      });

      it('tokenizes markdown headings', async () => {
        const allTokens = await runFullPipeline(DOC, DEFAULT_LANG_CONFIGS);

        console.log('--- markdown tokens ---');
        for (const t of allTokens) {
          console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
        }

        // Check that at least HTML tokens are emitted for <markdown> tags
        const tagTokens = allTokens.filter(t => t.tokenType === T.tag);
        expect(tagTokens.length).toBeGreaterThanOrEqual(2); // markdown in start + end
      });
    });

    describe('indented markdown (dedent)', () => {
      // Simulates real-world case: markdown content indented inside HTML
      const DOC = `<div>
  <markdown>
    # Graph 1

    ## Graph 2

    [Graph 2](graph2.png)

    \`\`\`html
    hello
    \`\`\`

  </markdown>
</div>`;

      it('headings are tokenized as markupHeading, not markupRaw', async () => {
        const allTokens = await runFullPipeline(DOC, DEFAULT_LANG_CONFIGS);

        console.log('--- indented markdown tokens ---');
        for (const t of allTokens) {
          console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
        }

        // Headings should be markupHeading, NOT markupRaw
        const headingTokens = allTokens.filter(t => t.tokenType === T.markupHeading);
        expect(headingTokens.length).toBeGreaterThanOrEqual(2); // # Graph 1, ## Graph 2

        // Fenced code delimiters should be markupFencedCode
        const fencedTokens = allTokens.filter(t => t.tokenType === T.markupFencedCode);
        expect(fencedTokens.length).toBeGreaterThanOrEqual(2); // ```html, ```

        // Should NOT have markupRaw (that would mean indentation was misinterpreted)
        const rawTokens = allTokens.filter(t => t.tokenType === T.markupRaw);
        expect(rawTokens).toHaveLength(0);
      });
    });

    describe('both tags in one document', () => {
      const DOC = `<markdown>
# Graph 1

\`\`\`html
hello
\`\`\`

</markdown>

<pl-graph>
digraph G {
  A -> B
  B -> C
}
</pl-graph>`;

      it('finds both tag contents with correct languages', () => {
        const tree = parseText(DOC);
        const contents = findCustomCodeTagContent(tree.rootNode, DEFAULT_LANG_CONFIGS);
        const mdContent = contents.find(c => c.languageId === 'markdown');
        const dotContent = contents.find(c => c.languageId === 'dot');
        expect(mdContent).toBeDefined();
        expect(dotContent).toBeDefined();
      });

      it('full pipeline produces tokens for both blocks', async () => {
        const allTokens = await runFullPipeline(DOC, DEFAULT_LANG_CONFIGS);

        console.log('--- combined markdown + pl-graph tokens ---');
        for (const t of allTokens) {
          console.log(`  row=${t.row} col=${t.col} len=${t.length} type=${t.typeName}`);
        }

        // Should have HTML tag tokens for both <markdown> and <pl-graph>
        const tagTokens = allTokens.filter(t => t.tokenType === T.tag);
        expect(tagTokens.length).toBeGreaterThanOrEqual(4); // markdown x2 + pl-graph x2

        // Should have dot keywords from pl-graph
        const kwTokens = allTokens.filter(t => t.tokenType === T.keywordControl);
        expect(kwTokens.length).toBeGreaterThanOrEqual(1); // digraph

        // Should have dot operators from pl-graph
        const opTokens = allTokens.filter(t => t.tokenType === T.operator);
        expect(opTokens.length).toBeGreaterThanOrEqual(2); // ->
      });
    });
  });
});
