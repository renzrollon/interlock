// The review-findings advisor's draft check, renderer and Review Range tally.
//
// The model drafts; `lib/review-advisor.mjs` decides what of the draft survives,
// by code: positional `F<n>` ids, targets that must resolve against the index
// the review wrote (`D<n>` for a dismissal, two or more distinct `S<n>` for a
// shared root cause, a changed path for an uncovered file), a closed list of
// kinds, a cap applied only after validation, and a `## Dropped` table so
// nothing the model wrote disappears without a reason. The renderer reads no
// clock: the stamp and the brief's path are the caller's, so the same inputs
// give the same bytes.
//
// The generic parts (table, did-not-run stanza, validate-then-cap) live in
// `lib/advisor-kit.mjs`, shared with the checkpoint advisor. The verdict tally
// is `verdictFromLabels` with options, and must leave the checkpoint advisor's
// own verdict as it was.
//
// See add-review-findings-advisor design.md D5, D6, D7, D8, D10, D14, D16.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FLAG_KINDS,
  checkFlags,
  renderReviewAdvisor,
  reviewAdvisorDidNotRun,
  reviewVerdict
} from '../../lib/review-advisor.mjs'
import { table, didNotRunStanza, keepThenCap } from '../../lib/advisor-kit.mjs'
import { verdictFromLabels } from '../../lib/advisor.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const tmpRoots = []
after(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})
const tmp = prefix => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpRoots.push(dir)
  return dir
}

/** The index `interlock review --advisor-brief` writes beside the brief. */
const INDEX = Object.freeze({
  change: 'add-the-thing',
  stamp: '20261022-101010',
  survivors: [
    { id: 'S1', file: 'lib/a.mjs', title: 'Reads the wrong key' },
    { id: 'S2', file: 'lib/b.mjs', title: 'Reads the same key twice' },
    { id: 'S3', file: 'lib/c.mjs', title: 'Unrelated naming slip' }
  ],
  dismissed: [
    { id: 'D1', file: 'lib/a.mjs', title: 'Off by one in the loop' },
    { id: 'D2', file: 'lib/b.mjs', title: 'Missing null check' }
  ],
  changed: ['lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs', 'lib/d.mjs']
})

const flag = (kind, targets, n = 1) => ({ kind, targets, why: `Because ${n}.`, check: `Check ${n}.` })
const doubt = (n = 1, target = 'D1') => flag('dismissal-doubt', [target], n)
const shared = (n = 1, targets = ['S1', 'S2']) => flag('shared-root-cause', targets, n)
const uncovered = (n = 1, path = 'lib/d.mjs') => flag('uncovered', [path], n)

const check = (draft, limits = LIMITS, index = INDEX) => checkFlags(draft, index, limits)
const ids = rows => rows.map(r => r.id)
const droppedReason = (result, id) => result.dropped.find(d => d.id === id)?.reason

// --- the closed list of kinds ----------------------------------------------

test('FLAG_KINDS is the closed list of three kinds, frozen', () => {
  assert.deepEqual([...FLAG_KINDS].sort(), ['dismissal-doubt', 'shared-root-cause', 'uncovered'])
  assert.ok(Object.isFrozen(FLAG_KINDS))
})

// --- ids and kept flags ----------------------------------------------------

test('one flag of each kind with resolving targets is kept as F1, F2, F3 in draft order', () => {
  const result = check({ flags: [doubt(1), shared(2), uncovered(3)] })
  assert.equal(result.status, 'drafted')
  assert.deepEqual(ids(result.flags), ['F1', 'F2', 'F3'])
  assert.deepEqual(
    result.flags.map(f => f.kind),
    ['dismissal-doubt', 'shared-root-cause', 'uncovered']
  )
  assert.deepEqual(result.dropped, [])
  assert.equal(result.flags[0].why, 'Because 1.')
  assert.equal(result.flags[0].check, 'Check 1.')
})

test('ids are positional F<n> and any id the draft wrote is ignored', () => {
  const result = check({
    flags: [
      { ...doubt(1), id: 'F9' },
      { ...doubt(2, 'D2'), id: 'F9' },
      { ...uncovered(3), id: 'X' }
    ]
  })
  assert.deepEqual(ids(result.flags), ['F1', 'F2', 'F3'])
})

test('a dropped flag keeps its draft position, so the survivors after it are not renumbered', () => {
  const result = check({ flags: [doubt(1), doubt(2, 'D9'), doubt(3, 'D2')] })
  assert.deepEqual(ids(result.flags), ['F1', 'F3'])
  assert.deepEqual(ids(result.dropped), ['F2'])
})

// --- drop reasons ----------------------------------------------------------

test('a kind outside the closed list is dropped as unknown kind', () => {
  const result = check({ flags: [flag('vibes', ['D1']), flag('Dismissal-Doubt', ['D1'], 2)] })
  assert.deepEqual(result.flags, [])
  assert.ok(droppedReason(result, 'F1').includes('unknown kind'), droppedReason(result, 'F1'))
  assert.ok(droppedReason(result, 'F2').includes('unknown kind'), droppedReason(result, 'F2'))
})

test('an empty or absent why or check, or a non-object entry, is dropped as missing field', () => {
  const result = check({
    flags: [
      { ...doubt(1), why: '' },
      { ...doubt(2), check: '   ' },
      { kind: 'dismissal-doubt', targets: ['D1'], check: 'c' },
      { kind: 'dismissal-doubt', targets: ['D1'], why: 'w' },
      'a bare string',
      null,
      doubt(7)
    ]
  })
  for (const id of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']) {
    assert.ok(droppedReason(result, id)?.includes('missing field'), `${id}: ${droppedReason(result, id)}`)
  }
  assert.deepEqual(ids(result.flags), ['F7'])
})

test('a dismissal-doubt on a D<n> the index lacks is dropped as no such dismissal', () => {
  const result = check({ flags: [doubt(1, 'D7'), doubt(2, 'S1'), doubt(3, 'D1')] })
  assert.ok(droppedReason(result, 'F1').includes('no such dismissal'), droppedReason(result, 'F1'))
  assert.ok(droppedReason(result, 'F2').includes('no such dismissal'), droppedReason(result, 'F2'))
  assert.deepEqual(ids(result.flags), ['F3'])
})

test('a shared-root-cause with fewer than two distinct survivors is dropped as needing two or more', () => {
  const result = check({
    flags: [shared(1, ['S1']), shared(2, ['S1', 'S1']), shared(3, []), shared(4, ['S1', 'S3'])]
  })
  for (const id of ['F1', 'F2', 'F3']) {
    assert.ok(droppedReason(result, id)?.includes('needs two or more survivors'), `${id}: ${droppedReason(result, id)}`)
  }
  assert.deepEqual(ids(result.flags), ['F4'])
})

test('an uncovered path outside the changed list is dropped as path not changed', () => {
  const result = check({ flags: [uncovered(1, 'lib/z.mjs'), uncovered(2, '/etc/passwd'), uncovered(3, 'lib/c.mjs')] })
  assert.ok(droppedReason(result, 'F1').includes('path not changed'), droppedReason(result, 'F1'))
  assert.ok(droppedReason(result, 'F2').includes('path not changed'), droppedReason(result, 'F2'))
  assert.deepEqual(ids(result.flags), ['F3'])
})

test('an uncovered path is compared through canonicalizePath, so ./lib/a.mjs matches lib/a.mjs', () => {
  const result = check({ flags: [uncovered(1, './lib/a.mjs'), uncovered(2, 'lib//b.mjs'), uncovered(3, 'lib/x/../c.mjs')] })
  assert.deepEqual(ids(result.flags), ['F1', 'F2', 'F3'])
  assert.deepEqual(result.dropped, [])
})

test('an index whose changed list is empty drops every uncovered flag', () => {
  const result = check({ flags: [uncovered(1)] }, LIMITS, { ...INDEX, changed: [] })
  assert.deepEqual(result.flags, [])
  assert.ok(droppedReason(result, 'F1').includes('path not changed'))
})

// --- validate first, cap second --------------------------------------------

test('the cap is read from the limits passed in, not a literal', () => {
  const result = check({ flags: [doubt(1), doubt(2), doubt(3)] }, { ...LIMITS, maxReviewAdvisorFlags: 2 })
  assert.deepEqual(ids(result.flags), ['F1', 'F2'])
  assert.deepEqual(result.dropped, [{ id: 'F3', reason: 'over cap' }])
})

test('an invalid first flag followed by more valid flags than the cap keeps the first cap-many valid ones', () => {
  const draft = {
    flags: [doubt(1, 'D9'), doubt(2), doubt(3, 'D2'), uncovered(4), uncovered(5, 'lib/a.mjs'), shared(6)]
  }
  const result = check(draft, { ...LIMITS, maxReviewAdvisorFlags: 3 })
  assert.deepEqual(ids(result.flags), ['F2', 'F3', 'F4'])
  assert.equal(result.dropped.length, 3)
  assert.ok(droppedReason(result, 'F1').includes('no such dismissal'))
  assert.equal(droppedReason(result, 'F5'), 'over cap')
  assert.equal(droppedReason(result, 'F6'), 'over cap')
})

test('every dropped flag appears in draft order with one reason each', () => {
  const result = check(
    { flags: [flag('vibes', ['D1']), doubt(2, 'D9'), uncovered(3, 'lib/z.mjs'), doubt(4), doubt(5, 'D2')] },
    { ...LIMITS, maxReviewAdvisorFlags: 1 }
  )
  assert.deepEqual(ids(result.dropped), ['F1', 'F2', 'F3', 'F5'])
  assert.deepEqual(ids(result.flags), ['F4'])
  assert.equal(droppedReason(result, 'F5'), 'over cap')
})

// --- empty and malformed drafts --------------------------------------------

test('an empty flags array is drafted, and the rendered tables read none', () => {
  const result = check({ flags: [] })
  assert.equal(result.status, 'drafted')
  assert.deepEqual(result.flags, [])
  assert.deepEqual(result.dropped, [])
  const text = renderReviewAdvisor(result, OPTS)
  assert.equal(section(text, 'Flags').trim(), 'none')
  // The closing line may follow directly under ## Dropped; the table is its first line.
  assert.equal(section(text, 'Dropped').trim().split('\n')[0], 'none')
})

test('a draft that is not a JSON object is a consult that did not run', () => {
  for (const draft of [null, ['x'], 'Sorry, I could not do that.', 42]) {
    const result = check(draft)
    assert.equal(result.status, 'did-not-run', JSON.stringify(draft))
    assert.equal(result.reason, 'draft is not a JSON object', JSON.stringify(draft))
    assert.deepEqual(result.flags, [])
    assert.deepEqual(result.dropped, [])
  }
})

test('a flags value that is not an array is a consult that did not run', () => {
  for (const flags of ['see above', { a: 1 }, 7, null]) {
    const result = check({ flags })
    assert.equal(result.status, 'did-not-run', JSON.stringify(flags))
    assert.equal(result.reason, 'flags is not an array', JSON.stringify(flags))
    assert.deepEqual(result.flags, [])
  }
})

// --- rendering -------------------------------------------------------------

const STAMP = '2026-10-22T10:10:10Z'
const BRIEF = '.claude/metrics/review-advisor-brief-add-the-thing-20261022-101010.md'
const OPTS = { change: 'add-the-thing', stamp: STAMP, briefPath: BRIEF, index: INDEX }

/** The body under a `## <name>` heading, up to the next `## ` heading. */
function section(text, name) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${name}`)
  assert.ok(start >= 0, `missing section ## ${name}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const lastLine = text => text.trimEnd().split('\n').pop()

test('renderReviewAdvisor writes the heading, the status line, the flags and dropped tables and the closing line', () => {
  const result = check({
    flags: [doubt(1), shared(2), uncovered(3, 'lib/d.mjs'), doubt(4, 'D9')]
  })
  const text = renderReviewAdvisor(result, OPTS)
  const lines = text.split('\n')
  assert.match(lines[0], /^# .*add-the-thing/)
  const status = lines.find(l => l.startsWith('drafted'))
  assert.ok(status, 'no drafted status line')
  assert.ok(status.includes(STAMP) && status.includes(BRIEF), status)

  const flags = section(text, 'Flags')
  assert.match(flags, /^\|\s*id\s*\|\s*kind\s*\|\s*targets\s*\|\s*why\s*\|\s*check\s*\|$/m)
  const row = id => flags.split('\n').find(l => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(l))
  assert.ok(row('F1')?.includes('dismissal-doubt') && row('F1').includes('D1'), row('F1'))
  assert.ok(row('F1').includes('Off by one in the loop'), 'D1 is not shown with its finding title')
  assert.ok(row('F1').includes('Because 1.') && row('F1').includes('Check 1.'), row('F1'))
  assert.ok(row('F2')?.includes('S1') && row('F2').includes('S2'), row('F2'))
  assert.ok(row('F2').includes('Reads the wrong key') && row('F2').includes('Reads the same key twice'), row('F2'))
  assert.ok(row('F3')?.includes('lib/d.mjs'), row('F3'))
  assert.equal(row('F4'), undefined, 'a dropped flag is in the flags table')

  const dropped = section(text, 'Dropped')
  assert.match(dropped, /^\|\s*id\s*\|\s*reason\s*\|$/m)
  assert.match(dropped, /^\|\s*F4\s*\|\s*no such dismissal.*\|$/m)

  assert.match(lastLine(text), /no gate reads/i)
})

test('a literal | in why is escaped so it cannot break the table', () => {
  const result = check({ flags: [{ ...doubt(1), why: 'left | right', check: 'a|b' }] })
  const text = renderReviewAdvisor(result, OPTS)
  const row = section(text, 'Flags')
    .split('\n')
    .find(l => /^\|\s*F1\s*\|/.test(l))
  assert.ok(row.includes('left \\| right'), row)
  assert.ok(row.includes('a\\|b'), row)
})

test('the renderer reads no clock: the same inputs give the same bytes, and the stamp is the caller’s', () => {
  const result = check({ flags: [doubt(1), uncovered(2)] })
  assert.equal(renderReviewAdvisor(result, OPTS), renderReviewAdvisor(result, OPTS))
  const later = renderReviewAdvisor(result, { ...OPTS, stamp: '2031-01-01T00:00:00Z' })
  assert.ok(later.includes('2031-01-01T00:00:00Z'))
  assert.ok(!later.includes(STAMP))
})

// --- did-not-run -----------------------------------------------------------

test('a result that did not run renders as the did-not-run stanza carrying its reason', () => {
  const result = check('Sorry')
  const text = renderReviewAdvisor(result, OPTS)
  assert.match(text.split('\n')[0], /^# .*add-the-thing/)
  assert.ok(text.includes('did not run: draft is not a JSON object'), text)
  assert.ok(!text.includes('## Flags'), 'a did-not-run stanza carries no tables')
  assert.match(lastLine(text), /no gate reads/i)
  assert.equal(text, reviewAdvisorDidNotRun('draft is not a JSON object', { change: 'add-the-thing', stamp: STAMP }))
})

test('reviewAdvisorDidNotRun names an empty or absent reason as no reason given and collapses whitespace', () => {
  for (const reason of ['', '   ', undefined, null]) {
    const text = reviewAdvisorDidNotRun(reason, { change: 'add-the-thing', stamp: STAMP })
    assert.ok(text.includes('did not run: no reason given'), JSON.stringify(reason))
  }
  const text = reviewAdvisorDidNotRun('spawn\n errored', { change: 'add-the-thing', stamp: STAMP })
  assert.ok(text.includes('did not run: spawn errored'), text)
  assert.ok(text.includes(STAMP))
})

// --- the shared kit --------------------------------------------------------

test('advisor-kit exports table, didNotRunStanza and keepThenCap', () => {
  assert.equal(typeof table, 'function')
  assert.equal(typeof didNotRunStanza, 'function')
  assert.equal(typeof keepThenCap, 'function')
})

test('table reads none for no rows and escapes a pipe in a cell', () => {
  assert.equal(table(['id', 'reason'], []), 'none')
  const out = table(['id', 'reason'], [['F1', 'a | b']])
  assert.ok(out.split('\n').some(l => l.includes('a \\| b')), out)
  assert.match(out.split('\n')[0], /^\|\s*id\s*\|\s*reason\s*\|$/)
})

// --- module purity ---------------------------------------------------------

test('neither module reads a clock', () => {
  for (const file of ['review-advisor.mjs', 'advisor-kit.mjs']) {
    const src = readFileSync(new URL(`../../lib/${file}`, import.meta.url), 'utf8')
    assert.ok(!/Date\.now\s*\(|new Date\s*\(/.test(src), `lib/${file} reads a clock`)
  }
})

// --- the verdict tally -----------------------------------------------------

function writeLabel(root, caseName, grader, file, label) {
  const dir = join(root, caseName, 'calibration', grader)
  mkdirSync(dir, { recursive: true })
  const labelLine = label === null ? '' : `label: ${label}\n`
  writeFileSync(
    join(dir, `${file}.md`),
    `---\ngrader: ${grader}\ntranscript: ${caseName}-${file}\n${labelLine}---\n\nWhy.\n`
  )
}

const REVIEW_OPTS = {
  prefix: 'review-range-',
  graders: ['matches-label', 'repeats-survivor'],
  minLabels: 4,
  keepMin: 2,
  repeatMax: 100
}

/** `n` Review Range cases, the first `matches` of them passing matches-label. */
function reviewCases(root, n, matches) {
  for (let i = 0; i < n; i++) {
    const c = `review-range-case-${i}`
    writeLabel(root, c, 'matches-label', 't1', i < matches ? 'pass' : 'fail')
    writeLabel(root, c, 'repeats-survivor', 't1', 'pass')
  }
}

test('verdictFromLabels with the Review Range prefix and graders counts only review-range-* cases', () => {
  const root = tmp('review-advisor-verdict-')
  reviewCases(root, 5, 3)
  // A Spec Range case with its own graders is neither counted nor listed.
  writeLabel(root, 'spec-range-x', 'matches-label', 't1', 'pass')
  writeLabel(root, 'spec-range-x', 'answered-already', 't1', 'pass')
  // A review-range case's other graders are not read.
  writeLabel(root, 'review-range-case-0', 'some-other-grader', 't1', null)

  const v = verdictFromLabels(root, LIMITS, REVIEW_OPTS)
  assert.equal(v.step, 'verdict')
  assert.equal(v.labelled, 5)
  assert.equal(v.matches, 3)
  assert.equal(v.verdict, 'KEEP')
  assert.equal(v.caps.minLabels, 4)
  assert.equal(v.caps.keepMinMatches, 2)
  assert.deepEqual(v.problems, [])
})

test('with the Review Range options too few matches is KILL, and too few labels is INSUFFICIENT LABELS', () => {
  const kill = tmp('review-advisor-verdict-')
  reviewCases(kill, 5, 1)
  const k = verdictFromLabels(kill, LIMITS, REVIEW_OPTS)
  assert.equal(k.verdict, 'KILL')
  assert.equal(k.matches, 1)

  const few = tmp('review-advisor-verdict-')
  reviewCases(few, 3, 3)
  const f = verdictFromLabels(few, LIMITS, REVIEW_OPTS)
  assert.equal(f.verdict, 'INSUFFICIENT LABELS (3 of 4)')
})

test('a malformed review-range label is listed under problems for the review tally and not counted', () => {
  const root = tmp('review-advisor-verdict-')
  reviewCases(root, 4, 4)
  writeLabel(root, 'review-range-bad', 'matches-label', 't1', null)
  writeLabel(root, 'review-range-bad', 'repeats-survivor', 't1', 'pass')
  const v = verdictFromLabels(root, LIMITS, REVIEW_OPTS)
  assert.equal(v.labelled, 4)
  assert.equal(v.problems.length, 1)
  assert.ok(v.problems[0].includes(join('review-range-bad', 'calibration', 'matches-label')), v.problems[0])
})

test('with no options verdictFromLabels returns what it returned before, on a tree holding both families', () => {
  const root = tmp('review-advisor-verdict-')
  reviewCases(root, 5, 5)
  for (let i = 0; i < 3; i++) {
    writeLabel(root, `spec-range-c${i}`, 'matches-label', 't1', 'pass')
    writeLabel(root, `spec-range-c${i}`, 'answered-already', 't1', 'pass')
  }
  // A malformed review-range file must not surface in the checkpoint verdict.
  writeLabel(root, 'review-range-bad', 'matches-label', 't1', null)

  const caps = { advisorVerdictMinLabels: 10, advisorKeepMinMatches: 3, advisorRepeatMaxPercent: 50 }
  const v = verdictFromLabels(root, caps)
  assert.deepEqual(v, {
    step: 'verdict',
    verdict: 'INSUFFICIENT LABELS (3 of 10)',
    labelled: 3,
    matches: 3,
    repeats: 0,
    caps: { minLabels: 10, keepMinMatches: 3, repeatMaxPercent: 50 },
    reasons: [],
    problems: []
  })
})

test('reviewVerdict tallies the Review Range with its own caps and an empty tree is insufficient', () => {
  const empty = reviewVerdict(tmp('review-advisor-verdict-'), LIMITS)
  assert.equal(empty.verdict, `INSUFFICIENT LABELS (0 of ${LIMITS.reviewAdvisorVerdictMinLabels})`)
  assert.equal(empty.caps.minLabels, LIMITS.reviewAdvisorVerdictMinLabels)
  assert.equal(empty.caps.keepMinMatches, LIMITS.reviewAdvisorKeepMinMatches)

  const root = tmp('review-advisor-verdict-')
  reviewCases(root, 3, 2)
  const caps = { ...LIMITS, reviewAdvisorVerdictMinLabels: 3, reviewAdvisorKeepMinMatches: 2 }
  const v = reviewVerdict(root, caps)
  assert.equal(v.verdict, 'KEEP')
  assert.equal(v.labelled, 3)
  assert.equal(v.matches, 2)

  const killed = reviewVerdict(root, { ...caps, reviewAdvisorKeepMinMatches: 3 })
  assert.equal(killed.verdict, 'KILL')
})

test('reviewVerdict never reads Spec Range cases', () => {
  const root = tmp('review-advisor-verdict-')
  for (let i = 0; i < 12; i++) {
    writeLabel(root, `spec-range-c${i}`, 'matches-label', 't1', 'pass')
    writeLabel(root, `spec-range-c${i}`, 'repeats-survivor', 't1', 'pass')
    writeLabel(root, `spec-range-c${i}`, 'answered-already', 't1', 'pass')
  }
  const v = reviewVerdict(root, LIMITS)
  assert.equal(v.labelled, 0)
  assert.ok(v.verdict.startsWith('INSUFFICIENT LABELS (0 of'), v.verdict)
})
