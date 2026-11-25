// `interlock review-policy suggest [--all] [--summary] [--json]` (change
// `scope-suggest-and-evaluate-the-artifact-gate`, spec `review/policy-suggestions`,
// design §4): the command, run as a child process in a temporary git repository.
//
// The pure module is pinned in review-policy-suggest.test.mjs; these tests hold the I/O:
// the window from `git log -1 --format=%cI HEAD -- REVIEW.md`, the compound notes, the
// artifact gates joined to their findings files through the record's `findings` field,
// the archived ledgers, and what the command may not do (write anything, or exit non-zero
// for any reason but a usage error).
//
// Every test fails until task 2.6 lands the command. The T2 join also needs 2.2's
// `findings` field, because it records its gates through `interlock gate`.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { COLUMNS } from '../../lib/notes.mjs'
import { serializeLedger } from '../../lib/ledger.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'cli', 'interlock')
const IDENTITY = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x.invalid' }

const temps = []
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function git(cwd, args, date) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...IDENTITY, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) }
  })
}

function put(root, rel, text) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

const NOTES_HEADER = `| ${COLUMNS.join(' | ')} |`
const NOTES_SEP = `|${COLUMNS.map(() => '----').join('|')}|`
const noteRow = (id, date, change, file) => `| ${id} | ${date} | ${change} | ${file} | surprise ${id} | rule ${id} | review |`
const notesTable = (...rows) => ['# Compound notes', '', NOTES_HEADER, NOTES_SEP, ...rows, ''].join('\n')

/**
 * A repository whose one REVIEW.md commit is dated `reviewDate`. `files` are committed after it,
 * dated 2030, so the window's anchor is the REVIEW.md commit and nothing else. `review: false`
 * leaves no REVIEW.md at all; `commit: false` leaves a repository with no commit.
 */
function makeRepo(sub, { reviewDate = '2020-01-01T10:00:00Z', files = {}, review = true, commit = true, reviewText } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `interlock-suggest-${sub}-`))
  temps.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  if (commit) {
    if (review) {
      put(dir, 'REVIEW.md', reviewText ?? '# Review policy\n\n## Artifact Checks\n\n- Is CHECK-ONE addressed?\n- Is CHECK-TWO addressed?\n')
      git(dir, ['add', 'REVIEW.md'])
      git(dir, ['commit', '-q', '-m', 'policy'], reviewDate)
    } else {
      put(dir, 'README.md', 'x\n')
      git(dir, ['add', 'README.md'])
      git(dir, ['commit', '-q', '-m', 'init'], '2020-01-01T10:00:00Z')
    }
    for (const [rel, text] of Object.entries(files)) put(dir, rel, text)
    if (Object.keys(files).length) {
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-q', '-m', 'content'], '2030-01-01T10:00:00Z')
    }
  }
  return dir
}

function cli(root, args) {
  const r = spawnSync(process.execPath, [BIN, ...args, '--root', root], { cwd: root, encoding: 'utf8', input: '' })
  assert.equal(r.error, undefined, String(r.error))
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

const suggestJson = (root, more = []) => {
  const r = cli(root, ['review-policy', 'suggest', '--json', ...more])
  assert.equal(r.code, 0, `exit ${r.code}: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

const WIDGET_NOTES = notesTable(
  noteRow('N1', '2026-11-20', 'a', 'lib/widget.mjs'),
  noteRow('N2', '2026-11-26', 'b', 'lib/widget.mjs'),
  noteRow('N3', '2026-11-27', 'c', 'lib/widget.mjs')
)

// --- the window ---------------------------------------------------------------------

test('REVIEW.md committed on 2026-11-25: only the later rows are evidence, the output names the day and the commit, and --all reads both', () => {
  const root = makeRepo('window', { reviewDate: '2026-11-25T10:00:00Z', files: { 'docs/notes/compound.md': WIDGET_NOTES } })
  const sha = git(root, ['log', '-1', '--format=%h', '--', 'REVIEW.md']).trim()
  const windowed = suggestJson(root)
  assert.equal(windowed.candidates.length, 1)
  assert.equal(windowed.candidates[0].trigger, 'T1')
  assert.deepEqual(windowed.candidates[0].evidence.map(e => e.id).sort(), ['N2', 'N3'], 'the 11-20 row is before the window')
  assert.equal(windowed.window.open, false)
  assert.equal(windowed.window.since, '2026-11-25')
  const text = cli(root, ['review-policy', 'suggest']).stdout
  assert.ok(text.startsWith('REVIEW POLICY SUGGEST:'), text.split('\n')[0])
  assert.ok(text.includes('2026-11-25'), 'the window\'s start')
  assert.ok(text.includes(sha.slice(0, 7)), 'the REVIEW.md commit')

  const all = suggestJson(root, ['--all'])
  assert.deepEqual(all.candidates[0].evidence.map(e => e.id).sort(), ['N1', 'N2', 'N3'])
  assert.equal(all.window.open, true)
})

test('a repository whose history never touched REVIEW.md has an open window, and says why', () => {
  const root = makeRepo('no-policy', { review: false, files: { 'docs/notes/compound.md': WIDGET_NOTES } })
  const r = suggestJson(root)
  assert.equal(r.window.open, true)
  assert.ok(r.window.reason.length > 0)
  assert.deepEqual(r.candidates[0].evidence.map(e => e.id).sort(), ['N1', 'N2', 'N3'])
})

// --- the empty repository ---------------------------------------------------------------

test('a repository with nothing exits 0 with no candidate, no stale check and each source\'s absent line', () => {
  for (const [sub, opts] of [['empty', { review: false }], ['no-commit', { commit: false }]]) {
    const root = makeRepo(`empty-${sub}`, opts)
    const r = suggestJson(root)
    assert.deepEqual(r.candidates, [], sub)
    assert.deepEqual(r.stale, [], sub)
    assert.equal(r.window.open, true, sub)
    for (const key of ['notes', 'records', 'ledgers', 'checks']) {
      assert.equal(typeof r.sources[key], 'string', `${sub}: ${key}`)
      assert.match(r.sources[key], /absent|none|no /i, `${sub}: ${key} says what it found absent: ${r.sources[key]}`)
    }
    const text = cli(root, ['review-policy', 'suggest'])
    assert.equal(text.code, 0, text.stderr)
    assert.ok(text.stdout.startsWith('REVIEW POLICY SUGGEST: 0 candidate(s), 0 stale'), text.stdout.split('\n')[0])
  }
})

// --- T2, joined through the record's `findings` ------------------------------------------

const GATE_PASS = { dimension: 'artifacts', findings: [{ severity: 'warning', title: 'a warning', file: 'design.md', line: 3, description: 'because' }] }
const GATE_BLOCK = { dimension: 'artifacts', findings: [{ severity: 'blocker', title: 'the design contradicts the spec', file: 'design.md', line: 9, description: 'because' }] }

/** Run `interlock gate` over a findings file written at `.claude/metrics/review-artifacts-x-<stamp>.json`. */
function recordGate(root, stamp, content, extra) {
  const rel = `.claude/metrics/review-artifacts-x-${stamp}.json`
  put(root, rel, JSON.stringify(content))
  const r = cli(root, ['gate', '--findings', rel, '--metrics', 'x', '--stage', 'artifacts', ...extra, '--json'])
  assert.ok(r.code === 0 || r.code === 1, r.stderr)
  return rel
}

test('two artifact gates of one change, lean/session passing then strict/agent blocking, give one T2 candidate joined through each record\'s findings', () => {
  const root = makeRepo('t2')
  const first = recordGate(root, '20261125-120000', GATE_PASS, ['--depth', 'lean', '--reviewer', 'session'])
  const second = recordGate(root, '20261125-130000', GATE_BLOCK, ['--depth', 'strict', '--reviewer', 'agent'])
  const r = suggestJson(root)
  const t2 = r.candidates.filter(c => c.trigger === 'T2')
  assert.equal(t2.length, 1, JSON.stringify(r.candidates))
  assert.equal(t2[0].subject, 'x')
  const text = JSON.stringify(t2[0].evidence)
  for (const needle of [first, second, 'lean', 'session', 'strict', 'agent', 'the design contradicts the spec']) assert.ok(text.includes(needle), needle)
})

test('a record with no findings field beside a findings file of the same change is counted on the records line and never joined', () => {
  const root = makeRepo('t2-unjoined')
  // A pass by lean/session with no findings path, then a real strict/agent block. Joined by name
  // or by time these would be a T2 pair; joined only by path there is one gate and no pair.
  put(
    root,
    '.claude/metrics/review-x-2026-11-25T12-00-00-000Z.json',
    JSON.stringify({
      schema: 'interlock.review-metrics/1',
      timestamp: '2026-11-25T12:00:00.000Z',
      change: 'x',
      counts: { raised: 1, dismissed: 0, droppedByQuality: 0, surviving: 1 },
      stage: 'artifacts',
      depth: 'lean',
      reviewer: 'session',
      lenses: null
    })
  )
  put(root, '.claude/metrics/review-artifacts-x-20261125-120500.json', JSON.stringify(GATE_PASS))
  recordGate(root, '20261125-130000', GATE_BLOCK, ['--depth', 'strict', '--reviewer', 'agent'])
  const r = suggestJson(root)
  assert.deepEqual(r.candidates.filter(c => c.trigger === 'T2'), [])
  assert.match(r.sources.records, /\b1\b/, `the records line counts the one: ${r.sources.records}`)
})

// --- PR #47 review: what a join reads ------------------------------------------------------

/** A metrics record of an artifact gate, written by hand, naming `findings`. */
function putRecord(root, name, findings, { depth = 'lean', reviewer = 'session', timestamp = '2026-11-25T12:00:00.000Z' } = {}) {
  put(
    root,
    `.claude/metrics/${name}`,
    JSON.stringify({
      schema: 'interlock.review-metrics/1',
      timestamp,
      change: 'x',
      counts: { raised: 0, dismissed: 0, droppedByQuality: 0, surviving: 0 },
      stage: 'artifacts',
      depth,
      reviewer,
      lenses: null,
      findings
    })
  )
}

test('a record whose findings file is JSON but no findings list is unreadable, never a passing gate (H3)', () => {
  const root = makeRepo('t2-not-findings')
  put(root, '.claude/metrics/not-findings.json', '{}')
  putRecord(root, 'review-x-2026-11-25T12-00-00-000Z.json', '.claude/metrics/not-findings.json')
  recordGate(root, '20261125-130000', GATE_BLOCK, ['--depth', 'strict', '--reviewer', 'agent'])
  const r = suggestJson(root)
  assert.deepEqual(r.candidates.filter(c => c.trigger === 'T2'), [], 'a {} file is not a pass to overturn')
  assert.match(r.sources.records, /1 joined gate\(s\) in the window; 0 left out for naming no findings file, 1 for an unreadable findings file/)
})

test('a findings file that links out of the root is unreadable, and a record file that does not parse is counted (H3, M11)', () => {
  const root = makeRepo('t2-link-out')
  const outside = mkdtempSync(join(tmpdir(), 'interlock-suggest-outside-'))
  temps.push(outside)
  writeFileSync(join(outside, 'f.json'), JSON.stringify(GATE_PASS))
  mkdirSync(join(root, '.claude', 'findings'), { recursive: true })
  symlinkSync(join(outside, 'f.json'), join(root, '.claude', 'findings', 'linked.json'))
  putRecord(root, 'review-x-2026-11-25T12-00-00-000Z.json', '.claude/findings/linked.json')
  put(root, '.claude/metrics/review-x-broken.json', '{ not json')
  const r = suggestJson(root)
  assert.match(r.sources.records, /1 for an unreadable findings file; 1 record file\(s\) that do not parse/)
})

test('records in another state home join to findings files under that home when the root has none (round-0 F-a45c2a5b)', () => {
  const root = makeRepo('t2-home-root')
  const home = makeRepo('t2-home-home', { review: false })
  put(home, '.claude/metrics/pass.json', JSON.stringify(GATE_PASS))
  put(home, '.claude/metrics/block.json', JSON.stringify(GATE_BLOCK))
  putRecord(home, 'review-x-2026-11-25T12-00-00-000Z.json', '.claude/metrics/pass.json')
  putRecord(home, 'review-x-2026-11-25T13-00-00-000Z.json', '.claude/metrics/block.json', {
    depth: 'strict',
    reviewer: 'agent',
    timestamp: '2026-11-25T13:00:00.000Z'
  })
  const r = suggestJson(root, ['--state-home', home])
  assert.equal(r.candidates.filter(c => c.trigger === 'T2').length, 1, r.sources.records)
  assert.match(r.sources.records, /2 joined gate\(s\)/)
})

test('a compound notes file that is there but does not parse is said, not read as absent (M11)', () => {
  const root = makeRepo('notes-broken', { files: { 'docs/notes/compound.md': '# Compound notes\n\n| not | the | header |\n|--|--|--|\n' } })
  const r = suggestJson(root)
  assert.match(r.sources.notes, /^docs\/notes\/compound\.md: a table that does not parse, so T1 read nothing$/)
})

// --- T4 -------------------------------------------------------------------------------------

test('an archived ledger row citing a human decision gives one T4 candidate', () => {
  const root = makeRepo('t4', {
    files: {
      'openspec/changes/archive/2026-11-26-x/decisions.md': serializeLedger('x', [
        { id: 'D3', question: 'Which store holds the sessions?', class: 'needs_human', resolution: 'the file store', evidence: 'human decision 2026-11-26' },
        { id: 'D4', question: 'What is it called?', class: 'agent_resolved', resolution: 'widget', evidence: 'design.md D4' }
      ])
    }
  })
  const r = suggestJson(root)
  const t4 = r.candidates.filter(c => c.trigger === 'T4')
  assert.equal(t4.length, 1)
  assert.deepEqual(
    { change: t4[0].evidence[0].change, id: t4[0].evidence[0].id, question: t4[0].evidence[0].question, resolution: t4[0].evidence[0].resolution },
    { change: 'x', id: 'D3', question: 'Which store holds the sessions?', resolution: 'the file store' }
  )
})

// --- --summary, writing nothing, limits and flags ---------------------------------------------

test('--summary prints the one line when there is something to suggest and nothing otherwise, and exits 0 both ways', () => {
  const some = makeRepo('summary-some', { files: { 'docs/notes/compound.md': WIDGET_NOTES } })
  const one = cli(some, ['review-policy', 'suggest', '--summary'])
  assert.equal(one.code, 0, one.stderr)
  assert.equal(one.stdout, 'REVIEW.md candidates: 1 — interlock review-policy suggest\n')
  const none = cli(makeRepo('summary-none', { review: false }), ['review-policy', 'suggest', '--summary'])
  assert.equal(none.code, 0, none.stderr)
  assert.equal(none.stdout, '')
})

test('the command writes nothing: git status and the metrics directory are as they were', () => {
  const root = makeRepo('writes-nothing', {
    files: {
      'docs/notes/compound.md': WIDGET_NOTES,
      '.claude/metrics/review-artifacts-x-20261125-120000.json': JSON.stringify(GATE_PASS)
    }
  })
  const listing = () => (existsSync(join(root, '.claude', 'metrics')) ? readdirSync(join(root, '.claude', 'metrics'), { recursive: true }).sort() : [])
  const before = { status: git(root, ['status', '--porcelain']), metrics: listing() }
  for (const args of [[], ['--all'], ['--json'], ['--summary']]) assert.equal(cli(root, ['review-policy', 'suggest', ...args]).code, 0)
  assert.deepEqual({ status: git(root, ['status', '--porcelain']), metrics: listing() }, before)
})

test('interlock limits --json carries minSuggestChanges and staleCheckGates', () => {
  const r = cli(ROOT, ['limits', '--json'])
  assert.equal(r.code, 0, r.stderr)
  const limits = JSON.parse(r.stdout).limits
  assert.equal(typeof limits.minSuggestChanges, 'number')
  assert.equal(typeof limits.staleCheckGates, 'number')
})

test('an unknown flag exits non-zero naming it', () => {
  const root = makeRepo('flag', { review: false })
  const r = cli(root, ['review-policy', 'suggest', '--bogus'])
  assert.equal(r.code, 2, `${r.stdout}${r.stderr}`)
  assert.match(r.stderr, /--bogus/)
})
