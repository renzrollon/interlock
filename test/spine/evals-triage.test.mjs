// Eval triage classifies a results run without a model, and the exit code is
// the verdict. Each test below pins one branch of the triage contract: a
// deterministic failure is a regression on one run; a judged-only dip on a
// single run is variance; a judged grader failing a majority of runs is a
// regression; an incomplete run is no signal; zero or unloadable cases is a
// configuration problem. The exit codes for no-signal and configuration are
// non-zero on purpose so neither reads as a clean pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triage, formatTriage, EXIT } from '../../lib/evals-triage.mjs'

const det = (name, passed) => ({ name, type: 'pattern', passed })
const judge = (name, passed) => ({ name, judged: true, passed })
const run = (...graders) => ({ graders })

test('a deterministic grader failure is a regression on a single run', () => {
  const r = triage({
    cases: [{ id: 'tier-read-scope', runs: [run(det('reads-bounded', false))] }]
  })
  assert.equal(r.verdict, 'regression')
  assert.equal(r.exitCode, EXIT.regression)
  assert.equal(r.exitCode, 1)
  assert.equal(r.cases[0].classification, 'regression')
  // the output names which grader failed
  assert.ok(r.cases[0].graders.includes('reads-bounded'))
  assert.match(formatTriage(r), /reads-bounded/)
})

test('a judged-only dip on a single run is variance, and states what confirms it', () => {
  const r = triage({
    cases: [{ id: 'semantic-case', runs: [run(judge('meaning', false), det('shape', true))] }]
  })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.exitCode, 0)
  assert.equal(r.cases[0].classification, 'variance')
  assert.ok(r.cases[0].confirm && /further runs/.test(r.cases[0].confirm))
  // variance is still reported even though the exit code is zero
  assert.match(formatTriage(r), /variance/)
})

test('a judged grader failing a majority of runs is a regression', () => {
  const r = triage({
    cases: [
      {
        id: 'semantic-case',
        runs: [run(judge('meaning', false)), run(judge('meaning', false)), run(judge('meaning', true))]
      }
    ]
  })
  assert.equal(r.verdict, 'regression')
  assert.equal(r.exitCode, 1)
  assert.equal(r.cases[0].classification, 'regression')
  assert.ok(r.cases[0].graders.includes('meaning'))
})

test('a judged grader failing a minority of runs is variance, not a regression', () => {
  const r = triage({
    cases: [
      {
        id: 'semantic-case',
        runs: [run(judge('meaning', false)), run(judge('meaning', true)), run(judge('meaning', true))]
      }
    ]
  })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.cases[0].classification, 'variance')
  assert.match(r.cases[0].confirm, /majority/)
})

test('all graders passing is a clean pass', () => {
  const r = triage({
    cases: [{ id: 'ok-case', runs: [run(det('shape', true), judge('meaning', true))] }]
  })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.exitCode, 0)
  assert.equal(r.cases[0].classification, 'pass')
})

test('a skill-fired indicator grader never causes a regression', () => {
  const r = triage({
    cases: [
      {
        id: 'skill-routing',
        runs: [run({ name: 'ship-fired', type: 'indicator', passed: false }, det('routed', true))]
      }
    ]
  })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.cases[0].classification, 'pass')
})

test('a partial run is no signal and classifies nothing', () => {
  const r = triage({ partial: true, reason: 'interrupted', cases: [{ id: 'x', runs: [run(det('a', false))] }] })
  assert.equal(r.verdict, 'no_signal')
  assert.equal(r.exitCode, EXIT.no_signal)
  assert.equal(r.exitCode, 2)
  assert.notEqual(r.exitCode, 0) // distinguishable from a clean pass
  assert.equal(r.cases.length, 0)
  assert.match(formatTriage(r), /no signal/)
})

test('a rejected credential is no signal, not a suite failure', () => {
  const r = triage({ partial_reason: 'credential_rejected', cases: [] })
  assert.equal(r.verdict, 'no_signal')
  assert.equal(r.reason, 'credential_rejected')
  assert.equal(r.exitCode, 2)
})

test('zero cases is a configuration problem, not a pass', () => {
  const r = triage({ cases: [] })
  assert.equal(r.verdict, 'configuration')
  assert.equal(r.exitCode, EXIT.configuration)
  assert.equal(r.exitCode, 3)
  assert.notEqual(r.exitCode, 0)
})

test('an unloadable case is named separately, and all-unloadable is a configuration problem', () => {
  const r = triage({ cases: [{ id: 'broken', loaded: false }] })
  assert.equal(r.verdict, 'configuration')
  assert.equal(r.exitCode, 3)
  assert.ok(r.unloadable.includes('broken'))
})

test('an unloadable case alongside scored cases is reported but does not block scoring', () => {
  const r = triage({
    cases: [
      { id: 'broken', loaded: false },
      { id: 'ok-case', runs: [run(det('shape', true))] }
    ]
  })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.exitCode, 0)
  assert.ok(r.unloadable.includes('broken'))
  assert.equal(r.cases.length, 1)
})

test('the verdict is reproducible from the same input', () => {
  const input = { cases: [{ id: 'c', runs: [run(det('a', false)), run(judge('b', false))] }] }
  assert.deepEqual(triage(input), triage(input))
})
