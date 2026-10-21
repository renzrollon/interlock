// The advisor's brief and the kill criterion's tally.
//
// The brief is assembled by code from inputs the CLI chose — artifact texts, the
// ledger or its absence, the review's findings or why there are none, the
// matched compound notes — and bounded by a cap that cuts whole sections in a
// fixed order and names every cut. The parts the consult must read (tasks, the
// ledger, the findings, the instructions) are never cut; when they alone exceed
// the cap the overrun is spoken, never met by cutting them.
//
// The verdict tallies the Spec Range cases' human labels against caps and prints
// a statement for a person. It counts only the two Spec Range graders, and only
// the Spec Range cases.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assembleBrief, planBrief } from '../../lib/prompts/advisor.mjs'
import { RISK_KINDS, verdictFromLabels } from '../../lib/advisor.mjs'
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

// --- the brief -------------------------------------------------------------

const PROPOSAL = '## Why\n\nPROPOSAL-BODY a reason.\n\n## What Changes\n\n- one thing\n'
const DESIGN = '## Decisions\n\nDESIGN-BODY decided.\n'
const TASKS = '## 1. Tests\n\n- [ ] 1.1 Write tests for `lib/a.mjs`\n- [ ] 1.2 Edit `lib/b.mjs`\n'
const LEDGER = '# Decisions — add-the-thing\n\n| id | question | class | resolution | evidence |\n|----|----|----|----|----|\n| D1 | LEDGER-ROW? | needs_human | — | — |\n'

const SPEC_A = { path: 'specs/a/spec.md', text: '## ADDED Requirements\n\n### Requirement: SPEC-A\n\nIt SHALL.\n' }
const SPEC_B = { path: 'specs/b/spec.md', text: '## ADDED Requirements\n\n### Requirement: SPEC-B\n\nIt SHALL.\n' }

const note = (n, file = 'lib/a.mjs') => ({
  id: `N${n}`,
  date: '2026-10-19',
  change: 'add-x',
  file,
  surprise: `NOTE-${n} the review found a sibling reader.`,
  rule: `Name every reader of the raw form (${n}).`,
  source: 'run-123'
})

const FINDINGS = [
  { file: 'design.md', title: 'FINDING-ONE the cap is unstated', severity: 'warning' },
  { file: 'tasks.md', title: 'FINDING-TWO a vague task', severity: 'suggestion' }
]

function input(overrides = {}) {
  return {
    change: 'add-the-thing',
    stamp: '2026-10-19T12:00:00Z',
    proposal: PROPOSAL,
    design: DESIGN,
    tasks: TASKS,
    specs: [SPEC_A, SPEC_B],
    ledger: LEDGER,
    findings: FINDINGS,
    notes: { rows: [note(1), note(2, 'lib/b.mjs')], omitted: 0, unreadableRows: 0 },
    limits: LIMITS,
    riskKinds: RISK_KINDS,
    ...overrides
  }
}

/** The body under a `## <name>` heading, up to the next `## ` heading, or null. */
function section(text, name) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${name}`)
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => l.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const headingNaming = (text, file) =>
  new RegExp(`^#{2,4} .*${file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'm').test(text)

test('assembleBrief is the text planBrief plans, and planBrief reports its size, cuts and overrun', () => {
  const plan = planBrief(input())
  assert.equal(typeof plan.text, 'string')
  assert.equal(assembleBrief(input()), plan.text)
  assert.equal(plan.chars, plan.text.length)
  assert.deepEqual(plan.omitted, [])
  assert.equal(plan.overrun, 0)
  assert.ok(!plan.text.includes('cap exceeded'))
})

test('each artifact is quoted under a heading naming it, and the ledger is quoted when present', () => {
  const text = assembleBrief(input())
  for (const [file, body] of [
    ['proposal.md', 'PROPOSAL-BODY'],
    ['design.md', 'DESIGN-BODY'],
    ['tasks.md', '1.1 Write tests'],
    ['specs/a/spec.md', 'Requirement: SPEC-A'],
    ['specs/b/spec.md', 'Requirement: SPEC-B'],
    ['decisions.md', 'LEDGER-ROW?']
  ]) {
    assert.ok(headingNaming(text, file), `no heading names ${file}`)
    assert.ok(text.includes(body), `${file} is not quoted`)
  }
  assert.ok(!text.includes('ledger: absent'))
})

test('an absent ledger is said, not implied', () => {
  const text = assembleBrief(input({ ledger: null }))
  assert.ok(text.includes('ledger: absent'))
  assert.ok(!text.includes('LEDGER-ROW?'))
})

test('findings are listed as already raised; none given and unreadable are said', () => {
  const given = assembleBrief(input())
  assert.ok(given.includes('already raised'))
  for (const f of FINDINGS) {
    for (const cell of [f.file, f.title, f.severity]) assert.ok(given.includes(cell), cell)
  }
  assert.ok(!given.includes('review findings: none given'))

  const none = assembleBrief(input({ findings: null }))
  assert.ok(none.includes('review findings: none given'))
  assert.ok(!none.includes('FINDING-ONE'))

  const unreadable = assembleBrief(input({ findings: { unreadable: 'ENOENT: no such file' } }))
  assert.ok(unreadable.includes('review findings: unreadable — ENOENT: no such file'))
})

test('compound notes: the matched rows, none matched, unreadable, and the unreadable-rows count beside good rows', () => {
  const matched = assembleBrief(input())
  assert.ok(matched.includes('NOTE-1') && matched.includes('NOTE-2'))
  assert.ok(matched.includes('Name every reader of the raw form (1).'))
  assert.ok(!matched.includes('compound notes: none matched'))
  assert.ok(!/rows unreadable/.test(matched))

  for (const notes of [null, undefined, { rows: [], omitted: 0, unreadableRows: 0 }]) {
    const text = assembleBrief(input({ notes }))
    assert.ok(text.includes('compound notes: none matched'), JSON.stringify(notes))
  }

  const unreadable = assembleBrief(input({ notes: { unreadable: 'no header row' } }))
  assert.ok(unreadable.includes('compound notes: unreadable — no header row'))
  assert.ok(!unreadable.includes('compound notes: none matched'), 'unreadable must not read as empty')

  const partial = assembleBrief(input({ notes: { rows: [note(1), note(2)], omitted: 0, unreadableRows: 1 } }))
  assert.ok(partial.includes('compound notes: 1 rows unreadable'))
  assert.ok(partial.includes('NOTE-1') && partial.includes('NOTE-2'))
})

test('a non-zero omitted note count is named', () => {
  const text = assembleBrief(input({ notes: { rows: [note(1)], omitted: 10, unreadableRows: 0 } }))
  assert.ok(text.includes('10 notes omitted'))
})

test('the brief states the cap, every risk kind, the reply shape and the cite form', () => {
  const text = assembleBrief(input({ limits: { ...LIMITS, maxAdvisorQuestions: 7 } }))
  assert.ok(
    text.split('\n').some(l => /question/i.test(l) && /\b7\b/.test(l)),
    'no line states the question cap read from the limits passed in'
  )
  for (const kind of RISK_KINDS) assert.ok(text.includes(kind), kind)
  for (const field of ['"questions"', '"risks"', '"question"', '"why"', '"cite"', '"task"', '"kind"', '"note"']) {
    assert.ok(text.includes(field), `reply shape lacks ${field}`)
  }
  assert.ok(text.includes('<file>#<heading>'))
})

test('the citable files are the artifacts and each spec path; the ledger is quoted but not citable', () => {
  const text = assembleBrief(input())
  const citable = section(text, 'Citable files')
  assert.ok(citable, 'no ## Citable files section')
  for (const file of ['proposal.md', 'design.md', 'tasks.md', 'specs/a/spec.md', 'specs/b/spec.md']) {
    assert.ok(citable.includes(file), file)
  }
  assert.ok(!citable.includes('decisions.md'))
})

test('the brief copies no <context>, <rules> or <project_context> block', () => {
  const text = assembleBrief(input())
  for (const tag of ['<context>', '<rules>', '<project_context>']) assert.ok(!text.includes(tag), tag)
})

test('the same inputs give the same bytes; the stamp is an input, not a clock read', () => {
  assert.equal(assembleBrief(input()), assembleBrief(input()))
  const later = assembleBrief(input({ stamp: '2030-01-01T00:00:00Z' }))
  assert.ok(later.includes('2030-01-01T00:00:00Z'))
  assert.ok(!later.includes('2026-10-19T12:00:00Z'))
  const src = readFileSync(new URL('../../lib/prompts/advisor.mjs', import.meta.url), 'utf8')
  assert.ok(!/Date\.now\s*\(|new Date\s*\(/.test(src), 'lib/prompts/advisor.mjs reads a clock')
  assert.ok(!/from ['"]node:/.test(src), 'lib/prompts/advisor.mjs does file or process I/O')
})

// --- the cap ----------------------------------------------------------------

test('over the cap: notes then the larger spec are cut whole, named under ## Omitted, the rest kept', () => {
  const bigSpec = { path: 'specs/big/spec.md', text: '### Requirement: BIG\n\n' + 'big spec line.\n'.repeat(400) }
  const smallSpec = { path: 'specs/small/spec.md', text: '### Requirement: SMALL\n\nsmall.\n' }
  const notes = {
    rows: Array.from({ length: 12 }, (_, i) => note(i + 1)),
    omitted: 0,
    unreadableRows: 0
  }
  const full = planBrief(input({ specs: [smallSpec, bigSpec], notes }))
  assert.equal(full.overrun, 0)
  // Room for everything but the notes and the big spec, with slack for the
  // `## Omitted` section the cut adds.
  const cap = full.chars - bigSpec.text.length - 200
  const plan = planBrief(input({ specs: [smallSpec, bigSpec], notes, limits: { ...LIMITS, maxAdvisorBriefChars: cap } }))

  assert.deepEqual(plan.omitted, ['compound notes', 'specs/big/spec.md'])
  assert.equal(plan.overrun, 0)
  assert.ok(plan.chars <= cap, `${plan.chars} > ${cap}`)
  assert.equal(plan.chars, plan.text.length)

  const omitted = section(plan.text, 'Omitted')
  assert.ok(omitted, 'no ## Omitted section')
  assert.ok(omitted.includes('compound notes') && omitted.includes('specs/big/spec.md'))
  assert.ok(!plan.text.includes('big spec line.'))
  assert.ok(!plan.text.includes('NOTE-1 '))
  for (const kept of ['Requirement: SMALL', 'DESIGN-BODY', 'PROPOSAL-BODY', '1.1 Write tests', 'LEDGER-ROW?', 'FINDING-ONE']) {
    assert.ok(plan.text.includes(kept), `${kept} was cut`)
  }
  assert.ok(!plan.text.includes('cap exceeded'))
})

test('the cut order is notes, specs largest first one at a time, design, proposal', () => {
  const s1 = { path: 'specs/one/spec.md', text: 'x'.repeat(300) }
  const s2 = { path: 'specs/two/spec.md', text: 'y'.repeat(900) }
  const s3 = { path: 'specs/three/spec.md', text: 'z'.repeat(600) }
  // A cap no cuttable set can meet: everything cuttable goes, in order.
  const plan = planBrief(input({ specs: [s1, s2, s3], limits: { ...LIMITS, maxAdvisorBriefChars: 1 } }))
  assert.deepEqual(plan.omitted, [
    'compound notes',
    'specs/two/spec.md',
    'specs/three/spec.md',
    'specs/one/spec.md',
    'design.md',
    'proposal.md'
  ])
})

test('when the never-cut sections alone exceed the cap, all are kept and the overrun is spoken', () => {
  const tasks = '## 1. Tests\n\n' + '- [ ] 1.1 a long task line that is never cut\n'.repeat(80)
  const cap = 1000
  assert.ok(tasks.length > cap)
  const plan = planBrief(input({ tasks, limits: { ...LIMITS, maxAdvisorBriefChars: cap } }))
  assert.equal(plan.omitted.length, 5)
  for (const name of ['compound notes', 'specs/a/spec.md', 'specs/b/spec.md', 'design.md', 'proposal.md']) {
    assert.ok(plan.omitted.includes(name), name)
  }
  assert.ok(plan.text.includes(tasks.trim()), 'tasks.md was cut')
  assert.ok(plan.text.includes('LEDGER-ROW?'), 'the ledger was cut')
  assert.ok(plan.text.includes('FINDING-ONE'), 'the findings were cut')
  for (const kind of RISK_KINDS) assert.ok(plan.text.includes(kind), 'the instructions were cut')
  assert.equal(plan.overrun, plan.chars - cap)
  assert.ok(plan.overrun > 0)
  const omitted = section(plan.text, 'Omitted')
  assert.ok(omitted && omitted.includes(`cap exceeded by ${plan.overrun} chars`))
})

// --- the verdict -----------------------------------------------------------

const CAPS = { advisorVerdictMinLabels: 10, advisorKeepMinMatches: 3, advisorRepeatMaxPercent: 50 }

function writeLabel(root, caseName, grader, file, label) {
  const dir = join(root, caseName, 'calibration', grader)
  mkdirSync(dir, { recursive: true })
  const labelLine = label === null ? '' : `label: ${label}\n`
  writeFileSync(
    join(dir, `${file}.md`),
    `---\ngrader: ${grader}\ntranscript: ${caseName}-${file}\n${labelLine}---\n\nWhy.\n`
  )
}

/** Ten Spec Range cases, `matches` of them passing matches-label and `repeats` failing answered-already. */
function tenCases({ matches, repeats }) {
  const root = tmp('advisor-verdict-')
  for (let i = 0; i < 10; i++) {
    const c = `spec-range-case-${i}`
    writeLabel(root, c, 'matches-label', 't1', i < matches ? 'pass' : 'fail')
    writeLabel(root, c, 'answered-already', 't1', i < repeats ? 'fail' : 'pass')
  }
  return root
}

test('ten labels, five matches, two repeats: KEEP, with every count and cap named', () => {
  const v = verdictFromLabels(tenCases({ matches: 5, repeats: 2 }), CAPS)
  assert.equal(v.verdict, 'KEEP')
  assert.equal(v.labelled, 10)
  assert.equal(v.matches, 5)
  assert.equal(v.repeats, 2)
  assert.deepEqual(v.caps, { minLabels: 10, keepMinMatches: 3, repeatMaxPercent: 50 })
  assert.deepEqual(v.problems, [])
})

test('two matches out of ten: KILL, naming the failed count beside its cap', () => {
  const v = verdictFromLabels(tenCases({ matches: 2, repeats: 2 }), CAPS)
  assert.equal(v.verdict, 'KILL')
  assert.ok(v.reasons.includes('matches 2 < keepMinMatches 3'), JSON.stringify(v.reasons))
})

test('repeats above the percent cap KILL; at the cap they do not', () => {
  const over = verdictFromLabels(tenCases({ matches: 5, repeats: 6 }), CAPS)
  assert.equal(over.verdict, 'KILL')
  assert.ok(over.reasons.some(r => r.includes('repeats 6') && r.includes('repeatMaxPercent 50')), JSON.stringify(over.reasons))
  const at = verdictFromLabels(tenCases({ matches: 5, repeats: 5 }), CAPS)
  assert.equal(at.verdict, 'KEEP')
})

test('four labelled cases and one malformed file: INSUFFICIENT LABELS, the file listed and not counted', () => {
  const root = tmp('advisor-verdict-')
  for (let i = 0; i < 4; i++) {
    writeLabel(root, `spec-range-c${i}`, 'matches-label', 't1', 'pass')
    writeLabel(root, `spec-range-c${i}`, 'answered-already', 't1', 'pass')
  }
  writeLabel(root, 'spec-range-c4', 'matches-label', 't1', null)
  writeLabel(root, 'spec-range-c4', 'answered-already', 't1', 'pass')
  const v = verdictFromLabels(root, CAPS)
  assert.equal(v.verdict, 'INSUFFICIENT LABELS (4 of 10)')
  assert.equal(v.labelled, 4)
  assert.equal(v.matches, 4)
  assert.equal(v.problems.length, 1)
  assert.ok(v.problems[0].includes(join('spec-range-c4', 'calibration', 'matches-label')), v.problems[0])
})

test('several transcripts and a tie: majority per grader, a tie counts as neither, other cases never read', () => {
  const root = tmp('advisor-verdict-')
  // Case one: three matches-label files, no answered-already — not labelled.
  writeLabel(root, 'spec-range-one', 'matches-label', 't1', 'pass')
  writeLabel(root, 'spec-range-one', 'matches-label', 't2', 'pass')
  writeLabel(root, 'spec-range-one', 'matches-label', 't3', 'fail')
  // Case two: labelled; answered-already ties, so it is neither a repeat nor not.
  writeLabel(root, 'spec-range-two', 'answered-already', 't1', 'pass')
  writeLabel(root, 'spec-range-two', 'answered-already', 't2', 'fail')
  writeLabel(root, 'spec-range-two', 'matches-label', 't1', 'pass')
  // Neither counted nor listed: another case, and another grader of a Spec Range case.
  writeLabel(root, 'skill-routing-explore', 'matches-label', 't1', 'pass')
  writeLabel(root, 'skill-routing-explore', 'answered-already', 't1', 'fail')
  writeLabel(root, 'skill-routing-explore', 'routes-to-explore', 't1', null)
  writeLabel(root, 'spec-range-two', 'some-other-grader', 't1', null)

  const v = verdictFromLabels(root, CAPS)
  assert.equal(v.labelled, 1)
  assert.equal(v.matches, 1)
  assert.equal(v.repeats, 0)
  assert.deepEqual(v.problems, [])
  assert.equal(v.verdict, 'INSUFFICIENT LABELS (1 of 10)')
})

test('a matches-label tie counts as neither pass nor fail', () => {
  const root = tmp('advisor-verdict-')
  writeLabel(root, 'spec-range-x', 'matches-label', 't1', 'pass')
  writeLabel(root, 'spec-range-x', 'matches-label', 't2', 'fail')
  writeLabel(root, 'spec-range-x', 'answered-already', 't1', 'fail')
  const v = verdictFromLabels(root, CAPS)
  assert.equal(v.labelled, 1)
  assert.equal(v.matches, 0)
  assert.equal(v.repeats, 1)
})

test('the caps are read from the limits given; an empty tree is INSUFFICIENT against the shipped minimum', () => {
  const v = verdictFromLabels(tmp('advisor-verdict-'), LIMITS)
  assert.equal(v.verdict, `INSUFFICIENT LABELS (0 of ${LIMITS.advisorVerdictMinLabels})`)
  assert.deepEqual(v.caps, {
    minLabels: LIMITS.advisorVerdictMinLabels,
    keepMinMatches: LIMITS.advisorKeepMinMatches,
    repeatMaxPercent: LIMITS.advisorRepeatMaxPercent
  })
  for (const n of Object.values(v.caps)) assert.ok(Number.isInteger(n), 'every cap is an integer')
})

test('a labels directory that does not exist is spoken under problems, and the verdict is still a statement', () => {
  const missing = join(tmp('advisor-verdict-'), 'nope')
  const v = verdictFromLabels(missing, CAPS)
  assert.equal(v.verdict, 'INSUFFICIENT LABELS (0 of 10)')
  assert.equal(v.labelled, 0)
  assert.ok(v.problems.some(p => p.includes(missing)), JSON.stringify(v.problems))
})
