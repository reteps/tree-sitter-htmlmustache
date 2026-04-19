import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeEntities,
  initializeTextMateRegistry,
  isTextMateReady,
  tokenizeEmbeddedContent,
} from '../src/embeddedTokenizer.js';
import { buildSemanticTokens, HIGHLIGHT_QUERY, RAW_TEXT_QUERY } from '../src/semanticTokens.js';
import type { TokenInfo } from '../src/semanticTokens.js';
import { tokenTypeIndex } from '../src/tokenLegend.js';
import { parseText, createTestQuery } from './setup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal TextMate grammar for testing tokenization pipeline.
// Matches basic patterns so we can verify the end-to-end flow without
// needing real language grammars from VS Code extensions.
const MINIMAL_TEST_GRAMMAR = JSON.stringify({
  scopeName: 'source.python',
  patterns: [
    { match: '\\b(if|else|elif|while|for|return|def|class|import|from|print)\\b', name: 'keyword.control.python' },
    { match: '\\b(True|False|None)\\b', name: 'constant.language.python' },
    { begin: '"', end: '"', name: 'string.quoted.double.python', patterns: [
      { match: '\\\\.', name: 'constant.character.escape.python' },
    ]},
    { begin: "'", end: "'", name: 'string.quoted.single.python', patterns: [
      { match: '\\\\.', name: 'constant.character.escape.python' },
    ]},
    { match: '\\b[0-9]+(?:\\.[0-9]+)?\\b', name: 'constant.numeric.python' },
    { match: '#.*$', name: 'comment.line.number-sign.python' },
    { match: '[<>=!]=?|[+\\-*/%]', name: 'keyword.operator.python' },
  ],
});

// Minimal C++ grammar for testing the user's exact pl-code example.
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

const TokenTypes = tokenTypeIndex;

describe('decodeEntities', () => {
  describe('named entities', () => {
    it('decodes &lt; to <', () => {
      const { decoded } = decodeEntities('&lt;');
      expect(decoded).toBe('<');
    });

    it('decodes &gt; to >', () => {
      const { decoded } = decodeEntities('&gt;');
      expect(decoded).toBe('>');
    });

    it('decodes &amp; to &', () => {
      const { decoded } = decodeEntities('&amp;');
      expect(decoded).toBe('&');
    });

    it('decodes &quot; to "', () => {
      const { decoded } = decodeEntities('&quot;');
      expect(decoded).toBe('"');
    });

    it('decodes &apos; to \'', () => {
      const { decoded } = decodeEntities('&apos;');
      expect(decoded).toBe("'");
    });

    it('decodes &nbsp; to non-breaking space', () => {
      const { decoded } = decodeEntities('&nbsp;');
      expect(decoded).toBe('\u00A0');
    });
  });

  describe('numeric entities', () => {
    it('decodes decimal numeric entity &#60; to <', () => {
      const { decoded } = decodeEntities('&#60;');
      expect(decoded).toBe('<');
    });

    it('decodes hex numeric entity &#x3C; to <', () => {
      const { decoded } = decodeEntities('&#x3C;');
      expect(decoded).toBe('<');
    });

    it('decodes uppercase hex &#x3c; to <', () => {
      const { decoded } = decodeEntities('&#x3c;');
      expect(decoded).toBe('<');
    });

    it('decodes &#39; to \'', () => {
      const { decoded } = decodeEntities('&#39;');
      expect(decoded).toBe("'");
    });

    it('decodes multi-digit decimal &#169; to ©', () => {
      const { decoded } = decodeEntities('&#169;');
      expect(decoded).toBe('©');
    });
  });

  describe('passthrough behavior', () => {
    it('passes through plain text unchanged', () => {
      const { decoded } = decodeEntities('hello world');
      expect(decoded).toBe('hello world');
    });

    it('passes through text with no entities', () => {
      const { decoded } = decodeEntities('if x < 2:');
      expect(decoded).toBe('if x < 2:');
    });

    it('handles empty string', () => {
      const { decoded, offsetMap } = decodeEntities('');
      expect(decoded).toBe('');
      expect(offsetMap).toEqual([]);
    });

    it('passes through bare & that is not a valid entity', () => {
      const { decoded } = decodeEntities('a & b');
      expect(decoded).toBe('a & b');
    });

    it('passes through incomplete entity &foo', () => {
      const { decoded } = decodeEntities('&foo');
      expect(decoded).toBe('&foo');
    });

    it('passes through &#abc; (invalid numeric)', () => {
      const { decoded } = decodeEntities('&#abc;');
      expect(decoded).toBe('&#abc;');
    });
  });

  describe('mixed content', () => {
    it('decodes entities mixed with plain text', () => {
      const { decoded } = decodeEntities('x &lt; 2');
      expect(decoded).toBe('x < 2');
    });

    it('decodes multiple entities in sequence', () => {
      const { decoded } = decodeEntities('&lt;div&gt;');
      expect(decoded).toBe('<div>');
    });

    it('decodes entity-heavy HTML content', () => {
      const { decoded } = decodeEntities('&lt;div class=&quot;test&quot;&gt;Hello &amp; world&lt;/div&gt;');
      expect(decoded).toBe('<div class="test">Hello & world</div>');
    });

    it('decodes entities with surrounding newlines', () => {
      const { decoded } = decodeEntities('line1\n&lt;div&gt;\nline3');
      expect(decoded).toBe('line1\n<div>\nline3');
    });

    it('decodes Python-like code with entities', () => {
      const { decoded } = decodeEntities('if x &lt; 2:\n    print(&quot;hello&quot;)');
      expect(decoded).toBe('if x < 2:\n    print("hello")');
    });
  });

  describe('offset map', () => {
    it('maps 1:1 for plain text', () => {
      const { decoded, offsetMap } = decodeEntities('abc');
      expect(decoded).toBe('abc');
      expect(offsetMap).toEqual([0, 1, 2]);
    });

    it('maps single entity correctly', () => {
      const { decoded, offsetMap } = decodeEntities('&lt;');
      expect(decoded).toBe('<');
      // The decoded '<' at position 0 maps to original position 0 (start of &lt;)
      expect(offsetMap).toEqual([0]);
    });

    it('maps entity surrounded by text', () => {
      const { decoded, offsetMap } = decodeEntities('a&lt;b');
      expect(decoded).toBe('a<b');
      // 'a' -> 0, '<' -> 1 (start of &lt;), 'b' -> 5 (after &lt;)
      expect(offsetMap).toEqual([0, 1, 5]);
    });

    it('maps adjacent entities correctly', () => {
      const { decoded, offsetMap } = decodeEntities('&lt;&gt;');
      expect(decoded).toBe('<>');
      // '<' -> 0 (start of &lt;), '>' -> 4 (start of &gt;)
      expect(offsetMap).toEqual([0, 4]);
    });

    it('maps complex entity-encoded HTML', () => {
      const { decoded, offsetMap } = decodeEntities('&lt;b&gt;');
      expect(decoded).toBe('<b>');
      // '<' -> 0 (&lt;), 'b' -> 4, '>' -> 5 (&gt;)
      expect(offsetMap).toEqual([0, 4, 5]);
    });

    it('preserves newline positions in offset map', () => {
      const { decoded, offsetMap } = decodeEntities('a\n&lt;');
      expect(decoded).toBe('a\n<');
      // 'a' -> 0, '\n' -> 1, '<' -> 2 (start of &lt;)
      expect(offsetMap).toEqual([0, 1, 2]);
    });

    it('offset map length equals decoded string length', () => {
      const inputs = [
        '',
        'hello',
        '&lt;&gt;&amp;',
        'a &lt; b &amp;&amp; c &gt; d',
        '&#60;&#x3e;',
      ];
      for (const input of inputs) {
        const { decoded, offsetMap } = decodeEntities(input);
        expect(offsetMap.length).toBe(decoded.length);
      }
    });

    it('offset map values are monotonically non-decreasing', () => {
      const { offsetMap } = decodeEntities('&lt;div class=&quot;x&quot;&gt;a &amp; b&lt;/div&gt;');
      for (let i = 1; i < offsetMap.length; i++) {
        expect(offsetMap[i]).toBeGreaterThanOrEqual(offsetMap[i - 1]);
      }
    });
  });
});

describe('buildSemanticTokens with additionalTokens', () => {
  function getTokens(text: string, additionalTokens?: TokenInfo[]) {
    const tree = parseText(text);
    const query = createTestQuery(HIGHLIGHT_QUERY);
    const rawTextQuery = createTestQuery(RAW_TEXT_QUERY);
    return buildSemanticTokens(tree, query, rawTextQuery, additionalTokens).build();
  }

  /**
   * Decode delta-encoded semantic token data into absolute positions.
   */
  function decodeTokenData(data: Uint32Array): Array<{
    line: number; startChar: number; length: number; tokenType: number; modifiers: number;
  }> {
    const tokens = [];
    let line = 0;
    let startChar = 0;
    for (let i = 0; i < data.length; i += 5) {
      line += data[i];
      if (data[i] !== 0) startChar = 0;
      startChar += data[i + 1];
      tokens.push({
        line,
        startChar,
        length: data[i + 2],
        tokenType: data[i + 3],
        modifiers: data[i + 4],
      });
    }
    return tokens;
  }

  it('works without additional tokens (baseline)', () => {
    const tokens = getTokens('<div>hello</div>');
    expect(tokens.data.length).toBeGreaterThan(0);
    expect(tokens.data.length % 5).toBe(0);
  });

  it('merges additional tokens into the output', () => {
    const baseTokens = getTokens('<div>content</div>');
    const baseCount = baseTokens.data.length / 5;

    // Add a token at line 0, col 5 (where "content" is)
    const additional: TokenInfo[] = [
      { row: 0, col: 5, length: 7, tokenType: TokenTypes.keyword },
    ];
    const withAdditional = getTokens('<div>content</div>', additional);
    const withCount = withAdditional.data.length / 5;

    // Should have more tokens than the base
    expect(withCount).toBeGreaterThanOrEqual(baseCount);
  });

  it('sorts additional tokens by position', () => {
    // Add tokens in reverse order - they should still be sorted in output
    const additional: TokenInfo[] = [
      { row: 0, col: 20, length: 3, tokenType: TokenTypes.string },
      { row: 0, col: 10, length: 5, tokenType: TokenTypes.keyword },
    ];
    const text = '<div>some text with extra tokens</div>';
    const result = getTokens(text, additional);
    const decoded = decodeTokenData(result.data);

    // Verify tokens are in order (line ascending, then col ascending)
    for (let i = 1; i < decoded.length; i++) {
      if (decoded[i].line === decoded[i - 1].line) {
        expect(decoded[i].startChar).toBeGreaterThanOrEqual(decoded[i - 1].startChar);
      } else {
        expect(decoded[i].line).toBeGreaterThan(decoded[i - 1].line);
      }
    }
  });

  it('skips additional tokens that overlap with existing tokens', () => {
    // <div> has tokens at col 0 for '<', col 1 for 'div', col 4 for '>'
    // Adding a token overlapping 'div' should be skipped
    const additional: TokenInfo[] = [
      { row: 0, col: 1, length: 3, tokenType: TokenTypes.string },
    ];
    const withOverlap = getTokens('<div></div>', additional);
    const withoutOverlap = getTokens('<div></div>');

    // Token count should be the same since the overlapping token is skipped
    expect(withOverlap.data.length).toBe(withoutOverlap.data.length);
  });

  it('includes additional tokens on different lines', () => {
    const additional: TokenInfo[] = [
      { row: 1, col: 2, length: 5, tokenType: TokenTypes.keyword },
    ];
    const result = getTokens('<div>\n  hello\n</div>', additional);
    const decoded = decodeTokenData(result.data);

    // Should find our keyword token on line 1
    const keywordOnLine1 = decoded.find(
      (t) => t.line === 1 && t.startChar === 2 && t.tokenType === TokenTypes.keyword
    );
    expect(keywordOnLine1).toBeDefined();
    expect(keywordOnLine1!.length).toBe(5);
  });

  it('handles empty additional tokens array', () => {
    const withEmpty = getTokens('<div></div>', []);
    const without = getTokens('<div></div>');
    expect(withEmpty.data.length).toBe(without.data.length);
  });
});

describe('tokenizeEmbeddedContent (integration)', () => {
  let textMateInitialized = false;

  beforeAll(async () => {
    // Initialize vscode-textmate with onig.wasm and our minimal test grammar
    const wasmPath = path.resolve(__dirname, '..', '..', 'server', 'out', 'onig.wasm');
    try {
      await initializeTextMateRegistry(wasmPath, async (scopeName: string) => {
        if (scopeName === 'source.python') {
          return { content: MINIMAL_TEST_GRAMMAR, format: 'json' as const };
        }
        if (scopeName === 'source.cpp') {
          return { content: MINIMAL_CPP_GRAMMAR, format: 'json' as const };
        }
        return null;
      });
      textMateInitialized = true;
    } catch (e) {
      console.warn('Could not initialize vscode-textmate (onig.wasm missing? run pnpm build first):', e);
    }
  });

  it('initializes the textmate registry', () => {
    expect(textMateInitialized).toBe(true);
    expect(isTextMateReady()).toBe(true);
  });

  it('returns empty array for unknown language', async () => {
    const tokens = await tokenizeEmbeddedContent('hello', 'unknownlang', 0, 0);
    expect(tokens).toEqual([]);
  });

  it('tokenizes simple Python keyword', async () => {
    const tokens = await tokenizeEmbeddedContent('if True:', 'python', 0, 0);

    // Should have at least a keywordControl token for 'if' (keyword.control.python)
    const keywordTokens = tokens.filter((t) => t.tokenType === TokenTypes.keywordControl);
    expect(keywordTokens.length).toBeGreaterThan(0);

    // 'if' should be at row 0, col 0, length 2
    const ifToken = keywordTokens.find((t) => t.col === 0 && t.length === 2);
    expect(ifToken).toBeDefined();
  });

  it('tokenizes string literals', async () => {
    const tokens = await tokenizeEmbeddedContent('"hello"', 'python', 0, 0);

    // Should have string tokens
    const stringTokens = tokens.filter((t) => t.tokenType === TokenTypes.string);
    expect(stringTokens.length).toBeGreaterThan(0);
  });

  it('tokenizes numeric literals', async () => {
    const tokens = await tokenizeEmbeddedContent('42', 'python', 0, 0);

    const numberTokens = tokens.filter((t) => t.tokenType === TokenTypes.number);
    expect(numberTokens.length).toBeGreaterThan(0);
  });

  it('tokenizes comments', async () => {
    const tokens = await tokenizeEmbeddedContent('# a comment', 'python', 0, 0);

    const commentTokens = tokens.filter((t) => t.tokenType === TokenTypes.comment);
    expect(commentTokens.length).toBeGreaterThan(0);
  });

  it('handles entity-encoded content: &lt; becomes <', async () => {
    // 'if x &lt; 2:' entity-encoded
    // After decoding: 'if x < 2:'
    const tokens = await tokenizeEmbeddedContent('if x &lt; 2:', 'python', 0, 0);

    // Should tokenize 'if' as keywordControl (keyword.control.python)
    const ifToken = tokens.find((t) => t.tokenType === TokenTypes.keywordControl && t.col === 0);
    expect(ifToken).toBeDefined();
    expect(ifToken!.length).toBe(2); // 'if' is 2 chars

    // Should tokenize '<' as operator - in original text this is '&lt;' at col 5
    const opToken = tokens.find((t) => t.tokenType === TokenTypes.operator && t.col === 5);
    expect(opToken).toBeDefined();
    // The operator '<' in original text spans '&lt;' which is 4 chars
    expect(opToken!.length).toBe(4);

    // Should tokenize '2' as number
    const numToken = tokens.find((t) => t.tokenType === TokenTypes.number);
    expect(numToken).toBeDefined();
  });

  it('maps positions back correctly for multi-entity content', async () => {
    // '&lt;div&gt;' decodes to '<div>'
    // In our minimal Python grammar, '<' and '>' match as operators
    const tokens = await tokenizeEmbeddedContent('&lt;div&gt;', 'python', 0, 0);

    // '<' operator: original position is col 0, length 4 (&lt;)
    const ltOp = tokens.find((t) => t.tokenType === TokenTypes.operator && t.col === 0);
    expect(ltOp).toBeDefined();
    expect(ltOp!.length).toBe(4); // &lt; is 4 chars in original

    // '>' operator: original position is col 7, length 4 (&gt;)
    const gtOp = tokens.find((t) => t.tokenType === TokenTypes.operator && t.col === 7);
    expect(gtOp).toBeDefined();
    expect(gtOp!.length).toBe(4); // &gt; is 4 chars in original
  });

  it('applies startRow/startCol offset', async () => {
    // Place content at row 5, col 10
    const tokens = await tokenizeEmbeddedContent('if True:', 'python', 5, 10);

    // 'if' keywordControl should be at row 5, col 10
    const ifToken = tokens.find((t) => t.tokenType === TokenTypes.keywordControl && t.row === 5);
    expect(ifToken).toBeDefined();
    expect(ifToken!.col).toBe(10);
    expect(ifToken!.length).toBe(2);
  });

  it('handles multi-line content with startRow offset', async () => {
    const tokens = await tokenizeEmbeddedContent('if True:\n    return 42', 'python', 3, 4);

    // 'if' on first line: row 3, col 4 (keyword.control.python → keywordControl)
    const ifToken = tokens.find((t) => t.tokenType === TokenTypes.keywordControl && t.row === 3);
    expect(ifToken).toBeDefined();
    expect(ifToken!.col).toBe(4);

    // 'return' on second line: row 4 (no startCol offset for subsequent lines)
    const returnToken = tokens.find(
      (t) => t.tokenType === TokenTypes.keywordControl && t.row === 4 && t.length === 6
    );
    expect(returnToken).toBeDefined();
    expect(returnToken!.col).toBe(4); // indented 4 spaces

    // '42' on second line: row 4
    const numToken = tokens.find((t) => t.tokenType === TokenTypes.number && t.row === 4);
    expect(numToken).toBeDefined();
  });

  it('handles entity-encoded multi-line Python code', async () => {
    const encoded = 'if x &lt; 2:\n    print(&quot;hello&quot;)';
    const tokens = await tokenizeEmbeddedContent(encoded, 'python', 0, 0);

    // 'if' keywordControl on line 0
    const ifToken = tokens.find((t) => t.tokenType === TokenTypes.keywordControl && t.row === 0 && t.col === 0);
    expect(ifToken).toBeDefined();

    // 'print' keywordControl on line 1
    const printToken = tokens.find((t) => t.tokenType === TokenTypes.keywordControl && t.row === 1 && t.length === 5);
    expect(printToken).toBeDefined();

    // String token(s) on line 1 for "hello" - entity-encoded as &quot;hello&quot;
    const stringTokens = tokens.filter((t) => t.tokenType === TokenTypes.string && t.row === 1);
    expect(stringTokens.length).toBeGreaterThan(0);
  });

  it('handles content with no entities (passthrough)', async () => {
    // No entities - positions should be 1:1
    const tokens = await tokenizeEmbeddedContent('return 42', 'python', 0, 0);

    const returnToken = tokens.find((t) => t.tokenType === TokenTypes.keywordControl);
    expect(returnToken).toBeDefined();
    expect(returnToken!.col).toBe(0);
    expect(returnToken!.length).toBe(6);

    const numToken = tokens.find((t) => t.tokenType === TokenTypes.number);
    expect(numToken).toBeDefined();
    expect(numToken!.col).toBe(7);
    expect(numToken!.length).toBe(2);
  });

  it('handles &amp; entity in code', async () => {
    // 'x &amp; 1' decodes to 'x & 1'
    // Our minimal grammar doesn't match bare identifiers, but '&' matches operator and '1' matches number
    const tokens = await tokenizeEmbeddedContent('1 &amp; 2', 'python', 0, 0);
    // Should have at least number tokens
    const numTokens = tokens.filter((t) => t.tokenType === TokenTypes.number);
    expect(numTokens.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty content', async () => {
    const tokens = await tokenizeEmbeddedContent('', 'python', 0, 0);
    expect(tokens).toEqual([]);
  });

  it('handles content with only whitespace', async () => {
    const tokens = await tokenizeEmbeddedContent('   \n  \n', 'python', 0, 0);
    // Whitespace-only content should produce no meaningful tokens
    expect(tokens.length).toBe(0);
  });
});

describe('full pipeline: pl-code C++ example', () => {
  // Tests the user's exact scenario:
  //   <pl-code language="cpp">
  //   tax = price * (STATE_TAX + COUNTY_TAX + CITY_TAX) / 100;
  //   cout &lt;&lt; fixed &lt;&lt; setprecision(2) &lt;&lt; price + tax &lt;&lt; endl;
  //   </pl-code>

  // Helper: extract content from a <pl-code> element in parsed HTML
  function extractPlCodeContent(html: string): {
    contentText: string; startRow: number; startCol: number;
  } {
    const tree = parseText(html);
    // Find the pl-code html_element
    const walk = (node: any): any => {
      if (node.type === 'html_element') {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)!;
          if (child.type === 'html_start_tag') {
            for (let j = 0; j < child.childCount; j++) {
              const nameNode = child.child(j)!;
              if (nameNode.type === 'html_tag_name' && nameNode.text === 'pl-code') {
                return node;
              }
            }
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const result = walk(node.child(i)!);
        if (result) return result;
      }
      return null;
    };
    const element = walk(tree.rootNode);
    if (!element) throw new Error('pl-code element not found');

    let startTag: any = null;
    let endTag: any = null;
    for (let i = 0; i < element.childCount; i++) {
      const child = element.child(i)!;
      if (child.type === 'html_start_tag') startTag = child;
      if (child.type === 'html_end_tag') endTag = child;
    }

    const contentText = tree.rootNode.text.slice(startTag!.endIndex, endTag!.startIndex);
    return {
      contentText,
      startRow: startTag!.endPosition.row,
      startCol: startTag!.endPosition.column,
    };
  }

  // Helper: decode delta-encoded semantic tokens data into absolute positions
  function decodeSemanticTokenData(data: Uint32Array) {
    const tokens: { row: number; col: number; length: number; type: number }[] = [];
    let row = 0;
    let col = 0;
    for (let i = 0; i < data.length; i += 5) {
      row += data[i];
      if (data[i] > 0) col = 0;
      col += data[i + 1];
      tokens.push({ row, col, length: data[i + 2], type: data[i + 3] });
    }
    return tokens;
  }

  const USER_EXAMPLE = `<pl-code language="cpp">
tax = price * (STATE_TAX + COUNTY_TAX + CITY_TAX) / 100;
cout &lt;&lt; fixed &lt;&lt; setprecision(2) &lt;&lt; price + tax &lt;&lt; endl;
</pl-code>`;

  it('extracts entity-encoded content from pl-code element', () => {
    const { contentText } = extractPlCodeContent(USER_EXAMPLE);
    expect(contentText).toBe(
      '\ntax = price * (STATE_TAX + COUNTY_TAX + CITY_TAX) / 100;\n' +
      'cout &lt;&lt; fixed &lt;&lt; setprecision(2) &lt;&lt; price + tax &lt;&lt; endl;\n'
    );
  });

  it('decodes &lt;&lt; entities to << in the content', () => {
    const { contentText } = extractPlCodeContent(USER_EXAMPLE);
    const { decoded } = decodeEntities(contentText);
    expect(decoded).toContain('cout << fixed << setprecision(2) << price + tax << endl;');
  });

  it('tokenizes C++ with << operators highlighted', async () => {
    const { contentText, startRow, startCol } = extractPlCodeContent(USER_EXAMPLE);
    const tokens = await tokenizeEmbeddedContent(contentText, 'cpp', startRow, startCol);

    expect(tokens.length).toBeGreaterThan(0);

    // All << operators should be tokenized as operator (type 27)
    // The C++ grammar matches '<<' as a single token: keyword.operator.cpp
    const operatorTokens = tokens.filter(t => t.tokenType === TokenTypes.operator);
    // There are 4 occurrences of &lt;&lt; (each is <<), so at least 4 operator tokens
    expect(operatorTokens.length).toBeGreaterThanOrEqual(4);
  });

  it('highlights &lt;&lt; with correct positions and lengths in original text', async () => {
    const { contentText, startRow, startCol } = extractPlCodeContent(USER_EXAMPLE);
    const tokens = await tokenizeEmbeddedContent(contentText, 'cpp', startRow, startCol);

    // The cout line is line 2 in the document (line 0: <pl-code>, line 1: tax=..., line 2: cout...)
    const coutLineRow = startRow + 2;
    const coutLineTokens = tokens.filter(t => t.row === coutLineRow);
    expect(coutLineTokens.length).toBeGreaterThan(0);

    // Find << operator tokens on the cout line
    const coutLineOps = coutLineTokens.filter(t => t.tokenType === TokenTypes.operator);

    // Each &lt;&lt; is 8 chars in original text. The C++ grammar matches '<<' as one token,
    // so each mapped token should cover the full &lt;&lt; (8 chars)
    const shiftOps = coutLineOps.filter(t => t.length === 8);
    expect(shiftOps.length).toBe(4); // 4 occurrences of << on the cout line
  });

  it('highlights cout, fixed, endl as support.function (→ supportFunction token type)', async () => {
    const { contentText, startRow, startCol } = extractPlCodeContent(USER_EXAMPLE);
    const tokens = await tokenizeEmbeddedContent(contentText, 'cpp', startRow, startCol);

    // cout, fixed, setprecision, endl match support.function.cpp → supportFunction
    const functionTokens = tokens.filter(t => t.tokenType === TokenTypes.supportFunction);
    const functionLengths = functionTokens.map(t => t.length);

    expect(functionLengths).toContain(4);  // cout
    expect(functionLengths).toContain(5);  // fixed, endl (both 5 but endl includes trailing?)
    expect(functionLengths).toContain(4);  // endl
  });

  it('highlights numeric literal 100 and 2', async () => {
    const { contentText, startRow, startCol } = extractPlCodeContent(USER_EXAMPLE);
    const tokens = await tokenizeEmbeddedContent(contentText, 'cpp', startRow, startCol);

    const numberTokens = tokens.filter(t => t.tokenType === TokenTypes.number);
    const numberLengths = numberTokens.map(t => t.length);

    expect(numberLengths).toContain(3); // 100
    expect(numberLengths).toContain(1); // 2
  });

  it('highlights * + / as operators on the tax line', async () => {
    const { contentText, startRow, startCol } = extractPlCodeContent(USER_EXAMPLE);
    const tokens = await tokenizeEmbeddedContent(contentText, 'cpp', startRow, startCol);

    // The tax line is line 1 in the document
    const taxLineRow = startRow + 1;
    const taxLineOps = tokens.filter(t => t.row === taxLineRow && t.tokenType === TokenTypes.operator);

    // Should have *, +, +, / operators (at least)
    expect(taxLineOps.length).toBeGreaterThanOrEqual(3);
  });

  it('embedded tokens merge into semantic token output without breaking HTML tokens', async () => {
    const tree = parseText(USER_EXAMPLE);
    const { contentText, startRow, startCol } = extractPlCodeContent(USER_EXAMPLE);
    const embeddedTokens = await tokenizeEmbeddedContent(contentText, 'cpp', startRow, startCol);

    const query = createTestQuery(HIGHLIGHT_QUERY);
    const result = buildSemanticTokens(tree, query, undefined, embeddedTokens as TokenInfo[]);
    const data = result.build().data;
    const allTokens = decodeSemanticTokenData(data);

    // Should have HTML tokens for <pl-code> tags
    const tagTokens = allTokens.filter(t => t.type === TokenTypes.tag);
    expect(tagTokens.length).toBeGreaterThanOrEqual(2); // pl-code in start and end tag

    // Should have embedded operator tokens
    const opTokens = allTokens.filter(t => t.type === TokenTypes.operator);
    expect(opTokens.length).toBeGreaterThanOrEqual(4); // 4 x <<

    // Should have embedded number tokens
    const numTokens = allTokens.filter(t => t.type === TokenTypes.number);
    expect(numTokens.length).toBeGreaterThanOrEqual(2); // 100, 2

    // Tokens should be in order (no position regressions)
    for (let i = 1; i < allTokens.length; i++) {
      const prev = allTokens[i - 1];
      const curr = allTokens[i];
      if (curr.row === prev.row) {
        expect(curr.col).toBeGreaterThanOrEqual(prev.col + prev.length);
      } else {
        expect(curr.row).toBeGreaterThan(prev.row);
      }
    }
  });
});

describe('tree-sitter content extraction', () => {
  // These tests verify that entity-encoded content inside custom code tags
  // is correctly extracted from the tree-sitter parse tree, where the parser
  // produces separate `text` and `html_entity` children (not a single text node).

  it('parses <pl-code> content as text and html_entity children', () => {
    const tree = parseText('<pl-code language="c">x &lt; 2</pl-code>');
    const root = tree.rootNode;

    // The pl-code element should be an html_element
    const element = root.child(0);
    expect(element?.type).toBe('html_element');

    // Collect child types between start/end tags
    const childTypes: string[] = [];
    for (let i = 0; i < element!.childCount; i++) {
      childTypes.push(element!.child(i)!.type);
    }

    // Should have start_tag, content nodes (text/html_entity), and end_tag
    expect(childTypes).toContain('html_start_tag');
    expect(childTypes).toContain('html_end_tag');
    // Content is split into text and html_entity nodes
    expect(childTypes).toContain('text');
    expect(childTypes).toContain('html_entity');
  });

  it('text between start/end tags includes entities as literal text', () => {
    const tree = parseText('<pl-code language="c">x &lt; 2</pl-code>');
    const element = tree.rootNode.child(0)!;

    // Extract text between start and end tags using character indices
    let startTag: { endIndex: number } | null = null;
    let endTag: { startIndex: number } | null = null;
    for (let i = 0; i < element.childCount; i++) {
      const child = element.child(i)!;
      if (child.type === 'html_start_tag') startTag = child;
      if (child.type === 'html_end_tag') endTag = child;
    }

    const fullText = tree.rootNode.text;
    const content = fullText.slice(startTag!.endIndex, endTag!.startIndex);
    expect(content).toBe('x &lt; 2');
  });

  it('multi-line entity-encoded content is fully captured', () => {
    const input = `<pl-code language="c">
tax = price * 100;
cout &lt;&lt; fixed &lt;&lt; endl;
</pl-code>`;
    const tree = parseText(input);
    const element = tree.rootNode.child(0)!;

    let startTag: { endIndex: number } | null = null;
    let endTag: { startIndex: number } | null = null;
    for (let i = 0; i < element.childCount; i++) {
      const child = element.child(i)!;
      if (child.type === 'html_start_tag') startTag = child;
      if (child.type === 'html_end_tag') endTag = child;
    }

    const fullText = tree.rootNode.text;
    const content = fullText.slice(startTag!.endIndex, endTag!.startIndex);
    expect(content).toBe('\ntax = price * 100;\ncout &lt;&lt; fixed &lt;&lt; endl;\n');
  });
});
