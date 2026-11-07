// What `interlock run-log follow` decides, called with a clock passed in.
//
// ship/run-follow: one line when the followed run halts or completes, exit 0
// after either; the give-up at the age bound, exit 1; nothing for a run at work.
// The reader makes every decision here without a real wait (design D15, D19).
// The CLI glue that reads the file and sleeps is tested in
// run-follow-cli.test.mjs once the verb exists.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { followStep } from '../../lib/run-follow.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const NOW = Date.parse('2026-11-07T12:00:00Z')
const HOUR = 60 * 60 * 1000
// A bound the test passes in; the module holds none.
const MAX_AGE = 24 * HOUR

const start = { seq: 1, ts: '2026-11-07T10:00:00.000Z', runId: 'r-7', change: 'add-foo', type: 'run-start' }
const spawn = { seq: 2, ts: '2026-11-07T10:05:00.000Z', runId: 'r-7', change: 'add-foo', type: 'agent-spawn' }
const clock = (over = {}) => ({ skipped: 0, lastWriteMs: NOW - 20 * 60 * 1000, nowMs: NOW, maxAgeMs: MAX_AGE, ...over })

test('a halt names the run, the change, the word halted and the recorded reason, exits 0, and ends as a record', () => {
  const halt = { seq: 3, ts: '2026-11-07T10:30:00.000Z', runId: 'r-7', change: 'add-foo', type: 'run-halt', reason: 'unit failures after 2 fix attempts' }
  const step = followStep([start, spawn, halt], clock())
  assert.equal(step.done, true)
  assert.equal(step.exit, 0)
  for (const token of ['r-7', 'add-foo', 'halted', 'unit failures after 2 fix attempts']) {
    assert.ok(step.line.includes(token), `the halt line names ${token}: ${step.line}`)
  }
  assert.match(step.line, /record[^.]*asks for no relaunch\.$/)
  assert.ok(!step.line.includes('\n'), 'one line')
})

test('a complete run names the run, the change and complete, exits 0 and asks for nothing', () => {
  const done = { seq: 3, ts: '2026-11-07T10:30:00.000Z', runId: 'r-8', change: 'fix-baz', type: 'run-complete' }
  const step = followStep([{ ...start, runId: 'r-8', change: 'fix-baz' }, done], clock())
  assert.deepEqual({ done: step.done, exit: step.exit }, { done: true, exit: 0 })
  for (const token of ['r-8', 'fix-baz', 'complete']) assert.ok(step.line.includes(token), step.line)
  assert.doesNotMatch(step.line, /relaunch/)
})

test('a run at work prints nothing, however long the last event is behind and under the age bound', () => {
  for (const lastWriteMs of [NOW, NOW - 20 * 60 * 1000, NOW - 3 * HOUR, NOW - MAX_AGE]) {
    const step = followStep([start, spawn], clock({ lastWriteMs }))
    assert.deepEqual(step, { done: false, exit: null, line: null })
  }
  // Three polling periods later with nothing appended: still nothing.
  assert.equal(followStep([start, spawn], clock({ nowMs: NOW + 45_000 })).done, false)
})

test('a trajectory not written for longer than the bound, with no end, is given up on aloud with exit 1', () => {
  const step = followStep([start, spawn], clock({ lastWriteMs: NOW - MAX_AGE - 1 }))
  assert.equal(step.done, true)
  assert.equal(step.exit, 1)
  for (const token of ['r-7', 'add-foo', '2026-11-07T10:05:00.000Z', 'no end']) {
    assert.ok(step.line.includes(token), `the give-up line names ${token}: ${step.line}`)
  }
  assert.match(step.line, /Stopped following/)
})

test('the give-up falls back to the file time when no event carries one', () => {
  const lastWriteMs = NOW - MAX_AGE - 5000
  const step = followStep([{ type: 'run-start', runId: 'r-1', change: 'c' }], clock({ lastWriteMs }))
  assert.equal(step.exit, 1)
  assert.ok(step.line.includes(new Date(lastWriteMs).toISOString()), step.line)
})

test('a terminal event beats the age bound: a stale halted run is reported as halted', () => {
  const halt = { ...start, type: 'run-halt', reason: 'because' }
  const step = followStep([start, halt], clock({ lastWriteMs: NOW - 5 * MAX_AGE }))
  assert.equal(step.exit, 0)
  assert.match(step.line, /halted/)
})

test('the bound is the caller\'s: without one the follower never gives up', () => {
  for (const over of [{ maxAgeMs: undefined }, { maxAgeMs: NaN }, { nowMs: undefined }, { lastWriteMs: null }]) {
    assert.equal(followStep([start, spawn], clock({ lastWriteMs: NOW - 100 * MAX_AGE, ...over })).done, false)
  }
})

test('skipped lines are counted into the line the verb ends on, as a number or as the reader\'s list', () => {
  const done = { ...start, type: 'run-complete' }
  assert.match(followStep([done], clock({ skipped: 2 })).line, /2 unparseable lines were skipped/)
  assert.match(followStep([done], clock({ skipped: [{ line: 1 }, { line: 3 }] })).line, /2 unparseable lines were skipped/)
  assert.match(followStep([done], clock({ skipped: 1 })).line, /1 unparseable line was skipped/)
  assert.doesNotMatch(followStep([done], clock({ skipped: 0 })).line, /skipped/)
  const halt = { ...start, type: 'run-halt', reason: 'r' }
  const line = followStep([halt], clock({ skipped: 2 })).line
  assert.match(line, /2 unparseable lines were skipped/)
  assert.match(line, /asks for no relaunch\.$/, 'the halt line still ends as a record')
})

test('a halt with no reason says none was recorded, and a record with no change says so', () => {
  const step = followStep([{ type: 'run-halt', runId: 'r-1' }], clock())
  assert.match(step.line, /halted: no reason recorded/)
  assert.match(step.line, /change not recorded/)
})

test('a reason with newlines stays one line', () => {
  const step = followStep([{ ...start, type: 'run-halt', reason: 'a\nb\n  c' }], clock())
  assert.ok(step.line.includes('halted: a b c'))
  assert.ok(!step.line.includes('\n'))
})

test('empty, junk and non-array input is a run at work or a give-up, and never throws', () => {
  for (const bad of [undefined, null, 'x', 7, {}, [], [null, 7, 'x']]) {
    assert.deepEqual(followStep(bad, clock()), { done: false, exit: null, line: null })
  }
  assert.equal(followStep([], clock({ lastWriteMs: NOW - MAX_AGE - 1 })).exit, 1)
  assert.doesNotThrow(() => followStep([start], undefined))
})

test('the module imports nothing and spells no number of milliseconds', () => {
  const source = readFileSync(join(ROOT, 'lib', 'run-follow.mjs'), 'utf8')
  assert.ok(!/^\s*import\b/m.test(source), 'lib/run-follow.mjs has an import')
  assert.ok(!source.includes('node:'), 'lib/run-follow.mjs names a node: module')
  const code = source.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.ok(!/\b\d{4,}\b|\*\s*1000|\b60\s*\*/.test(code), 'lib/run-follow.mjs spells a number of milliseconds')
})
