import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRemediation, formatRemediationPlan } from '../../lib/remediate.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const f = (over = {}) => ({
  severity: 'blocker',
  file: 'lib/a.ts',
  title: 'something',
  description: 'because',
  ...over
})

const twoRounds = { limits: { remediationRounds: 2 } }
const titles = plan => [
  ...plan.fix.byFile.flatMap(g => g.findings),
  ...plan.fix.unscoped
].map(x => x.title)

// --- triage ---------------------------------------------------------------

test('blockers are routed to fix and suggestions to deferred, from one input', () => {
  const plan = planRemediation([
    f({ severity: 'blocker', title: 'crash' }),
    f({ severity: 'suggestion', title: 'rename' })
  ])
  assert.deepEqual(titles(plan), ['crash'])
  assert.deepEqual(plan.deferred.map(d => d.title), ['rename'])
  assert.equal(plan.counts.fixing, 1)
  assert.equal(plan.counts.deferring, 1)
})

test('warnings are fixed alongside blockers', () => {
  const plan = planRemediation([
    f({ severity: 'blocker', title: 'crash' }),
    f({ severity: 'warning', title: 'smell' })
  ])
  assert.deepEqual(titles(plan).sort(), ['crash', 'smell'])
  assert.deepEqual(plan.deferred, [])
})

test('an unresolved warning is never a halt reason, even at the verdict', () => {
  const plan = planRemediation([f({ severity: 'warning' })], { round: 3, ...twoRounds })
  assert.equal(plan.isFinalRound, true)
  assert.equal(plan.counts.warnings, 1)
  assert.equal(plan.halt, false)
  assert.equal(plan.haltReason, null)
})

test('a suggestion is deferred even when it is the only finding', () => {
  const plan = planRemediation([f({ severity: 'suggestion' })], { round: 2, ...twoRounds })
  assert.equal(plan.counts.fixing, 0)
  assert.equal(plan.halt, false)
})

test('an unrecognized severity is deferred for triage rather than fixed', () => {
  const plan = planRemediation([f({ severity: 'nit', title: 'odd' })])
  assert.equal(plan.counts.fixing, 0)
  assert.equal(plan.deferred.length, 1)
  assert.match(plan.deferred[0].reason, /unrecognized severity "nit"/)
})

test('a finding with no severity at all is deferred, not fixed', () => {
  const plan = planRemediation([{ file: 'lib/a.ts', title: 'shapeless' }])
  assert.equal(plan.counts.fixing, 0)
  assert.match(plan.deferred[0].reason, /unrecognized severity \(missing\)/)
})

// --- parallel-safe partition ----------------------------------------------

test('two findings in the same file land in one group, never two parallel ones', () => {
  const plan = planRemediation([
    f({ file: 'lib/a.ts', title: 'one' }),
    f({ file: 'lib/b.ts', title: 'two' }),
    f({ file: 'lib/a.ts', title: 'three' })
  ])
  assert.deepEqual(plan.fix.byFile.map(g => g.file), ['lib/a.ts', 'lib/b.ts'])
  assert.equal(plan.fix.byFile[0].findings.length, 2)
})

test('every parallel group owns a distinct file', () => {
  const plan = planRemediation([
    f({ file: 'lib/a.ts' }),
    f({ file: 'lib/b.ts', title: 'x' }),
    f({ file: 'lib/a.ts', title: 'y' }),
    f({ file: 'lib/c.ts', title: 'z' })
  ])
  const files = plan.fix.byFile.map(g => g.file)
  assert.equal(new Set(files).size, files.length)
})

test('unscoped findings are separated from the parallel groups', () => {
  const plan = planRemediation([
    f({ file: 'lib/a.ts', title: 'scoped' }),
    f({ file: '', title: 'nowhere' }),
    f({ file: 'N/A', title: 'also nowhere' })
  ])
  assert.deepEqual(plan.fix.byFile.map(g => g.file), ['lib/a.ts'])
  assert.deepEqual(plan.fix.unscoped.map(x => x.title), ['nowhere', 'also nowhere'])
})

test('the unscoped group is labelled sequential and applied last', () => {
  const plan = planRemediation([f({ file: 'lib/a.ts' }), f({ file: '-', title: 'wide' })])
  const out = formatRemediationPlan(plan)
  assert.match(out, /sequential — 1 unscoped finding\(s\), applied last/)
  assert.ok(out.indexOf('parallel') < out.indexOf('sequential'))
})

// --- rounds and halting ---------------------------------------------------

test('round 1 of 2 is neither the last fix pass nor the verdict', () => {
  const plan = planRemediation([f()], { round: 1, ...twoRounds })
  assert.equal(plan.round, 1)
  assert.equal(plan.roundCap, 2)
  assert.equal(plan.isFinalFixRound, false)
  assert.equal(plan.isFinalRound, false)
})

test('surviving blockers at the last fix round do not halt — that pass has not run yet', () => {
  const plan = planRemediation([f({ severity: 'blocker' })], { round: 2, ...twoRounds })
  assert.equal(plan.isFinalFixRound, true)
  assert.equal(plan.isFinalRound, false)
  assert.equal(plan.halt, false)
  assert.equal(plan.haltReason, null)
  assert.deepEqual(titles(plan), ['something'], 'the last fix pass is still planned')
})

test('surviving blockers before the last fix round do not halt', () => {
  const plan = planRemediation([f({ severity: 'blocker' })], { round: 1, ...twoRounds })
  assert.equal(plan.counts.blockers, 1)
  assert.equal(plan.halt, false)
  assert.equal(plan.haltReason, null)
})

test('blockers surviving into the verdict round halt the run, with a reason', () => {
  const plan = planRemediation(
    [f({ severity: 'blocker' }), f({ severity: 'blocker', title: 'b2' })],
    { round: 3, ...twoRounds }
  )
  assert.equal(plan.isFinalRound, true)
  assert.equal(plan.halt, true)
  assert.match(plan.haltReason, /2 unresolved blocker\(s\) after 2 remediation round\(s\)/)
})

test('the verdict round plans no fixes and no re-review — the budget is spent', () => {
  const plan = planRemediation([f({ severity: 'blocker' }), f({ severity: 'warning', title: 'w' })], {
    round: 3,
    ...twoRounds
  })
  assert.deepEqual(plan.fix.byFile, [])
  assert.deepEqual(plan.fix.unscoped, [])
  assert.equal(plan.counts.fixing, 0)
  assert.deepEqual(plan.reReviewDimensions, [])
})

test('the verdict round with zero blockers does not halt', () => {
  const plan = planRemediation(
    [f({ severity: 'warning' }), f({ severity: 'suggestion', title: 's' })],
    { round: 3, ...twoRounds }
  )
  assert.equal(plan.isFinalRound, true)
  assert.equal(plan.halt, false)
  assert.equal(plan.haltReason, null)
})

test('the verdict round still reports counts and deferrals for everything it saw', () => {
  const plan = planRemediation(
    [
      f({ severity: 'blocker', title: 'crash' }),
      f({ severity: 'warning', title: 'smell' }),
      f({ severity: 'suggestion', title: 'rename' })
    ],
    { round: 3, ...twoRounds }
  )
  assert.deepEqual(plan.counts, {
    blockers: 1,
    warnings: 1,
    suggestions: 1,
    fixing: 0,
    deferring: 3
  })
  assert.deepEqual(plan.deferred.map(d => d.title).sort(), ['crash', 'rename', 'smell'])
  const crash = plan.deferred.find(d => d.title === 'crash')
  assert.match(crash.reason, /remediation budget spent — 2 fix round\(s\) used/)
})

test('the round cap comes from LIMITS, not from a literal in this module', () => {
  const plan = planRemediation([f()])
  assert.equal(plan.roundCap, LIMITS.remediationRounds)
  assert.equal(plan.round, 1, 'round defaults to 1')
})

test('a caller-supplied cap moves the verdict round', () => {
  const opts = { limits: { remediationRounds: 3 } }
  assert.equal(planRemediation([f()], { round: 3, ...opts }).isFinalRound, false)
  assert.equal(planRemediation([f()], { round: 3, ...opts }).isFinalFixRound, true)
  assert.equal(planRemediation([f()], { round: 4, ...opts }).isFinalRound, true)
})

// --- re-review scoping ----------------------------------------------------

test('reReviewDimensions lists only dimensions that raised findings', () => {
  const plan = planRemediation([
    { dimension: 'security', findings: [f({ title: 'injection' })] },
    { dimension: 'qa', findings: [f({ title: 'untested', file: 'lib/b.ts' })] },
    { dimension: 'performance', findings: [] }
  ])
  assert.deepEqual(plan.reReviewDimensions, ['qa', 'security'])
})

test('a dimension that raised only deferred findings is not re-reviewed', () => {
  const plan = planRemediation([
    { dimension: 'security', findings: [f({ severity: 'blocker' })] },
    { dimension: 'style', findings: [f({ severity: 'suggestion', file: 'lib/b.ts' })] }
  ])
  assert.deepEqual(plan.reReviewDimensions, ['security'])
})

test('nothing to fix means nothing to re-review', () => {
  const plan = planRemediation({ dimension: 'style', findings: [f({ severity: 'suggestion' })] })
  assert.deepEqual(plan.reReviewDimensions, [])
})

test('each dimension appears once however many findings it raised', () => {
  const plan = planRemediation({
    dimension: 'qa',
    findings: [f({ title: 'a' }), f({ title: 'b', file: 'lib/b.ts' })]
  })
  assert.deepEqual(plan.reReviewDimensions, ['qa'])
})

// --- nothing is dropped silently ------------------------------------------

test('every deferred entry carries a non-empty reason', () => {
  const plan = planRemediation([
    f({ severity: 'suggestion', title: 'nice to have' }),
    f({ severity: 'nit', title: 'odd' }),
    f({ severity: 'blocker', title: 'weak', qualityScore: 1 })
  ])
  assert.equal(plan.deferred.length, 3)
  for (const d of plan.deferred) {
    assert.equal(typeof d.reason, 'string')
    assert.ok(d.reason.length > 0, `${d.title} was deferred without a reason`)
  }
})

test('a deferred entry records title, file and severity alongside the reason', () => {
  const plan = planRemediation([
    f({ severity: 'suggestion', file: 'lib/z.ts', title: 'rename' })
  ])
  assert.deepEqual(plan.deferred, [
    {
      title: 'rename',
      file: 'lib/z.ts',
      severity: 'suggestion',
      dimension: null,
      reason: plan.deferred[0].reason
    }
  ])
})

test('a finding scored away by the quality band is deferred, not silently lost', () => {
  const plan = planRemediation([f({ severity: 'blocker', title: 'thin', qualityScore: 1 })])
  assert.equal(plan.counts.fixing, 0)
  assert.equal(plan.counts.blockers, 0, 'a band-dropped blocker cannot halt the run')
  assert.equal(plan.deferred.length, 1)
  assert.match(plan.deferred[0].reason, /quality band/)
})

test('band: null keeps a weakly-scored blocker in the fix set', () => {
  const plan = planRemediation([f({ severity: 'blocker', title: 'thin', qualityScore: 1 })], {
    band: null
  })
  assert.equal(plan.counts.blockers, 1)
  assert.deepEqual(titles(plan), ['thin'])
})

// --- validation -----------------------------------------------------------

test('a round above the verdict round is a user-facing error', () => {
  assert.throws(
    () => planRemediation([f()], { round: 4, ...twoRounds }),
    /rounds 1-2 are fix passes and round 3 is the verdict/
  )
  try {
    planRemediation([f()], { round: 4, ...twoRounds })
    assert.fail('expected a throw')
  } catch (err) {
    assert.equal(err.userFacing, true)
  }
})

test('a nonsense round is rejected rather than silently defaulted', () => {
  assert.throws(() => planRemediation([f()], { round: 0 }), /must be a positive integer/)
  assert.throws(() => planRemediation([f()], { round: -1 }), /must be a positive integer/)
  assert.throws(() => planRemediation([f()], { round: 1.5 }), /must be a positive integer/)
  assert.throws(() => planRemediation([f()], { round: '1' }), /must be a positive integer/)
})

test('a limits object without a usable round cap is rejected', () => {
  assert.throws(
    () => planRemediation([f()], { limits: {} }),
    /limits.remediationRounds must be a positive integer/
  )
  assert.throws(
    () => planRemediation([f()], { limits: { remediationRounds: 0 } }),
    /limits.remediationRounds must be a positive integer/
  )
})

test('degenerate input yields an empty, non-halting plan even at the verdict', () => {
  for (const input of [null, undefined, {}, [], 'nope', 42]) {
    const plan = planRemediation(input, { round: 3, ...twoRounds })
    assert.equal(plan.counts.fixing, 0)
    assert.equal(plan.deferred.length, 0)
    assert.equal(plan.halt, false)
    assert.deepEqual(plan.fix.byFile, [])
  }
})

// --- purity ---------------------------------------------------------------

test('the caller input objects are never mutated', () => {
  const input = [
    { dimension: 'qa', findings: [f({ severity: 'blocker', title: 'crash' })] },
    { dimension: 'style', findings: [f({ severity: 'suggestion', title: 'rename' })] }
  ]
  const before = structuredClone(input)
  planRemediation(input, { round: 1, ...twoRounds })
  assert.deepEqual(input, before, 'caller objects must be untouched')
})

test('the plan does not alias the caller findings', () => {
  const finding = f({ severity: 'blocker' })
  const plan = planRemediation([finding])
  const fixed = plan.fix.byFile[0].findings[0]
  assert.deepEqual(fixed, finding)
  assert.notEqual(fixed, finding, 'fixer agents must not be handed the caller objects')
})

// --- formatting -----------------------------------------------------------

test('formatRemediationPlan renders groups and deferrals for a fix round', () => {
  const plan = planRemediation(
    [
      { dimension: 'security', findings: [f({ severity: 'blocker', title: 'injection' })] },
      {
        dimension: 'style',
        findings: [f({ severity: 'suggestion', file: 'lib/b.ts', title: 'rename' })]
      }
    ],
    { round: 2, ...twoRounds }
  )
  const out = formatRemediationPlan(plan)
  assert.match(out, /REMEDIATION round 2\/2 \(last fix pass\) — 1 to fix, 1 deferred/)
  assert.match(out, /blocker=1 warning=0 suggestion=1/)
  assert.match(out, /lib\/a\.ts — 1 finding\(s\)/)
  assert.match(out, /re-review dimensions: security/)
  assert.match(out, /\[suggestion\] lib\/b\.ts — rename/)
  assert.doesNotMatch(out, /HALT/, 'the last fix pass must not pre-announce a halt')
})

test('formatRemediationPlan renders the verdict round as a verdict, not an empty fix plan', () => {
  const out = formatRemediationPlan(
    planRemediation([f({ severity: 'blocker' })], { round: 3, ...twoRounds })
  )
  assert.match(out, /REMEDIATION VERDICT after 2 round\(s\) — 1 blocker\(s\) unresolved/)
  assert.match(out, /HALT: 1 unresolved blocker\(s\) after 2 remediation round\(s\)/)
  assert.doesNotMatch(out, /nothing to fix/)
  assert.doesNotMatch(out, /parallel/)
})

test('formatRemediationPlan renders a clean verdict', () => {
  const out = formatRemediationPlan(
    planRemediation([f({ severity: 'suggestion' })], { round: 3, ...twoRounds })
  )
  assert.match(out, /REMEDIATION VERDICT after 2 round\(s\) — clean, no unresolved blockers/)
  assert.doesNotMatch(out, /HALT/)
})

test('formatRemediationPlan says so when there is nothing to fix', () => {
  const out = formatRemediationPlan(planRemediation([]))
  assert.match(out, /nothing to fix/)
  assert.doesNotMatch(out, /HALT/)
})

test('formatRemediationPlan flags unlabelled findings instead of an empty dimension list', () => {
  const out = formatRemediationPlan(planRemediation([f({ severity: 'blocker' })]))
  assert.match(out, /re-review dimensions: \(unlabelled/)
})
