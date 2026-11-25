// `lib/artifact-snapshot.mjs` (change `scope-suggest-and-evaluate-the-artifact-gate`,
// spec `spec/artifact-re-gate`, design §1-§2): the pure parts. The gate's I/O
// helper `snapshotForGate` is pinned through the CLI in gate-snapshot.test.mjs.
//
// The contract these tests pin:
//
//   ARTIFACT_SNAPSHOT_SCHEMA                      'interlock.artifact-snapshot/1'
//   buildSnapshot({ change, findings, files, takenAt? })
//       files: [{ path, text }]  ->  { schema, change, findings, takenAt,
//                                      files: [{ path, sha256, text }] }
//   readSnapshot(text, change)  ->  { ok: true, snapshot }  |  { ok: false, reason }
//   compareSnapshot(snapshot, files) where files is [{ path, text }]  ->
//       { changed:      [{ path, hunks }],       // present in both, differing
//         addedFiles:   [{ path, hunks }],       // only now; the whole text is one hunk
//         removedFiles: [{ path, hunks }],       // only in the snapshot
//         unchanged:    [path],
//         linesAdded, linesRemoved, linesBefore, linesAfter, changedFiles, share }
//
// A text's lines are its '\n'-separated lines, a trailing newline not counting
// as one more. Every test fails until task 2.1 lands the module.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as snap from '../../lib/artifact-snapshot.mjs'

const sha = text => createHash('sha256').update(text).digest('hex')
const body = n => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

const FILES = [
  { path: 'proposal.md', text: '# Proposal\n\nWhy.\n' },
  { path: 'design.md', text: body(60) },
  { path: 'tasks.md', text: '# Tasks\n' },
  { path: 'specs/a/spec.md', text: '## ADDED Requirements\n' }
]

const build = (over = {}) =>
  snap.buildSnapshot({ change: 'x', findings: 'review-artifacts-x-20261125-120000.json', files: FILES, takenAt: '2026-11-25T12:00:00.000Z', ...over })

test('the schema id is interlock.artifact-snapshot/1', () => {
  assert.equal(snap.ARTIFACT_SNAPSHOT_SCHEMA, 'interlock.artifact-snapshot/1')
})

test('a built payload carries the schema, the change, the findings name and each file with its SHA-256 and text', () => {
  const p = build()
  assert.equal(p.schema, 'interlock.artifact-snapshot/1')
  assert.equal(p.change, 'x')
  assert.equal(p.findings, 'review-artifacts-x-20261125-120000.json')
  assert.equal(p.takenAt, '2026-11-25T12:00:00.000Z')
  assert.deepEqual(
    p.files.map(f => f.path),
    FILES.map(f => f.path)
  )
  for (const [i, f] of p.files.entries()) {
    assert.equal(f.text, FILES[i].text, 'the text is copied whole, not only hashed')
    assert.equal(f.sha256, sha(FILES[i].text))
  }
})

test('a built payload stamps takenAt as an ISO time when none is given', () => {
  const p = snap.buildSnapshot({ change: 'x', findings: 'f.json', files: FILES })
  assert.match(p.takenAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
})

// --- reading it back -------------------------------------------------------------

test('a payload read back answers ok with the snapshot', () => {
  const r = snap.readSnapshot(JSON.stringify(build()), 'x')
  assert.equal(r.ok, true)
  assert.equal(r.snapshot.change, 'x')
  assert.equal(r.snapshot.files.length, 4)
})

test('unparseable text answers a reason and no snapshot', () => {
  for (const text of ['not json', '', '{"schema":', 'null', '[]']) {
    const r = snap.readSnapshot(text, 'x')
    assert.equal(r.ok, false, JSON.stringify(text))
    assert.equal(typeof r.reason, 'string')
    assert.ok(r.reason.length > 0)
    assert.equal(r.snapshot, undefined)
  }
})

test('another schema answers a reason that names the schema it found', () => {
  const r = snap.readSnapshot(JSON.stringify({ ...build(), schema: 'interlock.artifact-snapshot/2' }), 'x')
  assert.equal(r.ok, false)
  assert.ok(r.reason.includes('interlock.artifact-snapshot/2'), r.reason)
})

test('a snapshot of another change answers a reason naming that change', () => {
  const r = snap.readSnapshot(JSON.stringify(build({ change: 'y' })), 'x')
  assert.equal(r.ok, false)
  assert.ok(r.reason.includes('y'), r.reason)
})

test('a payload whose files are not a list of path and text is unreadable', () => {
  const r = snap.readSnapshot(JSON.stringify({ ...build(), files: 'nope' }), 'x')
  assert.equal(r.ok, false)
  assert.ok(r.reason.length > 0)
})

// --- comparing it with the current files ----------------------------------------

const compare = (current, snapshot = build()) => snap.compareSnapshot(snapshot, current)

test('an identical change has no hunk, no change and every file unchanged, with a share of 0', () => {
  const r = compare(FILES)
  assert.deepEqual(r.changed, [])
  assert.deepEqual(r.addedFiles, [])
  assert.deepEqual(r.removedFiles, [])
  assert.deepEqual([...r.unchanged].sort(), FILES.map(f => f.path).sort())
  assert.equal(r.linesAdded, 0)
  assert.equal(r.linesRemoved, 0)
  assert.equal(r.changedFiles, 0)
  assert.equal(r.share, 0)
})

test('one edited section gives one hunk for that file and the other three files unchanged', () => {
  const lines = body(60).split('\n').slice(0, 60)
  lines.splice(39, 5, 'new 40', 'new 41', 'new 42', 'new 43', 'new 44')
  const current = FILES.map(f => (f.path === 'design.md' ? { ...f, text: lines.join('\n') + '\n' } : f))
  const r = compare(current)
  assert.equal(r.changed.length, 1)
  assert.equal(r.changed[0].path, 'design.md')
  assert.equal(r.changed[0].hunks.length, 1)
  assert.deepEqual(r.changed[0].hunks[0].current, { from: 40, to: 44 })
  assert.deepEqual([...r.unchanged].sort(), ['proposal.md', 'specs/a/spec.md', 'tasks.md'])
  assert.equal(r.linesAdded, 5)
  assert.equal(r.linesRemoved, 5)
  assert.equal(r.changedFiles, 1)
})

test('the share sums over the files: 60 + 3 + 1 + 1 lines before, 5 rewritten, reads round(100 x 5 / 65)', () => {
  const lines = body(60).split('\n').slice(0, 60)
  lines.splice(39, 5, 'n1', 'n2', 'n3', 'n4', 'n5')
  const current = FILES.map(f => (f.path === 'design.md' ? { ...f, text: lines.join('\n') + '\n' } : f))
  const r = compare(current)
  assert.equal(r.linesBefore, 65)
  assert.equal(r.linesAfter, 65)
  assert.equal(r.share, Math.round((100 * 5) / 65))
})

test('a file only in the change is added, its whole text one hunk; a file only in the snapshot is removed', () => {
  const current = [...FILES.filter(f => f.path !== 'tasks.md'), { path: 'specs/b/spec.md', text: 'one\ntwo\n' }]
  const r = compare(current)
  assert.deepEqual(r.addedFiles.map(f => f.path), ['specs/b/spec.md'])
  assert.equal(r.addedFiles[0].hunks.length, 1)
  assert.deepEqual(r.addedFiles[0].hunks[0].current, { from: 1, to: 2 })
  assert.deepEqual(r.removedFiles.map(f => f.path), ['tasks.md'])
  assert.equal(r.changedFiles, 2, 'an added and a removed file each count as a changed file')
  assert.equal(r.linesAdded, 2)
  assert.equal(r.linesRemoved, 1)
})

test('deleting every line reads a share of 100', () => {
  const r = compare([])
  assert.equal(r.share, 100)
  assert.equal(r.removedFiles.length, FILES.length)
})
