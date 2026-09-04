// The two deterministic path readers behind the receipt's touched and predicted
// sets.
//
// Every test here is really one assertion in two halves: the reader observed the
// set, or it did not — and a failed read is `null` with a reason, never `[]`.
// `[]` is a measured zero, and the indicator these feed is the one place in the
// report where a measured zero and an absent measurement would be read
// identically and mean opposite things.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTouchedPaths, readPredictedPaths, formatPathSet } from '../../lib/run-paths.mjs'
import { PLAN_PATH } from '../../lib/plan-fingerprint.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-run-paths-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const git = (dir, args) =>
  spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid'
    }
  })

/** A repository with one commit touching the named files. Returns its sha. */
function repoWithCommit(dir, files) {
  git(dir, ['init', '-q', '-b', 'main'])
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'test commit'])
  return git(dir, ['rev-parse', 'HEAD']).stdout.trim()
}

/** A plan in the shape `planWaves` emits: waves → batches → lanes → tasks. */
function planOf(tasks, over = {}) {
  return { waves: [{ group: 1, batches: [[tasks]] }], testWave: null, ...over }
}

// --- touched paths -----------------------------------------------------------

test('a real commit yields the repository-relative paths it touched', () => {
  const sha = repoWithCommit(tmp, {
    'lib/widget.mjs': 'export const a = 1\n',
    'test/widget.test.mjs': 'test\n'
  })
  const result = readTouchedPaths(tmp, sha)

  assert.equal(result.observed, true)
  assert.deepEqual(result.paths.sort(), ['lib/widget.mjs', 'test/widget.test.mjs'])
  assert.equal(result.reason, null)
  assert.equal(result.commit, sha)
})

test('a missing commit identifier is unobserved with a reason, not an empty set', () => {
  repoWithCommit(tmp, { 'a.txt': 'a\n' })
  for (const absent of [undefined, null, '', '   ']) {
    const result = readTouchedPaths(tmp, absent)
    assert.equal(result.observed, false)
    assert.equal(result.paths, null, 'an absent identifier never yields []')
    assert.match(result.reason, /no commit identifier/)
  }
})

test('an identifier git could not be trusted with is rejected before git sees it', () => {
  repoWithCommit(tmp, { 'a.txt': 'a\n' })
  const result = readTouchedPaths(tmp, '--output=/tmp/pwned')

  assert.equal(result.observed, false)
  assert.equal(result.paths, null)
  assert.match(result.reason, /not a usable git object name/)
})

test('a root that is not a repository is unobserved, never a crash', () => {
  const result = readTouchedPaths(tmp, 'a'.repeat(40))
  assert.equal(result.observed, false)
  assert.equal(result.paths, null)
  assert.match(result.reason, /could not be read from git/)
})

test('a commit git has never seen is unobserved rather than partial', () => {
  repoWithCommit(tmp, { 'a.txt': 'a\n' })
  const result = readTouchedPaths(tmp, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')

  assert.equal(result.observed, false)
  assert.equal(result.paths, null)
  assert.match(result.reason, /could not be read from git/)
})

test('a commit that genuinely touched nothing is observed and empty', () => {
  git(tmp, ['init', '-q', '-b', 'main'])
  git(tmp, ['commit', '-q', '--allow-empty', '-m', 'empty'])
  const sha = git(tmp, ['rev-parse', 'HEAD']).stdout.trim()
  const result = readTouchedPaths(tmp, sha)

  assert.equal(result.observed, true, 'an empty commit was measured, not missed')
  assert.deepEqual(result.paths, [])
})

// --- predicted paths ---------------------------------------------------------

test('a plan whose every task declared paths yields a complete union', () => {
  const result = readPredictedPaths(tmp, {
    plan: planOf([
      { id: '1.1', paths: ['lib/a.mjs', 'lib/b.mjs'] },
      { id: '1.2', paths: ['lib/b.mjs', 'test/b.test.mjs'] }
    ])
  })

  assert.equal(result.observed, true)
  assert.deepEqual(result.paths, ['lib/a.mjs', 'lib/b.mjs', 'test/b.test.mjs'], 'a union, deduplicated')
  assert.equal(result.complete, true)
  assert.equal(result.reason, null)
  assert.equal(result.tasks, 2)
  assert.equal(result.predicting, 2)
})

test('one silent task makes the whole prediction incomplete, and says how many', () => {
  const result = readPredictedPaths(tmp, {
    plan: planOf([
      { id: '1.1', paths: ['lib/a.mjs'] },
      { id: '1.2', paths: ['lib/b.mjs'] },
      { id: '1.3' },
      { id: '1.4', paths: [] }
    ])
  })

  assert.equal(result.observed, true)
  assert.deepEqual(result.paths, ['lib/a.mjs', 'lib/b.mjs'], 'what was declared is still carried')
  assert.equal(result.complete, false, 'a declined prediction is not a prediction of nothing')
  assert.match(result.reason, /2 of 4 executed task\(s\) declared no paths/)
  assert.equal(result.predicting, 2)
})

test('a plan with no tasks predicted nothing, and is reported incomplete rather than clean', () => {
  const result = readPredictedPaths(tmp, { plan: planOf([]) })
  assert.equal(result.observed, true)
  assert.deepEqual(result.paths, [])
  assert.equal(result.complete, false)
  assert.match(result.reason, /declares no tasks/)
})

test('the test wave counts as executed plan too', () => {
  const result = readPredictedPaths(tmp, {
    plan: planOf([{ id: '1.1', paths: ['lib/a.mjs'] }], {
      testWave: { kind: 'test', group: null, batches: [[[{ id: '4.1', paths: ['test/a.test.mjs'] }]]] }
    })
  })
  assert.deepEqual(result.paths, ['lib/a.mjs', 'test/a.test.mjs'])
  assert.equal(result.complete, true)
})

test('an absent plan file is unobserved in both the set and its completeness', () => {
  const result = readPredictedPaths(tmp)
  assert.equal(result.observed, false)
  assert.equal(result.paths, null, 'an unread plan predicted nothing we know of')
  assert.equal(result.complete, null, 'and its completeness is unknown, not false')
  assert.match(result.reason, /no executed plan was found/)
})

test('an unparseable plan file is unobserved with the parse failure named', () => {
  mkdirSync(join(tmp, '.claude', 'ship'), { recursive: true })
  writeFileSync(join(tmp, PLAN_PATH), '{ not json')
  const result = readPredictedPaths(tmp)

  assert.equal(result.observed, false)
  assert.equal(result.paths, null)
  assert.equal(result.complete, null)
  assert.match(result.reason, /could not be read/)
})

test('a plan read off disk is walked the same way as one handed in', () => {
  mkdirSync(join(tmp, '.claude', 'ship'), { recursive: true })
  writeFileSync(join(tmp, PLAN_PATH), JSON.stringify(planOf([{ id: '1.1', paths: ['lib/a.mjs'] }])))
  const result = readPredictedPaths(tmp)

  assert.equal(result.observed, true)
  assert.deepEqual(result.paths, ['lib/a.mjs'])
  assert.equal(result.complete, true)
})

test('neither reader ever throws, whatever it is handed', () => {
  for (const call of [
    () => readTouchedPaths(null, null),
    () => readTouchedPaths(undefined, { sha: 'x' }),
    () => readPredictedPaths(null),
    () => readPredictedPaths(tmp, { plan: 'not an object' }),
    () => readPredictedPaths(tmp, { plan: [] })
  ]) {
    const result = call()
    assert.equal(result.observed, false)
    assert.equal(result.paths, null)
    assert.ok(result.reason, 'every unobserved result carries its reason')
  }
})

test('the rendering says unobserved out loud and never prints an empty list', () => {
  const missing = formatPathSet('paths touched', readPredictedPaths(tmp))
  assert.match(missing, /UNOBSERVED: no executed plan was found/)
  assert.doesNotMatch(missing, /\[\]/)

  const observed = formatPathSet(
    'paths predicted',
    readPredictedPaths(tmp, { plan: planOf([{ id: '1.1', paths: ['lib/a.mjs'] }]) })
  )
  assert.match(observed, /1 path\(s\) observed/)
  assert.match(observed, /every executed task declared its paths/)
})
