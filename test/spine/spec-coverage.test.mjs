// The facts behind the `spec.coverage` signal — which source files a diff adds,
// edits and keeps, and whether a living spec or the change's own delta specs
// name them.
//
// `specCoverageFacts` is pure: spec text and path lists in, a plain structure
// out. It reads no graph (the graph is gitignored and absent in CI), no git and
// no disk, so everything here is built from the fixtures under
// test/fixtures/spec-coverage and from literals. A file is named when a spec
// mentions its repository-relative path by the one rule the graph's extractor
// shares (`specMentionedPaths`), and only coverable source is judged.
// design D7 and D8 of complete-and-record-the-merge-verdict.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { specCoverageFacts } from '../../lib/spec-coverage.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'spec-coverage')

/** A fixture spec as the gather hands it over: its repository path and its text. */
function spec(tree, path) {
  return { path, text: readFileSync(join(FIXTURES, tree, path), 'utf8') }
}

const WIDGETS = 'openspec/specs/widgets/spec.md'
const GADGETS = 'openspec/specs/gadgets/spec.md'
const TRIMMED = 'openspec/specs/trimmed/spec.md'
const KEPT = 'openspec/specs/kept/spec.md'
const DELTA = 'openspec/changes/demo/specs/widgets/spec.md'

const livingAtHead = () => [spec('head', WIDGETS), spec('head', GADGETS), spec('head', TRIMMED)]
const deltaSpecs = () => [spec('delta', DELTA)]

/** Every key the facts take, empty, with the named keys overridden. */
function input(overrides = {}) {
  return {
    added: [],
    modified: [],
    sourceFiles: [],
    livingAtHead: livingAtHead(),
    changedSpecsAtBase: [],
    deltaSpecs: [],
    ...overrides
  }
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
const sorted = list => [...list].sort(byPath)

test('the facts carry exactly added, lost, legacy and repo', () => {
  const facts = specCoverageFacts(input())
  assert.deepEqual(Object.keys(facts).sort(), ['added', 'legacy', 'lost', 'repo'])
})

test('an empty diff over an empty repository has nothing to judge and a zero figure', () => {
  const facts = specCoverageFacts(input({ livingAtHead: [] }))
  assert.deepEqual(facts, { added: [], lost: [], legacy: [], repo: { named: 0, total: 0 } })
})

test('the facts do not change their inputs', () => {
  const frozen = input({
    added: ['lib/new.mjs'],
    modified: ['lib/old.mjs'],
    sourceFiles: ['lib/new.mjs', 'lib/old.mjs'],
    changedSpecsAtBase: [spec('base', KEPT)],
    deltaSpecs: deltaSpecs()
  })
  const copy = structuredClone(frozen)
  specCoverageFacts(frozen)
  assert.deepEqual(frozen, copy)
})

// --- added ----------------------------------------------------------------

test('an added source file a delta spec mentions is named by delta', () => {
  const facts = specCoverageFacts(
    input({ added: ['lib/new.mjs'], sourceFiles: ['lib/new.mjs'], deltaSpecs: deltaSpecs() })
  )
  assert.deepEqual(facts.added, [{ path: 'lib/new.mjs', namedBy: 'delta' }])
})

test('./lib/new.mjs in a spec names lib/new.mjs', () => {
  // The delta fixture spells it with a leading ./ and nowhere else.
  assert.ok(deltaSpecs()[0].text.includes('./lib/new.mjs'))
  const facts = specCoverageFacts(
    input({ added: ['lib/new.mjs'], sourceFiles: ['lib/new.mjs'], deltaSpecs: deltaSpecs() })
  )
  assert.equal(facts.added[0].namedBy, 'delta')
})

test('an added source file a living spec at the head mentions is named by living', () => {
  const facts = specCoverageFacts(
    input({ added: ['lib/gadget.mjs'], sourceFiles: ['lib/gadget.mjs'] })
  )
  assert.deepEqual(facts.added, [{ path: 'lib/gadget.mjs', namedBy: 'living' }])
})

test('living specs name a file in a backticked, a quoted and a bare mention alike', () => {
  const files = ['lib/widget.mjs', 'lib/quoted.mjs', 'lib/bare.mjs']
  const facts = specCoverageFacts(input({ added: files, sourceFiles: files }))
  assert.deepEqual(
    sorted(facts.added),
    sorted(files.map(path => ({ path, namedBy: 'living' })))
  )
})

test('an added source file no spec mentions is named by null', () => {
  const facts = specCoverageFacts(
    input({ added: ['lib/orphan.mjs'], sourceFiles: ['lib/orphan.mjs'], deltaSpecs: deltaSpecs() })
  )
  assert.deepEqual(facts.added, [{ path: 'lib/orphan.mjs', namedBy: null }])
})

test('a path that only a URL mentions is not named', () => {
  const facts = specCoverageFacts(
    input({ added: ['lib/url-only.mjs'], sourceFiles: ['lib/url-only.mjs'] })
  )
  assert.deepEqual(facts.added, [{ path: 'lib/url-only.mjs', namedBy: null }])
})

test('added files are told apart one by one', () => {
  const files = ['lib/new.mjs', 'lib/gadget.mjs', 'lib/orphan.mjs']
  const facts = specCoverageFacts(
    input({ added: files, sourceFiles: files, deltaSpecs: deltaSpecs() })
  )
  assert.deepEqual(sorted(facts.added), [
    { path: 'lib/gadget.mjs', namedBy: 'living' },
    { path: 'lib/new.mjs', namedBy: 'delta' },
    { path: 'lib/orphan.mjs', namedBy: null }
  ])
})

test('an added test, configuration file and document are not judged, named or not', () => {
  const added = [
    'test/spine/new.test.mjs',
    'lib/thing.config.mjs',
    'docs/guide.md',
    'tests/unit/helper.mjs'
  ]
  const facts = specCoverageFacts(input({ added, sourceFiles: added }))
  assert.deepEqual(facts.added, [])
})

test('only the coverable file is listed when a diff adds source beside a test and a document', () => {
  const added = ['lib/orphan.mjs', 'test/spine/orphan.test.mjs', 'docs/orphan.md']
  const facts = specCoverageFacts(input({ added, sourceFiles: added }))
  assert.deepEqual(facts.added, [{ path: 'lib/orphan.mjs', namedBy: null }])
})

test('a rename counts its new path as an added path, and the old path is nowhere', () => {
  // The base named lib/before.mjs; the rename moved it to lib/after.mjs, which
  // nothing names. The old path is gone from the head, so it cannot be lost.
  const before = { path: KEPT, text: 'The module `lib/before.mjs` SHALL serve.\n' }
  const facts = specCoverageFacts(
    input({
      added: ['lib/after.mjs'],
      sourceFiles: ['lib/after.mjs'],
      changedSpecsAtBase: [before]
    })
  )
  assert.deepEqual(facts.added, [{ path: 'lib/after.mjs', namedBy: null }])
  assert.deepEqual(facts.lost, [])
})

test('a rename to a path a delta spec names is named by delta', () => {
  const facts = specCoverageFacts(
    input({ added: ['lib/new.mjs'], sourceFiles: ['lib/new.mjs'], deltaSpecs: deltaSpecs() })
  )
  assert.equal(facts.added[0].namedBy, 'delta')
})

// --- lost -----------------------------------------------------------------

test('a kept file named at the base only by a spec the diff deleted is lost', () => {
  const facts = specCoverageFacts(
    input({ sourceFiles: ['lib/kept.mjs'], changedSpecsAtBase: [spec('base', KEPT)] })
  )
  assert.deepEqual(facts.lost, [{ path: 'lib/kept.mjs', spec: KEPT }])
  assert.deepEqual(facts.added, [])
})

test('a kept file whose spec the diff edited to drop the mention is lost, naming that spec', () => {
  const facts = specCoverageFacts(
    input({ sourceFiles: ['lib/trimmed.mjs'], changedSpecsAtBase: [spec('base', TRIMMED)] })
  )
  assert.deepEqual(facts.lost, [{ path: 'lib/trimmed.mjs', spec: TRIMMED }])
})

test('a lost file is not lost when a delta spec names it at the head', () => {
  const facts = specCoverageFacts(
    input({
      sourceFiles: ['lib/kept.mjs'],
      changedSpecsAtBase: [spec('base', KEPT)],
      deltaSpecs: deltaSpecs()
    })
  )
  assert.deepEqual(facts.lost, [])
})

test('a lost file is not lost when another living spec at the head names it', () => {
  const other = { path: 'openspec/specs/other/spec.md', text: 'It lives in `lib/kept.mjs`.\n' }
  const facts = specCoverageFacts(
    input({
      sourceFiles: ['lib/kept.mjs'],
      livingAtHead: [...livingAtHead(), other],
      changedSpecsAtBase: [spec('base', KEPT)]
    })
  )
  assert.deepEqual(facts.lost, [])
})

test('a spec the diff changed but still names the file in is not a loss', () => {
  const sameAtHead = { path: TRIMMED, text: spec('base', TRIMMED).text }
  const facts = specCoverageFacts(
    input({
      sourceFiles: ['lib/trimmed.mjs'],
      livingAtHead: [...livingAtHead().filter(s => s.path !== TRIMMED), sameAtHead],
      changedSpecsAtBase: [spec('base', TRIMMED)]
    })
  )
  assert.deepEqual(facts.lost, [])
})

test('a file the diff deleted is not lost with its spec', () => {
  // Named at the base by a deleted spec, and gone from the head with it.
  const facts = specCoverageFacts(
    input({ sourceFiles: [], changedSpecsAtBase: [spec('base', KEPT)] })
  )
  assert.deepEqual(facts.lost, [])
})

test('a file the diff adds is judged as added, never as lost', () => {
  const facts = specCoverageFacts(
    input({
      added: ['lib/kept.mjs'],
      sourceFiles: ['lib/kept.mjs'],
      changedSpecsAtBase: [spec('base', KEPT)]
    })
  )
  assert.deepEqual(facts.lost, [])
  assert.deepEqual(facts.added, [{ path: 'lib/kept.mjs', namedBy: null }])
})

test('a tracked file that was never named at the base is not lost', () => {
  const facts = specCoverageFacts(
    input({ sourceFiles: ['lib/never.mjs'], changedSpecsAtBase: [spec('base', KEPT)] })
  )
  assert.deepEqual(facts.lost, [])
})

test('a test, configuration file or document named by a deleted spec is not lost', () => {
  const base = {
    path: KEPT,
    text: 'See `test/spine/kept.test.mjs`, `lib/kept.config.mjs` and `docs/kept.md`.\n'
  }
  const sourceFiles = ['test/spine/kept.test.mjs', 'lib/kept.config.mjs', 'docs/kept.md']
  const facts = specCoverageFacts(input({ sourceFiles, changedSpecsAtBase: [base] }))
  assert.deepEqual(facts.lost, [])
})

// --- legacy ---------------------------------------------------------------

test('an edited source file nothing names is legacy', () => {
  const facts = specCoverageFacts(
    input({ modified: ['lib/old.mjs'], sourceFiles: ['lib/old.mjs'] })
  )
  assert.deepEqual(facts.legacy, ['lib/old.mjs'])
  assert.deepEqual(facts.added, [])
  assert.deepEqual(facts.lost, [])
})

test('an edited source file a living spec names is not legacy', () => {
  const facts = specCoverageFacts(
    input({ modified: ['lib/widget.mjs'], sourceFiles: ['lib/widget.mjs'] })
  )
  assert.deepEqual(facts.legacy, [])
})

test('an edited source file a delta spec names is not legacy', () => {
  const facts = specCoverageFacts(
    input({ modified: ['lib/new.mjs'], sourceFiles: ['lib/new.mjs'], deltaSpecs: deltaSpecs() })
  )
  assert.deepEqual(facts.legacy, [])
})

test('an edited test, configuration file and document are not legacy', () => {
  const modified = ['test/spine/old.test.mjs', 'lib/old.config.mjs', 'docs/old.md']
  const facts = specCoverageFacts(input({ modified, sourceFiles: modified }))
  assert.deepEqual(facts.legacy, [])
})

test('an edited file that lost its spec is lost and not legacy', () => {
  const facts = specCoverageFacts(
    input({
      modified: ['lib/kept.mjs'],
      sourceFiles: ['lib/kept.mjs'],
      changedSpecsAtBase: [spec('base', KEPT)]
    })
  )
  assert.deepEqual(facts.lost, [{ path: 'lib/kept.mjs', spec: KEPT }])
  assert.deepEqual(facts.legacy, [])
})

test('legacy lists each edited unnamed file once', () => {
  const modified = ['lib/old.mjs', 'lib/older.mjs', 'lib/widget.mjs']
  const facts = specCoverageFacts(input({ modified, sourceFiles: modified }))
  assert.deepEqual([...facts.legacy].sort(), ['lib/old.mjs', 'lib/older.mjs'])
})

// --- repo -----------------------------------------------------------------

test('repo is the tracked coverable source files that are named, over all of them', () => {
  const sourceFiles = [
    'lib/widget.mjs', // a living spec names it
    'lib/new.mjs', // a delta spec names it
    'lib/orphan.mjs', // nothing names it
    'test/spine/widget.test.mjs', // not coverable
    'lib/widget.config.mjs', // not coverable
    'docs/widget.md' // not coverable
  ]
  const facts = specCoverageFacts(input({ sourceFiles, deltaSpecs: deltaSpecs() }))
  assert.deepEqual(facts.repo, { named: 2, total: 3 })
})

test('repo counts a file the diff does not touch', () => {
  const sourceFiles = ['lib/gadget.mjs', 'lib/old.mjs', 'lib/older.mjs']
  const facts = specCoverageFacts(input({ sourceFiles }))
  assert.deepEqual(facts.repo, { named: 1, total: 3 })
})

test('repo is named over total even when the diff touches nothing', () => {
  const facts = specCoverageFacts(input({ sourceFiles: ['lib/orphan.mjs', 'lib/widget.mjs'] }))
  assert.deepEqual(facts.repo, { named: 1, total: 2 })
  assert.deepEqual(facts.added, [])
  assert.deepEqual(facts.legacy, [])
})

test('repo never names more files than it counts', () => {
  const sourceFiles = ['lib/widget.mjs', 'lib/quoted.mjs', 'lib/bare.mjs', 'lib/gadget.mjs']
  const { repo } = specCoverageFacts(input({ sourceFiles }))
  assert.ok(repo.named <= repo.total)
  assert.deepEqual(repo, { named: 4, total: 4 })
})
