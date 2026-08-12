import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateGate, groupByFile, formatGate, UNSCOPED_GROUP } from '../../lib/findings.mjs'

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
