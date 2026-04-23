import { describe, it, expect } from 'vitest';
import { parseText } from './setup.js';
import { parseSelector, matchSelector, preprocessMustacheLiterals } from '../../../src/core/selectorMatcher.js';

// --- Preprocessor tests ---

describe('preprocessMustacheLiterals', () => {
  it('substitutes {{foo}} to :m-variable(foo)', () => {
    expect(preprocessMustacheLiterals('{{foo}}')).toBe(':m-variable(foo)');
  });

  it('substitutes {{data.foo}} preserving dots', () => {
    expect(preprocessMustacheLiterals('{{data.foo}}')).toBe(':m-variable(data.foo)');
  });

  it('substitutes {{{foo}}} to :m-raw(foo)', () => {
    expect(preprocessMustacheLiterals('{{{foo}}}')).toBe(':m-raw(foo)');
  });

  it('substitutes {{#foo}} to :m-section(foo)', () => {
    expect(preprocessMustacheLiterals('{{#items}}')).toBe(':m-section(items)');
  });

  it('substitutes {{^foo}} to :m-inverted(foo)', () => {
    expect(preprocessMustacheLiterals('{{^items}}')).toBe(':m-inverted(items)');
  });

  it('substitutes {{!foo}} to :m-comment(foo)', () => {
    expect(preprocessMustacheLiterals('{{!TODO}}')).toBe(':m-comment(TODO)');
  });

  it('substitutes {{>foo}} to :m-partial(foo)', () => {
    expect(preprocessMustacheLiterals('{{>header}}')).toBe(':m-partial(header)');
  });

  it('trims whitespace in argument', () => {
    expect(preprocessMustacheLiterals('{{  foo  }}')).toBe(':m-variable(foo)');
    expect(preprocessMustacheLiterals('{{# items }}')).toBe(':m-section(items)');
  });

  it('preserves content inside quoted strings', () => {
    expect(preprocessMustacheLiterals('[src="{{foo}}"]')).toBe('[src="{{foo}}"]');
    expect(preprocessMustacheLiterals("[src='{{foo}}']")).toBe("[src='{{foo}}']");
  });

  it('still substitutes outside of quoted strings', () => {
    expect(preprocessMustacheLiterals('{{#items}} [src="{{foo}}"] {{bar}}'))
      .toBe(':m-section(items) [src="{{foo}}"] :m-variable(bar)');
  });

  it('rejects {{/end}} (standalone end tag)', () => {
    expect(preprocessMustacheLiterals('{{/items}}')).toBeNull();
  });

  it('rejects {{= = =}} (delimiter change)', () => {
    expect(preprocessMustacheLiterals('{{=<% %>=}}')).toBeNull();
  });

  it('rejects unterminated {{', () => {
    expect(preprocessMustacheLiterals('{{foo')).toBeNull();
  });

  it('rejects unterminated {{{', () => {
    expect(preprocessMustacheLiterals('{{{foo')).toBeNull();
  });

  it('rejects empty {{}}', () => {
    expect(preprocessMustacheLiterals('{{}}')).toBeNull();
  });

  it('passes through a plain HTML-only selector unchanged', () => {
    expect(preprocessMustacheLiterals('div > span.foo[bar=baz]')).toBe('div > span.foo[bar=baz]');
  });
});

// --- Parsing tests ---

describe('parseSelector', () => {
  it('parses a single HTML tag', () => {
    const result = parseSelector('div');
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect(result![0]).toHaveLength(1);
    expect(result![0][0]).toMatchObject({
      kind: 'html',
      name: 'div',
      combinator: 'descendant',
    });
  });

  it('parses {{#items}} as section', () => {
    const seg = parseSelector('{{#items}}')![0][0];
    expect(seg).toMatchObject({ kind: 'section', name: 'items' });
  });

  it('parses {{^items}} as inverted section', () => {
    const seg = parseSelector('{{^items}}')![0][0];
    expect(seg).toMatchObject({ kind: 'inverted', name: 'items' });
  });

  it('parses {{foo}} as variable', () => {
    const seg = parseSelector('{{foo}}')![0][0];
    expect(seg).toMatchObject({ kind: 'variable', name: 'foo' });
  });

  it('parses {{data.foo}} as variable with dotted path', () => {
    const seg = parseSelector('{{data.foo}}')![0][0];
    expect(seg).toMatchObject({ kind: 'variable', name: 'data.foo' });
  });

  it('parses {{{foo}}} as raw', () => {
    const seg = parseSelector('{{{foo}}}')![0][0];
    expect(seg).toMatchObject({ kind: 'raw', name: 'foo' });
  });

  it('parses {{!TODO}} as comment', () => {
    const seg = parseSelector('{{!TODO}}')![0][0];
    expect(seg).toMatchObject({ kind: 'comment', name: 'todo' });
  });

  it('parses {{>header}} as partial', () => {
    const seg = parseSelector('{{>header}}')![0][0];
    expect(seg).toMatchObject({ kind: 'partial', name: 'header' });
  });

  it('parses * as wildcard HTML element', () => {
    const seg = parseSelector('*')![0][0];
    expect(seg).toMatchObject({ kind: 'html', name: null });
  });

  it('parses descendant combinator', () => {
    const segs = parseSelector('div span')![0];
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: 'html', name: 'div', combinator: 'descendant' });
    expect(segs[1]).toMatchObject({ kind: 'html', name: 'span', combinator: 'descendant' });
  });

  it('parses child combinator', () => {
    const segs = parseSelector('div > span')![0];
    expect(segs[1]).toMatchObject({ kind: 'html', name: 'span', combinator: 'child' });
  });

  it('parses mixed HTML and mustache', () => {
    const segs = parseSelector('{{#items}} > div span')![0];
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ kind: 'section', name: 'items' });
    expect(segs[1]).toMatchObject({ kind: 'html', name: 'div', combinator: 'child' });
    expect(segs[2]).toMatchObject({ kind: 'html', name: 'span', combinator: 'descendant' });
  });

  it('parses glob: prefix {{options.*}}', () => {
    const seg = parseSelector('{{options.*}}')![0][0];
    expect(seg.kind).toBe('variable');
    expect(seg.name).toBe('options.*');
    expect(seg.pathRegex).toBeInstanceOf(RegExp);
    expect(seg.pathRegex!.test('options.foo')).toBe(true);
    expect(seg.pathRegex!.test('data.foo')).toBe(false);
  });

  it('parses glob: suffix {{*.deprecated}}', () => {
    const seg = parseSelector('{{*.deprecated}}')![0][0];
    expect(seg.pathRegex!.test('foo.deprecated')).toBe(true);
    expect(seg.pathRegex!.test('foo.bar')).toBe(false);
  });

  it('parses bare {{*}} as wildcard variable', () => {
    const seg = parseSelector('{{*}}')![0][0];
    expect(seg).toMatchObject({ kind: 'variable', name: null });
    expect(seg.pathRegex).toBeUndefined();
  });

  it('parses bare {{{*}}} as wildcard raw', () => {
    const seg = parseSelector('{{{*}}}')![0][0];
    expect(seg).toMatchObject({ kind: 'raw', name: null });
  });

  it('parses [attr]', () => {
    const seg = parseSelector('img[alt]')![0][0];
    expect(seg.attributes).toHaveLength(1);
    expect(seg.attributes[0]).toMatchObject({ name: 'alt', negated: false });
    expect(seg.attributes[0].value).toBeUndefined();
  });

  it('parses [attr=value]', () => {
    const seg = parseSelector('input[type=hidden]')![0][0];
    expect(seg.attributes[0]).toMatchObject({ name: 'type', op: '=', value: 'hidden' });
  });

  it('parses [attr^=value]', () => {
    const seg = parseSelector('img[src^="clientFilesQuestion/"]')![0][0];
    expect(seg.attributes[0]).toMatchObject({ name: 'src', op: '^=', value: 'clientFilesQuestion/' });
  });

  it('parses .class as synthetic [class~=value]', () => {
    const seg = parseSelector('div.panel')![0][0];
    expect(seg.attributes[0]).toMatchObject({ name: 'class', op: '~=', value: 'panel' });
  });

  it('parses #id as synthetic [id=value]', () => {
    const seg = parseSelector('#main')![0][0];
    expect(seg.attributes[0]).toMatchObject({ name: 'id', op: '=', value: 'main' });
  });

  it('parses :not([attr])', () => {
    const seg = parseSelector('img:not([alt])')![0][0];
    expect(seg.attributes[0]).toMatchObject({ name: 'alt', negated: true });
  });

  it('parses :has()', () => {
    const seg = parseSelector('pl-multiple-choice:has(pl-answer)')![0][0];
    expect(seg.descendantChecks).toHaveLength(1);
    expect(seg.descendantChecks[0].selector[0][0]).toMatchObject({ kind: 'html', name: 'pl-answer' });
  });

  it('parses :has({{foo}})', () => {
    const seg = parseSelector('div:has({{foo}})')![0][0];
    expect(seg.descendantChecks[0].selector[0][0]).toMatchObject({ kind: 'variable', name: 'foo' });
  });

  it('parses comma list', () => {
    const result = parseSelector('div, {{foo}}')!;
    expect(result).toHaveLength(2);
    expect(result[0][0]).toMatchObject({ kind: 'html', name: 'div' });
    expect(result[1][0]).toMatchObject({ kind: 'variable', name: 'foo' });
  });

  it('parses :is(a, b) into alternatives', () => {
    const result = parseSelector(':is(div, span)')!;
    expect(result).toHaveLength(2);
    expect(result[0][0]).toMatchObject({ kind: 'html', name: 'div' });
    expect(result[1][0]).toMatchObject({ kind: 'html', name: 'span' });
  });

  it('parses :is with descendant combinator into Cartesian product', () => {
    const result = parseSelector(':is(a, b) :is(c, d)')!;
    expect(result).toHaveLength(4);
    expect(result.map(r => [r[0].name, r[1].name])).toEqual([
      ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'],
    ]);
  });

  it('parses :is mixed with tag in compound (div:is(.foo, .bar))', () => {
    const result = parseSelector('div:is(.foo, .bar)')!;
    expect(result).toHaveLength(2);
    expect(result[0][0]).toMatchObject({ kind: 'html', name: 'div' });
    expect(result[0][0].attributes).toHaveLength(1);
    expect(result[0][0].attributes[0]).toMatchObject({ name: 'class', value: 'foo' });
    expect(result[1][0].attributes[0]).toMatchObject({ name: 'class', value: 'bar' });
  });

  it('parses nested :is', () => {
    const result = parseSelector(':is(:is(a, b), c)')!;
    expect(result).toHaveLength(3);
    expect(result.map(r => r[0].name)).toEqual(['a', 'b', 'c']);
  });

  it('parses :is with Mustache literals', () => {
    const result = parseSelector(':is({{foo}}, {{bar}})')!;
    expect(result).toHaveLength(2);
    expect(result[0][0]).toMatchObject({ kind: 'variable', name: 'foo' });
    expect(result[1][0]).toMatchObject({ kind: 'variable', name: 'bar' });
  });

  it('returns null for :is(a b) mixed with other tokens in compound', () => {
    // A combinator-bearing alternative can't be merged into a larger compound.
    expect(parseSelector('div:is(a b, c)')).toBeNull();
  });

  it('allows :is with combinator when it is the only compound token', () => {
    const result = parseSelector(':is(a b, c)')!;
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(2); // a b → two segments
    expect(result[1]).toHaveLength(1); // c → one segment
  });

  it('returns null for empty string', () => {
    expect(parseSelector('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(parseSelector('   ')).toBeNull();
  });

  it('parses adjacent sibling (+)', () => {
    const segs = parseSelector('div + span')!;
    expect(segs[0]).toHaveLength(2);
    expect(segs[0][1]).toMatchObject({ kind: 'html', name: 'span', combinator: 'adjacent-sibling' });
  });

  it('parses general sibling (~)', () => {
    const segs = parseSelector('h2 ~ p')!;
    expect(segs[0][1]).toMatchObject({ kind: 'html', name: 'p', combinator: 'general-sibling' });
  });

  it('parses mixed descendant + sibling combinators', () => {
    const segs = parseSelector('section label + input')!;
    expect(segs[0]).toHaveLength(3);
    expect(segs[0][1].combinator).toBe('descendant');
    expect(segs[0][2].combinator).toBe('adjacent-sibling');
  });

  it('parses :not with Mustache literal into a self-negation', () => {
    const seg = parseSelector('{{*}}:not({{internal.*}})')![0][0];
    expect(seg.kind).toBe('variable');
    expect(seg.selfNegations).toHaveLength(1);
    expect(seg.selfNegations[0][0][0]).toMatchObject({ kind: 'variable', name: 'internal.*' });
  });

  it('parses :not with type selector into a self-negation', () => {
    const seg = parseSelector(':not(div)')![0][0];
    expect(seg.selfNegations).toHaveLength(1);
    expect(seg.selfNegations[0][0][0]).toMatchObject({ kind: 'html', name: 'div' });
  });

  it('keeps :not([attr]) on attributes (not selfNegations)', () => {
    const seg = parseSelector('img:not([alt])')![0][0];
    expect(seg.attributes[0]).toMatchObject({ name: 'alt', negated: true });
    expect(seg.selfNegations).toHaveLength(0);
  });

  it('returns null for unsupported [attr|=v]', () => {
    expect(parseSelector('a[lang|="en"]')).toBeNull();
  });

  it('returns null for mixed html + mustache compound', () => {
    // `div{{foo}}` — parsel parses as compound [type, pseudo-class(:m-variable(foo))],
    // and we reject mixed kinds.
    expect(parseSelector('div{{foo}}')).toBeNull();
  });

  it('returns null for mixed mustache kinds compound', () => {
    expect(parseSelector('{{#items}}{{foo}}')).toBeNull();
  });

  it('returns null for {{/end}}', () => {
    expect(parseSelector('{{/items}}')).toBeNull();
  });

  it('returns null for {{=<% %>=}}', () => {
    expect(parseSelector('{{=<% %>=}}')).toBeNull();
  });

  it('returns null for unterminated {{', () => {
    expect(parseSelector('{{foo')).toBeNull();
  });
});

// --- Matching tests ---

describe('matchSelector', () => {
  it('matches a simple tag', () => {
    const tree = parseText('<div></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('div')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('html_start_tag');
  });

  it('matches descendant at any depth', () => {
    const tree = parseText('<div><p><span></span></p></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('div span')!);
    expect(matches).toHaveLength(1);
  });

  it('matches direct child', () => {
    const tree = parseText('<div><span></span></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('div > span')!);
    expect(matches).toHaveLength(1);
  });

  it('does not match indirect child with >', () => {
    const tree = parseText('<div><p><span></span></p></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('div > span')!);
    expect(matches).toHaveLength(0);
  });

  it(':is at both ends matches Cartesian product of descendants', () => {
    const tree = parseText('<section><b></b></section><aside><i></i></aside>');
    const matches = matchSelector(
      tree.rootNode,
      parseSelector(':is(section, aside) :is(b, i)')!,
    );
    expect(matches).toHaveLength(2);
  });

  // --- Sibling combinators ---

  it('matches adjacent sibling a + b', () => {
    const tree = parseText('<a></a><b></b>');
    const matches = matchSelector(tree.rootNode, parseSelector('a + b')!);
    expect(matches).toHaveLength(1);
  });

  it('adjacent sibling skips whitespace between siblings', () => {
    const tree = parseText('<a></a>\n  <b></b>');
    const matches = matchSelector(tree.rootNode, parseSelector('a + b')!);
    expect(matches).toHaveLength(1);
  });

  it('adjacent sibling does not match when another element is between', () => {
    const tree = parseText('<a></a><i></i><b></b>');
    const matches = matchSelector(tree.rootNode, parseSelector('a + b')!);
    expect(matches).toHaveLength(0);
  });

  it('general sibling matches when another element is between', () => {
    const tree = parseText('<a></a><i></i><b></b>');
    const matches = matchSelector(tree.rootNode, parseSelector('a ~ b')!);
    expect(matches).toHaveLength(1);
  });

  it('general sibling matches multiple following siblings', () => {
    const tree = parseText('<h2></h2><p></p><p></p>');
    const matches = matchSelector(tree.rootNode, parseSelector('h2 ~ p')!);
    expect(matches).toHaveLength(2);
  });

  it('sibling combinator only considers siblings in the same parent', () => {
    // <a> in one div, <b> in another — not siblings.
    const tree = parseText('<div><a></a></div><div><b></b></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('a + b')!);
    expect(matches).toHaveLength(0);
  });

  it('mixed descendant + sibling: section a + b', () => {
    const tree = parseText('<section><a></a><b></b></section><a></a><b></b>');
    // Only the pair inside <section> should match.
    const matches = matchSelector(tree.rootNode, parseSelector('section a + b')!);
    expect(matches).toHaveLength(1);
  });

  it('Mustache variable + element sibling', () => {
    const tree = parseText('<div>{{foo}}<p></p></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{foo}} + p')!);
    expect(matches).toHaveLength(1);
  });

  it('element ~ mustache variable', () => {
    const tree = parseText('<div><h2></h2><p></p>{{foo}}</div>');
    const matches = matchSelector(tree.rootNode, parseSelector('h2 ~ {{foo}}')!);
    expect(matches).toHaveLength(1);
  });

  it('mustache section + mustache section', () => {
    const tree = parseText('<div>{{#a}}x{{/a}}\n  {{#b}}y{{/b}}</div>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#a}} + {{#b}}')!);
    expect(matches).toHaveLength(1);
  });

  it('mustache section + mustache interpolation', () => {
    const tree = parseText('<div>{{#items}}x{{/items}}{{foo}}</div>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#items}} + {{foo}}')!);
    expect(matches).toHaveLength(1);
  });

  it('mustache comment ~ partial', () => {
    const tree = parseText('<div>{{!note}}<p></p>{{>header}}</div>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{!note}} ~ {{>header}}')!);
    expect(matches).toHaveLength(1);
  });

  it('element + mustache section (across whitespace)', () => {
    const tree = parseText('<ul>\n  <li></li>\n  {{#items}}<li></li>{{/items}}\n</ul>');
    const matches = matchSelector(tree.rootNode, parseSelector('li + {{#items}}')!);
    expect(matches).toHaveLength(1);
  });

  // --- :not with Mustache / type selector ---

  it('selfNegation filters out matching mustache variables', () => {
    const tree = parseText('{{public.name}}{{internal.secret}}{{regular}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{*}}:not({{internal.*}})')!);
    // {{public.name}} and {{regular}} match; {{internal.secret}} is excluded.
    expect(matches).toHaveLength(2);
  });

  it(':not(div) excludes div elements', () => {
    const tree = parseText('<div></div><span></span><p></p>');
    const matches = matchSelector(tree.rootNode, parseSelector(':not(div)')!);
    // All element-like matches except <div>. With implicit html kind.
    const names = matches.map(m => m.text.match(/<(\w+)/)?.[1]).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(['span', 'p']));
    expect(names).not.toContain('div');
  });

  // --- :has containing a sibling combinator (uses threaded sibling info) ---

  it(':has(a + b) sees top-level sibling pairs of the element', () => {
    const tree = parseText('<section><a></a><b></b></section>');
    const matches = matchSelector(tree.rootNode, parseSelector('section:has(a + b)')!);
    expect(matches).toHaveLength(1);
  });

  // --- Mustache section ---

  it('{{#items}} matches positive section', () => {
    const tree = parseText('{{#items}}<li></li>{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#items}}')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('mustache_section_begin');
  });

  it('{{#items}} does NOT match an inverted section', () => {
    const tree = parseText('{{^items}}empty{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#items}}')!);
    expect(matches).toHaveLength(0);
  });

  it('{{^items}} matches inverted section only', () => {
    const tree = parseText('{{#items}}a{{/items}}{{^items}}b{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{^items}}')!);
    expect(matches).toHaveLength(1);
  });

  it('{{#items}} li matches li inside positive section', () => {
    const tree = parseText('{{#items}}<li></li>{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#items}} li')!);
    expect(matches).toHaveLength(1);
  });

  it('{{#items}} > li does NOT cross an inverted section', () => {
    const tree = parseText('{{^items}}<li></li>{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#items}} > li')!);
    expect(matches).toHaveLength(0);
  });

  it('{{#a}} > {{#b}} matches cross-kind with child combinator', () => {
    const tree = parseText('{{#a}}<div>{{#b}}inner{{/b}}</div>{{/a}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#a}} > {{#b}}')!);
    expect(matches).toHaveLength(1);
  });

  // --- Mustache variable / raw ---

  it('{{data.foo}} matches exact escaped variable', () => {
    const tree = parseText('<p>{{data.foo}} {{data.bar}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{data.foo}}')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('{{data.foo}}');
  });

  it('{{foo}} does NOT match {{{foo}}}', () => {
    const tree = parseText('<p>{{foo}} {{{foo}}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{foo}}')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('{{foo}}');
  });

  it('{{{foo}}} matches only triple', () => {
    const tree = parseText('<p>{{foo}} {{{foo}}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{{foo}}}')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('{{{foo}}}');
  });

  it('{{*}} matches any escaped variable but not triples', () => {
    const tree = parseText('<p>{{a}} {{b.c}} {{{raw}}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{*}}')!);
    expect(matches).toHaveLength(2);
  });

  it('{{{*}}} matches any triple', () => {
    const tree = parseText('<p>{{a}} {{{x}}} {{{y}}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{{*}}}')!);
    expect(matches).toHaveLength(2);
  });

  it('{{options.*}} matches prefix', () => {
    const tree = parseText('<p>{{options.a}} {{options.b.c}} {{data.x}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{options.*}}')!);
    expect(matches).toHaveLength(2);
  });

  it('{{*.deprecated}} matches suffix', () => {
    const tree = parseText('<p>{{foo.deprecated}} {{bar.deprecated}} {{foo.other}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{*.deprecated}}')!);
    expect(matches).toHaveLength(2);
  });

  it('variable inside attribute value is matched', () => {
    const tree = parseText('<img src="{{url}}" alt="{{desc}}">');
    const matches = matchSelector(tree.rootNode, parseSelector('{{*}}')!);
    expect(matches).toHaveLength(2);
  });

  it('{{.}} matches context-marker interpolation', () => {
    const tree = parseText('{{#items}}{{.}}{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{.}}')!);
    expect(matches).toHaveLength(1);
  });

  // --- Mustache comment ---

  it('{{!*}} matches any comment', () => {
    const tree = parseText('<p>{{!a}} {{!b}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{!*}}')!);
    expect(matches).toHaveLength(2);
  });

  it('{{!TODO}} matches exact comment content', () => {
    const tree = parseText('<p>{{!TODO}} {{!other}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{!TODO}}')!);
    expect(matches).toHaveLength(1);
  });

  it('{{!*TODO*}} matches comments containing TODO', () => {
    const tree = parseText('<p>{{!TODO fix}} {{!nothing here}} {{!this is a TODO note}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{!*TODO*}}')!);
    expect(matches).toHaveLength(2);
  });

  // --- Mustache partial ---

  it('{{>header}} matches exact partial by name', () => {
    const tree = parseText('<p>{{>header}} {{>footer}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{>header}}')!);
    expect(matches).toHaveLength(1);
  });

  it('{{>legacy_*}} matches partials with prefix', () => {
    const tree = parseText('<p>{{>legacy_a}} {{>legacy_b}} {{>modern}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{>legacy_*}}')!);
    expect(matches).toHaveLength(2);
  });

  // --- Attribute operator tests (regression) ---

  it('[src^=prefix] still works', () => {
    const tree = parseText('<img src="foo/a.png"><img src="bar/b.png">');
    const matches = matchSelector(tree.rootNode, parseSelector('img[src^="foo/"]')!);
    expect(matches).toHaveLength(1);
  });

  it('.class still works', () => {
    const tree = parseText('<div class="a b"></div><div class="c"></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('.a')!);
    expect(matches).toHaveLength(1);
  });

  it('#id still works', () => {
    const tree = parseText('<section id="main"></section><section></section>');
    const matches = matchSelector(tree.rootNode, parseSelector('#main')!);
    expect(matches).toHaveLength(1);
  });

  // --- :has() ---

  it('pl-multiple-choice:has({{foo}}) flags only those with a variable descendant', () => {
    const tree = parseText(
      '<pl-multiple-choice id="has"><p>{{foo}}</p></pl-multiple-choice>' +
      '<pl-multiple-choice id="no"><p>text</p></pl-multiple-choice>',
    );
    const matches = matchSelector(tree.rootNode, parseSelector('pl-multiple-choice:has({{*}})')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toContain('id="has"');
  });

  it(':not(:has({{foo}})) flags elements missing a required variable', () => {
    const tree = parseText(
      '<pl-multiple-choice id="has">{{foo}}</pl-multiple-choice>' +
      '<pl-multiple-choice id="no"></pl-multiple-choice>',
    );
    const matches = matchSelector(tree.rootNode, parseSelector('pl-multiple-choice:not(:has({{*}}))')!);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toContain('id="no"');
  });

  // --- Chained :not() AND ---

  it('chained :not() AND together (EDC rule shape)', () => {
    const tree = parseText(
      '<pl-checkbox></pl-checkbox>' +
      '<pl-checkbox partial-credit-method="EDC"></pl-checkbox>' +
      '<pl-checkbox partial-credit="each-answer"></pl-checkbox>' +
      '<pl-checkbox partial-credit-method="COV"></pl-checkbox>',
    );
    const matches = matchSelector(
      tree.rootNode,
      parseSelector('pl-checkbox:not([partial-credit-method=EDC]):not([partial-credit=each-answer])')!,
    );
    expect(matches).toHaveLength(2);
  });

  // --- Reporting ---

  it('reports html_start_tag for HTML matches', () => {
    const tree = parseText('<div></div>');
    const matches = matchSelector(tree.rootNode, parseSelector('div')!);
    expect(matches[0].type).toBe('html_start_tag');
  });

  it('reports mustache_section_begin for section matches', () => {
    const tree = parseText('{{#items}}content{{/items}}');
    const matches = matchSelector(tree.rootNode, parseSelector('{{#items}}')!);
    expect(matches[0].type).toBe('mustache_section_begin');
  });

  it('reports mustache_interpolation node for variable matches', () => {
    const tree = parseText('<p>{{foo}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{foo}}')!);
    expect(matches[0].type).toBe('mustache_interpolation');
  });

  it('reports mustache_triple node for raw matches', () => {
    const tree = parseText('<p>{{{foo}}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{{foo}}}')!);
    expect(matches[0].type).toBe('mustache_triple');
  });

  it('reports mustache_comment node for comment matches', () => {
    const tree = parseText('<p>{{!note}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{!*}}')!);
    expect(matches[0].type).toBe('mustache_comment');
  });

  it('reports mustache_partial node for partial matches', () => {
    const tree = parseText('<p>{{>header}}</p>');
    const matches = matchSelector(tree.rootNode, parseSelector('{{>header}}')!);
    expect(matches[0].type).toBe('mustache_partial');
  });

  // --- :root ---

  it(':root matches exactly one node (the document root)', () => {
    const tree = parseText('<div><p></p></div>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root')!);
    expect(matches).toHaveLength(1);
  });

  it(':root:has(X) matches when X is a direct child', () => {
    const tree = parseText('<pl-answer-panel></pl-answer-panel>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root:has(pl-answer-panel)')!);
    expect(matches).toHaveLength(1);
  });

  it(':root:has(X) matches when X is deeply nested', () => {
    const tree = parseText(
      '<div><section><article><pl-answer-panel></pl-answer-panel></article></section></div>',
    );
    const matches = matchSelector(tree.rootNode, parseSelector(':root:has(pl-answer-panel)')!);
    expect(matches).toHaveLength(1);
  });

  it(':root:has(X) does not match when X is absent', () => {
    const tree = parseText('<div><p></p></div>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root:has(pl-answer-panel)')!);
    expect(matches).toHaveLength(0);
  });

  it(':root:not(:has(X)) matches when X is absent', () => {
    const tree = parseText('<div><p></p></div>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root:not(:has(pl-answer-panel))')!);
    expect(matches).toHaveLength(1);
  });

  it(':root:not(:has(X)) does not match when X is present (deeply nested)', () => {
    const tree = parseText(
      '<div><section><pl-answer-panel></pl-answer-panel></section></div>',
    );
    const matches = matchSelector(tree.rootNode, parseSelector(':root:not(:has(pl-answer-panel))')!);
    expect(matches).toHaveLength(0);
  });

  it(':root:has(A):not(:has(B)) matches when A present and B absent', () => {
    const tree = parseText(
      '<div><pl-question-panel>q</pl-question-panel></div>',
    );
    const matches = matchSelector(
      tree.rootNode,
      parseSelector(':root:has(pl-question-panel):not(:has(pl-answer-panel))')!,
    );
    expect(matches).toHaveLength(1);
  });

  it(':root:has(A):not(:has(B)) does not match when B is present', () => {
    const tree = parseText(
      '<pl-question-panel>q</pl-question-panel><pl-answer-panel>a</pl-answer-panel>',
    );
    const matches = matchSelector(
      tree.rootNode,
      parseSelector(':root:has(pl-question-panel):not(:has(pl-answer-panel))')!,
    );
    expect(matches).toHaveLength(0);
  });

  it(':root:has(A):not(:has(B)) does not match when A is absent', () => {
    const tree = parseText('<div></div>');
    const matches = matchSelector(
      tree.rootNode,
      parseSelector(':root:has(pl-question-panel):not(:has(pl-answer-panel))')!,
    );
    expect(matches).toHaveLength(0);
  });

  it(':root X descendant matches any X under the document', () => {
    const tree = parseText('<div><section><span></span></section></div>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root span')!);
    expect(matches).toHaveLength(1);
  });

  it(':root > X child matches only top-level X', () => {
    const tree = parseText('<div><span></span></div><span></span>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root > span')!);
    expect(matches).toHaveLength(1);
  });

  it(':root > X does not match nested X', () => {
    const tree = parseText('<div><span></span></div>');
    const matches = matchSelector(tree.rootNode, parseSelector(':root > span')!);
    expect(matches).toHaveLength(0);
  });

  it(':root.foo is rejected (parse returns null)', () => {
    expect(parseSelector(':root.foo')).toBeNull();
  });

  it(':root[attr] is rejected (parse returns null)', () => {
    expect(parseSelector(':root[lang]')).toBeNull();
  });

  it(':rootFoo is rejected (parse returns null)', () => {
    expect(parseSelector('div:rootfoo')).toBeNull();
  });

  it(':root reports a narrowed range (not the whole document)', () => {
    const tree = parseText('<pl-question-panel>\n  hello\n</pl-question-panel>');
    const matches = matchSelector(
      tree.rootNode,
      parseSelector(':root:has(pl-question-panel)')!,
    );
    expect(matches).toHaveLength(1);
    const m = matches[0];
    expect(m.startPosition).toEqual({ row: 0, column: 0 });
    expect(m.endPosition).toEqual({ row: 0, column: 1 });
  });
});
