// The spec checkpoint card (make-the-run-surfaces-interactive, spec
// spec/checkpoint-card requirements 1 and 2, design D5, D7, D12): one pure
// renderer whose questions and outcome titles are the checkpoint document's, and
// whose printed commands are all ones the plugin ships.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { NOT_OBSERVED, OUTCOMES, QUESTIONS, checkpointCard } from '../../lib/checkpoint-card.mjs'
import { firstUnknownFlag, leafOf } from '../../lib/cli-flags.mjs'
import { printedCommands } from '../../lib/run-actions.mjs'
import { walkModule } from '../helpers/module-walk.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DOC = readFileSync(join(ROOT, 'docs', '02-the-checkpoint.md'), 'utf8')

const FINDINGS = '.claude/metrics/review-artifacts-add-the-thing-20261106-101500.json'
const FIELDS = {
  change: 'add-the-thing',
  artifacts: [
    { id: 'proposal', path: 'openspec/changes/add-the-thing/proposal.md', status: 'present' },
    { id: 'design', path: 'openspec/changes/add-the-thing/design.md', status: 'present' },
    { id: 'tasks', path: 'openspec/changes/add-the-thing/tasks.md', status: 'present' },
    { id: 'specs', path: 'openspec/changes/add-the-thing/specs', status: 'present' }
  ],
  ledger: 'ledger: 3 rows, 1 needs_human',
  ledgerRows: [{ id: 'D3', question: 'Is the cap ours to choose?' }],
  validate: 'validate: ok',
  gate: 'gate: 1 blocker, 0 warnings',
  findings: FINDINGS
}

const textOf = lines => lines.map(line => line.text).join('\n')

// --- the checkpoint document, read ----------------------------------------

/** The lines of the section a `## ` heading opens, up to the next `## ` heading. */
function section(heading) {
  const lines = DOC.split('\n')
  const start = lines.findIndex(line => line === `## ${heading}`)
  assert.ok(start >= 0, `docs/02-the-checkpoint.md has no "## ${heading}" heading`)
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? lines.length : end)
}

/** The cells of the "The one question" column of the table under `## The ten-minute pass`. */
function documentQuestions() {
  const rows = section('The ten-minute pass')
    .filter(line => line.startsWith('|'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
  const column = rows[0].indexOf('The one question')
  assert.ok(column >= 0, `no "The one question" column in ${rows[0].join(' | ')}`)
  return rows.slice(2).map(row => row[column])
}

/** The four bold lead-ins under `## When it looks wrong`, then the heading `## When it looks right`. */
function documentTitles() {
  const leads = section('When it looks wrong')
    .map(line => line.match(/^\*\*([^*]+?)\.\*\*/))
    .filter(Boolean)
    .map(match => match[1])
  section('When it looks right')
  return [...leads, 'When it looks right']
}

/** A message naming each entry one list holds and the other does not. */
function differences(label, ours, theirs) {
  return [
    ...ours.filter(x => !theirs.includes(x)).map(x => `${label}: the module carries "${x}", the document does not print it`),
    ...theirs.filter(x => !ours.includes(x)).map(x => `${label}: the document prints "${x}", the module does not carry it`)
  ]
}

test('the questions are the checkpoint document\'s table cells, both ways and in order', () => {
  const ours = QUESTIONS.map(q => q.question)
  const theirs = documentQuestions()
  assert.deepEqual(differences('question', ours, theirs), [])
  assert.deepEqual(ours, theirs)
  assert.ok(theirs.length >= 4)
})

test('the five outcome titles are the four bold lead-ins then the looks-right heading, both ways and in order', () => {
  const ours = OUTCOMES.map(o => o.title)
  const theirs = documentTitles()
  assert.equal(theirs.length, 5, theirs.join(' | '))
  assert.deepEqual(differences('outcome', ours, theirs), [])
  assert.deepEqual(ours, theirs)
})

test('the differences helper names a title or a question either side lacks', () => {
  assert.deepEqual(differences('outcome', ['a', 'b'], ['a', 'c']), [
    'outcome: the module carries "b", the document does not print it',
    'outcome: the document prints "c", the module does not carry it'
  ])
})

// --- the card ---------------------------------------------------------------

test('the same fields render the same keyed lines, artifacts first and the five outcomes last', () => {
  const card = checkpointCard(FIELDS)
  assert.deepEqual(checkpointCard(FIELDS), card)
  assert.deepEqual(card.map(line => line.key), [
    'checkpoint-artifact-proposal',
    'checkpoint-artifact-design',
    'checkpoint-artifact-tasks',
    'checkpoint-artifact-specs',
    'checkpoint-ledger',
    'checkpoint-ledger-row-D3',
    'checkpoint-validate',
    'checkpoint-gate',
    'checkpoint-findings',
    'checkpoint-outcome-1',
    'checkpoint-outcome-2',
    'checkpoint-outcome-3',
    'checkpoint-outcome-4',
    'checkpoint-outcome-5'
  ])
  const byKey = new Map(card.map(line => [line.key, line.text]))
  QUESTIONS.forEach((q, i) => {
    const art = FIELDS.artifacts[i]
    const text = byKey.get(`checkpoint-artifact-${q.id}`)
    assert.ok(text.includes(art.path) && text.includes(art.status) && text.includes(q.question), text)
  })
  assert.equal(byKey.get('checkpoint-ledger'), FIELDS.ledger)
  assert.equal(byKey.get('checkpoint-validate'), FIELDS.validate)
  assert.equal(byKey.get('checkpoint-gate'), FIELDS.gate)
  assert.ok(byKey.get('checkpoint-ledger-row-D3').includes('D3') && byKey.get('checkpoint-ledger-row-D3').includes(FIELDS.ledgerRows[0].question))
  assert.ok(byKey.get('checkpoint-findings').includes(FINDINGS))
  OUTCOMES.forEach((o, i) => assert.ok(byKey.get(`checkpoint-outcome-${i + 1}`).startsWith(o.title)))
  assert.ok(!/may ship|ready to ship|safe to ship|passes|cleared/i.test(textOf(card)), 'no line states a verdict')
})

test('a field that was not passed reads not observed, never a zero or a pass', () => {
  const { ledger, gate, findings, ...rest } = FIELDS
  const card = checkpointCard({ ...rest, artifacts: [{ id: 'proposal', path: 'p.md' }] })
  const byKey = new Map(card.map(line => [line.key, line.text]))
  assert.ok(byKey.get('checkpoint-ledger').includes(NOT_OBSERVED))
  assert.ok(byKey.get('checkpoint-gate').includes(NOT_OBSERVED))
  assert.ok(byKey.get('checkpoint-findings').includes(NOT_OBSERVED))
  assert.ok(byKey.get('checkpoint-artifact-proposal').includes('p.md'))
  assert.ok(byKey.get('checkpoint-artifact-proposal').includes(NOT_OBSERVED), 'a path with no status reads not observed')
  assert.ok(byKey.get('checkpoint-artifact-design').includes(NOT_OBSERVED))
  for (const bad of [undefined, null, 3, 'x', [], {}]) {
    const lines = checkpointCard(bad)
    assert.equal(lines.length, 4 + 1 + 1 + 1 + 1 + 5, `fields ${JSON.stringify(bad)} still draw a card`)
    assert.equal(new Map(lines.map(l => [l.key, l.text])).get('checkpoint-validate').includes(NOT_OBSERVED), true)
  }
})

// --- the commands the card prints ----------------------------------------------

const EXPECTED = [
  '/interlock:spec',
  'interlock validate add-the-thing',
  `/interlock:review-artifacts add-the-thing --since ${FINDINGS}`,
  '/interlock:ship add-the-thing'
]

test('printedCommands over the card returns exactly the four commands, each one time, in print order', () => {
  assert.deepEqual(printedCommands(textOf(checkpointCard(FIELDS))), EXPECTED)
})

test('each send-back prints the bare skill and no record line (decision D6)', () => {
  const [one, two] = checkpointCard(FIELDS).filter(line => line.key.startsWith('checkpoint-outcome-')).slice(0, 2)
  for (const line of [one, two]) {
    assert.deepEqual(printedCommands(line.text), ['/interlock:spec'], line.text)
    assert.doesNotMatch(line.text, /autonomy record|human-override/, line.text)
  }
  assert.doesNotMatch(textOf(checkpointCard(FIELDS)), /human-override/, 'no outcome prints the override line')
})

test('with no findings file the blockers outcome prints no command and says none was observed', () => {
  const { findings, ...rest } = FIELDS
  const card = checkpointCard(rest)
  const blockers = card.find(line => line.key === 'checkpoint-outcome-4')
  assert.deepEqual(printedCommands(blockers.text), [])
  assert.ok(blockers.text.includes('no findings file was observed'), blockers.text)
  assert.deepEqual(printedCommands(textOf(card)), [EXPECTED[0], EXPECTED[1], EXPECTED[3]])
})

test('no change name, or a name that cannot sit in a command, prints no command that takes one', () => {
  for (const change of [undefined, '', 'has space', 'a`b', 'x<y>', 3]) {
    const text = textOf(checkpointCard({ ...FIELDS, change }))
    assert.deepEqual(printedCommands(text), [EXPECTED[0]], String(change))
    assert.ok(!/[<>]/.test(text), String(change))
  }
  const unusable = textOf(checkpointCard({ ...FIELDS, findings: 'a path with spaces.json' }))
  assert.ok(!printedCommands(unusable).some(line => line.startsWith('/interlock:review-artifacts')))
})

test('no printed line holds an angle bracket, and no command holds a placeholder', () => {
  for (const fields of [FIELDS, {}, { ...FIELDS, findings: undefined }]) {
    const card = checkpointCard(fields)
    for (const line of card) assert.ok(!/[<>]/.test(line.text), line.text)
    for (const command of printedCommands(textOf(card))) assert.ok(!/[<>]/.test(command), command)
  }
})

test('each /interlock: line names a skill directory the plugin ships', () => {
  const skills = printedCommands(textOf(checkpointCard(FIELDS))).filter(line => line.startsWith('/interlock:'))
  assert.ok(skills.length >= 3)
  for (const line of skills) {
    const name = line.slice('/interlock:'.length).split(/\s/)[0]
    assert.ok(existsSync(join(ROOT, 'skills', name, 'SKILL.md')), `${line}: no skills/${name}/SKILL.md`)
  }
})

/** The leaf and flags of an `interlock …` line, read as the CLI reads its argv. */
function argvOf(line) {
  const tokens = line.split(/\s+/).slice(1)
  const flags = {}
  const positional = []
  for (const token of tokens) {
    if (token.startsWith('--')) flags[token.slice(2)] = true
    else positional.push(token)
  }
  return { positional, flags }
}

test('each interlock line is accepted by the CLI\'s own verb and flag inventory', () => {
  const lines = printedCommands(textOf(checkpointCard(FIELDS))).filter(line => line.startsWith('interlock '))
  assert.deepEqual(lines, [EXPECTED[1]])
  for (const line of lines) {
    const { positional, flags } = argvOf(line)
    assert.ok(leafOf(positional), `${line}: the inventory knows no such verb`)
    assert.equal(firstUnknownFlag(positional, flags), null, `${line}: a flag the leaf does not accept`)
  }
  // The inventory check can fail: a verb or a flag it does not hold is refused.
  assert.equal(leafOf(['not-a-verb']), null)
  assert.ok(firstUnknownFlag(['autonomy', 'record', 'spec'], { 'no-such-flag': true }))
})

test('the override record line a person may type still exits 0 against a scratch state home', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'checkpoint-card-'))
  try {
    const { positional, flags } = argvOf('interlock autonomy record spec --human-override')
    const argv = [...positional, ...Object.keys(flags).map(name => `--${name}`), '--state-home', scratch, '--root', scratch]
    const run = spawnSync(process.execPath, [join(ROOT, 'cli', 'interlock'), ...argv], { cwd: scratch, encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('the module is pure: no node: module, no bare specifier, nothing but itself in its import walk', () => {
  const entry = join(ROOT, 'lib', 'checkpoint-card.mjs')
  const { files, problems } = walkModule(entry, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.deepEqual(files, [entry])
  const source = readFileSync(entry, 'utf8')
  for (const token of ['process.', 'Date', 'readFileSync', 'import(', 'globalThis']) {
    assert.ok(!source.includes(token), `lib/checkpoint-card.mjs contains ${token}`)
  }
})
