// `lib/review-policy-suggest.mjs` (change `scope-suggest-and-evaluate-the-artifact-gate`,
// spec `review/policy-suggestions`, design §4, D12-D17, D30, D32): the pure module behind
// `interlock review-policy suggest`. It takes plain inputs and the caps, reads no LIMITS and
// no file, and returns what the command prints.
//
// The contract these tests pin, so the implementer reads one place:
//
//   suggestPolicy({ window, notes, gates, ledgers, checks, caps, unjoined? })
//     window   { all?: boolean, since: { day: 'YYYY-MM-DD', time: ISO } | null, commit?: string | null }
//     notes    { rows: [{ id, date, change, file, surprise, rule, source }], problems?: number } | null
//     gates    the joined artifact gates: [{ change, findings, timestamp, depth, reviewer, content }]
//              where `findings` is the file's repo-relative path and `content` the parsed findings
//              (a gate "passed" by running evaluateGate over `content`, default band, no dismissals)
//     ledgers  [{ change, date: 'YYYY-MM-DD', rows: [{ id, question, class, resolution, evidence }] }]
//     checks   REVIEW.md's `## Artifact Checks` at HEAD, as text, in file order | null when unread
//     caps     { minSuggestChanges, staleCheckGates, maxArtifactChecks }
//     unjoined { noFindings: number, unreadable: number }   records left out of the join
//   -> { window, candidates, stale, unquoted, sources }
//     window      { open: boolean, since: day | null, commit, reason }
//     candidates  [{ trigger: 'T1'|'T2'|'T3'|'T4', subject, evidence: [...] }]
//     stale       [{ tag: 'review-md.<n>', text, gates }]
//     unquoted    [{ tag, text }]
//     sources     { notes, records, ledgers, checks }: one status line each
//
//   summaryLine(result)    'REVIEW.md candidates: <c+s> — interlock review-policy suggest' or ''
//   formatSuggest(result)  the text output, opening with 'REVIEW POLICY SUGGEST: '
//
// Every test fails until task 2.5 lands the module.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as suggest from '../../lib/review-policy-suggest.mjs'

const suggestPolicy = input => suggest.suggestPolicy(input)
const summaryLine = result => suggest.summaryLine(result)
const formatSuggest = result => suggest.formatSuggest(result)

const CAPS = { minSuggestChanges: 2, staleCheckGates: 2, maxArtifactChecks: 12 }
const OPEN = { all: true, since: null, commit: null }

const row = (id, change, file, over = {}) => ({
  id,
  date: '2026-11-26',
  change,
  file,
  surprise: `surprise ${id}`,
  rule: `rule ${id}`,
  source: 'review',
  ...over
})

const finding = (over = {}) => ({
  dimension: 'artifacts',
  severity: 'blocker',
  file: 'design.md',
  line: 12,
  title: 'a blocker',
  description: 'because',
  ...over
})

/** A joined gate; `findings` is the list the file holds. */
const gate = (change, n, findings, over = {}) => ({
  change,
  findings: `.claude/metrics/review-artifacts-${change}-2026112${n}-120000.json`,
  timestamp: `2026-11-2${n}T12:00:00.000Z`,
  depth: 'lean',
  reviewer: 'session',
  content: { dimension: 'artifacts', findings },
  ...over
})

const PASS = [finding({ severity: 'warning', title: 'only a warning' })]
const BLOCK = [finding({ title: 'the design contradicts the spec' })]
const STRICT = { depth: 'strict', reviewer: 'agent' }

const base = (over = {}) => ({
  window: OPEN,
  notes: { rows: [], problems: 0 },
  gates: [],
  ledgers: [],
  checks: [],
  caps: CAPS,
  unjoined: { noFindings: 0, unreadable: 0 },
  ...over
})

// --- the window -------------------------------------------------------------------

test('dated rows count on or after the window day, and --all opens the window', () => {
  const notes = { rows: [row('N1', 'a', 'lib/widget.mjs', { date: '2026-11-20' }), row('N2', 'b', 'lib/widget.mjs', { date: '2026-11-26' })] }
  const anchored = { all: false, since: { day: '2026-11-25', time: '2026-11-25T09:00:00.000Z' }, commit: 'abc1234def' }
  const inside = suggestPolicy(base({ notes, window: anchored }))
  assert.deepEqual(inside.candidates, [], 'only the 11-26 row is evidence, so one change is not enough')
  assert.equal(inside.window.open, false)
  assert.equal(inside.window.since, '2026-11-25')
  const all = suggestPolicy(base({ notes, window: { ...anchored, all: true } }))
  assert.equal(all.candidates.length, 1)
  assert.equal(all.window.open, true)
})

test('a row dated on the window day itself counts', () => {
  const notes = { rows: [row('N1', 'a', 'lib/widget.mjs', { date: '2026-11-25' }), row('N2', 'b', 'lib/widget.mjs', { date: '2026-11-25' })] }
  const r = suggestPolicy(base({ notes, window: { all: false, since: { day: '2026-11-25', time: '2026-11-25T09:00:00.000Z' }, commit: 'abc1234' } }))
  assert.equal(r.candidates.length, 1)
})

test('a timestamped gate counts at or after the window time, not before', () => {
  const gates = [
    gate('x', 1, PASS), // 2026-11-21T12:00
    gate('x', 2, BLOCK, STRICT)
  ]
  const at = time => suggestPolicy(base({ gates, window: { all: false, since: { day: time.slice(0, 10), time }, commit: 'abc1234' } }))
  assert.equal(at('2026-11-21T12:00:00.000Z').candidates.length, 1, 'the first gate is at the window time')
  assert.equal(at('2026-11-21T12:00:00.001Z').candidates.length, 0, 'the first gate is before it')
})

test('a closed window leaves out a gate with a null or unparseable timestamp; an open window keeps it', () => {
  const closed = { all: false, since: { day: '2026-11-20', time: '2026-11-20T09:00:00.000Z' }, commit: 'abc1234' }
  for (const timestamp of [null, 'not a time']) {
    const gates = [gate('x', 1, PASS, { timestamp }), gate('x', 2, BLOCK, STRICT)]
    const shut = suggestPolicy(base({ gates, window: closed, checks: ['one'] }))
    assert.equal(shut.candidates.length, 0, `${timestamp}: the undated gate is out, so no pair`)
    assert.match(shut.sources.records, /\b1 joined gate/, `${timestamp}: only the dated gate is read`)
    assert.equal(suggestPolicy(base({ gates, window: { ...closed, all: true } })).candidates.length, 1, `${timestamp}: --all keeps it`)
    assert.equal(suggestPolicy(base({ gates, window: OPEN })).candidates.length, 1, `${timestamp}: an open window keeps it`)
  }
})

test('a closed window leaves out a note row or ledger whose date is missing or not YYYY-MM-DD', () => {
  const closed = { all: false, since: { day: '2026-11-20', time: '2026-11-20T09:00:00.000Z' }, commit: 'abc1234' }
  for (const date of [null, undefined, 'TBD', '2026-11-26T12:00']) {
    const notes = { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'b', 'lib/widget.mjs', { date })] }
    assert.equal(suggestPolicy(base({ notes, window: closed })).candidates.length, 0, `${date}: the row is out`)
    assert.equal(suggestPolicy(base({ notes, window: { ...closed, all: true } })).candidates.length, 1, `${date}: --all keeps it`)
    const ledgers = [{ change: 'x', date, rows: [{ id: 'D1', question: 'q', class: 'needs_human', resolution: 'r', evidence: 'human decision' }] }]
    assert.equal(suggestPolicy(base({ ledgers, window: closed })).candidates.length, 0, `${date}: the ledger is out`)
    assert.equal(suggestPolicy(base({ ledgers, window: OPEN })).candidates.length, 1, `${date}: an open window keeps it`)
  }
})

test('a missing anchor opens the window and says why', () => {
  const r = suggestPolicy(base({ window: { all: false, since: null, commit: null } }))
  assert.equal(r.window.open, true)
  assert.equal(typeof r.window.reason, 'string')
  assert.ok(r.window.reason.length > 0)
})

// --- T1 ----------------------------------------------------------------------------

test('T1: two changes\' rows for one file raise one candidate holding both rows', () => {
  const r = suggestPolicy(base({ notes: { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'b', 'lib/widget.mjs'), row('N3', 'c', 'lib/other.mjs')] } }))
  assert.equal(r.candidates.length, 1)
  const [c] = r.candidates
  assert.equal(c.trigger, 'T1')
  assert.equal(c.subject, 'lib/widget.mjs')
  assert.deepEqual(c.evidence.map(e => e.id).sort(), ['N1', 'N2'])
  for (const e of c.evidence) assert.ok(e.change && e.date && e.rule, 'each row names its change, date and rule')
})

test('T1: three rows from one change raise none', () => {
  const r = suggestPolicy(base({ notes: { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'a', 'lib/widget.mjs'), row('N3', 'a', 'lib/widget.mjs')] } }))
  assert.deepEqual(r.candidates, [])
})

test('T1 reads the threshold from the caps, not from a constant', () => {
  const notes = { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'b', 'lib/widget.mjs')] }
  assert.equal(suggestPolicy(base({ notes, caps: { ...CAPS, minSuggestChanges: 3 } })).candidates.length, 0)
  assert.equal(suggestPolicy(base({ notes, caps: { ...CAPS, minSuggestChanges: 2 } })).candidates.length, 1)
})

// --- T2 ----------------------------------------------------------------------------

test('T2: a lean/session pass followed by a strict/agent block raises one candidate naming both files, both readers and the blocker title', () => {
  const first = gate('x', 1, PASS)
  const second = gate('x', 2, BLOCK, STRICT)
  const r = suggestPolicy(base({ gates: [first, second] }))
  assert.equal(r.candidates.length, 1)
  const [c] = r.candidates
  assert.equal(c.trigger, 'T2')
  assert.equal(c.subject, 'x')
  assert.equal(c.evidence.length, 1)
  const text = JSON.stringify(c.evidence)
  for (const needle of [first.findings, second.findings, 'lean', 'session', 'strict', 'agent', 'the design contradicts the spec']) {
    assert.ok(text.includes(needle), `the evidence names ${needle}`)
  }
})

test('T2: the same reader twice raises none, and so does an unrecorded reader on either side', () => {
  assert.deepEqual(suggestPolicy(base({ gates: [gate('x', 1, PASS), gate('x', 2, BLOCK)] })).candidates, [])
  assert.deepEqual(suggestPolicy(base({ gates: [gate('x', 1, PASS, { depth: null, reviewer: null }), gate('x', 2, BLOCK, STRICT)] })).candidates, [])
  assert.deepEqual(suggestPolicy(base({ gates: [gate('x', 1, PASS), gate('x', 2, BLOCK, { depth: null, reviewer: null })] })).candidates, [])
})

test('T2: a field recorded on one gate only is not a different reader', () => {
  const gates = [gate('x', 1, PASS, { depth: null, reviewer: 'session' }), gate('x', 2, BLOCK, { depth: 'lean', reviewer: 'session' })]
  assert.deepEqual(suggestPolicy(base({ gates })).candidates, [])
  const flipped = [gate('x', 1, PASS, { depth: 'lean', reviewer: null }), gate('x', 2, BLOCK, { depth: 'lean', reviewer: 'agent' })]
  assert.deepEqual(suggestPolicy(base({ gates: flipped })).candidates, [])
  const real = [gate('x', 1, PASS, { depth: null, reviewer: 'session' }), gate('x', 2, BLOCK, { depth: 'strict', reviewer: 'agent' })]
  assert.equal(suggestPolicy(base({ gates: real })).candidates.length, 1, 'the reader recorded on both differs')
})

test('T2: a pass that follows a block is not an overturn, and a block followed by a block is not either', () => {
  assert.deepEqual(suggestPolicy(base({ gates: [gate('x', 1, BLOCK), gate('x', 2, PASS, STRICT)] })).candidates, [])
  assert.deepEqual(suggestPolicy(base({ gates: [gate('x', 1, BLOCK), gate('x', 2, BLOCK, STRICT)] })).candidates, [])
})

test('T2: two qualifying pairs in one change raise one candidate holding both, in gate order', () => {
  const gates = [gate('x', 1, PASS), gate('x', 2, BLOCK, STRICT), gate('x', 3, PASS), gate('x', 4, BLOCK, STRICT)]
  // Handed over out of order: the command sorts by time.
  const r = suggestPolicy(base({ gates: [gates[3], gates[0], gates[2], gates[1]] }))
  assert.equal(r.candidates.length, 1)
  const [c] = r.candidates
  assert.equal(c.evidence.length, 2)
  const text = JSON.stringify(c.evidence)
  assert.ok(text.indexOf(gates[0].findings) < text.indexOf(gates[2].findings), 'gate order')
})

test('T2: gates of different changes are never paired', () => {
  assert.deepEqual(suggestPolicy(base({ gates: [gate('x', 1, PASS), gate('y', 2, BLOCK, STRICT)] })).candidates, [])
})

// --- T3 ----------------------------------------------------------------------------

test('T3: agentic-harness.2 on blockers from two changes raises one candidate naming each', () => {
  const tagged = (change, n) => gate(change, n, [finding({ check: 'agentic-harness.2', title: `harness blocker of ${change}` })])
  const r = suggestPolicy(base({ gates: [tagged('x', 1), tagged('y', 2)] }))
  const t3 = r.candidates.filter(c => c.trigger === 'T3')
  assert.equal(t3.length, 1)
  assert.equal(t3[0].subject, 'agentic-harness.2')
  const text = JSON.stringify(t3[0].evidence)
  for (const needle of ['harness blocker of x', 'harness blocker of y', '"x"', '"y"']) assert.ok(text.includes(needle), needle)
})

test('T3: one change, or a warning with the tag, raises none', () => {
  const one = suggestPolicy(base({ gates: [gate('x', 1, [finding({ check: 'agentic-harness.2' })]), gate('x', 2, [finding({ check: 'agentic-harness.2' })])] }))
  assert.equal(one.candidates.filter(c => c.trigger === 'T3').length, 0)
  const warn = suggestPolicy(base({ gates: [gate('x', 1, [finding({ check: 'agentic-harness.2', severity: 'warning' })]), gate('y', 2, [finding({ check: 'agentic-harness.2', severity: 'warning' })])] }))
  assert.equal(warn.candidates.filter(c => c.trigger === 'T3').length, 0)
})

// --- T4 ----------------------------------------------------------------------------

test('T4: a ledger row whose evidence holds "human decision" raises one candidate with the change, id, question and resolution', () => {
  const ledgers = [
    {
      change: 'x',
      date: '2026-11-26',
      rows: [
        { id: 'D3', question: 'Which store?', class: 'needs_human', resolution: 'the file store', evidence: 'human decision 2026-11-26' },
        { id: 'D4', question: 'Which name?', class: 'agent_resolved', resolution: 'widget', evidence: 'design.md D4' }
      ]
    }
  ]
  const r = suggestPolicy(base({ ledgers }))
  assert.equal(r.candidates.length, 1)
  const [c] = r.candidates
  assert.equal(c.trigger, 'T4')
  assert.equal(c.evidence.length, 1)
  assert.deepEqual(
    { change: c.evidence[0].change, id: c.evidence[0].id, question: c.evidence[0].question, resolution: c.evidence[0].resolution },
    { change: 'x', id: 'D3', question: 'Which store?', resolution: 'the file store' }
  )
})

test('T4: the match is case-insensitive, and the archive date is the window\'s test', () => {
  const ledgers = [{ change: 'x', date: '2026-11-20', rows: [{ id: 'D1', question: 'q', class: 'needs_human', resolution: 'r', evidence: 'Human Decision 2026-11-20' }] }]
  assert.equal(suggestPolicy(base({ ledgers })).candidates.length, 1)
  const late = { all: false, since: { day: '2026-11-25', time: '2026-11-25T09:00:00.000Z' }, commit: 'abc1234' }
  assert.equal(suggestPolicy(base({ ledgers, window: late })).candidates.length, 0)
})

// --- stale and unquoted --------------------------------------------------------------

const checkGate = (change, n, tag) => gate(change, n, [finding({ severity: 'warning', check: tag, title: `raised ${tag}` })])

test('stale: with enough gates review-md.2 is stale and review-md.1 is not', () => {
  const r = suggestPolicy(base({ checks: ['Is CHECK-ONE addressed?', 'Is CHECK-TWO addressed?'], gates: [checkGate('x', 1, 'review-md.1'), checkGate('y', 2, 'review-md.1')] }))
  assert.deepEqual(r.stale.map(s => s.tag), ['review-md.2'])
  assert.equal(r.stale[0].text, 'Is CHECK-TWO addressed?')
  assert.equal(r.stale[0].gates, 2, 'the number of gates read')
  assert.deepEqual(r.unquoted, [])
})

test('stale: a tag raised only at suggestion severity still counts as raised', () => {
  const gates = [gate('x', 1, [finding({ severity: 'suggestion', check: 'review-md.2' })]), checkGate('y', 2, 'review-md.1')]
  const r = suggestPolicy(base({ checks: ['one', 'two'], gates }))
  assert.deepEqual(r.stale, [])
})

test('stale: with fewer gates than staleCheckGates nothing is stale and the checks line says it was not judged', () => {
  const r = suggestPolicy(base({ checks: ['one', 'two'], gates: [checkGate('x', 1, 'review-md.1')] }))
  assert.deepEqual(r.stale, [])
  assert.match(r.sources.checks, /not judged/i)
  assert.match(r.sources.checks, /\b1\b/, 'it counts the gates read')
})

test('unquoted: a check past maxArtifactChecks is under unquoted, never stale, and the summary does not count it (D30)', () => {
  const checks = ['one', 'two', 'three']
  const gates = [checkGate('x', 1, 'review-md.1'), checkGate('y', 2, 'review-md.2')]
  const r = suggestPolicy(base({ checks, gates, caps: { ...CAPS, maxArtifactChecks: 2 } }))
  assert.deepEqual(r.stale, [])
  assert.deepEqual(r.unquoted.map(u => u.tag), ['review-md.3'])
  assert.equal(r.unquoted[0].text, 'three')
  assert.equal(summaryLine(r), '', 'an unquoted check is not a candidate')
})

test('no Artifact Checks read leaves stale and unquoted empty and the checks line says so', () => {
  const r = suggestPolicy(base({ checks: null }))
  assert.deepEqual(r.stale, [])
  assert.deepEqual(r.unquoted, [])
  assert.equal(typeof r.sources.checks, 'string')
  assert.ok(r.sources.checks.length > 0)
})

// --- sources, summary and text ----------------------------------------------------------

test('every source has a status line, even for empty inputs', () => {
  const r = suggestPolicy(base({ notes: null, checks: null }))
  for (const key of ['notes', 'records', 'ledgers', 'checks']) {
    assert.equal(typeof r.sources[key], 'string', key)
    assert.ok(r.sources[key].length > 0, key)
  }
  assert.deepEqual(r.candidates, [])
})

test('the records line counts records left out of the join', () => {
  const r = suggestPolicy(base({ unjoined: { noFindings: 2, unreadable: 1 } }))
  assert.match(r.sources.records, /\b2\b/)
  assert.match(r.sources.records, /\b1\b/)
})

test('the summary: two candidates and one stale give exactly the one line, and nothing gives an empty string', () => {
  const notes = { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'b', 'lib/widget.mjs')] }
  const ledgers = [{ change: 'x', date: '2026-11-26', rows: [{ id: 'D1', question: 'q', class: 'needs_human', resolution: 'r', evidence: 'human decision 2026-11-26' }] }]
  const gates = [checkGate('x', 1, 'review-md.1'), checkGate('y', 2, 'review-md.1')]
  const r = suggestPolicy(base({ notes, ledgers, gates, checks: ['one', 'two'] }))
  assert.equal(r.candidates.length, 2)
  assert.equal(r.stale.length, 1)
  assert.equal(summaryLine(r), 'REVIEW.md candidates: 3 — interlock review-policy suggest')
  assert.equal(summaryLine(suggestPolicy(base())), '')
})

test('the text opens with REVIEW POLICY SUGGEST: and names the window, anchored or open', () => {
  const notes = { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'b', 'lib/widget.mjs')] }
  const anchored = suggestPolicy(base({ notes, window: { all: false, since: { day: '2026-11-25', time: '2026-11-25T09:00:00.000Z' }, commit: 'abc1234def56' } }))
  const text = formatSuggest(anchored)
  assert.equal(text.split('\n')[0], 'REVIEW POLICY SUGGEST: 1 candidate(s), 0 stale — evidence since 2026-11-25 (REVIEW.md at abc1234)')
  const open = formatSuggest(suggestPolicy(base()))
  assert.ok(open.startsWith('REVIEW POLICY SUGGEST: 0 candidate(s), 0 stale'), open.split('\n')[0])
  assert.match(open.split('\n')[0], /open/i)
})

test('the text prints a block per candidate with its evidence, and a line per source', () => {
  const notes = { rows: [row('N1', 'a', 'lib/widget.mjs'), row('N2', 'b', 'lib/widget.mjs')] }
  const text = formatSuggest(suggestPolicy(base({ notes })))
  for (const needle of ['T1', 'lib/widget.mjs', 'N1', 'N2', 'rule N1']) assert.ok(text.includes(needle), needle)
})
