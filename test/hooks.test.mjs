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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeStage } from '../lib/ship-stage.mjs'

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks')

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
