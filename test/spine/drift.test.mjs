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

function graph(root, links) {
  const dir = join(root, '.claude', 'graph')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'graph.json'), JSON.stringify({ nodes: [], links }))
}

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

test('a living spec older than a file it links to is flagged', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.equal(result.skipped, false)
  assert.equal(result.specs.length, 1)
  assert.equal(result.specs[0].spec, 'openspec/specs/auth/spec.md')
  assert.deepEqual(result.specs[0].newerFiles.map(f => f.file), ['lib/auth.ts'])
  rmSync(root, { recursive: true, force: true })
})

test('a living spec newer than its files is not flagged', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-06-01T00:00:00Z',
      'lib/auth.ts': '2026-01-01T00:00:00Z'
    })
  })
  assert.deepEqual(result.specs, [])
  assert.equal(result.indexed, 1)
  rmSync(root, { recursive: true, force: true })
})

test('weight-0.5 symbol edges are ignored', () => {
  // A spec naming `AuthService` links to every AuthService in the repo. Staleness
  // built on that is noise, so only weight-1 path mentions count.
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts', 0.5)])
  const result = detectStaleSpecs(root, {
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.deepEqual(result.specs, [])
  assert.equal(result.indexed, 0)
  rmSync(root, { recursive: true, force: true })
})

test('specs inside an in-flight change are not checked for staleness', () => {
  // openspec/changes/**/specs are deltas under active work. They are expected to
  // move relative to code; only openspec/specs/ is the living record.
  const root = repo()
  graph(root, [specLink('openspec/changes/add-login/specs/auth.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    lastCommit: times({
      'openspec/changes/add-login/specs/auth.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.deepEqual(result.specs, [])
  assert.equal(result.indexed, 0)
  rmSync(root, { recursive: true, force: true })
})

test('a spec git has never seen is skipped rather than guessed at', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const result = detectStaleSpecs(root, {
    lastCommit: times({ 'lib/auth.ts': '2026-06-01T00:00:00Z' })
  })
  assert.deepEqual(result.specs, [])
  rmSync(root, { recursive: true, force: true })
})

test('a missing graph is reported as skipped with a reason, not as clean', () => {
  const root = repo()
  const result = detectStaleSpecs(root)
  assert.equal(result.skipped, true)
  assert.match(result.reason, /no graph/i)
  assert.deepEqual(result.specs, [])
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

test('the report names signal B as inferred wherever it reports one', () => {
  const root = repo()
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const report = analyzeDrift(root, {
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

test('analyzeDrift reports both signals independently', () => {
  const root = repo()
  change(root, 'add-login', '- [x] 1.1 handler\n')
  graph(root, [specLink('openspec/specs/auth/spec.md', 'lib/auth.ts')])
  const report = analyzeDrift(root, {
    lastCommit: times({
      'openspec/specs/auth/spec.md': '2026-01-01T00:00:00Z',
      'lib/auth.ts': '2026-06-01T00:00:00Z'
    })
  })
  assert.equal(report.unarchived.length, 1)
  assert.equal(report.stale.specs.length, 1)
  assert.equal(report.hasFindings, true)
  rmSync(root, { recursive: true, force: true })
})
