// The caps are the product's spine, so the tests here are less about arithmetic
// than about the property that makes centralising them worth anything: every
// cap is a positive integer, nothing silently disappears, and a caller asking
// for more parallelism than the workflow runtime allows gets clamped rather
// than a failed run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LIMITS,
  EVAL_CAPS,
  RUNTIME,
  EFFORT,
  LANE_CAPS,
  SOLO,
  clampParallel,
  formatLimits
} from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('every cap is a positive integer', () => {
  for (const [name, value] of Object.entries(LIMITS)) {
    assert.equal(typeof value, 'number', `${name} must be a number`)
    assert.ok(Number.isInteger(value), `${name} must be an integer`)
    assert.ok(value > 0, `${name} must be positive`)
  }
})

test('the documented ship caps are the ones the prose promised', () => {
  // These four were prose in skills/ship/SKILL.md before they lived here. If one
  // changes, that is a product decision and this assertion should be updated
  // deliberately — not a refactor that quietly moved a number.
  assert.equal(LIMITS.remediationRounds, 2)
  assert.equal(LIMITS.interWaveFixAttempts, 2)
  assert.equal(LIMITS.replansPerRun, 2)
  assert.equal(LIMITS.rootCauseIterations, 5)
  assert.equal(LIMITS.taskFailureHalt, 2)
  assert.equal(LIMITS.interWaveVerifications, 3)
})

test('the spill caps match design.md — 8192 byte threshold, 4096 char preview', () => {
  // add-ship-run-inspectability design.md §3 pins these numbers; lib/spill.mjs
  // falls back to the same defaults independently, so a drift here would leave
  // the two modules silently disagreeing.
  assert.equal(LIMITS.verifySpillBytes, 8192)
  assert.equal(LIMITS.verifyPreviewChars, 4096)
})

test('the wave handoff budget is pinned at 2000 characters', () => {
  // add-wave-handoff-and-prompt-snapshots design.md §2. Changing this is a
  // product decision about how much one wave may tell the next — update it here
  // deliberately, the same way remediationRounds would be.
  assert.equal(LIMITS.maxHandoffChars, 2000)
})

test('the default fan-out sits under the runtime concurrency ceiling', () => {
  assert.ok(
    LIMITS.maxParallel <= RUNTIME.maxConcurrentAgents,
    'default parallelism must not exceed what the workflow runtime will run'
  )
})

test('clampParallel falls back to the default for junk input', () => {
  for (const junk of [undefined, null, 0, -3, 2.5, '8', NaN]) {
    const got = clampParallel(junk)
    assert.equal(got.value, LIMITS.maxParallel)
    assert.equal(got.clamped, false)
    assert.equal(got.reason, null)
  }
})

test('clampParallel honours a reasonable request unchanged', () => {
  const got = clampParallel(4)
  assert.deepEqual(got, { value: 4, clamped: false, reason: null })
})

test('clampParallel clamps to the runtime ceiling and says why', () => {
  const got = clampParallel(40)
  assert.equal(got.value, RUNTIME.maxConcurrentAgents)
  assert.equal(got.clamped, true)
  assert.match(got.reason, /concurrent agents/)
})

test('formatLimits names every cap it prints', () => {
  const text = formatLimits()
  assert.match(text, /max parallel agents/)
  assert.match(text, /remediation rounds/)
  assert.match(text, new RegExp(String(RUNTIME.maxAgentsPerRun)))
  assert.match(text, /verify spill threshold/)
  assert.match(text, /verify preview budget/)
  assert.match(text, /inter-wave verifications/)
  // The handoff cap has to be readable from the CLI: the workflow prompt tells
  // implementers to look it up there rather than restating the number.
  assert.match(text, /wave handoff budget/)
  assert.match(text, new RegExp(String(LIMITS.maxHandoffChars)))
  assert.ok(text.endsWith('\n'))
})

// --- every printed cap is enforced by code (spec: ship/cap-authority) ------
//
// The failure this closes: `interlock limits` advertised two caps no code
// obeyed. `memoryEntriesPerRun` had zero references outside this module and
// its prose, and `verifySpillBytes` was read only by a test asserting it
// equals 8192. A printed cap that nothing reads is the same failure as a cap
// written in prose — which is the failure this module was created to end.
//
// A test that pins a cap's VALUE is deliberately not counted as a reader. That
// is what let the spill threshold look alive: it exercises the number, not the
// behaviour the number governs.
//
// The check covers every cap group the limits surface prints, not only LIMITS.
// EVAL_CAPS used to be exempt on the grounds that its readers lived in CI YAML
// the test could not see — it could, it just did not walk `.github/workflows/`.
// Two properties make walking it work (design D5):
//
//   - Two accepted tokens per cap. A lib/bin/workflows reader names a cap as
//     `<GROUP>.<cap>`; a CI reader names it as `<published>.<cap>`, the field
//     the CLI publishes (`bin/interlock` emits EVAL_CAPS as `evals`). Matching
//     only one form would fail one whole group on day one.
//   - The bare group name never counts. `bin/interlock` contains
//     `evals: EVAL_CAPS`, a whole-group forward to the printed surface; a
//     matcher that accepted the bare identifier would find it there and mark
//     every eval cap read, restoring exactly the blindness being removed.
//
// REPORT_CAPS and EFFORT stay outside this check: neither has been reported as
// unread, and widening the sweep further is a separate judgement.

test('every cap the limits surface prints is read by the code path it governs', () => {
  const dirs = ['lib', 'bin', 'workflows', join('.github', 'workflows')]
  // The limits definition names every cap it prints, so counting it as a reader
  // would make this check vacuous. It is the one exclusion.
  const SELF = join(ROOT, 'lib', 'limits.mjs')
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (path !== SELF) sources.push(readFileSync(path, 'utf8'))
    }
  }
  for (const dir of dirs) {
    const root = join(ROOT, dir)
    // A missing `.github/workflows/` is not an excuse: the eval caps lose their
    // readers and this check fails naming them, which is the correct outcome and
    // duplicates the tracked-workflow assertion rather than conflicting with it.
    if (existsSync(root)) walk(root)
  }

  // `tokens` builds every form a legitimate reader may name a cap by. LIMITS has
  // only code readers, so the export name is the whole vocabulary. EVAL_CAPS is
  // read from CI too, where the reader parses `interlock limits --json` and
  // names the published field (`evals.<cap>`) rather than the export.
  const groups = [
    { name: 'LIMITS', caps: LIMITS, tokens: cap => [`LIMITS.${cap}`] },
    { name: 'EVAL_CAPS', caps: EVAL_CAPS, tokens: cap => [`EVAL_CAPS.${cap}`, `evals.${cap}`] },
    // The lane-cap table and the solo envelope join the sweep on the same terms:
    // every entry printed by `interlock limits` must be read by the planning code
    // path. `byTier` counts as one cap — it is read as a table, and requiring a
    // reader per tier would only invite five `LANE_CAPS.byTier[n]` lookups
    // written to satisfy a test.
    { name: 'LANE_CAPS', caps: LANE_CAPS, tokens: cap => [`LANE_CAPS.${cap}`, `laneCaps.${cap}`] },
    { name: 'SOLO', caps: SOLO, tokens: cap => [`SOLO.${cap}`, `solo.${cap}`] }
  ]
  const unread = []
  for (const group of groups) {
    for (const cap of Object.keys(group.caps)) {
      const tokens = group.tokens(cap)
      if (!sources.some(text => tokens.some(token => text.includes(token)))) {
        unread.push(`${group.name}.${cap}`)
      }
    }
  }
  assert.deepEqual(
    unread,
    [],
    `these caps are printed but nothing reads them: ${unread.join(', ')}. ` +
      `Wire each to the path it governs, or remove it from its cap group and from the ` +
      `printed surface together — a cap with no reader is a cap written in prose.`
  )
})

// --- effort routing defaults (spec: effort-routing/published-not-restated) --
//
// The effort table lives beside the caps for the same reason they do: a mapping
// written twice drifts. It is a separate export from LIMITS because LIMITS holds
// positive-integer iteration counts (the invariant above), and effort is a
// tier→string table — so `interlock limits` is where an operator reads it.

test('the effort defaults are the ones the design pinned', () => {
  // D2 of add-lane-effort-routing. Changing one of these re-routes reasoning
  // effort across the fleet — a product decision, updated here deliberately.
  assert.deepEqual(EFFORT.byTier, { 1: 'low', 2: 'low', 3: null, 4: null, 5: 'xhigh' })
  assert.equal(EFFORT.verify, 'xhigh')
  assert.equal(EFFORT.skeptic, 'xhigh')
})

test('interlock limits surfaces the tier→effort mapping and the fixed step effort', () => {
  const text = formatLimits()
  assert.match(text, /effort: tier 1 lane\s+low/)
  assert.match(text, /effort: tier 5 lane\s+xhigh/)
  // Tiers 3 and 4 emit no override; the surface says "inherit", never a number
  // that would read as a forced effort.
  assert.match(text, /effort: tier 3 lane\s+inherit/)
  assert.match(text, /effort: inter-wave verify step\s+xhigh/)
  assert.match(text, /effort: review skeptic step\s+xhigh/)
})

// --- lane caps and the solo envelope (spec: solo-mode, lanes) --------------
//
// Pinned the way the effort table is: these are the values D2 and D6 of
// add-lane-cohesion-and-solo-mode chose, and changing one re-shapes every plan
// the fleet builds. That is a product decision, updated here deliberately — not
// a refactor that quietly moved a number.

test('the lane-cap table and cohesion ceiling are the ones the design pinned', () => {
  assert.deepEqual(LANE_CAPS.byTier, { 1: 8, 2: 8, 3: 6, 4: 4, 5: 8 })
  assert.equal(LANE_CAPS.cohesionMaxTier, 3)
})

test('the solo envelope is the one the design pinned', () => {
  assert.equal(SOLO.maxTasks, 20)
})

test('interlock limits prints every tier cap, the cohesion ceiling and the solo envelope', () => {
  const text = formatLimits()
  for (const tier of [1, 2, 3, 4, 5]) {
    assert.match(
      text,
      new RegExp(`lane cap: tier ${tier} lane[^\\n]*\\s${LANE_CAPS.byTier[tier]}\\s*$`, 'm'),
      `the tier-${tier} lane cap must be printed`
    )
  }
  assert.match(text, new RegExp(`cohesion tier ceiling[^\\n]*\\s${LANE_CAPS.cohesionMaxTier}\\s*$`, 'm'))
  assert.match(text, new RegExp(`solo envelope[^\\n]*\\s${SOLO.maxTasks}\\s*$`, 'm'))
})

test('the scalar lane cap is gone from the object and from the printed surface together', () => {
  // It was replaced by LANE_CAPS.byTier rather than aliased to it: an alias
  // would let one reader keep the scalar while the rest read the table, and the
  // two would disagree silently about how long a lane may get.
  assert.ok(
    !('maxTasksPerAgent' in LIMITS),
    'maxTasksPerAgent was replaced by LANE_CAPS.byTier; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /max tasks per agent/)
})

test('a removed cap is gone from the object and from the printed surface together', () => {
  assert.ok(
    !('memoryEntriesPerRun' in LIMITS),
    'memoryEntriesPerRun has no enforcement point; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /memory entries/)

  // `reportingThreshold` described a score at or above which a case reported as
  // passing. lib/evals-triage.mjs reads no score — classifyCase branches on each
  // grader's `passed` boolean — so there was no path it could govern without
  // inventing one, and it went the same way memoryEntriesPerRun did.
  assert.ok(
    !('reportingThreshold' in EVAL_CAPS),
    'reportingThreshold governs no triage path; it must not be advertised'
  )
  assert.doesNotMatch(formatLimits(), /reporting threshold/)
})
