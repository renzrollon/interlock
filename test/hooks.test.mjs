// The guards, exercised end to end: a synthetic PreToolUse event on stdin, a
// planted stage marker on disk, and the guard's real decision read back off its
// stdout and exit code. Spawned rather than imported — each hook is a script
// that runs its decision on load and reads stdin, so it only has a decision to
// make as a child process with an event piped in.
//
// The two failure directions are what these cases pin. A guard that DENIES when
// it should allow bricks ordinary editing the moment the plugin is installed; a
// guard that ALLOWS when it should deny is the silent hole the change exists to
// close. Every guard's allow/deny/edge is asserted against a marker whose pid is
// this test process — alive for the run — so liveness never depends on which
// pids happen to exist on the machine.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeStage } from '../lib/ship-stage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS = join(ROOT, 'hooks')

function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'interlock-hooks-'))
  // A profile whose commands name `test/` as the test root, the way this repo's
  // own does — so the guard derives its test locations from the profile, not a
  // hardcoded glob.
  mkdirSync(join(root, '.claude', 'testing'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'testing', 'profile.json'),
    JSON.stringify({ unit: { command: 'node --test test/', single_file: 'node --test <path>' } })
  )
  return root
}

/** Run a guard as the host would: event on stdin, cwd at the project root. */
function runGuard(script, event, root) {
  // The host always sets `cwd` on the event to the project root; carry it so the
  // guard resolves paths against the same root the target was built from (on
  // macOS the tmp dir is a /var → /private/var symlink, which process.cwd()
  // canonicalises and a passed path does not).
  const res = spawnSync('node', [join(HOOKS, script)], {
    cwd: root,
    input: JSON.stringify({ cwd: root, ...event }),
    encoding: 'utf8'
  })
  let decision = null
  const out = (res.stdout || '').trim()
  if (out) {
    try {
      decision = JSON.parse(out)
    } catch {
      decision = null
    }
  }
  const permission =
    decision && decision.hookSpecificOutput && decision.hookSpecificOutput.permissionDecision
  return { code: res.status, stdout: out, stderr: res.stderr || '', permission, decision }
}

const isDeny = r => r.permission === 'deny'
const isAllow = r => !r.permission // allow = say nothing, exit 0

const edit = (path, extra = {}) => ({ tool_name: 'Edit', tool_input: { file_path: path, ...extra } })
const bash = command => ({ tool_name: 'Bash', tool_input: { command } })

// ---------------------------------------------------------------------------
// guard-tests
// ---------------------------------------------------------------------------

test('guard-tests: denies a test-file edit during remediation', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'remediation', { root, pid: process.pid })
    const r = runGuard('guard-tests.mjs', edit(join(root, 'test', 'spine', 'waves.test.mjs')), root)
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
    assert.match(r.decision.hookSpecificOutput.permissionDecisionReason, /guard-tests/)
    assert.equal(r.decision.interlockGuard.stage, 'remediation')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tests: denies an edit to a non-suffixed file under the test root during fix-tests', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'fix-tests', { root, pid: process.pid })
    const r = runGuard('guard-tests.mjs', edit(join(root, 'test', 'helpers', 'setup.mjs')), root)
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tests: allows a source edit during remediation', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'remediation', { root, pid: process.pid })
    const r = runGuard('guard-tests.mjs', edit(join(root, 'lib', 'waves.mjs')), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tests: allows a test edit during implementation', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-tests.mjs', edit(join(root, 'test', 'spine', 'new.test.mjs')), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tests: allows a test edit when there is no active run (fails open)', () => {
  const root = tmpRoot()
  try {
    const r = runGuard('guard-tests.mjs', edit(join(root, 'test', 'spine', 'waves.test.mjs')), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tests: allows an Edit that resolves to no concrete path', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'remediation', { root, pid: process.pid })
    const r = runGuard('guard-tests.mjs', { tool_name: 'Edit', tool_input: {} }, root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tests: allows a stale marker whose pid is dead (fails open)', () => {
  const root = tmpRoot()
  try {
    // pid 1 is init/launchd — never the run that wrote a marker in a temp dir,
    // so readStage treats it as an orphan and the stage reads unknown.
    mkdirSync(join(root, '.claude', 'ship', 'add-foo'), { recursive: true })
    writeFileSync(
      join(root, '.claude', 'ship', 'add-foo', 'stage.json'),
      JSON.stringify({ stage: 'remediation', change: 'add-foo', index: 1, pid: 999999 })
    )
    const r = runGuard('guard-tests.mjs', edit(join(root, 'test', 'spine', 'waves.test.mjs')), root)
    assert.ok(isAllow(r), `expected allow on orphaned marker, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// guard-tasks
// ---------------------------------------------------------------------------

function plantTasks(root, change, body) {
  const dir = join(root, 'openspec', 'changes', change)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'tasks.md')
  writeFileSync(path, body)
  return path
}

test('guard-tasks: denies flipping a checkbox in the active change tasks.md', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const path = plantTasks(root, 'add-foo', '- [ ] 1.1 do thing\n')
    const r = runGuard(
      'guard-tasks.mjs',
      edit(path, { old_string: '- [ ] 1.1 do thing', new_string: '- [x] 1.1 do thing' }),
      root
    )
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
    assert.match(r.decision.hookSpecificOutput.permissionDecisionReason, /guard-tasks/)
    assert.equal(r.decision.interlockGuard.change, 'add-foo')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tasks: allows a prose-only edit that leaves checkbox states identical', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const path = plantTasks(root, 'add-foo', '- [ ] 1.1 do thing\n')
    const r = runGuard(
      'guard-tasks.mjs',
      edit(path, { old_string: '- [ ] 1.1 do thing', new_string: '- [ ] 1.1 do the thing well' }),
      root
    )
    assert.ok(isAllow(r), `expected allow on prose edit, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tasks: allows an edit to a file that is not the active change tasks.md', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const other = plantTasks(root, 'add-bar', '- [ ] 1.1 other\n')
    const r = runGuard(
      'guard-tasks.mjs',
      edit(other, { old_string: '- [ ] 1.1 other', new_string: '- [x] 1.1 other' }),
      root
    )
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-tasks: allows a checkbox flip when there is no active run (fails open)', () => {
  const root = tmpRoot()
  try {
    const path = plantTasks(root, 'add-foo', '- [ ] 1.1 do thing\n')
    const r = runGuard(
      'guard-tasks.mjs',
      edit(path, { old_string: '- [ ] 1.1 do thing', new_string: '- [x] 1.1 do thing' }),
      root
    )
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// guard-commit
// ---------------------------------------------------------------------------

test('guard-commit: denies git commit during a non-commit stage', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('git commit -m "wip"'), root)
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
    assert.match(r.decision.hookSpecificOutput.permissionDecisionReason, /guard-commit/)
    assert.equal(r.decision.interlockGuard.stage, 'implement')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: denies git -C <path> commit during a non-commit stage', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'review', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('git -C /some/repo commit -m x'), root)
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: allows git commit during the commit stage', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'commit', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('git commit -m "feat: ship it"'), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: allows git commit outside any ship run (fails open)', () => {
  const root = tmpRoot()
  try {
    const r = runGuard('guard-commit.mjs', bash('git commit -m "my own work"'), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: allows a non-commit git command during a non-commit stage', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('git status'), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: denies a newline-chained commit — a multi-line script is the ordinary tool call', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('git add -A\ngit commit -m x'), root)
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: denies a commit behind a `then` keyword', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('if true; then git commit -m x; fi'), root)
    assert.ok(isDeny(r), `expected deny, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: a newline-chained script with no commit still allows', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', bash('git add -A\ngit status'), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-commit: ignores a non-Bash tool', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'implement', { root, pid: process.pid })
    const r = runGuard('guard-commit.mjs', edit(join(root, 'lib', 'x.mjs')), root)
    assert.ok(isAllow(r), `expected allow, got ${JSON.stringify(r)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// preflight (SessionStart)
// ---------------------------------------------------------------------------
//
// The only hook here that is not a guard, and the one that had no process test
// at all: it was implemented fail-open and asserted nowhere. The direction that
// matters is the opposite of a guard's — this hook must NEVER stop a session,
// so every case below asserts exit 0, including the ones where its own binary
// cannot be found. A SessionStart hook that exits non-zero is a plugin nobody
// can install.

/** Spawn the hook the way the host does: empty stdin, cwd at a project root. */
function runPreflight({ cwd, hook = join(HOOKS, 'preflight.mjs'), path }) {
  const env = { ...process.env }
  if (path !== undefined) env.PATH = path
  // `process.execPath` rather than `node`: these cases hand the child a PATH
  // with nothing on it, and the interpreter must still be findable.
  const res = spawnSync(process.execPath, [hook], { cwd, input: '', encoding: 'utf8', env })
  let context = null
  const out = (res.stdout || '').trim()
  if (out) {
    try {
      const parsed = JSON.parse(out)
      context = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext
    } catch {
      context = null
    }
  }
  return { code: res.status, stdout: out, stderr: res.stderr || '', context }
}

/**
 * A copy of the hook in a tree whose PLUGIN_ROOT has no `bin/interlock`.
 *
 * `PLUGIN_ROOT` is derived from the hook's own URL, so the bundled binary is
 * always found when the real file is spawned — the PATH fallback, and the
 * ENOENT that follows a PATH miss, are unreachable without this copy. A
 * test-only env override in the hook would be the alternative, and a production
 * seam that exists only for a test is worse than a fixture.
 */
function detachedHook(root) {
  const dir = join(root, 'plugin-copy', 'hooks')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'preflight.mjs')
  copyFileSync(join(HOOKS, 'preflight.mjs'), path)
  return path
}

/** An `interlock` on PATH that prints exactly these bytes and exits with this code. */
function stubBin(root, { stdout, code = 0 }) {
  const dir = join(root, 'stub-bin')
  mkdirSync(dir, { recursive: true })
  const bin = join(dir, 'interlock')
  // The interpreter is named absolutely: PATH here holds this stub and nothing
  // else, so `#!/usr/bin/env node` would not resolve.
  writeFileSync(
    bin,
    `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(stdout)})\nprocess.exit(${code})\n`
  )
  chmodSync(bin, 0o755)
  return dir
}

test('preflight: a clean doctor exits 0 with one confirming line, not a wall of output', () => {
  const root = tmpRoot()
  try {
    const path = stubBin(root, { stdout: JSON.stringify({ ok: true, checks: [], counts: { warn: 0 } }) })
    const r = runPreflight({ cwd: root, hook: detachedHook(root), path })
    assert.equal(r.code, 0)
    assert.match(r.context, /interlock preflight OK/)
    assert.equal(r.context.split('\n').length, 1, `a clean preflight is quiet; got ${JSON.stringify(r.context)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preflight: a failing doctor still exits 0 and names the check and its fix', () => {
  // The REAL bundled doctor against an empty root, so this is the production
  // failure path rather than a stub agreeing with itself: no test profile and
  // no git work tree are both fails there, and the doctor exits 1 with its JSON
  // on stdout — the branch that parses `err.stdout`.
  const root = mkdtempSync(join(tmpdir(), 'interlock-preflight-'))
  try {
    const r = runPreflight({ cwd: root })
    assert.equal(r.code, 0, 'a failing preflight must never abort the session')
    assert.match(r.context, /interlock preflight found issues/)
    assert.match(r.context, /\[FAIL\] test-profile:/)
    assert.match(r.context, /fix: /, 'the doctor\'s fix string is what makes the report actionable')
    assert.match(r.context, /The session still starts/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preflight: an unresolvable interlock binary exits 0 and says the preflight could not run', () => {
  const root = tmpRoot()
  try {
    const empty = join(root, 'empty-bin')
    mkdirSync(empty, { recursive: true })
    const r = runPreflight({ cwd: root, hook: detachedHook(root), path: empty })
    assert.equal(r.code, 0, 'a missing binary is the one failure that must not cost the session')
    assert.match(r.context, /interlock preflight could not run/)
    assert.match(r.context, /advisory/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preflight: unparseable doctor output exits 0 and says so rather than guessing', () => {
  const root = tmpRoot()
  try {
    const path = stubBin(root, { stdout: 'not json at all\n' })
    const r = runPreflight({ cwd: root, hook: detachedHook(root), path })
    assert.equal(r.code, 0)
    assert.match(r.context, /could not be parsed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preflight: the manifest still registers this hook on SessionStart', () => {
  // Without this, the hook could be dropped from the manifest and every case
  // above would still pass — a preflight nobody runs, which is the same shape
  // as an instruction nobody asserts.
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  const sessionStart = manifest.hooks && manifest.hooks.SessionStart
  assert.ok(Array.isArray(sessionStart) && sessionStart.length, 'no SessionStart hook is registered')
  const commands = sessionStart.flatMap(entry => (entry.hooks || []).map(h => h.command))
  assert.ok(
    commands.some(c => typeof c === 'string' && c.includes('hooks/preflight.mjs')),
    `SessionStart does not name the preflight hook: ${JSON.stringify(commands)}`
  )
})

test('preflight: an internal throw is caught and the process still exits 0', () => {
  // The production `catch` wraps `run()` itself, so reaching it from a fixture
  // would need a broken import or a test-only throw flag in the hook. Neither
  // is worth a seam in production for, so the two tokens that MAKE it fail open
  // are pinned instead: the ignored-error report, and the unconditional exit 0
  // as the file's last statement.
  const source = readFileSync(join(HOOKS, 'preflight.mjs'), 'utf8')
  assert.match(source, /catch \(err\) \{/, 'the hook body must be wrapped in a catch')
  assert.match(source, /preflight hook error \(ignored\)/, 'and an ignored error is still spoken')
  assert.ok(
    source.trimEnd().endsWith('process.exit(0)'),
    'the last statement must be an unconditional exit 0, whatever ran before it'
  )
})
