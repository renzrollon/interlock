// The merge-confidence gather and the run's evidence file.
//
// Change `complete-and-record-the-merge-verdict`, design D1 and D9; spec
// `review/merge-confidence` ("one gather", "the run's evidence file").
//
// `lib/merge-evidence.mjs` is the one assembly of the plain object
// `assessMergeConfidence` takes. The command and a ship run's close both call
// it, so one repository state and one set of supplied inputs yield one verdict.
// The tests are RED until that module exists.
//
// Shapes pinned here, so the module, the command and the close agree:
//
//   gatherMergeEvidence(root, { change, changedPaths, base, headSha, supplied, deps })
//     change        the requested change name, or null/undefined to let the repository resolve it
//     changedPaths  the caller's changed paths (git's own list is added when a base is named)
//     base          a ref, or null when none is named
//     supplied      what only a caller can hand in: { review, verify, handoff, pipeline, coverage, run },
//                   each passed through as given and `null` when not given
//     deps          git, reached only through these four functions. Each takes the root first, the
//                   way `readAtRef` already does on `ctx.deps`:
//                     diffShape(root, base, headSha)  -> { base, changedLines, changedFiles, binaryFiles, paths }
//                                                        (what `diffShapeOf` returns today)
//                     nameStatus(root, base, headSha) -> { added, modified, deleted }  (path lists; a
//                                                        rename is a delete of the old path and an add of the new)
//                     listFiles(root, ref)            -> the tracked paths at `ref`
//                     readAtRef(root, ref, path, { maxBytes }) -> { text } | { absent: true } | { tooLarge, size }
//                                                        (may throw, naming the ref)
//     -> { input, notes }
//        input   the keys the command assembles today (change, changedPaths, headSha, artifacts, review,
//                verify, checklist, handoff, pipeline, coverage, diff, ledger, drift, reviewPolicy, run)
//                plus `living` (the living-requirement block) and `specCoverage` (the facts).
//        notes   `{ what, reason }` strings, one per thing that could not be gathered; the caller speaks them.
//
//   buildRunEvidence({ change, runId, base, headSha, committed, evidence, result }) -> the file's object
//   readRunEvidence(file, { change, headSha }) -> { usable: true, evidence } | { usable: false, reason }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  gatherMergeEvidence,
  buildRunEvidence,
  readRunEvidence,
  RUN_EVIDENCE_SCHEMA
} from '../../lib/merge-evidence.mjs'

const CHANGE = 'add-widget'
const BASE = 'base0000000000000000000000000000000000aa'
const HEAD = 'head0000000000000000000000000000000000bb'

const absent = value => value === null || value === undefined

// --- a temporary repository's files ---------------------------------------------

const ALPHA = `## Purpose

Alpha.

## Requirements

### Requirement: Alpha one SHALL hold

The system SHALL do alpha one.

#### Scenario: Happy path

- **GIVEN** a
- **WHEN** b
- **THEN** c

### Requirement: Alpha two SHALL hold

The system SHALL do alpha two.

#### Scenario: Happy path

- **GIVEN** a
- **WHEN** b
- **THEN** c
`

// The change's delta spec: modifies one alpha requirement, and names the file it adds.
const ALPHA_DELTA = `## MODIFIED Requirements

### Requirement: Alpha one SHALL hold

The system SHALL do alpha one, through \`lib/new.mjs\`.

#### Scenario: Happy path

- **GIVEN** a
- **WHEN** b
- **THEN** c
`

const GAMMA_AT_BASE = `## Purpose

Gamma.

## Requirements

### Requirement: Gamma SHALL hold

The kept file \`lib/kept.mjs\` implements it.

#### Scenario: Happy path

- **GIVEN** a
- **WHEN** b
- **THEN** c
`

// The same capability at the head: the diff took the mention out.
const GAMMA_AT_HEAD = GAMMA_AT_BASE.replace('The kept file `lib/kept.mjs` implements it.', 'Nothing names a file.')

const UNTOUCHED = `## Purpose

Untouched.

## Requirements

### Requirement: Untouched SHALL hold

The system SHALL hold.

#### Scenario: Happy path

- **GIVEN** a
- **WHEN** b
- **THEN** c
`

const REVIEW_AT_BASE = '## Always Human Review\n- lib/release/\n'

function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}

/** A repository with one change, a living spec it declares, one the diff changes, and one nobody touches. */
function repo({ declares = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'interlock-evidence-'))
  put(root, `openspec/changes/${CHANGE}/proposal.md`, '# Proposal\nwhy\n')
  put(root, `openspec/changes/${CHANGE}/design.md`, '# Design\nhow\n')
  put(root, `openspec/changes/${CHANGE}/tasks.md`, '- [x] 1.1 do it\n')
  if (declares) put(root, `openspec/changes/${CHANGE}/specs/alpha/spec.md`, ALPHA_DELTA)
  else {
    put(
      root,
      `openspec/changes/${CHANGE}/specs/delta-only/spec.md`,
      '## ADDED Requirements\n\n### Requirement: Fresh SHALL hold\n\nIt SHALL.\n\n#### Scenario: Happy path\n\n- **GIVEN** a\n- **WHEN** b\n- **THEN** c\n'
    )
  }
  put(root, 'openspec/specs/alpha/spec.md', ALPHA)
  put(root, 'openspec/specs/gamma/spec.md', GAMMA_AT_HEAD)
  put(root, 'openspec/specs/untouched/spec.md', UNTOUCHED)
  return root
}

const TRACKED = [
  'lib/new.mjs',
  'lib/kept.mjs',
  'lib/legacy.mjs',
  'openspec/specs/alpha/spec.md',
  'openspec/specs/gamma/spec.md',
  'openspec/specs/untouched/spec.md'
]

const SHAPE = {
  base: BASE,
  changedLines: 40,
  changedFiles: 3,
  binaryFiles: 0,
  paths: ['lib/new.mjs', 'lib/legacy.mjs', 'openspec/specs/gamma/spec.md']
}

/** Injected git: records every call so a test can say what was read and what was not. */
function makeDeps(over = {}) {
  const calls = { readAtRef: [], diffShape: 0, nameStatus: 0, listFiles: 0 }
  const deps = {
    diffShape: () => {
      calls.diffShape += 1
      return structuredClone(SHAPE)
    },
    nameStatus: () => {
      calls.nameStatus += 1
      return { added: ['lib/new.mjs'], modified: ['lib/legacy.mjs', 'openspec/specs/gamma/spec.md'], deleted: [] }
    },
    listFiles: () => {
      calls.listFiles += 1
      return [...TRACKED]
    },
    readAtRef: (_root, ref, path) => {
      calls.readAtRef.push({ ref, path })
      if (path === 'REVIEW.md') return { text: REVIEW_AT_BASE }
      if (path === 'openspec/specs/alpha/spec.md') return { text: ALPHA }
      if (path === 'openspec/specs/gamma/spec.md') return { text: GAMMA_AT_BASE }
      if (path === 'openspec/specs/untouched/spec.md') return { text: UNTOUCHED }
      return { absent: true }
    },
    ...over
  }
  return { deps, calls }
}

function gather(root, over = {}, depsOver = {}) {
  const { deps, calls } = makeDeps(depsOver)
  const out = gatherMergeEvidence(root, {
    change: CHANGE,
    changedPaths: ['lib/new.mjs'],
    base: BASE,
    headSha: HEAD,
    supplied: {},
    deps,
    ...over
  })
  return { ...out, calls }
}

const without = (over, key) => {
  const { [key]: _gone, ...rest } = over
  return rest
}

// --- the input object -------------------------------------------------------------

test('gatherMergeEvidence returns { input, notes } with today’s keys plus living and specCoverage', () => {
  const root = repo()
  const { input, notes } = gather(root)
  assert.ok(Array.isArray(notes))
  for (const key of [
    'change', 'changedPaths', 'headSha', 'artifacts', 'review', 'verify', 'checklist', 'handoff',
    'pipeline', 'coverage', 'diff', 'ledger', 'drift', 'reviewPolicy', 'run', 'living', 'specCoverage'
  ]) {
    assert.ok(key in input, `input.${key} is missing`)
  }
  assert.equal(input.headSha, HEAD)
  assert.equal(input.change.name, CHANGE)
  assert.deepEqual(input.change.capabilities, ['alpha'])
  assert.ok(input.artifacts['proposal.md'], 'the change’s artifacts are read from the repository')
  assert.deepEqual(input.diff, SHAPE, 'the diff shape is what the injected function returned')
  assert.ok(Array.isArray(input.drift.unarchived))
  assert.deepEqual(notes, [], 'a gather that could read everything speaks of nothing')
  rmSync(root, { recursive: true, force: true })
})

test('what only a caller can hand in is passed through as given, and is null when not given', () => {
  const root = repo()
  const supplied = {
    review: { findings: [], marker: 'review' },
    verify: { context: 'final', marker: 'verify' },
    handoff: { scenariosChecked: 2, marker: 'handoff' },
    pipeline: { headSha: HEAD, marker: 'pipeline' },
    coverage: { marker: 'coverage' },
    run: { halted: false, marker: 'run' }
  }
  const given = gather(root, { supplied }).input
  for (const key of Object.keys(supplied)) assert.deepEqual(given[key], supplied[key], key)

  const none = gather(root, { supplied: {} }).input
  for (const key of Object.keys(supplied)) assert.equal(none[key], null, `${key} reads null when not given`)
  rmSync(root, { recursive: true, force: true })
})

test('a path git reports in base...head that the caller left out is assessed too', () => {
  const root = repo()
  const { input } = gather(root, { changedPaths: ['lib/new.mjs'] })
  for (const path of SHAPE.paths) assert.ok(input.changedPaths.includes(path), `${path} is missing`)
  assert.equal(new Set(input.changedPaths).size, input.changedPaths.length, 'and none is listed twice')
  rmSync(root, { recursive: true, force: true })
})

test('the same root, change, base and supplied inputs yield deep-equal input from two calls', () => {
  const root = repo()
  const supplied = { review: { findings: [] }, run: { halted: false } }
  const a = gather(root, { supplied }).input
  const b = gather(root, { supplied }).input
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'key order is stable too')
  rmSync(root, { recursive: true, force: true })
})

test('the gather does not mutate what it is handed', () => {
  const root = repo()
  const over = { changedPaths: ['lib/new.mjs'], supplied: { review: { findings: [{ id: 'x' }] } } }
  const before = JSON.stringify(over)
  gather(root, over)
  assert.equal(JSON.stringify(over), before)
  rmSync(root, { recursive: true, force: true })
})

// --- the living list and the spec-coverage facts -----------------------------------

test('the living list is gathered from the declared capability, minus what the change supersedes', () => {
  const root = repo()
  const { input } = gather(root)
  // No graph exists in the temporary root, so the declared capability is the only selection: partial, not skipped.
  assert.ok(input.living.partial, 'a graph-less selection is partial')
  assert.equal(input.living.skipped, null)
  assert.deepEqual(input.living.requirements.map(r => r.title), ['Alpha two SHALL hold'])
  assert.equal(input.living.requirementsRequired, 1)
  assert.match(input.living.source, /base/)
  rmSync(root, { recursive: true, force: true })
})

test('a change that declares no capability, with no graph, gathers a skipped living list', () => {
  const root = repo({ declares: false })
  const { input, notes } = gather(root)
  assert.ok(input.living.skipped, 'no graph and nothing declared is a stated skip')
  assert.deepEqual(input.living.requirements, [])
  assert.deepEqual(notes, [], 'a skip is the living block’s own state, not a note')
  rmSync(root, { recursive: true, force: true })
})

test('spec coverage facts are gathered: an added file named by a delta spec, a lost mention, a legacy file', () => {
  const root = repo()
  const { input } = gather(root)
  const facts = input.specCoverage
  assert.ok(!absent(facts), 'with a base, the injected git yields facts')
  assert.deepEqual(facts.added.map(a => [a.path, a.namedBy]), [['lib/new.mjs', 'delta']])
  assert.deepEqual(facts.lost.map(l => l.path), ['lib/kept.mjs'], 'named at the base by a changed spec, by nothing at the head')
  assert.deepEqual(facts.legacy, ['lib/legacy.mjs'])
  assert.ok(facts.repo && Number.isInteger(facts.repo.total) && Number.isInteger(facts.repo.named))
  rmSync(root, { recursive: true, force: true })
})

test('living spec text at the base is read only for specs the diff changed or the living list selected', () => {
  const root = repo()
  const { calls } = gather(root)
  const read = calls.readAtRef.map(c => c.path)
  assert.ok(read.includes('openspec/specs/gamma/spec.md'), 'a spec the diff changed is read at the base')
  assert.ok(!read.includes('openspec/specs/untouched/spec.md'), 'an untouched spec mentions the same paths on both sides')
  for (const path of read) {
    assert.ok(
      ['REVIEW.md', 'openspec/specs/gamma/spec.md', 'openspec/specs/alpha/spec.md'].includes(path),
      `an unexpected base read: ${path}`
    )
  }
  for (const call of calls.readAtRef) assert.equal(call.ref, BASE, 'every read is at the base')
  rmSync(root, { recursive: true, force: true })
})

test('the base review policy is read at the base through readAtRef', () => {
  const root = repo()
  const { input } = gather(root)
  assert.ok(!absent(input.reviewPolicy))
  assert.equal(input.reviewPolicy.ref, BASE)
  assert.deepEqual(input.reviewPolicy.humanPaths, ['lib/release'])
  rmSync(root, { recursive: true, force: true })
})

// --- no base ------------------------------------------------------------------------

test('with no base, the signals that need one are absent and no git function is called', () => {
  const root = repo()
  const { input, calls } = gather(root, { base: null })
  assert.ok(absent(input.diff))
  assert.ok(absent(input.specCoverage))
  assert.ok(absent(input.reviewPolicy))
  assert.deepEqual(calls.readAtRef, [])
  assert.equal(calls.diffShape + calls.nameStatus + calls.listFiles, 0)
  rmSync(root, { recursive: true, force: true })
})

// --- degradation: a missing or throwing git function --------------------------------

function oneNote(notes, pattern) {
  assert.equal(notes.length, 1, `expected exactly one note, got ${JSON.stringify(notes)}`)
  assert.deepEqual(Object.keys(notes[0]).sort(), ['reason', 'what'])
  assert.equal(typeof notes[0].what, 'string')
  assert.equal(typeof notes[0].reason, 'string')
  assert.match(JSON.stringify(notes[0]), pattern)
}

test('a missing diffShape leaves diff absent and adds one note', () => {
  const root = repo()
  const { deps } = makeDeps()
  const { input, notes } = gatherMergeEvidence(root, {
    change: CHANGE, changedPaths: [], base: BASE, headSha: HEAD, supplied: {}, deps: without(deps, 'diffShape')
  })
  assert.ok(absent(input.diff))
  oneNote(notes, /diff/i)
  rmSync(root, { recursive: true, force: true })
})

test('a throwing diffShape completes, leaves diff absent and carries the thrown message in one note', () => {
  const root = repo()
  const { input, notes } = gather(root, {}, {
    diffShape: () => {
      throw new Error('fatal: shallow update not allowed')
    }
  })
  assert.ok(absent(input.diff))
  oneNote(notes, /shallow update not allowed/)
  assert.match(JSON.stringify(notes[0]), /diff/i)
  rmSync(root, { recursive: true, force: true })
})

test('a missing nameStatus leaves specCoverage absent and adds one note', () => {
  const root = repo()
  const { deps } = makeDeps()
  const { input, notes } = gatherMergeEvidence(root, {
    change: CHANGE, changedPaths: [], base: BASE, headSha: HEAD, supplied: {}, deps: without(deps, 'nameStatus')
  })
  assert.ok(absent(input.specCoverage))
  assert.ok(!absent(input.diff), 'the diff shape is still gathered')
  oneNote(notes, /name-?status|changed files|spec coverage/i)
  rmSync(root, { recursive: true, force: true })
})

test('a throwing nameStatus completes, leaves specCoverage absent and carries the thrown message', () => {
  const root = repo()
  const { input, notes } = gather(root, {}, {
    nameStatus: () => {
      throw new Error('bad revision')
    }
  })
  assert.ok(absent(input.specCoverage))
  oneNote(notes, /bad revision/)
  rmSync(root, { recursive: true, force: true })
})

test('a missing listFiles leaves specCoverage absent and adds one note', () => {
  const root = repo()
  const { deps } = makeDeps()
  const { input, notes } = gatherMergeEvidence(root, {
    change: CHANGE, changedPaths: [], base: BASE, headSha: HEAD, supplied: {}, deps: without(deps, 'listFiles')
  })
  assert.ok(absent(input.specCoverage))
  oneNote(notes, /list|tracked|files|spec coverage/i)
  rmSync(root, { recursive: true, force: true })
})

test('a throwing listFiles completes, leaves specCoverage absent and carries the thrown message', () => {
  const root = repo()
  const { input, notes } = gather(root, {}, {
    listFiles: () => {
      throw new Error('not a git repository')
    }
  })
  assert.ok(absent(input.specCoverage))
  oneNote(notes, /not a git repository/)
  rmSync(root, { recursive: true, force: true })
})

// With no delta spec, no changed living spec and nothing declared, the only thing read at the base is
// the review policy, so the unreadable base costs exactly one signal and one note.
const policyOnly = { nameStatus: () => ({ added: [], modified: ['lib/legacy.mjs'], deleted: [] }) }

test('a missing readAtRef leaves reviewPolicy absent and adds one note', () => {
  const root = repo({ declares: false })
  const { deps } = makeDeps(policyOnly)
  const { input, notes } = gatherMergeEvidence(root, {
    change: CHANGE, changedPaths: [], base: BASE, headSha: HEAD, supplied: {}, deps: without(deps, 'readAtRef')
  })
  assert.ok(absent(input.reviewPolicy))
  oneNote(notes, /review policy|REVIEW\.md|readAtRef|base/i)
  rmSync(root, { recursive: true, force: true })
})

test('a throwing readAtRef completes, leaves reviewPolicy absent and carries the thrown message', () => {
  const root = repo({ declares: false })
  const { input, notes } = gather(root, {}, {
    ...policyOnly,
    readAtRef: () => {
      throw new Error('cannot resolve "base" to a commit')
    }
  })
  assert.ok(absent(input.reviewPolicy))
  oneNote(notes, /cannot resolve/)
  rmSync(root, { recursive: true, force: true })
})

test('a deps object with nothing in it is not a crash', () => {
  const root = repo()
  const { input, notes } = gatherMergeEvidence(root, {
    change: CHANGE, changedPaths: ['lib/new.mjs'], base: BASE, headSha: HEAD, supplied: {}, deps: {}
  })
  assert.ok(absent(input.diff) && absent(input.specCoverage) && absent(input.reviewPolicy))
  assert.ok(notes.length >= 1)
  const noDeps = gatherMergeEvidence(root, {
    change: CHANGE, changedPaths: ['lib/new.mjs'], base: BASE, headSha: HEAD, supplied: {}
  })
  assert.ok(absent(noDeps.input.diff))
  assert.ok(noDeps.notes.length >= 1)
  rmSync(root, { recursive: true, force: true })
})

// --- the run's evidence file ---------------------------------------------------------

const EVIDENCE = {
  review: { findings: [], dimensions: { selected: ['language'], ran: ['language'] } },
  verify: { context: 'final', unit: { ok: true } },
  handoff: { scenariosChecked: 2, scenariosUnconfirmed: 0, requirementsChecked: 3, requirementsUnconfirmed: 0 },
  coverage: { diffPct: 91 },
  run: { halted: false, trajectoryComplete: true, leftoverTasks: 0 }
}
const RESULT = { verdict: 'MERGE', score: 99, sentinel: 'RESULT-SENTINEL-NEVER-AN-INPUT' }

const built = (over = {}) =>
  buildRunEvidence({
    change: CHANGE,
    runId: 'run-0001',
    base: BASE,
    headSha: HEAD,
    committed: true,
    evidence: EVIDENCE,
    result: RESULT,
    ...over
  })

test('the schema identifier is the published one', () => {
  assert.equal(RUN_EVIDENCE_SCHEMA, 'interlock.merge-evidence/1')
})

test('buildRunEvidence carries the schema, change, run id, base, head, committed, the five evidence entries and the result', () => {
  const file = built()
  assert.equal(file.schema, RUN_EVIDENCE_SCHEMA)
  assert.equal(file.change, CHANGE)
  assert.equal(file.runId, 'run-0001')
  assert.equal(file.base, BASE)
  assert.equal(file.headSha, HEAD)
  assert.equal(file.committed, true)
  assert.deepEqual(Object.keys(file.evidence).sort(), ['coverage', 'handoff', 'review', 'run', 'verify'])
  assert.deepEqual(file.evidence, EVIDENCE)
  assert.deepEqual(file.result, RESULT)
  assert.deepEqual(
    Object.keys(file).sort(),
    ['base', 'change', 'committed', 'evidence', 'headSha', 'result', 'runId', 'schema']
  )
})

test('an evidence entry the run did not observe is null, and the five keys are always present', () => {
  const file = built({ evidence: { review: EVIDENCE.review } })
  assert.deepEqual(Object.keys(file.evidence).sort(), ['coverage', 'handoff', 'review', 'run', 'verify'])
  assert.equal(file.evidence.verify, null)
  assert.equal(file.evidence.handoff, null)
  assert.equal(file.evidence.coverage, null)
  assert.equal(file.evidence.run, null)
})

test('a built file survives the disk and reads back usable for the commit the run made', () => {
  const root = mkdtempSync(join(tmpdir(), 'interlock-evidence-file-'))
  const path = join(root, 'merge-confidence.json')
  writeFileSync(path, JSON.stringify(built()))
  const read = readRunEvidence(JSON.parse(readFileSync(path, 'utf8')), { change: CHANGE, headSha: HEAD })
  assert.equal(read.usable, true)
  assert.deepEqual(read.evidence, EVIDENCE)
  rmSync(root, { recursive: true, force: true })
})

test('a usable file’s result is never returned as an input', () => {
  const read = readRunEvidence(built(), { change: CHANGE, headSha: HEAD })
  assert.equal(read.usable, true)
  assert.ok(!('result' in read), 'no result key')
  assert.ok(!('result' in read.evidence), 'and none among the evidence')
  assert.ok(!JSON.stringify(read).includes('RESULT-SENTINEL-NEVER-AN-INPUT'))
  assert.deepEqual(Object.keys(read.evidence).sort(), ['coverage', 'handoff', 'review', 'run', 'verify'])
})

test('a file with another schema identifier is unusable and the reason names the schema', () => {
  const read = readRunEvidence({ ...built(), schema: 'interlock.merge-evidence/2' }, { change: CHANGE, headSha: HEAD })
  assert.equal(read.usable, false)
  assert.match(read.reason, /schema/i)
  assert.ok(!read.evidence, 'nothing is taken from an unusable file')
  const none = readRunEvidence({ ...without(built(), 'schema') }, { change: CHANGE, headSha: HEAD })
  assert.equal(none.usable, false)
  assert.match(none.reason, /schema/i)
})

test('a file naming another change is unusable and the reason names the change', () => {
  const read = readRunEvidence(built({ change: 'some-other-change' }), { change: CHANGE, headSha: HEAD })
  assert.equal(read.usable, false)
  assert.match(read.reason, /change/i)
  assert.match(read.reason, /some-other-change/)
  assert.ok(!read.evidence)
})

test('a file that records no commit is unusable and the reason says the run made none', () => {
  const read = readRunEvidence(built({ committed: false }), { change: CHANGE, headSha: HEAD })
  assert.equal(read.usable, false)
  assert.match(read.reason, /commit/i)
  assert.ok(!read.evidence)
  const missing = readRunEvidence(without(built(), 'committed'), { change: CHANGE, headSha: HEAD })
  assert.equal(missing.usable, false, 'only an explicit committed: true counts')
})

test('a file recorded for another commit is unusable and the reason names the head', () => {
  const read = readRunEvidence(built({ headSha: 'cafe000000000000000000000000000000000000' }), {
    change: CHANGE,
    headSha: HEAD
  })
  assert.equal(read.usable, false)
  assert.match(read.reason, /head/i)
  assert.ok(!read.evidence)
  const unknownHead = readRunEvidence(built(), { change: CHANGE, headSha: null })
  assert.equal(unknownHead.usable, false, 'a head nobody can name matches nothing')
})

test('readRunEvidence refuses what is not a file object, without throwing', () => {
  for (const bad of [null, undefined, 'text', 4, [], [built()]]) {
    const read = readRunEvidence(bad, { change: CHANGE, headSha: HEAD })
    assert.equal(read.usable, false)
    assert.ok(typeof read.reason === 'string' && read.reason.length > 0)
  }
})

test('reading a file does not mutate it', () => {
  const file = built()
  const before = JSON.stringify(file)
  readRunEvidence(file, { change: CHANGE, headSha: HEAD })
  assert.equal(JSON.stringify(file), before)
})
