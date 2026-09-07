// The outcome eval's runner, its stated coverage, and its scheduled job
// (spec: evals/outcome-run).
//
// Offline throughout. Nothing here makes a model call, and nothing here needs a
// credential: what is asserted is the shape of the apparatus — that an
// unmeasured figure is recorded absent rather than zero, that a run which could
// not happen is not recorded as one that went badly, that the ceiling comes from
// the published limits, that the arm difference carries no verdict, and that the
// job which spends the money can never be triggered by a pull request.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVAL_CAPS, MODEL_PRICES } from '../../lib/limits.mjs'
import { applyReference, readFixture, readFixtures } from '../../evals/ship/fixtures.mjs'
import { AGENT_IDENTITY } from '../../evals/ship/agent/main.mjs'
import { DEFAULT_MODEL } from '../../evals/ship/agent/model.mjs'
import { priceUsage, readAgentUsage } from '../../evals/ship/arms.mjs'
import {
  ceilingStop,
  checkFixtureSolvable,
  differenceFor,
  measuresFor,
  modelUnderTest,
  preflight,
  prepareScratchRoot,
  readPublishedLimits,
  removeScratchRoot,
  selectAgent,
  versionUnderTest
} from '../../evals/ship/run.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const README = join(ROOT, 'evals', 'ship', 'README.md')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ship-outcome-eval.yml')

// --- the ceiling and the price table (spec: the eval is bounded) ------------

test('the runner reads its ceiling and price table from the published limits', () => {
  const { ceilingUsd, prices, reason } = readPublishedLimits()
  assert.equal(reason, null, `the published limits could not be read: ${reason}`)
  assert.equal(ceilingUsd, EVAL_CAPS.shipEvalCostUsd)
  assert.equal(prices.id, MODEL_PRICES.id)
})

test('the ceiling stops the next arm and never a run in flight', () => {
  const under = ceilingStop({ spentUsd: 3, ceilingUsd: 20, fixture: 'f', arm: 'loop' })
  assert.deepEqual(under, { stop: false, reason: null })

  const reached = ceilingStop({ spentUsd: 20, ceilingUsd: 20, fixture: 'f', arm: 'control' })
  assert.equal(reached.stop, true)
  // Named as not run, never as a failure: a fixture that was never started has
  // not failed anything.
  assert.match(reached.reason, /did not run and is not recorded as a failure/)
  assert.match(reached.reason, /evals\.shipEvalCostUsd/)

  // An unavailable ceiling and unmeasured spend both mean the eval does not know
  // its own cost. That is a thing to say, not a reason to refuse to run.
  assert.equal(ceilingStop({ spentUsd: 99, ceilingUsd: null, fixture: 'f', arm: 'loop' }).stop, false)
})

test('an unpriced model yields no spend figure rather than a zero or a guessed tier', () => {
  const usage = { requests: 2, inputTokens: 1_000_000, outputTokens: 200_000, reason: null }
  const priced = priceUsage(usage, DEFAULT_MODEL, MODEL_PRICES)
  assert.ok(priced.usd > 0, 'a priced model must produce a figure')

  const unpriced = priceUsage(usage, 'some-model-nobody-priced', MODEL_PRICES)
  assert.equal(unpriced.usd, null)
  assert.match(unpriced.reason, /prices no model named/)
  assert.match(unpriced.reason, new RegExp(MODEL_PRICES.id))

  // And an unmeasured usage is not priced at zero either.
  const unmeasured = priceUsage({ inputTokens: null, outputTokens: null, reason: 'no record' }, DEFAULT_MODEL, MODEL_PRICES)
  assert.equal(unmeasured.usd, null)
  assert.equal(unmeasured.reason, 'no record')
})

// --- measures: absent with a reason, never zero -----------------------------

test('an unmeasured figure is recorded absent with its reason, and a real zero survives', () => {
  const measures = measuresFor({
    armResult: { wallClockMs: 1234, agentsSpawned: { value: 4, reason: null } },
    // The receipt this host actually writes: no token accounting, so spend is
    // absent with the host's reason.
    receipt: { outputTokens: null, remediationRounds: 0 },
    usage: { requests: 3, inputTokens: 900, outputTokens: 120, reason: null },
    priced: { usd: 0.02, reason: null }
  })

  assert.deepEqual(measures.agentsSpawned, { value: 4, reason: null })
  assert.deepEqual(measures.wallClockMs, { value: 1234, reason: null })

  // The two token fields are separate and must not be merged: one is the loop's
  // own accounting, the other is what the eval's apparatus measured of itself.
  assert.equal(measures.receiptOutputTokens.value, null)
  assert.match(measures.receiptOutputTokens.reason, /no token accounting/)
  assert.deepEqual(measures.agentOutputTokens, { value: 120, reason: null })

  // A measured zero stays a measured zero, distinguishable from an absence.
  assert.deepEqual(measures.remediationRounds, { value: 0, reason: null })
})

test('a run with no receipt records the receipt-derived measures absent, not zero', () => {
  const measures = measuresFor({
    armResult: { wallClockMs: 10, agentsSpawned: { value: null, reason: 'no trajectory' } },
    receipt: null,
    usage: { requests: null, inputTokens: null, outputTokens: null, reason: 'the agent wrote no usage record' },
    priced: { usd: null, reason: 'no usage was measured' }
  })
  for (const field of ['remediationRounds', 'receiptOutputTokens', 'agentOutputTokens', 'spendUsd']) {
    assert.equal(measures[field].value, null, `${field} must be absent`)
    assert.ok(measures[field].reason, `${field} must say why it is absent`)
  }
})

test('a missing usage file is not measured, and is never read as zero tokens', () => {
  const usage = readAgentUsage(join(tmpdir(), 'interlock-eval-no-such-usage-file.jsonl'))
  assert.deepEqual(
    { requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    { requests: null, inputTokens: null, outputTokens: null }
  )
  assert.match(usage.reason, /wrote no usage record/)
})

// --- no signal is not a graded failure --------------------------------------

test('an absent credential is no signal, named, before anything is spent', () => {
  const agent = selectAgent({})
  const withKey = preflight(agent, { env: { ANTHROPIC_API_KEY: 'sk-test' } })
  assert.deepEqual(withKey, { ok: true, reason: null })

  const without = preflight(agent, { env: {} })
  assert.equal(without.ok, false)
  assert.match(without.reason, /no model credential/)
})

test('a fixture that is already green fails its own solvability check and yields no signal', () => {
  const fixture = readFixture('docs-and-code')
  const { root } = prepareScratchRoot(fixture, { tmpBase: tmpdir() })
  try {
    const before = checkFixtureSolvable(fixture, root)
    assert.equal(before.ok, true, `a fresh fixture must be solvable: ${before.reason}`)
    assert.ok(Number.isInteger(before.baselineCounts.total), 'the baseline counts must be measured')

    // Solved in place: the change is now a no-op, so a run that changed nothing
    // would grade as a success. That is fixture rot, and it is caught before a
    // single metered call rather than reported as a loop failure.
    applyReference(fixture, root)
    const after = checkFixtureSolvable(fixture, root)
    assert.equal(after.ok, false)
    assert.match(after.reason, /already green/)
    assert.equal(after.baselineCounts, null)
  } finally {
    removeScratchRoot(root)
  }
})

test('an operator-supplied agent is not recorded as running this repository’s default model', () => {
  const committed = selectAgent({})
  assert.equal(modelUnderTest(committed, {}), DEFAULT_MODEL)
  assert.equal(modelUnderTest(committed, { INTERLOCK_EVAL_MODEL: 'claude-sonnet-5' }), 'claude-sonnet-5')

  // The row must not claim a model the eval never observed: an external agent
  // chooses its own, and a row that named ours would pair in a comparison with
  // rows that mean something else.
  const operator = selectAgent({ INTERLOCK_ACP_COMMAND: 'some-agent' })
  assert.match(modelUnderTest(operator, {}), /operator-supplied agent chooses its own model/)
})

test('the version under test is the version the package ships as', () => {
  const declared = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  assert.equal(versionUnderTest(ROOT), declared)
})

// --- the arm difference (spec: every fixture is run through a control arm) --

const gradedResult = (arm, overrides = {}) => ({
  fixture: 'docs-and-code',
  arm,
  signal: 'graded',
  criteria: [
    { id: 'unit-suite-green', status: 'pass', met: true },
    { id: 'unit-suite-not-weakened', status: 'pass', met: true },
    { id: 'commit-present', status: arm === 'control' ? 'fail' : 'pass', met: arm !== 'control' },
    { id: 'ticks-match-recorded-outcomes', status: arm === 'control' ? 'n/a' : 'pass', met: arm === 'control' ? null : true }
  ],
  measures: {
    agentsSpawned: { value: arm === 'control' ? 4 : 6, reason: null },
    wallClockMs: { value: arm === 'control' ? 1000 : 1500, reason: null },
    receiptOutputTokens: { value: null, reason: 'the host has no token accounting' }
  },
  ...overrides
})

test('the arm difference is values and denominators, with no verdict anywhere in it', () => {
  const diff = differenceFor(gradedResult('loop'), gradedResult('control'))
  assert.equal(diff.available, true)

  // Only the criteria both arms can be graded on. The tick criterion is not
  // among them, because counting it would score the control arm down for
  // lacking a mechanism it was defined not to have.
  assert.deepEqual(
    diff.criteria.map(c => c.criterion),
    ['unit-suite-green', 'unit-suite-not-weakened', 'commit-present']
  )
  assert.deepEqual(diff.criteria[2], {
    criterion: 'commit-present',
    loop: 'pass',
    control: 'fail'
  })

  const spawned = diff.measures.find(m => m.measure === 'agentsSpawned')
  assert.deepEqual(spawned, { measure: 'agentsSpawned', loop: 6, control: 4, difference: 2, reason: null })

  // A measure one arm did not measure yields no difference, with its reason —
  // never a difference computed against an absence.
  const tokens = diff.measures.find(m => m.measure === 'receiptOutputTokens')
  assert.equal(tokens.difference, null)
  assert.match(tokens.reason, /did not measure/)

  // No verdict label on any value. The scan is over the reported criteria and
  // measures — `note` and `over` are the prose that STATES this rule, and
  // scanning them would fail on the sentence that promises the property.
  const values = JSON.stringify({ criteria: diff.criteria, measures: diff.measures }).toLowerCase()
  for (const word of ['better', 'worse', 'acceptable', 'degraded', 'passing', 'regression', 'healthy']) {
    assert.doesNotMatch(
      values,
      new RegExp(`\\b${word}\\b`),
      `the arm difference must carry no verdict, and it used the word "${word}"`
    )
  }
  assert.match(diff.note, /no arm is labelled better, acceptable, degraded or passing/)
})

test('an arm that could not run makes the difference unavailable rather than computed', () => {
  const noSignal = { fixture: 'docs-and-code', arm: 'control', signal: 'none', reason: 'no credential' }
  const diff = differenceFor(gradedResult('loop'), noSignal)
  assert.equal(diff.available, false)
  assert.match(diff.reason, /control arm produced no graded result/)
  assert.deepEqual(diff.criteria, [])
  assert.deepEqual(diff.measures, [])

  assert.equal(differenceFor(null, gradedResult('control')).available, false)
})

// --- the runner's model-free path stays model-free --------------------------

test('--prepare-only prepares every fixture outside this repository and spends nothing', () => {
  const run = spawnSync(
    process.execPath,
    [join(ROOT, 'evals', 'ship', 'run.mjs'), '--prepare-only', '--json'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: '' } }
  )
  assert.equal(run.status, 0, `--prepare-only exited ${run.status}: ${run.stderr}`)
  const report = JSON.parse(run.stdout)
  assert.equal(report.fixtures.length, readFixtures().length)
  for (const entry of report.fixtures) {
    assert.equal(entry.error, undefined, `${entry.fixture}: ${entry.error}`)
    assert.ok(!entry.root.startsWith(ROOT), `${entry.fixture} was prepared inside this repository`)
    assert.equal(existsSync(entry.root), false, 'a prepared root was left behind')
  }
})

// --- the eval says what it does not cover (spec: limits are declared) -------
//
// Token pins, not sentences. A prose instruction nobody asserts silently stops
// being true, and the first reword deletes a sentence-shaped pin — so what is
// pinned here is the vocabulary a reader needs in order to know what this
// measurement does NOT cover.

test('the eval README states the coverage its host excludes', () => {
  const text = readFileSync(README, 'utf8')
  for (const token of [
    'model routing',
    'not in effect',
    'launch behaviour',
    'not under test',
    'apparatus',
    'default'
  ]) {
    assert.match(
      text,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      `evals/ship/README.md no longer states "${token}" — the excluded coverage is what keeps a ` +
        `reader from mistaking this for a measurement of the whole product`
    )
  }
  // The agent's identity is the instrument's identity, and the README is where a
  // reader learns it is apparatus rather than something Interlock ships.
  assert.match(text, new RegExp(AGENT_IDENTITY.replace('/1', '/N')))
})

test('the eval README records the harness case-discovery confirmation', () => {
  const text = readFileSync(README, 'utf8')
  assert.match(text, /case\.yaml/, 'the discovery rule must be named, not summarised')
  assert.match(text, /prompt\.md/)
  assert.match(text, /Still to confirm|Confirmed from the shipped binary/)

  // And the rule holds right now: nothing under the eval's own directories
  // carries a name the harness discovers as a case.
  const listed = spawnSync(
    'sh',
    ['-c', "find evals/ship evals/history -name case.yaml -o -name prompt.md"],
    { cwd: ROOT, encoding: 'utf8' }
  )
  assert.equal(
    listed.stdout.trim(),
    '',
    'a file under evals/ship/ or evals/history/ is named case.yaml or prompt.md, which is exactly ' +
      'what the plugin eval harness discovers as a case'
  )
})

// --- the scheduled job (spec: scheduled, bounded, never on a pull request) --

const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' })
const NOT_A_CHECKOUT =
  gitCheck.error || gitCheck.status !== 0
    ? 'not a git checkout (or git unavailable) — tracking status cannot be determined'
    : false

test('the scheduled outcome-eval workflow stays tracked', { skip: NOT_A_CHECKOUT }, () => {
  // `.gitignore` ignores `.github/workflows/`, so this file exists on disk only
  // because it was force-added. An untracked workflow never runs on the remote
  // and nothing else would say so.
  const rel = '.github/workflows/ship-outcome-eval.yml'
  assert.ok(existsSync(join(ROOT, rel)), `${rel} is missing`)
  const listed = spawnSync('git', ['ls-files', '--', rel], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(listed.status, 0, `git ls-files exited ${listed.status}: ${listed.stderr}`)
  assert.equal(
    listed.stdout.trim(),
    rel,
    `${rel} is not tracked. .github/workflows/ is gitignored, so it must be force-added ` +
      `(\`git add -f ${rel}\`) — otherwise the scheduled eval silently never runs.`
  )
})

test('the outcome eval can never be triggered by a pull request or a push', () => {
  const text = readFileSync(WORKFLOW, 'utf8')
  const triggers = text.slice(text.indexOf('\non:'), text.indexOf('\nconcurrency:'))

  assert.match(triggers, /^\s+schedule:/m, 'the job must be scheduled')
  assert.match(triggers, /^\s+workflow_dispatch:/m, 'the job must be manually invocable')
  // The absence IS the requirement — not a path filter that happens to match
  // nothing. The run consumes metered model calls and its result may not
  // influence whether a change merges.
  assert.doesNotMatch(triggers, /^\s+pull_request/m, 'the outcome eval must not run on a pull request')
  assert.doesNotMatch(triggers, /^\s+push:/m, 'the outcome eval must not run on a push')
})

test('the scheduled job restates no ceiling and configures itself as no required check', () => {
  const text = readFileSync(WORKFLOW, 'utf8')
  assert.match(text, /evals\.shipEvalCostUsd/, 'the ceiling must be read from the published limits')
  // A dollar figure written here is the prose cap `lib/limits.mjs` exists to
  // end, one file further out. `$CEIL` is the read value and carries no digits.
  assert.doesNotMatch(
    text.replace(/shipEvalCostUsd/g, ''),
    /\$\s?\d+(\.\d+)?\b/,
    'the job restates a numeric ceiling of its own'
  )
  // Nothing here makes the job blocking. `continue-on-error` and `--threshold`
  // are the two knobs that would, and neither belongs on a job no gate reads.
  assert.doesNotMatch(text, /continue-on-error/)
  assert.doesNotMatch(text, /--threshold/)
  assert.match(text, /NOT A REQUIRED CHECK/)
})

test('no gate, skill or workflow step consumes an outcome-eval result', () => {
  // The record is reachable by a human and by `interlock report`, and by nothing
  // in the loop. A reader appearing in a gate is the one change this eval must
  // never make.
  const offenders = []
  for (const dir of ['lib', 'bin', 'workflows', 'skills', 'hooks']) {
    const found = spawnSync(
      'sh',
      ['-c', `grep -rl "ship-outcomes" ${dir} 2>/dev/null || true`],
      { cwd: ROOT, encoding: 'utf8' }
    )
    for (const file of found.stdout.split('\n').filter(Boolean)) {
      // The report reads it as a corpus and issues no verdict — that is the one
      // permitted reader, and `lib/report.mjs` is asserted non-gating elsewhere.
      if (file === 'lib/eval-history.mjs' || file === 'lib/report.mjs' || file === 'lib/report-html.mjs') continue
      offenders.push(file)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these files read the outcome-eval record: ${offenders.join(', ')}. No gate, readiness check, ` +
      `risk classification, promotion decision or workflow step may consume an outcome-eval result.`
  )
})
