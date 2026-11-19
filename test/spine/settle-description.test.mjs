// `interlock settle description-brief` and `description-check`, and the pure
// rules module behind them (spec: review/pull-request-description).
//
// Written before `lib/settle-description.mjs` existed (change
// say-what-must-hold-and-how-to-undo-it, task 1.1). The module is reached
// through a dynamic import inside a helper, so this file loads while the
// module is missing and each test fails on its own.
//
// The export names, return shapes, problem strings and usage lines are the ones
// in the change's design.md under "Shapes the tests and the implementation share".

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LIMITS } from '../../lib/limits.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'cli', 'interlock')
const MODULE = join(ROOT, 'lib', 'settle-description.mjs')

/** The rules module, imported when a test asks for it: a missing module fails that test alone. */
const mod = () => import('../../lib/settle-description.mjs')

const SECTIONS = [
  'Summary',
  'Changes',
  'Must Not Change',
  'High Risk Changes',
  'Prerequisites to Production',
  'How to Roll Back',
  'Testing'
]
const REASONED = ['Must Not Change', 'How to Roll Back']

let dir
let seq = 0

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'interlock-settle-description-'))
})
after(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Run the real binary; never throws on a non-zero exit, the status is the assertion. */
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

const settle = (sub, args = [], opts = {}) => run(['settle', sub, ...args], opts)

// --- a description --------------------------------------------------------------

const CHANGE = 'this-change'
const CHANGE_LINE = `Change: \`${CHANGE}\` (openspec/changes/${CHANGE}/proposal.md)`

/**
 * A description holding the seven sections, each with a body. `bodies` replaces
 * a section's body (null leaves the section out); `change` replaces the
 * `Change:` line (null leaves it out).
 */
function description({ bodies = {}, change = CHANGE_LINE, before = '', after = '' } = {}) {
  const parts = []
  if (before) parts.push(before)
  for (const name of SECTIONS) {
    let body = name in bodies ? bodies[name] : `Body of ${name}.`
    if (body === null) continue
    if (name === 'Summary' && !('Summary' in bodies)) body = [change, '- Leads with the why.'].filter(l => l !== null).join('\n')
    parts.push(`## ${name}\n${body}`)
  }
  if (after) parts.push(after)
  return parts.join('\n\n') + '\n'
}

// --- checkDescription -------------------------------------------------------------

test('checkDescription: a complete description holds no problem, and reports each section and the Change: line', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description(), { change: CHANGE })
  assert.equal(r.ok, true, r.problems.join(' | '))
  assert.deepEqual(r.problems, [])
  assert.deepEqual(r.sections.map(s => s.heading), SECTIONS)
  for (const s of r.sections) {
    assert.equal(s.present, true, s.heading)
    assert.equal(s.empty, false, s.heading)
    assert.equal(s.bareNone, false, s.heading)
  }
  assert.equal(r.changeLine.found, true)
  assert.equal(r.changeLine.none, false)
  assert.equal(r.changeLine.change, CHANGE)
})

for (const name of SECTIONS) {
  test(`checkDescription: a description without ## ${name} reports it missing`, async () => {
    const { checkDescription } = await mod()
    const r = checkDescription(description({ bodies: { [name]: null } }))
    assert.equal(r.ok, false)
    assert.ok(r.problems.includes(`missing section: ## ${name}`), r.problems.join(' | '))
    assert.equal(r.sections.find(s => s.heading === name).present, false)
  })
}

test('checkDescription: two missing sections are both named, in template order', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description({ bodies: { 'How to Roll Back': null, 'Must Not Change': null } }))
  assert.deepEqual(r.problems, ['missing section: ## Must Not Change', 'missing section: ## How to Roll Back'])
})

test('checkDescription: a heading with nothing under it is empty', async () => {
  const { checkDescription } = await mod()
  const text = description().replace(/## Testing\n[^\n]*\n$/, '## Testing\n')
  const r = checkDescription(text)
  assert.deepEqual(r.problems, ['empty section: ## Testing'])
  assert.equal(r.sections.find(s => s.heading === 'Testing').empty, true)
  const blank = checkDescription(description({ bodies: { Changes: '   \n\n' } }))
  assert.deepEqual(blank.problems, ['empty section: ## Changes'])
})

test('checkDescription: a heading inside a fence does not count', async () => {
  const { checkDescription } = await mod()
  const text = description({ bodies: { 'How to Roll Back': null, Testing: 'Ran it.\n\n```markdown\n## How to Roll Back\nUndo: revert.\n```' } })
  const r = checkDescription(text)
  assert.deepEqual(r.problems, ['missing section: ## How to Roll Back'])
})

test('checkDescription: the confidence block and other headings are neither required nor refused', async () => {
  const { checkDescription } = await mod()
  assert.deepEqual(checkDescription(description()).problems, [], 'no ## Merge confidence is still complete')
  const framed = description({ before: '## Description\nA framing line.', after: '## Notes\nA closing note.' })
  assert.deepEqual(checkDescription(framed).problems, [])
  const withBlock = description().replace('## Changes', '## Merge confidence: HUMAN 58\nThe block.\n\n## Changes')
  assert.deepEqual(checkDescription(withBlock).problems, [])
})

for (const word of ['None', 'None.', 'none', 'N/A']) {
  for (const name of REASONED) {
    test(`checkDescription: ${JSON.stringify(word)} alone under ## ${name} is a bare None`, async () => {
      const { checkDescription } = await mod()
      const r = checkDescription(description({ bodies: { [name]: word } }))
      assert.deepEqual(r.problems, [`bare None in ## ${name}`])
      assert.equal(r.sections.find(s => s.heading === name).bareNone, true)
    })
  }
  for (const name of SECTIONS.filter(s => !REASONED.includes(s))) {
    test(`checkDescription: ${JSON.stringify(word)} alone under ## ${name} is not refused as bare`, async () => {
      const { checkDescription } = await mod()
      const r = checkDescription(description({ bodies: { [name]: word } }))
      assert.ok(!r.problems.some(p => p.startsWith('bare None') || p.startsWith('empty section')), r.problems.join(' | '))
      assert.equal(r.sections.find(s => s.heading === name).bareNone, false)
      if (name !== 'Summary') assert.equal(r.ok, true, r.problems.join(' | '))
    })
  }
}

for (const body of ['- None', '* N/A', '+ none.', '1. None', '**None**', '_N/A_', '`None`', '- **None.**', '- None\n- N/A', '\n- None\n']) {
  for (const name of REASONED) {
    test(`checkDescription: ${JSON.stringify(body)} under ## ${name} is a bare None once its list marker and emphasis are read past`, async () => {
      const { checkDescription } = await mod()
      const r = checkDescription(description({ bodies: { [name]: body } }))
      assert.deepEqual(r.problems, [`bare None in ## ${name}`])
      assert.equal(r.sections.find(s => s.heading === name).bareNone, true)
    })
  }
}

test('checkDescription: a marked-up None is still valid under the sections that may hold it', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description({ bodies: { 'High Risk Changes': '- None', 'Prerequisites to Production': '**N/A**' } }))
  assert.deepEqual(r.problems, [])
})

for (const body of ['- None: this pull request only adds a file nothing reads yet.', '- None\n- The config loader keeps its defaults.', 'Undo: None', '- Nonetheless the parser stays.']) {
  test(`checkDescription: ${JSON.stringify(body)} under ## Must Not Change says more than None`, async () => {
    const { checkDescription } = await mod()
    const r = checkDescription(description({ bodies: { 'Must Not Change': body } }))
    assert.deepEqual(r.problems, [])
  })
}

test('checkDescription: None with a reason is not bare', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description({ bodies: { 'Must Not Change': 'None: this pull request only adds a new file nothing reads yet.' } }))
  assert.deepEqual(r.problems, [])
})

test('checkDescription: a ## Summary with no Change: line is reported', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description({ change: null }))
  assert.deepEqual(r.problems, ['no Change: line under ## Summary'])
  assert.equal(r.changeLine.found, false)
})

test('checkDescription: a Change: line that names no change is reported', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description({ change: 'Change: something' }))
  assert.deepEqual(r.problems, ['Change: line names no change'])
})

test('checkDescription: with --change, a line naming another change is reported with both names', async () => {
  const { checkDescription } = await mod()
  const other = 'Change: `other-change` (openspec/changes/other-change/proposal.md)'
  assert.deepEqual(checkDescription(description({ change: other })).problems, [], 'without a change to compare, any named change is a line')
  const r = checkDescription(description({ change: other }), { change: CHANGE })
  assert.deepEqual(r.problems, [`Change: line names other-change, not ${CHANGE}`])
  assert.equal(r.changeLine.change, 'other-change')
})

test('checkDescription: Change: none passes with no change named, and is reported against a named one', async () => {
  const { checkDescription, NO_CHANGE_LINE } = await mod()
  assert.equal(NO_CHANGE_LINE, 'Change: none')
  const without = checkDescription(description({ change: 'Change: none' }))
  assert.deepEqual(without.problems, [])
  assert.equal(without.changeLine.none, true)
  const named = checkDescription(description({ change: 'Change: none' }), { change: CHANGE })
  assert.deepEqual(named.problems, [`Change: line says none, not ${CHANGE}`])
})

test('checkDescription: a missing ## Summary reports no Change: problem', async () => {
  const { checkDescription } = await mod()
  const r = checkDescription(description({ bodies: { Summary: null } }), { change: CHANGE })
  assert.deepEqual(r.problems, ['missing section: ## Summary'])
})

test('checkDescription: an empty text names all seven sections missing', async () => {
  const { checkDescription } = await mod()
  assert.deepEqual(checkDescription('').problems, SECTIONS.map(s => `missing section: ## ${s}`))
})

// --- the constants ------------------------------------------------------------------

test('the constants: seven sections in template order, two reasoned, four sources, the incomplete prefix', async () => {
  const m = await mod()
  assert.deepEqual([...m.DESCRIPTION_SECTIONS], SECTIONS)
  assert.ok(Object.isFrozen(m.DESCRIPTION_SECTIONS))
  assert.deepEqual([...m.REASONED_SECTIONS], REASONED)
  assert.ok(Object.isFrozen(m.REASONED_SECTIONS))
  assert.deepEqual(
    m.SECTION_SOURCES.map(r => [r.section, r.artifact, r.heading]),
    [
      ['Must Not Change', 'design.md', 'Goals / Non-Goals'],
      ['High Risk Changes', 'design.md', 'Risks / Trade-offs'],
      ['Prerequisites to Production', 'proposal.md', 'Impact'],
      ['How to Roll Back', 'design.md', 'Migration Plan']
    ]
  )
  assert.ok(Object.isFrozen(m.SECTION_SOURCES))
  assert.equal(m.INCOMPLETE_PREFIX, 'DESCRIPTION INCOMPLETE: ')
})

// --- changeLineFor, headingLines -----------------------------------------------------

test('changeLineFor: a named change, an archived directory, and no change', async () => {
  const { changeLineFor } = await mod()
  assert.equal(changeLineFor({ change: 'x', dir: 'openspec/changes/x' }), 'Change: `x` (openspec/changes/x/proposal.md)')
  assert.equal(
    changeLineFor({ change: 'x', dir: 'openspec/changes/archive/2026-11-01-x' }),
    'Change: `x` (openspec/changes/archive/2026-11-01-x/proposal.md)'
  )
  for (const change of ['', null, undefined]) assert.equal(changeLineFor({ change }), 'Change: none', JSON.stringify(change))
})

test('headingLines: level-2 headings with 1-based lines, fenced ones skipped', async () => {
  const { headingLines } = await mod()
  const text = ['# Title', '', '## A', 'text', '```', '## B', '```', '### Sub', '## C'].join('\n')
  assert.deepEqual(headingLines(text), [
    { heading: 'A', line: 3 },
    { heading: 'C', line: 9 }
  ])
  assert.deepEqual(headingLines(''), [])
})

// --- deltaRequirements, splitLiving ------------------------------------------------------

const DELTA_TEXT = [
  '## ADDED Requirements',
  '',
  '### Requirement: A new rule',
  '',
  'It SHALL hold.',
  '',
  '## MODIFIED Requirements',
  '',
  '### Requirement: Modified rule',
  '',
  'It SHALL hold differently.',
  '',
  '## REMOVED Requirements',
  '',
  '### Requirement: Removed rule',
  '',
  '## RENAMED Requirements',
  '',
  '- FROM: `### Requirement: Old name`',
  '- TO: `### Requirement: New name`',
  ''
].join('\n')

test('deltaRequirements: one row per ADDED, MODIFIED and REMOVED requirement, and a rename with its new name', async () => {
  const { deltaRequirements } = await mod()
  const rows = deltaRequirements([{ capability: 'guards/commit', text: DELTA_TEXT }])
  assert.deepEqual(rows, [
    { capability: 'guards/commit', section: 'ADDED', heading: 'A new rule' },
    { capability: 'guards/commit', section: 'MODIFIED', heading: 'Modified rule' },
    { capability: 'guards/commit', section: 'REMOVED', heading: 'Removed rule' },
    { capability: 'guards/commit', section: 'RENAMED', heading: 'Old name', to: 'New name' }
  ])
  assert.deepEqual(deltaRequirements([]), [])
})

test('splitLiving: a modified, a removed and a renamed-from requirement are not held, an added one subtracts nothing', async () => {
  const { splitLiving, deltaRequirements } = await mod()
  const req = (capability, title, line) => ({ capability, title, artifact: `openspec/specs/${capability}/spec.md`, line })
  const living = [
    req('guards/commit', 'Kept rule', 3),
    req('guards/commit', 'Modified rule', 9),
    req('guards/commit', 'Removed  rule', 15),
    req('guards/commit', 'Old name', 21),
    req('guards/commit', 'A new rule', 27),
    req('other/cap', 'Modified rule', 3)
  ]
  const delta = deltaRequirements([{ capability: 'guards/commit', text: DELTA_TEXT }])
  const { held, modifiedByChange } = splitLiving(living, delta)
  assert.deepEqual(held.map(r => `${r.capability}: ${r.title}`), ['guards/commit: Kept rule', 'guards/commit: A new rule', 'other/cap: Modified rule'])
  assert.equal(modifiedByChange.length, 3, JSON.stringify(modifiedByChange))
  const none = splitLiving(living, [])
  assert.equal(none.held.length, living.length)
  assert.equal(none.modifiedByChange.length, 0)
})

// --- locateSources ---------------------------------------------------------------

const PROPOSAL = '# Proposal\n\n## Why\n\nBecause.\n\n## Impact\n\n- lib/a.mjs\n'
const DESIGN = [
  '# Design',
  '',
  '## Goals / Non-Goals',
  '',
  'Leave the parser alone.',
  '',
  '## Risks / Trade-offs',
  '',
  '- A risk.',
  '',
  '## Migration Plan',
  '',
  'Revert the commit.',
  ''
].join('\n')
const lineIn = (text, heading) => text.split('\n').indexOf(heading) + 1

test('locateSources: four sources found, each with the line its heading is on', async () => {
  const { locateSources } = await mod()
  const rows = locateSources({ proposal: PROPOSAL, design: DESIGN })
  assert.deepEqual(rows, [
    { section: 'Must Not Change', artifact: 'design.md', heading: 'Goals / Non-Goals', line: lineIn(DESIGN, '## Goals / Non-Goals') },
    { section: 'High Risk Changes', artifact: 'design.md', heading: 'Risks / Trade-offs', line: lineIn(DESIGN, '## Risks / Trade-offs') },
    { section: 'Prerequisites to Production', artifact: 'proposal.md', heading: 'Impact', line: lineIn(PROPOSAL, '## Impact') },
    { section: 'How to Roll Back', artifact: 'design.md', heading: 'Migration Plan', line: lineIn(DESIGN, '## Migration Plan') }
  ])
})

test('locateSources: a design with no migration plan, no design at all, and a fenced heading read not found', async () => {
  const { locateSources } = await mod()
  const lineOf = (rows, section) => rows.find(r => r.section === section).line
  const noPlan = locateSources({ proposal: PROPOSAL, design: DESIGN.replace('## Migration Plan', 'Migration notes') })
  assert.equal(lineOf(noPlan, 'How to Roll Back'), null)
  for (const s of ['Must Not Change', 'High Risk Changes', 'Prerequisites to Production']) assert.equal(typeof lineOf(noPlan, s), 'number', s)

  const noDesign = locateSources({ proposal: PROPOSAL, design: null })
  for (const s of ['Must Not Change', 'High Risk Changes', 'How to Roll Back']) assert.equal(lineOf(noDesign, s), null, s)
  assert.equal(typeof lineOf(noDesign, 'Prerequisites to Production'), 'number')

  const fenced = locateSources({ proposal: PROPOSAL, design: DESIGN.replace('## Migration Plan', '```\n## Migration Plan\n```') })
  assert.equal(lineOf(fenced, 'How to Roll Back'), null)

  const nothing = locateSources({ proposal: null, design: null })
  assert.ok(nothing.every(r => r.line === null))
})

// --- description-brief, through the CLI ------------------------------------------------

const DB_CHANGE = 'add-widget-catalogue'
const DB_CAP = 'widgets/catalogue'
const DB_SOURCE = 'src/widgets/catalogue.ts'
const DB_LIVING = `openspec/specs/${DB_CAP}/spec.md`

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

/** A living spec holding one requirement per title, each with one scenario; `pad` lengthens every body. */
function livingSpec(titles, pad = 0) {
  return [
    `# ${DB_CAP} Specification`,
    '',
    '## Purpose',
    '',
    'Widgets are catalogued.',
    '',
    '## Requirements',
    '',
    ...titles.flatMap(title => [
      `### Requirement: ${title}`,
      '',
      `${title} SHALL hold.${pad ? ` ${'x'.repeat(pad)}` : ''}`,
      '',
      '#### Scenario: Happy path — holds',
      '',
      '- **GIVEN** a widget',
      '- **WHEN** it is listed',
      '- **THEN** the rule holds',
      ''
    ])
  ].join('\n')
}

function modifies(title) {
  return `## MODIFIED Requirements\n\n### Requirement: ${title}\n\n${title} SHALL hold differently.\n\n#### Scenario: Happy path — changed\n\n- **GIVEN** a widget\n- **WHEN** it is listed\n- **THEN** the changed rule holds\n`
}

/**
 * A checkout on the conformance-brief precedent: the base commit holds the change
 * and the living spec, the head commit adds the source file, and a graph links the
 * living spec to the source file. `files` replaces or removes (null) the change's
 * files, keyed by their path under the change directory; `archived` moves the
 * change under the archive instead.
 */
function descRepo(name, { living = ['Kept rule', 'Modified rule'], pad = 0, files = {}, archived = false } = {}) {
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
  const changeDir = archived ? `openspec/changes/archive/2026-11-01-${DB_CHANGE}` : `openspec/changes/${DB_CHANGE}`
  const changeFiles = {
    'proposal.md': PROPOSAL,
    'design.md': DESIGN,
    'tasks.md': '- [ ] 1.1 Render the catalogue\n',
    [`specs/${DB_CAP}/spec.md`]: modifies('Modified rule'),
    ...files
  }
  for (const [rel, body] of Object.entries(changeFiles)) if (body !== null) write(`${changeDir}/${rel}`, body)
  write(DB_LIVING, livingSpec(living, pad))
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'base'])
  const base = git(['rev-parse', 'HEAD'])
  write(DB_SOURCE, 'export const catalogue = () => []\n')
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'head'])
  write(
    join('.claude', 'graph', 'graph.json'),
    JSON.stringify({
      graph: { built_at: '2026-01-01T00:00:00Z' },
      nodes: [],
      links: [
        {
          source: `openspec:${DB_LIVING}`,
          target: `file:${DB_SOURCE}`,
          relation: 'implements_spec',
          confidence: 'INFERRED',
          source_file: DB_LIVING,
          weight: 1
        }
      ]
    })
  )
  return { root, base, changeDir, git }
}

const briefArgs = (repo, over = {}) => [
  ...(over.change === null ? [] : [over.change || DB_CHANGE]),
  '--changed',
  over.changed || DB_SOURCE,
  '--base',
  over.base || repo.base
]

function briefJson(repo, over = {}, opts = {}) {
  const r = settle('description-brief', [...briefArgs(repo, over), '--json'], { cwd: repo.root, ...opts })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  return { out: JSON.parse(r.stdout), stderr: r.stderr }
}

test('description-brief: a change with all four delta sections prints its Change: line and four rows', () => {
  const both = [modifies('Modified rule'), '## ADDED Requirements\n\n### Requirement: A new rule\n\nIt SHALL hold.\n',
    '## REMOVED Requirements\n\n### Requirement: Removed rule\n',
    '## RENAMED Requirements\n\n- FROM: `### Requirement: Old name`\n- TO: `### Requirement: New name`\n'].join('\n')
  const repo = descRepo('db-four', { living: ['Kept rule', 'Modified rule', 'Removed rule', 'Old name'], files: { [`specs/${DB_CAP}/spec.md`]: both } })
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const lines = r.stdout.split('\n')
  assert.equal(lines[0], `description facts for "${DB_CHANGE}" (openspec/changes/${DB_CHANGE}): 1 changed path(s), base ${repo.base}`)
  assert.ok(r.stdout.includes(`Change: \`${DB_CHANGE}\` (openspec/changes/${DB_CHANGE}/proposal.md)`), r.stdout)
  for (const row of [
    `MODIFIED ${DB_CAP}: Modified rule`,
    `ADDED ${DB_CAP}: A new rule`,
    `REMOVED ${DB_CAP}: Removed rule`,
    `RENAMED ${DB_CAP}: Old name -> New name`
  ]) {
    assert.ok(r.stdout.includes(row), `missing row ${row}:\n${r.stdout}`)
  }
})

test('description-brief: --json carries every key, the line and the delta rows', () => {
  const repo = descRepo('db-json', { files: { [`specs/${DB_CAP}/spec.md`]: `${modifies('Modified rule')}\n## ADDED Requirements\n\n### Requirement: A new rule\n\nIt SHALL hold.\n` } })
  const { out } = briefJson(repo)
  for (const key of ['change', 'dir', 'archived', 'changeLine', 'changedPaths', 'base', 'requirements', 'living', 'sources']) {
    assert.ok(key in out, `--json lacks ${key}: ${JSON.stringify(out)}`)
  }
  for (const key of ['held', 'modifiedByChange', 'omitted', 'skipped', 'partial', 'source']) assert.ok(key in out.living, `living lacks ${key}`)
  assert.equal(out.change, DB_CHANGE)
  assert.equal(out.dir, `openspec/changes/${DB_CHANGE}`)
  assert.equal(out.archived, false)
  assert.equal(out.changeLine, `Change: \`${DB_CHANGE}\` (openspec/changes/${DB_CHANGE}/proposal.md)`)
  assert.equal(out.base, repo.base)
  assert.equal(out.requirements.length, 2)
  for (const row of out.requirements) for (const key of ['capability', 'section', 'heading']) assert.ok(key in row, `row lacks ${key}`)
  assert.equal(out.sources.length, 4)
})

test('description-brief: a held requirement is listed with its artifact and line beside the count the change modifies', () => {
  const repo = descRepo('db-held')
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const text = livingSpec(['Kept rule', 'Modified rule'])
  const at = `${DB_LIVING}:${lineIn(text, '### Requirement: Kept rule')}`
  assert.ok(r.stdout.includes(at), `the held requirement should cite ${at}:\n${r.stdout}`)
  assert.ok(!r.stdout.includes(`${DB_LIVING}:${lineIn(text, '### Requirement: Modified rule')}`), `the modified requirement is not held:\n${r.stdout}`)
  assert.ok(r.stdout.includes('1 held, 1 modified by the change'), r.stdout)
  const { out } = briefJson(repo)
  assert.deepEqual(out.living.held.map(h => h.title), ['Kept rule'])
  assert.equal(out.living.modifiedByChange.length, 1)
})

test('description-brief: a renamed requirement is not held', () => {
  const rename = '## RENAMED Requirements\n\n- FROM: `### Requirement: Old name`\n- TO: `### Requirement: New name`\n'
  const repo = descRepo('db-rename', { living: ['Kept rule', 'Old name'], files: { [`specs/${DB_CAP}/spec.md`]: rename } })
  const { out } = briefJson(repo)
  assert.deepEqual(out.living.held.map(h => h.title), ['Kept rule'])
  assert.equal(out.living.modifiedByChange.length, 1)
})

test('description-brief: a living spec longer than the bound has its left-out count spoken', () => {
  const titles = Array.from({ length: 8 }, (_, i) => `Rule ${i + 1}`)
  const pad = Math.ceil(LIMITS.maxDomainSpecChars / 4)
  const repo = descRepo('db-bound', { living: titles, pad, files: { [`specs/${DB_CAP}/spec.md`]: null } })
  const { out } = briefJson(repo)
  assert.ok(out.living.omitted.length > 0, JSON.stringify(out.living))
  assert.ok(out.living.held.length > 0, JSON.stringify(out.living))
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes(`${out.living.omitted.length} requirement(s) left out by the size bound`), r.stdout)
})

test('description-brief: with no change named beside an open change, the line says none and every selected requirement is held', () => {
  const repo = descRepo('db-none')
  const r = settle('description-brief', briefArgs(repo, { change: null }), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.equal(r.stdout.split('\n')[0], `description facts with no change named: 1 changed path(s), base ${repo.base}`)
  assert.ok(r.stdout.split('\n').includes('Change: none'), r.stdout)
  assert.ok(!r.stdout.includes(DB_CHANGE), `the open change is not picked by default:\n${r.stdout}`)
  const { out } = briefJson(repo, { change: null })
  assert.equal(out.change, null)
  assert.equal(out.changeLine, 'Change: none')
  assert.deepEqual(out.requirements, [])
  assert.deepEqual(out.living.held.map(h => h.title), ['Kept rule', 'Modified rule'])
  assert.equal(out.living.modifiedByChange.length, 0)
})

test('description-brief: a change with no specs/ says its delta specs hold no requirement', () => {
  const repo = descRepo('db-nospecs', { files: { [`specs/${DB_CAP}/spec.md`]: null } })
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes(`Change: \`${DB_CHANGE}\``), r.stdout)
  assert.ok(r.stdout.includes('delta specs hold no requirement'), r.stdout)
  assert.deepEqual(briefJson(repo).out.requirements, [])
})

test('description-brief: a change read from the archive is announced, named by its archived proposal, and nothing is written', () => {
  const repo = descRepo('db-archive', { archived: true })
  const status = () => repo.git(['status', '--porcelain', '--untracked-files=all'])
  const was = status()
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stderr.includes(`CHANGE READ FROM ARCHIVE: ${repo.changeDir}`), r.stderr)
  assert.ok(r.stdout.includes(`Change: \`${DB_CHANGE}\` (${repo.changeDir}/proposal.md)`), r.stdout)
  assert.equal(status(), was, 'no file was written')
  const { out } = briefJson(repo)
  assert.equal(out.archived, true)
  assert.equal(out.dir, repo.changeDir)
})

test('description-brief: --changed - reads the paths from standard input', () => {
  const repo = descRepo('db-stdin')
  const r = settle('description-brief', briefArgs(repo, { changed: '-' }), { cwd: repo.root, input: `${DB_SOURCE}\nlib/a.mjs\nlib/b.mjs\n` })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.split('\n')[0].includes('3 changed path(s)'), r.stdout)
})

test('description-brief: a base that names no commit is a reason, not an exit', () => {
  const repo = descRepo('db-badbase')
  const r = settle('description-brief', briefArgs(repo, { base: 'no-such-ref' }), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes(`Change: \`${DB_CHANGE}\``), r.stdout)
  assert.ok(r.stdout.includes(`MODIFIED ${DB_CAP}: Modified rule`), r.stdout)
  assert.match(r.stdout, /not built: [^\n]*no-such-ref/, r.stdout)
  const { out } = briefJson(repo, { base: 'no-such-ref' })
  assert.equal(typeof out.living.skipped, 'string')
  assert.deepEqual(out.living.held, [])
})

test('description-brief: a change directory with no proposal still names the proposal path, and its source row reads not found', () => {
  const repo = descRepo('db-noproposal', { files: { 'proposal.md': null } })
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.includes(`Change: \`${DB_CHANGE}\` (openspec/changes/${DB_CHANGE}/proposal.md)`), r.stdout)
  const row = r.stdout.split('\n').find(l => l.includes('## Prerequisites to Production'))
  assert.ok(row && row.includes('not found'), `the proposal's source row: ${row}\n${r.stdout}`)
  const { out } = briefJson(repo)
  assert.equal(out.sources.find(s => s.section === 'Prerequisites to Production').line, null)
})

test('description-brief: the source rows name the artifact, the heading and the line', () => {
  const repo = descRepo('db-sources', { files: { 'design.md': DESIGN.replace('## Migration Plan', 'Migration notes') } })
  const r = settle('description-brief', briefArgs(repo), { cwd: repo.root })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  const rowOf = section => r.stdout.split('\n').find(l => l.includes(`## ${section}`) && l.includes('.md'))
  assert.ok(rowOf('Must Not Change').includes(`design.md ## Goals / Non-Goals`) && rowOf('Must Not Change').includes(String(lineIn(DESIGN, '## Goals / Non-Goals'))), r.stdout)
  assert.ok(rowOf('How to Roll Back').includes('not found'), r.stdout)
})

test('description-brief: an unknown change exits 1 naming it, with nothing on standard output', () => {
  const repo = descRepo('db-unknown')
  const r = settle('description-brief', briefArgs(repo, { change: 'no-such-change' }), { cwd: repo.root })
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.includes('no-such-change'), r.stderr)
})

test('description-brief: a missing --base or --changed is refused with the usage line', () => {
  const repo = descRepo('db-flags')
  for (const args of [[DB_CHANGE, '--changed', DB_SOURCE], [DB_CHANGE, '--base', repo.base]]) {
    const r = settle('description-brief', args, { cwd: repo.root })
    assert.equal(r.code, 1, args.join(' '))
    assert.equal(r.stdout, '')
    assert.ok(r.stderr.includes('usage: interlock settle description-brief'), r.stderr)
  }
})

// --- description-check, through the CLI -------------------------------------------------

function descFile(text) {
  seq += 1
  const file = join(dir, `description-${seq}.md`)
  writeFileSync(file, text)
  return file
}

const INCOMPLETE = 'interlock: DESCRIPTION INCOMPLETE: '

test('description-check: a complete description from a file exits 0 with one description complete line', () => {
  const r = settle('description-check', ['--file', descFile(description()), '--change', CHANGE])
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.equal(r.stdout, `description complete: ${CHANGE_LINE}\n`)
})

test('description-check: --file - reads the description from standard input', () => {
  const r = settle('description-check', ['--file', '-'], { input: description() })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.startsWith('description complete'), r.stdout)
})

test('description-check: an incomplete description exits 1 with empty standard output, naming each problem after the prefix', () => {
  const text = description({ bodies: { 'Must Not Change': null, 'How to Roll Back': 'None.' } })
  const r = settle('description-check', ['--file', descFile(text)])
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.startsWith(INCOMPLETE), r.stderr)
  assert.ok(r.stderr.includes('missing section: ## Must Not Change; bare None in ## How to Roll Back'), r.stderr)
})

test('description-check: --change refuses a line naming another change', () => {
  const r = settle('description-check', ['--file', descFile(description()), '--change', 'other-change'])
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.includes(`Change: line names ${CHANGE}, not other-change`), r.stderr)
})

test('description-check: a broken input exits 1 without the incomplete words', () => {
  const cases = [
    ['no --file', [], ''],
    ['a missing file', ['--file', join(dir, 'no-such-description.md')], ''],
    ['input that is not JSON', ['--file', '-', '--from-json', 'body'], 'not json {'],
    ['a key that holds no string', ['--file', '-', '--from-json', 'body'], '{"body": null}'],
    ['a key that is absent', ['--file', '-', '--from-json', 'body'], '{"title": "x"}'],
    ['JSON that is not an object', ['--file', '-', '--from-json', 'body'], '["x"]']
  ]
  for (const [what, args, input] of cases) {
    const r = settle('description-check', args, { input })
    assert.equal(r.code, 1, what)
    assert.equal(r.stdout, '', what)
    assert.ok(r.stderr.startsWith('interlock: '), `${what}: ${r.stderr}`)
    assert.ok(!r.stderr.includes('DESCRIPTION INCOMPLETE'), `${what}: ${r.stderr}`)
  }
})

test('description-check: an empty body on the platform is incomplete, naming seven missing sections', () => {
  const r = settle('description-check', ['--file', '-', '--from-json', 'body'], { input: '{"body": ""}' })
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.ok(r.stderr.startsWith(INCOMPLETE), r.stderr)
  for (const s of SECTIONS) assert.ok(r.stderr.includes(`missing section: ## ${s}`), r.stderr)
})

test('description-check: --from-json picks the description out of the platform document', () => {
  const r = settle('description-check', ['--file', '-', '--from-json', 'description'], { input: JSON.stringify({ iid: 7, description: description() }) })
  assert.equal(r.code, 0, `stderr: ${r.stderr}`)
  assert.ok(r.stdout.startsWith('description complete'), r.stdout)
})

test('description-check: --json prints the verdict object at both verdicts', () => {
  const ok = settle('description-check', ['--file', descFile(description()), '--json'])
  assert.equal(ok.code, 0, `stderr: ${ok.stderr}`)
  const okOut = JSON.parse(ok.stdout)
  for (const key of ['ok', 'problems', 'sections', 'changeLine']) assert.ok(key in okOut, `lacks ${key}`)
  assert.equal(okOut.ok, true)

  const bad = settle('description-check', ['--file', descFile(description({ bodies: { Testing: null } })), '--json'])
  assert.equal(bad.code, 1)
  const badOut = JSON.parse(bad.stdout)
  for (const key of ['ok', 'problems', 'sections', 'changeLine']) assert.ok(key in badOut, `lacks ${key}`)
  assert.equal(badOut.ok, false)
  assert.deepEqual(badOut.problems, ['missing section: ## Testing'])
  assert.ok(bad.stderr.startsWith(INCOMPLETE), bad.stderr)
})

test('description-check: a flag the table does not hold is refused, naming it', () => {
  const r = settle('description-check', ['--file', descFile(description()), '--nonsense'])
  assert.notEqual(r.code, 0)
  assert.ok(r.stderr.includes('--nonsense'), r.stderr)
})

// --- the family: help, docs, purity --------------------------------------------------

test('SETTLE_HELP holds both usage lines', async () => {
  const { SETTLE_HELP } = await import('../../lib/settle-cli.mjs')
  assert.ok(SETTLE_HELP.includes('  interlock settle description-brief [<change>] --changed <files|-> --base <ref> [--json]\n'), SETTLE_HELP)
  assert.ok(SETTLE_HELP.includes('  interlock settle description-check --file <file|-> [--from-json <key>] [--change <name>] [--json]\n'), SETTLE_HELP)
})

test('docs/07 describes both commands in its settle table', () => {
  const doc = readFileSync(join(ROOT, 'docs', '07-cli-and-configuration.md'), 'utf8')
  for (const leaf of ['description-brief', 'description-check']) {
    assert.ok(new RegExp(`^\\|\\s*\`interlock settle ${leaf} `, 'm').test(doc), `docs/07 has no settle table row beginning \`interlock settle ${leaf} `)
  }
})

test('the rules module imports no node: module', () => {
  let source
  try {
    source = readFileSync(MODULE, 'utf8')
  } catch (err) {
    assert.fail(`lib/settle-description.mjs could not be read: ${err.message}`)
  }
  const specifiers = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
  assert.deepEqual(specifiers.filter(s => s.startsWith('node:')), [])
})
