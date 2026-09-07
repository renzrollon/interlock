// Promotion decides whether an eval case may fail a build. Two properties carry
// the weight here: pass^k is not pass@k (eventual success is not success), and
// "not enough evidence" never reads as "the evidence says no" — which is why
// insufficient history has its own exit code rather than sharing the refusal's.
//
// Every number the rule turns on comes from EVAL_CAPS, so the fixtures below are
// built from the caps rather than from literals: changing a cap must change what
// these tests demand, not break them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promote, formatPromotion, EXIT } from '../../lib/evals-promote.mjs'
import { EVAL_CAPS } from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUNS = EVAL_CAPS.promotionRuns
const TRIALS = EVAL_CAPS.promotionTrialsPerRun

/** One history entry: a parsed record with the given cases and triage verdict. */
function run(file, cases, triage = 'pass') {
  return { file, record: { run_id: file, triage, cases } }
}

/** A case that passed every trial of a run. */
const clean = (id, extra = {}) => ({ id, trials: TRIALS, passed: TRIALS, ...extra })

/** The minimum window of qualifying runs in which one case passes cleanly. */
function cleanWindow(id, extra = {}) {
  return Array.from({ length: RUNS }, (_, i) => run(`run-${i + 1}.json`, [clean(id, extra)]))
}

test('a case that passed every trial of every qualifying run is promotable', () => {
  const result = promote({ history: cleanWindow('handoff-status-enum') })
  assert.equal(result.verdict, 'promotable')
  assert.equal(result.exitCode, EXIT.promotable)
  assert.deepEqual(result.cases.map(c => [c.id, c.promotable]), [['handoff-status-enum', true]])
  assert.match(formatPromotion(result), /the exit code is the verdict/)
})

test('an intermittent case is refused, and the reason names the run it failed in', () => {
  // pass^k, not pass@k. Passing twice and failing once is not "eventually
  // passing", it is a case whose verdict cannot be trusted to block anyone.
  const history = cleanWindow('skill-routing')
  history[1] = run('run-2.json', [{ id: 'skill-routing', trials: TRIALS, passed: TRIALS - 1 }])
  const result = promote({ history })
  assert.equal(result.verdict, 'refused')
  assert.equal(result.exitCode, EXIT.refused)
  const kase = result.cases[0]
  assert.equal(kase.promotable, false)
  assert.match(kase.reason, /run-2\.json/, 'the refusal must name the run it failed in')
  assert.match(formatPromotion(result), /refused\s+skill-routing/)
})

test('a run with too few trials cannot serve as evidence, and says so by name', () => {
  const history = cleanWindow('tier-read-scope')
  history[0] = run('run-1.json', [{ id: 'tier-read-scope', trials: 1, passed: 1 }])
  const result = promote({ history })
  assert.equal(result.verdict, 'refused')
  assert.match(result.cases[0].reason, /run-1\.json carried 1 trial/)
})

test('a no-signal run is excluded and named, and does not count toward the window', () => {
  // A run that did not complete is missing evidence, not evidence against. It
  // does not fail the case — it fails to be evidence, which leaves the window
  // one short and the decision undecidable.
  const history = cleanWindow('handoff-status-enum')
  history[1] = run('run-2.json', [], 'no_signal')
  const result = promote({ history })
  assert.equal(result.verdict, 'insufficient_history')
  assert.equal(result.exitCode, EXIT.insufficient_history)
  assert.deepEqual(result.excluded.map(e => e.file), ['run-2.json'])
  const text = formatPromotion(result)
  assert.match(text, /excluded\s+run-2\.json/)
  assert.match(text, /does not break the chain/)
  assert.match(text, /this is not a refusal/)
})

test('a configuration run is excluded on the same terms as a no-signal one', () => {
  const history = [...cleanWindow('c'), run('run-x.json', [], 'configuration')]
  const result = promote({ history })
  // The clean window is still intact behind the excluded run.
  assert.equal(result.verdict, 'promotable')
  assert.deepEqual(result.excluded.map(e => e.verdict), ['configuration'])
})

test('an empty history reports insufficient, never success', () => {
  const result = promote({ history: [] })
  assert.equal(result.verdict, 'insufficient_history')
  assert.equal(result.exitCode, EXIT.insufficient_history)
  assert.deepEqual(result.cases, [], 'no case may be reported promotable on no evidence')
  assert.match(result.reason, /no records/)
})

test('a history too short to fill the window reports insufficient, never refusal', () => {
  const result = promote({ history: cleanWindow('c').slice(0, RUNS - 1) })
  assert.equal(result.exitCode, EXIT.insufficient_history)
  assert.notEqual(result.exitCode, EXIT.refused)
  assert.match(result.reason, new RegExp(`requires ${RUNS} consecutive`))
})

test('an unparseable entry is named and stated as excluded, never treated as absent', () => {
  const history = [...cleanWindow('c'), { file: 'run-bad.json', error: 'unparseable (bad json)' }]
  const result = promote({ history })
  assert.deepEqual(result.unreadable.map(u => u.file), ['run-bad.json'])
  assert.match(formatPromotion(result), /unreadable\s+run-bad\.json/)
  assert.match(formatPromotion(result), /excluded from the decision/)
})

test('every entry unreadable reports insufficient history rather than success', () => {
  const history = [
    { file: 'a.json', error: 'unparseable' },
    { file: 'b.json', error: 'unparseable' }
  ]
  const result = promote({ history })
  assert.equal(result.exitCode, EXIT.insufficient_history)
  assert.match(result.reason, /no history entry could be parsed/)
  assert.equal(result.cases.length, 0)
})

test('a judged case with agreement at the floor is promotable', () => {
  const history = cleanWindow('trampoline-halt', { judged_graders: ['halts-and-explains'] })
  const result = promote({
    history,
    agreement: { 'trampoline-halt/halts-and-explains': EVAL_CAPS.judgeAgreementFloor }
  })
  assert.equal(result.verdict, 'promotable')
  assert.deepEqual(result.cases[0].judgedGraders, ['trampoline-halt/halts-and-explains'])
})

test('a judged case with no agreement measurement is refused, naming the grader', () => {
  // Refused DISTINCTLY from insufficient history: the run history is complete
  // and clean, and what is missing is a fact about this grader.
  const history = cleanWindow('trampoline-halt', { judged_graders: ['halts-and-explains'] })
  const result = promote({ history, agreement: {} })
  assert.equal(result.verdict, 'refused')
  assert.equal(result.exitCode, EXIT.refused)
  assert.notEqual(result.exitCode, EXIT.insufficient_history)
  assert.match(result.cases[0].reason, /halts-and-explains has no measured agreement/)
})

test('a judged case measured below the floor is refused, and reads differently from unmeasured', () => {
  const history = cleanWindow('trampoline-halt', { judged_graders: ['halts-and-explains'] })
  const low = Math.max(0, EVAL_CAPS.judgeAgreementFloor - 0.3)
  const result = promote({ history, agreement: { 'trampoline-halt/halts-and-explains': low } })
  assert.equal(result.verdict, 'refused')
  assert.match(result.cases[0].reason, /below the published floor/)
  assert.doesNotMatch(result.cases[0].reason, /no measured agreement/)
})

test('a deterministic case is unaffected by the absence of an agreement measurement', () => {
  const result = promote({ history: cleanWindow('tier-read-scope'), agreement: {} })
  assert.equal(result.verdict, 'promotable')
  assert.deepEqual(result.cases[0].judgedGraders, [])
})

test('a case absent from one qualifying run is refused, naming that run', () => {
  const history = cleanWindow('c')
  history[2] = run('run-3.json', [clean('other-case')])
  const result = promote({ history })
  const missing = result.cases.find(x => x.id === 'c')
  assert.equal(missing.promotable, false)
  assert.match(missing.reason, /absent from qualifying run run-3\.json/)
})

test('the same history yields the same verdict', () => {
  const history = cleanWindow('c')
  assert.deepEqual(promote({ history }), promote({ history }))
})

// --- the caps have readers on the day they land (design D5) ----------------

test('every promotion cap is read by lib/evals-promote.mjs by name', () => {
  // The failure this closes is the one sitting next to it: `runsPerCase` was
  // printed by `interlock limits` and read by nothing, and `reportingThreshold`
  // was removed rather than wired for the same reason. The repository-wide
  // cap-authority check in limits.test.mjs would catch a cap with no reader
  // anywhere; this is narrower and names the module the rule actually lives in,
  // so a cap wired to some unrelated file would not satisfy it.
  const source = readFileSync(join(ROOT, 'lib', 'evals-promote.mjs'), 'utf8')
  for (const cap of ['promotionRuns', 'promotionTrialsPerRun', 'judgeAgreementFloor']) {
    assert.ok(
      source.includes(`EVAL_CAPS.${cap}`),
      `EVAL_CAPS.${cap} is published by interlock limits but lib/evals-promote.mjs does not read it`
    )
  }
})
