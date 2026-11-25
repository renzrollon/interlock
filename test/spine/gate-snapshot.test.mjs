// `interlock gate` keeps a snapshot of the artifacts it judged (change
// `scope-suggest-and-evaluate-the-artifact-gate`, spec `spec/artifact-re-gate`,
// design §1, D4-D6).
//
// Each test runs the real binary in a temporary directory holding a change `x`.
// `snapshotForGate(root, flags)` is reached only through the CLI here; its pure
// parts are pinned in artifact-snapshot.test.mjs.
//
// Every test that names a snapshot fails until task 2.2 wires the gate. The
// report and checkpoint tests also hold the one thing that must keep holding: a
// snapshot is invisible to the readers of the metrics directory.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'interlock')
const NAME = 'review-artifacts-x-20261125-120000.json'
const FINDINGS_REL = `.claude/metrics/${NAME}`
const SNAPSHOT_REL = `.claude/metrics/snapshots/${NAME}`

const CHANGE_FILES = {
  'proposal.md': '# Proposal\n\nWhy.\n',
  'design.md': '# Design\n\nHow.\n',
  'tasks.md': '# Tasks\n\n- [ ] 1.1 Do it\n',
  'decisions.md': '# Decisions — x\n\n| id | question | class | resolution | evidence |\n|----|----|----|----|----|\n',
  'specs/a/spec.md': '## ADDED Requirements\n\n### Requirement: A SHALL hold\n\n#### Scenario: S\n\n- **WHEN** it runs\n- **THEN** it holds\n'
}

const WARNING = { dimension: 'artifacts', severity: 'warning', title: 'a warning', file: 'design.md', line: 3, description: 'because' }
const BLOCKER = { dimension: 'artifacts', severity: 'blocker', title: 'a blocker', file: 'design.md', line: 3, description: 'because' }

let root

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'interlock-gate-snapshot-'))
  for (const [rel, text] of Object.entries(CHANGE_FILES)) {
    const path = join(root, 'openspec', 'changes', 'x', rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  mkdirSync(join(root, '.claude', 'metrics'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeFindings(findings) {
  writeFileSync(join(root, FINDINGS_REL), JSON.stringify({ dimension: 'artifacts', findings }))
}

function cli(args, { input = '' } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--root', root], { cwd: root, encoding: 'utf8', input })
  assert.equal(r.error, undefined, String(r.error))
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const GATE = ['gate', '--findings', FINDINGS_REL, '--metrics', 'x', '--stage', 'artifacts', '--json']
const gate = (args = GATE, opts) => cli(args, opts)
const read = rel => JSON.parse(readFileSync(join(root, rel), 'utf8'))

// --- the happy path --------------------------------------------------------------

test('gate --stage artifacts --metrics x writes a snapshot of the five files beside the findings file', () => {
  writeFindings([WARNING])
  const r = gate()
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.snapshot.written, true)
  assert.ok(out.snapshot.path.replaceAll('\\', '/').endsWith(SNAPSHOT_REL), out.snapshot.path)

  const payload = read(SNAPSHOT_REL)
  assert.equal(payload.schema, 'interlock.artifact-snapshot/1')
  assert.equal(payload.change, 'x')
  assert.equal(payload.findings, NAME)
  assert.deepEqual(payload.files.map(f => f.path).sort(), Object.keys(CHANGE_FILES).sort())
  for (const f of payload.files) {
    assert.equal(f.text, CHANGE_FILES[f.path], `${f.path} is copied whole`)
    assert.equal(f.sha256, createHash('sha256').update(CHANGE_FILES[f.path]).digest('hex'))
  }
})

test('a change without decisions.md is snapshotted with four files', () => {
  rmSync(join(root, 'openspec', 'changes', 'x', 'decisions.md'))
  writeFindings([WARNING])
  assert.equal(gate().code, 0)
  assert.equal(read(SNAPSHOT_REL).files.length, 4)
})

// --- no snapshot unless all three conditions hold ------------------------------------

test('no snapshot field and no snapshot file without --stage artifacts, without --metrics, or with --findings -', () => {
  writeFindings([WARNING])
  const lines = [
    ['gate', '--findings', FINDINGS_REL, '--metrics', 'x', '--json'],
    ['gate', '--findings', FINDINGS_REL, '--stage', 'artifacts', '--json'],
    ['gate', '--findings', FINDINGS_REL, '--metrics', 'x', '--stage', 'code', '--json']
  ]
  for (const args of lines) {
    const r = gate(args)
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`)
    assert.ok(!Object.hasOwn(JSON.parse(r.stdout), 'snapshot'), args.join(' '))
  }
  const stdin = gate(['gate', '--findings', '-', '--metrics', 'x', '--stage', 'artifacts', '--json'], {
    input: JSON.stringify({ dimension: 'artifacts', findings: [WARNING] })
  })
  assert.equal(stdin.code, 0, stdin.stderr)
  assert.ok(!Object.hasOwn(JSON.parse(stdin.stdout), 'snapshot'), 'standard input names no file to sit beside')
  assert.ok(!existsSync(join(root, '.claude', 'metrics', 'snapshots')), 'no snapshots directory was made')
})

test('a change that does not resolve gives written false and a reason naming it, and the verdict is untouched', () => {
  writeFindings([WARNING])
  const r = gate(['gate', '--findings', FINDINGS_REL, '--metrics', 'y', '--stage', 'artifacts', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.snapshot.written, false)
  assert.ok(out.snapshot.reason.includes('y'), out.snapshot.reason)
  assert.equal(out.passed, true)
})

// --- a snapshot that cannot be written moves no verdict ------------------------------

test('an unwritable snapshots directory warns once on stderr and leaves passed, the exit code and every other field as they were', () => {
  writeFindings([BLOCKER])
  // The control: the same gate with no snapshot conditions met.
  const control = gate(['gate', '--findings', FINDINGS_REL, '--metrics', 'x', '--json'])
  // A plain file where the directory must be: mkdir fails.
  writeFileSync(join(root, '.claude', 'metrics', 'snapshots'), 'not a directory')
  const r = gate()
  assert.equal(r.code, control.code)
  assert.equal(r.code, 1, 'a blocked gate still exits 1')
  const out = JSON.parse(r.stdout)
  assert.equal(out.snapshot.written, false)
  assert.ok(out.snapshot.reason.length > 0)
  assert.equal(r.stderr.split('\n').filter(l => /snapshot/i.test(l)).length, 1, `one warning: ${r.stderr}`)
  const strip = o => {
    const { snapshot, metrics, ...rest } = o
    return rest
  }
  assert.deepEqual(strip(out), strip(JSON.parse(control.stdout)))
  assert.equal(out.passed, false)
})

// --- the readers of the metrics directory ---------------------------------------------

test('the report counts the same records and the same unrecognized files with the snapshot there or removed', () => {
  writeFindings([WARNING])
  const g = gate()
  assert.equal(g.code, 0, g.stderr)
  assert.equal(JSON.parse(g.stdout).snapshot.written, true, 'a snapshot is there to be ignored')
  const withSnapshot = JSON.parse(cli(['report', '--json']).stdout).coverage.metrics
  rmSync(join(root, '.claude', 'metrics', 'snapshots'), { recursive: true, force: true })
  const without = JSON.parse(cli(['report', '--json']).stdout).coverage.metrics
  assert.deepEqual(withSnapshot, without)
  assert.equal(withSnapshot.recognized, 1, 'the gate\'s own record')
  assert.deepEqual(
    withSnapshot.unrecognized.map(u => u.file),
    [NAME],
    'only the findings file, never the snapshot'
  )
})

test('checkpoint names the findings file and not the snapshot', () => {
  writeFindings([WARNING])
  assert.equal(JSON.parse(gate().stdout).snapshot.written, true)
  const r = cli(['checkpoint', 'x', '--json'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).findings, FINDINGS_REL)
  assert.ok(readdirSync(join(root, '.claude', 'metrics', 'snapshots')).includes(NAME))
})

// --- a link out of the root is never written through (PR #47 review, H2) ----------------

test('a snapshots directory that links out of the root is not written through, and the verdict is untouched', () => {
  writeFindings([WARNING])
  const outside = mkdtempSync(join(tmpdir(), 'interlock-gate-snapshot-outside-'))
  try {
    symlinkSync(outside, join(root, '.claude', 'metrics', 'snapshots'))
    const r = gate()
    assert.equal(r.code, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.snapshot.written, false)
    assert.match(out.snapshot.reason, /outside the repository root/)
    assert.equal(out.passed, true)
    assert.deepEqual(readdirSync(outside), [], 'nothing was written outside the root')
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('a link at the snapshot path itself is not followed, and the file it names is unchanged', () => {
  writeFindings([WARNING])
  const outside = mkdtempSync(join(tmpdir(), 'interlock-gate-snapshot-outside-'))
  try {
    const victim = join(outside, 'victim.txt')
    writeFileSync(victim, 'keep me\n')
    mkdirSync(join(root, '.claude', 'metrics', 'snapshots'))
    symlinkSync(victim, join(root, SNAPSHOT_REL))
    const out = JSON.parse(gate().stdout)
    assert.equal(out.snapshot.written, false)
    assert.equal(readFileSync(victim, 'utf8'), 'keep me\n')
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('a change directory that links out of the root is not snapshotted', () => {
  writeFindings([WARNING])
  const outside = mkdtempSync(join(tmpdir(), 'interlock-gate-snapshot-outside-'))
  try {
    writeFileSync(join(outside, 'proposal.md'), 'SECRET\n')
    symlinkSync(outside, join(root, 'openspec', 'changes', 'z'))
    const out = JSON.parse(gate(['gate', '--findings', FINDINGS_REL, '--metrics', 'z', '--stage', 'artifacts', '--json']).stdout)
    assert.equal(out.snapshot.written, false)
    assert.match(out.snapshot.reason, /outside the repository root/)
    assert.equal(existsSync(join(root, SNAPSHOT_REL)), false)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('a relative --findings is read against --root, the root the record and the snapshot use, from any directory', () => {
  writeFindings([BLOCKER])
  const elsewhere = mkdtempSync(join(tmpdir(), 'interlock-gate-snapshot-cwd-'))
  try {
    const r = spawnSync(process.execPath, [CLI, ...GATE, '--root', root], { cwd: elsewhere, encoding: 'utf8', input: '' })
    assert.equal(r.status, 1, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.passed, false, 'the blocker in the root\'s findings file was read')
    assert.equal(out.snapshot.written, true)
  } finally {
    rmSync(elsewhere, { recursive: true, force: true })
  }
})
