// The merge verdict and score (spec: review/merge-confidence).
//
// Two layers, tested apart on purpose (design D1, D11):
//
//   - `combineSignals` is the formula: worst band wins, unobserved ranks amber,
//     a flag lowers the score and never moves a band. The MERGE path, the green
//     ceiling and the flag rules are pinned here on synthetic result lists, so
//     the formula is checked apart from any one signal's reader.
//   - `assessMergeConfidence` is the registry run over a real input object. One
//     fixture per signal state lives in test/fixtures/merge-confidence/, each the
//     all-observable-green input with one state changed, and the table below says
//     exactly which signals that state moves. Every other gating signal must stay
//     where the green fixture put it, so a reader that leaks into a neighbour's
//     signal fails here.
//
// A third layer, at the end of this file, drives the built CLI in temporary git
// repositories for the two input rules that only the command can apply: a run's
// evidence file carried to a descendant head, and records bound to a head.
//
// Every expected score is computed from MERGE_BANDS.ceiling, never written as a
// number: a re-tuned ceiling must not break a test that was only pinning one.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SIGNALS,
  FLAGS,
  MERGE_LABELS,
  combineSignals,
  assessMergeConfidence,
  formatMergeConfidence,
  formatMergeConfidenceMarkdown,
  mergeConfidenceHeadline
} from '../../lib/merge-confidence.mjs'
import { MERGE_BANDS } from '../../lib/limits.mjs'
import { MERGE_ALLOWED_CLASSES, UNCLASSIFIABLE_CLASS, UNMATCHED_SOURCE_CLASS, classifyRisk } from '../../lib/risk.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURES = join(ROOT, 'test', 'fixtures', 'merge-confidence')
const MODULE = join(ROOT, 'lib', 'merge-confidence.mjs')
const DELIVERY_PAGE = join(ROOT, 'docs', '15-merge-confidence.md')

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
      'blast-radius-skipped',
      'legacy-unspecced',
      'no-graph',
      'requirements-omitted',
      'unmeasured-source'
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

// What the all-observable-green fixture reads: every gating signal green with
// no flag. It carries a confirmed living list, clean spec-coverage facts, and a
// run record with no unticked task, so it reads MERGE.
const BASELINE = Object.fromEntries(GATING_IDS.map(id => [id, G()]))

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
  // A blocker the vote kept and the quality band removed: no other signal sees it.
  'review-blocker-dropped-by-quality': { 'review.adversarial': A('person') },
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
  // Changed source the report never saw (design D13): a flag on a green
  // reading, a line of evidence on any other, nothing from an older producer.
  'coverage-unreported': { 'verify.coverage': G(['unmeasured-source']) },
  'coverage-unreported-decline': { 'verify.coverage': A('finding') },
  'coverage-unreported-fields-absent': {},
  'pipeline-required-fail': { 'ci.pipeline': R() },
  'pipeline-optional-fail': { 'ci.pipeline': A('finding') },
  'pipeline-pending': { 'ci.pipeline': U() },
  'pipeline-stale-sha': { 'ci.pipeline': U() },
  'pipeline-stale-sha-required-fail': { 'ci.pipeline': U() },
  // A pipeline input that is not well-formed is never "no checks" (design D7).
  'pipeline-checks-not-a-list': { 'ci.pipeline': U() },
  'pipeline-entry-not-an-object': { 'ci.pipeline': U() },
  'pipeline-unknown-state': { 'ci.pipeline': A('evidence') },
  'pipeline-excluded': {},
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
  'no-base': { 'diff.shape': U(), 'policy.humanPaths': U(), 'spec.coverage': U() },
  // The living-conformance states (design D6): one state changed per fixture.
  'living-confirmed': {},
  'living-unconfirmed': { 'conformance.living': A('evidence') },
  'living-short-denominator': { 'conformance.living': A('evidence') },
  'living-handoff-no-counts': { 'conformance.living': A('evidence') },
  'living-skipped-no-graph': { 'conformance.living': G(['no-graph']) },
  'living-partial': { 'conformance.living': G(['no-graph']) },
  'living-empty': {},
  'living-omitted': { 'conformance.living': G(['requirements-omitted']) },
  'living-cut-to-nothing': { 'conformance.living': G(['requirements-omitted']) },
  // The flag describes the list, so an amber reading of the answers carries it too.
  'living-omitted-unconfirmed': { 'conformance.living': { ...A('evidence'), flags: ['requirements-omitted'] } },
  'living-no-handoff': { 'conformance.delta': U(), 'conformance.living': U() },
  'living-not-gathered': { 'conformance.living': U() },
  // The spec-coverage states (design D8).
  'spec-coverage-unnamed-added': { 'spec.coverage': A('finding') },
  'spec-coverage-lost': { 'spec.coverage': A('finding') },
  'spec-coverage-legacy': { 'spec.coverage': G(['legacy-unspecced']) },
  // A run record with tasks left unticked (design D13).
  'run-tasks-unticked': { 'run.integrity': A('person') },
  // An observation the run record does not carry is unobserved, never a zero
  // (design D9); a recorded degradation beside it still wins.
  'run-record-empty': { 'run.integrity': U() },
  'run-counts-unobserved': { 'run.integrity': U() },
  'run-counts-unobserved-unticked': { 'run.integrity': A('person') },
  // Neither new input carried: both signals unobserved, for want of the fact.
  'new-inputs-not-gathered': { 'conformance.living': U(), 'spec.coverage': U() }
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

    // No reason names a producer that has yet to land: every signal has one.
    for (const entry of result.signals) {
      assert.doesNotMatch(said(entry), /producer|not landed|E6/, `${name}: ${entry.id} names an absent producer`)
    }
    assert.ok(
      !result.reasons.some(line => /can never|cannot read MERGE|no input to this version/i.test(line)),
      `${name}: a reason line says MERGE is unreachable`
    )

    // Verdict: MERGE iff every gating signal is green; BLOCK iff something is red.
    const bands = GATING_IDS.map(id => expected[id].band)
    const worst = worstOf(bands)
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

test('a clean input reads MERGE at the green ceiling, drives nothing, and no line says MERGE cannot be read', () => {
  const result = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(result.verdict, 'MERGE')
  assert.equal(result.worstBand, 'green')
  assert.deepEqual(result.driving, [])
  assert.equal(result.score, MERGE_BANDS.ceiling.green)
  assert.equal(result.counts.clean, result.counts.gating)
  for (const id of ['conformance.living', 'spec.coverage']) {
    const entry = signalOf(result, id)
    assert.equal(entry.band, 'green', `${id}: ${entry.reason}`)
    assert.deepEqual(entry.flags, [], id)
    assert.doesNotMatch(said(entry), /producer|not landed|E6/, `${id} names an absent producer`)
  }
  assert.ok(
    !result.reasons.some(line => /can never|cannot read MERGE|no input to this version|producer|not landed|E6/i.test(line)),
    `a reason line speaks of an absent producer or an unreachable MERGE: ${result.reasons.join(' | ')}`
  )
})

test('an input that omits the two newest facts reads them unobserved as not gathered, naming no absent capability', () => {
  const result = assessMergeConfidence(fixture('new-inputs-not-gathered'))
  assert.equal(result.verdict, 'HUMAN')
  for (const id of ['conformance.living', 'spec.coverage']) {
    const entry = signalOf(result, id)
    assert.equal(entry.band, 'unobserved', id)
    assert.equal(entry.kind, 'evidence', id)
    assert.match(entry.reason, /not gathered/, `${id}: ${entry.reason}`)
    assert.doesNotMatch(said(entry), /producer|not landed|E6|yet to be built/, `${id} names a capability that is not built`)
  }
  assert.deepEqual(result.driving.map(d => d.id).sort(), ['conformance.living', 'spec.coverage'])
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
  // The fixtures that sit under the small-change floor on purpose: the tiny
  // diff, and the change whose only added lines the report never saw.
  const UNDER_FLOOR = ['coverage-tiny-diff', 'coverage-unreported']
  for (const name of Object.keys(EXPECT).filter(n => n.startsWith('coverage-'))) {
    const c = cov(name)
    if (c.changedLines >= MERGE_BANDS.minChangedLinesForCoverage || name === 'coverage-at-size-floor') continue
    assert.ok(UNDER_FLOOR.includes(name), `${name} unexpectedly sits under the small-change floor`)
  }
  for (const name of UNDER_FLOOR) {
    assert.ok(cov(name).changedLines < MERGE_BANDS.minChangedLinesForCoverage, `${name} is no longer under the floor`)
  }
  assert.ok(decline(cov('coverage-unreported-decline')) > MERGE_BANDS.maxCoverageDeclinePts)
  assert.ok(cov('coverage-unreported-decline').changedLines >= MERGE_BANDS.minChangedLinesForCoverage)
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

test('a blocker the quality band removed is amber on the adversarial signal, needs a person, and names the finding', () => {
  const input = fixture('review-blocker-dropped-by-quality')
  const [dropped] = input.review.droppedByQuality
  assert.equal(dropped.severity, 'blocker', 'precondition')
  assert.ok(!input.review.surviving.some(f => f.title === dropped.title), 'precondition: it is not among the surviving')
  const result = assessMergeConfidence(input)
  assert.equal(signalOf(result, 'review.blockers').band, 'green', 'precondition: the blockers signal cannot see it')
  const entry = signalOf(result, 'review.adversarial')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.match(entry.reason, /quality band/)
  assert.ok(said(entry).includes(dropped.title), said(entry))
  assert.ok(said(entry).includes(dropped.file), said(entry))
  assert.equal(result.verdict, 'HUMAN')

  // The severity is read as the gate reads it, and one the gate would reject holds too.
  for (const severity of ['BLOCKER', ' blocker ', 'critical', undefined]) {
    const odd = fixture('review-blocker-dropped-by-quality')
    odd.review.droppedByQuality[0].severity = severity
    assert.equal(signalOf(assessMergeConfidence(odd), 'review.adversarial').band, 'amber', JSON.stringify(severity))
  }
  // A warning or a suggestion the band removed is the band doing its job.
  for (const severity of ['warning', 'suggestion', 'WARNING']) {
    const weak = fixture('review-blocker-dropped-by-quality')
    weak.review.droppedByQuality[0].severity = severity
    const read = assessMergeConfidence(weak)
    assert.equal(signalOf(read, 'review.adversarial').band, 'green', severity)
    assert.equal(read.verdict, 'MERGE', severity)
  }
  // A review record with no such list has nothing to read, and is not held for it.
  const absent = fixture('review-blocker-dropped-by-quality')
  delete absent.review.droppedByQuality
  assert.equal(signalOf(assessMergeConfidence(absent), 'review.adversarial').band, 'green')
})

// --- risk, read at merge over the touched paths only (design D9) ---------------------

/** The green input with only its changed paths and artifact text replaced. */
function riskInput(changedPaths, artifacts = {}) {
  const input = fixture('all-observable-green')
  input.changedPaths = changedPaths
  input.artifacts = artifacts
  return input
}

// Artifact text whose words classify critical at the spec stage: payment words,
// and the idempotency word, the one signal that has only a text rule.
const CRITICAL_PROSE = Object.freeze({
  'proposal.md': '## Why\n\nCharge the card once: the receipt write is idempotent, so a retry never double-charges.\n',
  'design.md': '## Decisions\n\nD1. The payment flow refunds through the existing billing client.\n'
})

test('precondition: the critical prose classifies critical when artifact text is read', () => {
  assert.equal(classifyRisk({ artifacts: { ...CRITICAL_PROSE } }).riskClass, 'critical')
  assert.ok(!MERGE_ALLOWED_CLASSES.includes('critical'))
  assert.ok(MERGE_ALLOWED_CLASSES.includes(UNMATCHED_SOURCE_CLASS), 'the unmatched-source class must be mergeable for the edge below')
})

test('a docs-and-tests change is green on risk with the class in the evidence, whatever the artifact text says', () => {
  const docsOnly = signalOf(assessMergeConfidence(fixture('docs-only')), 'risk.class')
  assert.equal(docsOnly.band, 'green')
  assert.match(said(docsOnly), /\blow\b/)

  for (const artifacts of [{}, { ...CRITICAL_PROSE }]) {
    const what = Object.keys(artifacts).length ? 'with critical prose' : 'with no prose'
    const entry = signalOf(
      assessMergeConfidence(riskInput(['docs/widgets.md', 'test/widgets/catalogue.test.ts'], artifacts)),
      'risk.class'
    )
    assert.equal(entry.band, 'green', `${what}: ${said(entry)}`)
    assert.equal(entry.flags.length, 0, what)
    assert.match(said(entry), /\bclass low\b/, what)
    assert.match(said(entry), /docs-tests-only/, what)
  }
})

test('a payment path is amber, needs a person, and names the payment signal and the path — never red', () => {
  const entry = signalOf(assessMergeConfidence(fixture('risk-payment')), 'risk.class')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.match(said(entry), /payment/)
  assert.ok(said(entry).includes('src/payments/charge.ts'))
  assert.ok(entry.reason.includes('MERGE_ALLOWED_CLASSES'), entry.reason)

  // The path alone earns the signal at merge; the prose beside it adds nothing.
  for (const artifacts of [{}, { ...CRITICAL_PROSE }]) {
    const what = Object.keys(artifacts).length ? 'with critical prose' : 'with no prose'
    const alone = signalOf(assessMergeConfidence(riskInput(['src/payments/charge.ts'], artifacts)), 'risk.class')
    assert.equal(alone.band, 'amber', `${what}: never red, and not green`)
    assert.equal(alone.kind, 'person', what)
    assert.match(said(alone), /payment: path src\/payments\/charge\.ts/, `${what}: ${said(alone)}`)
    assert.doesNotMatch(said(alone), /proposal\.md|design\.md|idempotency/, `${what}: artifact text was read at merge`)
  }
})

test('no changed paths fails closed to amber with the classifier’s unclassifiable reason, with and without artifact text', () => {
  const empty = signalOf(assessMergeConfidence(fixture('risk-empty')), 'risk.class')
  assert.equal(empty.band, 'amber', 'the classifier answered, so this is not unobserved')
  assert.match(said(empty), /unclassifiable/)

  for (const artifacts of [{}, { ...CRITICAL_PROSE }, { 'proposal.md': '## Why\n\nList the widgets in one view.\n' }]) {
    const what = JSON.stringify(Object.keys(artifacts))
    const entry = signalOf(assessMergeConfidence(riskInput([], artifacts)), 'risk.class')
    assert.equal(entry.band, 'amber', `${what}: not green and not unobserved, because the classifier answered`)
    assert.equal(entry.kind, 'person', what)
    assert.match(said(entry), /unclassifiable/, `${what}: artifact text is not read at merge, so nothing is left to classify`)
    assert.match(said(entry), new RegExp(`\\bclass ${UNCLASSIFIABLE_CLASS}\\b`), what)
  }
})

test('prose, a test path’s token and a test under a payments directory are not read at merge: the unmatched-source class, green', () => {
  const changedPaths = ['lib/receipt.mjs', 'test/spine/review-policy.test.mjs', 'test/payments/charge.test.mjs']
  const entry = signalOf(assessMergeConfidence(riskInput(changedPaths, { ...CRITICAL_PROSE })), 'risk.class')
  assert.equal(entry.band, 'green', said(entry))
  assert.match(said(entry), new RegExp(`\\bclass ${UNMATCHED_SOURCE_CLASS}\\b`), said(entry))
  assert.match(said(entry), /unmatched-source/, said(entry))
  assert.ok(said(entry).includes('lib/receipt.mjs'), said(entry))
  assert.doesNotMatch(said(entry), /\bpayment\b|auth-session|idempotency/, 'no signal fired from a test path or from prose')

  // The same paths and text, read as `interlock risk` reads them, still classify
  // above the merge-allowed classes: only the merge-time reading changed.
  const specStage = classifyRisk({ changedPaths, artifacts: { ...CRITICAL_PROSE } })
  assert.ok(!MERGE_ALLOWED_CLASSES.includes(specStage.riskClass), specStage.riskClass)
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

// --- changed source the report does not list (design D13) --------------------------

const verifyCoverageOf = name => signalOf(assessMergeConfidence(fixture(name)), 'verify.coverage')

test('every changed source file in the report: no unmeasured-source flag', () => {
  const input = fixture('all-observable-green')
  assert.deepEqual(input.coverage.unreportedFiles, [], 'precondition: the green input states an empty list')
  const entry = signalOf(assessMergeConfidence(input), 'verify.coverage')
  assert.equal(entry.band, 'green')
  assert.ok(!entry.flags.includes('unmeasured-source'))
})

test('a new source file no test loaded is a flag under the small-change floor, named with its added lines, and lowers the score', () => {
  const input = fixture('coverage-unreported')
  const [file] = input.coverage.unreportedFiles
  assert.equal(input.coverage.unreportedFiles.length, 1)
  const entry = verifyCoverageOf('coverage-unreported')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, ['unmeasured-source'])
  assert.ok(entry.reason.includes('MERGE_BANDS.minChangedLinesForCoverage'), 'the floor still decides the band')
  assert.ok(said(entry).includes(file), said(entry))
  assert.ok(said(entry).includes(String(input.coverage.unreportedAddedLines)), said(entry))

  const flagged = assessMergeConfidence(input)
  const plain = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(flagged.verdict, 'MERGE', 'a flag does not move the band')
  assert.ok(flagged.score < plain.score, `${flagged.score} is not below ${plain.score}`)
})

test('the flag never moves a band: a decline with unreported source is still amber, names the file, and carries no flag', () => {
  const input = fixture('coverage-unreported-decline')
  const entry = verifyCoverageOf('coverage-unreported-decline')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'finding')
  assert.deepEqual(entry.flags, [])
  assert.ok(entry.evidence.some(line => line.includes(input.coverage.unreportedFiles[0])), entry.evidence.join('\n'))
  // The band is what it is without the two fields.
  assert.equal(verifyCoverageOf('coverage-decline-beyond').band, entry.band)
})

test('an input from an older producer raises no flag and says the input does not state unreported files', () => {
  const input = fixture('coverage-unreported-fields-absent')
  assert.ok(!('unreportedFiles' in input.coverage) && !('unreportedAddedLines' in input.coverage))
  const entry = verifyCoverageOf('coverage-unreported-fields-absent')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
  assert.ok(entry.evidence.some(line => /does not state/.test(line)), entry.evidence.join('\n'))
  // And an input that does state them does not say so.
  assert.ok(!verifyCoverageOf('all-observable-green').evidence.some(line => /does not state/.test(line)))
})

test('no coverage configured is green with no-coverage and never unmeasured-source', () => {
  const input = fixture('all-observable-green')
  input.coverage = { configured: false, unreportedFiles: null, unreportedAddedLines: null }
  const entry = signalOf(assessMergeConfidence(input), 'verify.coverage')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, ['no-coverage'])
})

test('the flag rides every green reading: the tolerance, the patch floor and the size floor each keep their own', () => {
  const unreported = { unreportedFiles: ['src/widgets/importer.ts'], unreportedAddedLines: 12 }
  for (const [name, own] of [
    ['coverage-decline-inside', []],
    ['coverage-no-baseline', ['no-baseline']],
    ['coverage-tiny-diff', []]
  ]) {
    const input = fixture(name)
    input.coverage = { ...input.coverage, ...unreported }
    const entry = signalOf(assessMergeConfidence(input), 'verify.coverage')
    assert.equal(entry.band, 'green', name)
    assert.deepEqual([...entry.flags].sort(), [...own, 'unmeasured-source'].sort(), name)
  }
  // An unobserved reading names the files too, and is still unobserved.
  const stale = fixture('coverage-not-ancestor')
  stale.coverage = { ...stale.coverage, ...unreported }
  const entry = signalOf(assessMergeConfidence(stale), 'verify.coverage')
  assert.equal(entry.band, 'unobserved')
  assert.deepEqual(entry.flags, [])
  assert.ok(entry.evidence.some(line => line.includes('src/widgets/importer.ts')))
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

test('a pipeline whose checks is not a list is unobserved, saying the input is not well-formed, and is never MERGE', () => {
  const input = fixture('pipeline-checks-not-a-list')
  assert.equal(typeof input.pipeline.checks, 'string')
  assert.equal(input.pipeline.sha, input.headSha, 'precondition: the input is for the head commit')
  const result = assessMergeConfidence(input)
  const entry = signalOf(result, 'ci.pipeline')
  assert.equal(entry.band, 'unobserved')
  assert.match(entry.reason, /not well-formed/)
  assert.deepEqual(entry.flags, [], 'never the no-pipeline flag')
  assert.notEqual(result.verdict, 'MERGE')

  // A list that is simply absent reads the same way: absent is not empty.
  const missing = fixture('all-observable-green')
  delete missing.pipeline.checks
  const absent = signalOf(assessMergeConfidence(missing), 'ci.pipeline')
  assert.equal(absent.band, 'unobserved')
  assert.match(absent.reason, /not well-formed/)

  // The reproduced defect: a failed required check under a misspelt key.
  const misspelt = fixture('pipeline-required-fail')
  misspelt.pipeline = { sha: misspelt.pipeline.sha, check: misspelt.pipeline.checks }
  const hidden = assessMergeConfidence(misspelt)
  assert.equal(signalOf(hidden, 'ci.pipeline').band, 'unobserved')
  assert.notEqual(hidden.verdict, 'MERGE')
})

test('a pipeline holding an entry that is not an object is unobserved, saying the input is not well-formed', () => {
  const entry = signalOf(assessMergeConfidence(fixture('pipeline-entry-not-an-object')), 'ci.pipeline')
  assert.equal(entry.band, 'unobserved')
  assert.match(entry.reason, /not well-formed/)
})

test('an entry in a state outside the four is amber, needing more evidence, naming the entry and its state', () => {
  const input = fixture('pipeline-unknown-state')
  const odd = input.pipeline.checks.find(c => !['pass', 'fail', 'pending', 'skipped'].includes(c.state))
  const entry = signalOf(assessMergeConfidence(input), 'ci.pipeline')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
  assert.ok(entry.reason.includes(`${odd.name}=${odd.state}`), entry.reason)
})

test('an excluded check is named in the evidence beside a green signal, and an input with no exclusions has no such line', () => {
  const input = fixture('pipeline-excluded')
  const [excluded] = input.pipeline.excluded
  assert.ok(!input.pipeline.checks.some(c => c.name === excluded), 'precondition: the excluded check is not an entry')
  const entry = signalOf(assessMergeConfidence(input), 'ci.pipeline')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
  assert.ok(entry.evidence.some(line => line.includes(excluded) && /excluded by the caller/.test(line)), entry.evidence.join('\n'))

  const plain = signalOf(assessMergeConfidence(fixture('all-observable-green')), 'ci.pipeline')
  assert.ok(!plain.evidence.some(line => /excluded by the caller/.test(line)))
})

test('excluded names are in the evidence whatever band the signal reads', () => {
  const named = entry => entry.evidence.some(line => line.includes('merge-gate') && /excluded by the caller/.test(line))
  for (const name of ['pipeline-required-fail', 'pipeline-optional-fail', 'pipeline-pending', 'pipeline-stale-sha', 'pipeline-unknown-state']) {
    const input = fixture(name)
    input.pipeline = { ...input.pipeline, excluded: ['merge-gate'] }
    const entry = signalOf(assessMergeConfidence(input), 'ci.pipeline')
    assert.ok(named(entry), `${name} [${entry.band}]: ${entry.evidence.join(' | ')}`)
  }
  const empty = fixture('all-observable-green')
  empty.pipeline = { ...empty.pipeline, checks: [], excluded: ['merge-gate'] }
  const entry = signalOf(assessMergeConfidence(empty), 'ci.pipeline')
  assert.deepEqual(entry.flags, ['no-pipeline'])
  assert.ok(named(entry), entry.evidence.join(' | '))
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

// --- living conformance (spec: review/merge-confidence; design D6) -------------------
//
// The input carries `living` — { skipped, partial, requirementsRequired, omitted,
// source } — and the handoff's requirementsChecked / requirementsUnconfirmed.
// The denominator is the command's own requirementsRequired, never the handoff's.

const livingOf = name => signalOf(assessMergeConfidence(fixture(name)), 'conformance.living')

test('every living requirement confirmed is green with no flag, stating the number checked and the number counted', () => {
  const input = fixture('living-confirmed')
  assert.equal(input.living.requirementsRequired, input.handoff.requirementsChecked)
  const entry = signalOf(assessMergeConfidence(input), 'conformance.living')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
  assert.equal(entry.kind, null)
  assert.ok(said(entry).includes(`${input.handoff.requirementsChecked} of ${input.living.requirementsRequired}`), said(entry))
})

test('an unconfirmed living requirement is amber, needs more evidence, and carries both counts', () => {
  const input = fixture('living-unconfirmed')
  const entry = livingOf('living-unconfirmed')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
  assert.ok(said(entry).includes(String(input.handoff.requirementsUnconfirmed)), said(entry))
  assert.ok(said(entry).includes(String(input.living.requirementsRequired)), said(entry))
  assert.notEqual(assessMergeConfidence(input).verdict, 'MERGE')
})

test('a handoff that states a smaller living denominator is judged against the command’s own count, and the stated one is ignored', () => {
  const input = fixture('living-short-denominator')
  assert.ok(input.handoff.requirementsRequired < input.living.requirementsRequired, 'precondition: the handoff claims less')
  assert.equal(input.handoff.requirementsUnconfirmed, 0)
  const entry = livingOf('living-short-denominator')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
  assert.ok(
    entry.reason.includes(`${input.handoff.requirementsChecked} of ${input.living.requirementsRequired}`),
    entry.reason
  )
  assert.ok(
    !entry.reason.includes(`${input.handoff.requirementsChecked} of ${input.handoff.requirementsRequired}`),
    'the handoff’s own denominator was read'
  )
})

test('a handoff carrying neither living count is amber, not green and not unobserved', () => {
  const input = fixture('living-handoff-no-counts')
  assert.equal(input.handoff.requirementsChecked, undefined)
  assert.equal(input.handoff.requirementsUnconfirmed, undefined)
  const entry = livingOf('living-handoff-no-counts')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
})

test('a living list skipped for want of a graph is green with the no-graph flag; an empty list is green with none', () => {
  const skipped = livingOf('living-skipped-no-graph')
  assert.equal(skipped.band, 'green')
  assert.deepEqual(skipped.flags, ['no-graph'])
  const empty = livingOf('living-empty')
  assert.equal(empty.band, 'green')
  assert.deepEqual(empty.flags, [])
  assert.equal(fixture('living-empty').living.skipped, null, 'precondition: empty is not skipped')
  assert.equal(fixture('living-empty').living.partial, null, 'precondition: empty is not partial')
  assert.ok(said(empty).length > 0)
  // Nothing to confirm needs no answer, so the handoff's silence on the count does not hold it.
  assert.equal(fixture('living-empty').handoff.requirementsChecked, undefined)
})

test('a list built from declared capabilities only adds no-graph to whichever band the answers decide', () => {
  const confirmed = livingOf('living-partial')
  assert.equal(confirmed.band, 'green')
  assert.deepEqual(confirmed.flags, ['no-graph'])

  const input = fixture('living-partial')
  input.handoff.requirementsUnconfirmed = 1
  const unconfirmed = signalOf(assessMergeConfidence(input), 'conformance.living')
  assert.equal(unconfirmed.band, 'amber')
  assert.deepEqual(unconfirmed.flags, ['no-graph'])
})

test('a list the bound cut short is green with requirements-omitted, its evidence stating asked and left out, and scores below the uncut list', () => {
  const input = fixture('living-omitted')
  assert.equal(input.living.omitted.length, 2)
  const entry = livingOf('living-omitted')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, ['requirements-omitted'])
  assert.match(said(entry), /\b4\b/)
  assert.match(said(entry), /\b2\b/)
  assert.match(said(entry), /left out/)

  const cut = assessMergeConfidence(input)
  const plain = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(cut.verdict, 'MERGE', 'a flag does not move the band')
  assert.ok(cut.score < plain.score, `${cut.score} is not below ${plain.score}`)
  assert.equal(cut.counts.clean, plain.counts.clean - 1)
})

test('a list the bound cut short carries requirements-omitted and what was left out at an amber reading too, with no-graph beside it', () => {
  const left = fixture('living-omitted').living.omitted
  const leftOut = entry => left.every(o => said(entry).includes(o.heading)) && /4 requirement\(s\) asked and 2 left out/.test(said(entry))

  // An unconfirmed requirement.
  const unconfirmed = livingOf('living-omitted-unconfirmed')
  assert.equal(unconfirmed.band, 'amber')
  assert.deepEqual(unconfirmed.flags, ['requirements-omitted'])
  assert.ok(leftOut(unconfirmed), said(unconfirmed))
  assert.equal(assessMergeConfidence(fixture('living-omitted-unconfirmed')).verdict, 'HUMAN', 'the flag does not move the band')

  // A short count, and a handoff with no living counts.
  const short = fixture('living-omitted')
  short.handoff.requirementsChecked = 3
  const noCounts = fixture('living-omitted')
  delete noCounts.handoff.requirementsChecked
  delete noCounts.handoff.requirementsUnconfirmed
  for (const input of [short, noCounts]) {
    const entry = signalOf(assessMergeConfidence(input), 'conformance.living')
    assert.equal(entry.band, 'amber')
    assert.deepEqual(entry.flags, ['requirements-omitted'])
    assert.ok(leftOut(entry), said(entry))
  }

  // Cut and built without a graph: both flags, whichever band the answers decide.
  for (const unconfirmedCount of [0, 1]) {
    const both = fixture('living-omitted')
    both.living.partial = fixture('living-partial').living.partial
    both.handoff.requirementsUnconfirmed = unconfirmedCount
    const entry = signalOf(assessMergeConfidence(both), 'conformance.living')
    assert.equal(entry.band, unconfirmedCount ? 'amber' : 'green')
    assert.deepEqual(entry.flags, ['no-graph', 'requirements-omitted'])
  }
})

test('a list the bound cut to nothing is green with requirements-omitted, stating none asked and how many were left out', () => {
  const input = fixture('living-cut-to-nothing')
  assert.equal(input.living.requirementsRequired, 0)
  const left = input.living.omitted.length
  assert.ok(left > 0, 'precondition: requirements were left out')
  const entry = livingOf('living-cut-to-nothing')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, ['requirements-omitted'])
  assert.ok(entry.evidence.some(line => line.includes(`0 requirement(s) asked`) && line.includes(`${left} left out`)), entry.evidence.join('\n'))
  for (const o of input.living.omitted) assert.ok(said(entry).includes(o.heading), o.heading)

  const cut = assessMergeConfidence(input)
  const plain = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(cut.verdict, 'MERGE', 'a flag does not move the band')
  assert.ok(cut.score < plain.score, `${cut.score} is not below ${plain.score}`)
  // An empty list with nothing left out is still green with no flag.
  assert.deepEqual(livingOf('living-empty').flags, [])
})

test('a list with entries and no handoff is unobserved saying the requirements have no answers; no list is unobserved saying not gathered', () => {
  const noHandoff = livingOf('living-no-handoff')
  assert.equal(noHandoff.band, 'unobserved')
  assert.equal(noHandoff.kind, 'evidence')
  assert.match(noHandoff.reason, /no answers/)
  const notGathered = livingOf('living-not-gathered')
  assert.equal(notGathered.band, 'unobserved')
  assert.match(notGathered.reason, /not gathered/)
  assert.doesNotMatch(notGathered.reason, /no answers/)
})

// --- spec coverage (spec: review/merge-confidence; design D8) -------------------------
//
// The input carries `specCoverage` — { added: [{ path, namedBy }], lost: [{ path,
// spec }], legacy: [path], repo: { named, total } } — computed from spec text,
// so no fixture here has a graph and none needs one.

const coverageOf = name => signalOf(assessMergeConfidence(fixture(name)), 'spec.coverage')

test('an added source file its own delta spec names is green with no flag, and a test file is not among the files judged', () => {
  const input = fixture('all-observable-green')
  const entry = signalOf(assessMergeConfidence(input), 'spec.coverage')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
  assert.ok(said(entry).includes('src/widgets/catalogue.ts'), said(entry))
  assert.match(said(entry), /delta/)
  assert.ok(!said(entry).includes('test/widgets/catalogue.test.ts'), 'a test file is judged')
  assert.ok(input.changedPaths.includes('test/widgets/catalogue.test.ts'), 'precondition: the test file is in the diff')
})

test('an added source file a living spec names is green too', () => {
  const input = fixture('all-observable-green')
  input.specCoverage.added = [{ path: 'src/widgets/catalogue.ts', namedBy: 'living' }]
  const entry = signalOf(assessMergeConfidence(input), 'spec.coverage')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
  assert.match(said(entry), /living/)
})

test('an added source file no spec names is amber, needs a fix, names the file, and holds the verdict at HUMAN', () => {
  const input = fixture('spec-coverage-unnamed-added')
  const entry = coverageOf('spec-coverage-unnamed-added')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'finding')
  assert.ok(said(entry).includes('lib/orphan.mjs'), said(entry))
  const result = assessMergeConfidence(input)
  assert.equal(result.verdict, 'HUMAN')
  assert.ok(result.driving.some(d => d.id === 'spec.coverage' && d.kind === 'finding'))
})

test('a kept file that lost the only spec naming it is amber, needs a fix, and names the file and the spec', () => {
  const input = fixture('spec-coverage-lost')
  const [lost] = input.specCoverage.lost
  const entry = coverageOf('spec-coverage-lost')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'finding')
  assert.ok(said(entry).includes(lost.path), said(entry))
  assert.ok(said(entry).includes(lost.spec), said(entry))
  assert.equal(assessMergeConfidence(input).verdict, 'HUMAN')
})

test('an edited file nothing names is a flag, never a band: green, the count and the repository’s figure in the evidence, a lower score', () => {
  const input = fixture('spec-coverage-legacy')
  const entry = coverageOf('spec-coverage-legacy')
  assert.equal(entry.band, 'green')
  assert.equal(entry.kind, null)
  assert.deepEqual(entry.flags, ['legacy-unspecced'])
  assert.ok(said(entry).includes(`${input.specCoverage.repo.named} of ${input.specCoverage.repo.total}`), said(entry))
  assert.match(said(entry), /\b1\b/, 'the evidence states the one edited file')
  assert.ok(said(entry).includes('lib/old.mjs'), said(entry))

  const flagged = assessMergeConfidence(input)
  const plain = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(flagged.verdict, 'MERGE')
  assert.ok(flagged.score < plain.score, `${flagged.score} is not below ${plain.score}`)
  assert.equal(flagged.counts.clean, plain.counts.clean - 1)
})

test('an unnamed added file outranks a legacy file: the band is amber and the legacy flag is still reported', () => {
  const input = fixture('spec-coverage-unnamed-added')
  input.specCoverage.legacy = ['lib/old.mjs']
  const entry = signalOf(assessMergeConfidence(input), 'spec.coverage')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'finding')
})

test('no base is unobserved saying so; a base with nothing to diff is unobserved with the diff’s reason', () => {
  const none = coverageOf('no-base')
  assert.equal(none.band, 'unobserved')
  assert.equal(none.kind, 'evidence')
  assert.match(none.reason, /no base|not given|--base/i)

  const input = fixture('all-observable-green')
  input.diff = { base: 'HEAD', paths: [], nothingToDiff: '--base HEAD is HEAD or a descendant of it' }
  delete input.specCoverage
  const empty = signalOf(assessMergeConfidence(input), 'spec.coverage')
  assert.equal(empty.band, 'unobserved')
  assert.match(empty.reason, /descendant/)
})

test('the signal does not read the graph: a repository with none reads the same band, with no no-graph flag', () => {
  const input = fixture('drift-no-graph')
  assert.equal(input.drift.stale.skipped, true, 'precondition: the fixture has no usable graph')
  const entry = signalOf(assessMergeConfidence(input), 'spec.coverage')
  assert.equal(entry.band, 'green')
  assert.deepEqual(entry.flags, [])
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

test('tasks left unticked hold the run at amber, need a person, and the reason states how many', () => {
  const input = fixture('run-tasks-unticked')
  assert.equal(input.run.leftoverTasks, 2)
  assert.equal(input.run.halted, false, 'precondition: no other degradation')
  assert.equal(input.run.trajectoryComplete, true)
  const entry = signalOf(assessMergeConfidence(input), 'run.integrity')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.match(entry.reason, /2 tasks?/)
  assert.match(entry.reason, /unticked/)
  const result = assessMergeConfidence(input)
  assert.equal(result.verdict, 'HUMAN')
  assert.ok(result.driving.some(d => d.id === 'run.integrity' && d.kind === 'person'))
})

test('no task left unticked is not a degradation; a record that does not carry the count is unobserved, naming it', () => {
  const clean = fixture('all-observable-green')
  assert.equal(clean.run.leftoverTasks, 0)
  assert.equal(signalOf(assessMergeConfidence(clean), 'run.integrity').band, 'green')
  delete clean.run.leftoverTasks
  const entry = signalOf(assessMergeConfidence(clean), 'run.integrity')
  assert.equal(entry.band, 'unobserved')
  assert.equal(entry.kind, 'evidence')
  assert.ok(entry.reason.includes('leftoverTasks'), entry.reason)
})

// The seven observations a close records, by the keys the record uses for them
// (design D9). Two tests written apart assert the same strings.
const RUN_OBSERVATIONS = [
  'halted',
  'trajectoryComplete',
  'stageMarkerGaps',
  'rejectedReports',
  'permissionPrompts',
  'autoModeDenials',
  'leftoverTasks'
]

test('an empty run record is unobserved and names every observation it lacks; the verdict is not MERGE', () => {
  const input = fixture('run-record-empty')
  assert.deepEqual(input.run, {})
  const result = assessMergeConfidence(input)
  const entry = signalOf(result, 'run.integrity')
  assert.equal(entry.band, 'unobserved')
  for (const key of RUN_OBSERVATIONS) assert.ok(entry.reason.includes(key), `${entry.reason} does not name ${key}`)
  assert.notEqual(result.verdict, 'MERGE')
})

test('counts the host could not observe are unobserved, naming those two keys and no other', () => {
  const input = fixture('run-counts-unobserved')
  assert.equal(input.run.permissionPrompts, null)
  assert.equal(input.run.autoModeDenials, null)
  const entry = signalOf(assessMergeConfidence(input), 'run.integrity')
  assert.equal(entry.band, 'unobserved')
  const named = RUN_OBSERVATIONS.filter(key => entry.reason.includes(key))
  assert.deepEqual(named, ['permissionPrompts', 'autoModeDenials'], entry.reason)
})

test('a recorded degradation beside unobserved counts is still amber, needing a person, naming the unticked task', () => {
  const input = fixture('run-counts-unobserved-unticked')
  assert.equal(input.run.permissionPrompts, null)
  assert.equal(input.run.leftoverTasks, 1)
  const entry = signalOf(assessMergeConfidence(input), 'run.integrity')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'person')
  assert.match(entry.reason, /unticked/)
  // A halt beside nothing else at all is a degradation too, not a missing record.
  const halted = fixture('all-observable-green')
  halted.run = { halted: true }
  assert.equal(signalOf(assessMergeConfidence(halted), 'run.integrity').band, 'amber')
})

test('every observation, absent or null on its own, moves a clean record to unobserved', () => {
  for (const key of RUN_OBSERVATIONS) {
    for (const strip of ['absent', 'null']) {
      const input = fixture('all-observable-green')
      if (strip === 'absent') delete input.run[key]
      else input.run[key] = null
      const entry = signalOf(assessMergeConfidence(input), 'run.integrity')
      assert.equal(entry.band, 'unobserved', `${key} ${strip}: ${entry.reason}`)
      assert.deepEqual(RUN_OBSERVATIONS.filter(k => entry.reason.includes(k)), [key], `${key} ${strip}: ${entry.reason}`)
    }
  }
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

// --- the blast-radius-skipped flag (spec: review/merge-confidence, the review signals) ----

const BLAST_RADIUS_SKIP = Object.freeze({ name: 'blast-radius', reason: 'no graph at .claude/graph/graph.json — run /interlock:graph' })

/** The green input whose dimension record names `skipped` entries, every selected dimension still run. */
function withSkipped(...skipped) {
  const input = fixture('all-observable-green')
  input.review.dimensions = { ...input.review.dimensions, skipped: skipped.map(entry => ({ ...entry })) }
  return input
}

test('a skipped blast-radius review is a flag on a green ran signal, and scores below the same review without the skip', () => {
  assert.ok(FLAGS.includes('blast-radius-skipped'), 'FLAGS does not publish blast-radius-skipped')
  const skipped = assessMergeConfidence(withSkipped(BLAST_RADIUS_SKIP))
  const entry = signalOf(skipped, 'review.ran')
  assert.equal(entry.band, 'green', said(entry))
  assert.deepEqual(entry.flags, ['blast-radius-skipped'])
  assert.match(said(entry), /blast-radius/, 'the skip is not reported beside the signal')

  const plain = assessMergeConfidence(fixture('all-observable-green'))
  assert.equal(skipped.verdict, plain.verdict)
  assert.equal(skipped.worstBand, plain.worstBand)
  assert.ok(skipped.score < plain.score, `${skipped.score} is not below ${plain.score}`)
  assert.equal(skipped.counts.clean, plain.counts.clean - 1)
})

test('a review that skipped both domain and blast-radius is green on the ran signal and carries both flags', () => {
  const domain = fixture('review-domain-skipped').review.dimensions.skipped
  const both = assessMergeConfidence(withSkipped(...domain, BLAST_RADIUS_SKIP))
  const entry = signalOf(both, 'review.ran')
  assert.equal(entry.band, 'green', said(entry))
  assert.deepEqual([...entry.flags].sort(), ['blast-radius-skipped', 'domain-skipped'])
  assert.equal(both.verdict, assessMergeConfidence(fixture('all-observable-green')).verdict)
})

test('a skipped blast-radius review beside a dimension that could not run keeps the amber and the flag', () => {
  const input = withSkipped(BLAST_RADIUS_SKIP)
  input.review.dimensions = { ...input.review.dimensions, ran: ['qa'], unavailable: ['typescript'] }
  const entry = signalOf(assessMergeConfidence(input), 'review.ran')
  assert.equal(entry.band, 'amber')
  assert.equal(entry.kind, 'evidence')
  assert.match(entry.reason, /typescript/)
  assert.deepEqual(entry.flags, ['blast-radius-skipped'])
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
  // So does the spec-coverage signal; the living list is a fact the CLI gathers,
  // and an input that carries none says it was not gathered.
  const coverage = signalOf(result, 'spec.coverage')
  assert.equal(coverage.band, 'unobserved')
  assert.match(coverage.reason, /no base|not given|--base/i)
  const living = signalOf(result, 'conformance.living')
  assert.equal(living.band, 'unobserved')
  assert.match(living.reason, /not gathered/)
  assert.match(signalOf(result, 'run.integrity').reason, /no run record/)
  assert.equal(result.verdict, 'HUMAN')
})

test('assessing never mutates its input', () => {
  for (const name of [
    'all-observable-green',
    'drift-broken-removed-file',
    'conformance-short-denominator',
    'policy-edited',
    'review-domain-skipped',
    'living-omitted',
    'spec-coverage-lost'
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

test('mergeConfidenceHeadline is the first line formatMergeConfidence prints, in the published form', () => {
  for (const name of ['all-observable-green', 'review-with-blocker', 'no-review', 'living-omitted', 'new-inputs-not-gathered']) {
    const result = assessMergeConfidence(fixture(name))
    const headline = mergeConfidenceHeadline(result)
    assert.equal(typeof headline, 'string')
    assert.equal(headline, formatMergeConfidence(result).split('\n')[0], name)
    assert.ok(!headline.includes('\n'), `${name}: the headline spans lines`)
    assert.equal(
      headline,
      `MERGE CONFIDENCE ${result.verdict} — score ${result.score} (${result.range.band} range ${result.range.floor}–${result.range.ceiling}; ` +
        `${result.counts.clean} of ${result.counts.gating} gating signals clean)`,
      name
    )
  }
})

// --- the labels (design D14) ----------------------------------------------------------

const HEX_COLOR = /^[0-9a-f]{6}$/i
const VERDICTS = ['MERGE', 'HUMAN', 'BLOCK']

test('MERGE_LABELS is frozen: one named, coloured, described label per verdict, a score prefix and the score label’s look', () => {
  assert.ok(Object.isFrozen(MERGE_LABELS))
  assert.ok(Object.isFrozen(MERGE_LABELS.verdicts))
  assert.ok(Object.isFrozen(MERGE_LABELS.score))
  assert.deepEqual(Object.keys(MERGE_LABELS).sort(), ['score', 'scorePrefix', 'verdicts'])
  assert.deepEqual(Object.keys(MERGE_LABELS.verdicts).sort(), [...VERDICTS].sort())
  for (const verdict of VERDICTS) {
    const label = MERGE_LABELS.verdicts[verdict]
    assert.ok(Object.isFrozen(label), `${verdict} label is not frozen`)
    assert.deepEqual(Object.keys(label).sort(), ['color', 'description', 'name'])
    assert.equal(typeof label.name, 'string')
    assert.match(label.color, HEX_COLOR, `${verdict} color`)
    assert.ok(typeof label.description === 'string' && label.description.length > 0)
  }
  assert.deepEqual(
    VERDICTS.map(v => MERGE_LABELS.verdicts[v].name),
    ['interlock/merge', 'interlock/human-review', 'interlock/blocked']
  )
  assert.equal(MERGE_LABELS.scorePrefix, 'interlock/score-')
  assert.deepEqual(Object.keys(MERGE_LABELS.score).sort(), ['color', 'description'])
  assert.match(MERGE_LABELS.score.color, HEX_COLOR)
  assert.ok(typeof MERGE_LABELS.score.description === 'string' && MERGE_LABELS.score.description.length > 0)
})

test('an assessment carries the labels for its verdict and score, read from the one list', () => {
  for (const name of ['all-observable-green', 'no-review', 'review-with-blocker']) {
    const result = assessMergeConfidence(fixture(name))
    const { labels } = result
    assert.deepEqual(Object.keys(labels).sort(), ['score', 'scorePrefix', 'verdict', 'verdictNames'], name)
    assert.deepEqual(labels.verdict, { ...MERGE_LABELS.verdicts[result.verdict] }, name)
    assert.equal(labels.verdict.name, MERGE_LABELS.verdicts[result.verdict].name)
    assert.deepEqual(Object.keys(labels.score).sort(), ['color', 'description', 'name'])
    assert.equal(labels.score.name, MERGE_LABELS.scorePrefix + String(result.score), name)
    assert.equal(labels.score.color, MERGE_LABELS.score.color)
    assert.equal(labels.score.description, MERGE_LABELS.score.description)
    assert.deepEqual(labels.verdictNames, VERDICTS.map(v => MERGE_LABELS.verdicts[v].name))
    assert.equal(labels.scorePrefix, MERGE_LABELS.scorePrefix)
  }
  // combineSignals is where the verdict and score are made, so it carries them too.
  const combined = combineSignals([sig('green'), sig('amber', { kind: 'person' })])
  assert.equal(combined.labels.verdict.name, MERGE_LABELS.verdicts.HUMAN.name)
})

test('the score label is the prefix and the decimal digits of the score, with no padding', () => {
  const unpadded = /-(0|[1-9]\d*)$/
  const three = assessMergeConfidence(fixture('all-observable-green'))
  const fewer = assessMergeConfidence(fixture('review-with-blocker'))
  assert.equal(String(three.score).length, 3, 'precondition: a three-digit score')
  assert.ok(String(fewer.score).length < 3, 'precondition: a score of fewer digits')
  for (const result of [three, fewer]) {
    assert.equal(result.labels.score.name, MERGE_LABELS.scorePrefix + String(result.score))
    assert.match(result.labels.score.name, unpadded)
  }
  // The floor of the red range, whatever the bands are.
  const zero = combineSignals([sig('red', { kind: 'finding' })], { bands: { ...MERGE_BANDS, ceiling: { green: 9, amber: 5, red: 0 } } })
  assert.equal(zero.labels.score.name, MERGE_LABELS.scorePrefix + String(zero.score))
  assert.match(zero.labels.score.name, unpadded)
})

test('formatMergeConfidence prints the two label names on one labels: line', () => {
  const result = assessMergeConfidence(fixture('no-review'))
  const lines = formatMergeConfidence(result).split('\n').filter(line => line.startsWith('labels:'))
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes(result.labels.verdict.name) && lines[0].includes(result.labels.score.name), lines[0])
})

// --- the description block (design D15) ------------------------------------------------

const HEAD_GIVEN = { sha: 'abcdef0123456789abcdef0123456789abcdef01' }
const BASE_GIVEN = { ref: 'origin/trunk', sha: '0123456789abcdef0123456789abcdef01234567' }
const blockOf = (result, given = {}) =>
  formatMergeConfidenceMarkdown(result, { head: HEAD_GIVEN, base: BASE_GIVEN, excluded: [], ...given })
const count = (text, needle) => text.split(needle).length - 1
const CODE_SPAN = /`[^`\n]*`/g
const withoutSpans = text => text.replace(CODE_SPAN, '')
const spansOf = text => (text.match(CODE_SPAN) || []).map(span => span.slice(1, -1))
const groupAt = (text, label) => text.search(new RegExp(`^\\*\\*${label}\\*\\*`, 'im'))

/** One person, two evidence, one flag, nothing to fix. */
function humanInput() {
  const input = fixture('verify-skipped-no-profile')
  input.ledger = fixture('ledger-needs-human').ledger
  input.run = null
  return input
}

test('the block starts with its heading and carries the verdict line, the commit, the base, the groups in order, the flags and the labels', () => {
  const result = assessMergeConfidence(humanInput())
  assert.equal(result.verdict, 'HUMAN')
  assert.deepEqual(result.driving.map(d => d.kind).sort(), ['evidence', 'evidence', 'person'])
  assert.equal(result.flags.length, 1)

  const text = blockOf(result)
  assert.ok(text.startsWith('## Merge confidence\n'))
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'))
  const verdictLine = text.split('\n').find(line => line.includes(result.verdict) && line.includes(`score ${result.score}`))
  assert.ok(verdictLine, 'no line carries both the verdict and the score')
  assert.ok(verdictLine.includes(`${result.range.floor}–${result.range.ceiling}`), verdictLine)
  assert.ok(text.includes(HEAD_GIVEN.sha))
  assert.ok(text.includes(BASE_GIVEN.ref) && text.includes(BASE_GIVEN.sha))

  // Only the groups that have entries, in the order fix, person, evidence.
  assert.equal(groupAt(text, 'needs a fix'), -1)
  const person = groupAt(text, 'needs a person')
  const evidence = groupAt(text, 'needs more evidence')
  assert.ok(person > -1 && evidence > person, `person at ${person}, evidence at ${evidence}`)
  const details = text.indexOf('<details>')
  for (const d of result.driving) {
    const at = text.indexOf(`\`${d.id}\``)
    assert.ok(at > -1 && at < details, `${d.id} is not listed above the table`)
    assert.ok(d.kind === 'person' ? at > person && at < evidence : at > evidence, `${d.id} is in the wrong group`)
  }

  for (const { id, flag } of result.flags) assert.ok(text.includes(flag) && text.includes(id))
  assert.ok(text.includes(result.labels.verdict.name))
  assert.ok(text.includes(result.labels.score.name))
  assert.doesNotMatch(text, /undefined|\[object Object\]/)
})

test('all three groups print in the order fix, person, evidence when each has an entry', () => {
  const input = humanInput()
  input.review = fixture('review-with-blocker').review
  const result = assessMergeConfidence(input)
  assert.equal(result.verdict, 'BLOCK')
  const text = blockOf(result)
  const fix = groupAt(text, 'needs a fix')
  const person = groupAt(text, 'needs a person')
  const evidence = groupAt(text, 'needs more evidence')
  assert.ok(fix > -1 && person > fix && evidence > person, `${fix}, ${person}, ${evidence}`)
})

test('a MERGE block has no group at all, and says nothing is driving', () => {
  const text = blockOf(assessMergeConfidence(fixture('all-observable-green')))
  for (const label of ['needs a fix', 'needs a person', 'needs more evidence']) assert.equal(groupAt(text, label), -1, label)
})

test('MERGE, HUMAN and BLOCK blocks each carry one identical legend line directly after the verdict line', () => {
  const human = humanInput()
  const blocked = humanInput()
  blocked.review = fixture('review-with-blocker').review
  const results = [
    assessMergeConfidence(fixture('all-observable-green')),
    assessMergeConfidence(human),
    assessMergeConfidence(blocked),
  ]
  assert.deepEqual(results.map(r => r.verdict), ['MERGE', 'HUMAN', 'BLOCK'])

  const legends = results.map(result => {
    const text = blockOf(result)
    assert.ok(text.startsWith('## Merge confidence\n'), result.verdict)
    const lines = text.split('\n')
    const at = lines.findIndex(line => line.includes(result.verdict) && line.includes(`score ${result.score}`))
    assert.ok(at > -1, `${result.verdict}: no verdict line`)
    const legend = lines[at + 1]
    for (const token of ['branch rules', 'approvals', 'code owners', 'draft', 'review threads', 'merge queue']) {
      assert.ok(legend.includes(token), `${result.verdict}: legend line lacks "${token}": ${legend}`)
    }
    return legend
  })
  assert.equal(legends[1], legends[0])
  assert.equal(legends[2], legends[0])
})

test('the signal table sits in exactly one collapsed section, one row per registered signal, in registry order', () => {
  const result = assessMergeConfidence(humanInput())
  const text = blockOf(result)
  assert.equal(count(text, '<details>'), 1)
  assert.equal(count(text, '</details>'), 1)
  assert.ok(text.indexOf('<details>') < text.indexOf('</details>'))
  const table = text.slice(text.indexOf('<details>'), text.indexOf('</details>'))
  let last = -1
  for (const id of SPEC_ORDER) {
    const rows = table.split('\n').filter(line => line.startsWith(`| \`${id}\` |`))
    assert.equal(rows.length, 1, `${id} has ${rows.length} table row(s)`)
    const at = table.indexOf(rows[0])
    assert.ok(at > last, `${id} is out of registry order`)
    last = at
  }
  const rows = table.split('\n').filter(line => line.startsWith('| `'))
  assert.equal(rows.length, SIGNALS.length)
  // The informational signal is in the table and is not given a band.
  const fidelity = rows.find(line => line.startsWith('| `plan.fidelity` |'))
  assert.doesNotMatch(fidelity.split('|')[2], /green|amber|red|unobserved/)
})

test('a pipe in a reason never breaks a table row', () => {
  const result = assessMergeConfidence(fixture('review-malformed'))
  assert.ok(result.signals.some(s => s.reason.includes('|')), 'precondition: a reason carries a pipe')
  const text = blockOf(result)
  const table = text.slice(text.indexOf('<details>'), text.indexOf('</details>')).split('\n').filter(line => line.startsWith('|'))
  const cells = line => line.replace(/\\\|/g, '').split('|').length
  assert.ok(table.length > SIGNALS.length, 'a header, a rule and a row per signal')
  for (const line of table) assert.equal(cells(line), cells(table[0]), line)
})

test('the excluded checks are printed only when there are any', () => {
  const result = assessMergeConfidence(fixture('pipeline-excluded'))
  const none = blockOf(result)
  const some = blockOf(result, { excluded: ['merge-gate', 'label-gate'] })
  assert.doesNotMatch(none.slice(0, none.indexOf('<details>')), /excluded/i)
  const line = some.split('\n').find(l => /excluded/i.test(l) && l.includes('`merge-gate`'))
  assert.ok(line && line.includes('`label-gate`'), some)
  assert.ok(some.indexOf(line) < some.indexOf('<details>'))
})

test('a name that tries to be markup stays text: inside a code span, its backtick replaced, the section still closed once', () => {
  const hostile = 'x`@user [l](http://e) </details>'
  const input = fixture('pipeline-optional-fail')
  const failed = input.pipeline.checks.find(c => c.state === 'fail')
  failed.name = hostile
  const result = assessMergeConfidence(input)
  assert.ok(signalOf(result, 'ci.pipeline').reason.includes(hostile), 'precondition: the reason quotes the name')

  const text = blockOf(result, { excluded: [hostile] })
  const inert = hostile.replace(/`/g, "'")
  assert.ok(!text.includes(hostile), 'the raw name, backtick included, is in the block')
  assert.ok(spansOf(text).some(span => span.includes(inert)), 'no code span holds the name')
  const bare = withoutSpans(text)
  assert.ok(!bare.includes('@user') && !bare.includes('](http') && !bare.includes("x'"), bare)
  assert.equal(count(bare, '<details>'), 1)
  assert.equal(count(bare, '</details>'), 1)
})

test('a line break in a quoted string is folded, so one reason is one line', () => {
  const input = fixture('ledger-needs-human')
  const row = input.ledger.rows.find(r => r.class === 'needs_human')
  row.question = 'first line\n\n## A heading\n- [ ] a task'
  const text = blockOf(assessMergeConfidence(input))
  assert.doesNotMatch(text, /^## A heading/m)
  assert.doesNotMatch(text, /^- \[ \] a task/m)
  assert.equal(text.split('\n').filter(line => /^#{1,6} /.test(line)).length, 1, 'the block holds one heading, its own')
})

test('a very long name is cut: the span holding it is shorter than the name and ends with an ellipsis', () => {
  const long = 'k'.repeat(1000)
  const input = fixture('pipeline-optional-fail')
  input.pipeline.checks.find(c => c.state === 'fail').name = long
  const text = blockOf(assessMergeConfidence(input), { excluded: [long] })
  const holding = spansOf(text).filter(span => span.includes('k'.repeat(40)))
  assert.ok(holding.length >= 2, 'the name is quoted by a reason and by the excluded list')
  for (const span of holding) {
    assert.ok(span.length < long.length, `a span of ${span.length} characters`)
    assert.ok(span.endsWith('…'), span.slice(-12))
  }
  assert.ok(!text.includes(long))
})

test('an unreadable head and no base are said, not printed as null', () => {
  const result = assessMergeConfidence(fixture('no-base'))
  const text = formatMergeConfidenceMarkdown(result, { head: null, base: null, excluded: [] })
  assert.ok(text.startsWith('## Merge confidence\n'))
  assert.doesNotMatch(text, /\bnull\b|undefined/)
  // A base whose merge base could not be read still names the reference.
  const shallow = formatMergeConfidenceMarkdown(result, { head: HEAD_GIVEN, base: { ref: 'origin/trunk', sha: null }, excluded: [] })
  assert.ok(shallow.includes('origin/trunk'))
  assert.doesNotMatch(shallow, /\bnull\b|undefined/)
  // And the options are optional.
  assert.ok(formatMergeConfidenceMarkdown(result).startsWith('## Merge confidence\n'))
})

test('the block is a rendering: the same assessment and the same context give the same text, and nothing is mutated', () => {
  const result = assessMergeConfidence(humanInput())
  const before = JSON.stringify(result)
  assert.equal(blockOf(result), blockOf(result))
  assert.equal(JSON.stringify(result), before)
})

// --- the delivery documentation (design D17, D18) -------------------------------------
//
// Pinned by identifier, never by sentence: the page's tables must list exactly
// what the registry and the flag list publish, and each recipe must open with
// its three labelled lines.

const page = () => readFileSync(DELIVERY_PAGE, 'utf8')

/** The text under a `## ` heading, up to the next one. */
function sectionOf(text, heading) {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.trim() === heading)
  assert.ok(start > -1, `docs/15-merge-confidence.md has no "${heading}" heading`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^## /.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** The backticked first cell of every table row in a section. */
const firstCells = section =>
  section
    .split('\n')
    .map(line => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter(Boolean)
    .map(m => m[1])

function assertSameSet(listed, published, what) {
  const missing = published.filter(id => !listed.includes(id))
  const extra = listed.filter(id => !published.includes(id))
  assert.deepEqual(missing, [], `docs/15 has no ${what} row for: ${missing.join(', ')}`)
  assert.deepEqual(extra, [], `docs/15 has a ${what} row the code does not publish: ${extra.join(', ')}`)
  assert.equal(listed.length, published.length, `docs/15 lists a ${what} more than one time`)
}

test('docs/15 has one signal row per registered signal, and marks the informational one as not gating', () => {
  const section = sectionOf(page(), '## The signals')
  assertSameSet(firstCells(section), SIGNALS.map(s => s.id), 'signal')
  for (const entry of SIGNALS.filter(s => !s.gating)) {
    const row = section.split('\n').find(line => line.startsWith(`| \`${entry.id}\``))
    assert.match(row, /not gating/i, `${entry.id} is not marked as not gating`)
  }
})

test('docs/15 has one flag row per published flag', () => {
  assertSameSet(firstCells(sectionOf(page(), '## The flags')), [...FLAGS], 'flag')
})

test('docs/15 has its row for the blast-radius-skipped flag', () => {
  // The row above covers it once FLAGS publishes it; this names the one row
  // the eighth review dimension added, so its absence reads as itself.
  assert.ok(firstCells(sectionOf(page(), '## The flags')).includes('blast-radius-skipped'), 'no blast-radius-skipped row')
})

test('the table check itself names a signal registered without a row', () => {
  const section = sectionOf('## The signals\n\n| Signal | Reads |\n|---|---|\n| `review.blockers` | x |\n\n## Next\n', '## The signals')
  assert.deepEqual(firstCells(section), ['review.blockers'])
  assert.throws(() => assertSameSet(firstCells(section), ['review.blockers', 'review.warnings'], 'signal'), /review\.warnings/)
})

test('docs/15 names every label the command can print', () => {
  const text = page()
  for (const verdict of VERDICTS) {
    const { name } = MERGE_LABELS.verdicts[verdict]
    assert.ok(text.includes(name), `docs/15 does not name the ${verdict} label ${name}`)
  }
  assert.ok(text.includes(MERGE_LABELS.scorePrefix), `docs/15 does not name the score prefix ${MERGE_LABELS.scorePrefix}`)
})

test('docs/15 carries at least three recipes, each opening with who merges, what clears the labels and whether it was exercised', () => {
  const text = page()
  const recipes = text.split(/^(?=### Recipe:)/m).filter(part => part.startsWith('### Recipe:'))
  assert.ok(recipes.length >= 3, `docs/15 carries ${recipes.length} recipe(s)`)
  for (const recipe of recipes) {
    const title = recipe.split('\n')[0]
    const body = recipe.split(/^#{2,3} /m)[1] ?? recipe
    for (const label of ['**Merges:**', '**Clears labels:**', '**Exercised:**']) {
      assert.ok(body.includes(label), `${title} has no ${label} line`)
    }
  }
  assert.ok(text.includes('--gate-check'), 'docs/15 does not mention --gate-check')
  assert.ok(text.includes('--require-merge'))
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

// =============================================================================
// The command: a run's record carried to a descendant head, and records bound
// to a head (spec: review/merge-confidence — the run-file, descendant and
// head-bound record requirements; design D3, D8)
//
// Only the command can apply these rules: it reads git, and the module never
// does. So these drive the built CLI in temporary git repositories.
// =============================================================================

const CLI = join(ROOT, 'bin', 'interlock')
const CLI_CHANGE = 'add-widget-catalogue'
const CLI_SOURCE = 'src/widgets/catalogue.ts'
const CLI_SCENARIOS = 5
const CLI_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

let scratch
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'interlock-merge-confidence-'))
})
after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

/** Run the real binary. Never throws on a non-zero exit: that is the assertion. */
function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: scratch, encoding: 'utf8' })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function scratchFile(name, contents) {
  const path = join(scratch, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return path
}

function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...CLI_GIT_IDENTITY } })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

function commit(root, files, message) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
  return git(root, 'rev-parse', 'HEAD')
}

/** The one change's files: a ledger with no open row, and delta specs whose scenarios name the source. */
function cliChangeFiles() {
  const scenarios = Array.from(
    { length: CLI_SCENARIOS },
    (_, i) => `#### Scenario: case ${i + 1}\n\n- **GIVEN** a catalogue\n- **WHEN** it renders\n- **THEN** it lists case ${i + 1}\n`
  ).join('\n')
  const base = `openspec/changes/${CLI_CHANGE}`
  return {
    [`${base}/proposal.md`]: '## Why\n\nList the widgets a shop sells in one catalogue view.\n',
    [`${base}/design.md`]: '## Decisions\n\nD1. The catalogue reads the existing widget store.\n',
    [`${base}/tasks.md`]: '- [ ] 1.1 Render the catalogue\n',
    [`${base}/decisions.md`]: [
      `# Decisions — ${CLI_CHANGE}`,
      '',
      '| id | question | class | resolution | evidence |',
      '|----|----|----|----|----|',
      '| D1 | Read the existing store or add one? | agent_resolved | read the existing store | design.md:3 |',
      ''
    ].join('\n'),
    [`${base}/specs/widgets/catalogue/spec.md`]:
      `## ADDED Requirements\n\n### Requirement: The catalogue lists widgets\n\n` +
      `The catalogue SHALL list every widget, rendered by \`${CLI_SOURCE}\`.\n\n${scenarios}`
  }
}

/**
 * A base commit on `target`; on `feature`, the run's commit (it adds the
 * source) and one fix commit on top of it. No REVIEW.md, so no changed path is
 * on an always-human list.
 */
function carryRepo(sub) {
  const root = join(scratch, sub)
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q', '-b', 'target')
  const base = commit(root, cliChangeFiles(), 'base')
  git(root, 'checkout', '-q', '-b', 'feature')
  const runSha = commit(root, { [CLI_SOURCE]: 'export const catalogue = () => []\n' }, 'the run’s commit')
  const head = commit(root, { [CLI_SOURCE]: 'export const catalogue = () => [] // answers the review\n' }, 'fix(review): round 1')
  return { root, base, runSha, head }
}

/** What a clean, reviewed run's close wrote for a run from `base` to `headSha`. */
function cliRunEvidence({ base, headSha }) {
  const green = fixture('all-observable-green')
  return {
    schema: 'interlock.merge-evidence/1',
    change: CLI_CHANGE,
    runId: 'run-fixture-1',
    base,
    headSha,
    committed: true,
    evidence: {
      review: green.review,
      verify: green.verify,
      handoff: { scenariosChecked: CLI_SCENARIOS, scenariosUnconfirmed: 0 },
      coverage: green.coverage,
      run: {
        halted: false,
        trajectoryComplete: true,
        stageMarkerGaps: 0,
        rejectedReports: 0,
        permissionPrompts: 0,
        autoModeDenials: 0,
        leftoverTasks: 0
      }
    },
    result: null
  }
}

/** A final verdict whose coverage step was skipped because the profile configures none. */
function verdictSkippingCoverage() {
  const { verify } = fixture('all-observable-green')
  return { ...verify, coverage: null, skipped: [...verify.skipped, { kind: 'coverage', reason: 'coverage-not-configured' }] }
}

/**
 * The review, verification and handoff records as files, each carrying `head`
 * when one is given and no `head` key at all otherwise.
 */
function records(tag, head, { verify = verdictSkippingCoverage() } = {}) {
  const bind = record => (head === undefined ? record : { ...record, head })
  return {
    review: scratchFile(`${tag}-review.json`, bind(fixture('all-observable-green').review)),
    verify: scratchFile(`${tag}-verify.json`, bind(verify)),
    handoff: scratchFile(`${tag}-handoff.json`, bind({ scenariosChecked: CLI_SCENARIOS, scenariosUnconfirmed: 0 }))
  }
}

const recordArgs = files => ['--review', files.review, '--verify', files.verify, '--handoff', files.handoff]

const passingPipelineFor = (tag, sha) =>
  scratchFile(`${tag}-pipeline.json`, {
    sha,
    checks: [
      { name: 'unit', state: 'pass', required: true },
      { name: 'lint', state: 'pass', required: false }
    ],
    excluded: []
  })

const assessAt = (repo, ...extra) => ['merge-confidence', CLI_CHANGE, '--root', repo.root, ...extra, '--json']

function assessed(repo, ...extra) {
  const r = cli(assessAt(repo, ...extra))
  assert.ok(r.code === 0 || r.code === 1, `exit ${r.code}: ${r.stderr}`)
  let out
  assert.doesNotThrow(() => {
    out = JSON.parse(r.stdout)
  }, `no verdict on stdout: ${r.stdout}\n${r.stderr}`)
  return { ...r, out }
}

const stderrLines = r => r.stderr.split('\n').filter(Boolean)
const runLine = r => stderrLines(r).filter(line => line.includes('--run'))
const short = sha => sha.slice(0, 7)
const drivingOf = out => JSON.stringify(out.driving.map(d => [d.id, d.band, d.reason]), null, 2)

// --- a run's record carried to a descendant head --------------------------------------

const DROPPED_KEYS = ['review', 'verify', 'handoff', 'coverage']

/** The one carried-from line, and one dropped line per tree-bound key, each naming the run's commit. */
function assertCarried(r, runSha) {
  const carried = stderrLines(r).filter(line => line.includes('carried from'))
  assert.equal(carried.length, 1, `one carried-from line expected:\n${r.stderr}`)
  assert.ok(carried[0].includes(short(runSha)), `the carried-from line does not name the run's commit: ${carried[0]}`)
  const dropped = stderrLines(r).filter(line => line.includes(short(runSha)) && !line.includes('carried from'))
  assert.equal(dropped.length, DROPPED_KEYS.length, `one line per dropped entry expected:\n${r.stderr}`)
  for (const key of DROPPED_KEYS) {
    assert.ok(
      dropped.some(line => new RegExp(`\\b${key}\\b`).test(line)),
      `no dropped-entry line names ${key}:\n${dropped.join('\n')}`
    )
  }
  assert.doesNotMatch(r.stderr, /is not used/, 'a carried file is not refused')
}

test('one fix commit on top of the run’s: the run record is carried, four entries are dropped out loud, and the verdict is MERGE', () => {
  const repo = carryRepo('carry-one-fix')
  const evidence = scratchFile('carry-one-fix-evidence.json', cliRunEvidence({ base: repo.base, headSha: repo.runSha }))
  const inputs = ['--base', 'target', '--pipeline', passingPipelineFor('carry-one-fix', repo.head), ...recordArgs(records('carry-one-fix', repo.head))]

  const r = assessed(repo, ...inputs, '--run', evidence)
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.out.verdict, 'MERGE', drivingOf(r.out))
  assert.equal(signalOf(r.out, 'run.integrity').band, 'green', signalOf(r.out, 'run.integrity').reason)
  assert.equal(signalOf(r.out, 'verify.coverage').band, 'green', 'the verdict’s coverage skip greens the signal')
  assert.deepEqual(signalOf(r.out, 'verify.coverage').flags, ['no-coverage'])
  assertCarried(r, repo.runSha)

  // The run record came from the file: without it, run integrity has nothing to read.
  const bare = assessed(repo, ...inputs)
  assert.equal(signalOf(bare.out, 'run.integrity').band, 'unobserved', signalOf(bare.out, 'run.integrity').reason)
  assert.notEqual(bare.out.verdict, 'MERGE')
})

test('the same branch with coverage figures for the head in place of the skip also reads MERGE', () => {
  const repo = carryRepo('carry-coverage')
  const evidence = scratchFile('carry-coverage-evidence.json', cliRunEvidence({ base: repo.base, headSha: repo.runSha }))
  const files = records('carry-coverage', repo.head, { verify: fixture('all-observable-green').verify })
  const coverage = scratchFile('carry-coverage-coverage.json', fixture('all-observable-green').coverage)

  const r = assessed(
    repo,
    '--base', 'target',
    '--pipeline', passingPipelineFor('carry-coverage', repo.head),
    ...recordArgs(files),
    '--coverage', coverage,
    '--run', evidence
  )
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.out.verdict, 'MERGE', drivingOf(r.out))
  assert.equal(signalOf(r.out, 'run.integrity').band, 'green')
  assertCarried(r, repo.runSha)
})

test('the same branch with no --base takes nothing from the file and says the ancestry cannot be judged without a base', () => {
  const repo = carryRepo('carry-no-base')
  const evidence = scratchFile('carry-no-base-evidence.json', cliRunEvidence({ base: repo.base, headSha: repo.runSha }))
  const r = assessed(repo, '--pipeline', passingPipelineFor('carry-no-base', repo.head), ...recordArgs(records('carry-no-base', repo.head)), '--run', evidence)
  assert.equal(r.code, 0, r.stderr)
  const [line, ...more] = runLine(r)
  assert.ok(line, `nothing said about --run:\n${r.stderr}`)
  assert.equal(more.length, 0, r.stderr)
  assert.match(line, /is not used/)
  assert.match(line, /\bbase\b/, line)
  assert.match(line, /ancest|descend/i, line)
  assert.doesNotMatch(r.stderr, /carried from/)
  assert.equal(signalOf(r.out, 'run.integrity').band, 'unobserved', signalOf(r.out, 'run.integrity').reason)
  assert.notEqual(r.out.verdict, 'MERGE')
})

test('a branch whose merge base moved away from the run’s base takes nothing from the file and names both bases', () => {
  const repo = carryRepo('carry-moved-base')
  git(repo.root, 'checkout', '-q', 'target')
  const moved = commit(repo.root, { 'docs/elsewhere.md': 'someone else merged this\n' }, 'an unrelated merge')
  git(repo.root, 'checkout', '-q', 'feature')
  // Bringing the moved target into the branch keeps the run's commit an
  // ancestor of the head and moves the merge base to the target's new tip. (A
  // rebase that rewrites the run's commit is the sibling case below.)
  git(repo.root, 'merge', '-q', '--no-edit', 'target')
  const head = git(repo.root, 'rev-parse', 'HEAD')
  assert.equal(git(repo.root, 'merge-base', 'target', 'HEAD'), moved, 'precondition: the merge base moved')

  const evidence = scratchFile('carry-moved-base-evidence.json', cliRunEvidence({ base: repo.base, headSha: repo.runSha }))
  const r = assessed(repo, '--base', 'target', '--pipeline', passingPipelineFor('carry-moved-base', head), ...recordArgs(records('carry-moved-base', head)), '--run', evidence)
  assert.equal(r.code, 0, r.stderr)
  const [line] = runLine(r)
  assert.ok(line, `nothing said about --run:\n${r.stderr}`)
  assert.match(line, /is not used/)
  assert.ok(line.includes(short(repo.base)), `the run's base is not named: ${line}`)
  assert.ok(line.includes(short(moved)), `the merge base is not named: ${line}`)
  assert.doesNotMatch(r.stderr, /carried from/)
  assert.equal(signalOf(r.out, 'run.integrity').band, 'unobserved')
  assert.notEqual(r.out.verdict, 'MERGE')
})

test('a sibling commit, neither the head nor an ancestor of it, is refused whole as another commit', () => {
  const repo = carryRepo('carry-sibling')
  git(repo.root, 'checkout', '-q', '-b', 'side', repo.base)
  const sibling = commit(repo.root, { [CLI_SOURCE]: 'export const catalogue = () => [\'side\']\n' }, 'a sibling of the run’s commit')
  git(repo.root, 'checkout', '-q', 'feature')

  const evidence = scratchFile('carry-sibling-evidence.json', cliRunEvidence({ base: repo.base, headSha: sibling }))
  const r = assessed(repo, '--base', 'target', '--pipeline', passingPipelineFor('carry-sibling', repo.head), ...recordArgs(records('carry-sibling', repo.head)), '--run', evidence)
  assert.equal(r.code, 0, r.stderr)
  const [line] = runLine(r)
  assert.ok(line, `nothing said about --run:\n${r.stderr}`)
  assert.match(line, /is not used/)
  assert.match(line, /another commit/)
  assert.ok(line.includes(short(sibling)) && line.includes(short(repo.head)), line)
  assert.doesNotMatch(r.stderr, /carried from/)
  assert.doesNotMatch(r.stderr, /could not\b.*decid/i)
  for (const id of ['run.integrity']) assert.equal(signalOf(r.out, id).band, 'unobserved', signalOf(r.out, id).reason)
  assert.notEqual(r.out.verdict, 'MERGE')
})

test('a recorded commit the repository does not hold is refused as undecided, with git’s failure, and never as another commit', () => {
  const repo = carryRepo('carry-undecided')
  const missing = 'deadbeef'.repeat(5)
  const evidence = scratchFile('carry-undecided-evidence.json', cliRunEvidence({ base: repo.base, headSha: missing }))
  const r = assessed(repo, '--base', 'target', '--pipeline', passingPipelineFor('carry-undecided', repo.head), ...recordArgs(records('carry-undecided', repo.head)), '--run', evidence)
  assert.equal(r.code, 0, r.stderr)
  const line = runLine(r).find(l => /is not used/.test(l))
  assert.ok(line, `the file is not refused:\n${r.stderr}`)
  assert.match(line, /could not\b.*decid/i, line)
  assert.ok(line.includes(short(missing)), `the recorded commit is not named: ${line}`)
  assert.match(r.stderr, /fatal:|not a valid/i, `git's own failure is not on stderr:\n${r.stderr}`)
  assert.doesNotMatch(r.stderr, /another commit/, 'an undecided ancestry is not another commit')
  assert.doesNotMatch(r.stderr, /carried from/)
  assert.equal(signalOf(r.out, 'run.integrity').band, 'unobserved')
  assert.notEqual(r.out.verdict, 'MERGE')
})

// --- review, verification and handoff records bound to a head --------------------------

const BOUND_INPUTS = ['review', 'verify', 'handoff']
// The signals each record feeds, read as the command reads them with no such record.
const BOUND_SIGNALS = ['review.blockers', 'review.warnings', 'review.ran', 'review.adversarial', 'verify.suite', 'verify.e2e', 'conformance.delta', 'conformance.living']

test('a --review, --verify and --handoff record each bound to the head are read, and nothing about a head is said', () => {
  const repo = carryRepo('bound-head')
  const pipeline = passingPipelineFor('bound-head', repo.head)
  const bound = assessed(repo, '--base', 'target', '--pipeline', pipeline, ...recordArgs(records('bound-head', repo.head)))
  assert.equal(signalOf(bound.out, 'review.ran').band, 'green', signalOf(bound.out, 'review.ran').reason)
  assert.equal(signalOf(bound.out, 'verify.suite').band, 'green', signalOf(bound.out, 'verify.suite').reason)
  assert.equal(signalOf(bound.out, 'conformance.delta').band, 'green', signalOf(bound.out, 'conformance.delta').reason)
  assert.doesNotMatch(bound.stderr, /another commit/, bound.stderr)

  // A record with no head is read as it was before the key existed, and alike.
  const unbound = assessed(repo, '--base', 'target', '--pipeline', pipeline, ...recordArgs(records('bound-none', undefined)))
  assert.doesNotMatch(unbound.stderr, /another commit/, unbound.stderr)
  for (const id of BOUND_SIGNALS) {
    assert.equal(signalOf(bound.out, id).band, signalOf(unbound.out, id).band, id)
    assert.equal(signalOf(bound.out, id).reason, signalOf(unbound.out, id).reason, id)
  }
  assert.equal(bound.out.verdict, unbound.out.verdict)
  assert.equal(bound.out.score, unbound.out.score)
})

test('the same three records bound to the head’s parent are each refused by name, and read as with no record', () => {
  const repo = carryRepo('bound-parent')
  const parent = git(repo.root, 'rev-parse', 'HEAD^')
  assert.equal(parent, repo.runSha, 'precondition')
  const pipeline = passingPipelineFor('bound-parent', repo.head)

  const stale = assessed(repo, '--base', 'target', '--pipeline', pipeline, ...recordArgs(records('bound-parent', parent)))
  const refusals = stderrLines(stale).filter(line => /describes another commit/.test(line))
  assert.equal(refusals.length, BOUND_INPUTS.length, `one refusal per record expected:\n${stale.stderr}`)
  for (const name of BOUND_INPUTS) {
    const line = refusals.find(l => new RegExp(`\\b${name}\\b`).test(l))
    assert.ok(line, `no refusal names ${name}:\n${refusals.join('\n')}`)
    assert.ok(line.includes(short(parent)) && line.includes(short(repo.head)), `${name}: both commits are not named: ${line}`)
  }

  assert.equal(signalOf(stale.out, 'review.ran').band, 'amber')
  assert.match(signalOf(stale.out, 'review.ran').reason, /no review ran/i)
  assert.equal(signalOf(stale.out, 'verify.suite').band, 'unobserved', signalOf(stale.out, 'verify.suite').reason)
  assert.equal(signalOf(stale.out, 'conformance.delta').band, 'unobserved', signalOf(stale.out, 'conformance.delta').reason)
  assert.notEqual(stale.out.verdict, 'MERGE')

  // As with no such inputs at all.
  const none = assessed(repo, '--base', 'target', '--pipeline', pipeline)
  for (const id of BOUND_SIGNALS) assert.equal(signalOf(stale.out, id).band, signalOf(none.out, id).band, id)
})

test('verify judge --head records the head on the verdict, and without it the verdict carries no head', () => {
  const profile = scratchFile('judge-head-profile.json', {
    version: 1,
    unit: { command: 'npm test', timeout_ms: 120000 },
    coverage: { enabled: false },
    e2e: { enabled: false }
  })
  const results = scratchFile('judge-head-results.json', [
    { kind: 'typecheck', exitCode: 0 },
    { kind: 'unit', exitCode: 0, total: 10, passed: 10, failed: 0 }
  ])
  const planned = cli(['verify', 'plan', '--profile', profile, '--typecheck-command', 'npx tsc --noEmit', '--json'])
  assert.equal(planned.code, 0, planned.stderr)
  const plan = scratchFile('judge-head-plan.json', planned.stdout)
  const head = 'c0ffee'.padEnd(40, '0')

  const judged = cli(['verify', 'judge', '--plan', plan, '--results', results, '--head', head, '--json'])
  assert.equal(judged.code, 0, judged.stderr)
  assert.equal(JSON.parse(judged.stdout).head, head)

  const plain = cli(['verify', 'judge', '--plan', plan, '--results', results, '--json'])
  assert.equal(plain.code, 0, plain.stderr)
  assert.equal(Object.hasOwn(JSON.parse(plain.stdout), 'head'), false)
})
