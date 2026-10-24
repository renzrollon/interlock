// Review fixes on the upgrade-path hardening: the drawn run-log forms carry the
// foreign-line note, `autonomy clean --json` keeps its type over a corrupt
// record, the CLI says `unknown` when it cannot read its own version, the flag
// table stays visible to the package-closure test, and `cut-release-fixture`
// refuses an `--out` it must not delete.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outDirRefusal, CHANGE } from '../../scripts/cut-release-fixture.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'bin', 'interlock')

function cli(args, { cwd, bin = BIN } = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, INTERLOCK_STATE_HOME: '', INTERLOCK_NTFY_TOPIC: '' }
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const scratch = prefix => realpathSync(mkdtempSync(join(tmpdir(), prefix)))

// --- run-log show --format carries the foreign-line note -----------------------

const FIXTURE = join(ROOT, 'test', 'fixtures', 'ship', 'halted-run-6e9d0b02')
const RUN_ID = '6e9d0b02-c70b-4d7a-9865-fa892722cecb'

function plantRun({ foreign }) {
  const home = scratch('interlock-drawn-note-')
  mkdirSync(join(home, '.claude', 'ship', 'runs'), { recursive: true })
  const log = join(home, '.claude', 'ship', 'runs', `${RUN_ID}.jsonl`)
  writeFileSync(log, readFileSync(join(FIXTURE, 'trajectory.jsonl')))
  writeFileSync(join(home, '.claude', 'ship', 'state.json'), readFileSync(join(FIXTURE, 'state.json')))
  for (let i = 0; i < foreign; i++) {
    appendFileSync(
      log,
      JSON.stringify({
        schema: 'interlock.ship-run/2',
        ts: '2026-10-22T10:00:00.000Z',
        runId: RUN_ID,
        change: 'add-widget',
        seq: 900 + i,
        type: 'run-start'
      }) + '\n'
    )
  }
  return home
}

test('run-log show prints the foreign-line note in the plain, board and mermaid forms', () => {
  const home = plantRun({ foreign: 2 })
  try {
    const at = ['--root', home, '--state-home', home]
    const plain = cli(['run-log', 'show', RUN_ID, ...at], { cwd: home })
    assert.equal(plain.code, 0, plain.stderr)
    const note = plain.stdout.split('\n').find(l => /foreign-schema/.test(l))
    assert.ok(note, `the plain form is the reference: ${plain.stdout}`)
    assert.match(note, /2 foreign-schema line\(s\) skipped \(first: interlock\.ship-run\/2/)

    const board = cli(['run-log', 'show', RUN_ID, '--format', 'board', ...at], { cwd: home })
    assert.equal(board.code, 0, board.stderr)
    assert.ok(board.stdout.split('\n').includes(note.trim()), `board lost the note:\n${board.stdout}`)

    const mermaid = cli(['run-log', 'show', RUN_ID, '--format', 'mermaid', ...at], { cwd: home })
    assert.equal(mermaid.code, 0, mermaid.stderr)
    const lines = mermaid.stdout.split('\n')
    assert.equal(lines[0], 'flowchart TD', 'the diagram still opens as a flowchart')
    assert.ok(lines.includes(`  %% ${note.trim()}`), `mermaid lost the note as a comment:\n${mermaid.stdout}`)
    const noted = lines.filter(l => /foreign-schema/.test(l))
    assert.ok(noted.every(l => l.trim().startsWith('%%')), 'the note is a comment, not a node')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a trajectory with no foreign line draws with no note', () => {
  const home = plantRun({ foreign: 0 })
  try {
    const at = ['--root', home, '--state-home', home]
    for (const format of ['board', 'mermaid']) {
      const r = cli(['run-log', 'show', RUN_ID, '--format', format, ...at], { cwd: home })
      assert.equal(r.code, 0, r.stderr)
      assert.doesNotMatch(r.stdout, /foreign/i, format)
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// --- autonomy clean over an unreadable record ------------------------------------

const CORRUPT = '{"review-artifacts": {"runs": 7, \u0000 not json'

function corruptHome() {
  const home = scratch('interlock-autonomy-clean-corrupt-')
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'autonomy.json'), CORRUPT)
  return home
}

const movedAside = home => readdirSync(join(home, '.claude')).filter(n => n.startsWith('autonomy.json.unreadable-'))

test('autonomy clean over a corrupt record speaks it on stderr, restarts the counters and exits 0', () => {
  const home = corruptHome()
  try {
    const r = cli(['autonomy', 'clean', 'review-artifacts', 'explore', '--state-home', home], { cwd: home })
    assert.equal(r.code, 0, r.stderr)
    const moved = movedAside(home)
    assert.equal(moved.length, 1, `expected one moved-aside file, saw ${moved}`)
    assert.equal(readFileSync(join(home, '.claude', moved[0]), 'utf8'), CORRUPT, 'the bytes are kept')
    assert.match(r.stderr, /AUTONOMY RECORD UNREADABLE/)
    assert.match(r.stderr, /counters restarted/)
    assert.ok(r.stderr.includes(moved[0]), `stderr names the moved path: ${r.stderr}`)
    assert.match(r.stdout, /^review-artifacts: L\d \(1\/\d+ clean\)$/m, 'the rows print as they do on a clean record')
    assert.doesNotMatch(r.stdout, /UNREADABLE/, 'stdout carries rows only')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('autonomy clean --json is an array of rows on every path; the corruption rides on each row as warnings', () => {
  const clean = scratch('interlock-autonomy-clean-ok-')
  const home = corruptHome()
  try {
    const ok = cli(['autonomy', 'clean', 'review-artifacts', 'explore', '--json', '--state-home', clean], { cwd: clean })
    assert.equal(ok.code, 0, ok.stderr)
    const okRows = JSON.parse(ok.stdout)
    assert.ok(Array.isArray(okRows), `an absent record prints an array: ${ok.stdout}`)
    assert.equal(okRows.length, 2)
    assert.ok(okRows.every(r => r.warnings === undefined), 'no warning where nothing was wrong')

    const bad = cli(['autonomy', 'clean', 'review-artifacts', 'explore', '--json', '--state-home', home], { cwd: home })
    assert.equal(bad.code, 0, bad.stderr)
    const rows = JSON.parse(bad.stdout)
    assert.ok(Array.isArray(rows), `a corrupt record still prints an array: ${bad.stdout}`)
    assert.deepEqual(
      rows.map(r => r.path),
      ['review-artifacts', 'explore']
    )
    for (const row of rows) {
      assert.equal(typeof row.consecutive_clean, 'number')
      assert.ok(Array.isArray(row.warnings) && row.warnings.length === 1, JSON.stringify(row))
      assert.match(row.warnings[0], /counters restarted/)
      assert.ok(row.warnings[0].includes(movedAside(home)[0]))
    }
    assert.match(bad.stderr, /AUTONOMY RECORD UNREADABLE/, 'stderr speaks it as well')
  } finally {
    rmSync(clean, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

// --- the CLI cannot read its own version ---------------------------------------------

test('a CLI that cannot read its package.json says unknown, never null', () => {
  const dir = scratch('interlock-no-version-')
  try {
    mkdirSync(join(dir, 'bin'))
    cpSync(BIN, join(dir, 'bin', 'interlock'))
    cpSync(join(ROOT, 'lib'), join(dir, 'lib'), { recursive: true })
    // Node 18 has no module-syntax detection, so the extensionless bin needs the
    // package type to load at all. The manifest carries no version to read.
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n')
    const bin = join(dir, 'bin', 'interlock')

    const flag = cli(['--version'], { cwd: dir, bin })
    assert.equal(flag.stdout, 'unknown\n')
    assert.equal(flag.code, 0, flag.stderr)

    const word = cli(['version'], { cwd: dir, bin })
    assert.equal(word.stdout, 'unknown\n')

    const asJson = cli(['version', '--json'], { cwd: dir, bin })
    assert.equal(JSON.parse(asJson.stdout).version, 'unknown')

    const refused = cli(['waves', '--nope'], { cwd: dir, bin })
    assert.equal(refused.code, 2)
    assert.match(refused.stderr, /\(CLI unknown\)/)
    assert.doesNotMatch(refused.stderr, /null/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- the flag table is a plain import ---------------------------------------------------

test('bin/interlock imports the flag table by a plain literal specifier', () => {
  const text = readFileSync(BIN, 'utf8')
  assert.match(text, /^import \{[^}]*\} from '\.\.\/lib\/cli-flags\.mjs'$/m)
  assert.doesNotMatch(text, /cli-fl' \+ 'ags|'\s*\+\s*'ags\.mjs/, 'no specifier built from pieces')
})

// --- cut-release-fixture refuses an --out it must not delete -------------------------------

test('cut-release-fixture refuses the root, the home directory, the repository and its ancestors', () => {
  assert.match(outDirRefusal('/'), /filesystem root/)
  assert.match(outDirRefusal(homedir()), /home directory/)
  assert.match(outDirRefusal(ROOT), /repository root or a directory above/)
  assert.match(outDirRefusal(dirname(ROOT)), /repository root or a directory above/)
})

test('cut-release-fixture refuses a file and a non-empty directory that is no previous cut, and allows the rest', () => {
  const dir = scratch('interlock-cut-guard-')
  try {
    const file = join(dir, 'a-file')
    writeFileSync(file, 'x')
    assert.match(outDirRefusal(file), /existing file/)

    const foreign = join(dir, 'precious')
    mkdirSync(foreign)
    writeFileSync(join(foreign, 'notes.txt'), 'keep me')
    assert.match(outDirRefusal(foreign), /does not look like a previous cut/)

    assert.equal(outDirRefusal(join(dir, 'not-yet')), null, 'an absent directory is fine')
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    assert.equal(outDirRefusal(empty), null, 'an empty directory is fine')

    const previous = join(dir, 'previous')
    mkdirSync(join(previous, 'openspec', 'changes', CHANGE), { recursive: true })
    assert.equal(outDirRefusal(previous), null, 'a previous cut is replaced')

    assert.equal(outDirRefusal(join(ROOT, 'test', 'fixtures', 'ship', 'release-1.7.0')), null, 'the committed fixture is a previous cut')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cut-release-fixture exits non-zero with the reason, and deletes nothing, for a bad --out', () => {
  const dir = scratch('interlock-cut-guard-run-')
  try {
    const precious = join(dir, 'precious')
    mkdirSync(precious)
    writeFileSync(join(precious, 'notes.txt'), 'keep me')
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'cut-release-fixture.mjs'), 'v1.7.0', '--out', precious], {
      encoding: 'utf8'
    })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /refusing to replace it/)
    assert.match(r.stderr, /does not look like a previous cut/)
    assert.equal(readFileSync(join(precious, 'notes.txt'), 'utf8'), 'keep me')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
