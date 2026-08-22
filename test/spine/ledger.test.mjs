import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseLedger,
  serializeLedger,
  readLedger,
  writeLedger,
  summarize,
  formatLedger,
  ledgerPath,
  isEmptyCell,
  LEDGER_FILE,
  NEEDS_HUMAN,
  AGENT_RESOLVED
} from '../../lib/ledger.mjs'

const LEDGER = `# Decisions — add-user-auth

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Pin zod version? | needs_human | — | — |
| D2 | Use existing Session helper vs new | agent_resolved | Reuse lib/session.ts | explore brief §Critical Files |
`

const rowsOf = (text) => parseLedger(text).rows
const byId = (parsed, id) => parsed.rows.find(r => r.id === id)

// --- parsing --------------------------------------------------------------

test('parses the §F2 template', () => {
  const p = parseLedger(LEDGER)
  assert.equal(p.change, 'add-user-auth')
  assert.equal(p.rows.length, 2)
  assert.deepEqual(p.invalid, [])

  const d1 = byId(p, 'D1')
  assert.equal(d1.class, NEEDS_HUMAN)
  assert.equal(d1.question, 'Pin zod version?')
  assert.equal(d1.resolution, '')
  assert.equal(d1.evidence, '')
  assert.equal(d1.valid, true)

  const d2 = byId(p, 'D2')
  assert.equal(d2.class, AGENT_RESOLVED)
  assert.equal(d2.resolution, 'Reuse lib/session.ts')
  assert.equal(d2.evidence, 'explore brief §Critical Files')
})

test('tolerates ragged real-world markdown', () => {
  const messy = `# Decisions — add-thing

|  id  |   question    | class | resolution | evidence |
| :--- | :-----------: | ----- | ---------- | -------- |
|D1|Cookie or Redis?|Needs Human|-|-
|   D2   |  Reuse helper?   |  AGENT_RESOLVED  |  lib/x.ts  |  design.md §2
`
  const p = parseLedger(messy)
  assert.equal(p.change, 'add-thing')
  assert.equal(p.rows.length, 2)
  assert.deepEqual(p.invalid, [])
  assert.equal(byId(p, 'D1').class, NEEDS_HUMAN)
  assert.equal(byId(p, 'D2').class, AGENT_RESOLVED)
  assert.equal(byId(p, 'D2').resolution, 'lib/x.ts')
})

test('a header-only table parses to zero rows without inventing problems', () => {
  const p = parseLedger('# Decisions — empty\n\n| id | question | class | resolution | evidence |\n|----|----|----|----|----|\n')
  assert.deepEqual(p.rows, [])
  assert.deepEqual(p.invalid, [])
  assert.equal(summarize(p).blocking, false)
})

test('an absent heading leaves change null rather than throwing', () => {
  const p = parseLedger('| D1 | q | needs_human | — | — |')
  assert.equal(p.change, null)
  assert.equal(p.rows.length, 1)
})

test('non-string and empty input parse to an empty ledger', () => {
  for (const input of [undefined, null, 42, '', '\n\n']) {
    const p = parseLedger(input)
    assert.deepEqual(p.rows, [])
    assert.deepEqual(p.invalid, [])
  }
})

test('prose containing a pipe outside the table is not mistaken for a row', () => {
  const p = parseLedger(`# Decisions — add-thing

We compared option A | option B in the brief.

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Which? | agent_resolved | A | brief §Options |
`)
  assert.equal(p.rows.length, 1)
  assert.deepEqual(p.invalid, [])
})

test('escaped pipes survive a cell', () => {
  const p = parseLedger('| D1 | A \\| B? | agent_resolved | picked A \\| not B | brief |')
  assert.equal(p.rows[0].question, 'A | B?')
  assert.equal(p.rows[0].resolution, 'picked A | not B')
  assert.deepEqual(p.invalid, [])
})

// --- empty markers --------------------------------------------------------

test('em dash, en dash, plain dash and blank all read as empty', () => {
  for (const marker of ['—', '–', '-', '--', '', '   ', 'n/a', 'TBD']) {
    assert.equal(isEmptyCell(marker), true, `${JSON.stringify(marker)} should be empty`)
  }
  assert.equal(isEmptyCell('Reuse lib/session.ts'), false)

  const p = parseLedger(
    '| D1 | q | agent_resolved | — | brief |\n| D2 | q | agent_resolved | fix | - |'
  )
  assert.equal(p.invalid.length, 2)
  assert.match(p.invalid[0].reason, /without a written resolution/)
  assert.match(p.invalid[1].reason, /without evidence/)
})

// --- validity rules -------------------------------------------------------

test('needs_human blocks', () => {
  const s = summarize(parseLedger(LEDGER))
  assert.equal(s.total, 2)
  assert.equal(s.needsHuman, 1)
  assert.equal(s.agentResolved, 1)
  assert.equal(s.invalid, 0)
  assert.equal(s.blocking, true)
})

test('a clean agent_resolved-only ledger does not block', () => {
  const s = summarize(parseLedger(`# Decisions — x

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Reuse helper? | agent_resolved | Reuse lib/session.ts | lib/session.ts:42 |
`))
  assert.deepEqual(
    { total: s.total, needsHuman: s.needsHuman, agentResolved: s.agentResolved, invalid: s.invalid, blocking: s.blocking },
    { total: 1, needsHuman: 0, agentResolved: 1, invalid: 0, blocking: false }
  )
})

test('agent_resolved with an empty resolution is invalid and still blocks', () => {
  const p = parseLedger('| D1 | Pin zod? | agent_resolved | — | brief §Deps |')
  const s = summarize(p)
  assert.equal(p.rows[0].valid, false)
  assert.equal(s.agentResolved, 0, 'an unsubstantiated claim is not a resolution')
  assert.equal(s.invalid, 1)
  assert.equal(s.blocking, true)
  assert.match(p.invalid[0].reason, /agent_resolved without a written resolution/)
})

test('agent_resolved with empty evidence is invalid and still blocks', () => {
  const p = parseLedger('| D1 | Pin zod? | agent_resolved | pin 3.22.4 | |')
  const s = summarize(p)
  assert.equal(s.agentResolved, 0)
  assert.equal(s.blocking, true)
  assert.match(p.invalid[0].reason, /agent_resolved without evidence/)
})

test('needs_human needs no resolution or evidence', () => {
  const p = parseLedger('| D1 | Pin zod? | needs_human | — | — |')
  assert.deepEqual(p.invalid, [])
  assert.equal(p.rows[0].valid, true)
})

test('malformed rows are collected, not thrown, and block', () => {
  const p = parseLedger(`# Decisions — add-thing

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Pin zod? | maybe_later | x | y |
| D2 | Too few columns |
|  | no id here | needs_human | — | — |
| D4 | Fine | needs_human | — | — |
`)
  assert.equal(p.rows.length, 4, 'every row is retained so nothing looks absent')
  assert.equal(p.invalid.length, 3)
  assert.match(p.invalid[0].reason, /unknown class "maybe_later"/)
  assert.match(p.invalid[1].reason, /expected 5 columns/)
  assert.match(p.invalid[2].reason, /row has no id/)
  assert.equal(summarize(p).blocking, true)
})

test('a ledger of nothing but garbage never summarizes as clean', () => {
  const p = parseLedger('| ??? |\n| !!! |')
  const s = summarize(p)
  assert.ok(s.invalid > 0)
  assert.equal(s.blocking, true)
})

test('summarize tolerates junk input', () => {
  for (const input of [undefined, null, {}, { rows: 'nope' }]) {
    const s = summarize(input)
    assert.equal(s.total, 0)
    assert.equal(s.blocking, false)
  }
})

// --- round trip -----------------------------------------------------------

test('parse → serialize → parse is stable', () => {
  const first = parseLedger(LEDGER)
  const text = serializeLedger(first.change, first.rows)
  const second = parseLedger(text)

  assert.equal(second.change, first.change)
  assert.equal(serializeLedger(second.change, second.rows), text)
  assert.deepEqual(
    second.rows.map(r => [r.id, r.question, r.class, r.resolution, r.evidence]),
    first.rows.map(r => [r.id, r.question, r.class, r.resolution, r.evidence])
  )
  assert.deepEqual(second.invalid, [])
})

test('serialize renders empty cells as the em dash placeholder and escapes pipes', () => {
  const text = serializeLedger('add-thing', [
    { id: 'D1', question: 'A | B?', class: 'needs_human' },
    { id: 'D2', question: 'multi\nline', class: 'agent_resolved', resolution: 'x', evidence: 'y' }
  ])
  assert.match(text, /^# Decisions — add-thing/)
  assert.match(text, /\| D1 \| A \\\| B\? \| needs_human \| — \| — \|/)
  assert.match(text, /\| D2 \| multi line \| agent_resolved \| x \| y \|/)

  const back = parseLedger(text)
  assert.equal(back.rows[0].question, 'A | B?')
  assert.equal(back.rows[0].resolution, '')
})

test('serialize tolerates a missing change name and junk rows', () => {
  const text = serializeLedger(undefined, [null, { id: 'D1', question: 'q', class: 'NEEDS HUMAN' }])
  const p = parseLedger(text)
  assert.equal(p.change, 'unnamed-change')
  assert.equal(p.rows.length, 2)
  assert.equal(byId(p, 'D1').class, NEEDS_HUMAN)
})

// --- filesystem -----------------------------------------------------------

let root

before(() => {
  root = mkdtempSync(join(tmpdir(), 'interlock-ledger-'))
  const change = join(root, 'openspec', 'changes', 'add-user-auth')
  mkdirSync(change, { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# Proposal\n')
  writeFileSync(join(change, LEDGER_FILE), LEDGER)

  mkdirSync(join(root, 'openspec', 'changes', 'no-ledger'), { recursive: true })
})

after(() => rmSync(root, { recursive: true, force: true }))

test('ledgerPath sits inside the change directory', () => {
  assert.equal(
    ledgerPath(root, 'add-user-auth'),
    join(root, 'openspec', 'changes', 'add-user-auth', LEDGER_FILE)
  )
  assert.throws(() => ledgerPath(root, ''), /requires a change name/)
})

test('readLedger reads and parses an existing ledger', () => {
  const r = readLedger(root, 'add-user-auth')
  assert.equal(r.exists, true)
  assert.equal(r.change, 'add-user-auth')
  assert.equal(r.rows.length, 2)
  assert.equal(summarize(r).blocking, true)
})

test('a missing file is exists:false, not a throw', () => {
  for (const change of ['no-ledger', 'never-created']) {
    const r = readLedger(root, change)
    assert.equal(r.exists, false)
    assert.deepEqual(r.rows, [])
    assert.equal(summarize(r).exists, false)
  }
})

test('writeLedger creates the change directory and round-trips through disk', () => {
  const rows = [
    { id: 'D1', question: 'Cookie or Redis?', class: NEEDS_HUMAN },
    { id: 'D2', question: 'Reuse helper?', class: AGENT_RESOLVED, resolution: 'lib/x.ts', evidence: 'brief §Files' }
  ]
  const { path } = writeLedger(root, 'fresh-change', rows)
  assert.equal(path, join(root, 'openspec', 'changes', 'fresh-change', LEDGER_FILE))
  assert.equal(readFileSync(path, 'utf8'), serializeLedger('fresh-change', rows))

  const back = readLedger(root, 'fresh-change')
  assert.equal(back.exists, true)
  assert.equal(back.change, 'fresh-change')
  assert.equal(back.rows.length, 2)
  assert.equal(summarize(back).needsHuman, 1)
  assert.throws(() => writeLedger(root, 'fresh-change', 'nope'), /rows array/)
})

// --- formatting -----------------------------------------------------------

test('formatLedger names the blocking rows only', () => {
  const out = formatLedger(parseLedger(LEDGER))
  assert.match(out, /DECISIONS BLOCKING — 2 row\(s\)/)
  assert.match(out, /\[needs_human\] D1: Pin zod version\?/)
  assert.ok(!out.includes('D2'), 'resolved rows are not dumped at the human')
  assert.ok(out.endsWith('\n'))
})

test('formatLedger reports invalid rows and the absent-file case', () => {
  const bad = formatLedger(parseLedger('| D1 | q | agent_resolved | — | — |'))
  assert.match(bad, /DECISIONS BLOCKING/)
  assert.match(bad, /\[invalid\] D1:/)

  // An absent ledger is reported as MISSING, not as "none recorded": the two
  // read identically to a human and only one of them is honest about what the
  // audit knows.
  assert.match(formatLedger(readLedger(root, 'no-ledger')), /DECISIONS MISSING/)
})

// --- a missing change is not an empty ledger -------------------------------
//
// The readiness gate can skip a human, so the one fail-open this module cannot
// afford is a typo'd change name reading as "no decisions outstanding".

test('a change directory that does not exist is reported, not treated as clear', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-ledger-missing-'))
  try {
    mkdirSync(join(root, 'openspec', 'changes'), { recursive: true })
    const read = readLedger(root, 'no-such-change')
    assert.equal(read.exists, false)
    assert.equal(read.changeExists, false)
    assert.equal(summarize(read).blocking, true, 'a missing change must block, never clear')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a real change with no ledger yet is not blocked by the missing-change rule', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-ledger-noledger-'))
  try {
    mkdirSync(join(root, 'openspec', 'changes', 'real-change'), { recursive: true })
    const read = readLedger(root, 'real-change')
    assert.equal(read.exists, false)
    assert.equal(read.changeExists, true)
    // Still blocking under the gate's own rules — but for "no ledger recorded",
    // not for "that change is not here".
    assert.equal(summarize(read).changeExists, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('summarize reports the invalid count under both keys, unambiguously', () => {
  const parsed = parseLedger(
    '# Decisions — c\n\n| id | question | class | resolution | evidence |\n' +
      '|----|----|----|----|----|\n' +
      '| D1 | pin it? | agent_resolved | — | — |\n'
  )
  const s = summarize(parsed)
  assert.equal(s.invalidCount, 1)
  assert.equal(s.invalid, 1)
  assert.ok(Array.isArray(parsed.invalid), 'the parse result keeps invalid as rows')
  assert.equal(typeof s.invalidCount, 'number')
})

// --- the design.md reference (spec: spec/decision-ledger) ------------------
//
// shared/DECISION-LEDGER.md has advertised this rule since it was written:
// "Every `agent_resolved` decision must also appear as a written assumption in
// `design.md`, referenced by id (`D2`)." Nothing checked it. A documented audit
// that does not run is worse than no audit, because it is cited as if it did.

const RESOLVED = (id = 'D2') =>
  `# Decisions — c\n\n| id | question | class | resolution | evidence |\n` +
  `|----|----|----|----|----|\n` +
  `| ${id} | Reuse the Session helper? | agent_resolved | Reuse lib/session.ts | lib/session.ts:42 |\n`

test('an agent_resolved row whose id appears in the design text is valid', () => {
  const p = parseLedger(RESOLVED(), {
    designText: '# Design\n\nAssumption D2: the existing Session helper is reused.\n'
  })
  assert.deepEqual(p.invalid, [])
  assert.equal(p.rows[0].valid, true)
})

test('an agent_resolved row whose id appears nowhere in the design text is invalid', () => {
  const p = parseLedger(RESOLVED(), { designText: '# Design\n\nNothing is assumed here.\n' })
  assert.equal(p.invalid.length, 1)
  assert.match(p.invalid[0].reason, /D2/)
  assert.match(p.invalid[0].reason, /design/i)
  assert.equal(summarize(p).blocking, true, 'an unresolvable reference blocks like needs_human')
})

test('an absent or unreadable design document makes every reference unresolvable', () => {
  for (const designText of [null, '']) {
    const p = parseLedger(RESOLVED(), { designText })
    assert.equal(p.invalid.length, 1, `designText ${JSON.stringify(designText)} must not validate`)
    assert.ok(
      !/contains every id/.test(p.invalid[0].reason),
      'an unreadable design document is not one that contains every id'
    )
  }
})

test('the reference is matched as a token, not as a substring of a longer word', () => {
  const p = parseLedger(RESOLVED('D2'), { designText: '# Design\n\nSee D21 for the store.\n' })
  assert.equal(p.invalid.length, 1, '"D21" does not resolve a reference to "D2"')
})

test('omitting the design argument entirely leaves parseLedger a pure parse', () => {
  // `parseLedger`/`serializeLedger` are pure by contract; the fs wrapper is what
  // resolves design.md. A caller that passes no design text is not asserting
  // that the design document is missing.
  assert.deepEqual(parseLedger(RESOLVED()).invalid, [])
})

// --- hedges that assert nothing --------------------------------------------

const HEDGES = ['obvious', 'Obvious', '  obvious  ', 'obvious.', 'OBVIOUS.', 'standard practice', 'see above']

for (const hedge of HEDGES) {
  test(`evidence of "${hedge}" counts as empty`, () => {
    assert.equal(isEmptyCell(hedge), true)
    const p = parseLedger(
      `# Decisions — c\n\n| id | question | class | resolution | evidence |\n` +
        `|----|----|----|----|----|\n` +
        `| D1 | why? | agent_resolved | Reuse it | ${hedge} |\n`,
      { designText: 'D1 is assumed.' }
    )
    assert.equal(p.invalid.length, 1)
    assert.match(p.invalid[0].reason, /evidence/)
  })
}

test('a substantive citation that merely contains a rejected word is accepted', () => {
  assert.equal(isEmptyCell('lib/session.ts:42 — the obvious existing helper'), false)
  const p = parseLedger(
    `# Decisions — c\n\n| id | question | class | resolution | evidence |\n` +
      `|----|----|----|----|----|\n` +
      `| D1 | why? | agent_resolved | Reuse it | lib/session.ts:42 — the obvious existing helper |\n`,
    { designText: 'D1 is assumed.' }
  )
  assert.deepEqual(p.invalid, [])
})

// --- missing vs present-and-empty vs unparseable ---------------------------

test('a missing ledger is reported as missing, distinguishably from an empty one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-ledger-shape-'))
  try {
    mkdirSync(join(dir, 'openspec', 'changes', 'c'), { recursive: true })
    const missing = summarize(readLedger(dir, 'c'))
    assert.equal(missing.exists, false)
    assert.equal(missing.missing, true)
    assert.equal(missing.blocking, true, 'an absent ledger is a failure, not an empty result')
    assert.match(formatLedger(readLedger(dir, 'c')), /MISSING/)

    writeFileSync(
      join(dir, 'openspec', 'changes', 'c', LEDGER_FILE),
      '# Decisions — c\n\n| id | question | class | resolution | evidence |\n|----|----|----|----|----|\n'
    )
    const empty = summarize(readLedger(dir, 'c'))
    assert.equal(empty.exists, true)
    assert.equal(empty.missing, false)
    assert.equal(empty.total, 0)
    assert.doesNotMatch(formatLedger(readLedger(dir, 'c')), /MISSING/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a ledger with no recognizable table is reported as unparseable, not as empty', () => {
  const p = parseLedger('some prose that is not a decision ledger at all\n')
  assert.equal(p.parseable, false)
  const s = summarize({ ...p, exists: true })
  assert.equal(s.unparseable, true)
  assert.equal(s.blocking, true)
})
