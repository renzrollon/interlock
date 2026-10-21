// The checkpoint advisor's draft check and renderer. The model drafts; this
// module decides what of the draft survives, by code: positional ids, citations
// that must resolve to a heading that exists, a closed list of risk kinds, a cap
// applied only after validation, and a `## Dropped` table so nothing the model
// wrote disappears without a reason. The renderer reads no clock — the stamp and
// the brief's path are the caller's, so the same inputs give the same bytes.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RISK_KINDS,
  headingIndex,
  checkDraft,
  renderAdvisor,
  didNotRun
} from '../../lib/advisor.mjs'
import { LIMITS } from '../../lib/limits.mjs'

const tmpRoots = []
after(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

const TASKS = `## 1. Failing tests first

- [ ] 1.1 Write the advisor tests
- [x] 1.2 Write the brief tests

## 2. Pure modules

- [ ] 2.1 Add the caps
- [ ] 3.4 An out-of-order checkbox id still counts
`

/** A change folder with the four citable artifact kinds and the two files that are not citable. */
function changeFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-check-'))
  tmpRoots.push(dir)
  writeFileSync(join(dir, 'proposal.md'), '# Proposal\n\n## Why\n\nBecause.\n\n## What Changes\n\n- a thing\n')
  writeFileSync(
    join(dir, 'design.md'),
    '# Design\n\n## Decisions\n\n### How the consult runs (D2)\n\nOnce.\n\n#### A deep heading\n\nDeep.\n'
  )
  writeFileSync(join(dir, 'tasks.md'), TASKS)
  mkdirSync(join(dir, 'specs', 'spec', 'checkpoint-advisor'), { recursive: true })
  writeFileSync(
    join(dir, 'specs', 'spec', 'checkpoint-advisor', 'spec.md'),
    '# spec\n\n## ADDED Requirements\n\n### Requirement: The brief SHALL be bounded\n\nIt SHALL.\n'
  )
  // Neither is citable: the ledger is quoted to the advisor but is the human's
  // record, and advisor.md is the check's own output.
  writeFileSync(join(dir, 'decisions.md'), '# Decisions\n\n## Ledger heading\n')
  writeFileSync(join(dir, 'advisor.md'), '# Advisor\n\n## Questions for the human\n')
  return dir
}

const q = (n, cite = 'design.md#Decisions') => ({
  question: `Question ${n}?`,
  why: `Because ${n}.`,
  cite
})

const check = (draft, limits = LIMITS) => {
  const dir = changeFolder()
  return checkDraft(draft, headingIndex(dir), readFileSync(join(dir, 'tasks.md'), 'utf8'), limits)
}

const ids = rows => rows.map(r => r.id)
const droppedReason = (result, id) => result.dropped.find(d => d.id === id)?.reason

// --- RISK_KINDS ------------------------------------------------------------

test('RISK_KINDS is the closed list of fourteen kinds docs/02 names, frozen', () => {
  assert.deepEqual(
    [...RISK_KINDS],
    [
      'scope-expansion',
      'unstated-assumption',
      'reuse-missed',
      'unpinned-dependency',
      'error-path-missing',
      'single-caller-abstraction',
      'decision-without-rationale',
      'deferred-work',
      'vague-task',
      'sibling-left',
      'same-file-split',
      'untestable-spec',
      'function-named-scenario',
      'no-failure-path'
    ]
  )
  assert.ok(Object.isFrozen(RISK_KINDS))
})

// --- headingIndex ----------------------------------------------------------

test('headingIndex is keyed by the citable files only: the three artifacts and each specs/** path', () => {
  const index = headingIndex(changeFolder())
  assert.deepEqual(Object.keys(index).sort(), [
    'design.md',
    'proposal.md',
    'specs/spec/checkpoint-advisor/spec.md',
    'tasks.md'
  ])
})

// --- citation resolution ---------------------------------------------------

test('a cite resolves against ##, ### and #### headings, folded for case and surrounding whitespace', () => {
  const result = check({
    questions: [
      q(1, 'design.md#Decisions'),
      q(2, 'design.md#  how the consult runs (d2)  '),
      q(3, 'design.md#A deep heading'),
      q(4, 'tasks.md#1. Failing tests first'),
      q(5, 'specs/spec/checkpoint-advisor/spec.md#Requirement: The brief SHALL be bounded'),
      q(6, 'proposal.md#WHAT CHANGES')
    ],
    risks: []
  })
  assert.equal(result.status, 'drafted')
  assert.deepEqual(ids(result.questions), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'])
  assert.deepEqual(result.dropped, [])
})

test('a cite that names no citable file, no # heading, a top-level # heading, or a non-citable file does not resolve', () => {
  const result = check({
    questions: [
      q(1, 'design.md#Nonexistent'),
      q(2, 'design.md'), // no heading part
      q(3, 'design.md#Design'), // the `#` title is not a citable heading
      q(4, 'decisions.md#Ledger heading'), // the ledger is quoted, not citable
      q(5, 'advisor.md#Questions for the human'),
      q(6, 'README.md#Install'),
      q(7, 'design.md#Decisions')
    ]
  })
  for (const id of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) {
    assert.equal(droppedReason(result, id), 'cite does not resolve', id)
  }
  assert.deepEqual(ids(result.questions), ['Q7'])
})

test('a question missing question or cite is dropped with missing field; a non-object entry too', () => {
  const result = check({
    questions: [
      { why: 'no question', cite: 'design.md#Decisions' },
      { question: 'No cite?', why: 'w' },
      'a bare string',
      q(4)
    ],
    risks: []
  })
  assert.equal(droppedReason(result, 'Q1'), 'missing field')
  assert.equal(droppedReason(result, 'Q2'), 'missing field')
  assert.equal(droppedReason(result, 'Q3'), 'missing field')
  assert.deepEqual(ids(result.questions), ['Q4'])
})

// --- ids, order, cap -------------------------------------------------------

test('ids are positional Q<n>/R<n> and any id the draft wrote is ignored', () => {
  const result = check({
    questions: [
      { ...q(1), id: 'Q9' },
      { ...q(2), id: 'Q9' },
      { ...q(3), id: 'X' }
    ],
    risks: [
      { id: 'R7', task: '2.1', kind: 'vague-task', note: 'n1' },
      { task: '1.1', kind: 'deferred-work', note: 'n2' }
    ]
  })
  assert.deepEqual(ids(result.questions), ['Q1', 'Q2', 'Q3'])
  assert.deepEqual(ids(result.risks), ['R1', 'R2'])
  assert.deepEqual(result.questions[0], {
    id: 'Q1',
    question: 'Question 1?',
    why: 'Because 1.',
    cite: 'design.md#Decisions'
  })
})

test('thirteen questions, bad cites at 4 and 7: validate first, cap second, ten kept in draft order', () => {
  const questions = Array.from({ length: 13 }, (_, i) =>
    q(i + 1, i + 1 === 4 || i + 1 === 7 ? 'design.md#Nonexistent' : 'design.md#Decisions')
  )
  // The scenario is written against a cap of ten; pass it explicitly so the
  // test pins the order of validate-then-cap, not the shipped value.
  const result = check(
    { questions, risks: [{ task: '2.1', kind: 'vibes', note: 'feels off' }] },
    { ...LIMITS, maxAdvisorQuestions: 10 }
  )
  assert.equal(result.status, 'drafted')
  assert.deepEqual(ids(result.questions), ['Q1', 'Q2', 'Q3', 'Q5', 'Q6', 'Q8', 'Q9', 'Q10', 'Q11', 'Q12'])
  assert.deepEqual(result.dropped, [
    { id: 'Q4', reason: 'cite does not resolve' },
    { id: 'Q7', reason: 'cite does not resolve' },
    { id: 'Q13', reason: 'over cap' },
    { id: 'R1', reason: 'unknown kind' }
  ])
  assert.deepEqual(result.risks, [])
})

test('the cap is read from the limits passed in, not a literal', () => {
  const result = check({ questions: [q(1), q(2), q(3)] }, { ...LIMITS, maxAdvisorQuestions: 2 })
  assert.deepEqual(ids(result.questions), ['Q1', 'Q2'])
  assert.deepEqual(result.dropped, [{ id: 'Q3', reason: 'over cap' }])
})

// --- risks -----------------------------------------------------------------

test('a risk lies at a task checkbox or a cite; where reads task <id> or the cite as written', () => {
  const result = check({
    questions: [],
    risks: [
      { task: '2.1', kind: 'vague-task', note: 'which caps?' },
      { task: '3.4', kind: 'sibling-left', note: 'the other reader' },
      { cite: 'proposal.md#What Changes', kind: 'scope-expansion', note: 'too much' }
    ]
  })
  assert.deepEqual(result.risks, [
    { id: 'R1', where: 'task 2.1', kind: 'vague-task', note: 'which caps?' },
    { id: 'R2', where: 'task 3.4', kind: 'sibling-left', note: 'the other reader' },
    { id: 'R3', where: 'proposal.md#What Changes', kind: 'scope-expansion', note: 'too much' }
  ])
  assert.deepEqual(result.dropped, [])
})

test('a risk is dropped no such task, cite does not resolve, missing field or unknown kind', () => {
  const result = check({
    questions: [],
    risks: [
      { task: '9.9', kind: 'vague-task', note: 'n' },
      { cite: 'design.md#Nonexistent', kind: 'reuse-missed', note: 'n' },
      { kind: 'deferred-work', note: 'n' },
      { task: '1.2', kind: 'vibes', note: 'n' },
      { task: '1.2', kind: 'deferred-work', note: 'kept — a checked box is still a checkbox' }
    ]
  })
  assert.deepEqual(result.dropped, [
    { id: 'R1', reason: 'no such task' },
    { id: 'R2', reason: 'cite does not resolve' },
    { id: 'R3', reason: 'missing field' },
    { id: 'R4', reason: 'unknown kind' }
  ])
  assert.deepEqual(ids(result.risks), ['R5'])
})

// --- the empty draft and the did-not-run shapes ----------------------------

test('an empty draft is drafted with zero rows', () => {
  const result = check({ questions: [], risks: [] })
  assert.equal(result.status, 'drafted')
  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.risks, [])
  assert.deepEqual(result.dropped, [])
})

test('absent questions or risks read as empty, not as a failure', () => {
  const result = check({})
  assert.equal(result.status, 'drafted')
  assert.deepEqual(result.questions, [])
  assert.deepEqual(result.risks, [])
})

test('a non-array questions or risks, or a draft that is not an object, is a consult that did not run', () => {
  const cases = [
    [{ questions: 'see above' }, 'questions is not an array'],
    [{ questions: [], risks: { a: 1 } }, 'risks is not an array'],
    [null, 'draft is not a JSON object'],
    [[q(1)], 'draft is not a JSON object'],
    ['Sorry, I could not do that.', 'draft is not a JSON object'],
    [42, 'draft is not a JSON object']
  ]
  for (const [draft, reason] of cases) {
    const result = check(draft)
    assert.equal(result.status, 'did-not-run', JSON.stringify(draft))
    assert.equal(result.reason, reason, JSON.stringify(draft))
    assert.deepEqual(result.questions, [])
    assert.deepEqual(result.risks, [])
    assert.deepEqual(result.dropped, [])
  }
})

// --- rendering -------------------------------------------------------------

const STAMP = '2026-10-19T12:10:00Z'
const BRIEF = '.claude/metrics/advisor-brief-add-the-thing-20261019-120000.md'
const OPTS = { change: 'add-the-thing', stamp: STAMP, briefPath: BRIEF }

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

function assertClosingLine(text) {
  const line = lastLine(text)
  for (const token of ['advisory', 'interlock ready', 'interlock ledger', 'interlock validate', 'decisions.md']) {
    assert.ok(line.includes(token), `closing line lacks ${token}: ${line}`)
  }
}

test('renderAdvisor writes the heading, the drafted line, the three tables and the closing line', () => {
  const result = check({
    questions: [q(1), q(2, 'tasks.md#1. Failing tests first')],
    risks: [
      { task: '2.1', kind: 'vague-task', note: 'which caps?' },
      { cite: 'proposal.md#What Changes', kind: 'scope-expansion', note: 'too much' },
      { task: '9.9', kind: 'vague-task', note: 'gone' }
    ]
  })
  const text = renderAdvisor(result, OPTS)
  const lines = text.split('\n')
  assert.match(lines[0], /^# .*add-the-thing/)
  assert.ok(lines.includes(`drafted ${STAMP} from ${BRIEF}`), 'status line')

  const questions = section(text, 'Questions for the human')
  assert.match(questions, /^\|\s*id\s*\|\s*question\s*\|\s*why\s*\|\s*cites\s*\|$/m)
  assert.match(questions, /^\|\s*Q1\s*\|\s*Question 1\?\s*\|\s*Because 1\.\s*\|\s*design\.md#Decisions\s*\|$/m)
  assert.match(questions, /^\|\s*Q2\s*\|.*tasks\.md#1\. Failing tests first\s*\|$/m)

  const risks = section(text, 'Risks')
  assert.match(risks, /^\|\s*id\s*\|\s*where\s*\|\s*kind\s*\|\s*note\s*\|$/m)
  assert.match(risks, /^\|\s*R1\s*\|\s*task 2\.1\s*\|\s*vague-task\s*\|\s*which caps\?\s*\|$/m)
  assert.match(risks, /^\|\s*R2\s*\|\s*proposal\.md#What Changes\s*\|\s*scope-expansion\s*\|/m)

  const dropped = section(text, 'Dropped')
  assert.match(dropped, /^\|\s*id\s*\|\s*reason\s*\|$/m)
  assert.match(dropped, /^\|\s*R3\s*\|\s*no such task\s*\|$/m)

  assertClosingLine(text)
})

test('a table with no rows reads none', () => {
  const text = renderAdvisor(check({ questions: [], risks: [] }), OPTS)
  for (const name of ['Questions for the human', 'Risks', 'Dropped']) {
    assert.equal(section(text, name).trim(), 'none', name)
  }
  assertClosingLine(text)
})

test('a literal | in a cell is escaped so the table keeps its columns', () => {
  const text = renderAdvisor(
    check({ questions: [{ question: 'a | b?', why: 'c | d', cite: 'design.md#Decisions' }] }),
    OPTS
  )
  assert.ok(text.includes('a \\| b?'))
  assert.ok(text.includes('c \\| d'))
})

test('without a brief path the status line says drafted <stamp> and no from', () => {
  const text = renderAdvisor(check({ questions: [q(1)] }), { change: 'add-the-thing', stamp: STAMP })
  const status = text.split('\n').find(l => l.startsWith('drafted '))
  assert.equal(status, `drafted ${STAMP}`)
  assert.ok(!text.includes('undefined'))
})

test('the same inputs give the same bytes, and the stamp is the caller\'s', () => {
  const result = check({ questions: [q(1)], risks: [] })
  const a = renderAdvisor(result, OPTS)
  const b = renderAdvisor(result, OPTS)
  assert.equal(a, b)
  const other = renderAdvisor(result, { ...OPTS, stamp: '2030-01-01T00:00:00Z' })
  assert.ok(other.includes('drafted 2030-01-01T00:00:00Z'))
})

test('lib/advisor.mjs reads no clock', () => {
  const src = readFileSync(new URL('../../lib/advisor.mjs', import.meta.url), 'utf8')
  assert.ok(!/Date\.now\s*\(/.test(src), 'Date.now() in lib/advisor.mjs')
  assert.ok(!/new Date\s*\(/.test(src), 'new Date() in lib/advisor.mjs')
})

// --- did not run -----------------------------------------------------------

test('didNotRun writes the heading, did not run: <reason>, no tables, and the closing line', () => {
  const text = didNotRun('agent spawn errored', { change: 'add-the-thing', stamp: STAMP })
  assert.match(text.split('\n')[0], /^# .*add-the-thing/)
  assert.ok(text.split('\n').includes('did not run: agent spawn errored'))
  for (const name of ['Questions for the human', 'Risks', 'Dropped']) {
    assert.ok(!text.includes(`## ${name}`), `did-not-run carries ## ${name}`)
  }
  assertClosingLine(text)
  assert.equal(text, didNotRun('agent spawn errored', { change: 'add-the-thing', stamp: STAMP }))
})

test('an empty or blank reason reads no reason given', () => {
  for (const reason of ['', '   ', undefined]) {
    const text = didNotRun(reason, { change: 'add-the-thing', stamp: STAMP })
    assert.ok(text.split('\n').includes('did not run: no reason given'), JSON.stringify(reason))
  }
})

test('renderAdvisor of a did-not-run result is the did-not-run stanza', () => {
  const result = check({ questions: 'see above' })
  assert.equal(
    renderAdvisor(result, OPTS),
    didNotRun('questions is not an array', { change: 'add-the-thing', stamp: STAMP, briefPath: BRIEF })
  )
})
