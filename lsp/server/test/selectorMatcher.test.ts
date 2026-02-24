import { describe, it, expect } from 'vitest';
import { parseText } from './setup';
import { parseSelector, matchSelector } from '../src/selectorMatcher';

// --- Parsing tests ---

describe('parseSelector', () => {
  it('parses a single HTML tag', () => {
    const result = parseSelector('div');
    expect(result).not.toBeNull();
    expect(result!.alternatives).toHaveLength(1);
    expect(result!.alternatives[0].segments).toHaveLength(1);
    expect(result!.alternatives[0].segments[0]).toMatchObject({
      kind: 'html',
      name: 'div',
      combinator: 'descendant',
    });
  });

  it('parses a mustache section #name', () => {
    const result = parseSelector('#items');
    expect(result).not.toBeNull();
    expect(result!.alternatives[0].segments[0]).toMatchObject({
      kind: 'mustache',
      name: 'items',
    });
  });

  it('parses bare # as wildcard mustache section', () => {
    const result = parseSelector('#');
    expect(result).not.toBeNull();
    expect(result!.alternatives[0].segments[0]).toMatchObject({
      kind: 'mustache',
      name: null,
    });
  });

  it('parses * as wildcard HTML element', () => {
    const result = parseSelector('*');
    expect(result).not.toBeNull();
    expect(result!.alternatives[0].segments[0]).toMatchObject({
      kind: 'html',
      name: null,
    });
  });

  it('parses descendant combinator', () => {
    const result = parseSelector('div span');
    expect(result).not.toBeNull();
    const segs = result!.alternatives[0].segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: 'html', name: 'div', combinator: 'descendant' });
    expect(segs[1]).toMatchObject({ kind: 'html', name: 'span', combinator: 'descendant' });
  });

  it('parses child combinator', () => {
    const result = parseSelector('div > span');
    expect(result).not.toBeNull();
    const segs = result!.alternatives[0].segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: 'html', name: 'div' });
    expect(segs[1]).toMatchObject({ kind: 'html', name: 'span', combinator: 'child' });
  });

  it('parses mixed HTML and mustache', () => {
    const result = parseSelector('#items > div span');
    expect(result).not.toBeNull();
    const segs = result!.alternatives[0].segments;
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ kind: 'mustache', name: 'items' });
    expect(segs[1]).toMatchObject({ kind: 'html', name: 'div', combinator: 'child' });
    expect(segs[2]).toMatchObject({ kind: 'html', name: 'span', combinator: 'descendant' });
  });

  it('parses [attr]', () => {
    const result = parseSelector('img[alt]');
    expect(result).not.toBeNull();
    const seg = result!.alternatives[0].segments[0];
    expect(seg.name).toBe('img');
    expect(seg.attributes).toHaveLength(1);
    expect(seg.attributes[0]).toMatchObject({ name: 'alt', negated: false });
    expect(seg.attributes[0].value).toBeUndefined();
  });

  it('parses [attr=value]', () => {
    const result = parseSelector('input[type=hidden]');
    expect(result).not.toBeNull();
    const seg = result!.alternatives[0].segments[0];
    expect(seg.attributes[0]).toMatchObject({ name: 'type', value: 'hidden', negated: false });
  });

  it('parses :not([attr])', () => {
    const result = parseSelector('img:not([alt])');
    expect(result).not.toBeNull();
    const seg = result!.alternatives[0].segments[0];
    expect(seg.name).toBe('img');
    expect(seg.attributes).toHaveLength(1);
    expect(seg.attributes[0]).toMatchObject({ name: 'alt', negated: true });
  });

  it('parses attribute-only selector [style]', () => {
    const result = parseSelector('[style]');
    expect(result).not.toBeNull();
    const seg = result!.alternatives[0].segments[0];
    expect(seg.name).toBeNull();
    expect(seg.kind).toBe('html');
    expect(seg.attributes).toHaveLength(1);
    expect(seg.attributes[0]).toMatchObject({ name: 'style', negated: false });
  });

  it('parses tag with multiple attributes', () => {
    const result = parseSelector('div[class][id]');
    expect(result).not.toBeNull();
    const seg = result!.alternatives[0].segments[0];
    expect(seg.attributes).toHaveLength(2);
  });

  it('parses comma-separated selector list', () => {
    const result = parseSelector('div, span');
    expect(result).not.toBeNull();
    expect(result!.alternatives).toHaveLength(2);
    expect(result!.alternatives[0].segments[0].name).toBe('div');
    expect(result!.alternatives[1].segments[0].name).toBe('span');
  });

  it('parses comma-separated with complex selectors', () => {
    const result = parseSelector('table > div, #items span');
    expect(result).not.toBeNull();
    expect(result!.alternatives).toHaveLength(2);
    expect(result!.alternatives[0].segments).toHaveLength(2);
    expect(result!.alternatives[1].segments).toHaveLength(2);
  });

  it('is case-insensitive for tag names', () => {
    const result = parseSelector('DIV');
    expect(result).not.toBeNull();
    expect(result!.alternatives[0].segments[0].name).toBe('div');
  });

  it('is case-insensitive for mustache section names', () => {
    const result = parseSelector('#Items');
    expect(result).not.toBeNull();
    expect(result!.alternatives[0].segments[0].name).toBe('items');
  });

  it('returns null for empty string', () => {
    expect(parseSelector('')).toBeNull();
  });

  it('returns null for whitespace only', () => {
    expect(parseSelector('   ')).toBeNull();
  });

  it('returns null for leading >', () => {
    expect(parseSelector('> div')).toBeNull();
  });

  it('returns null for trailing >', () => {
    expect(parseSelector('div >')).toBeNull();
  });

  it('returns null if any comma part is invalid', () => {
    expect(parseSelector('div, > span')).toBeNull();
  });
});

// --- Matching tests ---

describe('matchSelector', () => {
  it('matches a simple tag', () => {
    const tree = parseText('<div></div>');
    const selector = parseSelector('div')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('html_start_tag');
  });

  it('matches descendant at any depth', () => {
    const tree = parseText('<div><p><span></span></p></div>');
    const selector = parseSelector('div span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('does not match descendant when not nested', () => {
    const tree = parseText('<div></div><span></span>');
    const selector = parseSelector('div span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(0);
  });

  it('matches direct child', () => {
    const tree = parseText('<div><span></span></div>');
    const selector = parseSelector('div > span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('does not match indirect child with > combinator', () => {
    const tree = parseText('<div><p><span></span></p></div>');
    const selector = parseSelector('div > span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(0);
  });

  it('matches mustache section #name', () => {
    const tree = parseText('{{#items}}<li></li>{{/items}}');
    const selector = parseSelector('#items li')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('kind-transparent > for HTML across mustache section', () => {
    const tree = parseText('<div>{{#show}}<span></span>{{/show}}</div>');
    const selector = parseSelector('div > span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('kind-transparent > for mustache across HTML element', () => {
    const tree = parseText('{{#a}}<div>{{#b}}inner{{/b}}</div>{{/a}}');
    const selector = parseSelector('#a > #b')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('cross-kind > combinator: #items > div', () => {
    const tree = parseText('{{#items}}<div></div>{{/items}}');
    const selector = parseSelector('#items > div')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('attribute presence [attr]', () => {
    const tree = parseText('<div style="color:red"></div><div></div>');
    const selector = parseSelector('[style]')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('attribute value [attr=value]', () => {
    const tree = parseText('<input type="text"><input type="hidden">');
    const selector = parseSelector('input[type=hidden]')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('negated attribute :not([attr])', () => {
    const tree = parseText('<img src="x"><img src="y" alt="desc">');
    const selector = parseSelector('img:not([alt])')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('returns multiple matches', () => {
    const tree = parseText('<div><span></span><span></span></div>');
    const selector = parseSelector('div span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(2);
  });

  it('matches self-closing tags', () => {
    const tree = parseText('<img src="x">');
    const selector = parseSelector('img')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('wildcard * matches any HTML element', () => {
    const tree = parseText('<div><span></span></div>');
    const selector = parseSelector('div > *')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('wildcard # matches any mustache section', () => {
    const tree = parseText('{{#items}}content{{/items}}');
    const selector = parseSelector('#')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('matches comma-separated selectors', () => {
    const tree = parseText('<div></div><span></span>');
    const selector = parseSelector('div, span')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(2);
  });

  it('deduplicates matches from comma-separated selectors', () => {
    const tree = parseText('<div class="x"></div>');
    const selector = parseSelector('div, div[class]')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('3+ level selector', () => {
    const tree = parseText('<div><ul><li></li></ul></div>');
    const selector = parseSelector('div ul li')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
  });

  it('reports html_start_tag for HTML matches', () => {
    const tree = parseText('<div></div>');
    const selector = parseSelector('div')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches[0].type).toBe('html_start_tag');
  });

  it('reports mustache_section_begin for mustache matches', () => {
    const tree = parseText('{{#items}}content{{/items}}');
    const selector = parseSelector('#items')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches[0].type).toBe('mustache_section_begin');
  });

  it('reports html_self_closing_tag for void elements', () => {
    const tree = parseText('<br/>');
    const selector = parseSelector('br')!;
    const matches = matchSelector(tree.rootNode, selector);
    expect(matches).toHaveLength(1);
    expect(matches[0].type).toBe('html_self_closing_tag');
  });
});
