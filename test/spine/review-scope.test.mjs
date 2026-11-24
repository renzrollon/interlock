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

// --- a path git quotes: a non-ASCII filename (PR #46 review, F-5ef3344d and F-36861c89) ---------
//
// Git prints a path holding a byte it will not show bare as a C string under the default
// core.quotePath: `+++ "b/docs/\303\251 x.txt"`. The pre-existing check looks a finding's file up
// by its plain name, so the quotes and escapes must be undone before the ranges are keyed.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { headerPath } from '../../lib/review-scope.mjs'

const ACCENTED = 'docs/é x.txt'

test('quoted path: headerPath decodes the octal escapes of a non-ASCII name and drops the quotes and the side prefix', () => {
  assert.equal(headerPath('"b/docs/\\303\\251 x.txt"', 'b/'), ACCENTED)
  assert.equal(headerPath('"a/docs/\\303\\251 x.txt"', 'a/'), ACCENTED)
})

test('quoted path: headerPath decodes the C escapes, and reads a name git left bare inside the quotes whole', () => {
  assert.equal(headerPath('"b/a\\"b\\\\c.txt"', 'b/'), 'a"b\\c.txt')
  assert.equal(headerPath('"b/tab\\there.txt"', 'b/'), 'tab\there.txt')
  // core.quotePath=false leaves the accented letter bare, and a tab still makes git quote the name.
  assert.equal(headerPath('"b/é\\tx.txt"', 'b/'), 'é\tx.txt')
})

test('quoted path: a name with no quotes, and a quote that never closes, are kept as written', () => {
  assert.equal(headerPath('b/lib/a.mjs', 'b/'), 'lib/a.mjs')
  assert.equal(headerPath(`b/${ACCENTED}`, 'b/'), ACCENTED)
  assert.equal(headerPath('"b/open.txt', 'b/'), '"b/open.txt')
  assert.equal(headerPath('/dev/null', 'b/'), '/dev/null')
})

test('quoted path: changedRanges keys a quoted header, a quoted deletion and a bare non-ASCII header by the real name', () => {
  const quoted = ['diff --git "a/docs/\\303\\251 x.txt" "b/docs/\\303\\251 x.txt"', '--- "a/docs/\\303\\251 x.txt"', '+++ "b/docs/\\303\\251 x.txt"', '@@ -2 +2 @@', '-two', '+TWO'].join('\n')
  assert.deepEqual(changedRanges(quoted), [{ path: ACCENTED, ranges: [[2, 2]] }])
  const deleted = ['diff --git "a/\\303\\251.txt" "b/\\303\\251.txt"', '--- "a/\\303\\251.txt"', '+++ /dev/null', '@@ -1 +0,0 @@', '-gone'].join('\n')
  assert.deepEqual(changedRanges(deleted), [{ path: 'é.txt', ranges: [] }])
  const bare = ['diff --git a/docs/é x.txt b/docs/é x.txt', `--- a/${ACCENTED}`, `+++ b/${ACCENTED}`, '@@ -2 +2 @@', '-two', '+TWO'].join('\n')
  assert.deepEqual(changedRanges(bare), [{ path: ACCENTED, ranges: [[2, 2]] }])
})

test('quoted path: a real git diff of a non-ASCII filename gives the same path and ranges with core.quotePath on and off', () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-quoted-path-'))
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'no-global-config'),
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid'
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' })
  try {
    git('init', '-q')
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, ACCENTED), 'one\ntwo\nthree\n')
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(root, ACCENTED), 'one\nTWO\nthree\n')
    git('commit', '-q', '-am', 'head')
    const on = git('-c', 'core.quotePath=true', 'diff', '-U0', '--no-color', `${base}...HEAD`)
    assert.match(on, /\+\+\+ "b\/docs\/\\303\\251 x\.txt"/, 'precondition: git quoted the name')
    const off = git('-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', `${base}...HEAD`)
    assert.ok(off.includes(`+++ b/${ACCENTED}`), 'precondition: git left the name bare')
    for (const text of [on, off]) assert.deepEqual(changedRanges(text), [{ path: ACCENTED, ranges: [[2, 2]] }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('quoted path: the tab git ends a header with when the name holds a space is not part of the name', () => {
  assert.equal(headerPath('b/has space.txt\t', 'b/'), 'has space.txt')
  assert.equal(headerPath('"b/docs/\\303\\251 x.txt"\t', 'b/'), ACCENTED)
  const spaced = ['diff --git a/has space.txt b/has space.txt', '--- a/has space.txt\t', '+++ b/has space.txt\t', '@@ -1 +1 @@', '-a', '+A'].join('\n')
  assert.deepEqual(changedRanges(spaced), [{ path: 'has space.txt', ranges: [[1, 1]] }])
})
