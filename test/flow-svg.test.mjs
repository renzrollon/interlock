// The README flow diagram is generated (scripts/gen-flow-svg.mjs), never drawn.
// These pin the two ways it could quietly stop being true: a hand edit to a
// committed SVG, and the README's command strip drifting from the descriptions
// the diagram shows. One table of six descriptions, quoted in both places.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FILES, NODES, drifted, renderFlow, wrap } from '../scripts/gen-flow-svg.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

test('flow SVGs: every committed file is byte-identical to a fresh generation', () => {
  assert.deepEqual(drifted(), [], 'a flow SVG was edited by hand or tokens.json moved. Run: node scripts/gen-flow-svg.mjs')
})

test('flow SVGs: the generation is deterministic and covers every file the script owns', () => {
  const a = renderFlow()
  assert.deepEqual(Object.keys(a).sort(), [...FILES].sort())
  assert.deepEqual(renderFlow(), a)
})

test('flow SVGs: the wide pair cycles, and stops on the checkpoint under reduced motion', () => {
  const stop = NODES.findIndex(n => n.kind === 'stop')
  for (const name of ['flow-light.svg', 'flow-dark.svg']) {
    const svg = renderFlow()[name]
    assert.match(svg, /@keyframes slot/)
    assert.ok(svg.includes(`@media (prefers-reduced-motion: reduce) { .cur { animation: none; } .cur.s${stop} { opacity: 1; } }`), name)
    assert.doesNotMatch(svg, /<script|animation-play-state: paused/, `${name} must run and must not script`)
    for (const n of NODES) assert.ok(svg.includes(n.label.replace(/&/g, '&amp;')), `${name} lost ${n.id}`)
  }
  for (const name of ['flow-narrow-light.svg', 'flow-narrow-dark.svg']) {
    assert.doesNotMatch(renderFlow()[name], /@keyframes|<script/, `${name} is the static list`)
  }
})

test('flow SVGs: the narrow list prints every description whole, wrapped on words', () => {
  const svg = renderFlow()['flow-narrow-light.svg']
  const shown = [...svg.matchAll(/<text class="desc[^"]*"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]).join(' ')
  for (const n of NODES) assert.ok(shown.includes(n.desc), `narrow SVG lost or broke ${n.id}'s description`)
  assert.deepEqual(wrap('aa bb cc', 5), ['aa bb', 'cc'])
})

test('README: the flow embeds the generated diagram in both themes and both widths', () => {
  for (const f of FILES) assert.ok(README.includes(`docs/assets/${f}`), `README does not reference ${f}`)
  assert.ok(!README.includes('interlock-flow-wide.png'), 'the retired poster is back in the README')
})

test('README: each command in the flow strip carries the diagram\'s description as its hover title', () => {
  for (const n of NODES) {
    assert.ok(README.includes(`"${n.desc}")`), `the README strip no longer quotes ${n.id}'s description verbatim as a link title`)
  }
})
