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
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeStage } from '../lib/ship-stage.mjs'
import { REASON_MAX } from '../lib/interrupted.mjs'
import { MAX_TEXT } from '../lib/run-log.mjs'
import { LIMITS } from '../lib/limits.mjs'
import { LEDGER_DIR, LEDGER_SCHEMA, SKILL_QUOTE } from '../lib/launch-ledger.mjs'

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
  // The modules the hook reads interrupted-run notes through travel with it,
  // as they do in an installed plugin; only `bin/interlock` is left behind.
  const lib = join(root, 'plugin-copy', 'lib')
  mkdirSync(lib, { recursive: true })
  for (const name of ['interrupted.mjs', 'ship-stage.mjs']) copyFileSync(join(ROOT, 'lib', name), join(lib, name))
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

// ---------------------------------------------------------------------------
// preflight — interrupted-run notes (spec: hooks/session-preflight)
// ---------------------------------------------------------------------------

/** One interrupted-run note on disk, the shape the recorder writes. */
function plantNote(root, name, fields) {
  const dir = join(root, '.claude', 'ship', 'interrupted')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(
    path,
    typeof fields === 'string'
      ? fields
      : JSON.stringify({
          schema: 'interlock.interrupted/1',
          sessionId: 'sess-9',
          reason: 'other',
          at: '2026-10-05T00:00:00.000Z',
          spokenAt: null,
          ...fields
        })
  )
  return path
}

const cleanDoctor = root => stubBin(root, { stdout: JSON.stringify({ ok: true, checks: [], counts: { warn: 0 } }) })

test('preflight: an unspoken interrupted-run note is surfaced, and left unspoken', () => {
  const root = tmpRoot()
  try {
    const note = plantNote(root, 'r-1.json', { runId: 'r-1', change: 'add-foo', stage: 'verify' })
    const r = runPreflight({ cwd: root, hook: detachedHook(root), path: cleanDoctor(root) })
    assert.equal(r.code, 0)
    assert.match(r.context, /interlock preflight OK/)
    assert.ok(
      r.context.includes(
        'PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage verify — no resume card was written; ' +
          'interlock run-log show r-1'
      ),
      r.context
    )
    assert.equal(JSON.parse(readFileSync(note, 'utf8')).spokenAt, null, 'the next run start marks it, not the preflight')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preflight: an unreadable note is named and the session starts', () => {
  const root = tmpRoot()
  try {
    plantNote(root, 'bad.json', '{ not json')
    const r = runPreflight({ cwd: root, hook: detachedHook(root), path: cleanDoctor(root) })
    assert.equal(r.code, 0)
    assert.match(r.context, /could not be read/)
    assert.match(r.context, /bad\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preflight: a root with no notes produces exactly the existing output and creates nothing', () => {
  const root = tmpRoot()
  try {
    const r = runPreflight({ cwd: root, hook: detachedHook(root), path: cleanDoctor(root) })
    assert.equal(r.context, 'interlock preflight OK.')
    assert.ok(!existsSync(join(root, '.claude', 'ship', 'interrupted')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// recorder (SessionEnd) — reports, never decides (spec: hooks/session-recorder)
// ---------------------------------------------------------------------------
//
// The payload is the fixture in test/fixtures/hooks/sessionend.json with this
// test's own session and root written over it, so the recorder is fed the
// shape the host sends rather than one the test invented.

const SESSION_END = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'hooks', 'sessionend.json'), 'utf8'))

/** A live run: a marker whose pid is this test process, and a manifest naming the session. */
function plantRun(root, { change = 'add-foo', stage = 'implement', pid = process.pid, manifest = {} } = {}) {
  if (pid !== null) writeStage(change, stage, { root, pid })
  mkdirSync(join(root, '.claude', 'ship'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'ship', 'run.json'),
    JSON.stringify({ schema: 'interlock.run/1', change, runId: 'r-1', sessionId: 'sess-9', ...manifest })
  )
}

const endOf = (root, sessionId = 'sess-9', extra = {}) => ({ ...SESSION_END, session_id: sessionId, cwd: root, ...extra })
const interruptedDir = root => join(root, '.claude', 'ship', 'interrupted')

test('recorder: a session that ends mid-run leaves one note naming the run, unspoken', () => {
  const root = tmpRoot()
  try {
    plantRun(root)
    const r = runGuard('recorder.mjs', endOf(root), root)
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '', 'a recorder prints no decision')
    const note = JSON.parse(readFileSync(join(interruptedDir(root), 'r-1.json'), 'utf8'))
    assert.equal(note.schema, 'interlock.interrupted/1')
    assert.equal(note.runId, 'r-1')
    assert.equal(note.change, 'add-foo')
    assert.equal(note.sessionId, 'sess-9')
    assert.equal(note.reason, SESSION_END.reason, 'the host reason, verbatim')
    assert.equal(note.stage, 'implement')
    assert.ok(!Number.isNaN(Date.parse(note.at)), `not a timestamp: ${note.at}`)
    assert.equal(note.spokenAt, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recorder: a session that does not own the run writes nothing and creates no directory', () => {
  const root = tmpRoot()
  try {
    plantRun(root)
    const r = runGuard('recorder.mjs', endOf(root, 'sess-other'), root)
    assert.equal(r.code, 0)
    assert.ok(!existsSync(interruptedDir(root)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recorder: no marker, an orphaned marker, or a manifest without a run id writes nothing', () => {
  const cases = [
    ['no marker', { pid: null }],
    ['an orphaned marker', { pid: 999999 }],
    ['a manifest without a run id', { manifest: { runId: null } }],
    ['a manifest without a session', { manifest: { sessionId: undefined } }],
    ['a manifest for another change', { manifest: { change: 'add-bar' } }]
  ]
  for (const [what, opts] of cases) {
    const root = tmpRoot()
    try {
      plantRun(root, opts)
      const r = runGuard('recorder.mjs', endOf(root), root)
      assert.equal(r.code, 0, what)
      assert.ok(!existsSync(interruptedDir(root)), `${what}: a note or directory was created`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('recorder: a note that cannot be written is said on stderr, exits 0, and leaves the trajectory alone', () => {
  const root = tmpRoot()
  try {
    plantRun(root)
    // A file where the directory should be: the write cannot land.
    writeFileSync(interruptedDir(root), 'in the way\n')
    const r = runGuard('recorder.mjs', endOf(root), root)
    assert.equal(r.code, 0)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /interrupted-run note/)
    assert.ok(!existsSync(join(root, '.claude', 'ship', 'runs')), 'a hook never writes the trajectory')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recorder: malformed stdin and an event it has no branch for exit 0 and create nothing', () => {
  const root = tmpRoot()
  try {
    plantRun(root)
    const malformed = spawnSync('node', [join(HOOKS, 'recorder.mjs')], { cwd: root, input: 'not json', encoding: 'utf8' })
    assert.equal(malformed.status, 0)
    assert.equal((malformed.stdout || '').trim(), '')
    const other = runGuard('recorder.mjs', endOf(root, 'sess-9', { hook_event_name: 'Notification' }), root)
    assert.equal(other.code, 0)
    assert.equal(other.stdout, '')
    assert.ok(!existsSync(interruptedDir(root)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('recorder: an internal throw is caught, spoken on stderr, and the process still exits 0', () => {
  // As with the preflight, the production `catch` is pinned by its tokens: a
  // throw-on-demand flag would be a seam in production that exists for a test.
  const source = readFileSync(join(HOOKS, 'recorder.mjs'), 'utf8')
  assert.match(source, /catch \(err\) \{/)
  assert.match(source, /recorder hook error \(ignored\)/)
  assert.ok(source.trimEnd().endsWith('process.exit(0)'), 'the last statement must be an unconditional exit 0')
  // One recorder file for every reporting branch, dispatching on the event name.
  assert.match(source, /hook_event_name/)
  // It shares nothing with the guards beyond the two readers it names.
  assert.doesNotMatch(source, /\bdeny\(|\ballow\(/, 'a recorder returns no decision')
})

test('recorder: the manifest registers it on SessionEnd', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  const sessionEnd = manifest.hooks && manifest.hooks.SessionEnd
  assert.ok(Array.isArray(sessionEnd) && sessionEnd.length, 'no SessionEnd hook is registered')
  const commands = sessionEnd.flatMap(entry => (entry.hooks || []).map(h => h.command))
  assert.ok(
    commands.some(c => typeof c === 'string' && c.includes('hooks/recorder.mjs')),
    `SessionEnd does not name the recorder: ${JSON.stringify(commands)}`
  )
})

test('recorder: the reason is bounded to the trajectory\'s own text bound', () => {
  assert.equal(REASON_MAX, MAX_TEXT, 'lib/interrupted.mjs restates the trajectory bound; the two must not drift')
  const root = tmpRoot()
  try {
    plantRun(root)
    const r = runGuard('recorder.mjs', endOf(root, 'sess-9', { reason: 'x'.repeat(REASON_MAX * 2) }), root)
    assert.equal(r.code, 0)
    const note = JSON.parse(readFileSync(join(interruptedDir(root), 'r-1.json'), 'utf8'))
    assert.equal(note.reason.length, REASON_MAX)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// guard-relaunch — a second ship launch with no human prompt since (spec: hooks/launch-guard)
// ---------------------------------------------------------------------------
//
// Every event is a payload captured from the host (test/fixtures/hooks/) with
// this test's own session and root written over it, so the guard is fed the
// shapes the host sends: the launch is `{ name: 'interlock:ship', args }`, the
// accepted response carries `status: 'async_launched'`, and the completion wake
// is a `UserPromptSubmit` whose prompt is a task notification. A field the host
// renames fails here rather than silently stopping the guard.

const HOOK_FIXTURE = name => JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'hooks', name), 'utf8'))
const WF_PRE = HOOK_FIXTURE('workflow-pretooluse.json')
const WF_POST = HOOK_FIXTURE('workflow-posttooluse.json')
const PROMPT_SUBMIT = HOOK_FIXTURE('userpromptsubmit.json')
const PROMPT_EXPANSION = HOOK_FIXTURE('userpromptexpansion.json')
const COMPLETION_WAKE = HOOK_FIXTURE('completion-wake.json')

const SESSION = 'sess-relaunch'
const as = (fixture, root, sessionId = SESSION, extra = {}) => ({ ...fixture, session_id: sessionId, cwd: root, ...extra })
const relaunch = (event, root) => runGuard('guard-relaunch.mjs', event, root)
const ledgerFile = (root, sessionId = SESSION) => join(root, LEDGER_DIR, `${sessionId}.json`)
const readLedgerFile = (root, sessionId = SESSION) => JSON.parse(readFileSync(ledgerFile(root, sessionId), 'utf8'))

/** One accepted ship launch, as the host reports it: PreToolUse, then PostToolUse. */
function launch(root, sessionId = SESSION) {
  const pre = relaunch(as(WF_PRE, root, sessionId), root)
  if (isAllow(pre)) relaunch(as(WF_POST, root, sessionId), root)
  return pre
}

/** A recorder branch says nothing on stdout and exits 0, whatever it did. */
function assertSilent(r, what) {
  assert.equal(r.code, 0, `${what}: exit code`)
  assert.equal(r.stdout, '', `${what}: a recorder branch prints no decision`)
}

test('guard-relaunch: the first ship launch is allowed and its PostToolUse records the identity the response carried', () => {
  const root = tmpRoot()
  try {
    const pre = relaunch(as(WF_PRE, root), root)
    assert.equal(pre.code, 0)
    assert.ok(isAllow(pre), `first launch denied: ${pre.stdout}`)
    assert.ok(!existsSync(ledgerFile(root)), 'PreToolUse writes nothing; only an accepted launch does')

    assertSilent(relaunch(as(WF_POST, root), root), 'PostToolUse')
    const ledger = readLedgerFile(root)
    assert.equal(ledger.schema, LEDGER_SCHEMA)
    assert.equal(ledger.sessionId, SESSION)
    assert.equal(ledger.lastHumanPromptAt, null)
    assert.equal(ledger.launches.length, 1)
    const [entry] = ledger.launches
    assert.equal(entry.taskId, WF_POST.tool_response.taskId)
    assert.equal(entry.runId, WF_POST.tool_response.runId)
    assert.equal(entry.workflowName, WF_POST.tool_response.workflowName)
    assert.equal(entry.scriptPath, WF_POST.tool_response.scriptPath)
    assert.ok(!Number.isNaN(Date.parse(entry.at)), `not a timestamp: ${entry.at}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a second launch with no human prompt between is denied, quoting the skill', () => {
  const root = tmpRoot()
  try {
    launch(root)
    const r = relaunch(as(WF_PRE, root), root)
    assert.equal(r.code, 0)
    assert.ok(isDeny(r), `expected a deny, got: ${r.stdout}`)
    const reason = r.decision.hookSpecificOutput.permissionDecisionReason
    for (const token of ['Leftover', 'not authorization', 'new message']) assert.ok(reason.includes(token), `reason lacks ${token}: ${reason}`)
    assert.equal(r.decision.interlockGuard.guard, 'guard-relaunch')
    assert.equal(r.decision.interlockGuard.sessionId, SESSION)
    assert.equal(r.decision.interlockGuard.lastLaunchAt, readLedgerFile(root).launches[0].at)
    assert.equal(r.decision.interlockGuard.lastHumanPromptAt, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a second launch after a typed prompt is allowed — UserPromptSubmit and UserPromptExpansion each count', () => {
  for (const prompt of [PROMPT_SUBMIT, PROMPT_EXPANSION]) {
    const root = tmpRoot()
    try {
      launch(root)
      assertSilent(relaunch(as(prompt, root), root), prompt.hook_event_name)
      assert.ok(readLedgerFile(root).lastHumanPromptAt, `${prompt.hook_event_name} recorded no prompt`)
      const r = relaunch(as(WF_PRE, root), root)
      assert.ok(isAllow(r), `${prompt.hook_event_name}: launch after a prompt denied: ${r.stdout}`)
      // And that launch is the newest again: the next one with no prompt is denied.
      relaunch(as(WF_POST, root), root)
      assert.ok(isDeny(relaunch(as(WF_PRE, root), root)), `${prompt.hook_event_name}: the third launch was not denied`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('guard-relaunch: the completion wake is not a human prompt — the relaunch in its turn is still denied', () => {
  const root = tmpRoot()
  try {
    launch(root)
    assertSilent(relaunch(as(COMPLETION_WAKE, root), root), 'completion wake')
    assert.equal(readLedgerFile(root).lastHumanPromptAt, null, 'the wake moved the human-prompt clock')
    assert.ok(isDeny(relaunch(as(WF_PRE, root), root)), 'a relaunch right after the wake was allowed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: the resume the completion wake suggests is a second launch and is denied', () => {
  const root = tmpRoot()
  try {
    launch(root)
    // The wake's diagnostics name exactly this call: the persisted script and the run id.
    const resume = as(WF_PRE, root, SESSION, {
      tool_input: { scriptPath: WF_POST.tool_response.scriptPath, resumeFromRunId: WF_POST.tool_response.runId, args: 'no-such-change' }
    })
    assert.ok(COMPLETION_WAKE.prompt.includes(WF_POST.tool_response.runId), 'the fixture wake names the run it suggests resuming')
    const r = relaunch(resume, root)
    assert.ok(isDeny(r), `the suggested resume was allowed: ${r.stdout}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: the /interlock:spec --continue shape — one prompt, then one launch — is allowed', () => {
  const root = tmpRoot()
  try {
    assertSilent(relaunch(as(PROMPT_SUBMIT, root), root), 'prompt')
    const r = launch(root)
    assert.ok(isAllow(r), `a single launch inside one prompt was denied: ${r.stdout}`)
    assert.equal(readLedgerFile(root).launches.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a launch in a different session is allowed', () => {
  const root = tmpRoot()
  try {
    launch(root, 'sess-a')
    const r = relaunch(as(WF_PRE, root, 'sess-b'), root)
    assert.ok(isAllow(r), `session b was denied by session a's ledger: ${r.stdout}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a Workflow call on another script is allowed and recorded nowhere', () => {
  const root = tmpRoot()
  try {
    const other = { tool_input: { name: 'deep-research', args: 'x' } }
    const otherPost = { ...other, tool_response: { ...WF_POST.tool_response, workflowName: 'deep-research' } }
    assert.ok(isAllow(relaunch(as(WF_PRE, root, SESSION, other), root)))
    assertSilent(relaunch(as(WF_POST, root, SESSION, otherPost), root), 'PostToolUse on another workflow')
    assert.ok(!existsSync(join(root, '.claude', 'ship')), 'a non-ship workflow created ledger state')
    // And with a ship ledger present, another workflow is still neither denied nor recorded.
    launch(root)
    assert.ok(isAllow(relaunch(as(WF_PRE, root, SESSION, other), root)))
    relaunch(as(WF_POST, root, SESSION, otherPost), root)
    assert.equal(readLedgerFile(root).launches.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a PostToolUse whose response reports an error records nothing, and the next launch is allowed', () => {
  const root = tmpRoot()
  try {
    for (const tool_response of [
      'Error: Workflow "interlock:ship" could not start',
      { ...WF_POST.tool_response, is_error: true },
      { status: 'failed', error: 'refused' }
    ]) {
      assertSilent(relaunch(as(WF_POST, root, SESSION, { tool_response }), root), JSON.stringify(tool_response))
      assert.ok(!existsSync(join(root, '.claude', 'ship')), `a refused launch was recorded: ${JSON.stringify(tool_response)}`)
    }
    assert.ok(isAllow(relaunch(as(WF_PRE, root), root)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a missing session id allows and records nothing', () => {
  const root = tmpRoot()
  try {
    const noSession = fixture => {
      const event = as(fixture, root)
      delete event.session_id
      return event
    }
    launch(root) // a ledger exists for another session; it must not be consulted
    assert.ok(isAllow(relaunch(noSession(WF_PRE), root)))
    assertSilent(relaunch(noSession(WF_POST), root), 'PostToolUse without a session')
    assertSilent(relaunch(noSession(PROMPT_SUBMIT), root), 'prompt without a session')
    assert.ok(isAllow(relaunch(as(WF_PRE, root, '../escape'), root)), 'an unsafe session id allows')
    assert.ok(!existsSync(join(root, '.claude', 'escape.json')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a malformed ledger allows with a note on stderr', () => {
  const root = tmpRoot()
  try {
    mkdirSync(join(root, LEDGER_DIR), { recursive: true })
    writeFileSync(ledgerFile(root), '{"schema": "interlock.launch-ledger/1", "launches": [')
    const r = relaunch(as(WF_PRE, root), root)
    assert.equal(r.code, 0)
    assert.ok(isAllow(r), `a malformed ledger denied: ${r.stdout}`)
    assert.match(r.stderr, /guard-relaunch/)
    assert.match(r.stderr, new RegExp(`${SESSION}\\.json`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a crash allows, exits 0 and names the error on stderr', () => {
  const root = tmpRoot()
  try {
    // `null` parses as JSON, so the guard reaches its body with no event object
    // and throws there: the real catch, reached from input alone — no test-only
    // throw flag in production.
    const res = spawnSync('node', [join(HOOKS, 'guard-relaunch.mjs')], { cwd: root, input: 'null', encoding: 'utf8' })
    assert.equal(res.status, 0)
    assert.equal((res.stdout || '').trim(), '', 'a crash returns no decision')
    assert.match(res.stderr, /guard-relaunch: internal error, allowing by default/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const source = readFileSync(join(HOOKS, 'guard-relaunch.mjs'), 'utf8')
  assert.match(source, /catch \(err\) \{/)
  assert.ok(source.trimEnd().endsWith('process.exit(0)'), 'the last statement must be an unconditional exit 0')
  assert.match(source, /hook_event_name/, 'one script, dispatching on the event name')
  // It reads the helpers _shared.mjs already exports, and nothing else from it.
  const shared = source.match(/import \{([^}]*)\} from '\.\/_shared\.mjs'/)
  assert.ok(shared, 'the guard imports from hooks/_shared.mjs')
  const names = shared[1].split(',').map(s => s.trim()).filter(Boolean)
  const allowed = new Set(['readEvent', 'allow', 'deny', 'toolName', 'toolInput', 'projectRoot'])
  assert.deepEqual(names.filter(n => !allowed.has(n)), [], `unexpected _shared imports: ${names}`)
})

test('guard-relaunch: a prompt with no ledger, in a root with no .claude/ship, creates no file and no directory', () => {
  const root = tmpRoot()
  try {
    assert.ok(!existsSync(join(root, '.claude', 'ship')))
    for (const prompt of [PROMPT_SUBMIT, PROMPT_EXPANSION, COMPLETION_WAKE]) {
      assertSilent(relaunch(as(prompt, root), root), prompt.hook_event_name)
    }
    assert.ok(!existsSync(join(root, '.claude', 'ship')), 'a prompt alone created ship state')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a ledger older than the published age allows, and the next write removes it', () => {
  const root = tmpRoot()
  try {
    const longAgo = Date.now() - LIMITS.launchLedgerMaxAgeMs - 60_000
    const stale = (sessionId, at) => {
      mkdirSync(join(root, LEDGER_DIR), { recursive: true })
      const path = ledgerFile(root, sessionId)
      writeFileSync(
        path,
        JSON.stringify({
          schema: LEDGER_SCHEMA,
          sessionId,
          launches: [{ at: new Date(at).toISOString(), taskId: 'old', runId: 'wf_old', workflowName: 'ship', scriptPath: '/x/ship-wf_old.js' }],
          lastHumanPromptAt: null
        })
      )
      utimesSync(path, at / 1000, at / 1000)
      return path
    }
    stale(SESSION, longAgo)
    const sibling = stale('sess-gone', longAgo)

    const r = relaunch(as(WF_PRE, root), root)
    assert.ok(isAllow(r), `a stale ledger denied: ${r.stdout}`)
    relaunch(as(WF_POST, root), root)
    assert.ok(!existsSync(sibling), 'the write did not sweep a stale sibling ledger')
    const fresh = readLedgerFile(root)
    assert.equal(fresh.launches.length, 1, 'the stale launch survived the write')
    assert.notEqual(fresh.launches[0].taskId, 'old')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: a tool that is not Workflow, and an event it has no branch for, allow silently', () => {
  const root = tmpRoot()
  try {
    launch(root)
    assert.ok(isAllow(relaunch(as(WF_PRE, root, SESSION, { tool_name: 'Bash', tool_input: { command: 'ls' } }), root)))
    assertSilent(relaunch(as(WF_PRE, root, SESSION, { hook_event_name: 'Notification' }), root), 'Notification')
    assert.equal(readLedgerFile(root).launches.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('guard-relaunch: the manifest registers it on PreToolUse and PostToolUse for Workflow, and on both prompt events', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  const names = entry => (entry.hooks || []).map(h => h.command).filter(c => typeof c === 'string' && c.includes('hooks/guard-relaunch.mjs'))
  for (const event of ['PreToolUse', 'PostToolUse']) {
    const entries = (manifest.hooks && manifest.hooks[event]) || []
    assert.ok(
      entries.some(entry => entry.matcher === 'Workflow' && names(entry).length),
      `${event} has no Workflow matcher naming hooks/guard-relaunch.mjs`
    )
  }
  for (const event of ['UserPromptSubmit', 'UserPromptExpansion']) {
    const entries = (manifest.hooks && manifest.hooks[event]) || []
    assert.ok(entries.some(entry => names(entry).length), `${event} does not name hooks/guard-relaunch.mjs`)
  }
})

test('guard-relaunch: the skill sentence the deny quotes is still in skills/ship/SKILL.md', () => {
  // test/skills.test.mjs pins the sentence by tokens; this pins that the deny
  // reason quotes it verbatim, so a reword of the skill fails here too.
  const skill = readFileSync(join(ROOT, 'skills', 'ship', 'SKILL.md'), 'utf8')
  assert.ok(skill.includes(SKILL_QUOTE), `skills/ship/SKILL.md no longer contains: ${SKILL_QUOTE}`)
  assert.match(SKILL_QUOTE, /Leftover.*not authorization/)
})
