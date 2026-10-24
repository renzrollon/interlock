// `interlock mr` — the command family the `mr` skill's review loop calls.
//
// These tests run the real binary and assert on stdout, stderr and the exit
// status, which is what the skill branches on: `remediate-brief` exiting
// non-zero is the loop's stop signal, so a refusal that prints a briefing to
// stdout anyway would spend a fixer on a round the budget forbids.
//
// Written before `lib/mr-cli.mjs` exists (change close-the-merge-request-loop,
// tasks 1.9-1.14). Finding ids are computed here from the documented identity
// (`F-` plus the first eight hex characters of the SHA-256 of the key) instead
// of imported from lib/, so the tests cannot agree with a wrong implementation
// by sharing its function.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'interlock')

const HEAD = 'a'.repeat(40)
const OTHER_HEAD = 'b'.repeat(40)
const BEFORE_HEAD = 'c'.repeat(40)

const SUBCOMMANDS = ['comment', 'replies', 'remediate-brief', 'conformance-brief', 'test-paths']

let dir
let seq = 0

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-mr-'))
})
after(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Run the real binary with cwd pinned to the temp dir. Never throws on a
 * non-zero exit; the exit status is the assertion.
 */
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd === undefined ? dir : opts.cwd,
    encoding: 'utf8',
    input: opts.input === undefined ? '' : opts.input,
    env: process.env
  })
  assert.equal(r.error, undefined, `spawn failed: ${r.error && r.error.message}`)
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function mr(sub, args = [], opts = {}) {
  return run(['mr', sub, ...args], opts)
}

/** The documented identity, restated: file trimmed, NUL, normalised title. */
function normaliseTitle(title) {
  return title.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[.:;!]+$/, '')
}
function keyOf(f) {
  return f.file.trim() + '\u0000' + normaliseTitle(f.title)
}
function idOf(f) {
  return 'F-' + createHash('sha256').update(keyOf(f)).digest('hex').slice(0, 8)
}

/** A finding in the shape `interlock review` records. */
function finding(over = {}) {
  return {
    severity: 'warning',
    dimension: 'qa',
    file: 'lib/a.mjs',
    line: 10,
    title: 'Missing null check',
    description: 'The value can be null here.',
    suggestion: 'Guard it before use.',
    ...over
  }
}

/**
 * Write an adjudicated review record under the temp dir and return its path.
 * `head` of null leaves the key out; `surviving` of undefined leaves the list
 * out and writes the raw `findings` instead (a record nobody adjudicated).
 */
function record({ head = HEAD, surviving, name } = {}) {
  seq += 1
  const file = join(dir, `${name || 'review'}-${seq}.json`)
  const body = {}
  if (head !== null) body.head = head
  if (surviving === undefined) body.findings = [finding()]
  else {
    body.surviving = surviving
    body.counts = { raised: surviving.length, surviving: surviving.length }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(body, null, 2))
  return file
}

/** Ids from a `fixed` / `open` / `new` list, whether it holds ids or objects. */
const idsOf = list => list.map(x => (typeof x === 'string' ? x : x.id))

// ── 1.9 scaffold ────────────────────────────────────────────────────────────

test('mr --help prints the five subcommands and exits 0', () => {
  const r = run(['mr', '--help'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  for (const sub of SUBCOMMANDS) {
    assert.ok(r.stdout.includes(sub), `--help does not name ${sub}:\n${r.stdout}`)
  }
})

test('an unknown mr subcommand exits 1 and names it', () => {
  const r = mr('frobnicate-the-widgets')
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '', 'a refusal prints nothing on stdout')
  assert.ok(r.stderr.includes('frobnicate-the-widgets'), `stderr: ${r.stderr}`)
  assert.ok(/subcommand/i.test(r.stderr), `stderr should say it is a subcommand: ${r.stderr}`)
})

for (const sub of SUBCOMMANDS) {
  test(`mr ${sub} without its required flags exits 1 with a usage line`, () => {
    const r = mr(sub)
    assert.equal(r.code, 1)
    assert.equal(r.stdout, '', 'a refusal prints nothing on stdout')
    const usage = r.stderr.split('\n').find(l => /usage/i.test(l))
    assert.ok(usage, `no usage line on stderr: ${r.stderr}`)
    assert.ok(usage.includes(`mr ${sub}`), `the usage line should name mr ${sub}: ${usage}`)
  })
}

// ── 1.10 comment ────────────────────────────────────────────────────────────

const TWO = [
  finding({ severity: 'blocker', file: 'lib/a.mjs', line: 12, title: 'Missing null check.', description: 'It throws on null.', suggestion: 'Return early on null.' }),
  finding({ severity: 'warning', file: 'lib/b.mjs', line: 34, title: 'Unbounded retry loop', description: 'It never gives up.', suggestion: 'Cap the attempts.' })
]

function commentArgs(file, over = {}) {
  return ['--review', file, '--head', over.head || HEAD, '--round', String(over.round === undefined ? 0 : over.round)]
}

test('comment: two findings render a heading with the round and sha, and a row each with its id', () => {
  const r = mr('comment', commentArgs(record({ surviving: TWO })))
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const heading = r.stdout.split('\n').find(l => /^#+\s/.test(l))
  assert.ok(heading, `no Markdown heading:\n${r.stdout}`)
  assert.ok(/round 0/i.test(heading), `heading should name round 0: ${heading}`)
  assert.ok(heading.includes(HEAD), `heading should name the sha: ${heading}`)
  for (const f of TWO) {
    const id = idOf(f)
    assert.match(id, /^F-[0-9a-f]{8}$/)
    const row = r.stdout.split('\n').find(l => l.startsWith('|') && l.includes(id))
    assert.ok(row, `no table row carries ${id}:\n${r.stdout}`)
    assert.ok(row.includes(f.severity), `row lacks the severity: ${row}`)
    assert.ok(row.includes(`${f.file}:${f.line}`), `row lacks file:line: ${row}`)
    assert.ok(row.includes(f.title), `row lacks the title: ${row}`)
    assert.ok(r.stdout.includes(f.description), `the description of ${id} is missing`)
    assert.ok(r.stdout.includes(f.suggestion), `the suggestion of ${id} is missing`)
  }
})

test('comment: the ids are stable across runs', () => {
  const file = record({ surviving: TWO })
  const first = mr('comment', commentArgs(file))
  const second = mr('comment', commentArgs(file))
  assert.equal(first.code, 0, `stderr: ${first.stderr}`)
  assert.equal(second.stdout, first.stdout)
  const ids = first.stdout.match(/F-[0-9a-f]{8}/g) || []
  for (const f of TWO) assert.ok(ids.includes(idOf(f)), `${idOf(f)} not in ${ids.join(', ')}`)
})

test('comment --json prints { head, round, findings } with id, key, severity, file, line and title', () => {
  const r = mr('comment', [...commentArgs(record({ surviving: TWO }), { round: 3 }), '--json'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(out).sort(), ['findings', 'head', 'round'])
  assert.equal(out.head, HEAD)
  assert.equal(out.round, 3)
  assert.deepEqual(out.findings, TWO.map(f => ({
    id: idOf(f), key: keyOf(f), severity: f.severity, file: f.file, line: f.line, title: f.title
  })))
})

test('comment: a record for another head exits 1, prints nothing, and names both commits', () => {
  const r = mr('comment', commentArgs(record({ head: OTHER_HEAD, surviving: TWO })))
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(/another commit/i.test(r.stderr), `stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(OTHER_HEAD) && r.stderr.includes(HEAD), `stderr should name both: ${r.stderr}`)
})

test('comment: a record without surviving exits 1, prints nothing, and says it is not adjudicated', () => {
  const r = mr('comment', commentArgs(record({ surviving: undefined })))
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(/not an adjudicated review/i.test(r.stderr), `stderr: ${r.stderr}`)
})

test('comment: nothing survived prints one paragraph naming the sha and the round, and exits 0', () => {
  const r = mr('comment', commentArgs(record({ surviving: [] }), { round: 1 }))
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const text = r.stdout.trim()
  assert.ok(text.length > 0, 'no comment printed')
  assert.ok(!/\n\s*\n/.test(text), `more than one paragraph:\n${text}`)
  assert.ok(text.includes(HEAD), `should name the sha: ${text}`)
  assert.ok(/round 1/i.test(text), `should name round 1: ${text}`)
  assert.ok(/no (surviving )?finding/i.test(text), `should say no finding survived: ${text}`)
  assert.ok(!/^\|/m.test(text), 'an empty list has no table rows')
})

// ── 1.11 replies ────────────────────────────────────────────────────────────

const A = finding({ file: 'lib/a.mjs', line: 5, title: 'Alpha is unchecked' })
const B = finding({ file: 'lib/b.mjs', line: 6, title: 'Bravo leaks a handle' })
const C = finding({ file: 'lib/c.mjs', line: 7, title: 'Charlie shadows a name' })

function repliesArgs(before, after, over = {}) {
  return ['--before', before, '--after', after, '--head', over.head || HEAD]
}

function tableRow(stdout, id) {
  return stdout.split('\n').find(l => l.startsWith('|') && l.includes(id))
}

test('replies: A,B before and B,C after reads fixed A, open B, new C in --json and in the table', () => {
  const before = record({ head: BEFORE_HEAD, surviving: [A, B], name: 'before' })
  const after = record({ head: HEAD, surviving: [B, C], name: 'after' })

  const j = mr('replies', [...repliesArgs(before, after), '--json'])
  assert.equal(j.code, 0, `stderr: ${j.stderr}`)
  const out = JSON.parse(j.stdout)
  assert.equal(out.head, HEAD)
  assert.deepEqual(idsOf(out.fixed), [idOf(A)])
  assert.deepEqual(idsOf(out.open), [idOf(B)])
  assert.deepEqual(idsOf(out.new), [idOf(C)])
  assert.deepEqual({ fixed: out.counts.fixed, open: out.counts.open, new: out.counts.new }, { fixed: 1, open: 1, new: 1 })

  const t = mr('replies', repliesArgs(before, after))
  assert.equal(t.code, 0, `stderr: ${t.stderr}`)
  const heading = t.stdout.split('\n').find(l => /^#+\s/.test(l))
  assert.ok(heading && heading.includes(HEAD), `heading should name the sha: ${heading}`)
  for (const [f, status] of [[A, 'fixed'], [B, 'open'], [C, 'new']]) {
    const row = tableRow(t.stdout, idOf(f))
    assert.ok(row, `no row carries ${idOf(f)}:\n${t.stdout}`)
    assert.ok(row.includes(status), `row should read ${status}: ${row}`)
    assert.ok(row.includes(f.file), `row lacks the file: ${row}`)
    assert.ok(row.includes(f.title), `row lacks the title: ${row}`)
  }
})

test('replies: an after-record for another head exits 1, prints nothing, and names both commits', () => {
  const before = record({ head: BEFORE_HEAD, surviving: [A, B], name: 'before' })
  const after = record({ head: OTHER_HEAD, surviving: [B, C], name: 'after' })
  const r = mr('replies', repliesArgs(before, after))
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(/another commit/i.test(r.stderr), `stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(OTHER_HEAD) && r.stderr.includes(HEAD), `stderr should name both: ${r.stderr}`)
})

test('replies: a record on either side that lacks surviving exits 1 and prints nothing', () => {
  const good = record({ head: HEAD, surviving: [A], name: 'good' })
  const bad = record({ surviving: undefined, name: 'bad' })
  for (const [before, after] of [[bad, good], [good, bad]]) {
    const r = mr('replies', repliesArgs(before, after))
    assert.equal(r.code, 1)
    assert.equal(r.stdout, '')
    assert.ok(/not an adjudicated review/i.test(r.stderr), `stderr: ${r.stderr}`)
  }
})

test('replies: a re-cased, re-spaced, re-punctuated title is the same finding, open, with the other file new', () => {
  const was = finding({ file: 'lib/a.mjs', title: 'Missing null check.' })
  const recased = finding({ file: 'lib/a.mjs', title: 'missing  NULL check' })
  const elsewhere = finding({ file: 'lib/b.mjs', title: 'Missing null check.' })
  assert.equal(keyOf(was), keyOf(recased), 'precondition: one key')
  assert.notEqual(keyOf(was), keyOf(elsewhere), 'precondition: another file is another key')

  const before = record({ head: BEFORE_HEAD, surviving: [was], name: 'before' })
  const after = record({ head: HEAD, surviving: [recased, elsewhere], name: 'after' })
  const r = mr('replies', [...repliesArgs(before, after), '--json'])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const out = JSON.parse(r.stdout)
  assert.deepEqual(idsOf(out.open), [idOf(was)])
  assert.deepEqual(idsOf(out.new), [idOf(elsewhere)])
  assert.deepEqual(idsOf(out.fixed), [])
})

test('replies: the same record on both sides reads every finding open, with fixed and new empty', () => {
  const both = record({ head: HEAD, surviving: [A, B], name: 'both' })

  const j = mr('replies', [...repliesArgs(both, both), '--json'])
  assert.equal(j.code, 0, `stderr: ${j.stderr}`)
  const out = JSON.parse(j.stdout)
  assert.deepEqual(idsOf(out.open).sort(), [idOf(A), idOf(B)].sort())
  assert.deepEqual(idsOf(out.fixed), [])
  assert.deepEqual(idsOf(out.new), [])

  const t = mr('replies', repliesArgs(both, both))
  assert.equal(t.code, 0, `stderr: ${t.stderr}`)
  const heading = t.stdout.split('\n').find(l => /^#+\s/.test(l))
  assert.ok(heading && heading.includes(HEAD), `heading should name the sha: ${heading}`)
  const rows = [A, B].map(f => tableRow(t.stdout, idOf(f)))
  for (const row of rows) assert.ok(row && row.includes('open'), `row should read open: ${row}`)
})

// ── 1.12 remediate-brief ────────────────────────────────────────────────────

// The cap is the CLI's to publish and the tests' to read, never to restate:
// a test that hard-coded 2 would pass after someone changed the limit.
function publishedCap() {
  const r = run(['limits', '--json'])
  assert.equal(r.code, 0, `limits --json failed: ${r.stderr}`)
  const cap = JSON.parse(r.stdout).limits.remediationRounds
  assert.ok(Number.isInteger(cap) && cap >= 1, `unexpected cap ${cap}`)
  return cap
}

const W1 = finding({ severity: 'warning', file: 'lib/a.mjs', line: 3, title: 'First warning' })
const W2 = finding({ severity: 'warning', file: 'lib/b.mjs', line: 4, title: 'Second warning' })
const BLOCKER = finding({ severity: 'blocker', file: 'lib/c.mjs', line: 5, title: 'The blocker' })
const SUGGESTION = finding({ severity: 'suggestion', file: 'lib/d.mjs', line: 6, title: 'Only a suggestion' })

function briefArgs(file, round, over = {}) {
  return [
    '--review', file, '--round', String(round), '--change', 'demo-change', '--head', HEAD,
    '--pr', '7', '--protected', over.protected || 'test/a.test.mjs',
    '--result', over.result || '.claude/ship/mr/remediate-r1.json'
  ]
}

function assertRefusal(r, label) {
  assert.equal(r.code, 1, `${label}: expected exit 1, got ${r.code}; stdout: ${r.stdout}`)
  assert.equal(r.stdout, '', `${label}: a refusal prints nothing on stdout`)
  assert.ok(r.stderr.trim().length > 0, `${label}: the reason belongs on stderr`)
  // Until `mr` exists the binary refuses it as an unknown command and dumps its
  // whole usage, which happens to contain the cap and the words "verdict round".
  // That refusal is not the planner's reason.
  assert.ok(!/unknown command/i.test(r.stderr), `${label}: stderr is the unknown-command refusal: ${r.stderr.slice(0, 80)}`)
}

test('remediate-brief: round 1 on two warnings briefs the fixer with ids, head, merge request, protected paths and result shape', () => {
  const resultPath = '.claude/ship/mr/remediate-r1.json'
  const r = mr('remediate-brief', briefArgs(record({ surviving: [W1, W2] }), 1, { protected: 'test/a.test.mjs', result: resultPath }))
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const out = r.stdout
  for (const f of [W1, W2]) assert.ok(out.includes(idOf(f)), `briefing lacks ${idOf(f)}:\n${out}`)
  assert.ok(out.includes(HEAD), 'briefing should name the head')
  assert.ok(out.includes('#7'), 'briefing should name the merge request as #7')

  const protectedAt = out.search(/protected/i)
  assert.ok(protectedAt >= 0, 'briefing should have a protected list')
  assert.ok(out.indexOf('test/a.test.mjs', protectedAt) > protectedAt, 'test/a.test.mjs should sit under the protected list')

  assert.ok(out.includes(resultPath), 'briefing should name the result file')
  for (const key of ['ok', 'fixed', 'notFixed']) assert.ok(out.includes(key), `briefing should name the result key ${key}`)

  assert.ok(!/re-review/i.test(out), 'the fixer does not re-review its own work; a fresh review of the pushed head does')
  assert.ok(/do not commit/i.test(out), 'briefing should tell the fixer not to commit')
})

test('remediate-brief: round 2 on two warnings exits 1, naming the verdict round and the published cap', () => {
  const cap = publishedCap()
  assert.ok(cap >= 2, `precondition: a published cap of at least two (got ${cap})`)
  const r = mr('remediate-brief', briefArgs(record({ surviving: [W1, W2] }), 2))
  assertRefusal(r, 'round 2, warnings only')
  assert.ok(/verdict round/i.test(r.stderr), `stderr should name the verdict round: ${r.stderr}`)
  assert.ok(new RegExp(`\\b${cap}\\b`).test(r.stderr), `stderr should name the published cap ${cap}: ${r.stderr}`)
})

test('remediate-brief: round 2 on one surviving blocker is briefed and names its id', () => {
  const cap = publishedCap()
  assert.ok(cap >= 2, `precondition: a published cap of at least two (got ${cap})`)
  const r = mr('remediate-brief', briefArgs(record({ surviving: [BLOCKER] }), 2))
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes(idOf(BLOCKER)), `briefing lacks ${idOf(BLOCKER)}:\n${r.stdout}`)
})

test('remediate-brief: the round after the cap exits 1, naming the round and the published cap', () => {
  const cap = publishedCap()
  const round = cap + 1
  const r = mr('remediate-brief', briefArgs(record({ surviving: [W1, W2] }), round))
  assertRefusal(r, `round ${round}`)
  assert.ok(new RegExp(`\\b${round}\\b`).test(r.stderr), `stderr should name round ${round}: ${r.stderr}`)
  assert.ok(new RegExp(`\\b${cap}\\b`).test(r.stderr), `stderr should name the published cap ${cap}: ${r.stderr}`)
})

test('remediate-brief: two rounds past the cap exits 1, saying the round is past the verdict round', () => {
  const cap = publishedCap()
  const r = mr('remediate-brief', briefArgs(record({ surviving: [W1, W2] }), cap + 2))
  assertRefusal(r, `round ${cap + 2}`)
  assert.ok(/past the verdict round/i.test(r.stderr), `stderr: ${r.stderr}`)
})

test('remediate-brief: an empty surviving list and a suggestions-only record each exit 1 with nothing to remediate', () => {
  for (const [label, surviving] of [['empty', []], ['suggestions only', [SUGGESTION]]]) {
    const r = mr('remediate-brief', briefArgs(record({ surviving }), 1))
    assertRefusal(r, label)
    assert.ok(/nothing to remediate/i.test(r.stderr), `${label}: stderr: ${r.stderr}`)
  }
})

// ── 1.13 test-paths ─────────────────────────────────────────────────────────

const PROFILE_PATH = join('.claude', 'testing', 'profile.json')

/**
 * A fresh project directory under the temp dir; `profile` of null writes no
 * profile at all. The profile names `test/` as its root the way a real one
 * does, through the path token in its own command.
 */
function profileProject(name, profile) {
  seq += 1
  const root = join(dir, `${name}-${seq}`)
  mkdirSync(root, { recursive: true })
  if (profile !== null) {
    mkdirSync(join(root, '.claude', 'testing'), { recursive: true })
    writeFileSync(join(root, PROFILE_PATH), JSON.stringify(profile, null, 2))
  }
  return root
}

const TEST_ROOT_PROFILE = { version: 1, unit: { command: 'node --test test/', single_file: 'node --test <path>' }, e2e: null }

function testPathsJson(root, args, input) {
  const r = mr('test-paths', [...args, '--json'], { cwd: root, input })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

test('test-paths: a profile naming test/ splits a test file from a source file and names the profile', () => {
  const root = profileProject('tp-profile', TEST_ROOT_PROFILE)
  const out = testPathsJson(root, ['--changed', 'test/a.test.mjs,lib/a.mjs'])
  assert.deepEqual(out.protected, ['test/a.test.mjs'])
  assert.deepEqual(out.unprotected, ['lib/a.mjs'])
  assert.equal(typeof out.profile, 'string', `profile should name the profile's path: ${JSON.stringify(out)}`)
  assert.ok(out.profile.replace(/\\/g, '/').endsWith('.claude/testing/profile.json'), `profile: ${out.profile}`)
})

test('test-paths: --changed - reads the same two paths from stdin, one per line, and gives the same answer', () => {
  const root = profileProject('tp-stdin', TEST_ROOT_PROFILE)
  const listed = testPathsJson(root, ['--changed', 'test/a.test.mjs,lib/a.mjs'])
  const piped = testPathsJson(root, ['--changed', '-'], 'test/a.test.mjs\nlib/a.mjs\n')
  assert.deepEqual(piped.protected, ['test/a.test.mjs'])
  assert.deepEqual(piped.unprotected, ['lib/a.mjs'])
  assert.deepEqual(piped, listed, 'stdin and the flag are one answer')
})

test('test-paths: with no profile nothing is protected, profile is null, and the reason names the missing path', () => {
  const root = profileProject('tp-none', null)
  const out = testPathsJson(root, ['--changed', 'test/a.test.mjs'])
  assert.deepEqual(out.protected, [])
  assert.equal(out.profile, null)
  assert.equal(typeof out.reason, 'string', `reason: ${JSON.stringify(out)}`)
  assert.ok(out.reason.replace(/\\/g, '/').includes('.claude/testing/profile.json'), `reason should name the missing path: ${out.reason}`)
})

// ── 1.14 conformance-brief ──────────────────────────────────────────────────

const CB_CHANGE = 'add-widget-catalogue'
const CB_SOURCE = 'src/widgets/catalogue.ts'
const CB_DELTA_REL = 'specs/widgets/catalogue/spec.md'
const CB_DELTA_PATH = `openspec/changes/${CB_CHANGE}/${CB_DELTA_REL}`
// A living spec under a capability the change does not declare, so only the
// graph can select it: the two requirements reach the list through the edge.
const CB_LIVING_PATH = 'openspec/specs/guards/commit/spec.md'
const CB_LIVING_TITLES = ['A commit SHALL be guarded', 'A guard SHALL fail open']
const CB_HANDOFF_KEYS = ['scenariosChecked', 'scenariosUnconfirmed', 'requirementsChecked', 'requirementsUnconfirmed', 'detail']

function cbDeltaSpec(scenarioCount) {
  const scenarios = Array.from(
    { length: scenarioCount },
    (_, i) => `#### Scenario: case ${i + 1}\n\n- **GIVEN** a catalogue\n- **WHEN** it renders\n- **THEN** it lists case ${i + 1}\n`
  ).join('\n')
  return `## ADDED Requirements\n\n### Requirement: The catalogue lists widgets\n\nThe catalogue SHALL list every widget.\n\n${scenarios}`
}

const CB_LIVING_SPEC = [
  '# guards/commit Specification',
  '',
  '## Purpose',
  '',
  'Commits are guarded.',
  '',
  '## Requirements',
  '',
  ...CB_LIVING_TITLES.flatMap(title => [
    `### Requirement: ${title}`,
    '',
    `${title}.`,
    '',
    '#### Scenario: Happy path — holds',
    '',
    '- **GIVEN** a commit',
    '- **WHEN** it is made',
    '- **THEN** the rule holds',
    ''
  ])
].join('\n')

const lineOf = (text, heading) => text.split('\n').findIndex(l => l === heading) + 1

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

/**
 * A checkout on the `cli.test.mjs` merge-base precedent: the base commit holds
 * the change and the living spec, the head commit adds the source file, and a
 * `.claude/graph/graph.json` (the `writeGraph` shape) links the living spec to
 * the source file when `linked` is true, and to an unrelated file otherwise.
 */
function conformanceRepo(name, { scenarios = 3, linked = true } = {}) {
  seq += 1
  const root = join(dir, `${name}-${seq}`)
  const git = args => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  mkdirSync(root, { recursive: true })
  git(['init', '-q', '-b', 'main'])
  write(`openspec/changes/${CB_CHANGE}/proposal.md`, '## Why\n\nList the widgets a shop sells in one catalogue view.\n')
  write(`openspec/changes/${CB_CHANGE}/tasks.md`, '- [ ] 1.1 Render the catalogue\n')
  write(CB_DELTA_PATH, cbDeltaSpec(scenarios))
  write(CB_LIVING_PATH, CB_LIVING_SPEC)
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'base'])
  const base = git(['rev-parse', 'HEAD'])
  write(CB_SOURCE, 'export const catalogue = () => []\n')
  write('lib/unrelated.mjs', 'export {}\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'head'])
  const head = git(['rev-parse', 'HEAD'])
  write(
    join('.claude', 'graph', 'graph.json'),
    JSON.stringify({
      graph: { built_at: '2026-01-01T00:00:00Z' },
      nodes: [],
      links: [
        {
          source: `openspec:${CB_LIVING_PATH}`,
          target: `file:${linked ? CB_SOURCE : 'lib/unrelated.mjs'}`,
          relation: 'implements_spec',
          confidence: 'INFERRED',
          source_file: CB_LIVING_PATH,
          weight: 1
        }
      ]
    })
  )
  return { root, base, head }
}

function cbArgs(repo, over = {}) {
  return [
    over.change || CB_CHANGE, '--changed', CB_SOURCE, '--base', over.base || repo.base, '--head', repo.head,
    ...(over.result ? ['--result', over.result] : [])
  ]
}

test('conformance-brief: three scenarios and two graph-selected living requirements are listed with artifact and line, bound to the head', () => {
  const repo = conformanceRepo('cb-happy')
  const r = mr('conformance-brief', cbArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const out = r.stdout
  const delta = cbDeltaSpec(3)
  for (const [i, id] of ['C1', 'C2', 'C3'].entries()) {
    assert.match(out, new RegExp(`\\b${id}\\b`), `${id} is listed:\n${out}`)
    const at = `${CB_DELTA_REL}:${lineOf(delta, `#### Scenario: case ${i + 1}`)}`
    assert.ok(out.includes(at), `${id} should cite ${at}:\n${out}`)
  }
  assert.doesNotMatch(out, /\bC4\b/, 'three scenarios, three entries')
  for (const [i, id] of ['L1', 'L2'].entries()) {
    assert.match(out, new RegExp(`\\b${id}\\b`), `${id} is listed:\n${out}`)
    const at = `${CB_LIVING_PATH}:${lineOf(CB_LIVING_SPEC, `### Requirement: ${CB_LIVING_TITLES[i]}`)}`
    assert.ok(out.includes(at), `${id} should cite ${at}:\n${out}`)
  }
  assert.doesNotMatch(out, /\bL3\b/, 'the graph selects two requirements, no more')
  assert.ok(out.includes(repo.head), 'the briefing names the head')
  assert.ok(out.includes('.claude/ship/mr/handoff.json'), 'the briefing names the default result file')
  for (const key of [...CB_HANDOFF_KEYS, 'head']) assert.match(out, new RegExp(`\\b${key}\\b`), `the briefing asks for ${key}`)
})

test('conformance-brief: --result names the file the worker answers into', () => {
  const repo = conformanceRepo('cb-result')
  const r = mr('conformance-brief', cbArgs(repo, { result: 'out/answer.json' }), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes('out/answer.json'), `the briefing should name out/answer.json:\n${r.stdout}`)
})

test('conformance-brief: an unknown change exits 1 naming it, and prints nothing', () => {
  const repo = conformanceRepo('cb-unknown')
  const r = mr('conformance-brief', cbArgs(repo, { change: 'no-such-change-anywhere' }), { cwd: repo.root })
  assert.equal(r.code, 1, `expected exit 1, got ${r.code}; stdout: ${r.stdout}`)
  assert.equal(r.stdout, '', 'a refusal prints nothing on stdout')
  assert.ok(r.stderr.includes('no-such-change-anywhere'), `stderr should name the change: ${r.stderr}`)
  assert.ok(!/unknown command/i.test(r.stderr), `stderr is the unknown-command refusal: ${r.stderr.slice(0, 80)}`)
})

test('conformance-brief: a base that names no commit still lists the scenarios, says the living list was not built, and asks for zero requirement counts', () => {
  const repo = conformanceRepo('cb-bad-base')
  const ref = 'no-such-ref-anywhere'
  const r = mr('conformance-brief', cbArgs(repo, { base: ref }), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const out = r.stdout
  for (const id of ['C1', 'C2', 'C3']) assert.match(out, new RegExp(`\\b${id}\\b`), `${id} is still listed:\n${out}`)
  assert.doesNotMatch(out, /\bL1\b/, 'no living requirement is listed')
  assert.match(out, /not built/i, 'the briefing says the living list was not built')
  assert.ok(out.includes(ref), 'the briefing says why: the reference names no commit')
  for (const key of [...CB_HANDOFF_KEYS, 'head']) assert.match(out, new RegExp(`\\b${key}\\b`), `the briefing still asks for ${key}`)
  assert.match(
    out,
    /\bzero\b|\brequirements(Checked|Unconfirmed)\b\W{0,4}0\b/i,
    'the briefing asks for the two requirement counts as zero'
  )
  assert.ok(out.includes(repo.head), 'the briefing still names the head')
})

test('conformance-brief: no scenario and nothing the graph selects prints nothing, says so on stderr, and exits 0', () => {
  const repo = conformanceRepo('cb-nothing', { scenarios: 0, linked: false })
  const r = mr('conformance-brief', cbArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '', 'nothing to confirm prints no briefing')
  assert.match(r.stderr, /nothing to confirm/i, `stderr: ${r.stderr}`)
})
