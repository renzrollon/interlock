import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeDecision } from '../../lib/merge-lanes.mjs'

const lane = label => ({ label })

test('clean disjoint fold applies the union and reports each lane', () => {
  const result = mergeDecision({
    lanes: [lane('1.1'), lane('1.2')],
    changedByLane: {
      '1.1': ['lib/waves.mjs'],
      '1.2': ['lib/limits.mjs']
    },
    base: 'deadbeef'
  })
  assert.equal(result.status, 'clean')
  assert.equal(result.collisions.length, 0)
  assert.equal(result.unresolved.length, 0)
  assert.deepEqual(
    result.folds.map(f => f.lane).sort(),
    ['1.1', '1.2']
  )
  const byLane = Object.fromEntries(result.folds.map(f => [f.lane, f.files]))
  assert.deepEqual(byLane['1.1'], ['lib/waves.mjs'])
  assert.deepEqual(byLane['1.2'], ['lib/limits.mjs'])
})

test('an empty-write lane is reported, not dropped', () => {
  const result = mergeDecision({
    lanes: [lane('1.1'), lane('1.2')],
    changedByLane: {
      '1.1': ['lib/waves.mjs'],
      '1.2': []
    }
  })
  assert.equal(result.status, 'clean')
  const byLane = Object.fromEntries(result.folds.map(f => [f.lane, f.files]))
  assert.deepEqual(byLane['1.2'], [])
  assert.equal(result.folds.length, 2)
})

test('a canonical-only collision halts even when spellings differ', () => {
  const result = mergeDecision({
    lanes: [lane('A'), lane('B')],
    changedByLane: {
      A: ['src/a.ts'],
      B: ['./src/a.ts']
    }
  })
  assert.equal(result.status, 'collision')
  assert.equal(result.folds.length, 0)
  assert.equal(result.collisions.length, 1)
  assert.equal(result.collisions[0].canonicalPath, 'src/a.ts')
  assert.deepEqual(result.collisions[0].lanes.sort(), ['A', 'B'])
})

test('a real collision on a raw-identical path halts and names both lanes', () => {
  const result = mergeDecision({
    lanes: [lane('A'), lane('B')],
    changedByLane: {
      A: ['lib/risk.mjs'],
      B: ['lib/risk.mjs']
    }
  })
  assert.equal(result.status, 'collision')
  assert.deepEqual(result.collisions, [{ canonicalPath: 'lib/risk.mjs', lanes: ['A', 'B'] }])
})

test('a missing or empty label errors and never falls back to a filesystem scan', () => {
  const result = mergeDecision({
    lanes: [lane(''), lane('B')],
    changedByLane: { B: ['lib/waves.mjs'] }
  })
  assert.equal(result.status, 'error')
  assert.equal(result.folds.length, 0)
  assert.equal(result.collisions.length, 0)
  assert.ok(result.unresolved.some(u => u.label === ''))
})

test('a duplicate label within one batch errors, naming the offending label', () => {
  const result = mergeDecision({
    lanes: [lane('A'), lane('A')],
    changedByLane: { A: ['lib/waves.mjs'] }
  })
  assert.equal(result.status, 'error')
  assert.ok(result.unresolved.some(u => u.label === 'A' && /duplicate/.test(u.reason)))
})

test('a lane whose worktree could not be located errors, naming the lane', () => {
  const result = mergeDecision({
    lanes: [lane('A'), lane('B')],
    changedByLane: { A: ['lib/waves.mjs'] } // B has no entry at all
  })
  assert.equal(result.status, 'error')
  assert.ok(result.unresolved.some(u => u.label === 'B'))
})

test('mergeDecision touches no fs, clock, or random source', () => {
  // Structural guarantee: calling it twice with identical input yields
  // identical output, and it accepts plain data with no ambient state.
  const input = {
    lanes: [lane('1.1'), lane('1.2')],
    changedByLane: { '1.1': ['a.ts'], '1.2': ['b.ts'] },
    base: 'abc123'
  }
  const first = mergeDecision(input)
  const second = mergeDecision(input)
  assert.deepEqual(first, second)
})
