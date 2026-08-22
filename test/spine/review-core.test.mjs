import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveReview, formatReview } from '../../lib/review-core.mjs'
import { TOLERANCE_BAND } from '../../lib/findings.mjs'

const f = (over = {}) => ({
  severity: 'warning',
  file: 'lib/a.ts',
  title: 'something',
  description: 'because',
  ...over
})

// Quality 4 by default so the tolerance band keeps the finding and survival
// rules are what the assertion is actually measuring.
//
// `evidence` is present by default for the same reason: a not-real verdict only
// dismisses when it cites what it read, and these tests are about the survival
// rules, not about that gate. The uncited case has its own section below.
const v = (over = {}) => ({
  findingTitle: 'something',
  isReal: true,
  confidence: 0.9,
  reasoning: 'checked it',
  evidence: 'lib/a.ts:41-58',
  refinedSeverity: 'warning',
  qualityScore: 4,
  severityScore: 3,
  ...over
})

// --- majority survival ----------------------------------------------------

test('a finding both skeptics call real survives', () => {
  const r = resolveReview([f()], [v(), v()])
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.surviving[0].title, 'something')
})

test('a finding both skeptics refute is dismissed', () => {
  const r = resolveReview([f()], [v({ isReal: false }), v({ isReal: false })])
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.counts.surviving, 0)
  assert.equal(r.dismissed[0].title, 'something')
})

test('a 1-1 split keeps the finding — a dismissal is invisible to the human', () => {
  const r = resolveReview([f()], [v({ isReal: true }), v({ isReal: false })])
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissed, 0)
})

test('a genuine majority against still dismisses', () => {
  const r = resolveReview([f()], [v(), v({ isReal: false }), v({ isReal: false })])
  assert.equal(r.counts.dismissed, 1)
})

test('vote tallies are attached to the resolved finding', () => {
  const r = resolveReview([f()], [v(), v({ isReal: false })])
  assert.deepEqual(r.surviving[0].votes, { real: 1, notReal: 1, uncited: 0, total: 2 })
})

test('a finding nobody adjudicated survives — absence of a verdict is not dismissal', () => {
  const r = resolveReview([f({ title: 'unjudged' })], [])
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissed, 0)
  assert.deepEqual(r.surviving[0].votes, { real: 0, notReal: 0, uncited: 0, total: 0 })
})

// --- evidence gates the dismissing direction only --------------------------

test('an uncited refutation does not dismiss', () => {
  // The Refute-or-Promote failure mode: a confident skeptic talking the panel
  // out of a real finding. Prose is what an LLM produces most reliably, so it
  // is the one thing a dismissal must not rest on.
  const r = resolveReview([f()], [
    v({ isReal: false, evidence: undefined }),
    v({ isReal: false, evidence: undefined })
  ])
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissalsRejected, 2)
})

test('a cited refutation still dismisses', () => {
  const r = resolveReview([f()], [
    v({ isReal: false, evidence: 'lib/a.ts:10-20' }),
    v({ isReal: false, evidence: 'lib/a.ts:10-20' })
  ])
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.counts.dismissalsRejected, 0)
})

test('whitespace is not evidence', () => {
  const r = resolveReview([f()], [
    v({ isReal: false, evidence: '   ' }),
    v({ isReal: false, evidence: '' })
  ])
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.counts.dismissalsRejected, 2)
})

test('voting a finding real needs no evidence', () => {
  // Only the dismissing direction is gated. Keeping a finding already resolves
  // toward a human reading it, which is the cheap error.
  const r = resolveReview([f()], [
    v({ isReal: true, evidence: undefined }),
    v({ isReal: true, evidence: undefined })
  ])
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissalsRejected, 0)
})

test('an uncited refutation is a non-vote, not a deleted verdict', () => {
  // Its quality score must still reach the band: a skeptic can be too lazy to
  // cite and still be right that the finding is badly written.
  const r = resolveReview([f()], [
    v({ qualityScore: 1 }),
    v({ isReal: false, evidence: undefined, qualityScore: 1 })
  ])
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.counts.droppedByQuality, 1, 'the uncited verdict still fed the band')
})

test('an uncited refutation is tallied separately from a real vote', () => {
  const r = resolveReview([f()], [v(), v({ isReal: false, evidence: undefined })])
  assert.deepEqual(r.surviving[0].votes, { real: 1, notReal: 0, uncited: 1, total: 2 })
})

test('the report says when a refutation was refused', () => {
  // Silently downgrading a dismissal to a non-vote looks identical to a skeptic
  // that simply agreed. The reader has to be able to see the rule fire.
  const r = resolveReview([f()], [
    v({ isReal: false, evidence: undefined }),
    v({ isReal: false, evidence: undefined })
  ])
  assert.match(formatReview(r), /2 refutation\(s\) cited no evidence/)
})

// --- dismiss as a vote, not a severity ------------------------------------

test('refinedSeverity dismiss counts as a not-real vote', () => {
  const r = resolveReview([f()], [v({ refinedSeverity: 'dismiss' }), v({ isReal: false })])
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.dismissed[0].votes.notReal, 2)
})

test('one dismiss against one real is a tie, so the finding is kept', () => {
  const r = resolveReview([f()], [v({ refinedSeverity: 'dismiss' }), v()])
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.surviving[0].severity, 'warning')
})

test('a dismiss refinement never becomes the severity', () => {
  const r = resolveReview([f({ severity: 'blocker' })], [v({ isReal: true, refinedSeverity: 'dismiss' }), v({ refinedSeverity: 'blocker' })])
  assert.equal(r.surviving[0].severity, 'blocker')
  assert.equal(r.surviving[0].originalSeverity, undefined)
})

// --- severity refinement --------------------------------------------------

test('conflicting refinements resolve to the more severe one', () => {
  const r = resolveReview(
    [f({ severity: 'suggestion' })],
    [v({ refinedSeverity: 'warning' }), v({ refinedSeverity: 'blocker' })]
  )
  assert.equal(r.surviving[0].severity, 'blocker')
  assert.equal(r.surviving[0].originalSeverity, 'suggestion')
})

test('a refinement may lower severity as well as raise it', () => {
  const r = resolveReview(
    [f({ severity: 'blocker' })],
    [v({ refinedSeverity: 'warning' }), v({ refinedSeverity: 'warning' })]
  )
  assert.equal(r.surviving[0].severity, 'warning')
  assert.equal(r.surviving[0].originalSeverity, 'blocker')
})

test('only skeptics who thought it real get a say in severity', () => {
  const r = resolveReview(
    [f({ severity: 'suggestion' })],
    [v({ refinedSeverity: 'suggestion' }), v({ isReal: false, refinedSeverity: 'blocker' })]
  )
  assert.equal(r.surviving[0].severity, 'suggestion')
  assert.equal(r.surviving[0].originalSeverity, undefined)
})

test('an unrecognised refinement leaves the reviewer severity standing', () => {
  const r = resolveReview([f({ severity: 'warning' })], [v({ refinedSeverity: 'nit' }), v({ refinedSeverity: 'nit' })])
  assert.equal(r.surviving[0].severity, 'warning')
})

// --- quality band ---------------------------------------------------------

test('a surviving-but-weak finding is dropped by the band, not dismissed', () => {
  const r = resolveReview([f()], [v({ qualityScore: 1 }), v({ qualityScore: 2 })])
  assert.equal(r.counts.surviving, 0)
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.counts.droppedByQuality, 1)
  assert.equal(r.droppedByQuality[0].title, 'something')
})

test('quality drops and skeptic dismissals are counted separately', () => {
  const r = resolveReview(
    [f({ title: 'ghost' }), f({ title: 'thin' }), f({ title: 'real' })],
    [
      v({ findingTitle: 'ghost', isReal: false }),
      v({ findingTitle: 'ghost', isReal: false }),
      v({ findingTitle: 'thin', qualityScore: 1 }),
      v({ findingTitle: 'thin', qualityScore: 1 }),
      v({ findingTitle: 'real', qualityScore: 5 }),
      v({ findingTitle: 'real', qualityScore: 5 })
    ]
  )
  assert.deepEqual(r.counts, {
    raised: 3,
    dismissed: 1,
    droppedByQuality: 1,
    surviving: 1,
    dismissalsRejected: 0
  })
  assert.equal(r.surviving[0].title, 'real')
})

test('skeptic quality scores are pooled onto the finding for the band', () => {
  const r = resolveReview([f()], [v({ qualityScore: 5 }), v({ qualityScore: 4 })])
  assert.deepEqual(r.surviving[0].qualityScores, [5, 4])
})

test('a not-real skeptic still contributes a quality score', () => {
  // 1-1 split keeps the finding; both scores are weak, so the band drops it.
  const r = resolveReview([f()], [v({ qualityScore: 2 }), v({ isReal: false, qualityScore: 2 })])
  assert.equal(r.counts.droppedByQuality, 1)
})

test('a custom band moves the floor and band:null disables it', () => {
  const findings = [f()]
  const verdicts = [v({ qualityScore: 4 }), v({ qualityScore: 4 })]
  assert.equal(resolveReview(findings, verdicts).counts.surviving, 1)
  assert.equal(
    resolveReview(findings, verdicts, { band: { ...TOLERANCE_BAND, minQualityToReport: 5 } })
      .counts.surviving,
    0
  )
  const weak = [v({ qualityScore: 0 }), v({ qualityScore: 0 })]
  assert.equal(resolveReview(findings, weak, { band: null }).counts.surviving, 1)
})

// --- anomalies ------------------------------------------------------------

test('a verdict matching no finding is reported, not thrown', () => {
  const r = resolveReview([f({ title: 'real' })], [v({ findingTitle: 'imaginary' })])
  assert.equal(r.anomalies.orphanVerdicts.length, 1)
  assert.equal(r.anomalies.orphanVerdicts[0].findingTitle, 'imaginary')
  assert.equal(r.counts.raised, 1)
  assert.equal(r.counts.surviving, 1)
})

test('a verdict with no usable findingTitle is an anomaly rather than a crash', () => {
  const r = resolveReview([f()], [null, 'nope', { isReal: true }, v()])
  assert.equal(r.anomalies.malformedVerdicts.length, 3)
  assert.equal(r.counts.surviving, 1)
})

test('degenerate input yields an empty, non-throwing result', () => {
  for (const input of [null, undefined, {}, [], 'nope', 42]) {
    const r = resolveReview(input, null)
    assert.deepEqual(r.counts, {
      raised: 0,
      dismissed: 0,
      droppedByQuality: 0,
      surviving: 0,
      dismissalsRejected: 0
    })
    assert.deepEqual(r.dimensionStats, {})
  }
})

// --- accounting -----------------------------------------------------------

test('every raised finding lands in exactly one bucket', () => {
  const r = resolveReview(
    [f({ title: 'a' }), f({ title: 'b' }), f({ title: 'c' }), f({ title: 'd' })],
    [
      v({ findingTitle: 'b', isReal: false }),
      v({ findingTitle: 'b', isReal: false }),
      v({ findingTitle: 'c', qualityScore: 1 }),
      v({ findingTitle: 'c', qualityScore: 1 })
    ]
  )
  const { raised, dismissed, droppedByQuality, surviving } = r.counts
  assert.equal(dismissed + droppedByQuality + surviving, raised)
  assert.equal(r.surviving.length + r.dismissed.length + r.droppedByQuality.length, raised)
})

test('dimensionStats counts raised and surviving per dimension', () => {
  const r = resolveReview(
    [
      { dimension: 'qa', findings: [f({ title: 'q1' }), f({ title: 'q2' })] },
      { dimension: 'security', findings: [f({ title: 's1' })] }
    ],
    [v({ findingTitle: 'q2', isReal: false }), v({ findingTitle: 'q2', isReal: false })]
  )
  assert.deepEqual(r.dimensionStats, {
    qa: { raised: 2, surviving: 1 },
    security: { raised: 1, surviving: 1 }
  })
})

test('a finding with no dimension is accounted under unknown', () => {
  const r = resolveReview([f()], [])
  assert.deepEqual(r.dimensionStats, { unknown: { raised: 1, surviving: 1 } })
})

test('two findings sharing a title share one verdict set — VERDICT_SCHEMA carries no file', () => {
  const r = resolveReview(
    [f({ file: 'a.ts', title: 'dup' }), f({ file: 'b.ts', title: 'dup' })],
    [v({ findingTitle: 'dup', isReal: false }), v({ findingTitle: 'dup', isReal: false })]
  )
  assert.equal(r.counts.dismissed, 2)
})

test('the input findings are not mutated', () => {
  const input = [f({ severity: 'suggestion' })]
  resolveReview(input, [v({ refinedSeverity: 'blocker' }), v({ refinedSeverity: 'blocker' })])
  assert.equal(input[0].severity, 'suggestion')
  assert.equal(input[0].votes, undefined)
})

// --- formatting -----------------------------------------------------------

test('formatReview reports the four counts and the per-dimension split', () => {
  const r = resolveReview(
    { dimension: 'qa', findings: [f({ title: 'a' }), f({ title: 'b' })] },
    [v({ findingTitle: 'b', isReal: false }), v({ findingTitle: 'b', isReal: false })]
  )
  const out = formatReview(r)
  assert.match(out, /1 of 2 finding\(s\) survived/)
  assert.match(out, /raised=2 dismissed=1 droppedByQuality=0 surviving=1/)
  assert.match(out, /qa: 1\/2 surviving/)
})

test('formatReview names refinements and anomalies', () => {
  const r = resolveReview(
    [f({ severity: 'suggestion', title: 'grew' })],
    [
      v({ findingTitle: 'grew', refinedSeverity: 'blocker' }),
      v({ findingTitle: 'grew', refinedSeverity: 'warning' }),
      v({ findingTitle: 'phantom' })
    ]
  )
  const out = formatReview(r)
  assert.match(out, /refined suggestion → blocker: grew/)
  assert.match(out, /ANOMALY: 1 verdict\(s\) matched no finding: phantom/)
})

test('formatReview stays quiet about anomalies when there are none', () => {
  assert.doesNotMatch(formatReview(resolveReview([f()], [v(), v()])), /ANOMALY/)
})

// --- verdict keying: title, narrowed by file ------------------------------

test('a file-qualified verdict adjudicates only the finding in that file', () => {
  // Same title, two files. Before VERDICT_SCHEMA carried a file, one skeptic's
  // dismissal silently dismissed both.
  const r = resolveReview(
    [f({ file: 'lib/a.ts' }), f({ file: 'lib/b.ts' })],
    [
      v({ file: 'lib/a.ts', isReal: false }),
      v({ file: 'lib/a.ts', isReal: false })
    ]
  )
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.dismissed[0].file, 'lib/a.ts')
  assert.equal(r.surviving[0].file, 'lib/b.ts')
})

test('a fileless verdict still adjudicates every finding sharing the title', () => {
  // Skeptics predate the optional file, so the fallback must keep working —
  // an orphaned verdict would mean an unadjudicated finding survives unreviewed.
  const r = resolveReview(
    [f({ file: 'lib/a.ts' }), f({ file: 'lib/b.ts' })],
    [v({ isReal: false }), v({ isReal: false })]
  )
  assert.equal(r.counts.dismissed, 2)
  assert.equal(r.anomalies.orphanVerdicts.length, 0)
})

test('a file-qualified verdict takes precedence over a fileless one', () => {
  const r = resolveReview(
    [f({ file: 'lib/a.ts' })],
    [
      v({ isReal: false }),
      v({ isReal: false }),
      v({ file: 'lib/a.ts', isReal: true }),
      v({ file: 'lib/a.ts', isReal: true })
    ]
  )
  assert.equal(r.counts.surviving, 1)
})

test('a verdict naming a file nobody raised is an orphan, not a dismissal', () => {
  const r = resolveReview([f({ file: 'lib/a.ts' })], [v({ file: 'lib/nope.ts', isReal: false })])
  assert.equal(r.anomalies.orphanVerdicts.length, 1)
  assert.equal(r.counts.surviving, 1)
})

test('the key separator cannot be forged from a title and file', () => {
  // Keys are joined on NUL, so no title/file pair can collide with another.
  const r = resolveReview(
    [f({ title: 'a', file: 'b' }), f({ title: 'a b', file: 'c' })],
    [v({ findingTitle: 'a', file: 'b', isReal: false }), v({ findingTitle: 'a', file: 'b', isReal: false })]
  )
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.dismissed[0].title, 'a')
})

// --- the citation shape (spec: review/evidence-gate) -----------------------
//
// The rule README.md stakes its strongest claim on. Before this, `hasEvidence`
// was `trim().length > 0`, so the string "👍" dismissed a blocker — a review
// whose dismissals are unauditable is worse than no review, because the
// dismissal count is cited as if the dismissals were checked.
//
// The predicate is deliberately a *shape* check plus diff membership. A
// semantic check would relocate the judgement to another model, which is the
// problem one layer down.

const DIFF = ['lib/a.ts', 'src/my file.ts', 'lib/b.ts']
const blocker = () => f({ severity: 'blocker', title: 'real bug' })
const refute = (evidence) =>
  v({ findingTitle: 'real bug', file: 'lib/a.ts', isReal: false, refinedSeverity: 'dismiss', evidence })

const resolveAgainstDiff = (verdicts) =>
  resolveReview([blocker()], verdicts, { changedPaths: DIFF })

const UNCITED = [
  ['a single emoji', '👍'],
  ['a single word', 'ok'],
  ['a single letter', 'x'],
  ['a bare filename with no line', 'lib/a.ts'],
  ['confident prose', 'I read the whole module carefully and this is simply not a real problem.']
]

for (const [name, evidence] of UNCITED) {
  test(`${name} does not dismiss a blocker — it is a non-vote`, () => {
    const r = resolveAgainstDiff([refute(evidence)])
    assert.equal(r.counts.dismissed, 0, `"${evidence}" must not dismiss anything`)
    assert.equal(r.counts.surviving, 1, 'the finding survives to the report')
    assert.equal(r.counts.dismissalsRejected, 1, 'the refusal must be reported, never silent')
    // Recorded, not deleted: the verdict's quality score still reaches the band.
    assert.deepEqual(r.surviving[0].votes, { real: 0, notReal: 0, uncited: 1, total: 1 })
    assert.ok(
      (r.surviving[0].qualityScores || []).includes(4),
      'an uncited skeptic can still be right that the finding is badly written'
    )
  })
}

const CITED = [
  ['a path and a line', 'lib/a.ts:41'],
  ['a path and a line range', 'lib/a.ts:41-58'],
  ['a column suffix after the line', 'lib/a.ts:41:9'],
  ['a path containing spaces', 'src/my file.ts:12'],
  ['the same path with a leading ./', './lib/a.ts:41'],
  ['a citation inside a sentence', 'I opened lib/a.ts:41-58 and the guard is already there.']
]

for (const [name, evidence] of CITED) {
  test(`${name} is accepted as a citation`, () => {
    const r = resolveAgainstDiff([refute(evidence), refute(evidence)])
    assert.equal(r.counts.dismissed, 1, `"${evidence}" should have dismissed the finding`)
    assert.equal(r.counts.dismissalsRejected, 0)
  })
}

test('a shape-valid citation naming a path absent from the diff is rejected', () => {
  // Shape alone is defeated by inventing `lib/nowhere.ts:1`. Diff membership is
  // the cheap half that makes the citation refer to the work under review.
  const r = resolveAgainstDiff([refute('lib/nowhere.ts:1'), refute('lib/nowhere.ts:1')])
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissalsRejected, 2)
})

test('an uncited confirming verdict still keeps the finding', () => {
  // The asymmetry is deliberate: requiring a citation to *report* would drop
  // real findings, which is the expensive error.
  const r = resolveAgainstDiff([v({ findingTitle: 'real bug', file: 'lib/a.ts', evidence: '' })])
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissalsRejected, 0)
  assert.deepEqual(r.surviving[0].votes, { real: 1, notReal: 0, uncited: 0, total: 1 })
})

test('one cited dismissal and one uncited confirmation: the non-vote is excluded', () => {
  const r = resolveAgainstDiff([
    refute('lib/a.ts:41-58'),
    v({ findingTitle: 'real bug', file: 'lib/a.ts', evidence: '' })
  ])
  // 1 real vs 1 notReal — the tie keeps the finding, and all three counts show.
  assert.deepEqual(r.surviving[0].votes, { real: 1, notReal: 1, uncited: 0, total: 2 })
  assert.equal(r.counts.surviving, 1)
})

test('with no diff supplied the citation shape alone still gates dismissal', () => {
  // The membership half needs a diff; the shape half never does. A caller that
  // cannot supply the changed files must not thereby reopen the emoji hole.
  const bare = (verdicts) => resolveReview([blocker()], verdicts)
  assert.equal(bare([refute('👍'), refute('👍')]).counts.dismissed, 0)
  assert.equal(bare([refute('lib/a.ts:41'), refute('lib/a.ts:41')]).counts.dismissed, 1)
})

test('formatReview names the refusals so a reader can see the rule fired', () => {
  const r = resolveAgainstDiff([refute('nope')])
  assert.match(formatReview(r), /1 refutation\(s\) cited no evidence/)
})
