import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spillBytes, buildPreview, shouldSpill, SPILL_DIR } from '../../lib/spill.mjs'
import { LIMITS } from '../../lib/limits.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-spill-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const RUN_ID = 'run-abc123'

// --- threshold / preview ----------------------------------------------------

test('output at or under the preview budget is not truncated', () => {
  const text = 'a'.repeat(100)
  const r = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: text })
  assert.equal(r.truncated, false)
  assert.equal(r.preview, text)
  assert.equal(r.bytes, 100)
})

test('output past the preview budget is truncated with a head-and-tail preview', () => {
  const text = 'x'.repeat(10_000)
  const r = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: text, previewChars: 4096 })
  assert.equal(r.truncated, true)
  assert.ok(r.preview.length <= 4096 + 60, 'preview must stay near the requested budget')
  assert.match(r.preview, /…\[spilled 10000 bytes, locator=.*\]…/)
  assert.ok(r.preview.startsWith('x'), 'preview keeps the head')
  assert.ok(r.preview.endsWith('x'), 'preview keeps the tail')
})

test('buildPreview shows the start of a failure and its summary, never just the head', () => {
  const text = `FIRST LINE OF THE FAILURE\n${'.'.repeat(5000)}\nLAST LINE: 3 failed, 7 passed`
  const { preview, truncated } = buildPreview(text, text.length, 'locator.log', 200)
  assert.equal(truncated, true)
  assert.match(preview, /FIRST LINE OF THE FAILURE/)
  assert.match(preview, /LAST LINE: 3 failed, 7 passed/)
})

test('the default preview budget matches LIMITS.verifyPreviewChars', () => {
  const text = 'y'.repeat(LIMITS.verifyPreviewChars + 500)
  const r = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: text })
  assert.equal(r.truncated, true)
  assert.ok(r.preview.length <= LIMITS.verifyPreviewChars + 60)
})

// --- hash --------------------------------------------------------------------

test('sha256 matches the full spilled content, not the preview', () => {
  const text = 'z'.repeat(9000)
  const r = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: text })
  const expected = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
  assert.equal(r.sha256, expected)
  assert.notEqual(r.sha256, createHash('sha256').update(Buffer.from(r.preview, 'utf8')).digest('hex'))
})

// --- locator -------------------------------------------------------------

test('the locator is a repo-relative POSIX path under .claude/ship/spill/<runId>/', () => {
  const r = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: 'hello' })
  assert.equal(r.locator, `${SPILL_DIR}/${RUN_ID}/1-unit.log`)
  assert.doesNotMatch(r.locator, /\\/, 'locator must be POSIX-joined, even on Windows')
  assert.ok(existsSync(join(tmp, ...r.locator.split('/'))), 'the full bytes must be readable at the locator')
  assert.equal(readFileSync(join(tmp, ...r.locator.split('/')), 'utf8'), 'hello')
})

test('successive spills for the same run get contiguous seq numbers, across kinds', () => {
  const a = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: 'one' })
  const b = spillBytes(tmp, { runId: RUN_ID, kind: 'e2e', bytes: 'two' })
  const c = spillBytes(tmp, { runId: RUN_ID, kind: 'unit', bytes: 'three' })
  assert.equal(a.locator, `${SPILL_DIR}/${RUN_ID}/1-unit.log`)
  assert.equal(b.locator, `${SPILL_DIR}/${RUN_ID}/2-e2e.log`)
  assert.equal(c.locator, `${SPILL_DIR}/${RUN_ID}/3-unit.log`)
})

test('two different run ids spill into two different directories', () => {
  const a = spillBytes(tmp, { runId: 'run-one', kind: 'unit', bytes: 'a' })
  const b = spillBytes(tmp, { runId: 'run-two', kind: 'unit', bytes: 'b' })
  assert.equal(a.locator, `${SPILL_DIR}/run-one/1-unit.log`)
  assert.equal(b.locator, `${SPILL_DIR}/run-two/1-unit.log`)
})

test('a hostile runId or kind is sanitized into a safe path segment rather than escaping the spill tree', () => {
  const r = spillBytes(tmp, { runId: '../../etc', kind: '../passwd', bytes: 'x' })
  assert.doesNotMatch(r.locator, /\.\.\//)
  assert.ok(existsSync(join(tmp, ...r.locator.split('/'))))
})

test('binary bytes round-trip through a Buffer without re-encoding as utf8', () => {
  const buf = Buffer.from([0, 1, 2, 255, 254, 253])
  const r = spillBytes(tmp, { runId: RUN_ID, kind: 'binary', bytes: buf })
  assert.equal(r.bytes, buf.length)
  assert.deepEqual(readFileSync(join(tmp, ...r.locator.split('/'))), buf)
})

// --- the spill threshold is a read, not prose (spec: ship/cap-authority) ----
//
// `LIMITS.verifySpillBytes` used to be printed by `interlock limits` and read
// by nothing: the trigger lived in a sentence in a ship prompt, and the only
// reference to the number outside limits.mjs was a test asserting it equals
// 8192. A cap whose only reader pins its value is not enforced; it just looks
// enforced.

test('shouldSpill reads the published threshold', () => {
  const cap = LIMITS.verifySpillBytes
  assert.equal(shouldSpill('x'.repeat(cap)), false, 'exactly at the threshold is not over it')
  assert.equal(shouldSpill('x'.repeat(cap + 1)), true)
  assert.equal(shouldSpill(Buffer.alloc(cap + 1)), true)
  assert.equal(shouldSpill(cap + 1), true, 'a byte count is accepted as well as the bytes')
  assert.equal(shouldSpill(''), false)
  assert.equal(shouldSpill(null), false)
})

test('shouldSpill honours an explicit threshold override', () => {
  assert.equal(shouldSpill('abcdef', { threshold: 3 }), true)
  assert.equal(shouldSpill('ab', { threshold: 3 }), false)
})

test('shouldSpill measures bytes, not characters', () => {
  assert.equal(shouldSpill('é', { threshold: 1 }), true, 'é is two bytes in UTF-8')
})

test('a spilled record reports whether it was over the published threshold', () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-spill-cap-'))
  try {
    const small = spillBytes(root, { runId: 'r1', kind: 'unit', bytes: 'short' })
    assert.equal(small.overThreshold, false)
    assert.equal(small.threshold, LIMITS.verifySpillBytes)

    const big = spillBytes(root, {
      runId: 'r1',
      kind: 'unit',
      bytes: 'x'.repeat(LIMITS.verifySpillBytes + 1)
    })
    assert.equal(big.overThreshold, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
