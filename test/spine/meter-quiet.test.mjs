// The ship meter's quiet figure, as a rule (spec: hooks/ship-meter — the quiet
// figure; show-quiet-time-and-reset-the-meter-on-clear design D3).
//
// The hooks module shows the word; this module decides it, over two stamps and
// the published cap. Both failure directions are asserted head-on: a figure the
// module could not read must come out as no figure (`null`), never a guessed
// zero or a negative wait, and the word must not appear one millisecond early.
// The module's engine behaviour (the interval, the stamps, the three places the
// word is drawn) is tested by `test/mod/meter.test.ts` under `claude plugin test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS } from '../../lib/limits.mjs'
import { TICK_MS, quietMs, quietWord } from '../../lib/meter-quiet.mjs'

const T0 = Date.parse('2026-10-05T06:35:01.000Z')
const MINUTE = 60 * 1000

test('quietMs is the time since the last activity', () => {
  assert.equal(quietMs(T0, T0 + 1234), 1234)
  assert.equal(quietMs(T0, T0), 0)
})

test('quietMs is null for a stamp or a time it does not have', () => {
  assert.equal(quietMs(null, T0), null)
  assert.equal(quietMs(T0, null), null)
  assert.equal(quietMs(undefined, T0), null)
  assert.equal(quietMs(String(T0), T0 + 1), null)
  assert.equal(quietMs(T0, String(T0 + 1)), null)
  assert.equal(quietMs(Number.NaN, T0), null)
  assert.equal(quietMs(T0, Number.POSITIVE_INFINITY), null)
})

test('quietMs is never negative when the clock went backwards', () => {
  assert.equal(quietMs(T0, T0 - 5000), 0)
})

test('quietWord says nothing below the cap, and nothing for no figure', () => {
  assert.equal(quietWord(null), null)
  assert.equal(quietWord(0), null)
  assert.equal(quietWord(LIMITS.meterQuietAfterMs - 1), null)
})

test('quietWord names the whole minutes from the cap exactly', () => {
  const minutes = Math.floor(LIMITS.meterQuietAfterMs / MINUTE)
  assert.equal(quietWord(LIMITS.meterQuietAfterMs), `quiet ${minutes} min`)
  assert.equal(quietWord(LIMITS.meterQuietAfterMs + MINUTE - 1), `quiet ${minutes} min`)
  assert.equal(quietWord(LIMITS.meterQuietAfterMs + MINUTE), `quiet ${minutes + 1} min`)
})

test('quietWord floors a large figure and says <1 under a minute', () => {
  assert.equal(quietWord(10 * 60 * MINUTE + 59 * 1000, 0), 'quiet 600 min')
  assert.equal(quietWord(59 * 1000, 0), 'quiet <1 min')
  assert.equal(quietWord(0, 0), 'quiet <1 min')
  assert.equal(quietWord(30 * 1000, 31 * 1000), null)
})

test('the tick is the published period', () => {
  assert.equal(TICK_MS, LIMITS.meterTickMs)
})
