// Drift detection — the two signals, and the line between them.
//
// The whole design rests on keeping signal A (certain) apart from signal B
// (inferred), and on never letting an absent input read as a clean one. Most of
// what follows tests those two properties rather than the happy path, because
// the happy path is the part that would survive a careless refactor anyway.
//
// Git is injected everywhere via `lastCommit`, so none of this needs a repo.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeDrift,
  detectOrphans,
  detectStaleSpecs,
  detectUnarchived,
  formatDrift
} from '../../lib/drift.mjs'

function repo() {
  return mkdtempSync(join(tmpdir(), 'interlock-drift-'))
}

/** Write a change with the three required artifacts and a tasks.md. */
function change(root, name, tasksMd) {
  const dir = join(root, 'openspec', 'changes', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'proposal.md'), '# Proposal\nwhy\n')
  writeFileSync(join(dir, 'design.md'), '# Design\nhow\n')
  writeFileSync(join(dir, 'tasks.md'), tasksMd)
}

function graph(root, links, { nodes = [], builtAt = '2026-01-01T00:00:00Z' } = {}) {
  const dir = join(root, '.claude', 'graph')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'graph.json'),
    JSON.stringify({ graph: { built_at: builtAt }, nodes, links })
  )
}

/** Graph file nodes, for the orphan-coverage denominator. */
const fileNode = path => ({ id: `file:${path}`, type: 'file', source_file: path })

/** Every cited file still on disk — the default for the aging tests. */
const allPresent = () => true

const specLink = (spec, file, weight = 1) => ({
  source: `openspec:${spec}`,
  target: `file:${file}`,
  relation: 'implements_spec',
  confidence: 'INFERRED',
  source_file: spec,
  weight
})

// --- signal A: unarchived ---------------------------------------------------

test('a change with every task ticked is reported as unarchived', () => {
  const root = repo()
  change(root, 'add-login', '- [x] 1.1 handler\n- [x] 1.2 test\n')
  const found = detectUnarchived(root)
  assert.equal(found.length, 1)
  assert.equal(found[0].change, 'add-login')
  assert.equal(found[0].tasks, 2)
  rmSync(root, { recursive: true, force: true })
})

test('a change with work remaining is not drift', () => {
  const root = repo()
  change(root, 'wip', '- [x] 1.1 done\n- [ ] 1.2 not done\n')
  assert.deepEqual(detectUnarchived(root), [])
  rmSync(root, { recursive: true, force: true })
})

test('a change with no tasks at all is not reported as complete', () => {
  // Zero of zero is not "all done" — it is unstarted or malformed. Reporting it
  // would train people to skim the report, which costs more than it catches.
  const root = repo()
  change(root, 'empty', '# Tasks\n\nnothing here yet\n')
  assert.deepEqual(detectUnarchived(root), [])
  rmSync(root, { recursive: true, force: true })
})

test('a repo with no openspec directory reports no unarchived changes', () => {
  const root = repo()
  assert.deepEqual(detectUnarchived(root), [])
  rmSync(root, { recursive: true, force: true })
})

// --- signal B: stale living specs -------------------------------------------

const times = map => path => map[path] || null

test('a spec citing a file that no longer exists is reported as broken', () => {
  // The evidence tier. The edge was gated by knownFiles at build time, so the
  // file existed then and does not now — a fact about the tree, not a guess.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    exists: () => false,
    lastCommit: times({ 'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z' })
  })
  assert.equal(result.skipped, false)
  assert.deepEqual(result.broken, [{ spec: 'openspec/specs/auth/spec.md', file: 'lib/auth.ts' }])
  rmSync(root, { recursive: true, force: true })
})

test('a missing file is reported as broken and never also as aging', () => {
  // Reporting one deletion twice, once as fact and once as inference, would make
  // the reader reconcile two findings that are the same finding.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    exists: () => false,
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.equal(result.broken.length, 1)
  assert.deepEqual(result.aging, [])
  rmSync(root, { recursive: true, force: true })
})

test('a spec whose files all exist reports no broken references', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    exists: allPresent,
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-06-01T00:00:00Z',
      'lib/auth.ts': '2026-01-01T00:00:00Z'
    })
  })
  assert.deepEqual(result.broken, [])
  assert.deepEqual(result.aging, [])
  assert.equal(result.indexed, 1)
  rmSync(root, { recursive: true, force: true })
})

test('a living spec older than a still-present file it links to is aging', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    exists: allPresent,
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.equal(result.aging.length, 1)
  assert.equal(result.aging[0].spec, 'openspec/specs/auth/spec.md')
  assert.deepEqual(result.aging[0].newerFiles.map(f => f.file), ['lib/auth.ts'])
  rmSync(root, { recursive: true, force: true })
})

test('the graph build time travels with the report', () => {
  // A file "missing" against a month-old graph may just have been renamed. The
  // report cannot resolve that, so it hands the reader the date and lets them.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')], {
    builtAt: '2026-03-04T05:06:07Z'
  })
  const result = detectStaleSpecs(root, { exists: allPresent, lastCommit: () => null })
  assert.equal(result.graphBuiltAt, '2026-03-04T05:06:07Z')
  rmSync(root, { recursive: true, force: true })
})

test('weight-0.5 symbol edges are ignored', () => {
  // A spec naming `AuthService` links to every AuthService in the repo. Staleness
  // built on that is noise, so only weight-1 path mentions count.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts', 0.5)])
  const result = detectStaleSpecs(root, {
    exists: () => false,
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.deepEqual(result.aging, [])
  assert.deepEqual(result.broken, [])
  assert.equal(result.indexed, 0)
  rmSync(root, { recursive: true, force: true })
})

test('specs inside an in-flight change are not checked for staleness', () => {
  // openspec/changes/**/specs are deltas under active work. They are expected to
  // move relative to code; only openspec/specs/ is the living record.
  const root = repo()
  graph(root, [specLink('openspec/changes/add-login/specs/auth.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    exists: () => false,
    lastCommit: times({
      'openspec/changes/add-login/specs/auth.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.deepEqual(result.aging, [])
  assert.deepEqual(result.broken, [])
  assert.equal(result.indexed, 0)
  rmSync(root, { recursive: true, force: true })
})

test('a spec git has never seen is skipped for aging but still checked for broken refs', () => {
  // Existence needs no git history. Only the date comparison does, so an
  // unknown spec loses the weak signal and keeps the strong one.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    exists: () => false,
    lastCommit: times({ 'lib/auth.ts': '2026-06-01T00:00:00Z' })
  })
  assert.deepEqual(result.aging, [])
  assert.equal(result.broken.length, 1)
  rmSync(root, { recursive: true, force: true })
})

test('a missing graph is reported as skipped with a reason, not as clean', () => {
  const root = repo()
  const result = detectStaleSpecs(root)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /no graph/i)
  assert.deepEqual(result.broken, [])
  assert.deepEqual(result.aging, [])
  rmSync(root, { recursive: true, force: true })
})

test('an unreadable graph is reported as skipped, not as clean', () => {
  const root = repo()
  mkdirSync(join(root, '.claude', 'graph'), { recursive: true })
  writeFileSync(join(root, '.claude', 'graph', 'graph.json'), '{ not json')
  const result = detectStaleSpecs(root)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /could not be read/i)
  rmSync(root, { recursive: true, force: true })
})

// --- signal C: orphan code ---------------------------------------------------

test('a changed source file no spec describes is an orphan', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')], {
    nodes: [fileNode('lib/auth.ts'), fileNode('lib/billing.ts')]
  })
  const result = detectOrphans(root, ['lib/auth.ts', 'lib/billing.ts'])
  assert.equal(result.skipped, false)
  assert.deepEqual(result.orphans, ['lib/billing.ts'])
  assert.equal(result.considered, 2)
  rmSync(root, { recursive: true, force: true })
})

test('orphan detection ignores docs, config and test files', () => {
  // isCoverableSource does the filtering. A README with no spec is not a gap.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')], {
    nodes: [fileNode('lib/auth.ts')]
  })
  const result = detectOrphans(root, [
    'README.md',
    'tsconfig.json',
    'lib/auth.test.ts',
    'lib/auth.ts'
  ])
  assert.equal(result.considered, 1, 'only lib/auth.ts is coverable source')
  assert.deepEqual(result.orphans, [])
  rmSync(root, { recursive: true, force: true })
})

test('the coverage denominator comes from the graph file nodes', () => {
  // The count is meaningless without it: "2 orphans" alarms, "2 of 6 in a repo
  // that is 50% specced" informs.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')], {
    nodes: [fileNode('lib/auth.ts'), fileNode('lib/billing.ts'), fileNode('docs/guide.md')]
  })
  const result = detectOrphans(root, ['lib/billing.ts'])
  // docs/guide.md is not coverable source, so the denominator is 2, not 3.
  assert.deepEqual(result.coverage, { owned: 1, total: 2, percent: 50 })
  rmSync(root, { recursive: true, force: true })
})

test('orphan detection skips entirely when no spec links to any file', () => {
  // Every file would be "unowned", which is the loudest possible way to say
  // nothing. Absence of coverage is not evidence of orphans.
  const root = repo()
  graph(root, [], { nodes: [fileNode('lib/billing.ts')] })
  const result = detectOrphans(root, ['lib/billing.ts'])
  assert.equal(result.skipped, true)
  assert.match(result.reason, /spec coverage/i)
  assert.deepEqual(result.orphans, [])
  rmSync(root, { recursive: true, force: true })
})

test('orphan detection is not run at all without a changed list', () => {
  // Absent diff and empty diff are different. Only the first is "not checked".
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const report = analyzeDrift(root, { exists: allPresent, lastCommit: () => null })
  assert.equal(report.orphans.skipped, true)
  assert.match(report.orphans.reason, /--changed/)
  rmSync(root, { recursive: true, force: true })
})

// --- the report -------------------------------------------------------------

test('the report never claims a clean check when nothing was indexed', () => {
  // "none stale" on a repo with no living specs reads as a passed check. It is
  // an empty one, and the wording has to say so.
  const root = repo()
  graph(root, [])
  const text = formatDrift(analyzeDrift(root))
  assert.match(text, /nothing to check/i)
  assert.doesNotMatch(text, /none of \d+ living spec/i)
  rmSync(root, { recursive: true, force: true })
})

test('the report names the aging tier as inferred and advisory', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const report = analyzeDrift(root, {
    exists: allPresent,
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  const text = formatDrift(report)
  assert.match(text, /INFERRED/)
  assert.match(text, /advisory/i)
  rmSync(root, { recursive: true, force: true })
})

test('broken references are printed before aging ones', () => {
  // Ordering is the whole point of the split: a fact about the tree outranks an
  // inference from two dates, and the report has to say so by position.
  const root = repo()
  graph(root, [
    specLink('openspec/specs/auth/spec.md', 'lib/gone.ts'),
    specLink('openspec/specs/billing/spec.md', 'lib/here.ts')
  ])
  const text = formatDrift(
    analyzeDrift(root, {
      exists: path => path !== 'lib/gone.ts',
      lastCommit: times({
        'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
        'openspec/specs/billing/spec.md': '2026-01-01T00:00:00Z',
        'lib/here.ts': '2026-06-01T00:00:00Z'
      })
    })
  )
  assert.ok(
    text.indexOf('BROKEN REFERENCES') < text.indexOf('AGING SPECS'),
    'evidence must be reported above inference'
  )
  rmSync(root, { recursive: true, force: true })
})

test('the report does not claim coverage for a diff with no source files', () => {
  // "All 0 changed source files are covered" is vacuously true and reads as a bug.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')], {
    nodes: [fileNode('lib/auth.ts')]
  })
  const text = formatDrift(
    analyzeDrift(root, { exists: allPresent, lastCommit: () => null, changed: ['README.md'] })
  )
  assert.match(text, /ORPHAN CODE — nothing to check/)
  rmSync(root, { recursive: true, force: true })
})

test('the report always says it does not block', () => {
  // The one sentence that must survive every future edit to this formatter:
  // every neighbouring subcommand blocks, so silence here reads as blocking.
  const root = repo()
  assert.match(formatDrift(analyzeDrift(root)), /Nothing here blocks/)
  rmSync(root, { recursive: true, force: true })
})

test('timestamps carry seconds so a narrow margin does not look identical', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const text = formatDrift(
    analyzeDrift(root, {
      exists: allPresent,
      lastCommit: times({
        'openspec/specs/auth/spec.md': '2026-06-01T12:00:01Z',
        'lib/auth.ts': '2026-06-01T12:00:59Z'
      })
    })
  )
  assert.match(text, /2026-06-01 12:00:01/)
  assert.match(text, /2026-06-01 12:00:59/)
  rmSync(root, { recursive: true, force: true })
})

test('analyzeDrift reports every signal independently', () => {
  const root = repo()
  change(root, 'add-login', '- [x] 1.1 handler\n')
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')], {
    nodes: [fileNode('lib/auth.ts'), fileNode('lib/billing.ts')]
  })
  const report = analyzeDrift(root, {
    exists: allPresent,
    changed: ['lib/billing.ts'],
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.equal(report.unarchived.length, 1, 'signal A')
  assert.deepEqual(report.stale.broken, [], 'signal B evidence tier')
  assert.equal(report.stale.aging.length, 1, 'signal B advisory tier')
  assert.deepEqual(report.orphans.orphans, ['lib/billing.ts'], 'signal C')
  assert.equal(report.hasFindings, true)
  rmSync(root, { recursive: true, force: true })
})

test('hasFindings is true on a broken reference alone', () => {
  // Every signal has to be able to raise it on its own, or a repo whose only
  // problem is a broken reference reads as clean.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const report = analyzeDrift(root, { exists: () => false, lastCommit: () => null })
  assert.equal(report.hasFindings, true)
  rmSync(root, { recursive: true, force: true })
})
