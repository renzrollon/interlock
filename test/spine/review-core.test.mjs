import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveReview, formatReview, writeReviewOut } from '../../lib/review-core.mjs'
import { TOLERANCE_BAND, FINDING_SCHEMA } from '../../lib/findings.mjs'

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
    droppedByPolicy: 0,
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
      droppedByPolicy: 0,
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
  assert.match(out, /raised=2 droppedByPolicy=0 dismissed=1 droppedByQuality=0 surviving=1/)
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

// A blast-radius finding's file is the observing caller outside the diff, so a
// refutation must cite that caller; that one path joins the allowed set for that
// dimension only.
const CALLER = 'lib/caller.ts'
const outsideFinding = dimension =>
  f({ severity: 'blocker', title: 'caller breaks', file: `./${CALLER}`, dimension })
const refuteCaller = () =>
  v({ findingTitle: 'caller breaks', file: `./${CALLER}`, isReal: false, refinedSeverity: 'dismiss', evidence: `${CALLER}:12-20` })

test('a refutation citing the observing caller dismisses a blast-radius finding outside the diff', () => {
  const r = resolveReview([outsideFinding('blast-radius')], [refuteCaller(), refuteCaller()], { changedPaths: DIFF })
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.counts.dismissalsRejected, 0)
})

test('the same caller citation against a finding of another dimension outside the diff stays a non-vote', () => {
  const r = resolveReview([outsideFinding('architecture')], [refuteCaller(), refuteCaller()], { changedPaths: DIFF })
  assert.equal(r.counts.dismissed, 0)
  assert.equal(r.counts.surviving, 1)
  assert.equal(r.counts.dismissalsRejected, 2)
})

test('a refutation citing its own file dismisses a regression finding outside the diff', () => {
  // spec: review/review-depth — a regression finding names an unchanged reader or end path.
  const r = resolveReview([outsideFinding('regression')], [refuteCaller(), refuteCaller()], { changedPaths: DIFF })
  assert.equal(r.counts.dismissed, 1)
  assert.equal(r.counts.dismissalsRejected, 0)
})

test('a blast-radius finding gains only its own file: a citation of another outside path stays a non-vote', () => {
  const other = () =>
    v({ findingTitle: 'caller breaks', file: `./${CALLER}`, isReal: false, refinedSeverity: 'dismiss', evidence: 'lib/nowhere.ts:1' })
  const r = resolveReview([outsideFinding('blast-radius')], [other(), other()], { changedPaths: DIFF })
  assert.equal(r.counts.dismissed, 0)
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

// --- requirement citations (change `judge-against-base-and-living-specs`, D4) --
//
// A finding may carry `requirement: 'openspec/specs/<capability>/spec.md#<heading>'`.
// The CLI checks the citation's SHAPE — the path is a canonical `openspec/specs/…/spec.md`,
// the file was readable at the base, the heading names a requirement in it — and
// reports a failed check under `anomalies.requirementCitations`. It never decides
// whether the requirement forbids what the diff does (that is the skeptics' job),
// and a failed check changes nothing about how the finding is adjudicated.
//
// `requirementHeadings` maps each cited spec path (canonical) to that file's
// requirement keys — heading text with a leading `Requirement:` stripped and
// whitespace collapsed, case kept — or to `{ unreadable: reason }`.

const SPEC = 'openspec/specs/hooks/tool-guards/spec.md'
const OTHER_SPEC = 'openspec/specs/hooks/other/spec.md'
const HEADS = new Map([
  [SPEC, ['Every guard SHALL fail open', 'A guard SHALL NOT block a commit outside a ship run']],
  [OTHER_SPEC, { unreadable: 'abc1234:openspec/specs/hooks/other/spec.md is not in the repository' }]
])
const cite = (heading, path = SPEC) => `${path}#${heading}`

const domainFinding = (over = {}) => f({ severity: 'blocker', title: 'cited', ...over })
const raised = (list, dimension = 'domain') => [{ dimension, findings: list }]
// Two skeptics who both call it real and keep the raised severity (the default
// verdict refines to `warning`, which would re-band every blocker below).
const real = (title, refined = 'blocker') => [
  v({ findingTitle: title, refinedSeverity: refined }),
  v({ findingTitle: title, refinedSeverity: refined })
]

const citationsOf = r => r.anomalies.requirementCitations

test('a valid citation reports nothing and the finding survives as it would uncited', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('Every guard SHALL fail open') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(citationsOf(r), [])
  assert.equal(r.counts.surviving, 1)
})

test('a result with no citations carries an empty requirementCitations list', () => {
  const r = resolveReview([f()], [])
  assert.deepEqual(citationsOf(r), [])
  assert.deepEqual(Object.keys(r.anomalies).sort(), ['malformedVerdicts', 'orphanVerdicts', 'requirementCitations', 'specGapShape'])
})

test('a citation outside openspec/specs is reported with the check it failed, and the finding is kept', () => {
  const requirement = cite('A requirement', 'openspec/changes/x/specs/a/spec.md')
  const r = resolveReview(
    raised([domainFinding({ title: 'out of tree', file: 'lib/b.ts', requirement })]),
    real('out of tree'),
    { requirementHeadings: HEADS }
  )
  assert.equal(citationsOf(r).length, 1)
  const [a] = citationsOf(r)
  assert.equal(a.dimension, 'domain')
  assert.equal(a.file, 'lib/b.ts')
  assert.equal(a.title, 'out of tree')
  assert.equal(a.requirement, requirement)
  assert.match(a.problem, /openspec\/specs/)
  assert.equal(r.counts.surviving, 1, 'a broken citation drops nothing')
})

test('a citation whose path is not a spec.md is reported', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('Every guard SHALL fail open', 'openspec/specs/hooks/notes.md') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.equal(citationsOf(r).length, 1)
  assert.match(citationsOf(r)[0].problem, /spec\.md/)
})

test('a citation naming no heading in the file is reported as naming no requirement', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('A guard SHALL be invented') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.equal(citationsOf(r).length, 1)
  assert.match(citationsOf(r)[0].problem, /no requirement/i)
  assert.equal(r.counts.surviving, 1)
})

test('a citation of a file absent from the readable set is reported', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('Every guard SHALL fail open', 'openspec/specs/hooks/ghost/spec.md') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.equal(citationsOf(r).length, 1)
  assert.equal(r.counts.surviving, 1)
})

test('a cited file that could not be read is reported as unchecked, with the reason', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('Anything', OTHER_SPEC) })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.equal(citationsOf(r).length, 1)
  assert.match(citationsOf(r)[0].problem, /unchecked/i)
  assert.match(citationsOf(r)[0].problem, /is not in the repository/, 'the reason travels with the report')
  assert.equal(r.counts.surviving, 1)
})

test('a ./-spelled path is the same canonical path', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('Every guard SHALL fail open', './' + SPEC) })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(citationsOf(r), [])
})

test('heading spellings: extra spaces and a Requirement: prefix resolve, a case difference does not', () => {
  const r = resolveReview(
    raised([
      domainFinding({ title: 'spaced', requirement: cite('Every  guard   SHALL fail open') }),
      domainFinding({ title: 'prefixed', requirement: cite('Requirement: Every guard SHALL fail open') }),
      domainFinding({ title: 'cased', requirement: cite('Every guard shall fail open') })
    ]),
    [...real('spaced'), ...real('prefixed'), ...real('cased')],
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(
    citationsOf(r).map(a => a.title),
    ['cased'],
    'headings match on whitespace, not on case'
  )
  assert.match(citationsOf(r)[0].problem, /no requirement/i)
  assert.equal(r.counts.surviving, 3, 'none of the three is dropped')
})

test('a domain blocker that cites nothing is reported, and still survives on its verdicts', () => {
  const r = resolveReview(
    raised([domainFinding({ title: 'uncited blocker' })]),
    real('uncited blocker'),
    { requirementHeadings: HEADS }
  )
  assert.equal(citationsOf(r).length, 1)
  const [a] = citationsOf(r)
  assert.equal(a.dimension, 'domain')
  assert.equal(a.title, 'uncited blocker')
  assert.match(a.problem, /cites no requirement/i)
  assert.equal(r.counts.surviving, 1, 'adjudicated, never dropped')
  assert.equal(r.surviving[0].severity, 'blocker', 'and never re-banded')
})

test('an uncited domain blocker is reported even when no headings were supplied', () => {
  const r = resolveReview(raised([domainFinding({ title: 'uncited blocker' })]), real('uncited blocker'))
  assert.equal(citationsOf(r).length, 1)
  assert.match(citationsOf(r)[0].problem, /cites no requirement/i)
})

test('an uncited domain blocker is a blocker on the severity the gate reads, whatever its case or spacing', () => {
  for (const severity of ['BLOCKER', ' blocker ', 'Blocker']) {
    const r = resolveReview(raised([domainFinding({ title: 'uncited blocker', severity })]), real('uncited blocker'))
    assert.equal(citationsOf(r).length, 1, `severity ${JSON.stringify(severity)} blocks at the gate and was not reported here`)
    assert.match(citationsOf(r)[0].problem, /cites no requirement/i)
    assert.equal(r.counts.surviving, 1, 'adjudicated, never dropped')
  }
})

test('a domain warning that cites nothing is not reported', () => {
  const r = resolveReview(
    raised([f({ severity: 'warning', title: 'unspecified behaviour' })]),
    real('unspecified behaviour', 'warning'),
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(citationsOf(r), [])
  assert.equal(r.counts.surviving, 1)
})

test('a blocker that cites nothing under another dimension is not reported', () => {
  const r = resolveReview(
    raised([f({ severity: 'blocker', title: 'plain blocker' })], 'qa'),
    real('plain blocker'),
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(citationsOf(r), [])
})

test('a finding is adjudicated exactly as if it carried no citation', () => {
  const withCitations = [
    { dimension: 'domain', findings: [
      domainFinding({ title: 'good cite', requirement: cite('Every guard SHALL fail open') }),
      domainFinding({ title: 'bad cite survives', requirement: cite('Not a heading') }),
      domainFinding({ title: 'bad cite refuted', requirement: cite('Not a heading either') }),
      domainFinding({ title: 'outside cite', requirement: cite('X', 'openspec/changes/x/specs/a/spec.md') }),
      f({ severity: 'warning', title: 'weak', requirement: cite('Every guard SHALL fail open') })
    ] }
  ]
  const without = withCitations.map(g => ({
    ...g,
    findings: g.findings.map(({ requirement, ...rest }) => rest)
  }))
  const verdicts = [
    ...real('good cite'),
    ...real('bad cite survives'),
    v({ findingTitle: 'bad cite refuted', isReal: false }),
    v({ findingTitle: 'bad cite refuted', isReal: false }),
    v({ findingTitle: 'outside cite', isReal: true }),
    v({ findingTitle: 'outside cite', isReal: false }),
    v({ findingTitle: 'weak', qualityScore: 1 }),
    v({ findingTitle: 'weak', qualityScore: 1 })
  ]
  const a = resolveReview(withCitations, verdicts, { requirementHeadings: HEADS })
  const b = resolveReview(without, verdicts, { requirementHeadings: HEADS })

  assert.deepEqual(a.counts, b.counts)
  assert.deepEqual(a.dimensionStats, b.dimensionStats)
  assert.deepEqual(
    a.surviving.map(x => [x.title, x.severity]),
    b.surviving.map(x => [x.title, x.severity])
  )
  assert.deepEqual(a.dismissed.map(x => x.title), b.dismissed.map(x => x.title))
  assert.deepEqual(a.droppedByQuality.map(x => x.title), b.droppedByQuality.map(x => x.title))
  assert.equal(a.dismissed.length, 1, 'the refuted finding is still dismissed')
  assert.deepEqual(a.dismissed.map(x => x.title), ['bad cite refuted'])
  // The three bad citations are reported; the good one is not; the uncited ones carry no report.
  assert.deepEqual(
    citationsOf(a).map(x => x.title).sort(),
    ['bad cite refuted', 'bad cite survives', 'outside cite']
  )
})

test('the counts keep their keys when citations are checked', () => {
  const r = resolveReview(
    raised([domainFinding({ requirement: cite('Not a heading') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(Object.keys(r.counts).sort(), [
    'dismissalsRejected',
    'dismissed',
    'droppedByPolicy',
    'droppedByQuality',
    'raised',
    'surviving'
  ])
})

test('formatReview names a citation problem as an ANOMALY and stays quiet about a valid one', () => {
  const bad = resolveReview(
    raised([domainFinding({ title: 'fabricated', requirement: cite('Not a heading') })]),
    real('fabricated'),
    { requirementHeadings: HEADS }
  )
  assert.match(formatReview(bad), /ANOMALY:.*requirement.*fabricated/is)

  const uncited = resolveReview(raised([domainFinding({ title: 'uncited blocker' })]), real('uncited blocker'))
  assert.match(formatReview(uncited), /ANOMALY:.*uncited blocker/s)

  const ok = resolveReview(
    raised([domainFinding({ requirement: cite('Every guard SHALL fail open') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.doesNotMatch(formatReview(ok), /ANOMALY/)
})

test('the finding schema carries an optional requirement string', () => {
  const props = FINDING_SCHEMA.properties.findings.items.properties
  assert.equal(props.requirement && props.requirement.type, 'string')
  assert.ok(!FINDING_SCHEMA.properties.findings.items.required.includes('requirement'), 'citing is optional')
})

test('a requirement field changes none of the survival arithmetic on a finding that was already real', () => {
  const plain = resolveReview(raised([domainFinding()]), real('cited'))
  const cited = resolveReview(
    raised([domainFinding({ requirement: cite('Every guard SHALL fail open') })]),
    real('cited'),
    { requirementHeadings: HEADS }
  )
  assert.deepEqual(cited.counts, plain.counts)
  assert.equal(cited.surviving[0].requirement, cite('Every guard SHALL fail open'), 'the citation travels with the finding')
})

// --- specGap: shape-checked, never a verdict --------------------------------

test('the finding schema lists specGap as an optional boolean beside requirement', () => {
  const items = FINDING_SCHEMA.properties.findings.items
  assert.equal(items.properties.specGap && items.properties.specGap.type, 'boolean')
  assert.ok(!items.required.includes('specGap'))
})

test('a boolean specGap passes through resolveReview unchanged', () => {
  const r = resolveReview(
    raised([f({ title: 'gap', specGap: true }), f({ title: 'no gap', file: 'lib/b.ts', specGap: false })], 'domain'),
    [...real('gap', 'warning'), ...real('no gap', 'warning')]
  )
  const byTitle = Object.fromEntries(r.surviving.map(x => [x.title, x]))
  assert.equal(byTitle.gap.specGap, true)
  assert.equal(byTitle['no gap'].specGap, false)
  assert.deepEqual(r.anomalies.specGapShape, [])
})

test('a non-boolean specGap is a non-blocking anomaly: the finding is kept and the field read as absent', () => {
  const r = resolveReview(raised([f({ title: 'typo', specGap: 'yes' })], 'domain'), real('typo', 'warning'))
  assert.equal(r.counts.surviving, 1, 'the finding is kept')
  assert.equal(r.surviving[0].title, 'typo')
  assert.equal(r.surviving[0].specGap, undefined, 'the field is read as absent')
  assert.ok(Array.isArray(r.anomalies.specGapShape))
  assert.equal(r.anomalies.specGapShape.length, 1)
  const [a] = r.anomalies.specGapShape
  assert.equal(a.title, 'typo')
  assert.equal(a.file, 'lib/a.ts')
  assert.match(a.problem, /specGap is not a boolean/)
  assert.match(JSON.stringify(a), /string/, 'the value’s type is named')
  // It sits beside the citation check and does not displace it.
  assert.deepEqual(r.anomalies.requirementCitations, [])
})

test('formatReview names a specGap shape problem as an ANOMALY and is quiet for a boolean', () => {
  const bad = resolveReview(raised([f({ title: 'typo', specGap: 7 })], 'domain'), real('typo', 'warning'))
  assert.match(formatReview(bad), /ANOMALY:.*typo.*specGap is not a boolean/s)
  const ok = resolveReview(raised([f({ title: 'fine', specGap: true })], 'domain'), real('fine', 'warning'))
  assert.doesNotMatch(formatReview(ok), /specGap/)
})

test('specGap changes none of the survival arithmetic', () => {
  const counts = gap => {
    const extra = gap === undefined ? {} : { specGap: gap }
    return resolveReview(raised([f({ title: 'x', ...extra })], 'domain'), real('x', 'warning')).counts
  }
  for (const value of [true, false, 'yes']) assert.deepEqual(counts(value), counts(undefined))
})

// --- resolveReview's output does not move ----------------------------------
//
// A recorded snapshot: a survivor refined up, a file-qualified dismissal beside
// a same-titled survivor, a title-only dismissal, a quality drop, a policy drop
// and an orphan verdict. No consumer of the review JSON may see a new field.

const RESOLVE_REVIEW_SNAPSHOT = JSON.parse(String.raw`{
  "surviving": [
    {
      "severity": "blocker",
      "file": "lib/a.ts",
      "title": "kept",
      "description": "because",
      "dimension": "typescript",
      "votes": {
        "real": 2,
        "notReal": 0,
        "uncited": 0,
        "total": 2
      },
      "qualityScores": [
        4,
        4
      ],
      "originalSeverity": "warning"
    },
    {
      "severity": "warning",
      "file": "lib/c.ts",
      "title": "shared title",
      "description": "because",
      "dimension": "qa",
      "votes": {
        "real": 1,
        "notReal": 0,
        "uncited": 0,
        "total": 1
      },
      "qualityScores": [
        4
      ]
    }
  ],
  "dismissed": [
    {
      "severity": "warning",
      "file": "lib/b.ts",
      "title": "shared title",
      "description": "because",
      "dimension": "qa",
      "votes": {
        "real": 0,
        "notReal": 2,
        "uncited": 0,
        "total": 2
      }
    },
    {
      "severity": "warning",
      "file": "lib/d.ts",
      "title": "title only dismissed",
      "description": "because",
      "dimension": "qa",
      "votes": {
        "real": 0,
        "notReal": 2,
        "uncited": 0,
        "total": 2
      }
    }
  ],
  "droppedByQuality": [
    {
      "severity": "warning",
      "file": "lib/e.ts",
      "title": "too vague",
      "description": "because",
      "dimension": "typescript",
      "votes": {
        "real": 2,
        "notReal": 0,
        "uncited": 0,
        "total": 2
      },
      "qualityScores": [
        1,
        1
      ]
    }
  ],
  "droppedByPolicy": [
    {
      "severity": "warning",
      "file": "dist/x.js",
      "title": "generated",
      "description": "because",
      "dimension": "devops",
      "excludedBy": "dist"
    }
  ],
  "counts": {
    "raised": 6,
    "droppedByPolicy": 1,
    "dismissed": 2,
    "droppedByQuality": 1,
    "surviving": 2,
    "dismissalsRejected": 0
  },
  "dimensionStats": {
    "typescript": {
      "raised": 2,
      "surviving": 1
    },
    "qa": {
      "raised": 3,
      "surviving": 1
    }
  },
  "anomalies": {
    "orphanVerdicts": [
      {
        "findingTitle": "nobody raised this",
        "isReal": true,
        "confidence": 0.9,
        "reasoning": "checked it",
        "evidence": "lib/a.ts:41-58",
        "refinedSeverity": "warning",
        "qualityScore": 4,
        "severityScore": 3
      }
    ],
    "malformedVerdicts": [],
    "requirementCitations": [],
    "specGapShape": []
  }
}`)

test('resolveReview’s output is deep-equal to its recorded snapshot', () => {
  const findings = [
    f({ title: 'kept', dimension: 'typescript' }),
    f({ title: 'shared title', file: 'lib/b.ts', dimension: 'qa' }),
    f({ title: 'shared title', file: 'lib/c.ts', dimension: 'qa' }),
    f({ title: 'title only dismissed', file: 'lib/d.ts', dimension: 'qa' }),
    f({ title: 'too vague', file: 'lib/e.ts', dimension: 'typescript' }),
    f({ title: 'generated', file: 'dist/x.js', dimension: 'devops' })
  ]
  const verdicts = [
    v({ findingTitle: 'kept' }),
    v({ findingTitle: 'kept', refinedSeverity: 'blocker' }),
    v({ findingTitle: 'shared title', file: 'lib/b.ts', isReal: false }),
    v({ findingTitle: 'shared title', file: 'lib/b.ts', isReal: false }),
    v({ findingTitle: 'shared title' }),
    v({ findingTitle: 'title only dismissed', isReal: false }),
    v({ findingTitle: 'title only dismissed', isReal: false }),
    v({ findingTitle: 'too vague', qualityScore: 1 }),
    v({ findingTitle: 'too vague', qualityScore: 1 }),
    v({ findingTitle: 'nobody raised this' })
  ]
  const r = resolveReview(findings, verdicts, {
    changedPaths: ['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts', 'lib/e.ts'],
    excludePaths: ['dist']
  })
  assert.deepEqual(JSON.parse(JSON.stringify(r)), RESOLVE_REVIEW_SNAPSHOT)
  assert.deepEqual(Object.keys(r).sort(), ['anomalies', 'counts', 'dimensionStats', 'dismissed', 'droppedByPolicy', 'droppedByQuality', 'surviving'])
  for (const d of r.dismissed) assert.deepEqual(Object.keys(d.votes).sort(), ['notReal', 'real', 'total', 'uncited'])
  assert.ok(r.dismissed.every(d => !('verdicts' in d)), 'a dismissed record gained a verdicts field')
})

test('writeReviewOut names a cleanup that also failed, so a partial file is never left unsaid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-out-'))
  try {
    // A directory at the --out path: the write fails, and so does the removal.
    const out = join(dir, 'review.json')
    mkdirSync(out)
    let message = null
    writeReviewOut(out, { ok: true }, m => {
      message = m
    })
    assert.match(message, /could not be written/)
    assert.match(message, /could not be removed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
