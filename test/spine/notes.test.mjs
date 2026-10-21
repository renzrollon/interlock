// The compound-notes table (spec/compound-notes): parse, render, append,
// derive from `specGap` findings, and match by canonical path.
//
// The table is a sibling of the decision ledger, so its row helpers live in
// lib/md-table.mjs and both parsers read a cell the same way. Like the ledger,
// a malformed row is collected under `problems` with its line number — never
// dropped, never read as a note — and a table nobody can read reports
// `parseable: false` rather than coming back empty.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NOTES_PATH,
  COLUMNS,
  parseNotes,
  renderNotes,
  appendNotes,
  deriveNotes,
  matchNotes
} from '../../lib/notes.mjs'
import { splitRow, isSeparatorRow, escapeCell } from '../../lib/md-table.mjs'
import { LIMITS } from '../../lib/limits.mjs'
import { specMentionedPaths } from '../../lib/spec-text.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const HEADER = '| id | date | change | file | surprise | rule | source |'
const SEP = '|----|------|--------|------|----------|------|--------|'

const row = (id, file, rule, extra = {}) => ({
  id,
  date: '2026-10-19',
  change: 'add-x',
  file,
  surprise: `Surprise about ${file}.`,
  rule,
  source: '.claude/metrics/review-code-add-x-20261019.json',
  ...extra
})

const line = r => `| ${COLUMNS.map(c => r[c]).join(' | ')} |`

const table = rows => ['# Compound notes', '', HEADER, SEP, ...rows.map(line), ''].join('\n')

const cellsOf = r => Object.fromEntries(COLUMNS.map(c => [c, r[c]]))

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'interlock-notes-'))
}

function seed(root, text) {
  const path = join(root, NOTES_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}

// --- the contract ---------------------------------------------------------

test('the table lives at docs/notes/compound.md with seven columns in order', () => {
  assert.equal(NOTES_PATH, 'docs/notes/compound.md')
  assert.deepEqual([...COLUMNS], ['id', 'date', 'change', 'file', 'surprise', 'rule', 'source'])
})

// --- md-table: the helpers lifted from the ledger ---------------------------

test('md-table splits a row, honours an escaped pipe, and tolerates missing outer pipes', () => {
  assert.deepEqual(splitRow('| a | b \\| c | d |'), ['a', 'b | c', 'd'])
  assert.deepEqual(splitRow('a | b'), ['a', 'b'])
  assert.equal(isSeparatorRow(splitRow(SEP)), true)
  assert.equal(isSeparatorRow(splitRow('| :--- | ---: |')), true)
  assert.equal(isSeparatorRow(splitRow(HEADER)), false)
})

test('md-table escapes a pipe and collapses a newline so a cell never breaks the table', () => {
  assert.equal(escapeCell('a | b'), 'a \\| b')
  assert.equal(escapeCell('one\ntwo'), 'one two')
  assert.deepEqual(splitRow(`| ${escapeCell('a | b')} | x |`), ['a | b', 'x'])
})

test('lib/ledger.mjs imports its row helpers from lib/md-table.mjs', () => {
  const src = readFileSync(join(ROOT, 'lib', 'ledger.mjs'), 'utf8')
  assert.match(src, /from\s+['"]\.\/md-table\.mjs['"]/, 'lib/ledger.mjs must import from ./md-table.mjs')
  assert.doesNotMatch(src, /^function splitRow\b/m, 'lib/ledger.mjs must not keep its own splitRow')
  assert.doesNotMatch(src, /^function isSeparatorRow\b/m, 'lib/ledger.mjs must not keep its own isSeparatorRow')
})

// --- parseNotes -------------------------------------------------------------

test('parseNotes returns well-formed rows in table order and no problems', () => {
  const rows = [row('N1', 'lib/a.mjs', 'Rule one.'), row('N2', 'lib/b.mjs', 'Rule two.'), row('N3', 'lib/c.mjs', 'Rule three.')]
  const parsed = parseNotes(table(rows))
  assert.equal(parsed.parseable, true)
  assert.deepEqual(parsed.problems, [])
  assert.deepEqual(parsed.rows.map(cellsOf), rows)
})

test('parseNotes reads — as an empty cell and \\| as a literal pipe', () => {
  const text = table([row('N1', 'lib/a.mjs', 'Keep a \\| b apart.', { source: '—' })])
  const [only] = parseNotes(text).rows
  assert.equal(only.source, '')
  assert.equal(only.rule, 'Keep a | b apart.')
})

test('parseNotes lists a six-cell row under problems with its line number, and nowhere else', () => {
  const good1 = row('N1', 'lib/a.mjs', 'Rule one.')
  const good2 = row('N2', 'lib/b.mjs', 'Rule two.')
  const good4 = row('N4', 'lib/d.mjs', 'Rule four.')
  const short = `| N3 | 2026-10-19 | add-x | lib/c.mjs | Surprise. | Rule three. |`
  const text = ['# Compound notes', '', HEADER, SEP, line(good1), line(good2), short, line(good4), ''].join('\n')
  const parsed = parseNotes(text)
  assert.deepEqual(parsed.rows.map(r => r.id), ['N1', 'N2', 'N4'])
  assert.equal(parsed.problems.length, 1)
  assert.equal(parsed.problems[0].line, 7)
  assert.equal(parsed.problems[0].reason, 'expected 7 cells, found 6')
  assert.ok(!parsed.rows.some(r => r.id === 'N3'), 'the malformed row must not be read as a note')
})

test('parseNotes names a missing id, file or rule, and a repeated id', () => {
  const text = [
    '# Compound notes',
    '',
    HEADER,
    SEP,
    line(row('N1', 'lib/a.mjs', 'Rule one.')),
    line(row('—', 'lib/b.mjs', 'Rule two.')),
    line(row('N3', '—', 'Rule three.')),
    line(row('N4', 'lib/d.mjs', '—')),
    line(row('N1', 'lib/e.mjs', 'Rule five.')),
    ''
  ].join('\n')
  const parsed = parseNotes(text)
  assert.deepEqual(parsed.rows.map(r => r.id), ['N1'])
  assert.deepEqual(
    parsed.problems.map(p => p.line),
    [6, 7, 8, 9]
  )
  assert.match(parsed.problems[0].reason, /\bid\b/)
  assert.match(parsed.problems[1].reason, /\bfile\b/)
  assert.match(parsed.problems[2].reason, /\brule\b/)
  assert.match(parsed.problems[3].reason, /repeated id/)
  assert.match(parsed.problems[3].reason, /N1/)
})

test('parseNotes reports a table with no header row as unparseable, never as empty', () => {
  const text = ['# Compound notes', '', line(row('N1', 'lib/a.mjs', 'Rule one.')), ''].join('\n')
  const parsed = parseNotes(text)
  assert.equal(parsed.parseable, false)
  assert.deepEqual(parsed.rows, [])
  assert.ok(parsed.problems.length >= 1, 'an unreadable table must say why')
  assert.match(parsed.problems.map(p => p.reason).join('\n'), /header/)
})

test('parseNotes of the seeded heading-and-header table is parseable with no rows', () => {
  const parsed = parseNotes(['# Compound notes', '', HEADER, SEP, ''].join('\n'))
  assert.equal(parsed.parseable, true)
  assert.deepEqual(parsed.rows, [])
  assert.deepEqual(parsed.problems, [])
})

// --- renderNotes ------------------------------------------------------------

test('renderNotes round-trips with parseNotes', () => {
  const rows = [
    row('N1', 'lib/a.mjs', 'Keep a | b apart.'),
    row('N2', 'lib/b.mjs', 'Rule two.', { source: '' })
  ]
  const text = renderNotes(rows)
  assert.match(text, /^# Compound notes\n/)
  assert.ok(text.includes('Keep a \\| b apart.'), 'a literal pipe is escaped on render')
  assert.ok(text.includes('| — |'), 'an empty cell renders as the em dash')
  const parsed = parseNotes(text)
  assert.deepEqual(parsed.problems, [])
  assert.deepEqual(parsed.rows.map(cellsOf), rows)
  assert.equal(renderNotes(parsed.rows), text, 'render → parse → render is stable')
})

// --- appendNotes ------------------------------------------------------------

test('appendNotes creates the file with its heading when absent and assigns N1', () => {
  const root = tempRoot()
  try {
    const result = appendNotes(
      root,
      [{ change: 'add-x', file: 'lib/a.mjs', surprise: 'S.', rule: 'Name every reader of the raw form.', source: 'run-1' }],
      { date: '2026-10-19' }
    )
    assert.deepEqual(result, { appended: 1, skipped: 0, path: NOTES_PATH })
    const text = readFileSync(join(root, NOTES_PATH), 'utf8')
    assert.match(text, /^# Compound notes\n/)
    const parsed = parseNotes(text)
    assert.deepEqual(parsed.problems, [])
    assert.deepEqual(parsed.rows.map(cellsOf), [
      { id: 'N1', date: '2026-10-19', change: 'add-x', file: 'lib/a.mjs', surprise: 'S.', rule: 'Name every reader of the raw form.', source: 'run-1' }
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes to N1–N3 appends N4 with the given cells and the date', () => {
  const root = tempRoot()
  try {
    seed(root, table([row('N1', 'lib/a.mjs', 'R1.'), row('N2', 'lib/b.mjs', 'R2.'), row('N3', 'lib/c.mjs', 'R3.')]))
    const incoming = {
      change: 'add-x',
      file: 'lib/a.mjs',
      surprise: 'A sibling reader was missed.',
      rule: 'Name every reader of the raw form.',
      source: '.claude/metrics/review-code-add-x-20261019.json'
    }
    const result = appendNotes(root, [incoming], { date: '2026-10-20' })
    assert.equal(result.appended, 1)
    assert.equal(result.skipped, 0)
    const parsed = parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8'))
    assert.deepEqual(parsed.problems, [])
    assert.equal(parsed.rows.length, 4)
    assert.deepEqual(cellsOf(parsed.rows[3]), { id: 'N4', date: '2026-10-20', ...incoming })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("appendNotes keeps a row's own date over the option", () => {
  const root = tempRoot()
  try {
    appendNotes(root, [{ date: '2026-01-02', change: 'c', file: 'lib/a.mjs', surprise: 'S.', rule: 'R.', source: 's' }], {
      date: '2026-10-19'
    })
    const [only] = parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8')).rows
    assert.equal(only.date, '2026-01-02')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes with no date anywhere writes an ISO date', () => {
  const root = tempRoot()
  try {
    appendNotes(root, [{ change: 'c', file: 'lib/a.mjs', surprise: 'S.', rule: 'R.', source: 's' }])
    const [only] = parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8')).rows
    assert.match(only.date, /^\d{4}-\d{2}-\d{2}$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes never reuses an id: the next id follows the highest present', () => {
  const root = tempRoot()
  try {
    seed(root, table([row('N1', 'lib/a.mjs', 'R1.'), row('N7', 'lib/b.mjs', 'R7.')]))
    appendNotes(root, [{ change: 'c', file: 'lib/z.mjs', surprise: 'S.', rule: 'Rz.', source: 's', id: 'N2' }], {
      date: '2026-10-19'
    })
    const ids = parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8')).rows.map(r => r.id)
    assert.deepEqual(ids, ['N1', 'N7', 'N8'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes skips a row whose change, file and rule are present, leaving the file byte-identical', () => {
  const root = tempRoot()
  try {
    const before = table([row('N1', 'lib/a.mjs', 'R1.'), row('N2', 'lib/a.mjs', 'Rule R.')])
    const path = seed(root, before)
    const result = appendNotes(
      root,
      [{ change: 'add-x', file: 'lib/a.mjs', surprise: 'Different words.', rule: 'Rule R.', source: 'run-9' }],
      { date: '2026-10-20' }
    )
    assert.equal(result.appended, 0)
    assert.equal(result.skipped, 1)
    assert.equal(readFileSync(path, 'utf8'), before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes skips a duplicate within the same batch', () => {
  const root = tempRoot()
  try {
    const r = { change: 'add-x', file: 'lib/a.mjs', surprise: 'S.', rule: 'R.', source: 's' }
    const result = appendNotes(root, [r, { ...r }], { date: '2026-10-19' })
    assert.equal(result.appended, 1)
    assert.equal(result.skipped, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes with zero rows creates no file', () => {
  const root = tempRoot()
  try {
    const result = appendNotes(root, [], { date: '2026-10-19' })
    assert.equal(result.appended, 0)
    assert.equal(result.skipped, 0)
    assert.equal(existsSync(join(root, NOTES_PATH)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- concurrent writers ------------------------------------------------------
//
// `interlock note add` and a ship review's adjudication can append to the same
// checkout's table at once (PR #20 review). Each read-modify-write must see the
// rows the other wrote, or a row is lost and an id is handed out twice.

const BIN = join(ROOT, 'bin', 'interlock')

/** Run `interlock note add` as its own process; resolves with its exit and output. */
function noteAdd(root, n) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      BIN, 'note', 'add', '--root', root, '--json',
      '--change', 'add-x', '--file', `lib/f${n}.mjs`, '--surprise', `surprise ${n}.`, '--rule', `Rule ${n}.`
    ], { cwd: root })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

test('concurrent note add processes land every row once, with unique ids', async () => {
  const root = tempRoot()
  try {
    const writers = 12
    const results = await Promise.all(Array.from({ length: writers }, (_, n) => noteAdd(root, n)))
    for (const r of results) {
      assert.equal(r.code, 0, r.stderr)
      assert.equal(JSON.parse(r.stdout).appended, 1, r.stdout)
    }
    const table = parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8'))
    assert.equal(table.parseable, true)
    assert.deepEqual(table.problems, [])
    assert.deepEqual(table.rows.map(r => r.file).sort(), Array.from({ length: writers }, (_, n) => `lib/f${n}.mjs`).sort())
    assert.deepEqual(table.rows.map(r => r.id).sort(), Array.from({ length: writers }, (_, n) => `N${n + 1}`).sort())
    assert.deepEqual(readdirSync(dirname(join(root, NOTES_PATH))), ['compound.md'], 'no lock or staging file is left behind')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes refuses, naming the lock, while another writer holds a fresh lock', () => {
  const root = tempRoot()
  try {
    const path = seed(root, table([row('N1', 'lib/a.mjs', 'R.')]))
    const before = readFileSync(path, 'utf8')
    writeFileSync(`${path}.lock`, '')
    assert.throws(
      () => appendNotes(root, [row(undefined, 'lib/b.mjs', 'R2.')], { date: '2026-10-21', lockWaitMs: 50 }),
      /docs\/notes\/compound\.md is locked by another writer/
    )
    assert.equal(readFileSync(path, 'utf8'), before, 'a refused append changes no byte')
    assert.equal(existsSync(`${path}.lock`), true, "another writer's lock is left where it was")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('appendNotes breaks a stale lock and appends', () => {
  const root = tempRoot()
  try {
    const path = seed(root, table([row('N1', 'lib/a.mjs', 'R.')]))
    writeFileSync(`${path}.lock`, '')
    const old = new Date(Date.now() - 10 * 60 * 1000)
    utimesSync(`${path}.lock`, old, old)
    const result = appendNotes(root, [row(undefined, 'lib/b.mjs', 'R2.')], { date: '2026-10-21', lockWaitMs: 50 })
    assert.equal(result.appended, 1)
    assert.match(readFileSync(path, 'utf8'), /^\| N2 \| 2026-10-19 \| add-x \| lib\/b\.mjs \|/m)
    assert.equal(existsSync(`${path}.lock`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- deriveNotes ------------------------------------------------------------

const finding = (over = {}) => ({
  file: 'lib/a.mjs',
  line: 10,
  severity: 'warning',
  dimension: 'domain',
  title: 'A sibling reader of the raw form was missed.',
  description: 'The reader in lib/a.mjs reads the raw form. A second reader was not named.',
  suggestion: 'Name every reader of the raw form.',
  ...over
})

test('deriveNotes yields one row per specGap: true survivor, and nothing for false or absent', () => {
  const findings = [
    finding({ specGap: true, file: 'lib/a.mjs' }),
    finding({ specGap: false, file: 'lib/b.mjs' }),
    finding({ file: 'lib/c.mjs' }),
    finding({ specGap: true, file: 'lib/d.mjs', title: 'Convention unstated.', suggestion: 'State the convention.' }),
    finding({ file: 'lib/e.mjs' })
  ]
  const rows = deriveNotes(findings, { change: 'add-x', source: 'run-123', date: '2026-10-19' })
  assert.equal(rows.length, 2)
  assert.deepEqual(
    rows.map(r => ({ date: r.date, change: r.change, file: r.file, surprise: r.surprise, rule: r.rule, source: r.source })),
    [
      {
        date: '2026-10-19',
        change: 'add-x',
        file: 'lib/a.mjs',
        surprise: 'A sibling reader of the raw form was missed.',
        rule: 'Name every reader of the raw form.',
        source: 'run-123'
      },
      {
        date: '2026-10-19',
        change: 'add-x',
        file: 'lib/d.mjs',
        surprise: 'Convention unstated.',
        rule: 'State the convention.',
        source: 'run-123'
      }
    ]
  )
})

test('deriveNotes treats a non-boolean specGap as not a gap', () => {
  const rows = deriveNotes([finding({ specGap: 'yes' }), finding({ specGap: 1 })], {
    change: 'add-x',
    source: 'run-1',
    date: '2026-10-19'
  })
  assert.deepEqual(rows, [])
})

test("deriveNotes takes the description's first sentence, as-is, when there is no suggestion", () => {
  const f = finding({ specGap: true, suggestion: undefined, description: 'The reader skips the raw form. It also misses X.' })
  delete f.suggestion
  const [only] = deriveNotes([f], { change: 'add-x', source: 'run-1', date: '2026-10-19' })
  assert.equal(only.rule, 'The reader skips the raw form.')
  assert.equal(only.file, 'lib/a.mjs')
  assert.equal(only.surprise, f.title)
})

test('deriveNotes on no findings yields no rows', () => {
  assert.deepEqual(deriveNotes([], { change: 'add-x', source: 'run-1', date: '2026-10-19' }), [])
})

test('derived rows append as well-formed notes', () => {
  const root = tempRoot()
  try {
    const rows = deriveNotes([finding({ specGap: true })], { change: 'add-x', source: 'run-1', date: '2026-10-19' })
    const result = appendNotes(root, rows)
    assert.equal(result.appended, 1)
    const parsed = parseNotes(readFileSync(join(root, NOTES_PATH), 'utf8'))
    assert.deepEqual(parsed.problems, [])
    assert.equal(parsed.rows[0].source, 'run-1')
    assert.equal(parsed.rows[0].date, '2026-10-19')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- matchNotes -------------------------------------------------------------

test('matchNotes returns the rows whose canonical file the tasks name, in table order', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(`N${i + 1}`, `lib/f${i + 1}.mjs`, `R${i + 1}.`))
  rows[2] = row('N3', './lib/b.mjs', 'Rb.')
  rows[6] = row('N7', 'lib/a.mjs', 'Ra.')
  const tasksText = '- [ ] 1.1 Edit `lib/a.mjs` and `./lib/b.mjs`.\n'
  const result = matchNotes(rows, specMentionedPaths(tasksText))
  assert.deepEqual(result.rows.map(r => r.id), ['N3', 'N7'])
  assert.equal(result.omitted, 0)
})

test('matchNotes canonicalizes the given paths as well as the file column', () => {
  const rows = [row('N1', 'lib/a.mjs', 'R.'), row('N2', 'lib/x/../b.mjs', 'R.')]
  const result = matchNotes(rows, ['./lib/a.mjs', 'lib/b.mjs', 'lib/none.mjs'])
  assert.deepEqual(result.rows.map(r => r.id), ['N1', 'N2'])
})

test('matchNotes cuts at the cap in whole rows and names the omitted count', () => {
  const rows = Array.from({ length: 30 }, (_, i) => row(`N${i + 1}`, 'lib/a.mjs', `R${i + 1}.`))
  const result = matchNotes(rows, ['lib/a.mjs'], { maxAdvisorNoteRows: 20 })
  assert.equal(result.rows.length, 20)
  assert.deepEqual(result.rows.map(r => r.id), rows.slice(0, 20).map(r => r.id))
  assert.equal(result.omitted, 10)
})

test('matchNotes defaults its cap to LIMITS.maxAdvisorNoteRows', () => {
  assert.ok(Number.isInteger(LIMITS.maxAdvisorNoteRows) && LIMITS.maxAdvisorNoteRows > 0)
  const total = LIMITS.maxAdvisorNoteRows + 10
  const rows = Array.from({ length: total }, (_, i) => row(`N${i + 1}`, 'lib/a.mjs', `R${i + 1}.`))
  const result = matchNotes(rows, ['lib/a.mjs'])
  assert.equal(result.rows.length, LIMITS.maxAdvisorNoteRows)
  assert.equal(result.omitted, 10)
})

test('matchNotes on no paths or no rows matches nothing', () => {
  assert.deepEqual(matchNotes([row('N1', 'lib/a.mjs', 'R.')], []), { rows: [], omitted: 0 })
  assert.deepEqual(matchNotes([], ['lib/a.mjs']), { rows: [], omitted: 0 })
})
