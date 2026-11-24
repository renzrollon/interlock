// `lib/review-target.mjs` — pin a pull request from the platform's own document, offline
// (spec: review/pull-request-review, "`interlock review target` SHALL pin a pull request
// from the platform's own document, offline" and "... SHALL refuse a pull request it
// cannot pin"; design: "Shapes the tests and the implementation share").
//
// Written before the module exists. It is reached through a dynamic import inside a
// helper, so this file loads and each test fails on its own. Every test name starts
// with `pr review target:` because task 2.1 runs them by that prefix.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULE = 'lib/review-target.mjs'

const loadTarget = () => import('../../lib/review-target.mjs')

const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const OTHER_HEAD = 'c'.repeat(40)
const WORK = '/work/repo'

const githubDoc = (over = {}) => ({
  number: 44,
  url: 'https://github.com/owner/repo/pull/44',
  state: 'OPEN',
  isDraft: false,
  isCrossRepository: false,
  baseRefName: 'main',
  baseRefOid: BASE,
  headRefName: 'feat/x',
  headRefOid: HEAD,
  ...over
})

const gitlabDoc = (over = {}) => ({
  iid: 12,
  web_url: 'https://gitlab.com/owner/repo/-/merge_requests/12',
  state: 'opened',
  draft: false,
  source_project_id: 7,
  target_project_id: 7,
  target_branch: 'main',
  source_branch: 'feat/y',
  sha: HEAD,
  diff_refs: { base_sha: BASE, head_sha: HEAD, start_sha: BASE },
  ...over
})

/** The document without one key. */
function without(doc, key) {
  const copy = { ...doc }
  delete copy[key]
  return copy
}

async function github(doc, opts = {}) {
  const { targetFromGithub } = await loadTarget()
  return targetFromGithub(doc, { root: WORK, runCode: false, ...opts })
}

async function gitlab(doc, opts = {}) {
  const { targetFromGitlab } = await loadTarget()
  return targetFromGitlab(doc, { root: WORK, runCode: false, ...opts })
}

/** A refusal: `ok: false`, a reason that is text, and no target. */
function assertRefused(result, mention, label) {
  assert.equal(result.ok, false, `${label}: expected a refusal, got ${JSON.stringify(result)}`)
  assert.equal(typeof result.reason, 'string', label)
  assert.ok(result.reason.length > 0, `${label}: the reason is empty`)
  assert.equal(result.target, undefined, `${label}: a refusal returns no target`)
  if (mention) assert.match(result.reason, mention, `${label}: ${result.reason}`)
}

// --- the field mapping, both platforms -----------------------------------------

test('pr review target: a GitHub document maps field for field onto the target the design shows', async () => {
  const r = await github(githubDoc())
  assert.equal(r.ok, true, JSON.stringify(r))
  const short = HEAD.slice(0, 12)
  const dir = `.claude/ship/review-pr/github-44-${short}`
  const worktree = `${WORK}/.claude/worktrees/review-pr-github-44-${short}`
  assert.deepEqual(r.target, {
    platform: 'github',
    number: 44,
    url: 'https://github.com/owner/repo/pull/44',
    draft: false,
    base: { ref: 'main', sha: BASE },
    head: { ref: 'feat/x', sha: HEAD },
    runCode: false,
    dir,
    file: `${dir}/target.json`,
    worktree,
    commands: {
      fetch: ['git', 'fetch', 'origin', 'refs/heads/main', 'refs/pull/44/head'],
      worktreeAdd: ['git', 'worktree', 'add', '--detach', worktree, HEAD],
      changed: ['git', '-C', worktree, 'diff', '--name-only', `${BASE}...HEAD`],
      worktreeRemove: ['git', 'worktree', 'remove', '--force', worktree]
    }
  })
})

test('pr review target: a GitLab document maps iid, sha and diff_refs.base_sha, and fetches the pull request ref in full', async () => {
  const r = await gitlab(gitlabDoc())
  assert.equal(r.ok, true, JSON.stringify(r))
  const short = HEAD.slice(0, 12)
  const dir = `.claude/ship/review-pr/gitlab-12-${short}`
  const worktree = `${WORK}/.claude/worktrees/review-pr-gitlab-12-${short}`
  assert.deepEqual(r.target, {
    platform: 'gitlab',
    number: 12,
    url: 'https://gitlab.com/owner/repo/-/merge_requests/12',
    draft: false,
    base: { ref: 'main', sha: BASE },
    head: { ref: 'feat/y', sha: HEAD },
    runCode: false,
    dir,
    file: `${dir}/target.json`,
    worktree,
    commands: {
      fetch: ['git', 'fetch', 'origin', 'refs/heads/main', 'refs/merge-requests/12/head'],
      worktreeAdd: ['git', 'worktree', 'add', '--detach', worktree, HEAD],
      changed: ['git', '-C', worktree, 'diff', '--name-only', `${BASE}...HEAD`],
      worktreeRemove: ['git', 'worktree', 'remove', '--force', worktree]
    }
  })
})

test('pr review target: the GitLab base is diff_refs.base_sha, never start_sha or head_sha', async () => {
  const start = 'd'.repeat(40)
  const r = await gitlab(gitlabDoc({ diff_refs: { base_sha: BASE, head_sha: OTHER_HEAD, start_sha: start } }))
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.target.base.sha, BASE)
  assert.equal(r.target.head.sha, HEAD, 'the head is the document\'s own `sha`')
})

// --- runCode and the places ----------------------------------------------------

test('pr review target: runCode is true and false with every other field equal', async () => {
  for (const [name, read, doc] of [
    ['github', github, githubDoc()],
    ['gitlab', gitlab, gitlabDoc()]
  ]) {
    const off = await read(doc, { runCode: false })
    const on = await read(doc, { runCode: true })
    assert.equal(off.ok && on.ok, true, name)
    assert.equal(off.target.runCode, false, name)
    assert.equal(on.target.runCode, true, name)
    assert.deepEqual({ ...on.target, runCode: false }, off.target, `${name}: only runCode differs`)
  }
})

test('pr review target: two heads give two session directories and two worktrees, and one head gives the same two again', async () => {
  const first = await github(githubDoc())
  const second = await github(githubDoc({ headRefOid: OTHER_HEAD }))
  const again = await github(githubDoc())
  assert.equal(first.ok && second.ok && again.ok, true)
  assert.notEqual(first.target.dir, second.target.dir)
  assert.notEqual(first.target.worktree, second.target.worktree)
  assert.equal(again.target.dir, first.target.dir)
  assert.equal(again.target.worktree, first.target.worktree)
  assert.ok(first.target.dir.endsWith(HEAD.slice(0, 12)), first.target.dir)
  assert.ok(second.target.worktree.endsWith(OTHER_HEAD.slice(0, 12)), second.target.worktree)
})

test('pr review target: the exported places are the two directories the design names', async () => {
  const { REVIEW_PR_DIR, REVIEW_PR_WORKTREES } = await loadTarget()
  assert.equal(REVIEW_PR_DIR, '.claude/ship/review-pr')
  assert.equal(REVIEW_PR_WORKTREES, '.claude/worktrees')
})

// --- what is refused -----------------------------------------------------------

test('pr review target: a fork is refused on each platform, naming the pull request', async () => {
  assertRefused(await github(githubDoc({ isCrossRepository: true })), /fork/i, 'github fork')
  assertRefused(await gitlab(gitlabDoc({ source_project_id: 9 })), /fork/i, 'gitlab fork')
  const named = await github(githubDoc({ isCrossRepository: true }))
  assert.match(named.reason, /44/, 'the reason names the pull request')
})

test('pr review target: a state that is not open is refused naming the state', async () => {
  assertRefused(await github(githubDoc({ state: 'MERGED' })), /MERGED/, 'github merged')
  assertRefused(await github(githubDoc({ state: 'CLOSED' })), /CLOSED/, 'github closed')
  assertRefused(await gitlab(gitlabDoc({ state: 'merged' })), /merged/, 'gitlab merged')
  assertRefused(await gitlab(gitlabDoc({ state: 'closed' })), /closed/, 'gitlab closed')
})

test('pr review target: a document that does not say whether it is a fork is refused naming the field, never read as same-repository', async () => {
  assertRefused(await github(without(githubDoc(), 'isCrossRepository')), /isCrossRepository/, 'github')
  assertRefused(await gitlab(without(gitlabDoc(), 'source_project_id')), /source_project_id/, 'gitlab source')
  assertRefused(await gitlab(without(gitlabDoc(), 'target_project_id')), /target_project_id/, 'gitlab target')
})

test('pr review target: a document missing any field the command reads is refused naming it', async () => {
  for (const key of ['number', 'state', 'isDraft', 'baseRefName', 'baseRefOid', 'headRefName', 'headRefOid', 'url']) {
    assertRefused(await github(without(githubDoc(), key)), new RegExp(key), `github without ${key}`)
  }
  for (const key of ['iid', 'state', 'target_branch', 'source_branch', 'sha', 'web_url']) {
    assertRefused(await gitlab(without(gitlabDoc(), key)), new RegExp(key), `gitlab without ${key}`)
  }
})

test('pr review target: a GitLab document whose diff_refs holds no base_sha says the base commit is not stated yet', async () => {
  assertRefused(await gitlab(gitlabDoc({ diff_refs: { head_sha: HEAD, start_sha: BASE } })), /base commit/i, 'no base_sha')
  assertRefused(await gitlab(gitlabDoc({ diff_refs: null })), /base commit/i, 'null diff_refs')
  assertRefused(await gitlab(without(gitlabDoc(), 'diff_refs')), /base commit/i, 'no diff_refs')
})

test('pr review target: a commit id that is not a full hexadecimal id is refused naming the field', async () => {
  assertRefused(await github(githubDoc({ headRefOid: 'abc1234' })), /headRefOid/, 'github seven characters')
  assertRefused(await github(githubDoc({ baseRefOid: 'a'.repeat(39) })), /baseRefOid/, 'github 39 characters')
  assertRefused(await github(githubDoc({ headRefOid: `${'b'.repeat(39)}g` })), /headRefOid/, 'github non-hex')
  assertRefused(await gitlab(gitlabDoc({ diff_refs: { base_sha: `${'a'.repeat(39)}z` } })), /base_sha/, 'gitlab non-hex base')
  assertRefused(await gitlab(gitlabDoc({ sha: 'deadbeef' })), /\bsha\b/, 'gitlab short sha')
})

test('pr review target: a branch name holding a colon, a space or `..` is refused naming the field', async () => {
  assertRefused(await github(githubDoc({ baseRefName: 'main:refs/heads/x' })), /baseRefName/, 'colon in base')
  assertRefused(await github(githubDoc({ headRefName: 'feat x' })), /headRefName/, 'space in head')
  assertRefused(await github(githubDoc({ baseRefName: 'a..b' })), /baseRefName/, 'dot dot in base')
  assertRefused(await github(githubDoc({ headRefName: 'feat\tx' })), /headRefName/, 'control character in head')
  assertRefused(await gitlab(gitlabDoc({ target_branch: 'a:b' })), /target_branch/, 'gitlab colon')
  assertRefused(await gitlab(gitlabDoc({ source_branch: 'a b' })), /source_branch/, 'gitlab space')
})

test('pr review target: a draft is pinned with draft true on both platforms', async () => {
  const g = await github(githubDoc({ isDraft: true }))
  assert.equal(g.ok, true, JSON.stringify(g))
  assert.equal(g.target.draft, true)
  const l = await gitlab(gitlabDoc({ draft: true }))
  assert.equal(l.ok, true, JSON.stringify(l))
  assert.equal(l.target.draft, true)
})

// --- the argv arrays -----------------------------------------------------------

/** The fixed flags the arrays carry themselves; any other element that starts with `-` came from the document. */
const OWN_FLAGS = new Set(['-C', '--detach', '--name-only', '--force'])

test('pr review target: no argv element that came from the document starts with a dash', async () => {
  const hostile = [
    await github(githubDoc()),
    await github(githubDoc({ baseRefName: '-x', headRefName: '--upload-pack=evil' })),
    await gitlab(gitlabDoc()),
    await gitlab(gitlabDoc({ target_branch: '--evil', source_branch: '-y' }))
  ]
  let checked = 0
  for (const r of hostile) {
    if (!r.ok) continue
    checked += 1
    for (const [name, argv] of Object.entries(r.target.commands)) {
      assert.ok(Array.isArray(argv) && argv.every(a => typeof a === 'string'), `${name} is an array of strings`)
      for (const element of argv) {
        if (element.startsWith('-')) assert.ok(OWN_FLAGS.has(element), `${name}: ${element} starts with a dash and is not one of the array's own flags`)
      }
    }
  }
  assert.ok(checked >= 2, 'the two ordinary documents were read')
})

test('pr review target: the fetch names the base branch and the pull request ref in full', async () => {
  const g = await github(githubDoc({ baseRefName: 'release/1.2' }))
  assert.deepEqual(g.target.commands.fetch.slice(-2), ['refs/heads/release/1.2', 'refs/pull/44/head'])
  const l = await gitlab(gitlabDoc({ target_branch: 'release/1.2' }))
  assert.deepEqual(l.target.commands.fetch.slice(-2), ['refs/heads/release/1.2', 'refs/merge-requests/12/head'])
})

// --- validateTarget ------------------------------------------------------------

test('pr review target: validateTarget accepts what each reader returns', async () => {
  const { validateTarget } = await loadTarget()
  for (const r of [await github(githubDoc()), await gitlab(gitlabDoc()), await github(githubDoc({ isDraft: true }), { runCode: true })]) {
    assert.equal(r.ok, true)
    const v = validateTarget(r.target)
    assert.equal(v.ok, true, JSON.stringify(v))
  }
})

test('pr review target: validateTarget refuses an object with any one field removed, with a reason', async () => {
  const { validateTarget } = await loadTarget()
  const { target } = await github(githubDoc())
  for (const key of Object.keys(target)) {
    const v = validateTarget(without(target, key))
    assert.equal(v.ok, false, `a target without ${key} was accepted`)
    assert.equal(typeof v.reason, 'string', key)
    assert.ok(v.reason.length > 0, `a target without ${key} is refused with no reason`)
  }
  for (const nonTarget of [null, undefined, 'x', 7, [], {}]) {
    assert.equal(validateTarget(nonTarget).ok, false, `${JSON.stringify(nonTarget)} is not a target`)
  }
})

// --- purity --------------------------------------------------------------------

test('pr review target: lib/review-target.mjs imports no node: module', () => {
  const source = readFileSync(join(ROOT, MODULE), 'utf8')
  const imports = [...source.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm), ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)]
  assert.ok(!imports.some(m => m[1].startsWith('node:')), `${MODULE} imports ${imports.filter(m => m[1].startsWith('node:')).map(m => m[1]).join(', ')}`)
  assert.doesNotMatch(source, /\brequire\(\s*['"]node:/, `${MODULE} requires a node: module`)
})
