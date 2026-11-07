// The wave plan as an SVG document (make-the-run-surfaces-interactive, spec
// ship/diagrams "The plan SHALL also render as an SVG document", design D10,
// D13, D23). The rows are `drawPlanBoardRows`'s, built here from small plans so
// each scenario's rows are exactly what the scenario names.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drawPlanBoardRows } from '../../lib/draw-plan.mjs'
import { drawPlanSvg } from '../../lib/draw-plan-svg.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const task = (id, description = `Do the work of task ${id} now`, extra = {}) => ({ id, group: 1, tier: 2, model: 'sonnet', description, ...extra })

/** Two waves: three lanes, then one ordered after a task of lane 1.2. */
const TWO_WAVES = {
  waves: [
    { group: 1, kind: 'impl', batches: [[[task('1.1')], [task('1.2')], [task('1.3')]]] },
    { group: 2, kind: 'impl', batches: [[[task('2.1')]]] }
  ],
  testWave: null,
  deferred: [{ id: '2.1', after: ['1.2'] }]
}

const rowsOf = (plan, opts = {}) => drawPlanBoardRows(plan, { columns: LIMITS.waveBoardDefaultColumns, ...opts })
const count = (text, pattern) => (text.match(pattern) ?? []).length
const laneBox = (source, label) => source.match(new RegExp(`<g class="lane" data-label="${label.replace(/[.+]/g, '\\$&')}"[^>]*>[\\s\\S]*?</g>`))?.[0]

test('a two-wave plan draws a group per wave, a box per lane and an edge per recorded order', () => {
  const rows = rowsOf(TWO_WAVES, {
    state: { runId: 'abcdef12-0000', waves: [{}, {}], completed: ['1.1'], cursor: { waveIndex: 0, batchIndex: 0, phase: 'batch' } }
  })
  const svg = drawPlanSvg(rows)
  assert.equal(svg.reason, undefined)
  assert.equal(count(svg.source, /<g class="wave">/g), 2)
  assert.equal(count(svg.source, /<g class="lane" /g), 4)
  for (const label of ['1.1', '1.2', '1.3', '2.1']) {
    const box = laneBox(svg.source, label)
    assert.ok(box, `no box for ${label}`)
    assert.ok(box.includes(`>${label}`) || box.includes(` · ${label}`) || box.includes(label), box)
  }
  assert.ok(laneBox(svg.source, '1.1').includes('>ok<'), 'the finished lane carries its state word')
  assert.ok(laneBox(svg.source, '1.2').includes('>current<'))
  const edges = svg.source.match(/<path class="edge"[^>]*>/g) ?? []
  assert.equal(edges.length, 1, edges.join('\n'))
  assert.match(edges[0], /data-from="1\.2"/)
  assert.match(edges[0], /data-to="2\.1"/)

  assert.equal(svg.alt, rows.map(row => row.text).join('\n'))
  assert.deepEqual(drawPlanSvg(rows), svg, 'the same rows draw the same document')
  assert.ok(Number.isInteger(svg.width) && svg.width > 0)
  assert.ok(Number.isInteger(svg.height) && svg.height > 0)
  assert.ok(svg.source.length <= LIMITS.planSvgMaxChars)
  assert.ok(svg.source.startsWith('<svg '))
  assert.ok(svg.source.endsWith('</svg>'))
})

test('a plan drawn with no state overlay still draws its edges, a multi-task lane by its ids part', () => {
  const plan = {
    waves: [
      { group: 1, kind: 'impl', batches: [[[task('1.1'), task('1.2')], [task('1.3')]]] },
      { group: 2, kind: 'impl', batches: [[[task('2.1')]]] }
    ],
    testWave: null,
    // 1.2 is not the lane's label (`1.1+1`): only the ids part says the lane holds it.
    deferred: [{ id: '2.1', after: ['1.2'] }]
  }
  const rows = rowsOf(plan)
  const laneRow = rows.find(row => row.key === 'lane:1.1+1')
  assert.equal(laneRow.parts.tasks, null)
  assert.equal(laneRow.parts.ids, '1.1, 1.2')
  const svg = drawPlanSvg(rows)
  const edges = svg.source.match(/<path class="edge"[^>]*>/g) ?? []
  assert.equal(edges.length, 1, edges.join('\n'))
  assert.match(edges[0], /data-from="1\.1\+1"/)
  assert.match(edges[0], /data-to="2\.1"/)
  assert.deepEqual(svg.unplaced, [])
  assert.ok(!laneBox(svg.source, '2.1').includes('data-state="ok"'))
})

test('an edge to a task id no lane holds is listed, never drawn to a guess', () => {
  const plan = { ...TWO_WAVES, deferred: [{ id: '2.1', after: ['9.9'] }] }
  const svg = drawPlanSvg(rowsOf(plan))
  assert.equal(count(svg.source, /<path class="edge"/g), 0)
  assert.equal(svg.unplaced.length, 1)
  assert.ok(svg.unplaced[0].includes('9.9'), svg.unplaced[0])
})

test('two lanes of one wave ordered one after the other draw a bracket edge', () => {
  const plan = {
    waves: [{ group: 1, kind: 'impl', batches: [[[task('1.1')]], [[task('1.2')]]] }],
    testWave: null,
    deferred: [{ id: '1.2', after: ['1.1'] }]
  }
  const svg = drawPlanSvg(rowsOf(plan))
  const edges = svg.source.match(/<path class="edge"[^>]*>/g) ?? []
  assert.equal(edges.length, 1)
  assert.match(edges[0], /data-from="1\.1"[^>]*data-to="1\.2"/)
})

test('a plan over the bound returns a reason naming the length and the limits label, never a cut document', () => {
  const lanes = Array.from({ length: 400 }, (_, i) => [task(`1.${i + 1}`)])
  const plan = { waves: [{ group: 1, kind: 'impl', batches: [lanes] }], testWave: null }
  const rows = rowsOf(plan)
  const svg = drawPlanSvg(rows)
  assert.equal(svg.source, undefined)
  assert.equal(svg.width, undefined)
  assert.match(svg.reason, /plan diagram svg chars/)
  assert.match(svg.reason, new RegExp(String(LIMITS.planSvgMaxChars)))
  assert.match(svg.reason, /\d{6,} characters/)
  assert.equal(svg.alt, rows.map(row => row.text).join('\n'))

  // The cap is an argument with the published figure as its default.
  const small = drawPlanSvg(rowsOf(TWO_WAVES), 100)
  assert.equal(small.source, undefined)
  assert.match(small.reason, /over the 100 /)
})

test('rows holding no lane row return no document and say there is no plan to draw', () => {
  const spoken = rowsOf(TWO_WAVES, { columns: LIMITS.waveBoardMinColumns - 1 })
  assert.deepEqual(spoken.map(row => row.key), ['header'])
  const empty = rowsOf({ waves: [], testWave: null })
  for (const rows of [spoken, empty, [], null, 'x', [null, 3]]) {
    const svg = drawPlanSvg(rows)
    assert.equal(svg.source, undefined)
    assert.match(svg.reason, /no plan to draw/)
    assert.equal(typeof svg.alt, 'string')
  }
  assert.equal(drawPlanSvg(spoken).alt, spoken[0].text)
})

test('a lane title holding markup is text, and a failed lane carries its word and a stroke pattern', () => {
  const hostile = '</text><script>x</script>'
  const plan = {
    waves: [{ group: 1, kind: 'impl', batches: [[[task('1.1', hostile)], [task('1.2')]]] }],
    testWave: null
  }
  const rows = rowsOf(plan, {
    state: { runId: 'r', waves: [{}], failures: [{ id: '1.1' }], completed: ['1.2'], cursor: { waveIndex: 0, batchIndex: 0, phase: 'batch' } }
  })
  const svg = drawPlanSvg(rows)
  assert.ok(!/<script/i.test(svg.source), 'no script element')
  assert.equal(count(svg.source, /<\/text><script>/g), 0)
  assert.ok(svg.source.includes('&lt;/text&gt;&lt;script&gt;x&lt;/script&gt;'), 'the title is escaped inside a text element')
  const failed = laneBox(svg.source, '1.1')
  assert.ok(failed.includes('>failed<'), failed)
  const ok = laneBox(svg.source, '1.2')
  assert.match(failed, /stroke-dasharray="[^"]+"/)
  assert.ok(!/stroke-dasharray/.test(ok), 'ok draws solid')
  const patterns = new Set()
  for (const word of ['ok', 'failed', 'current', 'pending', 'not reached', 'not recorded', 'per task']) {
    const row = {
      key: 'lane:1.1',
      text: 'x',
      parts: { batch: 'b0', label: '1.1', model: 'sonnet', tier: 'T2', effort: 'inherit', state: word, gist: '', note: '', ids: '', after: [], tasks: null }
    }
    const box = laneBox(drawPlanSvg([{ key: 'wave:0', text: 'w', parts: { title: 'w' } }, row]).source, '1.1')
    assert.ok(box.includes(`>${word}<`), word)
    patterns.add(box.match(/<rect[^>]*>/)[0].replace(/ x="\d+" y="\d+"/, ''))
  }
  assert.equal(patterns.size, 7, 'every state word draws with a stroke of its own')
})

test('every attribute and text built from a row is escaped, control characters made spaces', () => {
  const row = {
    key: 'lane:"x" onload="y"',
    text: 't',
    parts: { batch: 'b0', label: '"x" onload="y"', model: "a'b", tier: 'T1', effort: '&', state: 'ok\u0001', gist: '<b>\u0000g</b>', note: '', ids: '', after: [], tasks: null }
  }
  const svg = drawPlanSvg([{ key: 'wave:0', text: '<w>', parts: { title: '<w>' } }, row])
  assert.ok(!svg.source.includes('onload="y"'), 'an attribute cannot be closed early')
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg.source))
  assert.ok(!svg.source.includes('<b>'))
  assert.ok(!svg.source.includes('<w>'))
})

test('the document sets its own background and ink and names nothing outside itself', () => {
  const svg = drawPlanSvg(rowsOf(TWO_WAVES)).source
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#[0-9a-f]{6}"\/>/, 'its own background')
  assert.match(svg, /fill="#[0-9a-f]{6}"/)
  assert.ok(!/currentColor|var\(|inherit/i.test(svg.replace(/inherit/g, '')), 'no theme read')
  const withoutNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '')
  assert.ok(!/https?:|\/\/|href|<image|<style|@import|font-face|\.(woff2?|ttf|otf|png|jpe?g|gif|svg)\b/i.test(withoutNamespace), withoutNamespace)
  for (const ref of withoutNamespace.match(/url\([^)]*\)/g) ?? []) assert.match(ref, /^url\(#/, ref)
})

test('the module reads its cap from the limits definition and the hooks module restates neither key nor figure', () => {
  const source = readFileSync(join(ROOT, 'lib', 'draw-plan-svg.mjs'), 'utf8')
  assert.ok(source.includes('LIMITS.planSvgMaxChars'))
  assert.ok(!source.includes(String(LIMITS.planSvgMaxChars)), 'the figure is not restated')
  assert.ok(!source.includes('131072') && !source.includes('131_072'))
  const mod = readFileSync(join(ROOT, 'hooks', 'mod.mjs'), 'utf8')
  assert.ok(!mod.includes('planSvgMaxChars'))
  assert.ok(!mod.includes(String(LIMITS.planSvgMaxChars)))
})
