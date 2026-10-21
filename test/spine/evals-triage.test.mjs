// Eval triage classifies a results run without a model, and the exit code is
// the verdict. Each test below pins one branch of the triage contract: a
// deterministic failure is a regression on one run; a judged-only dip on a
// single run is variance; a judged grader failing a majority of runs is a
// regression; an incomplete run is no signal; zero or unloadable cases is a
// configuration problem. The exit codes for no-signal and configuration are
// non-zero on purpose so neither reads as a clean pass.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

// The harness shape. The three tests below are the other half of the dual-read:
// the hand-built cases above pin the legacy `id` / `runs` shape, these pin what
// `claude plugin eval` actually writes at schemaVersion 1.

test('the committed 2026-09-04 smoke results file triages as a regression', () => {
  const fixture = fileURLToPath(new URL('../fixtures/evals/smoke-2026-09-04.json', import.meta.url))
  const results = JSON.parse(readFileSync(fixture, 'utf8'))
  const r = triage(results)

  // The run's own report: aggregates.casesPassed 3 of 4, tier-read-scope scored 0.
  assert.equal(r.verdict, 'regression')
  assert.equal(r.exitCode, EXIT.regression)
  assert.equal(r.exitCode, 1)

  const failed = r.cases.find(c => c.id === 'tier-read-scope')
  assert.ok(failed, 'the failing case is named by its harness `name`')
  assert.equal(failed.classification, 'regression')
  assert.ok(failed.graders.includes('no-design-read'))
  assert.ok(failed.graders.includes('no-spec-read'))

  const out = formatTriage(r)
  assert.match(out, /tier-read-scope/)
  assert.match(out, /no-design-read/)
  assert.match(out, /no-spec-read/)
})

test('a harness case scored from the with-only arm is classified', () => {
  const r = triage({
    cases: [{ name: 'ablation-only', arms: { 'with-only': [run(det('shape', false))] } }]
  })
  assert.equal(r.verdict, 'regression')
  assert.equal(r.exitCode, 1)
  assert.equal(r.cases[0].id, 'ablation-only')
  assert.ok(r.cases[0].graders.includes('shape'))
})

test('the without arm is the baseline and is not scored', () => {
  const r = triage({
    cases: [
      {
        name: 'compared-case',
        arms: { with: [run(det('ok', true))], without: [run(det('baseline-fail', false))] }
      }
    ]
  })
  assert.equal(r.verdict, 'pass')
  assert.equal(r.exitCode, 0)
  assert.equal(r.cases[0].classification, 'pass')
  assert.deepEqual(r.cases[0].graders, [])
})

test('the verdict is reproducible from the same input', () => {
  const input = { cases: [{ id: 'c', runs: [run(det('a', false)), run(judge('b', false))] }] }
  assert.deepEqual(triage(input), triage(input))
})

// --- one judged-type set, and the type join (spec: evals/triage) --------------
//
// The harness writes a trial grader as `{ name, passed }` with no `type`; the
// type lives on the case's own grader list. Without the join, the suite's first
// `llm` grader is classed as deterministic and its single-run dip reads as a
// regression.

const trial = (name, passed) => ({ name, passed })

test("a typeless trial grader takes its type from the case's grader list", () => {
  const r = triage({
    cases: [
      {
        name: 'spec-range-publish-npm',
        graders: [{ name: 'matches-label', type: 'llm' }, { name: 'check-ran', type: 'tool_used' }],
        arms: { with: [run(trial('matches-label', false), trial('check-ran', true))] }
      }
    ]
  })
  assert.equal(r.cases[0].classification, 'variance')
  assert.equal(r.verdict, 'pass')
  assert.equal(r.exitCode, EXIT.pass)
  assert.doesNotMatch(formatTriage(r), /type unknown/)
})

test("a baseline grader joined from the case's list is judged too", () => {
  const r = triage({
    cases: [
      {
        name: 'c',
        graders: [{ name: 'beats-baseline', type: 'baseline' }],
        arms: { with: [run(trial('beats-baseline', false))] }
      }
    ]
  })
  assert.equal(r.cases[0].classification, 'variance')
})

test('a typeless trial grader with no case list takes its type from the graderTypes map', () => {
  const results = {
    cases: [{ name: 'spec-range-publish-npm', arms: { with: [run(trial('matches-label', false))] } }]
  }
  const r = triage(results, { graderTypes: { 'spec-range-publish-npm': { 'matches-label': 'llm' } } })
  assert.equal(r.cases[0].classification, 'variance')
  assert.equal(r.exitCode, EXIT.pass)
})

test("the case's grader list wins over the graderTypes map", () => {
  const results = {
    cases: [
      {
        name: 'c',
        graders: [{ name: 'g', type: 'tool_used' }],
        arms: { with: [run(trial('g', false))] }
      }
    ]
  }
  const r = triage(results, { graderTypes: { c: { g: 'llm' } } })
  assert.equal(r.cases[0].classification, 'regression')
})

test('an untypable grader is treated as deterministic, and the output says so by name', () => {
  const results = { cases: [{ name: 'c', arms: { with: [run(trial('matches-label', false))] } }] }
  const r = triage(results)
  assert.equal(r.cases[0].classification, 'regression')
  assert.equal(r.exitCode, EXIT.regression)
  const line = formatTriage(r)
    .split('\n')
    .find(l => l.includes('matches-label') && l.includes('type unknown, treated as deterministic'))
  assert.ok(line, 'the output must name matches-label as `type unknown, treated as deterministic`')
})

test("the committed harness results join every grader's type from the case, so none is unknown", () => {
  const fixture = fileURLToPath(new URL('../fixtures/evals/smoke-2026-09-04.json', import.meta.url))
  const r = triage(JSON.parse(readFileSync(fixture, 'utf8')))
  assert.doesNotMatch(formatTriage(r), /type unknown/)
})

test('a legacy judged alias still classifies as judged', () => {
  const r = triage({ cases: [{ id: 'c', runs: [run({ name: 'meaning', type: 'semantic', passed: false })] }] })
  assert.equal(r.cases[0].classification, 'variance')
})

test('triage reads the shared judged set, spells none of its own, and imports no node: module', async () => {
  const { JUDGED_GRADER_TYPES, isJudgedType } = await import('../../lib/evals-types.mjs')
  for (const type of ['llm', 'baseline', 'judge', 'judged', 'model-judge', 'llm-judge', 'semantic']) {
    assert.ok(JUDGED_GRADER_TYPES.has(type), `JUDGED_GRADER_TYPES must carry ${type}`)
    assert.equal(isJudgedType(type), true)
  }
  for (const type of ['tool_used', 'regex', 'file_exists', 'tool_order', 'pattern']) {
    assert.equal(isJudgedType(type), false, `${type} is deterministic`)
  }
  const src = readFileSync(new URL('../../lib/evals-triage.mjs', import.meta.url), 'utf8')
  assert.match(src, /import\s*\{[^}]*\bJUDGED_GRADER_TYPES\b[^}]*\}\s*from\s*['"]\.\/evals-types\.mjs['"]/)
  assert.doesNotMatch(src, /from\s*['"]node:/, 'lib/evals-triage.mjs reads no file and imports no node: module')
  assert.doesNotMatch(
    src,
    /new Set\(\s*\[[^\]]*['"](?:llm|baseline|judge|judged|model-judge|llm-judge|semantic)['"]/,
    'lib/evals-triage.mjs must not spell its own judged set'
  )
})
