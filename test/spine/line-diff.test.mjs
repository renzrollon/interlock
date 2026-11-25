// `lib/line-diff.mjs` (change `scope-suggest-and-evaluate-the-artifact-gate`,
// spec `spec/artifact-re-gate`, design §2 and D8, D10, D31): the pure line diff
// a scoped re-gate prints its hunks from.
//
// The contract these tests pin, so the implementer reads one place:
//
//   diffLines(snapshotLines, currentLines) -> { added, removed, hunks }
//     `added` and `removed` are line counts. Each hunk is
//       { current:  { from, to } | null,   // 1-based, inclusive, CHANGED lines only
//         snapshot: { from, to } | null,   // the same, in the snapshot
//         after:         number | null,    // set when `current` is null: the current line the
//                                          //   removal follows (0 = "before line 1")
//         snapshotAfter: number | null,    // set when `snapshot` is null, likewise
//         lines: [{ kind: 'context' | 'added' | 'removed', text }] }
//     Up to two context lines on each side; hunks whose contexts touch merge.
//
//   reworkShare({ added, removed, before, after }) -> whole percent
//     round(100 x max(added, removed) / max(before, after)); 0 when both totals are 0.
//
// Every test fails until task 2.1 lands the module.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as lineDiff from '../../lib/line-diff.mjs'

const diffLines = (...args) => lineDiff.diffLines(...args)
const reworkShare = (...args) => lineDiff.reworkShare(...args)

/** `n` numbered lines: `L1` … `Ln`. */
const numbered = n => Array.from({ length: n }, (_, i) => `L${i + 1}`)

/** `base` with the 1-based inclusive range `from..to` replaced by `replacement`. */
const replaceRange = (base, from, to, replacement) => [...base.slice(0, from - 1), ...replacement, ...base.slice(to)]

const kinds = hunk => hunk.lines.map(l => l.kind)
const texts = (hunk, kind) => hunk.lines.filter(l => l.kind === kind).map(l => l.text)

test('an identical pair gives no hunk and no counts', () => {
  const same = numbered(20)
  const r = diffLines(same, [...same])
  assert.deepEqual(r.hunks, [])
  assert.equal(r.added, 0)
  assert.equal(r.removed, 0)
})

test('two empty sides give no hunk', () => {
  const r = diffLines([], [])
  assert.deepEqual(r.hunks, [])
  assert.equal(r.added, 0)
  assert.equal(r.removed, 0)
})

test('rewriting lines 40-44 names 40-44 as the changed range and prints 38-46', () => {
  const before = numbered(60)
  const after = replaceRange(before, 40, 44, ['N40', 'N41', 'N42', 'N43', 'N44'])
  const r = diffLines(before, after)
  assert.equal(r.hunks.length, 1)
  const [h] = r.hunks
  assert.deepEqual(h.current, { from: 40, to: 44 })
  assert.deepEqual(h.snapshot, { from: 40, to: 44 })
  assert.equal(r.added, 5)
  assert.equal(r.removed, 5)
  // The context is two lines either side, printed, and outside the named range.
  assert.deepEqual(texts(h, 'context'), ['L38', 'L39', 'L45', 'L46'])
  assert.deepEqual(texts(h, 'removed'), ['L40', 'L41', 'L42', 'L43', 'L44'])
  assert.deepEqual(texts(h, 'added'), ['N40', 'N41', 'N42', 'N43', 'N44'])
  assert.equal(h.lines.length, 4 + 5 + 5)
  assert.deepEqual(kinds(h).slice(0, 2), ['context', 'context'], 'the leading context comes first')
  assert.deepEqual(kinds(h).slice(-2), ['context', 'context'], 'the trailing context comes last')
})

test('a change near either end of the file has only the context that exists', () => {
  const before = numbered(10)
  const head = diffLines(before, replaceRange(before, 1, 1, ['X']))
  assert.deepEqual(head.hunks[0].current, { from: 1, to: 1 })
  assert.deepEqual(texts(head.hunks[0], 'context'), ['L2', 'L3'])
  const tail = diffLines(before, replaceRange(before, 10, 10, ['X']))
  assert.deepEqual(tail.hunks[0].current, { from: 10, to: 10 })
  assert.deepEqual(texts(tail.hunks[0], 'context'), ['L8', 'L9'])
})

test('two edits whose contexts touch merge into one hunk, and a gap of five keeps them apart', () => {
  const before = numbered(40)
  // Edits at 10 and 14: contexts 11-12 and 12-13 overlap, so one hunk.
  const near = replaceRange(replaceRange(before, 10, 10, ['A']), 14, 14, ['B'])
  const merged = diffLines(before, near)
  assert.equal(merged.hunks.length, 1)
  assert.equal(merged.added, 2)
  assert.equal(merged.removed, 2)
  assert.deepEqual(merged.hunks[0].current, { from: 10, to: 14 }, 'the merged range spans both edits')
  assert.ok(texts(merged.hunks[0], 'context').includes('L12'), 'the lines between are printed as context')
  // Edits at 10 and 20 are far apart.
  const far = replaceRange(replaceRange(before, 10, 10, ['A']), 20, 20, ['B'])
  const apart = diffLines(before, far)
  assert.equal(apart.hunks.length, 2)
  assert.deepEqual(apart.hunks.map(h => h.current), [{ from: 10, to: 10 }, { from: 20, to: 20 }])
})

test('an insertion names only the added lines and a null snapshot range, after the snapshot line it follows', () => {
  const before = numbered(20)
  const after = [...before.slice(0, 7), 'NEW-A', 'NEW-B', ...before.slice(7)]
  const r = diffLines(before, after)
  assert.equal(r.hunks.length, 1)
  const [h] = r.hunks
  assert.deepEqual(h.current, { from: 8, to: 9 })
  assert.equal(h.snapshot, null)
  assert.equal(h.snapshotAfter, 7)
  assert.equal(r.added, 2)
  assert.equal(r.removed, 0)
})

test('a pure removal names the snapshot lines and the current line it follows (D31)', () => {
  const before = numbered(30)
  const after = replaceRange(before, 10, 12, [])
  const r = diffLines(before, after)
  assert.equal(r.hunks.length, 1)
  const [h] = r.hunks
  assert.deepEqual(h.snapshot, { from: 10, to: 12 })
  assert.equal(h.current, null)
  assert.equal(h.after, 9, 'the removal follows current line 9')
  assert.equal(r.removed, 3)
  assert.equal(r.added, 0)
  assert.deepEqual(texts(h, 'removed'), ['L10', 'L11', 'L12'])
})

test('a removal at the very top follows no line, which reads as before line 1', () => {
  const r = diffLines(numbered(10), numbered(10).slice(2))
  assert.equal(r.hunks[0].current, null)
  assert.equal(r.hunks[0].after, 0)
  assert.deepEqual(r.hunks[0].snapshot, { from: 1, to: 2 })
})

test('a whole-file addition is one hunk of added lines', () => {
  const r = diffLines([], ['a', 'b', 'c'])
  assert.equal(r.hunks.length, 1)
  assert.deepEqual(r.hunks[0].current, { from: 1, to: 3 })
  assert.equal(r.hunks[0].snapshot, null)
  assert.deepEqual(texts(r.hunks[0], 'added'), ['a', 'b', 'c'])
  assert.equal(r.hunks[0].lines.length, 3, 'no context exists')
  assert.equal(r.added, 3)
  assert.equal(r.removed, 0)
})

test('a whole-file removal is one hunk of removed lines', () => {
  const r = diffLines(['a', 'b', 'c'], [])
  assert.equal(r.hunks.length, 1)
  assert.deepEqual(r.hunks[0].snapshot, { from: 1, to: 3 })
  assert.equal(r.hunks[0].current, null)
  assert.equal(r.hunks[0].after, 0)
  assert.deepEqual(texts(r.hunks[0], 'removed'), ['a', 'b', 'c'])
  assert.equal(r.removed, 3)
  assert.equal(r.added, 0)
})

test('the diff is minimal on a moved-down block: lines kept are context or untouched, never re-added', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const after = ['a', 'b', 'x', 'c', 'd', 'e', 'f', 'g', 'h']
  const r = diffLines(before, after)
  assert.equal(r.added, 1)
  assert.equal(r.removed, 0)
})

test('a replace merged with a removal across kept lines spans both edits on each side (M10)', () => {
  const before = numbered(12)
  // Line 2 replaced, lines 3-4 kept, line 5 removed: one hunk.
  const after = ['L1', 'X2', 'L3', 'L4', ...before.slice(5)]
  const r = diffLines(before, after)
  assert.equal(r.hunks.length, 1)
  const [h] = r.hunks
  assert.deepEqual(h.current, { from: 2, to: 4 }, 'the current range reaches the line the removal of L5 follows')
  assert.deepEqual(h.snapshot, { from: 2, to: 5 }, 'the snapshot range includes the removed L5')
  assert.equal(r.added, 1)
  assert.equal(r.removed, 2)
  assert.deepEqual(texts(h, 'removed'), ['L2', 'L5'])
  assert.deepEqual(texts(h, 'added'), ['X2'])
})

test('two removals merged across kept lines are not one contiguous pure removal (M10)', () => {
  const before = numbered(12)
  // Lines 2 and 5 removed, lines 3-4 kept: one hunk, and lines 3-4 still exist.
  const after = ['L1', 'L3', 'L4', ...before.slice(5)]
  const r = diffLines(before, after)
  assert.equal(r.hunks.length, 1)
  const [h] = r.hunks
  assert.deepEqual(h.current, { from: 2, to: 3 }, 'the kept L3-L4 between the removals are current lines 2-3')
  assert.equal(h.after, null, 'a hunk with a current range is not placed after a line')
  assert.deepEqual(h.snapshot, { from: 2, to: 5 })
  assert.equal(r.added, 0)
  assert.equal(r.removed, 2)
  assert.deepEqual(texts(h, 'removed'), ['L2', 'L5'])
})

// --- the rework share ----------------------------------------------------------

test('the rework share of 400 -> 410 lines with 20 added and 10 removed reads 5', () => {
  assert.equal(reworkShare({ added: 20, removed: 10, before: 400, after: 410 }), 5)
})

test('the share is the larger of added and removed over the larger total, so an append of 10 to 100 reads 9', () => {
  assert.equal(reworkShare({ added: 10, removed: 0, before: 100, after: 110 }), 9)
  assert.equal(reworkShare({ added: 10, removed: 10, before: 100, after: 100 }), 10)
})

test('both totals 0 reads 0, and deleting everything reads 100', () => {
  assert.equal(reworkShare({ added: 0, removed: 0, before: 0, after: 0 }), 0)
  assert.equal(reworkShare({ added: 0, removed: 100, before: 100, after: 0 }), 100)
})
