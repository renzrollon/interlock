// The merge verdict and score (spec: review/merge-confidence).
//
// Two layers, tested apart on purpose (design D1, D11):
//
//   - `combineSignals` is the formula: worst band wins, unobserved ranks amber,
//     a flag lowers the score and never moves a band. No input this version
//     accepts can read MERGE, because two signals have no producer yet, so the
//     MERGE path, the green ceiling and the flag rules are pinned here on
//     synthetic result lists — the first input that reaches them must not also
//     be the first time they run.
//   - `assessMergeConfidence` is the registry run over a real input object. One
//     fixture per signal state lives in test/fixtures/merge-confidence/, each the
//     all-observable-green input with one state changed, and the table below says
//     exactly which signals that state moves. Every other gating signal must stay
//     where the green fixture put it, so a reader that leaks into a neighbour's
//     signal fails here.
//
// Every expected score is computed from MERGE_BANDS.ceiling, never written as a
// number: a re-tuned ceiling must not break a test that was only pinning one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SIGNALS,
  FLAGS,
  combineSignals,
  assessMergeConfidence,
  formatMergeConfidence
} from '../../lib/merge-confidence.mjs'
import { MERGE_BANDS } from '../../lib/limits.mjs'
import { MERGE_ALLOWED_CLASSES } from '../../lib/risk.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'merge-confidence')
const MODULE = join(ROOT, 'lib', 'merge-confidence.mjs')

const fixture = name => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))
const signalOf = (result, id) => {
  const found = result.signals.find(s => s.id === id)
  assert.ok(found, `the output carries no ${id} entry`)
  return found
}
const said = entry => [entry.reason, ...(entry.evidence || [])].join('\n')

// The registered signals, in the order the spec's registered-signal requirement
// lists them. Restated here rather than read from the module: this is the
// contract the module is checked against, not a copy of what it happens to do.
const SPEC_ORDER = [
  'review.blockers',
  'review.warnings',
  'review.ran',
  'review.adversarial',
  'risk.class',
  'verify.suite',
  'verify.e2e',
  'verify.coverage',
  'ci.pipeline',
  'conformance.delta',
  'conformance.living',
  'spec.coverage',
  'diff.shape',
  'decisions.open',
  'run.integrity',
  'drift.stale',
  'policy.humanPaths',
  'plan.fidelity'
]
const INFORMATIONAL = ['plan.fidelity']
const GATING_IDS = SPEC_ORDER.filter(id => !INFORMATIONAL.includes(id))

// The two signals whose producer has not landed, and the brief that lands it.
// `policy.humanPaths` left this table when it began reading the review policy
// committed at the base (spec: review/merge-confidence, the human-paths signal).
const PENDING = {
  'conformance.living': /E6/,
  'spec.coverage': /E6/
}

const KINDS = ['person', 'evidence', 'finding']
const BAND_RANK = { green: 0, unobserved: 1, amber: 2, red: 3 }

// --- the score oracle, from the published ceilings ---------------------------

function rangeOf(worst, bands = MERGE_BANDS) {
  const c = bands.ceiling
  if (worst === 'green') return { floor: c.amber + 1, ceiling: c.green }
  if (worst === 'red') return { floor: 0, ceiling: c.red }
  return { floor: c.red + 1, ceiling: c.amber }
}

function expectedScore(worst, clean, gating, bands = MERGE_BANDS) {
  const { floor, ceiling } = rangeOf(worst, bands)
  return floor + Math.round(((ceiling - floor) * clean) / gating)
}

function worstOf(bands) {
  if (bands.includes('red')) return 'red'
  if (bands.includes('amber')) return 'amber'
  if (bands.includes('unobserved')) return 'unobserved'
  return 'green'
}

const verdictOf = worst => (worst === 'red' ? 'BLOCK' : worst === 'green' ? 'MERGE' : 'HUMAN')

// --- synthetic result lists for the formula ----------------------------------

let synthetic = 0
function sig(band, { flags = [], kind, id } = {}) {
  synthetic += 1
  return {
    id: id || `synthetic.s${synthetic}`,
    family: 'synthetic',
    gating: true,
    band,
    flags,
    kind: kind === undefined ? (band === 'green' ? null : 'evidence') : kind,
    reason: `a ${band} result`,
    evidence: [`synthetic ${band}`]
  }
}

// =============================================================================
// combineSignals — the formula (requirements: worst band; flags; score bounds)
// =============================================================================

test('every signal green reads MERGE, lists no driving signal, and scores exactly the green ceiling', () => {
  const result = combineSignals([sig('green'), sig('green'), sig('green'), sig('green')])
  assert.equal(result.verdict, 'MERGE')
  assert.equal(result.worstBand, 'green')
  assert.deepEqual(result.driving, [])
  assert.equal(result.score, MERGE_BANDS.ceiling.green)
})

test('one red among many greens reads BLOCK, is named as driving with its evidence, and stays under the red ceiling', () => {
  const red = sig('red', { kind: 'finding' })
  const result = combineSignals([sig('green'), red, sig('green'), sig('green'), sig('green')])
  assert.equal(result.verdict, 'BLOCK')
  assert.equal(result.worstBand, 'red')
  assert.deepEqual(result.driving.map(d => d.id), [red.id])
  assert.deepEqual(result.driving[0].evidence, red.evidence)
  assert.equal(result.driving[0].kind, 'finding')
  assert.ok(result.score <= MERGE_BANDS.ceiling.red, `red scored ${result.score}`)
  assert.ok(result.score < MERGE_BANDS.ceiling.red + 1, 'a red must score strictly below the amber floor')
  assert.equal(result.score, expectedScore('red', 4, 5))
})

test('one unobserved signal reads HUMAN, is driving with its reason, and every driving entry says what would lift it', () => {
  const missing = sig('unobserved', { kind: 'evidence' })
  const person = sig('amber', { kind: 'person' })
  const fix = sig('amber', { kind: 'finding' })
  const result = combineSignals([sig('green'), missing, person, fix])
  assert.equal(result.verdict, 'HUMAN')
  assert.equal(result.worstBand, 'amber')
  assert.ok(result.driving.some(d => d.id === missing.id && d.reason === missing.reason))
  for (const entry of result.driving) assert.ok(KINDS.includes(entry.kind), `${entry.id} has kind ${entry.kind}`)
  assert.deepEqual(
    result.driving.map(d => d.kind).sort(),
    ['evidence', 'finding', 'person'],
    'each driving signal is marked as needing a person, more evidence, or a fix'
  )

  const alone = combineSignals([sig('green'), sig('unobserved'), sig('green')])
  assert.equal(alone.verdict, 'HUMAN', 'an unobserved signal ranks as amber for the verdict')
  assert.equal(alone.worstBand, 'unobserved', 'the worst band says only missing evidence holds the change')
})

test('the worst band wins: no count of greens lifts a single amber or red', () => {
  const many = Array.from({ length: 40 }, () => sig('green'))
  assert.equal(combineSignals([...many, sig('amber')]).verdict, 'HUMAN')
  assert.equal(combineSignals([...many, sig('red', { kind: 'finding' })]).verdict, 'BLOCK')
  assert.equal(combineSignals([sig('amber'), sig('red', { kind: 'finding' }), sig('unobserved')]).worstBand, 'red')
})

test('a flagged green still reads MERGE, scores strictly lower than unflagged, and the flag is reported beside its signal', () => {
  const plain = combineSignals([sig('green'), sig('green'), sig('green')])
  const flagged = sig('green', { flags: ['no-e2e'] })
  const withFlag = combineSignals([sig('green'), flagged, sig('green')])
  assert.equal(withFlag.verdict, 'MERGE', 'a flag is not promoted to amber')
  assert.notEqual(withFlag.verdict, 'HUMAN')
  assert.equal(withFlag.worstBand, 'green')
  assert.ok(withFlag.score < plain.score, `${withFlag.score} is not below ${plain.score}`)
  assert.equal(withFlag.score, expectedScore('green', 2, 3))
  assert.deepEqual(withFlag.signals.find(s => s.id === flagged.id).flags, ['no-e2e'])
  assert.ok(withFlag.flags.some(f => f.id === flagged.id && f.flag === 'no-e2e'))
  assert.equal(withFlag.counts.flagged, 1)
  assert.deepEqual(withFlag.driving, [], 'a flag does not drive the verdict')
})

test('a flag outside the published list is rejected as a defect, not carried', () => {
  assert.throws(
    () => combineSignals([sig('green'), sig('green', { flags: ['no-confidence'] })]),
    /no-confidence/
  )
})

test('same band, one more flag on a green result, strictly lower score — both inside the amber range', () => {
  const { floor, ceiling } = rangeOf('amber')
  const one = combineSignals([sig('amber'), sig('green'), sig('green'), sig('green', { flags: ['no-e2e'] })])
  const two = combineSignals([
    sig('amber'),
    sig('green'),
    sig('green', { flags: ['no-coverage'] }),
    sig('green', { flags: ['no-e2e'] })
  ])
  assert.ok(two.score < one.score, `${two.score} is not below ${one.score}`)
  for (const result of [one, two]) {
    assert.ok(result.score >= floor && result.score <= ceiling, `${result.score} outside ${floor}..${ceiling}`)
  }
})

test('a list in which no gating signal is clean scores exactly its band floor', () => {
  assert.equal(
    combineSignals([sig('amber'), sig('green', { flags: ['no-e2e'] })]).score,
    rangeOf('amber').floor
  )
  assert.equal(combineSignals([sig('red', { kind: 'finding' }), sig('amber')]).score, rangeOf('red').floor)
  assert.equal(
    combineSignals([sig('green', { flags: ['no-e2e'] }), sig('green', { flags: ['no-graph'] })]).score,
    rangeOf('green').floor
  )
})

test('an unobserved worst band scores in the amber range and equals the same list with amber in its place', () => {
  const { floor, ceiling } = rangeOf('amber')
  const unobserved = combineSignals([sig('unobserved'), sig('green'), sig('green'), sig('unobserved')])
  const amber = combineSignals([sig('amber'), sig('green'), sig('green'), sig('amber')])
  assert.ok(unobserved.score >= floor && unobserved.score <= ceiling)
  assert.equal(unobserved.score, amber.score)
  assert.equal(unobserved.verdict, amber.verdict)
})

test('the same list always yields the same verdict and score', () => {
  const list = [sig('green'), sig('amber', { kind: 'person' }), sig('green', { flags: ['no-pipeline'] })]
  const copy = JSON.parse(JSON.stringify(list))
  const first = combineSignals(list)
  assert.deepEqual(combineSignals(copy), first)
  assert.deepEqual(list, copy, 'combining never mutates the results it was given')
})

test('an informational entry is reported and never enters the band, the clean share or the driving list', () => {
  const info = { id: 'synthetic.info', family: 'synthetic', gating: false, band: null, flags: [], kind: null, reason: 'reported only', evidence: ['note'] }
  const without = combineSignals([sig('green'), sig('amber')])
  const withInfo = combineSignals([sig('green'), info, sig('amber')])
  assert.equal(withInfo.score, without.score)
  assert.equal(withInfo.counts.gating, without.counts.gating)
  assert.ok(withInfo.signals.some(s => s.id === info.id), 'the informational entry is still reported')
  assert.ok(!withInfo.driving.some(d => d.id === info.id))
})

test('the score follows altered ceilings and the verdict does not', () => {
  const list = [sig('amber'), sig('green'), sig('green')]
  const shifted = {
    ...MERGE_BANDS,
    ceiling: {
      green: MERGE_BANDS.ceiling.green - 5,
      amber: MERGE_BANDS.ceiling.amber - 10,
      red: MERGE_BANDS.ceiling.red - 10
    }
  }
  const published = combineSignals(list)
  const moved = combineSignals(list, { bands: shifted })
  assert.equal(moved.verdict, published.verdict)
  assert.notEqual(moved.score, published.score)
  assert.equal(moved.score, expectedScore('amber', 2, 3, shifted))
})

// =============================================================================
// The registry and the flag vocabulary
// =============================================================================

test('SIGNALS is frozen and registers the spec’s identifiers in the spec’s order', () => {
  assert.ok(Object.isFrozen(SIGNALS))
  assert.deepEqual(SIGNALS.map(s => s.id), SPEC_ORDER)
  for (const entry of SIGNALS) {
    assert.equal(typeof entry.read, 'function', `${entry.id} has no read`)
    assert.equal(entry.family, entry.id.slice(0, entry.id.indexOf('.')), `${entry.id} family`)
    assert.equal(entry.gating, !INFORMATIONAL.includes(entry.id), `${entry.id} gating`)
  }
  assert.equal(SIGNALS.filter(s => s.gating).length, GATING_IDS.length)
})

test('FLAGS is the frozen published vocabulary of design D2', () => {
  assert.ok(Object.isFrozen(FLAGS))
  assert.deepEqual(
    [...FLAGS],
    [
      'no-e2e',
      'no-typecheck',
      'no-coverage',
      'no-baseline',
      'no-pipeline',
      'docs-only-changes',
      'dimensions-unrecorded',
      'domain-skipped',
      'legacy-unspecced',
      'no-graph'
    ]
  )
})

test('MERGE_ALLOWED_CLASSES is its own frozen policy, and the risk signal reads it', () => {
  assert.deepEqual([...MERGE_ALLOWED_CLASSES], ['low', 'medium'])
  assert.ok(Object.isFrozen(MERGE_ALLOWED_CLASSES))
  const payment = fixture('risk-payment')
  assert.equal(signalOf(assessMergeConfidence(payment), 'risk.class').band, 'amber')
  const permissive = assessMergeConfidence(payment, { allowedClasses: ['low', 'medium', 'high', 'critical'] })
  assert.equal(signalOf(permissive, 'risk.class').band, 'green', 'the allowed classes are an option, not a literal')
})

/** The registry check the spec names: which registered ids an output lacks. */
function missingFromOutput(result) {
  const ids = new Set(result.signals.map(s => s.id))
  return SIGNALS.map(s => s.id).filter(id => !ids.has(id))
}

test('a registered signal absent from the output is named by the registry check', () => {
  const result = assessMergeConfidence(fixture('all-observable-green'))
  assert.deepEqual(missingFromOutput(result), [])
  const doctored = { ...result, signals: result.signals.filter(s => s.id !== 'verify.coverage') }
  assert.deepEqual(missingFromOutput(doctored), ['verify.coverage'])
})

// =============================================================================
// assessMergeConfidence — one fixture per signal state (design D11)
// =============================================================================

const G = (flags = []) => ({ band: 'green', kind: null, flags })
const A = kind => ({ band: 'amber', kind, flags: [] })
const R = () => ({ band: 'red', kind: 'finding', flags: [] })
const U = () => ({ band: 'unobserved', kind: 'evidence', flags: [] })

// What the all-observable-green fixture reads: every observable signal green
// with no flag, and the two producer-less signals unobserved.
const BASELINE = Object.fromEntries(GATING_IDS.map(id => [id, id in PENDING ? U() : G()]))

// The signals each state moves away from BASELINE. Everything not named here
// must read exactly what BASELINE says.
const EXPECT = {
  'all-observable-green': {},
  'no-review': {
    'review.blockers': U(),
    'review.warnings': U(),
    'review.ran': A('evidence'),
    'review.adversarial': U()
  },
  'review-with-blocker': { 'review.blockers': R() },
  'review-malformed': { 'review.blockers': R() },
  'review-warnings-over-cap': { 'review.warnings': A('finding') },
  'review-no-dimensions': { 'review.ran': G(['dimensions-unrecorded']) },
  'review-domain-skipped': { 'review.ran': G(['domain-skipped']) },
  'review-incomplete': { 'review.ran': A('evidence') },
  'review-dismissal-rejected': { 'review.adversarial': A('evidence') },
  'review-votes-below-floor': { 'review.adversarial': A('evidence') },
  'verify-halt': { 'verify.suite': R() },
  'typecheck-failed-final': { 'verify.suite': R() },
  'typecheck-no-command': { 'verify.suite': G(['no-typecheck']) },
  'typecheck-no-result': { 'verify.suite': U() },
  'unit-pre-existing': { 'verify.suite': A('person') },
  'verify-skipped-no-profile': { 'verify.suite': A('evidence'), 'verify.e2e': G(['no-e2e']) },
  'verify-skipped-no-command': { 'verify.suite': A('evidence') },
  'verify-budget-exceeded': { 'verify.suite': U(), 'verify.e2e': U() },
  'docs-only': { 'verify.suite': G(['docs-only-changes']) },
  'verify-not-final': { 'verify.suite': U(), 'verify.e2e': U() },
  'e2e-failed': { 'verify.e2e': A('finding') },
  'e2e-not-configured': { 'verify.e2e': G(['no-e2e']) },
  'coverage-decline-inside': {},
  'coverage-decline-at-tolerance': {},
  'coverage-decline-beyond': { 'verify.coverage': A('finding') },
  'coverage-no-baseline': { 'verify.coverage': G(['no-baseline']) },
  'coverage-patch-at-floor': { 'verify.coverage': G(['no-baseline']) },
  'coverage-not-ancestor': { 'verify.coverage': U() },
  'coverage-tiny-diff': {},
  'coverage-at-size-floor': { 'verify.coverage': A('finding') },
  'pipeline-required-fail': { 'ci.pipeline': R() },
  'pipeline-optional-fail': { 'ci.pipeline': A('finding') },
  'pipeline-pending': { 'ci.pipeline': U() },
  'pipeline-stale-sha': { 'ci.pipeline': U() },
  'pipeline-stale-sha-required-fail': { 'ci.pipeline': U() },
  'conformance-confirmed': {},
  'conformance-unconfirmed': { 'conformance.delta': A('evidence') },
  'conformance-short-denominator': { 'conformance.delta': A('evidence') },
  'conformance-unavailable': { 'conformance.delta': A('evidence') },
  'conformance-no-scenarios-source': { 'conformance.delta': A('finding') },
  'conformance-no-scenarios-docs': {},
  'risk-payment': { 'risk.class': A('person') },
  'risk-empty': { 'risk.class': A('person') },
  'ledger-needs-human': { 'decisions.open': A('person') },
  'ledger-missing': { 'decisions.open': A('person') },
  'drift-broken-removed-file': { 'drift.stale': A('finding') },
  'drift-unarchived-same-capability': { 'drift.stale': A('person') },
  'drift-unarchived-other-capability': {},
  'drift-unarchived-self': {},
  'drift-no-graph': { 'drift.stale': G(['no-graph']) },
  'policy-listed-path-touched': { 'policy.humanPaths': A('person') },
  'policy-edited': { 'policy.humanPaths': A('person') },
  'policy-unreadable': { 'policy.humanPaths': A('person') },
  'no-base': { 'diff.shape': U(), 'policy.humanPaths': U() }
}

test('the fixture directory holds exactly one input per state the table names', () => {
  const onDisk = readdirSync(FIXTURES)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort()
  assert.deepEqual(onDisk, Object.keys(EXPECT).sort())
})

for (const [name, delta] of Object.entries(EXPECT)) {
  test(`fixture ${name}: each signal reads its one band, and the verdict and score follow from them`, () => {
    const input = fixture(name)
    const result = assessMergeConfidence(input)
    const expected = { ...BASELINE, ...delta }

    // Registered ids, in the registered order, whatever the input holds.
    assert.deepEqual(result.signals.map(s => s.id), SPEC_ORDER)

    for (const id of GATING_IDS) {
      const entry = signalOf(result, id)
      const want = expected[id]
      assert.equal(entry.band, want.band, `${name}: ${id} band (${entry.reason})`)
      assert.deepEqual(entry.flags, want.flags, `${name}: ${id} flags`)
      assert.equal(entry.kind, want.kind, `${name}: ${id} kind`)
      assert.equal(entry.gating, true)
      assert.equal(typeof entry.reason, 'string')
      assert.ok(entry.reason.length > 0, `${name}: ${id} carries no reason`)
      assert.ok(Array.isArray(entry.evidence) && entry.evidence.length > 0, `${name}: ${id} carries no evidence`)
      for (const flag of entry.flags) assert.ok(FLAGS.includes(flag), `${name}: ${id} produced unpublished flag ${flag}`)
    }

    // The informational entry has evidence and no band, and never drives.
    const fidelity = signalOf(result, 'plan.fidelity')
    assert.equal(fidelity.gating, false)
    assert.equal(fidelity.band, null)
    assert.equal(fidelity.kind, null)
    assert.ok(fidelity.evidence.length > 0)
    assert.ok(!result.driving.some(d => d.id === 'plan.fidelity'))

    // The producer-less signals are present, unobserved, and name their producer.
    for (const [id, producer] of Object.entries(PENDING)) {
      assert.match(signalOf(result, id).reason, producer, `${name}: ${id} does not name its producer`)
    }

    // Verdict: never MERGE in this version; BLOCK iff something is red.
    const bands = GATING_IDS.map(id => expected[id].band)
    const worst = worstOf(bands)
    assert.notEqual(result.verdict, 'MERGE', `${name} read MERGE`)
    assert.ok(['HUMAN', 'BLOCK'].includes(result.verdict))
    assert.equal(result.verdict, verdictOf(worst))
    assert.equal(result.worstBand, worst)

    // Driving: every non-green gating signal, each saying what would lift it.
    const notGreen = GATING_IDS.filter(id => expected[id].band !== 'green')
    assert.deepEqual(result.driving.map(d => d.id).sort(), [...notGreen].sort())
    for (const entry of result.driving) {
      assert.ok(KINDS.includes(entry.kind), `${name}: driving ${entry.id} has kind ${entry.kind}`)
      assert.ok(BAND_RANK[entry.band] > BAND_RANK.green)
    }

    // Score, from the published ceilings.
    const clean = GATING_IDS.filter(id => expected[id].band === 'green' && expected[id].flags.length === 0).length
    assert.equal(result.score, expectedScore(worst, clean, GATING_IDS.length), `${name} score`)
    assert.equal(result.counts.gating, GATING_IDS.length)
    assert.equal(result.counts.clean, clean)
  })
}

test('the output says it can never read MERGE until the producers land, one reason line per pending signal', () => {
  const result = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(result.verdict, 'HUMAN')
  assert.deepEqual(result.driving.map(d => d.id).sort(), ['conformance.living', 'spec.coverage'])
  assert.deepEqual(Object.keys(PENDING).sort(), ['conformance.living', 'spec.coverage'])
  // The human-paths signal reads the base policy now, so it is not a pending
  // signal and no line says its producer has not landed.
  assert.ok(
    !result.reasons.some(line => line.includes('policy.humanPaths')),
    'policy.humanPaths is still reported as waiting for a producer'
  )
  for (const [id, producer] of Object.entries(PENDING)) {
    assert.ok(
      result.reasons.some(line => line.includes(id) && producer.test(line)),
      `reasons carries no line for ${id}`
    )
  }
})

// --- preconditions: the boundary fixtures sit on the boundary they claim -------
//
// The fixtures are data, so they hold numbers. These assertions tie each
// boundary fixture to the published value it straddles, so a re-tuned band
// fails here, naming the fixture, rather than silently testing the wrong side.

test('each boundary fixture sits where its name says relative to MERGE_BANDS', () => {
  const cov = name => fixture(name).coverage
  const decline = c => c.baseTotalPct - c.headTotalPct
  assert.ok(decline(cov('coverage-decline-inside')) > 0)
  assert.ok(decline(cov('coverage-decline-inside')) < MERGE_BANDS.maxCoverageDeclinePts)
  assert.equal(decline(cov('coverage-decline-at-tolerance')), MERGE_BANDS.maxCoverageDeclinePts)
  assert.ok(decline(cov('coverage-decline-beyond')) > MERGE_BANDS.maxCoverageDeclinePts)
  assert.ok(cov('coverage-no-baseline').diffPct > MERGE_BANDS.patchCoverageFloorPct)
  assert.equal(cov('coverage-patch-at-floor').diffPct, MERGE_BANDS.patchCoverageFloorPct)
  assert.ok(cov('coverage-tiny-diff').changedLines < MERGE_BANDS.minChangedLinesForCoverage)
  assert.ok(cov('coverage-tiny-diff').diffPct < MERGE_BANDS.patchCoverageFloorPct, 'the tiny diff is exempt, not passing')
  assert.equal(cov('coverage-at-size-floor').changedLines, MERGE_BANDS.minChangedLinesForCoverage)
  assert.ok(cov('coverage-at-size-floor').diffPct < MERGE_BANDS.patchCoverageFloorPct)
  for (const name of Object.keys(EXPECT).filter(n => n.startsWith('coverage-'))) {
    const c = cov(name)
    if (c.changedLines >= MERGE_BANDS.minChangedLinesForCoverage || name === 'coverage-at-size-floor') continue
    assert.equal(name, 'coverage-tiny-diff', `${name} unexpectedly sits under the small-change floor`)
  }
  assert.ok(cov('all-observable-green').changedLines >= MERGE_BANDS.minChangedLinesForCoverage)

  const warnings = name => fixture(name).review.surviving.filter(f => f.severity === 'warning')
  assert.equal(warnings('review-warnings-over-cap').length, MERGE_BANDS.maxWarningsForMerge + 1)
  assert.ok(warnings('all-observable-green').length <= MERGE_BANDS.maxWarningsForMerge)
  for (const finding of fixture('all-observable-green').review.surviving) {
    assert.ok(finding.votes.total >= MERGE_BANDS.minVerdictsPerFinding, 'the green review must clear the verdict floor')
  }
  assert.ok(
    warnings('review-votes-below-floor').some(f => f.votes.total < MERGE_BANDS.minVerdictsPerFinding)
  )

  const diff = fixture('all-observable-green').diff
  assert.ok(diff.changedLines <= MERGE_BANDS.maxChangedLinesForMerge)
  assert.ok(diff.changedFiles <= MERGE_BANDS.maxChangedFilesForMerge)
})

// --- the review signals --------------------------------------------------------

test('a surviving blocker is red, and the evidence names its file and title', () => {
  const input = fixture('review-with-blocker')
  const blocker = input.review.surviving.find(f => f.severity === 'blocker')
  const entry = signalOf(assessMergeConfidence(input), 'review.blockers')
  assert.match(said(entry), new RegExp(blocker.title))
  assert.ok(said(entry).includes(blocker.file))
})

test('a finding with an unrecognised severity is red, naming the finding and the rejected severity', () => {
  const input = fixture('review-malformed')
  const [finding] = input.review.surviving
  const result = assessMergeConfidence(input)
  const entry = signalOf(result, 'review.blockers')
  assert.equal(result.verdict, 'BLOCK')
  assert.ok(said(entry).includes(finding.title))
  assert.ok(said(entry).includes(finding.severity))
})

test('warnings over the cap name the cap and its published value', () => {
  const entry = signalOf(assessMergeConfidence(fixture('review-warnings-over-cap')), 'review.warnings')
  assert.ok(entry.reason.includes('MERGE_BANDS.maxWarningsForMerge'), entry.reason)
  assert.ok(entry.reason.includes(String(MERGE_BANDS.maxWarningsForMerge)), entry.reason)
})

test('no review is amber on the ran signal because no review ran; a review with no dimension record is a flag', () => {
  const none = signalOf(assessMergeConfidence(fixture('no-review')), 'review.ran')
  assert.match(none.reason, /no review ran/i)
  const unrecorded = signalOf(assessMergeConfidence(fixture('review-no-dimensions')), 'review.ran')
  assert.deepEqual(unrecorded.flags, ['dimensions-unrecorded'])
  assert.match(said(unrecorded), /dimension record/i)
})

test('an incomplete review, and one whose selected dimension could not run, are amber naming why', () => {
  const incomplete = signalOf(assessMergeConfidence(fixture('review-incomplete')), 'review.ran')
  assert.match(incomplete.reason, /did not complete/)

  const input = fixture('all-observable-green')
  input.review.dimensions = { ...input.review.dimensions, ran: ['qa'], unavailable: ['typescript'] }
  const unavailable = signalOf(assessMergeConfidence(input), 'review.ran')
  assert.equal(unavailable.band, 'amber')
  assert.equal(unavailable.kind, 'evidence')
  assert.match(unavailable.reason, /typescript/)
})

test('a selected dimension recorded neither as ran nor as unavailable is amber, naming it', () => {
  const input = fixture('all-observable-green')
  input.review.dimensions = { ...input.review.dimensions, ran: ['qa'], unavailable: [] }
  const entry = signalOf(assessMergeConfidence(input), 'review.ran')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
  assert.match(entry.reason, /no record that they ran: typescript/)
})

test('a refused refutation, and verdicts below the floor, are amber on the adversarial signal', () => {
  const refused = signalOf(assessMergeConfidence(fixture('review-dismissal-rejected')), 'review.adversarial')
  assert.match(refused.reason, /refus/)
  const thin = signalOf(assessMergeConfidence(fixture('review-votes-below-floor')), 'review.adversarial')
  assert.ok(thin.reason.includes('MERGE_BANDS.minVerdictsPerFinding'), thin.reason)
  assert.ok(thin.reason.includes(String(MERGE_BANDS.minVerdictsPerFinding)), thin.reason)
})

// --- risk ------------------------------------------------------------------------

test('a payment path is amber, needs a person, and names the payment signal and the path — never red', () => {
  const entry = signalOf(assessMergeConfidence(fixture('risk-payment')), 'risk.class')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.match(said(entry), /payment/)
  assert.ok(said(entry).includes('src/payments/charge.ts'))
  assert.ok(entry.reason.includes('MERGE_ALLOWED_CLASSES'), entry.reason)
})

test('no changed paths and no artifact text fails closed to amber with the classifier’s unclassifiable reason', () => {
  const entry = signalOf(assessMergeConfidence(fixture('risk-empty')), 'risk.class')
  assert.equal(entry.band, 'amber', 'the classifier answered, so this is not unobserved')
  assert.match(said(entry), /unclassifiable/)
})

test('a docs-and-tests change is green on risk with the class in the evidence', () => {
  const entry = signalOf(assessMergeConfidence(fixture('docs-only')), 'risk.class')
  assert.equal(entry.band, 'green')
  assert.match(said(entry), /\blow\b/)
})

// --- verification ----------------------------------------------------------------

test('a type check that failed at the final gate without halting is red, naming the type-check failure', () => {
  const input = fixture('typecheck-failed-final')
  assert.equal(input.verify.halt, false, 'precondition: the final gate did not halt')
  assert.ok(input.verify.banners.some(b => b.startsWith('TYPECHECK FAILED (non-blocking at the final gate)')))
  const result = assessMergeConfidence(input)
  const entry = signalOf(result, 'verify.suite')
  assert.equal(result.verdict, 'BLOCK')
  assert.match(said(entry), /typecheck/)
  assert.match(said(entry), /fail/)
})

test('a halted unit suite is red and BLOCK', () => {
  const result = assessMergeConfidence(fixture('verify-halt'))
  assert.equal(signalOf(result, 'verify.suite').band, 'red')
  assert.equal(result.verdict, 'BLOCK')
})

test('pre-existing unit failures are amber, need a person, and say they are pre-existing', () => {
  const entry = signalOf(assessMergeConfidence(fixture('unit-pre-existing')), 'verify.suite')
  assert.match(entry.reason, /pre-existing/)
})

test('each skip reason resolves to the one band the requirement names, each reason naming the kind', () => {
  const read = name => signalOf(assessMergeConfidence(fixture(name)), 'verify.suite')
  assert.deepEqual(read('docs-only').flags, ['docs-only-changes'])
  for (const name of ['verify-skipped-no-profile', 'verify-skipped-no-command']) {
    const entry = read(name)
    assert.equal(entry.band, 'amber', name)
    assert.deepEqual(entry.flags, [], `${name}: a missing unit suite is never a flag`)
    assert.match(entry.reason, /unit/)
  }
  assert.match(read('verify-budget-exceeded').reason, /unit/)
  assert.match(read('verify-budget-exceeded').reason, /budget/)
  assert.match(read('typecheck-no-result').reason, /typecheck/)
  assert.deepEqual(read('typecheck-no-command').flags, ['no-typecheck'])
})

test('a flag on one blocking kind is still reported when the other kind holds the suite at a worse band', () => {
  const input = fixture('typecheck-no-command')
  input.verify = { ...input.verify, unit: fixture('unit-pre-existing').verify.unit }
  const entry = signalOf(assessMergeConfidence(input), 'verify.suite')
  assert.equal(entry.band, 'amber', entry.reason)
  assert.deepEqual(entry.flags, ['no-typecheck'])
})

test('a skip reason this table does not name fails closed to amber', () => {
  const input = fixture('all-observable-green')
  input.verify = { ...input.verify, unit: null, skipped: [...input.verify.skipped, { kind: 'unit', reason: 'disabled-by-caller' }] }
  const entry = signalOf(assessMergeConfidence(input), 'verify.suite')
  assert.equal(entry.band, 'amber')
  assert.match(entry.reason, /disabled-by-caller/)
})

test('a verdict written before the typecheck field existed reads the type check as never reported', () => {
  const input = fixture('all-observable-green')
  delete input.verify.typecheck
  const entry = signalOf(assessMergeConfidence(input), 'verify.suite')
  assert.equal(entry.band, 'unobserved')
  assert.match(entry.reason, /typecheck/)
})

test('a verdict that is not from the final gate makes both verification signals unobserved', () => {
  const result = assessMergeConfidence(fixture('verify-not-final'))
  for (const id of ['verify.suite', 'verify.e2e']) assert.match(signalOf(result, id).reason, /final/)
})

test('an e2e suite that ran and failed is amber needing a fix, with the suite still green', () => {
  const result = assessMergeConfidence(fixture('e2e-failed'))
  assert.equal(signalOf(result, 'verify.suite').band, 'green')
  assert.equal(result.verdict, 'HUMAN')
  assert.ok(result.driving.some(d => d.id === 'verify.e2e' && d.kind === 'finding'))
})

test('each e2e skip reason resolves to its band', () => {
  const withE2eSkip = reason => {
    const input = fixture('all-observable-green')
    input.verify = { ...input.verify, e2e: null, skipped: [...input.verify.skipped, { kind: 'e2e', reason }] }
    return signalOf(assessMergeConfidence(input), 'verify.e2e')
  }
  for (const reason of ['e2e-not-enabled', 'e2e-not-requested', 'no-test-profile', 'no-detectable-command']) {
    const entry = withE2eSkip(reason)
    assert.equal(entry.band, 'green', reason)
    assert.deepEqual(entry.flags, ['no-e2e'], reason)
  }
  assert.deepEqual(withE2eSkip('docs-only-changes').flags, [], 'docs-only carries its flag on the suite signal only')
  assert.equal(withE2eSkip('verify-budget-exceeded').band, 'unobserved')

  const planned = fixture('all-observable-green')
  planned.verify = { ...planned.verify, e2e: null }
  assert.equal(signalOf(assessMergeConfidence(planned), 'verify.e2e').band, 'unobserved')
})

test('a green final verdict with e2e not configured: suite green with no flag, e2e green with the flag', () => {
  const result = assessMergeConfidence(fixture('e2e-not-configured'))
  assert.deepEqual(signalOf(result, 'verify.suite').flags, [])
  assert.deepEqual(signalOf(result, 'verify.e2e').flags, ['no-e2e'])
})

// --- coverage --------------------------------------------------------------------

test('a decline inside the tolerance is green, stating both totals and the tolerance by name', () => {
  const input = fixture('coverage-decline-inside')
  const entry = signalOf(assessMergeConfidence(input), 'verify.coverage')
  assert.ok(said(entry).includes(String(input.coverage.headTotalPct)))
  assert.ok(said(entry).includes(String(input.coverage.baseTotalPct)))
  assert.ok(said(entry).includes('MERGE_BANDS.maxCoverageDeclinePts'))
})

test('a decline beyond the tolerance is amber with both totals, needing a fix', () => {
  const input = fixture('coverage-decline-beyond')
  const result = assessMergeConfidence(input)
  const entry = signalOf(result, 'verify.coverage')
  assert.ok(said(entry).includes(String(input.coverage.headTotalPct)))
  assert.ok(said(entry).includes(String(input.coverage.baseTotalPct)))
  assert.equal(result.verdict, 'HUMAN')
})

test('a baseline from another branch is unobserved; a tiny change is green with the floor named', () => {
  assert.match(signalOf(assessMergeConfidence(fixture('coverage-not-ancestor')), 'verify.coverage').reason, /ancestor/)
  const tiny = signalOf(assessMergeConfidence(fixture('coverage-tiny-diff')), 'verify.coverage')
  assert.ok(tiny.reason.includes('MERGE_BANDS.minChangedLinesForCoverage'), tiny.reason)
})

test('the patch floor and the size floor name their bands', () => {
  const atFloor = signalOf(assessMergeConfidence(fixture('coverage-patch-at-floor')), 'verify.coverage')
  assert.ok(said(atFloor).includes('MERGE_BANDS.patchCoverageFloorPct'))
  const judged = signalOf(assessMergeConfidence(fixture('coverage-at-size-floor')), 'verify.coverage')
  assert.ok(said(judged).includes('MERGE_BANDS.patchCoverageFloorPct'))
})

test('coverage not configured is green with the flag, from the coverage input or from the final verdict', () => {
  const declared = fixture('all-observable-green')
  declared.coverage = { configured: false }
  const fromInput = signalOf(assessMergeConfidence(declared), 'verify.coverage')
  assert.equal(fromInput.band, 'green')
  assert.deepEqual(fromInput.flags, ['no-coverage'])

  const skipped = fixture('all-observable-green')
  skipped.coverage = null
  skipped.verify = { ...skipped.verify, coverage: null, skipped: [...skipped.verify.skipped, { kind: 'coverage', reason: 'coverage-not-configured' }] }
  const fromVerdict = signalOf(assessMergeConfidence(skipped), 'verify.coverage')
  assert.equal(fromVerdict.band, 'green')
  assert.deepEqual(fromVerdict.flags, ['no-coverage'])

  const absent = fixture('all-observable-green')
  absent.coverage = null
  const unobserved = signalOf(assessMergeConfidence(absent), 'verify.coverage')
  assert.equal(unobserved.band, 'unobserved')
  assert.match(unobserved.reason, /--coverage/)
})

// --- pipeline --------------------------------------------------------------------

test('a failed required check is red, naming the check', () => {
  const entry = signalOf(assessMergeConfidence(fixture('pipeline-required-fail')), 'ci.pipeline')
  assert.ok(said(entry).includes('unit'))
})

test('a pending check and a stale commit are unobserved with their reasons', () => {
  assert.match(signalOf(assessMergeConfidence(fixture('pipeline-pending')), 'ci.pipeline').reason, /pending/)
  assert.match(signalOf(assessMergeConfidence(fixture('pipeline-stale-sha')), 'ci.pipeline').reason, /another commit/)
})

test('a failed required check on another commit is unobserved, still named, and does not BLOCK', () => {
  const result = assessMergeConfidence(fixture('pipeline-stale-sha-required-fail'))
  const entry = signalOf(result, 'ci.pipeline')
  assert.match(entry.reason, /another commit/)
  assert.ok(entry.evidence.some(line => line.includes('unit') && /fail/.test(line)), entry.evidence.join('\n'))
  assert.notEqual(result.verdict, 'BLOCK')
})

test('a pipeline with no checks is green with the no-pipeline flag', () => {
  const input = fixture('all-observable-green')
  input.pipeline = { ...input.pipeline, checks: [] }
  const entry = signalOf(assessMergeConfidence(input), 'ci.pipeline')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, ['no-pipeline'])
})

// --- delta conformance -------------------------------------------------------------

test('every scenario confirmed is green, stating the number checked and the number counted', () => {
  const input = fixture('conformance-confirmed')
  const entry = signalOf(assessMergeConfidence(input), 'conformance.delta')
  assert.ok(said(entry).includes(`${input.handoff.scenariosChecked} of ${input.checklist.verdictsRequired}`))
})

test('an unconfirmed scenario is amber carrying both counts', () => {
  const input = fixture('conformance-unconfirmed')
  const entry = signalOf(assessMergeConfidence(input), 'conformance.delta')
  assert.ok(said(entry).includes(String(input.handoff.scenariosUnconfirmed)))
  assert.ok(said(entry).includes(String(input.checklist.verdictsRequired)))
})

test('a handoff that states a smaller denominator is judged against the command’s own count', () => {
  const input = fixture('conformance-short-denominator')
  assert.ok(input.handoff.verdictsRequired < input.checklist.verdictsRequired, 'precondition: the handoff claims less')
  const entry = signalOf(assessMergeConfidence(input), 'conformance.delta')
  assert.ok(entry.reason.includes(`${input.handoff.scenariosChecked} of ${input.checklist.verdictsRequired}`), entry.reason)
})

test('no checklist is amber with the checklist’s own reason', () => {
  const input = fixture('conformance-unavailable')
  assert.ok(signalOf(assessMergeConfidence(input), 'conformance.delta').reason.includes(input.checklist.reason))
})

test('no delta scenarios over changed source is amber, needing a fix, because the change promised no behaviour', () => {
  const entry = signalOf(assessMergeConfidence(fixture('conformance-no-scenarios-source')), 'conformance.delta')
  assert.match(entry.reason, /promised no behaviour/)
})

test('delta scenarios and no handoff is unobserved', () => {
  const input = fixture('all-observable-green')
  input.handoff = null
  const entry = signalOf(assessMergeConfidence(input), 'conformance.delta')
  assert.equal(entry.band, 'unobserved')
  assert.match(entry.reason, /--handoff/)
})

// --- diff shape, ledger, drift, run --------------------------------------------------

test('the diff shape is green at both caps, amber one past either, and names the cap it applied', () => {
  const at = fixture('all-observable-green')
  at.diff = { changedLines: MERGE_BANDS.maxChangedLinesForMerge, changedFiles: MERGE_BANDS.maxChangedFilesForMerge }
  assert.equal(signalOf(assessMergeConfidence(at), 'diff.shape').band, 'green')

  const lines = fixture('all-observable-green')
  lines.diff = { changedLines: MERGE_BANDS.maxChangedLinesForMerge + 1, changedFiles: 1 }
  const overLines = signalOf(assessMergeConfidence(lines), 'diff.shape')
  assert.equal(overLines.band, 'amber')
  assert.ok(overLines.reason.includes('MERGE_BANDS.maxChangedLinesForMerge'), overLines.reason)

  const files = fixture('all-observable-green')
  files.diff = { changedLines: 1, changedFiles: MERGE_BANDS.maxChangedFilesForMerge + 1 }
  const overFiles = signalOf(assessMergeConfidence(files), 'diff.shape')
  assert.equal(overFiles.band, 'amber')
  assert.ok(overFiles.reason.includes('MERGE_BANDS.maxChangedFilesForMerge'), overFiles.reason)
})

test('no base to diff against is unobserved, saying so', () => {
  assert.match(signalOf(assessMergeConfidence(fixture('no-base')), 'diff.shape').reason, /no base/i)
})

test('a base with nothing to diff is unobserved with its reason, never an empty diff read as small', () => {
  const input = fixture('all-observable-green')
  input.diff = { base: 'HEAD', paths: [], nothingToDiff: '--base HEAD is HEAD or a descendant of it' }
  const entry = signalOf(assessMergeConfidence(input), 'diff.shape')
  assert.equal(entry.band, 'unobserved')
  assert.match(entry.reason, /descendant/)
})

test('a needs-human row is amber needing a person, carrying the row’s id and question', () => {
  const input = fixture('ledger-needs-human')
  const row = input.ledger.rows.find(r => r.class === 'needs_human')
  const entry = signalOf(assessMergeConfidence(input), 'decisions.open')
  assert.ok(said(entry).includes(row.id))
  assert.ok(said(entry).includes(row.question))
})

test('a missing ledger is amber, not unobserved, and says missing; an invalid row is amber too', () => {
  const missing = signalOf(assessMergeConfidence(fixture('ledger-missing')), 'decisions.open')
  assert.match(missing.reason, /missing/)

  const input = fixture('all-observable-green')
  input.ledger = { ...input.ledger, invalidCount: 1, invalid: 1, blocking: true }
  const invalid = signalOf(assessMergeConfidence(input), 'decisions.open')
  assert.equal(invalid.band, 'amber')
  assert.equal(invalid.kind, 'person')
})

test('a removed file a living spec cites is amber needing a fix, naming the spec and the file — and only this change’s', () => {
  const input = fixture('drift-broken-removed-file')
  const [mine, backlog] = input.drift.stale.broken
  const entry = signalOf(assessMergeConfidence(input), 'drift.stale')
  assert.ok(said(entry).includes(mine.spec))
  assert.ok(said(entry).includes(mine.file))
  assert.ok(!said(entry).includes(backlog.file), 'a broken citation elsewhere is the backlog, not this change')
})

test('another unarchived change on a shared capability is amber needing a person, naming the change and the capability', () => {
  const input = fixture('drift-unarchived-same-capability')
  const entry = signalOf(assessMergeConfidence(input), 'drift.stale')
  assert.ok(said(entry).includes('add-widget-search'))
  assert.ok(said(entry).includes('widgets/catalogue'))
})

test('with no change under assessment, every unarchived change counts', () => {
  const input = fixture('drift-unarchived-self')
  input.change = null
  assert.equal(signalOf(assessMergeConfidence(input), 'drift.stale').band, 'amber')
})

test('no graph is a flagged green carrying the reason the stale-citation check did not run', () => {
  const input = fixture('drift-no-graph')
  const entry = signalOf(assessMergeConfidence(input), 'drift.stale')
  assert.ok(said(entry).includes(input.drift.stale.reason))
})

test('a degraded run is amber, and no run record is unobserved with plan fidelity saying so', () => {
  for (const degradation of [
    { halted: true },
    { trajectoryComplete: false },
    { stageMarkerGaps: 1 },
    { rejectedReports: 1 },
    { permissionPrompts: 1 },
    { autoModeDenials: 1 }
  ]) {
    const input = fixture('all-observable-green')
    input.run = { ...input.run, ...degradation }
    assert.equal(signalOf(assessMergeConfidence(input), 'run.integrity').band, 'amber', JSON.stringify(degradation))
  }
  // A REVIEW.md that differs from the base ref is policy.humanPaths' question;
  // the run signal does not read it too (spec: review/merge-confidence, the
  // human-paths signal — a difference SHALL NOT move run integrity).
  const policy = fixture('all-observable-green')
  policy.run = { ...policy.run, policyDiffersFromBase: true }
  assert.equal(signalOf(assessMergeConfidence(policy), 'run.integrity').band, 'green')
  const edited = signalOf(assessMergeConfidence(fixture('policy-edited')), 'run.integrity')
  assert.equal(edited.band, 'green')
  assert.deepEqual(edited.flags, [])
  const input = fixture('all-observable-green')
  input.run = null
  const result = assessMergeConfidence(input)
  assert.equal(signalOf(result, 'run.integrity').band, 'unobserved')
  assert.match(signalOf(result, 'run.integrity').reason, /no run record/)
  assert.ok(signalOf(result, 'plan.fidelity').evidence.some(line => /no run record/.test(line)))
})

// --- the human-paths signal (spec: review/merge-confidence) -----------------------
//
// The list is read from the base, so the input carries `reviewPolicy`:
// { ref, humanPaths, problems, differsFromBase }. Each fixture is the green
// input with one policy state; the EXPECT table above pins that nothing but
// policy.humanPaths moved.

const withPolicy = (reviewPolicy, extra = {}) => {
  const input = fixture('all-observable-green')
  input.reviewPolicy = { ref: 'origin/main', humanPaths: [], problems: [], differsFromBase: false, ...reviewPolicy }
  return Object.assign(input, extra)
}
const humanPaths = input => signalOf(assessMergeConfidence(input), 'policy.humanPaths')

test('no listed path touched and an unchanged policy is green with no flag, naming the reference the list came from', () => {
  const input = fixture('all-observable-green')
  assert.deepEqual(input.reviewPolicy.humanPaths, ['lib/release'], 'the green input lists a path none of its changes touch')
  assert.ok(!input.changedPaths.some(p => p.startsWith('lib/release')))
  const entry = humanPaths(input)
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
  assert.equal(entry.kind, null)
  assert.ok(said(entry).includes(input.reviewPolicy.ref), `the evidence does not name ${input.reviewPolicy.ref}: ${said(entry)}`)
})

test('a touched listed path is amber, needs a person, and names the changed path and the path it falls under', () => {
  const entry = humanPaths(fixture('policy-listed-path-touched'))
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.ok(said(entry).includes('lib/release/publish.mjs'), said(entry))
  assert.ok(said(entry).includes('lib/release/'), 'the listed path is not named')
  const result = assessMergeConfidence(fixture('policy-listed-path-touched'))
  assert.equal(result.verdict, 'HUMAN')
  assert.ok(result.driving.some(d => d.id === 'policy.humanPaths' && d.kind === 'person'))
})

test('a policy edited in the working tree is amber naming REVIEW.md, and the listed path the base still holds', () => {
  const input = fixture('policy-edited')
  const entry = humanPaths(input)
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.ok(said(entry).includes('REVIEW.md'), said(entry))
  assert.ok(said(entry).includes('lib/release/publish.mjs'), said(entry))
  assert.ok(said(entry).includes('lib/release'), said(entry))
})

test('an edited policy alone is amber even when no listed path is touched', () => {
  const entry = humanPaths(withPolicy({ humanPaths: ['lib/release'], differsFromBase: true }))
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.ok(said(entry).includes('REVIEW.md'), said(entry))
})

test('an unreadable always-human-review section is amber, naming the problem', () => {
  const input = fixture('policy-unreadable')
  const entry = humanPaths(input)
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.ok(said(entry).includes(input.reviewPolicy.problems[0]), said(entry))
})

test('listed paths match on the canonical form: ./lib/release matches lib/release/a.mjs and not lib/releasex/a.mjs', () => {
  const hit = humanPaths(withPolicy({ humanPaths: ['./lib/release'] }, { changedPaths: ['lib/release/a.mjs'] }))
  assert.equal(hit.band, 'amber')
  assert.equal(hit.kind, 'person')
  assert.ok(said(hit).includes('lib/release/a.mjs'), said(hit))
  for (const prefix of ['./lib/release', 'lib/release/', 'lib/release']) {
    const miss = humanPaths(withPolicy({ humanPaths: [prefix] }, { changedPaths: ['lib/releasex/a.mjs'] }))
    assert.equal(miss.band, 'green', `${prefix} matched lib/releasex/a.mjs`)
  }
  // The boundary is a path segment, and the changed path may be spelled the long way too.
  const spelled = humanPaths(withPolicy({ humanPaths: ['lib/release'] }, { changedPaths: ['./lib/release/a.mjs'] }))
  assert.equal(spelled.band, 'amber')
})

test('a base with no REVIEW.md is green; no reviewPolicy at all is unobserved, saying no base was given', () => {
  const absent = humanPaths(withPolicy({ humanPaths: [], problems: [], differsFromBase: false }))
  assert.equal(absent.band, 'green')
  assert.deepEqual(absent.flags, [])

  const input = fixture('all-observable-green')
  input.reviewPolicy = null
  const none = humanPaths(input)
  assert.equal(none.band, 'unobserved')
  assert.equal(none.kind, 'evidence')
  assert.match(none.reason, /--base/)
  assert.match(none.reason, /no base|not given/i)
  assert.equal(signalOf(assessMergeConfidence(fixture('no-base')), 'policy.humanPaths').band, 'unobserved')
})

test('every reason the human-paths signal holds is listed in one amber entry, never one per reason', () => {
  const input = withPolicy(
    {
      humanPaths: ['lib/release', 'docs/policy'],
      problems: ['## Always Human Review: a section it could not read'],
      differsFromBase: true
    },
    { changedPaths: ['lib/release/publish.mjs', 'docs/policy/a.md', 'src/widgets/catalogue.ts'] }
  )
  const result = assessMergeConfidence(input)
  assert.equal(result.signals.filter(s => s.id === 'policy.humanPaths').length, 1)
  const entry = signalOf(result, 'policy.humanPaths')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  for (const needle of ['lib/release/publish.mjs', 'docs/policy/a.md', 'REVIEW.md', 'a section it could not read']) {
    assert.ok(said(entry).includes(needle), `the evidence omits ${needle}: ${said(entry)}`)
  }
  assert.ok(!said(entry).includes('src/widgets/catalogue.ts'), 'an unlisted path is named')
})

test('a REVIEW.md difference moves only the human-paths signal: run integrity reads the run, not the policy', () => {
  const clean = assessMergeConfidence(withPolicy({ humanPaths: [], differsFromBase: false }))
  const edited = assessMergeConfidence(withPolicy({ humanPaths: [], differsFromBase: true }))
  for (const entry of edited.signals) {
    if (entry.id === 'policy.humanPaths') continue
    const before = signalOf(clean, entry.id)
    assert.equal(entry.band, before.band, `${entry.id} moved with the policy edit`)
    assert.deepEqual(entry.flags, before.flags, `${entry.id} flags moved with the policy edit`)
  }
  assert.equal(signalOf(edited, 'policy.humanPaths').band, 'amber')
})

// --- the domain-skipped flag (spec: review/merge-confidence, the review signals) ----

test('a skipped domain review is a flag on a green ran signal, and scores below the same review without the skip', () => {
  const skipped = assessMergeConfidence(fixture('review-domain-skipped'))
  const entry = signalOf(skipped, 'review.ran')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, ['domain-skipped'])
  assert.ok(FLAGS.includes('domain-skipped'))
  assert.match(said(entry), /domain/i, 'the skip is not reported beside the signal')

  const plain = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(skipped.verdict, plain.verdict)
  assert.equal(skipped.worstBand, plain.worstBand)
  assert.ok(skipped.score < plain.score, `${skipped.score} is not below ${plain.score}`)
  assert.equal(skipped.counts.clean, plain.counts.clean - 1)
})

test('a skipped domain review beside a dimension that could not run keeps the amber and the flag', () => {
  const input = fixture('review-domain-skipped')
  input.review.dimensions = { ...input.review.dimensions, ran: ['qa'], unavailable: ['typescript'] }
  const entry = signalOf(assessMergeConfidence(input), 'review.ran')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
  assert.match(entry.reason, /typescript/)
  assert.deepEqual(entry.flags, ['domain-skipped'])
})

test('only a skipped domain dimension raises the flag: another skipped name, or an empty list, does not', () => {
  for (const skipped of [[], [{ name: 'security', reason: 'not selected' }]]) {
    const input = fixture('all-observable-green')
    input.review.dimensions = { ...input.review.dimensions, skipped }
    const entry = signalOf(assessMergeConfidence(input), 'review.ran')
    assert.equal(entry.band, 'green', JSON.stringify(skipped))
    assert.deepEqual(entry.flags, [], JSON.stringify(skipped))
  }
})

// --- the input contract -------------------------------------------------------------

test('every signal reading only a caller-supplied input is unobserved, saying the input was not given', () => {
  const result = assessMergeConfidence({
    change: null,
    changedPaths: ['src/widgets/catalogue.ts'],
    headSha: null,
    artifacts: {},
    review: null,
    verify: null,
    checklist: null,
    handoff: null,
    pipeline: null,
    coverage: null,
    diff: null,
    ledger: null,
    drift: null,
    run: null
  })
  const notGiven = {
    'review.blockers': /--review/,
    'review.warnings': /--review/,
    'review.adversarial': /--review/,
    'verify.suite': /--verify/,
    'verify.e2e': /--verify/,
    'verify.coverage': /--coverage/,
    'ci.pipeline': /--pipeline/,
    'diff.shape': /--base/
  }
  for (const [id, flag] of Object.entries(notGiven)) {
    const entry = signalOf(result, id)
    assert.equal(entry.band, 'unobserved', id)
    assert.match(entry.reason, flag, `${id}: ${entry.reason}`)
    assert.match(entry.reason, /not given/, `${id}: ${entry.reason}`)
  }
  // The human-paths signal reads a fact the CLI gathers from the base, so with
  // no base reference it is unobserved and says why.
  const policy = signalOf(result, 'policy.humanPaths')
  assert.equal(policy.band, 'unobserved')
  assert.match(policy.reason, /--base/)
  assert.match(policy.reason, /no base|not given/i)
  assert.equal(result.verdict, 'HUMAN')
})

test('assessing never mutates its input', () => {
  for (const name of [
    'all-observable-green',
    'drift-broken-removed-file',
    'conformance-short-denominator',
    'policy-edited',
    'review-domain-skipped'
  ]) {
    const input = fixture(name)
    const before = JSON.stringify(input)
    assessMergeConfidence(input)
    assert.equal(JSON.stringify(input), before, name)
  }
})

// --- the printed form ----------------------------------------------------------------

test('formatMergeConfidence prints the verdict, the score with its range and clean count, driving by kind, flags, every signal in order', () => {
  const input = fixture('verify-skipped-no-profile')
  input.drift = fixture('drift-unarchived-same-capability').drift
  const result = assessMergeConfidence(input)
  const text = formatMergeConfidence(result)
  assert.match(text, new RegExp(`\\b${result.verdict}\\b`))
  assert.ok(text.includes(String(result.score)))
  assert.ok(text.includes(`${result.range.floor}`) && text.includes(`${result.range.ceiling}`))
  assert.ok(text.includes(`${result.counts.clean} of ${result.counts.gating}`))
  for (const heading of ['needs a person', 'needs more evidence']) assert.ok(text.includes(heading), heading)
  assert.ok(text.includes('no-e2e'))
  let last = -1
  for (const id of SPEC_ORDER) {
    const at = text.indexOf(id, last + 1)
    assert.ok(at > last, `${id} is missing or out of registry order`)
    last = at
  }
})

// --- thresholds are read, never restated (spec: thresholds published) -------------
//
// The module may not carry a literal that equals a published merge threshold in
// a position where a threshold is applied. Two rules: a band value of two or
// more digits may not appear in code at all, and any band value may not be an
// operand of a comparison. Comments and string contents are stripped first.
// Structural arithmetic (a band floor is "one above the next-worse ceiling") is
// not a threshold, which is why a lone `+ 1` is allowed.

function bandValues(bands = MERGE_BANDS) {
  const out = []
  for (const value of Object.values(bands)) {
    if (value && typeof value === 'object') out.push(...Object.values(value))
    else out.push(value)
  }
  return [...new Set(out)]
}

// Blank a span but keep its newlines, so a reported line number is the file's.
const blank = span => span.replace(/[^\n]/g, ' ')

function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])(\/\/.*)$/gm, (_, lead, comment) => lead + blank(comment))
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, blank)
    .replace(/'(?:\\.|[^'\\\n])*'/g, blank)
    .replace(/"(?:\\.|[^"\\\n])*"/g, blank)
}

function literalThresholds(source, values = bandValues()) {
  const code = codeOf(source)
  const sites = []
  const lines = code.split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
      const value = Number(m[1])
      if (!values.includes(value)) continue
      const before = line.slice(0, m.index)
      const after = line.slice(m.index + m[0].length)
      const compared = /(?:[<>]=?|[!=]==?)\s*$/.test(before) || /^\s*(?:[<>]=?|[!=]==?)/.test(after)
      if (m[1].length > 1 || compared) sites.push(`lib/merge-confidence.mjs:${i + 1}: ${m[1]}`)
    }
  })
  return sites
}

test('the decision module restates no published merge threshold as a literal', () => {
  // The check itself, first: it must name a planted site.
  assert.deepEqual(literalThresholds("const x = 1\nif (warnings > 2) {}\n// > 2 in a comment\nconst y = 'over 400'\n"), [
    'lib/merge-confidence.mjs:2: 2'
  ])
  assert.deepEqual(literalThresholds('const cap = 400\n'), ['lib/merge-confidence.mjs:1: 400'])
  assert.deepEqual(literalThresholds(readFileSync(MODULE, 'utf8')), [])
})

test('the module reads every merge band by its published name', () => {
  const source = readFileSync(MODULE, 'utf8')
  for (const key of Object.keys(MERGE_BANDS)) {
    assert.ok(source.includes(`MERGE_BANDS.${key}`), `lib/merge-confidence.mjs never names MERGE_BANDS.${key}`)
  }
  assert.ok(source.includes('MERGE_ALLOWED_CLASSES'))
})

test('no expected score in this file is written as a number', () => {
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.doesNotMatch(self, /\.score\s*,\s*-?\d/)
  assert.doesNotMatch(self, /\.score\s*[<>]=?\s*-?\d/)
})

test('the module is pure: no node: import, no fs, no child process, no clock', () => {
  const code = codeOf(readFileSync(MODULE, 'utf8'))
  const imports = [...readFileSync(MODULE, 'utf8').matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
  for (const specifier of imports) assert.match(specifier, /^\.\/[\w-]+\.mjs$/, `impure import ${specifier}`)
  assert.doesNotMatch(code, /\bDate\b|\bperformance\b|\bprocess\b|\bMath\.random\b/)
})
