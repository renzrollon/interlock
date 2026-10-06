// The handoff graph (draw-wave-plan-and-handoff-graph-from-the-cli, spec
// ship/diagrams), drawn from the trajectory of one real halted run.
//
// The fixture under test/fixtures/ship/halted-run-6e9d0b02/ is a byte copy,
// taken 2026-10-06, of three live files that are gitignored and therefore never
// read by a test:
//
//   .claude/ship/plan.json                                         → plan.json
//   .claude/ship/state.json                                        → state.json
//   .claude/ship/runs/6e9d0b02-c70b-4d7a-9865-fa892722cecb.jsonl   → trajectory.jsonl
//
// The trajectory predates the agent-result recorder, so every spawn in it has
// no recorded result, and its implementer spawns were logged at step emission.
// Those are the graph's two caveats, and this file pins that it states both.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drawRunBoard, drawRunMermaid } from '../../lib/draw-run.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE = join(ROOT, 'test', 'fixtures', 'ship', 'halted-run-6e9d0b02')
const RUN_ID = '6e9d0b02-c70b-4d7a-9865-fa892722cecb'
const PATH = `.claude/ship/runs/${RUN_ID}.jsonl`

const RECORDS = readFileSync(join(FIXTURE, 'trajectory.jsonl'), 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line))
const STATE = JSON.parse(readFileSync(join(FIXTURE, 'state.json'), 'utf8'))

const run = (overrides = {}) => ({
  runId: RUN_ID,
  path: PATH,
  records: RECORDS,
  skipped: [],
  state: { value: STATE, read: 'ok' },
  manifest: { value: null, read: 'absent' },
  ...overrides
})

/** Index of the first line starting with `prefix`, asserting there is one. */
function at(lines, prefix) {
  const i = lines.findIndex(line => line.trimStart().startsWith(prefix))
  assert.ok(i !== -1, `no line starts ${prefix}:\n${lines.join('\n')}`)
  return i
}

const WIDE = { columns: 400 }

test('the real trajectory draws in sequence order with its joins', () => {
  const lines = drawRunBoard(run(), WIDE)
  for (const part of [RUN_ID, 'harden-unattended-ship-runs', '26 records', 'state.json: this run', 'run.json: absent']) {
    assert.ok(lines[0].includes(part), `${lines[0]} lacks ${part}`)
  }

  const order = [
    '[1-2] create → run-batch idx 0',
    '[3] run-start',
    '[4-5] next → run-batch idx 0',
    'idx 0 · implementers [6-10]',
    '[6] 1.7',
    '[7] 1.4',
    '[8] 1.2',
    '[9] 1.3',
    '[10] 1.6',
    '[11] spawn record-batch-1',
    '[12-13] record-batch → verify idx 0',
    '[14-15] record-verify → run-batch idx 1',
    '↳ 1.7 ok · confirmed',
    '↳ 1.4 ok · confirmed',
    '↳ 1.2 ok · confirmed',
    '↳ 1.3 partial · confirmed',
    'idx 1 · implementers [16-21]',
    '[22] spawn tick-1',
    '[23-25]',
    '[26] receipt'
  ]
  const positions = order.map(prefix => at(lines, prefix))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'nodes out of sequence order')
  assert.equal(at(lines, '[26] receipt'), lines.length - 1)

  assert.ok(lines[at(lines, '[12-13]')].includes('skip (group 1): no-detectable-command'))
  const halt = lines[at(lines, '[23-25]')]
  assert.ok(halt.includes('halt') && halt.includes('exit 1'), halt)
  const reason = RECORDS.find(r => r.type === 'run-halt').reason
  assert.ok(halt.includes(reason), halt)
})

test('every spawn without a recorded result says so, and the spawn-time caveat is stated once', () => {
  const lines = drawRunBoard(run(), WIDE)
  const implementers = lines.filter(line => /^\s+\[\d+\] \d/.test(line))
  assert.equal(implementers.length, 11)
  for (const row of implementers) assert.ok(row.includes('result: not recorded'), row)
  assert.ok(lines.slice(0, 2).some(line => line.includes('13 of 13 spawns')), lines.slice(0, 2).join('\n'))
  assert.equal(lines.filter(line => line.includes('step-emission times')).length, 1)
})

test('a state naming another run is named and not joined', () => {
  const other = 'ffffffff-0000-0000-0000-000000000000'
  const lines = drawRunBoard(run({ state: { value: { ...STATE, runId: other }, read: 'ok' } }), WIDE)
  assert.ok(lines[0].includes(`state.json: another run ${other}`), lines[0])
  assert.ok(!lines.some(line => line.includes('↳')), lines.join('\n'))
  const implementers = lines.filter(line => /^\s+\[\d+\] \d/.test(line))
  for (const row of implementers) assert.ok(!/\[\d+(\.\d+)?[,\]]/.test(row.replace(/^\s+\[\d+\]/, '')), row)
  assert.ok(!lines.some(line => line.includes('skip')), lines.join('\n'))
})

test('the manifest joins a briefing sha by label when it names the run', () => {
  const sha = 'a'.repeat(12) + 'b'.repeat(52)
  const manifest = {
    schema: 'interlock.run/1',
    runId: RUN_ID,
    dispatched: [{ wave: 1, label: '1.7', kind: 'implementer', model: 'sonnet', sha }]
  }
  const lines = drawRunBoard(run({ manifest: { value: manifest, read: 'ok' } }), WIDE)
  assert.ok(lines[0].includes('run.json: this run'), lines[0])
  assert.ok(lines[at(lines, '[6] 1.7')].includes(`sha ${sha.slice(0, 12)}`))
  assert.ok(lines[at(lines, '[7] 1.4')].includes('sha not recorded'))
})

test('records draw by sequence number, and what is not drawn is counted', () => {
  assert.deepEqual(drawRunBoard(run({ records: [...RECORDS].reverse() }), WIDE), drawRunBoard(run(), WIDE))

  const lines = drawRunBoard(
    run({
      records: [...RECORDS, { type: 'future-type', seq: 27 }, { type: 'run-start' }],
      skipped: [{ line: 3, reason: 'Unexpected token' }]
    }),
    WIDE
  )
  for (const part of ['1 unsequenced', '1 unknown type', '1 unreadable line']) {
    assert.ok(lines[0].includes(part), `${lines[0]} lacks ${part}`)
  }
  assert.deepEqual(lines.slice(1), drawRunBoard(run(), WIDE).slice(1))
})

test('the run board reads its widths from the published limits', () => {
  const narrow = drawRunBoard(run(), { columns: LIMITS.waveBoardMinColumns - 1 })
  assert.equal(narrow.length, 1)
  assert.ok(narrow[0].includes(String(LIMITS.waveBoardMinColumns)), narrow[0])
  for (const line of drawRunBoard(run(), { columns: 80 })) assert.ok([...line].length <= 80, line)
})

test('the real trajectory renders to a flowchart with packets on the edge into wave position 1', () => {
  const lines = drawRunMermaid(run())
  assert.equal(lines[0], 'flowchart TD')
  assert.ok(lines[1].trim().startsWith('%% source:'), lines[1])
  const into = lines.find(line => /-->\|.*\| n14\b/.test(line))
  assert.ok(into, lines.join('\n'))
  assert.ok(into.includes('record-verify'), into)
  for (const pair of ['1.7 ok/confirmed', '1.4 ok/confirmed', '1.2 ok/confirmed', '1.3 partial/confirmed']) {
    assert.ok(into.includes(pair), `${into} lacks ${pair}`)
  }
  assert.ok(!lines.some(line => /\bstyle\b|classDef|\bclass |linkStyle|:::/.test(line)), lines.join('\n'))
})
