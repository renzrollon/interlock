// The ship meter's refusal words (speak-permission-prompts-and-guard-denials
// design D6): the guard names a denial is read by, the slice the toast
// repeats, and the pane lines. Pure text rules, so they are pinned here under
// Node; the hooks module's use of them is `test/mod/meter.test.ts`'s.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GUARD_NAMES, guardDenialLine, guardOf, guardReason, launchGuardLine } from '../../lib/meter-refusals.mjs'
import { decideLaunch, denyReason } from '../../lib/launch-rule.mjs'
import { denyText } from '../fixtures/mod/refusals.mjs'

const REASON = {
  'guard-tests': 'guard-tests: editing the test file lib/x.test.mjs is blocked during the remediation stage — fix the code.',
  'guard-tasks': 'guard-tasks: changing a checkbox line in tasks.md is blocked during a ship run (stage implement).',
  'guard-commit': 'guard-commit: `git commit` is blocked during the verify stage of a ship run.',
  'guard-relaunch': denyReason('2026-10-05T06:00:00.000Z')
}

test('the guard names are the four guards, in the order they are documented', () => {
  assert.deepEqual(GUARD_NAMES, ['guard-tests', 'guard-tasks', 'guard-commit', 'guard-relaunch'])
})

test('a reason is read from the guard\'s name on, at the start of the text and behind the engine\'s prefix', () => {
  for (const name of GUARD_NAMES) {
    assert.equal(guardReason(REASON[name]), REASON[name], name)
    assert.equal(guardReason(denyText(REASON[name], 'Edit')), REASON[name], `${name} behind the prefix`)
    assert.equal(guardOf(guardReason(denyText(REASON[name]))), name)
  }
})

test('a text that names no guard reads as no reason', () => {
  for (const text of [undefined, null, 7, {}, '', 'another plugin said no', 'Exit code 1', 'guard-tests without its colon', 'guard-testsx: no', 'guard-probe: PROBE-DENY-REACHED']) {
    assert.equal(guardReason(text), null, String(text))
  }
  assert.equal(guardOf(null), null)
  assert.equal(guardOf('another plugin said no'), null)
})

test('the guard-denial line counts by guard in first-seen order, and is absent with none', () => {
  assert.equal(guardDenialLine(new Map()), null)
  assert.equal(guardDenialLine(undefined), null)
  assert.equal(
    guardDenialLine(new Map([['guard-tests', 1], ['guard-commit', 1]])),
    'guard denials: 2 (guard-tests 1, guard-commit 1)'
  )
  assert.equal(guardDenialLine(new Map([['guard-commit', 3]])), 'guard denials: 3 (guard-commit 3)')
})

test('the launch-guard line is the rule\'s ruling, or says the facts were unreadable', () => {
  const at = '2026-10-05T06:35:01.000Z'
  const now = Date.parse(at) + 1000
  const allowed = decideLaunch({ launches: [] }, now)
  const refusing = decideLaunch({ launches: [{ at }] }, now)
  assert.equal(refusing.decision, 'deny')
  assert.equal(launchGuardLine(allowed, now), 'launch guard: next launch allowed')
  assert.equal(launchGuardLine(refusing, now), `launch guard: next launch refused: ${denyReason(at)}`)
  assert.equal(launchGuardLine(allowed, null), 'launch guard: facts unreadable; the next launch is allowed')
})
