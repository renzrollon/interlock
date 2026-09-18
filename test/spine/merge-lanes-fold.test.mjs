// The plumbing half of `merge-lanes`, exercised over real git worktrees.
//
// `merge-lanes.test.mjs` covers the pure decision; this file covers the step
// between git and that decision — the one that used to drop a rename's source
// before contention was checked. A lane that renames `lib/a.mjs` away and a
// lane that edits `lib/a.mjs` are not disjoint, however git spells the rows:
// the fold deletes that source, so whichever lane applied last decided whether
// the edit survived. That is the last-writer-wins outcome the command exists to
// refuse, and no unit test over `mergeDecision` can see it, because the defect
// was in what the caller handed it.
//
// Exit status is the load-bearing assertion, the same as `cli.test.mjs`: a
// collision that prints HALT and exits 0 is a collision the workflow folds
// straight through.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'interlock')

// Identity comes from the environment, so the suite never depends on whatever
// the developer running it has configured — and never writes their name into a
// fixture commit.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

// Four distinct lines so rename detection has real content to match on: a
// one-byte file is similar to every other one-byte file.
const A_BODY = 'export const one = 1\nexport const two = 2\nexport const three = 3\nexport const four = 4\n'
const C_BODY = 'export const c = "untouched by lane A"\n'

let dir

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-fold-'))
})

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

/** A shared tree holding `lib/a.mjs` and `lib/c.mjs`, plus the base commit. */
function baseRepo(name) {
  const root = join(dir, name)
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib', 'a.mjs'), A_BODY)
  writeFileSync(join(root, 'lib', 'c.mjs'), C_BODY)
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'base'])
  return { root, name, base: git(root, ['rev-parse', 'HEAD']) }
}

/** One lane worktree off the base commit, outside the shared tree. */
function laneWorktree(repo, label) {
  const path = join(dir, `${repo.name}-lane-${label}`)
  git(repo.root, ['worktree', 'add', '-q', '-b', `lane-${repo.name}-${label}`, path, repo.base])
  return path
}

/** The real binary, with the lane manifest written where `--lanes` can read it. */
function mergeLanes(repo, lanes) {
  const manifest = join(dir, `${repo.name}-lanes.json`)
  writeFileSync(manifest, JSON.stringify(lanes))
  const r = spawnSync(
    process.execPath,
    [BIN, 'merge-lanes', '--base', repo.base, '--lanes', manifest, '--root', repo.root, '--json'],
    { cwd: repo.root, encoding: 'utf8', env: GIT_ENV }
  )
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  let json
  assert.doesNotThrow(() => {
    json = JSON.parse(r.stdout)
  }, `merge-lanes --json emitted unparseable output:\n${r.stdout}\n${r.stderr}`)
  return { code: r.status, json, stderr: r.stderr }
}

test('a lane renaming a path another lane edited halts, naming that source and both lanes', () => {
  const repo = baseRepo('rename-vs-edit')
  const wtA = laneWorktree(repo, 'A')
  const wtB = laneWorktree(repo, 'B')

  git(wtA, ['mv', 'lib/a.mjs', 'lib/b.mjs'])
  writeFileSync(join(wtB, 'lib', 'a.mjs'), `${A_BODY}export const five = 5\n`)

  const result = mergeLanes(repo, [
    { label: 'A', worktreePath: wtA },
    { label: 'B', worktreePath: wtB }
  ])

  assert.notEqual(result.code, 0, 'a collision is an exit code, not a sentence')
  assert.equal(result.json.status, 'collision')
  assert.deepEqual(
    result.json.collisions,
    [{ canonicalPath: 'lib/a.mjs', lanes: ['A', 'B'] }],
    'the rename SOURCE is the contended path — keyed on lib/b.mjs alone these lanes look disjoint'
  )

  // A halt touches nothing: the shared tree is exactly the base commit, and
  // both worktrees are still on disk for a human to read.
  assert.equal(readFileSync(join(repo.root, 'lib', 'a.mjs'), 'utf8'), A_BODY)
  assert.equal(existsSync(join(repo.root, 'lib', 'b.mjs')), false)
  assert.equal(git(repo.root, ['status', '--porcelain']), '')
  assert.deepEqual(
    result.json.survivingWorktrees.map(s => s.label).sort(),
    ['A', 'B'],
    'neither lane worktree is removed on a halt'
  )
})

test('a rename whose source nobody else touched folds cleanly', () => {
  const repo = baseRepo('rename-disjoint')
  const wtA = laneWorktree(repo, 'A')
  const wtB = laneWorktree(repo, 'B')

  git(wtA, ['mv', 'lib/a.mjs', 'lib/b.mjs'])
  writeFileSync(join(wtB, 'lib', 'c.mjs'), `${C_BODY}export const edited = true\n`)

  const result = mergeLanes(repo, [
    { label: 'A', worktreePath: wtA },
    { label: 'B', worktreePath: wtB }
  ])

  assert.equal(result.code, 0, `expected a clean fold, got ${JSON.stringify(result.json)}`)
  assert.equal(result.json.status, 'clean')
  assert.equal(existsSync(join(repo.root, 'lib', 'b.mjs')), true, 'the rename destination lands')
  assert.equal(existsSync(join(repo.root, 'lib', 'a.mjs')), false, 'and its source is deleted')
  assert.match(readFileSync(join(repo.root, 'lib', 'c.mjs'), 'utf8'), /export const edited = true/)
})

test('an edit of a file another lane copied does not halt the batch', () => {
  const repo = baseRepo('copy-vs-edit')
  const wtA = laneWorktree(repo, 'A')
  const wtB = laneWorktree(repo, 'B')

  // A copy leaves the source in place, which is why `applyLaneDiff` never
  // rmSync's it and why entering it as a contention key would halt a batch
  // that is genuinely disjoint.
  //
  // What this proves, exactly: git does NOT detect copies here, so `laneDiff`
  // reports `A lib/b.mjs` and lane A's mutation set is the destination alone.
  // That is the shape a real copy-then-add takes on the production path — a
  // `C` row needs `--find-copies-harder`, which `laneDiff` does not pass, and
  // even `diff.renames = copies` only finds copies whose source was modified in
  // the same diff. So the `C` branch of `foldMutationPaths` is defensive, and
  // it is pinned where it is reachable: the unit test in `merge-lanes.test.mjs`.
  // This case guards the outcome that matters end to end — an edit of a file
  // another lane copied does not halt the batch.
  copyFileSync(join(wtA, 'lib', 'a.mjs'), join(wtA, 'lib', 'b.mjs'))
  git(wtA, ['add', 'lib/b.mjs'])
  const editedA = `${A_BODY}export const five = 5\n`
  writeFileSync(join(wtB, 'lib', 'a.mjs'), editedA)

  const result = mergeLanes(repo, [
    { label: 'A', worktreePath: wtA },
    { label: 'B', worktreePath: wtB }
  ])

  assert.equal(result.code, 0, `expected a clean fold, got ${JSON.stringify(result.json)}`)
  assert.equal(result.json.status, 'clean')
  assert.deepEqual(result.json.collisions, [])
  assert.equal(readFileSync(join(repo.root, 'lib', 'a.mjs'), 'utf8'), editedA, "lane B's edit of the copy source survives")
  assert.equal(existsSync(join(repo.root, 'lib', 'b.mjs')), true, 'and the copy destination lands beside it')
})
