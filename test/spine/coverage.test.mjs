// The coverage reader: lcov parsing on canonical repository paths, project
// totals, changed-line coverage from a `git diff -U0`, the baseline schema, and
// the nine-field coverage input the merge verdict reads. One scenario per
// scenario in judge-against-base-and-living-specs/specs/verify/spec.md (the
// reader, the baseline and the coverage input), against lib/coverage.mjs (design D2).
//
// The module is imported as a namespace so a missing export fails only the test
// that uses it. Every path is resolved against a fixed fake root: the module is
// pure, so no file has to exist.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as coverage from '../../lib/coverage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', 'fixtures', 'coverage')
const read = name => readFileSync(join(FIXTURES, name), 'utf8')

const ROOT = '/work/repo'
const AT_ROOT = { root: ROOT, reportDir: ROOT }
// The seven figures, and the two fields that name changed source the report does
// not list (design D13 of label-and-harden-the-merge-verdict).
const INPUT_FIELDS = [
  'baseIsAncestor',
  'baseSha',
  'baseTotalPct',
  'changedLines',
  'configured',
  'diffPct',
  'headTotalPct',
  'unreportedAddedLines',
  'unreportedFiles'
]

// `parseLcov` returns `{ records, outsideRoot }`; a record is
// `{ path, lines: Map<line, hits>, lf, lh }`.
const parse = (name, opts = AT_ROOT) => coverage.parseLcov(read(name), opts)
const figureFor = (lcov, opts, diffName = 'added-a.diff') => {
  const { records } = coverage.parseLcov(read(lcov), opts)
  return coverage.changedLineCoverage(records, coverage.parseAddedLines(read(diffName)))
}

// --- totals ----------------------------------------------------------------

test('the project total is covered over instrumented lines across every record, from LF and LH', () => {
  const { records } = parse('two-files.lcov')
  assert.deepEqual(records.map(r => r.path).sort(), ['lib/a.mjs', 'lib/b.mjs'])
  // The summaries (100/80 and 20/15) win over the handful of DA lines beside them.
  const totals = coverage.coverageTotals(records)
  assert.equal(totals.lf, 120)
  assert.equal(totals.lh, 95)
  assert.equal(totals.totalPct, 79.2) // 95 / 120 = 79.1666…, one decimal
})

test('a record with only DA entries is totalled from them', () => {
  const { records } = parse('da-only.lcov')
  const totals = coverage.coverageTotals(records)
  assert.equal(totals.lf, 10)
  assert.equal(totals.lh, 7)
  assert.equal(totals.totalPct, 70)
})

test('a report that instruments no line has a null total, not zero', () => {
  const { records } = parse('no-lines.lcov')
  const totals = coverage.coverageTotals(records)
  assert.equal(totals.totalPct, null)
  assert.notEqual(totals.totalPct, 0)
  assert.equal(coverage.coverageTotals([]).totalPct, null)
  assert.equal(coverage.parseLcov('', AT_ROOT).records.length, 0)
})

// --- the diff --------------------------------------------------------------

test('parseAddedLines reads the new side of every hunk and lands a rename on its new path', () => {
  const added = coverage.parseAddedLines(read('modified-renamed-deleted.diff'))
  assert.deepEqual([...added.keys()].sort(), ['lib/a.mjs', 'lib/b.mjs'])
  // Modified: +10,6 is 10..15; the pure-deletion hunk (+36,0) adds nothing; +46 is one line.
  assert.deepEqual([...added.get('lib/a.mjs')].sort((x, y) => x - y), [10, 11, 12, 13, 14, 15, 46])
  // Renamed: +3,2 on the new path; the old name is not a key.
  assert.deepEqual([...added.get('lib/b.mjs')].sort((x, y) => x - y), [3, 4])
  assert.ok(!added.has('lib/old-name.mjs'))
  // Deleted (+++ /dev/null): adds nothing and is not a key.
  assert.ok(!added.has('lib/gone.mjs'))
  assert.ok(![...added.keys()].includes('/dev/null'))
})

test('parseAddedLines on an empty diff is an empty map', () => {
  assert.equal(coverage.parseAddedLines('').size, 0)
})

// --- changed-line coverage -------------------------------------------------

test('changed-line coverage counts only the added lines the report instruments', () => {
  const { records } = parse('two-files.lcov')
  const added = coverage.parseAddedLines(read('added-a.diff'))
  assert.deepEqual([...added.get('lib/a.mjs')].sort((x, y) => x - y), [10, 11, 12, 13, 14, 15])
  const changed = coverage.changedLineCoverage(records, added)
  // Lines 14 and 15 are comments no DA entry instruments: they are not changed lines.
  assert.equal(changed.changedLines, 4)
  assert.equal(changed.coveredLines, 3)
  assert.equal(changed.diffPct, 75)
})

test('an added line in a file the report does not cover is not a changed line', () => {
  const { records } = parse('two-files.lcov')
  const added = new Map([['lib/uncovered.mjs', new Set([1, 2, 3])]])
  const changed = coverage.changedLineCoverage(records, added)
  assert.equal(changed.changedLines, 0)
  assert.equal(changed.diffPct, null) // nothing measured is absent, never 100 and never 0
})

test('three spellings of one file resolve to the same path and give the same figure', () => {
  const dot = parse('spelling-dot.lcov')
  const abs = parse('spelling-absolute.lcov')
  const sub = parse('spelling-subdir.lcov', { root: ROOT, reportDir: `${ROOT}/packages/app` })
  for (const parsed of [dot, abs, sub]) {
    assert.deepEqual(parsed.records.map(r => r.path), ['lib/a.mjs'])
    assert.equal(parsed.outsideRoot, 0)
  }
  const figures = [
    figureFor('spelling-dot.lcov', AT_ROOT),
    figureFor('spelling-absolute.lcov', AT_ROOT),
    figureFor('spelling-subdir.lcov', { root: ROOT, reportDir: `${ROOT}/packages/app` })
  ]
  for (const figure of figures) {
    assert.equal(figure.changedLines, 4)
    assert.equal(figure.coveredLines, 3)
    assert.equal(figure.diffPct, 75)
  }
  assert.deepEqual(figures[0], figures[1])
  assert.deepEqual(figures[1], figures[2])
})

test('a relative record is resolved against the report directory, not the root', () => {
  const { records } = parse('subdir-own.lcov', { root: ROOT, reportDir: `${ROOT}/packages/app` })
  assert.deepEqual(records.map(r => r.path), ['packages/app/src/x.mjs'])
})

test('a record outside the root is counted, not kept, and left out of both figures', () => {
  const parsed = parse('outside-root.lcov')
  assert.deepEqual(parsed.records.map(r => r.path), ['lib/a.mjs'])
  // /other/place/z.mjs, /work/repo-other/y.mjs (a shared name prefix is not inside)
  // and ../../../elsewhere.mjs relative to the root.
  assert.equal(parsed.outsideRoot, 3)
  const totals = coverage.coverageTotals(parsed.records)
  assert.equal(totals.lf, 4)
  assert.equal(totals.lh, 3)
  assert.equal(totals.totalPct, 75)
  const changed = coverage.changedLineCoverage(
    parsed.records,
    coverage.parseAddedLines(read('added-a.diff'))
  )
  assert.equal(changed.changedLines, 4)
  assert.equal(changed.diffPct, 75)
})

// --- changed source the report does not list ---------------------------------
//
// `unreportedChangedSource(records, added)` -> `{ files, addedLines }`: the
// coverable source files the diff adds at least one line to and the report holds
// no record for, in path order, and the lines the diff adds in them.

const addedMap = entries => new Map(entries.map(([path, lines]) => [path, new Set(lines)]))

test('a changed source file the report holds no record for is listed, with the lines the diff adds in it', () => {
  const { records } = parse('two-files.lcov') // lib/a.mjs and lib/b.mjs
  const added = addedMap([
    ['lib/a.mjs', [1, 2, 3]],
    ['lib/new.mjs', [1, 2, 3, 4, 5]],
    ['lib/also-new.mjs', [10, 11]]
  ])
  assert.deepEqual(coverage.unreportedChangedSource(records, added), {
    files: ['lib/also-new.mjs', 'lib/new.mjs'],
    addedLines: 7
  })
})

test('every changed source file in the report gives an empty list and a zero', () => {
  const { records } = parse('two-files.lcov')
  const added = addedMap([['lib/a.mjs', [1]], ['lib/b.mjs', [4, 5]]])
  assert.deepEqual(coverage.unreportedChangedSource(records, added), { files: [], addedLines: 0 })
  assert.deepEqual(coverage.unreportedChangedSource(records, new Map()), { files: [], addedLines: 0 })
})

test('a test file, a configuration file and a document are never listed, by the coverable-source rule', () => {
  const { records } = parse('two-files.lcov')
  const added = addedMap([
    ['test/x.test.mjs', [1, 2, 3]],
    ['package.json', [4]],
    ['docs/notes.md', [1, 2]],
    ['README.md', [9]],
    ['vite.config.ts', [1]],
    ['.github/workflows/ci.yml', [1]]
  ])
  assert.deepEqual(coverage.unreportedChangedSource(records, added), { files: [], addedLines: 0 })
  // Beside a real one, only the real one is listed, and only its lines are counted.
  added.set('lib/new.mjs', new Set([1, 2]))
  assert.deepEqual(coverage.unreportedChangedSource(records, added), { files: ['lib/new.mjs'], addedLines: 2 })
})

test('a file the diff touches without adding a line is not listed', () => {
  const { records } = parse('two-files.lcov')
  const added = addedMap([['lib/emptied.mjs', []]])
  assert.deepEqual(coverage.unreportedChangedSource(records, added), { files: [], addedLines: 0 })
})

test('unreportedChangedSource tolerates what is not a record list or a map, and mutates neither', () => {
  for (const [records, added] of [[null, null], [undefined, new Map()], ['x', {}]]) {
    assert.deepEqual(coverage.unreportedChangedSource(records, added), { files: [], addedLines: 0 })
  }
  const { records } = parse('two-files.lcov')
  const added = addedMap([['lib/new.mjs', [3, 1, 2]]])
  const before = JSON.stringify([records.map(r => r.path), [...added].map(([k, v]) => [k, [...v]])])
  coverage.unreportedChangedSource(records, added)
  assert.equal(JSON.stringify([records.map(r => r.path), [...added].map(([k, v]) => [k, [...v]])]), before)
})

test('naming the unreported files leaves the changed-line figure what it was', () => {
  const { records } = parse('two-files.lcov')
  const withNew = coverage.parseAddedLines(read('added-a.diff'))
  const figure = coverage.changedLineCoverage(records, withNew)
  withNew.set('lib/new.mjs', new Set([1, 2, 3]))
  assert.deepEqual(coverage.changedLineCoverage(records, withNew), figure)
  assert.deepEqual(coverage.unreportedChangedSource(records, withNew).files, ['lib/new.mjs'])
})

// --- buildCoverageInput ----------------------------------------------------

const HEAD = { totalPct: 79.2, lf: 120, lh: 95 }
const CHANGED = { changedLines: 4, coveredLines: 3, diffPct: 75 }
const BASELINE = {
  schema: coverage.BASELINE_SCHEMA,
  sha: 'a'.repeat(40),
  ref: 'main',
  totalPct: 81.5,
  generatedAt: '2026-10-12T09:00:00.000Z'
}

test('buildCoverageInput emits exactly the nine fields the merge verdict reads', () => {
  const input = coverage.buildCoverageInput({
    configured: true,
    head: HEAD,
    baseline: BASELINE,
    baseIsAncestor: true,
    changed: CHANGED
  })
  assert.deepEqual(Object.keys(input).sort(), INPUT_FIELDS)
  assert.deepEqual(input, {
    configured: true,
    headTotalPct: 79.2,
    baseTotalPct: 81.5,
    baseSha: 'a'.repeat(40),
    baseIsAncestor: true,
    diffPct: 75,
    changedLines: 4,
    // Configured, and not handed the unreported files: not stated, never an empty list.
    unreportedFiles: null,
    unreportedAddedLines: null
  })
})

test('buildCoverageInput carries the unreported files and their added lines beside the seven figures', () => {
  const unreported = { files: ['lib/b.mjs', 'lib/new.mjs'], addedLines: 43 }
  const input = coverage.buildCoverageInput({
    configured: true,
    head: HEAD,
    baseline: BASELINE,
    baseIsAncestor: true,
    changed: CHANGED,
    unreported
  })
  assert.deepEqual(Object.keys(input).sort(), INPUT_FIELDS)
  assert.deepEqual(input.unreportedFiles, ['lib/b.mjs', 'lib/new.mjs'])
  assert.equal(input.unreportedAddedLines, 43)
  // The figures are what they are without it.
  assert.equal(input.diffPct, 75)
  assert.equal(input.changedLines, 4)
  // Nothing unreported is an empty list and a zero: a statement, not an absence.
  const none = coverage.buildCoverageInput({ configured: true, head: HEAD, changed: CHANGED, unreported: { files: [], addedLines: 0 } })
  assert.deepEqual(none.unreportedFiles, [])
  assert.equal(none.unreportedAddedLines, 0)
  // The list handed in is copied, never aliased.
  assert.notEqual(input.unreportedFiles, unreported.files)
})

test('a repository with no coverage configured states no unreported files, whatever it is handed', () => {
  const input = coverage.buildCoverageInput({ configured: false, unreported: { files: ['lib/new.mjs'], addedLines: 9 } })
  assert.deepEqual(Object.keys(input).sort(), INPUT_FIELDS)
  assert.equal(input.unreportedFiles, null)
  assert.equal(input.unreportedAddedLines, null)
})

test('a baseline whose commit is not an ancestor is passed through marked so, never dropped or banded', () => {
  const input = coverage.buildCoverageInput({
    configured: true,
    head: HEAD,
    baseline: BASELINE,
    baseIsAncestor: false,
    changed: CHANGED
  })
  assert.deepEqual(Object.keys(input).sort(), INPUT_FIELDS)
  assert.equal(input.baseIsAncestor, false)
  assert.equal(input.baseSha, 'a'.repeat(40))
  assert.equal(input.baseTotalPct, 81.5)
})

test('with no baseline every base field is empty and the changed-line figures remain', () => {
  const input = coverage.buildCoverageInput({
    configured: true,
    head: HEAD,
    baseline: null,
    baseIsAncestor: null,
    changed: CHANGED
  })
  assert.deepEqual(Object.keys(input).sort(), INPUT_FIELDS)
  assert.equal(input.baseTotalPct, null)
  assert.equal(input.baseSha, null)
  assert.equal(input.baseIsAncestor, null)
  assert.equal(input.headTotalPct, 79.2)
  assert.equal(input.diffPct, 75)
  assert.equal(input.changedLines, 4)
})

test('a repository with no coverage configured says so and carries nothing else', () => {
  const input = coverage.buildCoverageInput({
    configured: false,
    head: null,
    baseline: null,
    baseIsAncestor: null,
    changed: null
  })
  assert.deepEqual(Object.keys(input).sort(), INPUT_FIELDS)
  assert.equal(input.configured, false)
  for (const key of INPUT_FIELDS.filter(k => k !== 'configured')) {
    assert.equal(input[key], null, `${key} must be null, not zero or false`)
  }
})

// --- the baseline schema ---------------------------------------------------

test('BASELINE_SCHEMA is the versioned identifier the baseline file carries', () => {
  assert.equal(coverage.BASELINE_SCHEMA, 'interlock.coverage-baseline/1')
})

// `validateBaseline(obj)` returns `{ ok, problems }`.
test('validateBaseline accepts a complete baseline, with or without a branch name', () => {
  assert.equal(coverage.validateBaseline(BASELINE).ok, true)
  assert.deepEqual(coverage.validateBaseline(BASELINE).problems, [])
  assert.equal(coverage.validateBaseline({ ...BASELINE, ref: null }).ok, true)
})

test('validateBaseline rejects a missing schema identifier', () => {
  const { schema, ...noSchema } = BASELINE
  const verdict = coverage.validateBaseline(noSchema)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some(msg => /schema/.test(msg)))
  assert.equal(coverage.validateBaseline({ ...BASELINE, schema: 'something/else' }).ok, false)
})

test('validateBaseline rejects a total that is not a number from 0 to 100', () => {
  for (const totalPct of [-0.1, 100.1, 250, 'high', null, undefined, NaN]) {
    const verdict = coverage.validateBaseline({ ...BASELINE, totalPct })
    assert.equal(verdict.ok, false, `totalPct ${String(totalPct)} must be rejected`)
    assert.ok(verdict.problems.some(msg => /totalPct|total/.test(msg)))
  }
  assert.equal(coverage.validateBaseline({ ...BASELINE, totalPct: 0 }).ok, true)
  assert.equal(coverage.validateBaseline({ ...BASELINE, totalPct: 100 }).ok, true)
})

test('validateBaseline rejects a value that is not an object', () => {
  for (const bad of [null, undefined, 'x', 7, []]) {
    assert.equal(coverage.validateBaseline(bad).ok, false)
  }
})
