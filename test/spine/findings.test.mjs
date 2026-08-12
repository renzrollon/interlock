import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateGate,
  groupByFile,
  formatGate,
  applyToleranceBand,
  TOLERANCE_BAND,
  UNSCOPED_GROUP
} from '../../lib/findings.mjs'

const f = (over = {}) => ({
  severity: 'warning',
  file: 'lib/a.ts',
  title: 'something',
  description: 'because',
  ...over
})

test('a gate passes only when no blocker survives', () => {
  assert.equal(evaluateGate({ dimension: 'qa', findings: [f()] }).passed, true)
  assert.equal(
    evaluateGate({ dimension: 'qa', findings: [f({ severity: 'blocker' })] }).passed,
    false
  )
})

test('accepts a bare array, a single dimension object, and an array of dimensions', () => {
  const bare = evaluateGate([f(), f({ title: 'other' })])
  assert.equal(bare.total, 2)

  const single = evaluateGate({ dimension: 'qa', findings: [f()] })
  assert.equal(single.total, 1)
  assert.equal(single.byDimension.qa, 1)

  const many = evaluateGate([
    { dimension: 'qa', findings: [f()] },
    { dimension: 'security', findings: [f({ title: 'x' }), f({ title: 'y' })] }
  ])
  assert.equal(many.total, 3)
  assert.deepEqual(many.byDimension, { qa: 1, security: 2 })
})

test('dimension is stamped onto each finding it came from', () => {
  const r = evaluateGate({ dimension: 'security', findings: [f({ severity: 'blocker' })] })
  assert.equal(r.blockers[0].dimension, 'security')
})

test('skeptic dismissals remove findings and are counted', () => {
  const r = evaluateGate(
    [f({ severity: 'blocker', title: 'ghost' }), f({ title: 'real' })],
    { dismissed: ['ghost'] }
  )
  assert.equal(r.passed, true)
  assert.equal(r.total, 1)
  assert.equal(r.dismissedCount, 1)
})

test('severity counts include an unknown bucket rather than silently dropping', () => {
  const r = evaluateGate([f({ severity: 'nit' })])
  assert.equal(r.counts.unknown, 1)
  assert.equal(r.total, 1)
  assert.equal(r.passed, true)
})

test('autonomyOutcome feeds straight into the ladder', () => {
  const r = evaluateGate([f({ severity: 'blocker' }), f({ severity: 'blocker', title: 'b2' })])
  assert.deepEqual(r.autonomyOutcome, { blockers: 2 })
})

// --- tolerance band -------------------------------------------------------

test('a weakly-scored blocker is dropped and therefore does not block the gate', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'thin', qualityScore: 2 })])
  assert.equal(r.passed, true)
  assert.equal(r.total, 0)
  assert.equal(r.droppedByQuality, 1)
  assert.equal(r.counts.blocker, 0)
})

test('a well-scored blocker still blocks', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'real', qualityScore: 4 })])
  assert.equal(r.passed, false)
  assert.equal(r.droppedByQuality, 0)
  assert.equal(r.blockers.length, 1)
})

test('an unscored blocker still blocks — no score is not evidence of low quality', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'unscored' })])
  assert.equal(r.passed, false)
  assert.equal(r.droppedByQuality, 0)
})

test('a score exactly at the floor is kept; strictly below is dropped', () => {
  assert.equal(evaluateGate([f({ severity: 'blocker', qualityScore: 3 })]).passed, false)
  assert.equal(evaluateGate([f({ severity: 'blocker', qualityScore: 2.9 })]).passed, true)
})

test('reportable and dropped partition the input', () => {
  const findings = [
    f({ title: 'keep-scored', qualityScore: 5 }),
    f({ title: 'keep-unscored' }),
    f({ title: 'drop-a', qualityScore: 1 }),
    f({ title: 'drop-b', qualityScore: 0 })
  ]
  const { reportable, dropped } = applyToleranceBand(findings)
  assert.deepEqual(reportable.map(x => x.title), ['keep-scored', 'keep-unscored'])
  assert.deepEqual(dropped.map(x => x.title), ['drop-a', 'drop-b'])
  assert.equal(reportable.length + dropped.length, findings.length)
})

test('skeptics disagreeing by more than drift keeps the finding', () => {
  const canonical = evaluateGate([
    f({ severity: 'blocker', title: 'contested', qualityScores: [2, 4] })
  ])
  assert.equal(canonical.passed, false)
  assert.equal(canonical.droppedByQuality, 0)

  // Same finding emitted once per skeptic instead of once with both scores.
  const repeated = applyToleranceBand([
    f({ title: 'contested', qualityScore: 2 }),
    f({ title: 'contested', qualityScore: 4 })
  ])
  assert.equal(repeated.reportable.length, 2)
  assert.equal(repeated.dropped.length, 0)
})

test('skeptics agreeing within drift use the higher score', () => {
  // 2 and 3 differ by drift=1, so effective quality is 3 — at the floor, kept.
  assert.equal(applyToleranceBand([f({ qualityScores: [2, 3] })]).dropped.length, 0)
  // 1 and 2 agree that it is weak; the higher score is still below the floor.
  assert.equal(applyToleranceBand([f({ qualityScores: [1, 2] })]).dropped.length, 1)
})

test('repeated weak entries for one finding are dropped as a group', () => {
  const r = evaluateGate([
    f({ severity: 'blocker', title: 'weak', qualityScore: 1 }),
    f({ severity: 'blocker', title: 'weak', qualityScore: 2 })
  ])
  assert.equal(r.passed, true)
  assert.equal(r.droppedByQuality, 2)
})

test('same title in a different file is a different finding', () => {
  const { reportable, dropped } = applyToleranceBand([
    f({ file: 'a.ts', title: 'dup', qualityScore: 1 }),
    f({ file: 'b.ts', title: 'dup', qualityScore: 5 })
  ])
  assert.deepEqual(dropped.map(x => x.file), ['a.ts'])
  assert.deepEqual(reportable.map(x => x.file), ['b.ts'])
})

test('a custom band moves the floor', () => {
  const findings = [f({ severity: 'blocker', qualityScore: 4 })]
  assert.equal(evaluateGate(findings).passed, false)
  assert.equal(
    evaluateGate(findings, { band: { ...TOLERANCE_BAND, minQualityToReport: 5 } }).passed,
    true
  )
})

test('band: null disables the band, preserving pre-band behaviour', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'thin', qualityScore: 1 })], {
    band: null
  })
  assert.equal(r.passed, false)
  assert.equal(r.total, 1)
  assert.equal(r.droppedByQuality, 0)
  assert.deepEqual(applyToleranceBand([f({ qualityScore: 0 })], null).dropped, [])
})

test('dismissals and quality drops are counted separately', () => {
  const r = evaluateGate(
    [
      f({ severity: 'blocker', title: 'ghost' }),
      f({ severity: 'blocker', title: 'thin', qualityScore: 1 }),
      f({ title: 'real', qualityScore: 4 })
    ],
    { dismissed: ['ghost'] }
  )
  assert.equal(r.dismissedCount, 1)
  assert.equal(r.droppedByQuality, 1)
  assert.equal(r.total, 1)
  assert.equal(r.passed, true)
})

test('formatGate prints the quality-dropped count only when non-zero', () => {
  const dropped = formatGate(evaluateGate([f({ severity: 'blocker', qualityScore: 1 })]))
  assert.match(dropped, /dropped by quality band: 1/)
  assert.doesNotMatch(formatGate(evaluateGate([f()])), /dropped by quality band/)
})

// --- grouping -------------------------------------------------------------

test('groups by file, sorted, with unscoped findings separated', () => {
  const { byFile, unscoped } = groupByFile([
    f({ file: 'z.ts' }),
    f({ file: 'a.ts' }),
    f({ file: 'a.ts', title: 'second' }),
    f({ file: '' }),
    f({ file: undefined })
  ])
  assert.deepEqual(byFile.map(g => g.file), ['a.ts', 'z.ts'])
  assert.equal(byFile[0].findings.length, 2)
  assert.equal(unscoped.length, 2)
})

test('placeholder file values count as unscoped', () => {
  const { byFile, unscoped } = groupByFile([
    f({ file: '-' }),
    f({ file: 'N/A' }),
    f({ file: 'n/a' }),
    f({ file: '   ' })
  ])
  assert.equal(byFile.length, 0)
  assert.equal(unscoped.length, 4)
})

test('grouped files are disjoint, so they are safe to fan out in parallel', () => {
  const { byFile } = groupByFile([
    f({ file: 'a.ts' }),
    f({ file: 'b.ts' }),
    f({ file: 'a.ts', title: 'x' })
  ])
  const seen = new Set()
  for (const g of byFile) {
    assert.ok(!seen.has(g.file))
    seen.add(g.file)
  }
})

test('UNSCOPED_GROUP never leaks into byFile', () => {
  const { byFile } = groupByFile([f({ file: UNSCOPED_GROUP })])
  assert.equal(byFile.length, 0)
})

test('degenerate input yields a passing, empty gate', () => {
  for (const input of [null, undefined, {}, [], 'nope', 42]) {
    const r = evaluateGate(input)
    assert.equal(r.passed, true)
    assert.equal(r.total, 0)
  }
})

test('formatGate names each blocker with its location', () => {
  const r = evaluateGate([f({ severity: 'blocker', file: 'app/x.ts', line: 9, title: 'Boom' })])
  const out = formatGate(r)
  assert.match(out, /GATE BLOCKED/)
  assert.match(out, /app\/x\.ts:9 — Boom/)
})
