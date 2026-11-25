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
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeReviewMetrics, METRICS_DIR, REVIEW_METRICS_SCHEMA } from '../../lib/metrics.mjs'
// recordFieldsOf is reached through the namespace so a missing export fails
// only the tests that use it, not the whole file at link time.
import * as metricsModule from '../../lib/metrics.mjs'

const recordFieldsOf = (...args) => metricsModule.recordFieldsOf(...args)

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

test('the payload has exactly nine keys and four counts — nothing else', () => {
  const r = writeReviewMetrics(tmp, { change: 'c', counts })
  const payload = JSON.parse(readFileSync(r.path, 'utf8'))
  // Updated by brief-and-record-the-artifact-gate task 2.5 (bounded pin rule): the
  // payload gains `stage`, `depth`, `reviewer` and `lenses`; this now also pins
  // "A review-metrics record SHALL name the stage, depth, reader and lenses that
  // produced it, or `null` for each it was not told". The four are written even
  // when null, and nothing else rides along.
  // Updated by scope-suggest-and-evaluate-the-artifact-gate task 2.2 (bounded pin
  // rule): the payload gains `findings`, null when no findings file is named.
  assert.deepEqual(Object.keys(payload).sort(), [
    'change',
    'counts',
    'depth',
    'findings',
    'lenses',
    'reviewer',
    'schema',
    'stage',
    'timestamp'
  ])
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

// --- brief-and-record-the-artifact-gate: the record says what ran ----------------------------

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'interlock')
const NULL_FIELDS = { stage: null, depth: null, reviewer: null, lenses: null }
const fieldsOf = payload => ({ stage: payload.stage, depth: payload.depth, reviewer: payload.reviewer, lenses: payload.lenses })

test('writeReviewMetrics writes stage, depth, reviewer and lenses when given known values', () => {
  const r = writeReviewMetrics(tmp, { change: 'c', counts, stage: 'artifacts', depth: 'strict', reviewer: 'agent', lenses: ['agentic-harness'] })
  const payload = JSON.parse(readFileSync(r.path, 'utf8'))
  assert.deepEqual(fieldsOf(payload), { stage: 'artifacts', depth: 'strict', reviewer: 'agent', lenses: ['agentic-harness'] })
  assert.equal(payload.schema, REVIEW_METRICS_SCHEMA, 'the schema id does not change')
  assert.equal(REVIEW_METRICS_SCHEMA, 'interlock.review-metrics/1')
})

test('writeReviewMetrics writes each of the four as null when absent', () => {
  const payload = JSON.parse(readFileSync(writeReviewMetrics(tmp, { change: 'c', counts }).path, 'utf8'))
  for (const key of Object.keys(NULL_FIELDS)) assert.ok(Object.hasOwn(payload, key), `${key} is written, as null`)
  assert.deepEqual(fieldsOf(payload), NULL_FIELDS)
})

test('writeReviewMetrics writes null for a value outside the vocabulary, field by field', () => {
  const payload = JSON.parse(
    readFileSync(
      writeReviewMetrics(tmp, { change: 'c', counts, stage: 'design', depth: 'deep', reviewer: 'human', lenses: ['Bad Name'] }).path,
      'utf8'
    )
  )
  assert.deepEqual(fieldsOf(payload), NULL_FIELDS)
  const mixed = JSON.parse(
    readFileSync(writeReviewMetrics(tmp, { change: 'c', counts, stage: 'code', depth: 'deep', reviewer: 'external', lenses: 'web-ui' }).path, 'utf8')
  )
  assert.deepEqual(fieldsOf(mixed), { stage: 'code', depth: null, reviewer: 'external', lenses: null }, 'a lens string is not a list')
})

test('writeReviewMetrics keeps an empty lens list as an observed empty list, not null', () => {
  const payload = JSON.parse(readFileSync(writeReviewMetrics(tmp, { change: 'c', counts, lenses: [] }).path, 'utf8'))
  assert.deepEqual(payload.lenses, [])
})

test('recordFieldsOf reads the four flags and answers null for each that is absent', () => {
  const warned = []
  assert.deepEqual(recordFieldsOf({}, m => warned.push(m)), NULL_FIELDS)
  assert.deepEqual(warned, [])
  const got = recordFieldsOf({ stage: 'artifacts', depth: 'lean', reviewer: 'session', lenses: 'agentic-harness,web-ui' }, m => warned.push(m))
  assert.deepEqual(got, { stage: 'artifacts', depth: 'lean', reviewer: 'session', lenses: ['agentic-harness', 'web-ui'] })
  assert.deepEqual(warned, [])
})

test('recordFieldsOf maps --lenses none to the empty list', () => {
  const warned = []
  assert.deepEqual(recordFieldsOf({ lenses: 'none' }, m => warned.push(m)).lenses, [])
  assert.deepEqual(warned, [])
})

test('recordFieldsOf warns and answers null for a --lenses value of the wrong shape', () => {
  for (const bad of [true, '', 'unknown value with spaces', 'none,agentic-harness', 'agentic-harness,none', 'Bad Name', 'a,,b', 'UPPER']) {
    const warned = []
    const got = recordFieldsOf({ lenses: bad }, m => warned.push(m))
    assert.equal(got.lenses, null, JSON.stringify(bad))
    assert.equal(warned.length, 1, `${JSON.stringify(bad)}: ${warned.join(' | ')}`)
    assert.ok(warned[0].includes('--lenses'), warned[0])
    assert.ok(warned[0].includes('none'), 'it names the accepted forms: ' + warned[0])
  }
})

test('recordFieldsOf warns naming the flag and the known values for a bad stage, depth or reviewer, and records null', () => {
  const cases = [
    ['stage', 'design', ['artifacts', 'code']],
    ['depth', 'deep', ['lean', 'strict']],
    ['reviewer', 'human', ['session', 'agent', 'external']]
  ]
  for (const [key, bad, known] of cases) {
    for (const value of [bad, '', true]) {
      const warned = []
      const got = recordFieldsOf({ [key]: value }, m => warned.push(m))
      assert.equal(got[key], null, `${key} ${JSON.stringify(value)}`)
      assert.equal(warned.length, 1, `${key} ${JSON.stringify(value)}: ${warned.join(' | ')}`)
      assert.ok(warned[0].includes(`--${key}`), warned[0])
      for (const word of known) assert.ok(warned[0].includes(word), `${warned[0]} names ${word}`)
    }
  }
})

function gateAt(root, findings, extra = []) {
  const findingsFile = join(root, 'findings.json')
  writeFileSync(findingsFile, JSON.stringify(findings))
  const r = spawnSync(process.execPath, [CLI, 'gate', '--findings', findingsFile, '--metrics', 'x', '--root', root, ...extra, '--json'], {
    cwd: root,
    encoding: 'utf8'
  })
  const written = existsSyncDir(join(root, METRICS_DIR)) ? readdirSync(join(root, METRICS_DIR)) : []
  const record = written.length ? JSON.parse(readFileSync(join(root, METRICS_DIR, written[0]), 'utf8')) : null
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, record }
}

function existsSyncDir(p) {
  try {
    readdirSync(p)
    return true
  } catch {
    return false
  }
}

const GATE_FINDINGS = [{ dimension: 'artifacts', severity: 'warning', title: 'a warning', file: 'proposal.md', description: 'because' }]
const RECORDING = ['--stage', 'artifacts', '--depth', 'strict', '--reviewer', 'agent', '--lenses', 'agentic-harness']

test('interlock gate records stage, depth, reviewer and lenses from the four flags', () => {
  const r = gateAt(tmp, GATE_FINDINGS, RECORDING)
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(fieldsOf(r.record), { stage: 'artifacts', depth: 'strict', reviewer: 'agent', lenses: ['agentic-harness'] })
  assert.equal(JSON.parse(r.stdout).passed, true)
})

test('interlock gate with --reviewer human records null for it and moves nothing else', () => {
  const clean = mkdtempSync(join(tmpdir(), 'interlock-metrics-clean-'))
  try {
    const bad = gateAt(tmp, GATE_FINDINGS, ['--stage', 'artifacts', '--depth', 'strict', '--reviewer', 'human', '--lenses', 'none'])
    const without = gateAt(clean, GATE_FINDINGS, ['--stage', 'artifacts', '--depth', 'strict', '--lenses', 'none'])
    assert.ok(bad.stderr.includes('--reviewer'), bad.stderr)
    for (const known of ['session', 'agent', 'external']) assert.ok(bad.stderr.includes(known), bad.stderr)
    assert.equal(bad.record.reviewer, null)
    assert.equal(bad.code, without.code)
    const strip = out => {
      const parsed = JSON.parse(out)
      delete parsed.metrics
      // Updated by scope-suggest-and-evaluate-the-artifact-gate task 2.2 (bounded pin
      // rule): this line writes a snapshot whose path names each run's own root.
      delete parsed.snapshot
      return parsed
    }
    assert.deepEqual(strip(bad.stdout), strip(without.stdout), 'passed and every other output field are what the line gives without the flag')
  } finally {
    rmSync(clean, { recursive: true, force: true })
  }
})

test('interlock gate with no recording flags records four nulls and infers nothing from the findings', () => {
  const r = gateAt(tmp, GATE_FINDINGS)
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(fieldsOf(r.record), NULL_FIELDS)
})

test('interlock gate --lenses none records the empty list, not null', () => {
  const r = gateAt(tmp, GATE_FINDINGS, ['--lenses', 'none'])
  assert.deepEqual(r.record.lenses, [])
})

test('interlock gate records null and warns for each malformed --lenses, and moves neither passed nor the exit code', () => {
  const baseline = gateAt(mkdtempSync(join(tmpdir(), 'interlock-metrics-base-')), GATE_FINDINGS)
  for (const bad of [[], [''], ['none,agentic-harness'], ['Bad Name']]) {
    const root = mkdtempSync(join(tmpdir(), 'interlock-metrics-bad-'))
    try {
      const r = gateAt(root, GATE_FINDINGS, ['--lenses', ...bad])
      assert.equal(r.record.lenses, null, JSON.stringify(bad))
      assert.ok(r.stderr.includes('--lenses'), r.stderr)
      assert.equal(r.code, baseline.code, JSON.stringify(bad))
      assert.equal(JSON.parse(r.stdout).passed, JSON.parse(baseline.stdout).passed)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a finding carrying check gates the same as one without it (guard)', () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-metrics-check-'))
  try {
    const checked = gateAt(tmp, GATE_FINDINGS.map(f => ({ ...f, check: 'agentic-harness.3' })))
    const plain = gateAt(root, GATE_FINDINGS)
    assert.equal(checked.code, plain.code)
    const strip = out => {
      const parsed = JSON.parse(out)
      delete parsed.metrics
      return parsed
    }
    // The output echoes each finding, so the tag shows there; the verdict does not move.
    const [a, b] = [strip(checked.stdout), strip(plain.stdout)]
    assert.equal(a.passed, b.passed)
    assert.deepEqual(a.autonomyOutcome, b.autonomyOutcome)
    assert.deepEqual(a.counts, b.counts)
    assert.deepEqual(a.blockers.length, b.blockers.length)
    assert.deepEqual(checked.record.counts, plain.record.counts)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function reviewWith(root, dimensionRecord) {
  const findings = join(root, 'rfindings.json')
  const verdicts = join(root, 'rverdicts.json')
  const dims = join(root, 'rdims.json')
  writeFileSync(findings, JSON.stringify([{ dimension: 'language', severity: 'warning', title: 't', file: 'a.ts', description: 'd' }]))
  writeFileSync(
    verdicts,
    JSON.stringify([
      { findingTitle: 't', isReal: true, qualityScore: 9 },
      { findingTitle: 't', isReal: true, qualityScore: 8 }
    ])
  )
  writeFileSync(dims, JSON.stringify(dimensionRecord))
  const r = spawnSync(
    process.execPath,
    [CLI, 'review', '--findings', findings, '--verdicts', verdicts, '--dimensions', dims, '--metrics', 'x', '--root', root, '--json'],
    { cwd: root, encoding: 'utf8' }
  )
  assert.equal(r.status, 0, r.stderr)
  const files = readdirSync(join(root, METRICS_DIR))
  return JSON.parse(readFileSync(join(root, METRICS_DIR, files[0]), 'utf8'))
}

test('interlock review --metrics records stage code, reviewer agent and the dimension record\'s depth', () => {
  const lean = reviewWith(tmp, { selected: ['language'], ran: ['language'], unavailable: [], skipped: [], depth: 'lean' })
  assert.deepEqual(fieldsOf(lean), { stage: 'code', depth: 'lean', reviewer: 'agent', lenses: null })
})

test('interlock review --metrics from a dimension record with no depth records depth null', () => {
  const none = reviewWith(tmp, { selected: ['language'], ran: ['language'], unavailable: [], skipped: [] })
  assert.equal(none.stage, 'code')
  assert.equal(none.reviewer, 'agent')
  assert.equal(none.depth, null)
})

// --- scope-suggest-and-evaluate-the-artifact-gate: the record names its findings file ---------
//
// Spec `review/metrics-emission`: "A gate's review-metrics record SHALL name the findings file
// it read, or `null`". Every test below fails until task 2.2 lands. Note for 2.2: the earlier
// `recordFieldsOf` tests above deep-equal a four-key result, and the record's key list is pinned
// at the top of this file; both gain `findings` under the bounded pin rule.

const findingsOf = payload => payload.findings

test('writeReviewMetrics copies findings by name, and writes null when it is absent', () => {
  const given = JSON.parse(
    readFileSync(writeReviewMetrics(tmp, { change: 'c', counts, findings: '.claude/metrics/review-artifacts-c-20261125-120000.json' }).path, 'utf8')
  )
  assert.equal(findingsOf(given), '.claude/metrics/review-artifacts-c-20261125-120000.json')
  const none = JSON.parse(readFileSync(writeReviewMetrics(tmp, { change: 'c', counts }).path, 'utf8'))
  assert.ok(Object.hasOwn(none, 'findings'), 'the key is written, as null')
  assert.equal(findingsOf(none), null)
  assert.equal(none.schema, 'interlock.review-metrics/1', 'the schema id does not change')
})

test('recordFieldsOf makes --findings root-relative with / separators when it names a file inside the root, and null otherwise', () => {
  const rel = '.claude/metrics/review-artifacts-c-20261125-120000.json'
  const warned = []
  assert.equal(recordFieldsOf({ findings: rel }, m => warned.push(m), tmp).findings, rel)
  assert.equal(recordFieldsOf({ findings: join(tmp, rel) }, m => warned.push(m), tmp).findings, rel)
  assert.equal(recordFieldsOf({ findings: '-' }, m => warned.push(m), tmp).findings, null)
  assert.equal(recordFieldsOf({ findings: join(tmp, '..', 'elsewhere.json') }, m => warned.push(m), tmp).findings, null)
  assert.equal(recordFieldsOf({}, m => warned.push(m), tmp).findings, null)
  assert.equal(recordFieldsOf({ findings: true }, m => warned.push(m), tmp).findings, null)
  assert.deepEqual(warned, [], 'a findings path that is not recordable is null, not a warning')
})

test('interlock gate records findings as the root-relative path for a relative and for an absolute --findings', () => {
  const rel = '.claude/metrics/review-artifacts-x-20261125-120000.json'
  mkdirp(join(tmp, '.claude', 'metrics'))
  writeFileSync(join(tmp, rel), JSON.stringify(GATE_FINDINGS))
  for (const flag of [rel, join(tmp, rel)]) {
    for (const f of readdirSync(join(tmp, METRICS_DIR))) if (f.startsWith('review-x-')) rmSync(join(tmp, METRICS_DIR, f))
    const r = spawnSync(process.execPath, [CLI, 'gate', '--findings', flag, '--metrics', 'x', '--root', tmp, '--json'], { cwd: tmp, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    const file = readdirSync(join(tmp, METRICS_DIR)).find(f => f.startsWith('review-x-'))
    assert.equal(JSON.parse(readFileSync(join(tmp, METRICS_DIR, file), 'utf8')).findings, rel, flag)
  }
})

test('interlock gate records findings null for standard input and for a file outside the root', () => {
  const stdin = spawnSync(process.execPath, [CLI, 'gate', '--findings', '-', '--metrics', 'x', '--root', tmp, '--json'], {
    cwd: tmp,
    encoding: 'utf8',
    input: JSON.stringify(GATE_FINDINGS)
  })
  assert.equal(stdin.status, 0, stdin.stderr)
  const first = readdirSync(join(tmp, METRICS_DIR))
  assert.equal(first.length, 1)
  const record = JSON.parse(readFileSync(join(tmp, METRICS_DIR, first[0]), 'utf8'))
  assert.equal(record.findings, null)
  assert.deepEqual(record.counts, { raised: 1, dismissed: 0, droppedByQuality: 0, surviving: 1 }, 'its counts are what the gate counted')

  const outside = mkdtempSync(join(tmpdir(), 'interlock-metrics-outside-'))
  try {
    const elsewhere = join(outside, 'findings.json')
    writeFileSync(elsewhere, JSON.stringify(GATE_FINDINGS))
    const root = mkdtempSync(join(tmpdir(), 'interlock-metrics-inside-'))
    try {
      const r = spawnSync(process.execPath, [CLI, 'gate', '--findings', elsewhere, '--metrics', 'x', '--root', root, '--json'], { cwd: root, encoding: 'utf8' })
      assert.equal(r.status, 0, r.stderr)
      const dir = join(root, METRICS_DIR)
      assert.equal(JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8')).findings, null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test('interlock review --metrics writes findings null', () => {
  const record = reviewWith(tmp, { selected: ['language'], ran: ['language'], unavailable: [], skipped: [] })
  assert.ok(Object.hasOwn(record, 'findings'), 'the key is written, as null')
  assert.equal(record.findings, null)
})
