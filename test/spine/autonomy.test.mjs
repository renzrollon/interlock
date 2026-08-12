import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record, recordCleanFlow, promote, getLevel, getState } from '../../lib/autonomy.mjs'

// autonomy.mjs uses cwd-relative .claude/autonomy.json, so run in a temp cwd.
let origCwd
let tmp

before(() => {
  origCwd = process.cwd()
  tmp = mkdtempSync(join(tmpdir(), 'interlock-autonomy-'))
  process.chdir(tmp)
})

after(() => {
  process.chdir(origCwd)
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  const f = join(tmp, '.claude')
  if (existsSync(f)) rmSync(f, { recursive: true, force: true })
})

test('unknown path defaults to L2', () => {
  assert.equal(getLevel('never-seen'), 'L2')
})

test('a clean run increments runs and consecutive_clean, stays L2 below threshold', () => {
  const r1 = record('review-code', { blockers: 0 })
  assert.equal(r1.promoted, false)
  const st = getState()
  assert.equal(st['review-code'].runs, 1)
  assert.equal(st['review-code'].consecutive_clean, 1)
  assert.equal(st['review-code'].current_level, 'L2')
})

test('3 consecutive clean runs promote L2 -> L3', () => {
  record('review-code', { blockers: 0 })
  record('review-code', { blockers: 0 })
  const third = record('review-code', { blockers: 0 })
  assert.equal(third.promoted, true)
  assert.equal(third.from, 'L2')
  assert.equal(third.to, 'L3')
  assert.equal(getLevel('review-code'), 'L3')
})

test('a blocker resets consecutive_clean and accrues blockers_caught', () => {
  record('review-code', { blockers: 0 })
  record('review-code', { blockers: 0 })
  record('review-code', { blockers: 2 })
  const st = getState()
  assert.equal(st['review-code'].consecutive_clean, 0)
  assert.equal(st['review-code'].blockers_caught, 2)
  assert.equal(st['review-code'].current_level, 'L2')
})

test('human_override demotes L3 -> L2 and resets the counter', () => {
  // promote to L3 first
  record('review-code', { blockers: 0 })
  record('review-code', { blockers: 0 })
  record('review-code', { blockers: 0 })
  assert.equal(getLevel('review-code'), 'L3')
  const r = record('review-code', { human_override: true })
  assert.equal(getLevel('review-code'), 'L2')
  const st = getState()
  assert.equal(st['review-code'].consecutive_clean, 0)
  assert.equal(st['review-code'].human_overrides, 1)
  assert.ok(st['review-code'].last_demoted_at)
})

test('transitive blame: a review-artifacts blocker resets upstream explore+spec and demotes their L3', () => {
  // Get upstreams to L3.
  recordCleanFlow(['explore', 'spec'])
  recordCleanFlow(['explore', 'spec'])
  recordCleanFlow(['explore', 'spec'])
  assert.equal(getLevel('explore'), 'L3')
  assert.equal(getLevel('spec'), 'L3')

  // A downstream blocker at review-artifacts blames both upstreams.
  record('review-artifacts', { blockers: 1 })
  const st = getState()
  assert.equal(st['explore'].consecutive_clean, 0)
  assert.equal(st['spec'].consecutive_clean, 0)
  assert.equal(getLevel('explore'), 'L2')
  assert.equal(getLevel('spec'), 'L2')
})

test('transitive blame: a review-code blocker resets ship but does not cascade to spec', () => {
  recordCleanFlow(['spec'])
  recordCleanFlow(['spec'])
  recordCleanFlow(['spec'])
  recordCleanFlow(['ship'])
  assert.equal(getLevel('spec'), 'L3')

  record('review-code', { blockers: 1 })
  const st = getState()
  assert.equal(st['ship'].consecutive_clean, 0, 'ship is blamed')
  // Blame is one hop: spec keeps its standing.
  assert.equal(st['spec'].consecutive_clean, 3, 'spec is not blamed transitively')
  assert.equal(getLevel('spec'), 'L3')
})

test('a root option isolates state to a given directory', () => {
  const other = mkdtempSync(join(tmpdir(), 'interlock-autonomy-root-'))
  record('review-code', { blockers: 0 }, { root: other })
  assert.equal(getLevel('review-code', { root: other }), 'L2')
  assert.equal(getState({ root: other })['review-code'].runs, 1)
  // The cwd-scoped store is untouched.
  assert.equal(getState()['review-code'], undefined)
  rmSync(other, { recursive: true, force: true })
})

test('recordCleanFlow batch-credits multiple paths and reports promotions', () => {
  recordCleanFlow(['a', 'b'])
  recordCleanFlow(['a', 'b'])
  const res = recordCleanFlow(['a', 'b'])
  // third clean flow promotes both
  assert.ok(res.every(r => r.promoted === true))
  assert.equal(getLevel('a'), 'L3')
  assert.equal(getLevel('b'), 'L3')
})

test('promote() on an unknown path reports no-entry', () => {
  assert.deepEqual(promote('ghost'), { promoted: false, reason: 'no-entry' })
})
