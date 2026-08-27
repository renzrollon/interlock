// The stage marker's own tests. The marker is the single input three guards
// trust to decide whether an edit is remediation (deny) or ordinary work
// (allow), so its two failure directions are asserted head-on: a marker read
// back as a real stage when it should be `unknown` is a false deny that bricks
// editing, and a stale marker read as live is a guard that fires in the wrong
// session. Liveness is injected (`isAlive`) so the tests never depend on which
// pids happen to exist on the machine running them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeStage,
  readStage,
  clearStage,
  stagePath,
  markerExists,
  STAGES,
  MARKER_FIELDS,
  SHIP_DIR,
  MARKER_FILE
} from '../../lib/ship-stage.mjs'

const alive = () => true
const dead = () => false

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'interlock-stage-'))
}

test('stagePath derives .claude/ship/<change>/stage.json under the root', () => {
  const root = tmpRoot()
  try {
    assert.equal(stagePath('add-foo', root), join(root, SHIP_DIR, 'add-foo', MARKER_FILE))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('round-trip: writeStage then readStage returns the stage', () => {
  const root = tmpRoot()
  try {
    const w = writeStage('add-foo', 'remediation', { root })
    assert.equal(w.ok, true)
    assert.equal(w.marker.stage, 'remediation')
    assert.equal(w.marker.change, 'add-foo')
    assert.equal(w.marker.index, 1)
    // The writer's own pid is alive during the test, so no injection is needed.
    const r = readStage({ root })
    assert.equal(r.stage, 'remediation')
    assert.equal(r.change, 'add-foo')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeStage advances index monotonically across transitions', () => {
  const root = tmpRoot()
  try {
    assert.equal(writeStage('add-foo', 'implement', { root }).marker.index, 1)
    assert.equal(writeStage('add-foo', 'verify', { root }).marker.index, 2)
    assert.equal(writeStage('add-foo', 'commit', { root }).marker.index, 3)
    assert.equal(readStage({ root, isAlive: alive }).stage, 'commit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('absent marker reads as unknown', () => {
  const root = tmpRoot()
  try {
    assert.equal(readStage({ root }).stage, 'unknown')
    assert.equal(readStage({ root, change: 'add-foo' }).stage, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('malformed JSON reads as unknown', () => {
  const root = tmpRoot()
  try {
    const path = stagePath('add-foo', root)
    mkdirSync(join(root, SHIP_DIR, 'add-foo'), { recursive: true })
    writeFileSync(path, '{ this is not json')
    assert.equal(readStage({ root, isAlive: alive }).stage, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stage value outside the known set reads as unknown', () => {
  const root = tmpRoot()
  try {
    const path = stagePath('add-foo', root)
    mkdirSync(join(root, SHIP_DIR, 'add-foo'), { recursive: true })
    writeFileSync(path, JSON.stringify({ stage: 'refactor', change: 'add-foo', index: 1, pid: process.pid }))
    assert.equal(readStage({ root, isAlive: alive }).stage, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a dead pid makes the marker orphaned → unknown', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'remediation', { root })
    assert.equal(readStage({ root, isAlive: dead }).stage, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an index below the current run is stale → unknown', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'remediation', { root }) // index 1
    // A caller that knows the current run has advanced past index 1 rejects it.
    assert.equal(readStage({ root, isAlive: alive, minIndex: 5 }).stage, 'unknown')
    // At or below the marker's own index it is accepted.
    assert.equal(readStage({ root, isAlive: alive, minIndex: 1 }).stage, 'remediation')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an index that is not a positive integer reads as unknown', () => {
  const root = tmpRoot()
  try {
    const path = stagePath('add-foo', root)
    mkdirSync(join(root, SHIP_DIR, 'add-foo'), { recursive: true })
    writeFileSync(path, JSON.stringify({ stage: 'commit', change: 'add-foo', index: 0, pid: process.pid }))
    assert.equal(readStage({ root, isAlive: alive }).stage, 'unknown')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('readStage scans all changes and returns the freshest live marker', () => {
  const root = tmpRoot()
  try {
    writeStage('add-a', 'implement', { root }) // index 1
    writeStage('add-b', 'verify', { root }) // index 1
    writeStage('add-b', 'commit', { root }) // index 2 — freshest
    const r = readStage({ root, isAlive: alive })
    assert.equal(r.stage, 'commit')
    assert.equal(r.change, 'add-b')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('clearStage removes the marker', () => {
  const root = tmpRoot()
  try {
    writeStage('add-foo', 'remediation', { root })
    assert.equal(markerExists('add-foo', root), true)
    const c = clearStage('add-foo', { root })
    assert.equal(c.ok, true)
    assert.equal(markerExists('add-foo', root), false)
    assert.equal(existsSync(stagePath('add-foo', root)), false)
    // Clearing an already-absent marker is success, not a throw.
    assert.equal(clearStage('add-foo', { root }).ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeStage returns a warning instead of throwing when the path is unwritable', () => {
  const root = tmpRoot()
  try {
    // A file where the change directory should be makes mkdir/write fail.
    mkdirSync(join(root, SHIP_DIR), { recursive: true })
    writeFileSync(join(root, SHIP_DIR, 'add-foo'), 'blocker')
    const w = writeStage('add-foo', 'implement', { root })
    assert.equal(w.ok, false)
    assert.match(w.warning, /stage marker unwritable/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the exported contract stays stable (guards and the workflow depend on it)', () => {
  assert.deepEqual([...STAGES], ['implement', 'verify', 'review', 'remediation', 'fix-tests', 'commit'])
  assert.deepEqual([...MARKER_FIELDS], ['stage', 'change', 'index', 'pid'])
})
