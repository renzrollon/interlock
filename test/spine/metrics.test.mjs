import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  chmodSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { writeReviewMetrics, METRICS_DIR, REVIEW_METRICS_SCHEMA } from '../../lib/metrics.mjs'

let tmp

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'interlock-metrics-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const counts = { raised: 7, dismissed: 3, droppedByQuality: 1, surviving: 3 }

test('writes the review counts under .claude/metrics', () => {
  const r = writeReviewMetrics(tmp, { change: 'add-widget', counts })
  assert.equal(r.written, true)
  assert.equal(r.reason, null)
  assert.equal(dirname(r.path), join(tmp, METRICS_DIR))

  const payload = JSON.parse(readFileSync(r.path, 'utf8'))
  assert.deepEqual(payload.counts, counts)
  assert.equal(payload.change, 'add-widget')
  assert.equal(payload.schema, REVIEW_METRICS_SCHEMA)
  assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('the payload has exactly four keys and four counts — nothing else', () => {
  const r = writeReviewMetrics(tmp, { change: 'c', counts })
  const payload = JSON.parse(readFileSync(r.path, 'utf8'))
  assert.deepEqual(Object.keys(payload).sort(), ['change', 'counts', 'schema', 'timestamp'])
  assert.deepEqual(
    Object.keys(payload.counts).sort(),
    ['dismissed', 'droppedByQuality', 'raised', 'surviving']
  )
})

test('finding text handed in alongside the counts never reaches disk', () => {
  const r = writeReviewMetrics(tmp, {
    change: 'leaky',
    counts,
    surviving: [{ title: 'SECRET-TITLE', description: 'SECRET-BODY', file: 'lib/secret.ts' }],
    dismissed: [{ title: 'SECRET-DISMISSED' }],
    transcript: 'SECRET-TRANSCRIPT',
    prompt: 'SECRET-PROMPT'
  })
  const raw = readFileSync(r.path, 'utf8')
  for (const secret of [
    'SECRET-TITLE',
    'SECRET-BODY',
    'SECRET-TRANSCRIPT',
    'SECRET-PROMPT',
    'SECRET-DISMISSED',
    'lib/secret.ts'
  ]) {
    assert.doesNotMatch(raw, new RegExp(secret))
  }
})

test('the filename carries the change and a sortable timestamp', () => {
  writeReviewMetrics(tmp, { change: 'add-widget', counts, now: '2026-08-12T10:00:00.000Z' })
  writeReviewMetrics(tmp, { change: 'add-widget', counts, now: '2026-08-12T11:00:00.000Z' })
  const files = readdirSync(join(tmp, METRICS_DIR)).sort()
  assert.equal(files.length, 2)
  assert.deepEqual(files, [
    'review-add-widget-2026-08-12T10-00-00-000Z.json',
    'review-add-widget-2026-08-12T11-00-00-000Z.json'
  ])
})

test('a hostile change name cannot escape the metrics directory', () => {
  const r = writeReviewMetrics(tmp, { change: '../../etc/passwd', counts })
  assert.equal(r.written, true)
  assert.equal(dirname(resolve(r.path)), resolve(join(tmp, METRICS_DIR)))
  assert.doesNotMatch(r.path, /\.\./)
})

test('a blank change name still produces a file', () => {
  const r = writeReviewMetrics(tmp, { change: '   ', counts })
  assert.equal(r.written, true)
  assert.equal(JSON.parse(readFileSync(r.path, 'utf8')).change, 'unnamed')
})

test('missing or malformed counts become zeroes rather than an error', () => {
  const r = writeReviewMetrics(tmp, { change: 'sparse', counts: { raised: '4', dismissed: -2 } })
  assert.equal(r.written, true)
  assert.deepEqual(JSON.parse(readFileSync(r.path, 'utf8')).counts, {
    raised: 4,
    dismissed: 0,
    droppedByQuality: 0,
    surviving: 0
  })
  assert.equal(writeReviewMetrics(tmp, { change: 'none' }).written, true)
})

// --- failure is always a report, never an exception -----------------------

test('a missing root is a no-op with a reason', () => {
  const r = writeReviewMetrics(join(tmp, 'nope'), { change: 'c', counts })
  assert.equal(r.written, false)
  assert.equal(r.path, null)
  assert.match(r.reason, /does not exist/)
})

test('no root at all is a no-op with a reason', () => {
  for (const root of [undefined, null, '', '   ', 42]) {
    const r = writeReviewMetrics(root, { change: 'c', counts })
    assert.equal(r.written, false)
    assert.equal(r.path, null)
    assert.ok(r.reason)
  }
})

test('an unwritable directory degrades to a reported no-op', () => {
  // A file where .claude/ must be: mkdir fails, and the caller must not see it.
  const blocked = join(tmp, 'blocked')
  mkdirp(blocked)
  writeFileSync(join(blocked, '.claude'), 'not a directory')
  const r = writeReviewMetrics(blocked, { change: 'c', counts })
  assert.equal(r.written, false)
  assert.equal(r.path, null)
  assert.ok(r.reason)
})

test('a read-only .claude degrades to a reported no-op', { skip: isRoot() }, () => {
  const dot = join(tmp, '.claude')
  mkdirp(dot)
  chmodSync(dot, 0o500)
  try {
    const r = writeReviewMetrics(tmp, { change: 'c', counts })
    assert.equal(r.written, false)
    assert.equal(r.path, null)
    assert.match(r.reason, /permission|EACCES/i)
  } finally {
    chmodSync(dot, 0o700)
  }
})

function mkdirp(p) {
  mkdirSync(p, { recursive: true })
}

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0
}
