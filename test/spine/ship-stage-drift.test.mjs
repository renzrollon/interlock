// The drift guard for the stage marker's duplicated definition.
//
// `workflows/ship.js` writes the marker with LITERALS — the workflow runtime
// rejects module loading, so it cannot import lib/ship-stage.mjs and call
// stagePath/writeStage. The literals it duplicates (the path, and the JSON field
// order the guards parse) must stay byte-identical to the module, exactly the
// way PING_AGENT / WORKER_TOOLS are held in sync with lib/host.mjs. This test is
// the assertion that keeps them from drifting: a rename in the module that is
// not mirrored in the workflow, or vice versa, fails here rather than at run
// time as a marker the guards silently cannot read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHIP_DIR, MARKER_FILE, MARKER_FIELDS, stagePath } from '../../lib/ship-stage.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const shipText = readFileSync(join(ROOT, 'workflows', 'ship.js'), 'utf8')

const posix = s => s.replace(/\\/g, '/')

function literal(name) {
  const m = new RegExp(`const ${name} = '([^']*)'`).exec(shipText)
  assert.ok(m, `workflows/ship.js no longer declares ${name} as a string literal`)
  return m[1]
}

test('the marker directory literal matches lib/ship-stage.mjs SHIP_DIR', () => {
  assert.equal(literal('STAGE_MARKER_DIR'), posix(SHIP_DIR))
})

test('the marker filename literal matches lib/ship-stage.mjs MARKER_FILE', () => {
  assert.equal(literal('STAGE_MARKER_FILE'), MARKER_FILE)
})

test('the marker field list matches lib/ship-stage.mjs MARKER_FIELDS exactly', () => {
  const m = /const STAGE_MARKER_FIELDS = \[([^\]]*)\]/.exec(shipText)
  assert.ok(m, 'workflows/ship.js no longer declares STAGE_MARKER_FIELDS')
  const fields = m[1]
    .split(',')
    .map(s => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
  assert.deepEqual(fields, [...MARKER_FIELDS])
})

test('the path template the workflow builds resolves to the module path', () => {
  // stagePath('add-foo') with root '.' is `.claude/ship/add-foo/stage.json`.
  // The workflow builds `${STAGE_MARKER_DIR}/${change}/${STAGE_MARKER_FILE}`.
  const built = `${literal('STAGE_MARKER_DIR')}/add-foo/${literal('STAGE_MARKER_FILE')}`
  assert.equal(built, posix(stagePath('add-foo', '.')))
})

test('the JSON the workflow embeds carries the fields in MARKER_FIELDS order', () => {
  // The publishStageLine helper embeds a one-line object the guards parse. Its
  // key order must be the module's field order so the two never disagree about
  // shape — a reordered or renamed key is drift.
  const m = /\{"stage":"\$\{stage\}","change":"\$\{change\}","index":\$\{index\},"pid":<PID>\}/.exec(shipText)
  assert.ok(m, 'workflows/ship.js no longer embeds the {stage,change,index,pid} marker literal')
  const embeddedKeys = [...m[0].matchAll(/"(\w+)":/g)].map(x => x[1])
  assert.deepEqual(embeddedKeys, [...MARKER_FIELDS])
})
