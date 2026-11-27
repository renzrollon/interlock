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

test('halt rows light the node their halt fires at; unmapped rows are tagged, not clickable', () => {
  assert.match(run, /h12: 'ship_launch'/, 'h12 lights ship_launch');
  assert.doesNotMatch(run, /h12: 'trampoline_halt'/, 'h12 is not the missing-Workflow halt');
  for (const k of ['h10', 'h11', 'h15']) {
    assert.doesNotMatch(run, new RegExp('rows\\.' + k + '\\.'), k + ' row takes no click');
  }
  assert.equal(run.split('>not on the diagram</span>').length - 1, 3, 'three not-on-the-diagram tags');
});

test('a revealed halt node lands clear of the sticky header', () => {
  assert.match(css, /\.sm-node \{[^}]*scroll-margin-top: \d+px/, 'sm-node scroll-margin-top');
  assert.match(run, /picked = sc\.querySelector\('\.sm-hl'\)/, 'reveal reads the picked node only');
});

test('arrow-key tab changes reveal the panel, and the panel takes focus', () => {
  const m = html.match(/tabKey = \(e\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(m, 'tabKey handler present');
  assert.equal(m[0].split(', true, true)').length - 1, 4, 'every tab key passes a scroll');
  assert.match(html, /id="panel" role="tabpanel"[^>]*tabindex="0"/, 'panel tabindex');
  assert.match(css, /\[role="tabpanel"\]:focus-visible \{ outline-offset: -2px; \}/, 'panel ring drawn inside');
});

test('below 760 px the tabs take their own full-width row, and anchors clear the taller header', () => {
  const at = css.indexOf('@media (max-width: 760px) {');
  assert.ok(at > -1, '760 px header block');
  const block = css.slice(at, css.indexOf('\n}', at));
  assert.match(block, /\.hdr-in \{[^}]*flex-wrap: wrap/, 'header row wraps');
  assert.match(block, /\.tabs \{[^}]*order: 1;[^}]*flex: 1 0 100%/, 'tabs on a full-width row after the actions');
  assert.match(block, /\.tab \{[^}]*min-height: 44px/, '44 px touch height');
  assert.match(block, /#panel \{ scroll-margin-top: \d+px/, 'panel offset grows with the header');
  assert.match(block, /#install, \.il \.sm-node \{ scroll-margin-top: \d+px/, 'install and node offsets grow with the header');
  assert.doesNotMatch(html, /scroll-margin-top/, 'no inline anchor offset left in index.html');
});

test('flow buttons keep the button role inside list items', () => {
  assert.doesNotMatch(html, /<button[^>]*role="listitem"/, 'no button carries role=listitem');
  assert.equal(html.split('role="listitem"><button type="button" class="flow-btn"').length - 1, 3, 'three list items hold a flow button');
});

test('the hero film has a keyboard toggle that follows the film', () => {
  assert.match(html, /<button type="button" class="film-toggle" aria-label="\{\{heroToggleLabel\}\}" onClick="\{\{toggleHero\}\}">/, 'film toggle button');
  assert.match(html, /addEventListener\('play', this\.onHeroPlay\)/, 'play listener');
  assert.match(html, /addEventListener\('pause', this\.onHeroPause\)/, 'pause listener');
  assert.match(css, /\.film-toggle \{/, 'film toggle style');
});

test('FirstHour and Limits carry a waiver above each .tbox', () => {
  for (const f of ['FirstHour.dc.html', 'Limits.dc.html']) {
    const t = read(f);
    const boxes = t.split('<div class="tbox">').length - 1;
    assert.equal(t.split(WAIVER).length - 1, boxes, f + ' tbox waivers');
  }
});

// Onboarding pass, 2026-11-27. A live install showed `! interlock doctor`
// answers `command not found` in the session the plugin was installed from,
// so every install surface puts the new session between install and doctor.
test('install panel: one copy button per command, copying the bare command', () => {
  assert.equal(html.split('<button type="button" class="ln-copy"').length - 1, 1, 'one ln-copy button inside the per-line sc-for');
  assert.match(html, /copy: \(e\) => this\.copyLine\(k, l\.c, e\)/, 'the button copies l.c, never the comment');
  assert.doesNotMatch(html, /copyPanel/, 'no panel-wide copy');
  assert.match(css, /\.ln-copy \{/, 'ln-copy style');
});

test('install block: requirements checklist above the panels, new session before doctor, fix-tests once per repo', () => {
  const block = html.slice(html.indexOf('<div id="install"'), html.indexOf('class="g-run"'));
  assert.ok(block.indexOf('class="reqs"') > -1 && block.indexOf('class="reqs"') < block.indexOf('{{panels}}'), 'checklist precedes the panels');
  assert.match(html, /window\.localStorage\.setItem\('il-reqs'/, 'ticks persist');
  assert.match(block, /Then start a new session in your project\./);
  const once = html.slice(html.indexOf("mk('once'"), html.indexOf("mk('every'"));
  assert.match(once, /, true\)/, 'the once-per-repo panel carries the new-session lead');
  const order = ['! interlock doctor', '/interlock:fix-tests', '/interlock:bootstrap'].map((c) => once.indexOf("c: '" + c + "'"));
  assert.ok(order.every((i) => i > -1) && order[0] < order[1] && order[1] < order[2], 'doctor, fix-tests, bootstrap in order');
});

test('README and the first-hour guide start a new session before doctor and run fix-tests once', () => {
  const md = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const f of ['README.md', 'docs/01-first-hour.md']) {
    const t = md(f);
    const install = t.indexOf('/plugin install interlock@interlock');
    const session = t.toLowerCase().indexOf('start a new session in your project');
    const doctor = t.indexOf('```text\n! interlock doctor\n```');
    const fix = t.indexOf('```text\n/interlock:fix-tests\n```');
    assert.ok(install > -1 && install < session && session < doctor && doctor < fix, f + ': install, new session, doctor, fix-tests');
    assert.match(t, /^- \[ \] /m, f + ': requirements as a checklist');
  }
  const fh = read('FirstHour.dc.html');
  assert.match(fh, /mkStep\('st', \[\{ c: '\/interlock:fix-tests' \}\]\)/, 'first-hour timeline has the fix-tests step');
  assert.doesNotMatch(fh, /review-code · fix-tests ·/, 'fix-tests is no longer under "do not run these yet"');
});

// Polish pass, 2026-11-27. Each entry is logged in site/README.md "Local patches".
test('the paragraph reset carries one class of weight, so stack gaps and caption margins hold', () => {
  assert.match(css, /\.il :where\(p\) \{ margin: 0; \}/, 'reset written with :where');
  assert.doesNotMatch(css, /^\.il p \{[^}]*margin/m, 'no .il p rule zeroes a paragraph margin');
});

test('inline code moves to the next line whole', () => {
  assert.match(css, /\.il code \{[^}]*display: inline-block/, 'inline-block code');
  assert.match(css, /\.nw \{ white-space: nowrap; \}/, 'nowrap utility');
  assert.match(read('FirstHour.dc.html'), /<span class="nw">manual-test-plan<\/span>/, 'hyphenated names kept whole');
});

test('first hour: one copy button per command, never one for a whole panel', () => {
  const fh = read('FirstHour.dc.html');
  assert.doesNotMatch(fh, /codebox/, 'no corner copy box');
  assert.doesNotMatch(css, /\.codebox/, 'codebox styles removed');
  assert.equal(fh.split('<button type="button" class="ln-copy"').length - 1, 7, 'one per-line copy button in each of the seven code panels');
  assert.match(fh, /copy: this\.copy\(k, l\.c\)/, 'each line copies its own command');
  assert.match(fh, /mkStep\('s7', \[\{ c: '\/interlock:settle --create --review' \}, \{ c: '! openspec archive <change-name> -y', m: '# after it merges' \}\]\)/, 'settle and the archive line are two rows');
});

test('a refused copy selects the command and says so', () => {
  for (const t of [html, read('FirstHour.dc.html')]) {
    assert.match(t, /Copy was blocked\. The command is selected/, 'spoken fallback');
  }
});

test('the stepper opens with narration, not an empty panel', () => {
  assert.match(run, /if \(!lines\.length\)/, 'empty-state branch');
  assert.match(run, /'# Nothing has run yet\.'/, 'narration line');
});

test('the caps table keeps every value in view on a phone', () => {
  const lim = read('Limits.dc.html');
  assert.match(lim, /class="dt dt-capsbox"/, 'caps table class');
  assert.doesNotMatch(lim, /aria-label="interlock limits at v[\d.]+" style="min-width/, 'no inline min-width on the caps table');
  assert.match(lim, /' dt-caps-long'/, 'long values flagged');
  assert.match(css, /@media \(max-width: 640px\) \{[^}]*\.dt-capsbox \{ min-width: 0; \}/, 'phone width releases the table');
});

test('scroll cues, the dark canvas, section ends, the footer hang and the flow coda', () => {
  assert.match(css, /\.sm-scroll::-webkit-scrollbar \{/, 'styled scrollbar on the diagram');
  assert.match(css, /html:has\(\.il\[data-theme="dark"\]\)[^{]*\{ color-scheme: dark;/, 'dark canvas');
  assert.match(css, /\.sec:has\(\+ \.sec\) > \.rows:last-child > \.row:last-child/, 'no closing rule before another section');
  assert.match(css, /\.ftr-docs a \{ display: flex;/, 'footer titles hang');
  assert.match(html, /<p class="mono flow-coda">/, 'flow coda class');
});
