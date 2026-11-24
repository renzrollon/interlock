// `lib/review-comment.mjs` — the comment a colleague reads (spec: review/pull-request-review,
// "`interlock review comment` SHALL render the comment a colleague reads", "A finding SHALL read
// `Pre-existing` only when its reviewer marked it and the CLI finds its line outside the diff",
// "A pre-existing mark SHALL change the weight of a blocker or a warning only"; design:
// "The comment and its weights", "Pre-existing").
//
// Written before the module exists, reached through a dynamic import inside a helper so the file
// loads and each test fails on its own. Every test name starts with `pr review comment:` because
// task 2.3 runs them by that prefix.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findingId } from '../../lib/findings.mjs'

const loadComment = () => import('../../lib/review-comment.mjs')

const HEAD = 'b'.repeat(40)

const PROVEN = Object.freeze({
  proven: true,
  dimensions: ['regression', 'language'],
  carried: [],
  unproven: [],
  unread: [],
  proseUnread: [],
  uncited: [],
  changed: 2,
  cited: 2,
  reruns: 0,
  rejected: []
})

const COVERAGE = 'Coverage: ran regression, language; 2 of 2 changed source file(s) cited.'

/** A proof that does not hold: a reviewer could not take a measurement that needed a run. */
const UNPROVEN = Object.freeze({
  ...PROVEN,
  proven: false,
  unread: [{ dimension: 'regression', entries: [{ input: 'a build', reason: 'this review does not run the code' }] }]
})

const finding = (over = {}) => ({
  severity: 'warning',
  dimension: 'regression',
  file: 'lib/a.mjs',
  line: 10,
  title: 'Missing null check',
  description: 'The value can be null here.',
  ...over
})

const BLOCKER = finding({ severity: 'blocker', file: 'lib/b.mjs', line: 4, title: 'Drops the last row' })
const WARNING = finding({ severity: 'warning', file: 'lib/a.mjs', line: 10, title: 'Missing null check' })
const NIT = finding({ severity: 'suggestion', file: 'lib/c.mjs', line: 7, title: 'Name this constant' })
const NIT_TWO = finding({ severity: 'suggestion', file: 'lib/d.mjs', line: 8, title: 'Trim this comment' })

/** The text of one table row for a finding, split on its cell pipes. */
function cellsOf(comment, f) {
  const row = comment.split('\n').find(l => l.startsWith('|') && l.includes(findingId(f)))
  assert.ok(row, `no table row for ${findingId(f)} in:\n${comment}`)
  return row.split('|').map(c => c.trim())
}

async function render(findings, over = {}) {
  const { renderReviewerComment } = await loadComment()
  return renderReviewerComment({ head: HEAD, findings, proof: PROVEN, runCode: false, confirmed: [], ...over })
}

/** The paragraphs of a comment, blank-line delimited. */
const paragraphsOf = text => text.trimEnd().split(/\n[ \t]*\n/).map(p => p.trim())

// --- shape ---------------------------------------------------------------------

test('pr review comment: the heading, the weights and their order, and the nits in one collapsed block with a count', async () => {
  const { NOT_AN_APPROVAL_LINE, RAN_NOTHING_LINE } = await loadComment()
  const text = await render([NIT, WARNING, BLOCKER])
  assert.equal(text.split('\n')[0], `## Automated review — ${HEAD}`)
  assert.ok(text.includes('| Id | Weight | Location | Finding |'), text)

  const [, id, weight] = cellsOf(text, BLOCKER)
  assert.equal(id, findingId(BLOCKER))
  assert.equal(weight, 'Important')
  assert.equal(cellsOf(text, WARNING)[2], 'Important')
  assert.equal(cellsOf(text, NIT)[2], 'Nit')
  assert.ok(text.indexOf(findingId(BLOCKER)) < text.indexOf(findingId(WARNING)), 'the blocker comes before the warning')

  const open = text.indexOf('<details>')
  const close = text.indexOf('</details>')
  assert.ok(open > -1 && close > open, text)
  assert.equal(text.split('<details>').length - 1, 1, 'one collapsed block')
  assert.ok(text.includes('<summary>1 nit</summary>'), text)
  assert.ok(text.indexOf(findingId(NIT)) > open && text.indexOf(findingId(NIT)) < close, 'the nit sits inside the block')
  for (const f of [BLOCKER, WARNING]) assert.ok(text.indexOf(findingId(f)) < open, `${findingId(f)} sits outside the block`)

  assert.ok(text.trimEnd().endsWith(NOT_AN_APPROVAL_LINE), 'the closing line is last')
  assert.equal(NOT_AN_APPROVAL_LINE, 'This is an automated review, not an approval. A person decides whether this merges.')
  assert.equal(RAN_NOTHING_LINE, 'Reviewers read the code and ran none of it.')
})

test('pr review comment: two nits are headed `2 nits`', async () => {
  const text = await render([NIT, NIT_TWO])
  assert.ok(text.includes('<summary>2 nits</summary>'), text)
  assert.equal(text.split('<details>').length - 1, 1)
})

test('pr review comment: the coverage line, the run line and the closing line are each a paragraph, in that order, last', async () => {
  const { NOT_AN_APPROVAL_LINE, RAN_NOTHING_LINE } = await loadComment()
  const text = await render([WARNING])
  assert.deepEqual(paragraphsOf(text).slice(-3), [COVERAGE, RAN_NOTHING_LINE, NOT_AN_APPROVAL_LINE])
})

test('pr review comment: a target that allowed running code says so in the run line', async () => {
  const { RAN_CODE_LINE, RAN_NOTHING_LINE, NOT_AN_APPROVAL_LINE } = await loadComment()
  assert.equal(RAN_CODE_LINE, "Reviewers were allowed to run a single test file and the repository's own CLI.")
  const text = await render([WARNING], { runCode: true })
  assert.deepEqual(paragraphsOf(text).slice(-3), [COVERAGE, RAN_CODE_LINE, NOT_AN_APPROVAL_LINE])
  assert.ok(!text.includes(RAN_NOTHING_LINE))
})

test('pr review comment: a proof that does not hold says REVIEW NOT PROVEN with the gaps, directly above the run line', async () => {
  const { RAN_NOTHING_LINE } = await loadComment()
  const text = await render([WARNING], { proof: UNPROVEN })
  const paragraphs = paragraphsOf(text)
  const at = paragraphs.findIndex(p => p.startsWith('REVIEW NOT PROVEN:'))
  assert.ok(at > -1, text)
  assert.equal(paragraphs[at + 1], RAN_NOTHING_LINE, 'the run line follows the not-proven line directly')
  assert.ok(paragraphs[at].includes('a build'), `the gap is named: ${paragraphs[at]}`)
  assert.ok(!text.includes('Coverage: ran'), 'the coverage line is where the not-proven line is')
})

test('pr review comment: a record that carries no proof is not proven either', async () => {
  const text = await render([WARNING], { proof: null })
  assert.ok(paragraphsOf(text).some(p => p.startsWith('REVIEW NOT PROVEN:')), text)
})

test('pr review comment: nothing survived reads as one paragraph with the coverage line, the run line and the closing line', async () => {
  const { NOT_AN_APPROVAL_LINE, RAN_NOTHING_LINE } = await loadComment()
  const text = await render([])
  assert.match(text, /raised no surviving finding/)
  assert.ok(text.includes(COVERAGE), text)
  assert.ok(text.includes(RAN_NOTHING_LINE), text)
  assert.ok(text.trimEnd().endsWith(NOT_AN_APPROVAL_LINE), text)
  assert.ok(!text.includes('| Id |'), 'no table when nothing survived')
  assert.ok(!text.includes('<details>'), 'no collapsed block when nothing survived')
})

// --- severities the CLI does not recognise, and words of the author's loop ------

test('pr review comment: a severity the CLI does not recognise is listed under Important', async () => {
  const odd = finding({ severity: 'critical', file: 'lib/o.mjs', title: 'Odd severity' })
  const text = await render([odd, NIT])
  assert.equal(cellsOf(text, odd)[2], 'Important')
  assert.ok(text.indexOf(findingId(odd)) < text.indexOf('<details>'), 'not folded into the nits')
})

test('pr review comment: outside reviewer text the comment holds no stored severity name, gate word, verdict, score or label name', async () => {
  const text = await render([BLOCKER, WARNING, NIT], { proof: UNPROVEN })
  const reviewerText = [BLOCKER, WARNING, NIT].flatMap(f => [f.title, f.description, f.file])
  let outside = text
  for (const part of reviewerText) outside = outside.split(part).join(' ')
  assert.doesNotMatch(outside, /\b(blocker|warning|suggestion)s?\b/i, outside)
  assert.doesNotMatch(outside, /\b(gate|verdict|score|label)s?\b/i, outside)
})

test('pr review comment: reviewer text renders inert: it mentions nobody, opens no table cell and closes no fence', async () => {
  const hostile = finding({ file: 'lib/h.mjs', line: 3, title: 'Ping @someone | then ``` close the fence', description: 'Hello @someone\n```\nnot a closing fence\n```' })
  const text = await render([hostile])
  // The inline spans removed, what a renderer would act on is what is left.
  const row = text.split('\n').find(l => l.startsWith('|') && l.includes(findingId(hostile)))
  assert.ok(row, text)
  const live = row.replace(/`[^`]*`/g, '')
  assert.ok(!live.includes('@someone'), `a mention outside a span: ${row}`)
  assert.equal(live.split('|').length - 1, 5, `a table pipe outside a span opened a cell: ${row}`)
  // The title's own run of backticks cannot appear in the row, whole.
  assert.ok(!row.includes('```'), row)
  // Every line of the text outside a fence and a span is free of the mention.
  let fenced = null
  for (const line of text.split('\n')) {
    const m = /^(`{3,})\s*$/.exec(line)
    if (m && fenced === null) { fenced = m[1].length; continue }
    if (m && fenced !== null && m[1].length >= fenced) { fenced = null; continue }
    if (fenced === null) assert.ok(!line.replace(/`[^`]*`/g, '').includes('@someone'), `a mention outside a span or fence: ${line}`)
  }
  assert.equal(fenced, null, 'a fence was left open')
})

// --- the weights ---------------------------------------------------------------

test('pr review comment: the three weights are Important, Pre-existing, Nit, frozen', async () => {
  const { WEIGHTS } = await loadComment()
  assert.deepEqual([...WEIGHTS], ['Important', 'Pre-existing', 'Nit'])
  assert.ok(Object.isFrozen(WEIGHTS))
})

test('pr review comment: weightOf maps blocker and warning to Important, a confirmed one to Pre-existing, a suggestion to Nit whether marked or not', async () => {
  const { weightOf } = await loadComment()
  assert.equal(weightOf(BLOCKER, []), 'Important')
  assert.equal(weightOf(WARNING, []), 'Important')
  assert.equal(weightOf(WARNING, [findingId(WARNING)]), 'Pre-existing')
  assert.equal(weightOf(BLOCKER, [findingId(BLOCKER)]), 'Pre-existing')
  assert.equal(weightOf(NIT, []), 'Nit')
  assert.equal(weightOf(NIT, [findingId(NIT)]), 'Nit', 'a marked suggestion stays a nit')
  const odd = finding({ severity: 'critical', title: 'Odd' })
  assert.equal(weightOf(odd, []), 'Important')
  assert.equal(weightOf(odd, [findingId(odd)]), 'Important', 'a mark does not lighten an unrecognised severity')
})

test('pr review comment: a confirmed warning is listed under Pre-existing after the Important rows and outside the collapsed block', async () => {
  const old = finding({ severity: 'warning', file: 'lib/a.mjs', line: 210, title: 'Old unguarded read' })
  const text = await render([NIT, old, BLOCKER], { confirmed: [findingId(old)] })
  assert.equal(cellsOf(text, old)[2], 'Pre-existing')
  assert.equal(cellsOf(text, BLOCKER)[2], 'Important')
  const open = text.indexOf('<details>')
  assert.ok(text.indexOf(findingId(BLOCKER)) < text.indexOf(findingId(old)), 'Pre-existing follows Important')
  assert.ok(text.indexOf(findingId(old)) < open, 'Pre-existing sits outside the collapsed block')
})

// --- confirmPreExisting --------------------------------------------------------

/** What `changedRanges` returns for a diff that changes lib/a.mjs in lines 12 to 40. */
const RANGES = [{ path: 'lib/a.mjs', ranges: [[12, 40]] }]

const marked = (over = {}) => finding({ severity: 'warning', file: 'lib/a.mjs', line: 210, title: 'Old unguarded read', preExisting: true, ...over })

async function confirm(findings, ranges = RANGES) {
  const { confirmPreExisting } = await loadComment()
  return confirmPreExisting(findings, ranges)
}

test('pr review comment: a mark on a line outside every changed range of a changed file is confirmed', async () => {
  const f = marked()
  const r = await confirm([f])
  assert.deepEqual(r.confirmed, [findingId(f)])
  assert.deepEqual(r.refused, [])
})

test('pr review comment: the range edges are changed lines: 12 and 40 are refused, 11 and 41 confirmed', async () => {
  for (const [line, ok] of [[11, true], [12, false], [40, false], [41, true]]) {
    const f = marked({ line })
    const r = await confirm([f])
    assert.deepEqual(r.confirmed, ok ? [findingId(f)] : [], `line ${line}`)
    assert.equal(r.refused.length, ok ? 0 : 1, `line ${line}`)
  }
})

test('pr review comment: a mark on a changed line is refused with its id and a reason', async () => {
  const f = marked({ line: 20 })
  const r = await confirm([f])
  assert.deepEqual(r.confirmed, [])
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].id, findingId(f))
  assert.equal(typeof r.refused[0].reason, 'string')
  assert.ok(r.refused[0].reason.length > 0)
})

test('pr review comment: a mark on a file the diff does not name is confirmed', async () => {
  const f = marked({ file: 'lib/untouched.mjs', line: 5 })
  assert.deepEqual((await confirm([f])).confirmed, [findingId(f)])
})

test('pr review comment: an unmarked finding off the diff is neither confirmed nor refused', async () => {
  const f = marked({ preExisting: undefined, file: 'lib/untouched.mjs' })
  delete f.preExisting
  const r = await confirm([f])
  assert.deepEqual(r, { confirmed: [], refused: [] })
  const falseMark = marked({ preExisting: false, file: 'lib/untouched.mjs' })
  assert.deepEqual(await confirm([falseMark]), { confirmed: [], refused: [] })
})

test('pr review comment: a mark with no line is refused', async () => {
  const f = marked({ line: undefined })
  delete f.line
  const r = await confirm([f])
  assert.deepEqual(r.confirmed, [])
  assert.deepEqual(r.refused.map(x => x.id), [findingId(f)])
})

test('pr review comment: two findings of one identity that disagree are not confirmed', async () => {
  const yes = marked({ dimension: 'regression' })
  const no = marked({ dimension: 'qa' })
  delete no.preExisting
  assert.equal(findingId(yes), findingId(no), 'one identity')
  const r = await confirm([yes, no])
  assert.deepEqual(r.confirmed, [])
  const both = await confirm([yes, marked({ dimension: 'qa' })])
  assert.deepEqual(both.confirmed, [findingId(yes)], 'agreeing marks confirm once')
})

test('pr review comment: a marked suggestion and a marked finding of an unrecognised severity are never confirmed, and never counted as refused', async () => {
  const nit = marked({ severity: 'suggestion', title: 'Rename it' })
  const odd = marked({ severity: 'critical', title: 'Odd severity' })
  const r = await confirm([nit, odd])
  assert.deepEqual(r.confirmed, [])
  assert.deepEqual(r.refused, [])
})

test('pr review comment: ranges of null, the diff could not be read, confirms nothing', async () => {
  const r = await confirm([marked()], null)
  assert.deepEqual(r.confirmed, [])
})

test('pr review comment: a marked finding of an unrecognised severity off the diff still renders under Important', async () => {
  const odd = marked({ severity: 'critical', title: 'Odd severity' })
  const { confirmed } = await confirm([odd])
  const text = await render([odd], { confirmed })
  assert.equal(cellsOf(text, odd)[2], 'Important')
})
