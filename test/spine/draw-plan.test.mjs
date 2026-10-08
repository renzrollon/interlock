// The wave board and the Mermaid plan (draw-wave-plan-and-handoff-graph-from-the-cli,
// spec ship/diagrams), drawn from the records of one real halted run.
//
// The fixture under test/fixtures/ship/halted-run-6e9d0b02/ is a byte copy,
// taken 2026-10-06, of three live files that are gitignored and therefore never
// read by a test:
//
//   .claude/ship/plan.json                                         → plan.json
//   .claude/ship/state.json                                        → state.json
//   .claude/ship/runs/6e9d0b02-c70b-4d7a-9865-fa892722cecb.jsonl   → trajectory.jsonl
//
// The plan predates `wave.kind` and holds two waves with `group: 1`; the state
// halted at wave position 1 with a failure id no planned lane carries. Both
// facts are why the board keys waves by position and lists what it cannot place.
//
// Widths are read from LIMITS, never restated: the numbers are `interlock limits`'s.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drawPlanBoard, drawPlanMermaid, STATE_WORDS } from '../../lib/draw-plan.mjs'
// A namespace, so a missing export fails its own cases rather than this file.
import * as drawPlan from '../../lib/draw-plan.mjs'
import { laneLabel, laneTitle } from '../../lib/lane.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import { walkModule } from '../helpers/module-walk.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_REL = 'test/fixtures/ship/halted-run-6e9d0b02'
const FIXTURE = join(ROOT, FIXTURE_REL)
const PLAN_SOURCE = `${FIXTURE_REL}/plan.json`
const DOC = 'docs/10-agentic-workflow-ship-and-spec.md'
const GENERATED = `<!-- generated: interlock waves --plan ${PLAN_SOURCE} --format mermaid -->`

const load = name => JSON.parse(readFileSync(join(FIXTURE, name), 'utf8'))
const PLAN = load('plan.json')
const STATE = load('state.json')

const BOX = /[┌│└─]/
const isTop = line => line.startsWith('┌')
const isRow = line => line.startsWith('│')

/** The blocks of a board, each its top rule and its lane rows. */
function blocks(lines) {
  const out = []
  let current = null
  for (const line of lines) {
    if (isTop(line)) {
      current = { top: line, rows: [] }
      out.push(current)
    } else if (isRow(line) && current) current.rows.push(line)
    else if (line.startsWith('└')) current = null
  }
  return out
}

/** The lane row whose label is `label`. */
function rowOf(lines, label) {
  return lines.find(line => isRow(line) && new RegExp(`^│ b\\d+ ${label.replace(/[.+]/g, '\\$&')} `).test(line))
}

/** The fixed cells of a row: everything before its gist. */
const fixed = row => (row.includes(' · ') ? row.slice(0, row.indexOf(' · ')) : row)

/** Every lane of a plan, in plan order, the test wave last. */
function lanesOf(plan) {
  const waves = [...plan.waves, ...(plan.testWave ? [plan.testWave] : [])]
  return waves.flatMap(w => w.batches.flat())
}

/** The verify cell after position `i`. */
const verifyCell = (lines, i) => lines.find(line => line.startsWith(`  verify after idx ${i}`))

test('the fixture plan draws three blocks keyed by position, lanes named as their agents are', () => {
  const lines = drawPlanBoard(PLAN, { columns: LIMITS.waveBoardDefaultColumns })
  const drawn = blocks(lines)
  assert.equal(drawn.length, 3, lines.join('\n'))
  assert.ok(drawn[0].top.startsWith('┌─ wave 1 · idx 0 · group 1'), drawn[0].top)
  assert.ok(drawn[1].top.startsWith('┌─ wave 2 · idx 1 · group 1'), drawn[1].top)
  assert.ok(drawn[1].top.includes('5 batches'), drawn[1].top)
  assert.ok(drawn[2].top.startsWith('┌─ test wave'), drawn[2].top)
  for (const { top } of drawn) assert.ok(!/group \d/.test(top) || top.includes('idx '), top)

  const labelsIn = block => block.rows.map(row => row.split(' ').filter(Boolean)[2])
  assert.deepEqual(labelsIn(drawn[0]), ['1.7', '1.4', '1.2', '1.3', '1.6'])
  assert.deepEqual(labelsIn(drawn[1]), ['1.5', '1.1', '2.1', '2.2', '2.3', '3.2'])
  assert.deepEqual(
    drawn[1].rows.map(row => row.slice(0, 4)),
    ['│ b0', '│ b0', '│ b1', '│ b2', '│ b3', '│ b4']
  )

  assert.ok(rowOf(lines, '1.5').includes('←1.6'))
  assert.ok(rowOf(lines, '1.1').includes('←1.3'))
  assert.ok(rowOf(lines, '2.2').includes('←2.1'))
  assert.ok(rowOf(lines, '2.3').includes('←2.2'))
  assert.ok(!rowOf(lines, '2.1').includes('←'), 'the plan recorded no deferral for 2.1')

  assert.ok(lines[0].includes('plan only'), lines[0])
  for (const row of lines.filter(isRow)) {
    for (const word of STATE_WORDS) {
      assert.ok(!new RegExp(`(^| )${word}( |$)`).test(fixed(row)), `${row} carries ${word}`)
    }
  }
  assert.ok(lines.at(-1).startsWith('then: verify-final → commit → close'), lines.at(-1))

  for (const lane of lanesOf(PLAN)) {
    const label = laneLabel(lane)
    const row = rowOf(lines, label)
    assert.ok(row, `no row for ${label}`)
    const gist = row.slice(row.indexOf(' · ') + 3)
    assert.equal(`${label} · ${gist}`, laneTitle(lane))
  }
})

test('a plan with no waves is still a board, never an exception', () => {
  for (const plan of [{ waves: [], testWave: null }, null, 'x']) {
    const lines = drawPlanBoard(plan)
    assert.ok(Array.isArray(lines))
    assert.ok(lines[0].includes('holds no waves'), lines[0])
    assert.ok(!lines.some(line => /^[┌│└]/.test(line)), lines.join('\n'))
    assert.ok(lines.some(line => line.startsWith('then: ')), lines.join('\n'))
  }
})

test('a row longer than the width is cut after its fixed cells are kept', () => {
  const columns = LIMITS.waveBoardMinColumns + 10
  const task = {
    id: '1.1',
    group: 1,
    tier: 2,
    model: 'haiku',
    description: 'A description written to run far past the width the board leaves for the gist of one lane'
  }
  const plan = { waves: [{ group: 1, kind: 'impl', batches: [[[task]]] }], testWave: null, deferred: [] }
  const state = {
    runId: 'r-cut',
    waves: [{ group: 1, kind: 'impl', batches: [[[task]]] }],
    cursor: { waveIndex: 0, batchIndex: 0, phase: 'batch' },
    completed: [],
    failures: [],
    skippedVerifications: [],
    unresolved: [],
    halt: null
  }
  const row = rowOf(drawPlanBoard(plan, { columns, state }), '1.1')
  assert.ok(row.endsWith('…'), row)
  assert.equal([...row].length, columns)
  for (const cell of [' haiku ', ' T2 ', ' low ', ' current ']) assert.ok(row.includes(cell), `${row} lost ${cell}`)
})

test('below the minimum width the board is one spoken line', () => {
  const width = LIMITS.waveBoardMinColumns - 1
  const lines = drawPlanBoard(PLAN, { columns: width })
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes(String(width)) && lines[0].includes(String(LIMITS.waveBoardMinColumns)), lines[0])
  assert.ok(!BOX.test(lines[0]), lines[0])

  const fallback = drawPlanBoard(PLAN, { columns: 12.5 })
  assert.deepEqual(fallback, drawPlanBoard(PLAN, { columns: LIMITS.waveBoardDefaultColumns }))
})

test('the fixture state overlays the fixture plan with recorded words only', () => {
  const lines = drawPlanBoard(PLAN, { columns: LIMITS.waveBoardDefaultColumns, state: STATE })
  const word = label => {
    const cells = fixed(rowOf(lines, label))
    return STATE_WORDS.filter(w => new RegExp(`(^| )${w}( |$)`).test(cells))
  }
  for (const id of ['1.7', '1.4', '1.2', '1.3']) assert.deepEqual(word(id), ['ok'], id)
  assert.deepEqual(word('1.6'), ['not recorded'])
  for (const id of ['1.5', '1.1']) assert.deepEqual(word(id), ['failed'], id)
  assert.deepEqual(word('2.1'), ['current'])
  for (const id of ['2.2', '2.3', '3.2', '3.1', '3.3']) assert.deepEqual(word(id), ['not reached'], id)

  assert.ok(lines[0].includes('cursor idx 1'), lines[0])
  assert.ok(lines[0].includes('halted'), lines[0])

  const wide = drawPlanBoard(PLAN, { columns: 400, state: STATE })
  assert.ok(wide.at(-1).includes(STATE.halt.reason), wide.at(-1))

  const lastBottom = lines.findLastIndex(line => line.startsWith('└'))
  const unplaced = lines.slice(lastBottom + 1).find(line => line.includes('task-1.6-verify-settings'))
  assert.ok(unplaced, lines.join('\n'))
  for (const part of ['wave 1', 'impl', 'no error recorded']) assert.ok(unplaced.includes(part), unplaced)
  assert.ok(!lines.filter(isRow).some(row => row.includes('task-1.6-verify-settings')))
})

test('a skip recorded by group over two waves of that group is left unplaced', () => {
  const lines = drawPlanBoard(PLAN, { columns: 400, state: STATE })
  const cell = verifyCell(lines, 0)
  assert.ok(cell.includes('1 skip for group 1'), cell)
  assert.ok(cell.includes('idx 0 or idx 1'), cell)
  assert.ok(!lines.some(line => line.includes('skipped: no-detectable-command')), lines.join('\n'))

  const task = (id, group) => ({ id, group, tier: 2, model: 'sonnet', description: `task ${id}` })
  const waves = [
    { group: 1, kind: 'impl', batches: [[[task('1.1', 1)]]] },
    { group: 2, kind: 'impl', batches: [[[task('2.1', 2)]]] }
  ]
  const plan = { waves, testWave: null, deferred: [] }
  const state = {
    runId: 'r-skip',
    waves,
    cursor: { waveIndex: 1, batchIndex: 0, phase: 'batch' },
    completed: ['1.1'],
    failures: [],
    skippedVerifications: [{ wave: 1, waveKind: 'impl', reason: 'no-detectable-command' }],
    unresolved: [],
    halt: null
  }
  const placed = verifyCell(drawPlanBoard(plan, { columns: 400, state }), 0)
  assert.ok(placed.includes('skipped: no-detectable-command'), placed)
})

test('an overlay with a different wave count is applied by task id only', () => {
  const state = { ...STATE, waves: STATE.waves.slice(0, 2) }
  const lines = drawPlanBoard(PLAN, { columns: 400, state })
  assert.ok(lines[0].includes('state has 2 waves, plan has 3'), lines[0])
  assert.ok(lines[0].includes('by task id only'), lines[0])
  for (const id of ['1.7', '1.4', '1.2', '1.3']) assert.ok(/ ok /.test(fixed(rowOf(lines, id))), id)
  assert.ok(!lines.filter(isRow).some(row => / current /.test(fixed(row))), lines.join('\n'))
  for (const cell of lines.filter(line => line.startsWith('  verify after'))) {
    assert.ok(!/skip/.test(cell), cell)
  }
})

test('the fixture plan renders to a positional flowchart with dependsOn edges and no style', () => {
  const lines = drawPlanMermaid(PLAN, { source: PLAN_SOURCE })
  assert.equal(lines[0], 'flowchart LR')
  assert.ok(lines[1].trim().startsWith('%% source:'), lines[1])
  const subgraphs = lines.map(line => line.trim().match(/^subgraph (\w+)\[/)).filter(Boolean).map(m => m[1])
  for (const id of ['W0', 'W1', 'W2', 'W1B0', 'W1B1', 'W1B2', 'W1B3', 'W1B4']) assert.ok(subgraphs.includes(id), id)
  assert.ok(
    lines.some(line =>
      /^\s*W0 --> V0\{\{.+\}\} --> W1 --> V1\{\{.+\}\} --> W2 --> VF\[\[.+\]\] --> C\[\[.+\]\] --> X\[\[.+\]\]$/.test(line)
    ),
    lines.join('\n')
  )
  const edges = lines.filter(line => line.includes('-. dependsOn .->')).map(line => line.trim())
  assert.deepEqual(edges.sort(), [
    'L1_3 -. dependsOn .-> L1_1',
    'L1_6 -. dependsOn .-> L1_5',
    'L2_1 -. dependsOn .-> L2_2',
    'L2_2 -. dependsOn .-> L2_3'
  ])
  assert.deepEqual(lines, drawPlanMermaid(PLAN, { source: PLAN_SOURCE }))

  const overlaid = drawPlanMermaid(PLAN, { source: PLAN_SOURCE, state: STATE })
  const nodes = overlaid.filter(line => /^\s*L\w+\["/.test(line))
  assert.equal(nodes.length, lanesOf(PLAN).length)
  for (const node of nodes) {
    assert.ok(STATE_WORDS.some(w => node.endsWith(` · ${w}"]`)), node)
  }
  for (const form of [lines, overlaid]) {
    assert.ok(!form.some(line => /\bstyle\b|classDef|\bclass |linkStyle|:::/.test(line)), form.join('\n'))
  }
})

/**
 * Compare the generated Mermaid fence in `docPath` (its text `text`) with
 * `lines`. `null` when they agree; otherwise a message naming the document and
 * the first line that differs.
 */
function compareFence(docPath, text, lines) {
  const docLines = text.split('\n')
  const at = docLines.indexOf(GENERATED)
  if (at === -1) return `${docPath}: no generated block (${GENERATED})`
  const open = docLines.indexOf('```mermaid', at)
  if (open === -1) return `${docPath}: no mermaid fence after the generated comment`
  const close = docLines.indexOf('```', open + 1)
  const body = docLines.slice(open + 1, close === -1 ? docLines.length : close)
  const length = Math.max(body.length, lines.length)
  for (let i = 0; i < length; i++) {
    if (body[i] !== lines[i]) {
      return `${docPath}: generated block differs at line ${i + 1}: expected ${lines[i] ?? '(end)'}, found ${body[i] ?? '(end)'}`
    }
  }
  return null
}

test('the docs/10 Mermaid block is the fixture plan, regenerated', () => {
  const text = readFileSync(join(ROOT, DOC), 'utf8')
  assert.equal(compareFence(DOC, text, drawPlanMermaid(PLAN, { source: PLAN_SOURCE })), null)
})

test('a hand-edited docs/10 block fails naming the document and the line', () => {
  const lines = drawPlanMermaid(PLAN, { source: PLAN_SOURCE })
  const doc = ['# copy', '', GENERATED, '```mermaid', ...lines, '```', ''].join('\n')
  assert.equal(compareFence(DOC, doc, lines), null)
  const edited = doc.replace(lines[2], `${lines[2]} edited`)
  const message = compareFence(DOC, edited, lines)
  assert.ok(message && message.includes(DOC), message)
  assert.ok(message.includes('line 3'), message)
  assert.ok(message.includes(`${lines[2]} edited`), message)
})

test('the renderers and the lane module are pure and Node-free', () => {
  const modules = ['draw-plan.mjs', 'draw-run.mjs', 'lane.mjs']
  const allowed = new Set([...modules, 'limits.mjs'].map(name => join(ROOT, 'lib', name)))
  for (const name of modules) {
    const entry = join(ROOT, 'lib', name)
    const { files, problems } = walkModule(entry, ROOT)
    assert.deepEqual(problems, [], problems.join('\n'))
    for (const file of files) assert.ok(allowed.has(file), `${name} reaches ${file}`)
    const source = readFileSync(entry, 'utf8')
    for (const token of ['process.', 'Date', 'performance', 'globalThis', 'readFileSync', 'import(']) {
      assert.ok(!source.includes(token), `lib/${name} contains ${token}`)
    }
  }
  const pins = readFileSync(join(ROOT, 'test', 'spine', 'mod-pins.test.mjs'), 'utf8')
  assert.match(pins, /import \{[^}]*\bwalkModule\b[^}]*\} from '\.\.\/helpers\/module-walk\.mjs'/)

  const { problems } = walkModule(join(ROOT, 'lib', 'ship-stage.mjs'), ROOT)
  assert.ok(problems.some(p => p.includes('lib/ship-stage.mjs') && p.includes("'node:fs'")), problems.join('\n'))
})

// --- rows, notes and positioned skips for a second drawer -------------------
//
// draw-the-wave-board-in-the-meter-pane (spec ship/diagrams, "The board SHALL
// key its rows and carry host-observed lane text for a second drawer"): the
// ship meter keys what it draws, appends what the host observed of a lane, and
// places a skip by the wave position its verify step carried.

const boardRows = (plan, opts) => drawPlan.drawPlanBoardRows(plan, opts)
const NOTE = 'served claude-sonnet-5-5 · running'

test('the board as rows is keyed by header, position, lane label, verify cell and tail', () => {
  for (const state of [null, STATE]) {
    const rows = boardRows(PLAN, { columns: LIMITS.waveBoardDefaultColumns, state })
    const keys = rows.map(r => r.key)
    assert.equal(keys[0], 'header')
    assert.equal(keys.at(-1), 'tail')
    for (const key of ['wave:0', 'wave:1', 'wave:2', 'verify:0', 'verify:1']) assert.ok(keys.includes(key), key)
    for (const lane of lanesOf(PLAN)) assert.ok(keys.includes(`lane:${laneLabel(lane)}`), laneLabel(lane))
    assert.equal(new Set(keys).size, keys.length, 'every key is one row')
    assert.deepEqual(
      rows.map(r => r.text),
      drawPlanBoard(PLAN, { columns: LIMITS.waveBoardDefaultColumns, state }),
      'the lines form is the rows\' texts, in order'
    )
  }
})

test("a lane's host-observed note follows its state word, and no other row carries one", () => {
  const columns = LIMITS.waveBoardDefaultColumns
  const rows = boardRows(PLAN, { columns, state: STATE, notes: { '1.5': NOTE } })
  const lanes = rows.filter(r => r.key.startsWith('lane:'))
  const noted = lanes.find(r => r.key === 'lane:1.5')
  assert.ok(noted.text.includes(`failed ${NOTE}`), noted.text)
  for (const row of lanes.filter(r => r !== noted)) {
    const cells = fixed(row.text)
    const word = STATE_WORDS.find(w => new RegExp(`(^| )${w}( |$)`).test(cells))
    assert.ok(word, row.text)
    const rest = cells.slice(cells.lastIndexOf(word) + word.length).trim()
    assert.ok(rest === '' || /^[[←]/.test(rest), `${row.key} carries text after its state word: ${rest}`)
  }
  const plain = boardRows(PLAN, { columns, state: STATE })
  assert.deepEqual(
    rows.filter(r => r !== noted),
    plain.filter(r => r.key !== 'lane:1.5'),
    'a note changes its own row and nothing else'
  )
})

test('a note keyed by a label no lane carries is drawn nowhere', () => {
  const columns = LIMITS.waveBoardDefaultColumns
  let rows
  assert.doesNotThrow(() => (rows = boardRows(PLAN, { columns, state: STATE, notes: { '9.9': NOTE } })))
  assert.deepEqual(rows, boardRows(PLAN, { columns, state: STATE }))
  assert.ok(!rows.some(r => r.text.includes(NOTE)))
})

test('a note that overflows is cut with its row, the fixed cells and state word kept', () => {
  const columns = LIMITS.waveBoardMinColumns + 10
  const long = `${NOTE} · ${'x'.repeat(columns)}`
  const row = boardRows(PLAN, { columns, state: STATE, notes: { '1.5': long } }).find(r => r.key === 'lane:1.5').text
  assert.ok(row.endsWith('…'), row)
  assert.equal([...row].length, columns)
  for (const cell of [' sonnet ', ' T4 ', ' inherit ', ' failed ']) assert.ok(row.includes(cell), `${row} lost ${cell}`)
  assert.ok(!row.includes('In lib/doctor.mjs'), 'the title gives way first')
})

test("a lane row's parts.state is the state word in its text", () => {
  const rows = boardRows(PLAN, { columns: LIMITS.waveBoardDefaultColumns, state: STATE })
  const lanes = rows.filter(r => r.key.startsWith('lane:'))
  assert.ok(lanes.length > 0)
  for (const row of lanes) {
    assert.ok(row.parts, row.key)
    assert.equal(row.parts.label, row.key.slice('lane:'.length), row.key)
    const word = row.parts.state
    if (!word) continue
    const cells = fixed(row.text)
    const found = word === 'per task'
      ? cells.includes('per task')
      : new RegExp(`(^| )${word}( |$)`).test(cells)
    assert.ok(found, `${row.key} text ${cells} does not carry parts.state ${word}`)
  }
  const lanePlan = new Map(lanesOf(PLAN).map(lane => [lane[0].id, lane]))
  for (const row of lanes) {
    const { ids, after, tasks } = row.parts
    const cells = fixed(row.text)
    assert.equal(typeof ids, 'string', `${row.key} parts.ids is not a string`)
    if (ids) assert.ok(cells.includes(`[${ids}]`), `${row.key} text ${cells} does not carry parts.ids ${ids}`)
    assert.ok(Array.isArray(after), `${row.key} parts.after is not a list`)
    if (after.length) assert.ok(cells.includes(`←${after.join(',')}`), `${row.key} text ${cells} does not carry parts.after`)
    const lane = lanePlan.get(row.parts.label.split('+')[0])
    assert.ok(lane, `${row.key} names no planned lane`)
    assert.deepEqual(tasks.map(t => t.id), lane.map(t => t.id), `${row.key} parts.tasks are not the lane's tasks`)
  }
  const header = rows.find(r => r.key === 'header')
  const verify = rows.find(r => r.key === 'verify:0')
  const tail = rows.find(r => r.key === 'tail')
  assert.equal(header && 'parts' in header, false)
  assert.equal(verify && 'parts' in verify, false)
  assert.equal(tail && 'parts' in tail, false)
  const wave = rows.find(r => r.key === 'wave:0')
  assert.ok(wave.parts.title.includes('wave 1'), wave.parts.title)
})

test('a skip carrying its wave position is placed by it, with no ambiguity', () => {
  const columns = 400
  const state = {
    ...STATE,
    skippedVerifications: [{ wave: 1, waveKind: 'impl', waveIndex: 0, reason: 'no-detectable-command' }]
  }
  const rows = boardRows(PLAN, { columns, state })
  const cell = rows.find(r => r.key === 'verify:0').text
  assert.ok(cell.includes('skipped: no-detectable-command'), cell)
  assert.ok(!/state does not say|for group/.test(cell), cell)
  const next = rows.find(r => r.key === 'verify:1').text
  assert.ok(!/skip/.test(next.replace('no skip recorded', '')), next)
})
