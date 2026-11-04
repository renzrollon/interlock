// changedRanges' `linesOf` option and lineCount (lib/review-scope.mjs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedRanges, lineCount } from '../../lib/review-scope.mjs'

const diff = ['diff --git a/lib/a.mjs b/lib/a.mjs', '--- a/lib/a.mjs', '+++ b/lib/a.mjs', '@@ -1,0 +2,2 @@', '+x', '+y'].join('\n')

test('linesOf is never called for a path the diff names', () => {
  const calls = []
  const out = changedRanges(diff, ['lib/a.mjs'], { linesOf: p => (calls.push(p), 9) })
  assert.deepEqual(calls, [])
  assert.deepEqual(out, [{ path: 'lib/a.mjs', ranges: [[2, 3]] }])
})

test('linesOf is called once for an unnamed observed path and its count becomes one whole-file range', () => {
  const calls = []
  const out = changedRanges(diff, ['lib/a.mjs', 'new.mjs'], { linesOf: p => (calls.push(p), 5) })
  assert.deepEqual(calls, ['new.mjs'])
  assert.deepEqual(out[1], { path: 'new.mjs', ranges: [[1, 5]] })
})

test('a null, undefined or 0 count from linesOf gives no ranges', () => {
  for (const count of [null, undefined, 0]) {
    assert.deepEqual(changedRanges('', ['f.mjs'], { linesOf: () => count }), [{ path: 'f.mjs', ranges: [] }])
  }
})

test('an object entry with lines wins over linesOf', () => {
  const calls = []
  const out = changedRanges('', [{ path: 'f.mjs', lines: 3 }], { linesOf: p => (calls.push(p), 9) })
  assert.deepEqual(calls, [])
  assert.deepEqual(out, [{ path: 'f.mjs', ranges: [[1, 3]] }])
})

test('lineCount counts lines, a final newline closing the last one, and is null for non-strings', () => {
  assert.equal(lineCount(null), null)
  assert.equal(lineCount(undefined), null)
  assert.equal(lineCount(5), null)
  assert.equal(lineCount(''), 0)
  assert.equal(lineCount('a'), 1)
  assert.equal(lineCount('a\n'), 1)
  assert.equal(lineCount('a\nb'), 2)
  assert.equal(lineCount('a\nb\n'), 2)
})
