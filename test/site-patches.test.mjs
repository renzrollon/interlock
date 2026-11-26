// Pins the local patches site/README.md lists, by token, so a regenerated
// export that drops one fails here and names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

test('onHash selects the Why tab on the hashless entry URL', () => {
  const m = html.match(/this\.onHash = \(\) => \{[\s\S]*?\n {4}\};/);
  assert.ok(m, 'onHash handler present');
  assert.match(m[0], /!window\.location\.hash/);
  assert.match(m[0], /setState\(\{ tab: 'why' \}\)/);
});

const read = (f) => readFileSync(new URL('../site/' + f, import.meta.url), 'utf8');
const run = read('Run.dc.html');
const css = read('site.css');
const WAIVER = 'impeccable-disable-next-line cramped-padding';

test('stepper terminal has no whitespace between .term, sc-for and .tline', () => {
  assert.match(run, /<div class="term term-tall"[^>]*><sc-for [^>]*><div class="tline /, 'stepper terminal one-line patch');
});

test('state machine scroller has a ref and centres the lit node', () => {
  assert.match(run, /class="sm-scroll" ref="\{\{scrollRef\}\}"/, 'sm-scroll ref patch');
  assert.match(run, /\.scrollLeft = /, 'sm-scroll scrollLeft call');
  assert.match(run, /querySelector\('\.sm-hl'\)/, 'lit node lookup');
});

test('pickHalt reveals its node, auto behaviour under reduced motion', () => {
  assert.match(run, /revealHalt = true/, 'pickHalt reveal flag');
  assert.match(run, /prefers-reduced-motion: reduce/, 'reduced-motion read');
  assert.match(run, /behavior: reduced \? 'auto'/, 'reduced-motion auto behaviour');
});

test('Run.dc.html carries the cramped-padding waivers', () => {
  const n = run.split(WAIVER).length - 1;
  assert.ok(n >= 4, 'Run waivers above sm-scroll and each tbox');
});

test('optional states drop opacity for the dashed outline', () => {
  for (const m of css.matchAll(/^[^\n{]*(?:\.sm-dim|\.dim)\b[^\n{]*\{[^}]*\}/gm)) {
    assert.doesNotMatch(m[0], /opacity/, 'optional-state patch: no opacity in ' + m[0].slice(0, 30));
  }
  assert.match(css, /\.sm-dim \{[^}]*var\(--color-border-strong\)[^}]*var\(--color-text-muted\)/, 'optional-state tokens');
  assert.match(css, /\.sm-halt\.sm-dim \{[^}]*var\(--color-halt\)/, 'dimmed halts keep halt colour');
  assert.match(css, /\.sm-node\.sm-current \{/, 'restated .sm-node.sm-current');
  assert.match(css, /\.sm-node\.sm-hl \{/, 'restated .sm-node.sm-hl');
});

test('index.html reveals the panel and centres the selected tab', () => {
  assert.match(html, /revealPanel = \(reduced\)/, 'revealPanel patch');
  assert.match(html, /pick: \(\) => this\.selectTab\(d\[0\], false, true\)/, 'header tab click passes a scroll');
  assert.match(html, /if \(tab\) this\.revealPanel\(reduced\)/, 'mount reveal gated on a tab hash');
  assert.match(html, /componentDidUpdate\(\) \{[\s\S]*?'tab-'/, 'tab centring call');
  assert.equal(html.split(WAIVER).length - 1, 3, 'three proof-strip figure waivers');
});

test('FirstHour and Limits carry a waiver above each .tbox', () => {
  for (const f of ['FirstHour.dc.html', 'Limits.dc.html']) {
    const t = read(f);
    const boxes = t.split('<div class="tbox">').length - 1;
    assert.equal(t.split(WAIVER).length - 1, boxes, f + ' tbox waivers');
  }
});
