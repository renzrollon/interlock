// The state home resolver — where a run's append-only corpora go.
//
// A Desktop worktree session runs in a linked worktree that is deleted when the
// session is archived. Corpora written there are written into a directory with
// an expiry date, and the report run from the main checkout never sees them.
// The resolver's one job is to name the main checkout instead, and to say so
// out loud whenever it cannot.
//
// Two halves, kept apart on purpose. The happy paths run against real
// `git init` / `git worktree add` fixtures, because the property under test is
// what real git prints and a fake would only restate the implementation's
// assumptions about it. The failure branches inject `exec`, because a missing
// git, a hang and a git older than 2.31 cannot be produced on demand — and a
// branch nobody can reach in a test is a branch that silently stops working.
//
// Every fallback is asserted with its reason. A fallback without one is the
// caller bannering `STATE HOME UNRESOLVED: ` followed by nothing.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  LANE_WORKTREE_SEGMENTS,
  STATE_HOME_ENV,
  SURFACES,
  explicitStateHome,
  resolveStateHome
} from '../../lib/state-home.mjs'

// The fixture's git runs without the developer's global or system config, so a
// signing requirement or a hooks path in ~/.gitconfig cannot fail the setup.
// Identity is set locally per repository, as the fixtures below do.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

let tmp
let main
let worktree
let lane

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV })
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-state-home-'))

  // The resolver's own git inherits this process's environment. Fencing
  // discovery at the temporary directory's parent keeps "not a repository" and
  // "no working tree beside it" true even on a machine whose temp directory sits
  // inside some other checkout.
  process.env.GIT_CEILING_DIRECTORIES = realpathSync(tmpdir())

  main = join(tmp, 'main')
  mkdirSync(main)
  git(main, ['init', '-q', '-b', 'main'])
  git(main, ['config', 'user.email', 'test@example.invalid'])
  git(main, ['config', 'user.name', 'Test'])
  writeFileSync(join(main, 'README.md'), 'fixture\n')
  git(main, ['add', '-A'])
  git(main, ['commit', '-qm', 'base'])

  // Where a Desktop worktree session lives, and where one of Interlock's own
  // lanes lives. Both are real linked worktrees; only the path tells them apart.
  worktree = join(main, '.claude', 'worktrees', 'w1')
  git(main, ['worktree', 'add', '-q', worktree, '-b', 'w1'])
  lane = join(main, '.claude', 'ship', 'worktrees', 'wave-1', 'lane-a')
  git(main, ['worktree', 'add', '-q', lane, '-b', 'lane-a'])
})

after(() => {
  delete process.env.GIT_CEILING_DIRECTORIES
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

/** An exec that records every call and must never be reached. */
function forbiddenExec() {
  const calls = []
  const exec = (file, args, opts) => {
    calls.push({ file, args, opts })
    throw new Error('exec must not be called')
  }
  return { exec, calls }
}

/** An exec that records every call and answers from `answer(args, callNumber)`. */
function scriptedExec(answer) {
  const calls = []
  const exec = (file, args, opts) => {
    calls.push({ file, args, opts })
    return answer(args, calls.length)
  }
  return { exec, calls }
}

const identity = p => p

/** The real git, except that it refuses `--path-format` the way git < 2.31 would be expected to. */
function gitWithoutPathFormat() {
  const calls = []
  const exec = (file, args, opts) => {
    calls.push(args)
    if (args.includes('--path-format=absolute')) {
      throw Object.assign(new Error('unknown option: --path-format=absolute'), { status: 129 })
    }
    const r = spawnSync(file, args, { cwd: opts?.cwd, encoding: 'utf8' })
    if (r.status !== 0) throw Object.assign(new Error('Command failed'), { status: r.status })
    return r.stdout
  }
  return { exec, calls }
}

// --- the exported vocabulary --------------------------------------------------

test('the surfaces are the four the run records, frozen', () => {
  assert.deepEqual([...SURFACES], ['main', 'linked-worktree', 'lane-worktree', 'unknown'])
  assert.ok(Object.isFrozen(SURFACES))
  assert.equal(STATE_HOME_ENV, 'INTERLOCK_STATE_HOME')
  assert.ok(Object.isFrozen(LANE_WORKTREE_SEGMENTS))
})

test('the lane segments are the lane worktree directory lib/run.mjs derives lane paths from', async () => {
  // Restated in lib/state-home.mjs rather than imported, because lib/run.mjs
  // imports the resolver and the reverse import would be a cycle. This pin is
  // what keeps the restatement honest: a lane directory that moved without it
  // would make every lane read as a session worktree and resolve to the main
  // checkout.
  const { LANE_WORKTREES_DIR } = await import('../../lib/run.mjs')
  assert.equal(LANE_WORKTREE_SEGMENTS.join(sep), LANE_WORKTREES_DIR)
})

// --- real fixtures ------------------------------------------------------------

test('a main checkout resolves to itself', () => {
  const r = resolveStateHome(main, { env: {} })
  assert.deepEqual(r, { home: realpathSync(main), surface: 'main', reason: null, resolvedFrom: 'git' })
})

test('a linked worktree resolves to the main checkout it belongs to', () => {
  const r = resolveStateHome(worktree, { env: {} })
  assert.deepEqual(r, {
    home: realpathSync(main),
    surface: 'linked-worktree',
    reason: null,
    resolvedFrom: 'git'
  })
})

test('a root reached through a symlink resolves to the same home as its real path', () => {
  const link = join(tmp, 'link-to-w1')
  symlinkSync(worktree, link)
  try {
    assert.deepEqual(resolveStateHome(link, { env: {} }), resolveStateHome(worktree, { env: {} }))
    assert.equal(resolveStateHome(link, { env: {} }).home, realpathSync(main))
  } finally {
    rmSync(link, { force: true })
  }
})

test("Interlock's own lane worktree resolves to itself and runs no git", () => {
  const { exec, calls } = forbiddenExec()
  const r = resolveStateHome(lane, { env: {}, exec })
  assert.deepEqual(r, {
    home: realpathSync(lane),
    surface: 'lane-worktree',
    reason: null,
    resolvedFrom: 'lane'
  })
  assert.equal(calls.length, 0, 'a lane worktree must be recognised by its path, before any git call')
})

test('a root that does not exist resolves to itself, unknown, with a reason and no git', () => {
  const { exec, calls } = forbiddenExec()
  const missing = join(tmp, 'never-created')
  const r = resolveStateHome(missing, { env: {}, exec })
  assert.equal(r.home, missing)
  assert.equal(r.surface, 'unknown')
  assert.equal(r.resolvedFrom, 'fallback')
  assert.match(r.reason, /does not exist/)
  assert.ok(r.reason.includes(missing), 'the reason names the root')
  assert.equal(calls.length, 0)
})

test('a relative root is made absolute before anything else', () => {
  const r = resolveStateHome('relative/never-created', { env: {}, exec: forbiddenExec().exec })
  assert.equal(r.home, resolve('relative/never-created'))
  assert.equal(r.surface, 'unknown')
})

test('a directory outside any repository falls back to itself with the reason', () => {
  const plain = join(tmp, 'plain')
  mkdirSync(plain, { recursive: true })
  const r = resolveStateHome(plain, { env: {} })
  assert.equal(r.home, realpathSync(plain))
  assert.equal(r.surface, 'unknown')
  assert.equal(r.resolvedFrom, 'fallback')
  assert.match(r.reason, /git rev-parse failed in .*not a git repository/)
})

test("a linked worktree of a bare repository falls back: the common directory has no checkout beside it", () => {
  const bare = join(tmp, 'bare.git')
  git(tmp, ['clone', '-q', '--bare', main, bare])
  const bareWorktree = join(tmp, 'bare-wt')
  git(bare, ['worktree', 'add', '-q', bareWorktree, '-b', 'bw'])
  const r = resolveStateHome(bareWorktree, { env: {} })
  assert.equal(r.home, realpathSync(bareWorktree))
  assert.equal(r.surface, 'unknown')
  assert.equal(r.resolvedFrom, 'fallback')
  assert.match(r.reason, /has no working tree beside it \(a bare repository\)/)
  assert.ok(r.reason.includes(realpathSync(bare)), 'the reason names the common directory')
})

test('a git that rejects --path-format is retried without it and still resolves, against real output', () => {
  const linked = gitWithoutPathFormat()
  const r = resolveStateHome(worktree, { env: {}, exec: linked.exec })
  assert.equal(r.home, realpathSync(main))
  assert.equal(r.surface, 'linked-worktree')
  assert.equal(r.resolvedFrom, 'git')
  assert.ok(linked.calls[0].includes('--path-format=absolute'))
  assert.ok(!linked.calls[1].includes('--path-format=absolute'), 'the retry drops the option')

  // From the main checkout's root, git without the option prints `.git` twice:
  // relative paths, which only mean something once resolved against the root.
  const own = gitWithoutPathFormat()
  const m = resolveStateHome(main, { env: {}, exec: own.exec })
  assert.deepEqual(m, { home: realpathSync(main), surface: 'main', reason: null, resolvedFrom: 'git' })
})

// --- injected failures --------------------------------------------------------

test('a missing git falls back with a reason, and is not retried', () => {
  const { exec, calls } = scriptedExec(() => {
    throw Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' })
  })
  const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
  assert.deepEqual(
    { home: r.home, surface: r.surface, resolvedFrom: r.resolvedFrom },
    { home: resolve('/r'), surface: 'unknown', resolvedFrom: 'fallback' }
  )
  assert.match(r.reason, /git could not be run in .*not found on PATH/)
  assert.equal(calls.length, 1, 'retrying cannot find a git that is not installed')
})

test('a directory git calls no repository falls back after the one retry', () => {
  const { exec, calls } = scriptedExec(() => {
    throw Object.assign(new Error('Command failed: git rev-parse'), { status: 128, stderr: null })
  })
  const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
  assert.equal(r.home, resolve('/r'))
  assert.equal(r.surface, 'unknown')
  assert.equal(r.resolvedFrom, 'fallback')
  assert.match(r.reason, /git rev-parse failed in .*not a git repository/)
  assert.equal(calls.length, 2)
  assert.ok(!calls[1].args.includes('--path-format=absolute'))
})

test("git's own words are used when its stderr reached the error", () => {
  const { exec } = scriptedExec(() => {
    throw Object.assign(new Error('Command failed'), {
      status: 128,
      stderr: 'fatal: detected dubious ownership in repository at /r\nmore\n'
    })
  })
  const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
  assert.match(r.reason, /detected dubious ownership in repository at \/r/)
  assert.doesNotMatch(r.reason, /fatal:/)
})

test('a git that hangs past the timeout falls back with the timeout named, and is not retried', () => {
  for (const err of [
    Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT', signal: 'SIGTERM' }),
    Object.assign(new Error('Command failed'), { signal: 'SIGTERM', status: null })
  ]) {
    const { exec, calls } = scriptedExec(() => {
      throw err
    })
    const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
    assert.equal(r.surface, 'unknown')
    assert.equal(r.resolvedFrom, 'fallback')
    assert.match(r.reason, /git timed out after 10s/)
    assert.equal(calls.length, 1, 'a retry would double a ten-second wait for the same answer')
  }
})

test('the first git call asks for both directories as absolute paths, from the root', () => {
  const { exec, calls } = scriptedExec(() => '/r/.git\n/r/.git\n')
  resolveStateHome('/r', { env: {}, exec, realpath: identity })
  assert.equal(calls[0].file, 'git')
  assert.deepEqual(calls[0].args, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
  assert.equal(calls[0].opts.cwd, resolve('/r'))
})

test('a bare common directory falls back whether the check prints false or fails', () => {
  const bareAnswers = [
    () => 'false\n',
    () => {
      throw Object.assign(new Error('Command failed'), { status: 128 })
    }
  ]
  for (const check of bareAnswers) {
    const { exec, calls } = scriptedExec(args => {
      if (args.includes('--is-inside-work-tree')) return check()
      return '/srv/repo.git/worktrees/w1\n/srv/repo.git\n'
    })
    const r = resolveStateHome('/work/w1', { env: {}, exec, realpath: identity })
    assert.equal(r.home, resolve('/work/w1'))
    assert.equal(r.surface, 'unknown')
    assert.equal(r.resolvedFrom, 'fallback')
    assert.match(r.reason, /the common directory .*repo\.git has no working tree beside it \(a bare repository\)/)
    const probe = calls.find(c => c.args.includes('--is-inside-work-tree'))
    assert.deepEqual(probe.args, ['-C', resolve('/srv'), 'rev-parse', '--is-inside-work-tree'])
  }
})

test('a git that answers relative paths on the retry is resolved against the root', () => {
  // A linked worktree at /r/.claude/worktrees/w1: its git dir and the common
  // directory, both spelled relative to the root.
  const linked = scriptedExec(args => {
    if (args.includes('--path-format=absolute')) {
      throw Object.assign(new Error('Command failed'), { status: 129 })
    }
    if (args.includes('--is-inside-work-tree')) return 'true\n'
    return '../../../.git/worktrees/w1\n../../../.git\n'
  })
  const r = resolveStateHome('/r/.claude/worktrees/w1', { env: {}, exec: linked.exec, realpath: identity })
  assert.deepEqual(r, { home: resolve('/r'), surface: 'linked-worktree', reason: null, resolvedFrom: 'git' })

  const own = scriptedExec(args => {
    if (args.includes('--path-format=absolute')) {
      throw Object.assign(new Error('Command failed'), { status: 129 })
    }
    return '.git\n.git\n'
  })
  const m = resolveStateHome('/r', { env: {}, exec: own.exec, realpath: identity })
  assert.deepEqual(m, { home: resolve('/r'), surface: 'main', reason: null, resolvedFrom: 'git' })
})

test('a git that echoes the option it does not know, instead of failing, is still read correctly', () => {
  // rev-parse prints flags it does not recognise rather than rejecting them, so
  // a git older than 2.31 may answer with the option itself on the first line.
  const { exec, calls } = scriptedExec(() => '--path-format=absolute\n.git\n.git\n')
  const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
  assert.deepEqual(r, { home: resolve('/r'), surface: 'main', reason: null, resolvedFrom: 'git' })
  assert.equal(calls.length, 1)
})

test('output that is not two paths falls back with a reason', () => {
  for (const out of ['', '/r/.git\n']) {
    const { exec } = scriptedExec(() => out)
    const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
    assert.equal(r.surface, 'unknown')
    assert.equal(r.resolvedFrom, 'fallback')
    assert.match(r.reason, /git rev-parse in .* printed/)
  }
})

test('a main checkout found inside the root is refused rather than written into', () => {
  const { exec } = scriptedExec(args => {
    if (args.includes('--is-inside-work-tree')) return 'true\n'
    return '/r/.git/worktrees/x\n/r/sub/.git\n'
  })
  const r = resolveStateHome('/r', { env: {}, exec, realpath: identity })
  assert.equal(r.home, resolve('/r'))
  assert.equal(r.surface, 'unknown')
  assert.match(r.reason, /inside the working root/)
})

test('a realpath that fails for a reason other than absence still falls back with that reason', () => {
  const realpath = () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
  }
  const r = resolveStateHome('/r', { env: {}, exec: forbiddenExec().exec, realpath })
  assert.equal(r.home, resolve('/r'))
  assert.equal(r.surface, 'unknown')
  assert.match(r.reason, /could not be resolved: EACCES/)
})

test('the resolver never throws, whatever it is handed', () => {
  const hostile = [
    [undefined, {}],
    [42, {}],
    ['/r', { exec: () => null, realpath: identity }],
    ['/r', { exec: () => ({}), realpath: identity }],
    ['/r', { exec: () => { throw 'a string, not an Error' }, realpath: identity }],
    ['/r', { exec: () => '/r/.git\n/r/.git\n', realpath: () => { throw null } }]
  ]
  for (const [root, opts] of hostile) {
    let r
    assert.doesNotThrow(() => {
      r = resolveStateHome(root, { env: {}, ...opts })
    })
    assert.ok(SURFACES.includes(r.surface))
    assert.equal(typeof r.home, 'string')
    if (r.surface === 'unknown') assert.ok(r.reason, 'every fallback carries a reason')
  }
})

// --- an explicit home ---------------------------------------------------------

test('an explicit home replaces the resolved one and keeps the surface', () => {
  const r = resolveStateHome(worktree, { env: {}, explicit: '/elsewhere' })
  assert.deepEqual(r, {
    home: resolve('/elsewhere'),
    surface: 'linked-worktree',
    reason: null,
    resolvedFrom: 'explicit'
  })
})

test('an explicit home on a lane worktree still runs no git', () => {
  const { exec, calls } = forbiddenExec()
  const r = resolveStateHome(lane, { env: {}, exec, explicit: '/elsewhere' })
  assert.equal(r.home, resolve('/elsewhere'))
  assert.equal(r.surface, 'lane-worktree')
  assert.equal(r.resolvedFrom, 'explicit')
  assert.equal(calls.length, 0)
})

test('an explicit home on a fallback keeps the reason the surface is unknown', () => {
  const { exec } = scriptedExec(() => {
    throw Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' })
  })
  const r = resolveStateHome('/r', { env: {}, exec, realpath: identity, explicit: 'rel/home' })
  assert.equal(r.home, resolve('rel/home'), 'a relative explicit home is absolute against the cwd')
  assert.equal(r.surface, 'unknown')
  assert.equal(r.resolvedFrom, 'explicit')
  assert.match(r.reason, /not found on PATH/)
})

test('the environment pins the home when no explicit value is passed, and the explicit value wins', () => {
  const env = { [STATE_HOME_ENV]: '/from-env' }
  assert.equal(resolveStateHome(main, { env }).home, resolve('/from-env'))
  assert.equal(resolveStateHome(main, { env }).resolvedFrom, 'explicit')
  assert.equal(resolveStateHome(main, { env, explicit: '/from-flag' }).home, resolve('/from-flag'))
  assert.equal(resolveStateHome(main, { env: { [STATE_HOME_ENV]: '' } }).resolvedFrom, 'git')
})

test('explicitStateHome: the flag wins, then the environment, and empty strings are no setting', () => {
  const env = { [STATE_HOME_ENV]: '/from-env' }
  assert.equal(explicitStateHome({ flag: '/from-flag', env }), resolve('/from-flag'))
  assert.equal(explicitStateHome({ env }), resolve('/from-env'))
  assert.equal(explicitStateHome({ flag: '', env }), resolve('/from-env'))
  assert.equal(explicitStateHome({ flag: '   ', env }), resolve('/from-env'))
  assert.equal(explicitStateHome({ flag: true, env }), resolve('/from-env'), 'a valueless flag is not a path')
  assert.equal(explicitStateHome({ flag: '', env: { [STATE_HOME_ENV]: '' } }), null)
  assert.equal(explicitStateHome({ env: {} }), null)
  assert.equal(explicitStateHome({ flag: 'rel/dir', env: {} }), resolve(process.cwd(), 'rel/dir'))
})

// --- nothing is written -------------------------------------------------------

/** Every path under `dir` with its mtime and size — directories included, so a file made and removed still shows. */
function snapshot(dir) {
  const out = {}
  const walk = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const s = statSync(p, { throwIfNoEntry: false })
      if (!s) continue
      out[p] = `${s.mtimeMs}:${s.isDirectory() ? 'dir' : s.size}`
      if (s.isDirectory()) walk(p)
    }
  }
  const s = statSync(dir)
  out[dir] = `${s.mtimeMs}:dir`
  walk(dir)
  return out
}

test('resolving writes nothing, in the root or the main checkout', () => {
  const link = join(tmp, 'link-to-main')
  symlinkSync(main, link)
  try {
    const before = snapshot(tmp)
    resolveStateHome(main, { env: {} })
    resolveStateHome(worktree, { env: {} })
    resolveStateHome(link, { env: {} })
    resolveStateHome(lane, { env: {} })
    resolveStateHome(join(tmp, 'never-created'), { env: {} })
    resolveStateHome(worktree, { env: {}, explicit: join(tmp, 'pinned-home') })
    resolveStateHome(worktree, { env: { [STATE_HOME_ENV]: join(tmp, 'env-home') } })
    explicitStateHome({ flag: join(tmp, 'flag-home'), env: {} })
    assert.deepEqual(snapshot(tmp), before)
  } finally {
    rmSync(link, { force: true })
  }
})
