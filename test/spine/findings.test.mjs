import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateGate,
  groupByFile,
  formatGate,
  applyToleranceBand,
  TOLERANCE_BAND,
  UNSCOPED_GROUP
} from '../../lib/findings.mjs'
import * as findingsModule from '../../lib/findings.mjs'

const f = (over = {}) => ({
  severity: 'warning',
  file: 'lib/a.ts',
  title: 'something',
  description: 'because',
  ...over
})

test('a gate passes only when no blocker survives', () => {
  assert.equal(evaluateGate({ dimension: 'qa', findings: [f()] }).passed, true)
  assert.equal(
    evaluateGate({ dimension: 'qa', findings: [f({ severity: 'blocker' })] }).passed,
    false
  )
})

test('accepts a bare array, a single dimension object, and an array of dimensions', () => {
  const bare = evaluateGate([f(), f({ title: 'other' })])
  assert.equal(bare.total, 2)

  const single = evaluateGate({ dimension: 'qa', findings: [f()] })
  assert.equal(single.total, 1)
  assert.equal(single.byDimension.qa, 1)

  const many = evaluateGate([
    { dimension: 'qa', findings: [f()] },
    { dimension: 'security', findings: [f({ title: 'x' }), f({ title: 'y' })] }
  ])
  assert.equal(many.total, 3)
  assert.deepEqual(many.byDimension, { qa: 1, security: 2 })
})

test('dimension is stamped onto each finding it came from', () => {
  const r = evaluateGate({ dimension: 'security', findings: [f({ severity: 'blocker' })] })
  assert.equal(r.blockers[0].dimension, 'security')
})

test('skeptic dismissals remove findings and are counted', () => {
  const r = evaluateGate(
    [f({ severity: 'blocker', title: 'ghost' }), f({ title: 'real' })],
    { dismissed: ['ghost'] }
  )
  assert.equal(r.passed, true)
  assert.equal(r.total, 1)
  assert.equal(r.dismissedCount, 1)
})

test('an unrecognised severity is reported, and never silently dropped', () => {
  // This used to assert `counts.unknown === 1` with `passed: true` — an
  // out-of-enum severity landing in a bucket the gate does not block on. The
  // finding is still surfaced, but it now blocks rather than passing; see the
  // severity section at the end of this file.
  const r = evaluateGate([f({ severity: 'nit' })])
  assert.equal(r.malformed.length, 1)
  assert.equal(r.total, 0, 'a finding the gate cannot interpret is not a counted finding')
  assert.equal(r.passed, false)
})

test('autonomyOutcome feeds straight into the ladder', () => {
  const r = evaluateGate([f({ severity: 'blocker' }), f({ severity: 'blocker', title: 'b2' })])
  assert.deepEqual(r.autonomyOutcome, { blockers: 2 })
})

// --- tolerance band -------------------------------------------------------

test('a weakly-scored blocker is dropped and therefore does not block the gate', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'thin', qualityScore: 2 })])
  assert.equal(r.passed, true)
  assert.equal(r.total, 0)
  assert.equal(r.droppedByQuality, 1)
  assert.equal(r.counts.blocker, 0)
})

test('a well-scored blocker still blocks', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'real', qualityScore: 4 })])
  assert.equal(r.passed, false)
  assert.equal(r.droppedByQuality, 0)
  assert.equal(r.blockers.length, 1)
})

test('an unscored blocker still blocks — no score is not evidence of low quality', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'unscored' })])
  assert.equal(r.passed, false)
  assert.equal(r.droppedByQuality, 0)
})

test('a score exactly at the floor is kept; strictly below is dropped', () => {
  assert.equal(evaluateGate([f({ severity: 'blocker', qualityScore: 3 })]).passed, false)
  assert.equal(evaluateGate([f({ severity: 'blocker', qualityScore: 2.9 })]).passed, true)
})

test('reportable and dropped partition the input', () => {
  const findings = [
    f({ title: 'keep-scored', qualityScore: 5 }),
    f({ title: 'keep-unscored' }),
    f({ title: 'drop-a', qualityScore: 1 }),
    f({ title: 'drop-b', qualityScore: 0 })
  ]
  const { reportable, dropped } = applyToleranceBand(findings)
  assert.deepEqual(reportable.map(x => x.title), ['keep-scored', 'keep-unscored'])
  assert.deepEqual(dropped.map(x => x.title), ['drop-a', 'drop-b'])
  assert.equal(reportable.length + dropped.length, findings.length)
})

test('skeptics disagreeing by more than drift keeps the finding', () => {
  const canonical = evaluateGate([
    f({ severity: 'blocker', title: 'contested', qualityScores: [2, 4] })
  ])
  assert.equal(canonical.passed, false)
  assert.equal(canonical.droppedByQuality, 0)

  // Same finding emitted once per skeptic instead of once with both scores.
  const repeated = applyToleranceBand([
    f({ title: 'contested', qualityScore: 2 }),
    f({ title: 'contested', qualityScore: 4 })
  ])
  assert.equal(repeated.reportable.length, 2)
  assert.equal(repeated.dropped.length, 0)
})

test('skeptics agreeing within drift use the higher score', () => {
  // 2 and 3 differ by drift=1, so effective quality is 3 — at the floor, kept.
  assert.equal(applyToleranceBand([f({ qualityScores: [2, 3] })]).dropped.length, 0)
  // 1 and 2 agree that it is weak; the higher score is still below the floor.
  assert.equal(applyToleranceBand([f({ qualityScores: [1, 2] })]).dropped.length, 1)
})

test('repeated weak entries for one finding are dropped as a group', () => {
  const r = evaluateGate([
    f({ severity: 'blocker', title: 'weak', qualityScore: 1 }),
    f({ severity: 'blocker', title: 'weak', qualityScore: 2 })
  ])
  assert.equal(r.passed, true)
  assert.equal(r.droppedByQuality, 2)
})

test('same title in a different file is a different finding', () => {
  const { reportable, dropped } = applyToleranceBand([
    f({ file: 'a.ts', title: 'dup', qualityScore: 1 }),
    f({ file: 'b.ts', title: 'dup', qualityScore: 5 })
  ])
  assert.deepEqual(dropped.map(x => x.file), ['a.ts'])
  assert.deepEqual(reportable.map(x => x.file), ['b.ts'])
})

test('a custom band moves the floor', () => {
  const findings = [f({ severity: 'blocker', qualityScore: 4 })]
  assert.equal(evaluateGate(findings).passed, false)
  assert.equal(
    evaluateGate(findings, { band: { ...TOLERANCE_BAND, minQualityToReport: 5 } }).passed,
    true
  )
})

test('band: null disables the band, preserving pre-band behaviour', () => {
  const r = evaluateGate([f({ severity: 'blocker', title: 'thin', qualityScore: 1 })], {
    band: null
  })
  assert.equal(r.passed, false)
  assert.equal(r.total, 1)
  assert.equal(r.droppedByQuality, 0)
  assert.deepEqual(applyToleranceBand([f({ qualityScore: 0 })], null).dropped, [])
})

test('dismissals and quality drops are counted separately', () => {
  const r = evaluateGate(
    [
      f({ severity: 'blocker', title: 'ghost' }),
      f({ severity: 'blocker', title: 'thin', qualityScore: 1 }),
      f({ title: 'real', qualityScore: 4 })
    ],
    { dismissed: ['ghost'] }
  )
  assert.equal(r.dismissedCount, 1)
  assert.equal(r.droppedByQuality, 1)
  assert.equal(r.total, 1)
  assert.equal(r.passed, true)
})

test('formatGate prints the quality-dropped count only when non-zero', () => {
  const dropped = formatGate(evaluateGate([f({ severity: 'blocker', qualityScore: 1 })]))
  assert.match(dropped, /dropped by quality band: 1/)
  assert.doesNotMatch(formatGate(evaluateGate([f()])), /dropped by quality band/)
})

// --- grouping -------------------------------------------------------------

test('groups by file, sorted, with unscoped findings separated', () => {
  const { byFile, unscoped } = groupByFile([
    f({ file: 'z.ts' }),
    f({ file: 'a.ts' }),
    f({ file: 'a.ts', title: 'second' }),
    f({ file: '' }),
    f({ file: undefined })
  ])
  assert.deepEqual(byFile.map(g => g.file), ['a.ts', 'z.ts'])
  assert.equal(byFile[0].findings.length, 2)
  assert.equal(unscoped.length, 2)
})

test('placeholder file values count as unscoped', () => {
  const { byFile, unscoped } = groupByFile([
    f({ file: '-' }),
    f({ file: 'N/A' }),
    f({ file: 'n/a' }),
    f({ file: '   ' })
  ])
  assert.equal(byFile.length, 0)
  assert.equal(unscoped.length, 4)
})

test('grouped files are disjoint, so they are safe to fan out in parallel', () => {
  const { byFile } = groupByFile([
    f({ file: 'a.ts' }),
    f({ file: 'b.ts' }),
    f({ file: 'a.ts', title: 'x' })
  ])
  const seen = new Set()
  for (const g of byFile) {
    assert.ok(!seen.has(g.file))
    seen.add(g.file)
  }
})

test('UNSCOPED_GROUP never leaks into byFile', () => {
  const { byFile } = groupByFile([f({ file: UNSCOPED_GROUP })])
  assert.equal(byFile.length, 0)
})

test('degenerate input yields a passing, empty gate', () => {
  for (const input of [null, undefined, {}, [], 'nope', 42]) {
    const r = evaluateGate(input)
    assert.equal(r.passed, true)
    assert.equal(r.total, 0)
  }
})

test('formatGate names each blocker with its location', () => {
  const r = evaluateGate([f({ severity: 'blocker', file: 'app/x.ts', line: 9, title: 'Boom' })])
  const out = formatGate(r)
  assert.match(out, /GATE BLOCKED/)
  assert.match(out, /app\/x\.ts:9 — Boom/)
})

// --- severity is in the enum or it is rejected (spec: review/evidence-gate) --
//
// The bug this closes runs the wrong way round: a reviewer emitting "critical"
// — a *more* alarming word than the enum's maximum — used to land in the
// `unknown` bucket, which the gate does not block on. So the scarier word
// passed the gate more easily than `blocker` did.

test('an out-of-enum severity is rejected, not counted into a bucket the gate ignores', () => {
  const r = evaluateGate([f({ severity: 'critical', title: 'scary' })])
  assert.equal(r.passed, false, '"critical" must not pass the gate')
  assert.equal(r.malformed.length, 1)
  assert.equal(r.malformed[0].title, 'scary')
  assert.match(r.malformed[0].reason, /critical/)
  assert.ok(
    !r.counts.unknown,
    'an unrecognised severity must not be silently counted into an ignored bucket'
  )
})

test('every out-of-enum shape is rejected the same way', () => {
  for (const severity of ['critical', 'fatal', 'info', 'nit', '', null, undefined, 7]) {
    const r = evaluateGate([f({ severity })])
    assert.equal(r.passed, false, `severity ${JSON.stringify(severity)} must not pass`)
    assert.equal(r.malformed.length, 1, `severity ${JSON.stringify(severity)} must be reported`)
  }
})

test('casing and whitespace variants resolve to the one canonical severity', () => {
  for (const severity of ['BLOCKER', 'Blocker', '  blocker  ', '\tblocker\n']) {
    const r = evaluateGate([f({ severity })])
    assert.equal(r.malformed.length, 0, `${JSON.stringify(severity)} is a blocker, not malformed`)
    assert.equal(r.counts.blocker, 1)
    assert.equal(r.passed, false)
    assert.equal(r.blockers[0].severity, 'blocker', 'the surviving finding carries the canonical value')
  }
  for (const severity of [' Warning ', 'SUGGESTION']) {
    const r = evaluateGate([f({ severity })])
    assert.equal(r.malformed.length, 0)
    assert.equal(r.passed, true)
  }
})

test('an in-enum blocker still blocks and is still counted', () => {
  const r = evaluateGate([f({ severity: 'blocker' }), f({ severity: 'warning', title: 'b' })])
  assert.equal(r.passed, false)
  assert.equal(r.counts.blocker, 1)
  assert.equal(r.counts.warning, 1)
  assert.deepEqual(r.malformed, [])
})

test('formatGate names a malformed severity rather than hiding it in a count', () => {
  const text = formatGate(evaluateGate([f({ severity: 'critical', title: 'scary' })]))
  assert.match(text, /malformed/i)
  assert.match(text, /scary/)
})

// --- an input that carries no findings list (design D10 of label-and-harden-the-merge-verdict) ---
//
// Reached through the namespace so the missing export fails only these tests.
// `carriesFindingsList(input)` is the one predicate five readers share: a reader
// that cannot find the findings has not established that there are none.

const blocker = (over = {}) => f({ severity: 'blocker', title: 'the loop drops the last row', ...over })

test('carriesFindingsList is true for each accepted shape, an empty list included', () => {
  const { carriesFindingsList } = findingsModule
  for (const input of [
    [],
    [f()],
    [{ dimension: 'qa', findings: [f()] }],
    [{ dimension: 'qa', findings: [] }],
    { dimension: 'qa', findings: [f()] },
    { dimension: 'qa', findings: [] },
    { surviving: [blocker()] },
    { surviving: [] },
    // The record `interlock review --json` prints carries more than its list.
    { surviving: [], dismissed: [], droppedByQuality: [], counts: { raised: 0, surviving: 0 } }
  ]) {
    assert.equal(carriesFindingsList(input), true, JSON.stringify(input))
  }
})

test('carriesFindingsList is false for anything that holds no list of findings', () => {
  const { carriesFindingsList } = findingsModule
  for (const input of [
    {},
    null,
    undefined,
    'no findings',
    '[]',
    0,
    7,
    true,
    { summary: 'clean' },
    { counts: { blocker: 0 } },
    { findings: 'none' },
    { surviving: 0 },
    { dismissed: [] },
    { blockers: [] }
  ]) {
    assert.equal(carriesFindingsList(input), false, JSON.stringify(input))
  }
})

test('the gate reads a review record’s surviving list, and blocks on the blocker in it', () => {
  const record = {
    surviving: [blocker(), f({ title: 'a warning beside it' })],
    dismissed: [blocker({ title: 'verified away' })],
    counts: { raised: 3, dismissed: 1, surviving: 2 }
  }
  const result = evaluateGate(record)
  assert.equal(result.passed, false)
  assert.equal(result.total, 2, 'only the surviving list is read')
  assert.deepEqual(result.blockers.map(b => b.title), ['the loop drops the last row'])
  assert.match(formatGate(result), /GATE BLOCKED/)
})

test('an empty list, and a record whose surviving list is empty, each pass with zero findings', () => {
  for (const input of [[], { surviving: [] }]) {
    const result = evaluateGate(input)
    assert.equal(result.passed, true, JSON.stringify(input))
    assert.equal(result.total, 0)
  }
})

test('a surviving finding keeps the dimension it already carries', () => {
  const result = evaluateGate({ surviving: [blocker({ dimension: 'security' })] })
  assert.equal(result.byDimension.security, 1)
})

test('the shape reader stays total: an input with no list is not thrown on, it is the caller’s to refuse', () => {
  for (const input of [{}, null, 'text', 7]) {
    assert.doesNotThrow(() => evaluateGate(input))
    assert.doesNotThrow(() => applyToleranceBand(input))
  }
})

// --- specGap: an advisory field the gate never reads ------------------------

test('the finding schema carries an optional boolean specGap', () => {
  const items = findingsModule.FINDING_SCHEMA.properties.findings.items
  assert.equal(items.properties.specGap && items.properties.specGap.type, 'boolean')
  assert.match(items.properties.specGap.description || '', /requirement no spec stated/)
  assert.ok(!items.required.includes('specGap'), 'specGap is optional')
})

test('the gate returns the same passed, blockers and malformed for every value of specGap', () => {
  const set = gap => {
    const extra = gap === undefined ? {} : { specGap: gap }
    return [
      f({ severity: 'warning', title: 'gap warning', ...extra }),
      f({ severity: 'blocker', file: 'lib/b.ts', title: 'real blocker' }),
      f({ severity: 'suggestion', title: 'idea' })
    ]
  }
  const pick = g => ({
    passed: g.passed,
    blockers: g.blockers.map(b => `${b.file}:${b.title}`),
    malformed: g.malformed.map(m => `${m.file}:${m.title}`)
  })
  const absent = pick(evaluateGate(set(undefined)))
  for (const value of [true, false, 'yes']) {
    assert.deepEqual(pick(evaluateGate(set(value))), absent, `specGap: ${JSON.stringify(value)}`)
  }
  // And a gate that passes stays passing with a typo on the advisory field.
  const clean = [f({ specGap: 'yes' })]
  assert.equal(evaluateGate(clean).passed, true)
  assert.deepEqual(evaluateGate(clean).malformed, [])
})

// --- finding identity: findingKey / findingId ------------------------------
// Read through the namespace so a missing export fails the assertion (RED)
// rather than breaking the import of every other test in this file.

test('findingKey: a re-cased, re-spaced, re-punctuated title is one key in one file', () => {
  const { findingKey } = findingsModule
  assert.equal(typeof findingKey, 'function', 'lib/findings.mjs must export findingKey')
  const a = findingKey({ file: 'lib/a.mjs', title: 'Missing null check.' })
  const b = findingKey({ file: 'lib/a.mjs', title: 'missing  NULL check' })
  assert.equal(a, b)
  assert.notEqual(a, findingKey({ file: 'lib/b.mjs', title: 'Missing null check.' }))
})

test('findingKey: the key is the trimmed file, a NUL, and the normalised title', () => {
  const { findingKey } = findingsModule
  assert.equal(typeof findingKey, 'function')
  assert.equal(
    findingKey({ file: '  lib/a.mjs ', title: '  Missing   Null\tCheck. ' }),
    'lib/a.mjs\u0000missing null check'
  )
})

test('findingKey: strips every trailing . : ; ! and only trailing ones', () => {
  const { findingKey } = findingsModule
  assert.equal(typeof findingKey, 'function')
  for (const tail of ['.', ':', ';', '!', '.!;:', '!!!']) {
    assert.equal(
      findingKey({ file: 'a', title: `Unsafe cast${tail}` }),
      'a\u0000unsafe cast',
      `tail ${JSON.stringify(tail)}`
    )
  }
  // An inner mark is part of the title, and a different mark is not stripped.
  assert.equal(findingKey({ file: 'a', title: 'a.b' }), 'a\u0000a.b')
  assert.notEqual(findingKey({ file: 'a', title: 'x?' }), findingKey({ file: 'a', title: 'x' }))
})

test('findingId: F- plus the first eight hex characters of the key SHA-256, stable across calls', async () => {
  const { findingId, findingKey } = findingsModule
  assert.equal(typeof findingId, 'function', 'lib/findings.mjs must export findingId')
  assert.equal(typeof findingKey, 'function')
  const { createHash } = await import('node:crypto')
  const finding = { file: 'lib/a.mjs', title: 'Missing null check.' }
  const id = findingId(finding)
  assert.match(id, /^F-[0-9a-f]{8}$/)
  const expected = createHash('sha256').update(findingKey(finding)).digest('hex').slice(0, 8)
  assert.equal(id, `F-${expected}`)
  assert.equal(findingId({ ...finding }), id)
  assert.equal(findingId({ file: 'lib/a.mjs', title: 'missing  NULL check' }), id)
  assert.notEqual(findingId({ file: 'lib/b.mjs', title: 'Missing null check.' }), id)
})
