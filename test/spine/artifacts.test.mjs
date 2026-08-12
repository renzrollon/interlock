import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isCoverableSource,
  listChanges,
  resolveChange,
  inspectChange,
  parseTasks
} from '../../lib/artifacts.mjs'

let root

before(() => {
  root = mkdtempSync(join(tmpdir(), 'specflow-artifacts-'))
  const change = join(root, 'openspec', 'changes', 'add-auth')
  mkdirSync(join(change, 'specs', 'auth'), { recursive: true })
  writeFileSync(join(change, 'proposal.md'), '# Proposal\n')
  writeFileSync(join(change, 'design.md'), '# Design\n')
  writeFileSync(join(change, 'tasks.md'), '# Tasks\n\n- [x] 1.1 scaffold\n- [ ] 1.2 wire\n')
  writeFileSync(join(change, 'specs', 'auth', 'spec.md'), '# Auth\n')

  const partial = join(root, 'openspec', 'changes', 'half-done')
  mkdirSync(partial, { recursive: true })
  writeFileSync(join(partial, 'proposal.md'), '# Proposal\n')

  // archive/ must never be treated as an active change
  mkdirSync(join(root, 'openspec', 'changes', 'archive', 'old'), { recursive: true })
})

after(() => rmSync(root, { recursive: true, force: true }))

// --- change discovery -----------------------------------------------------

test('lists active changes and excludes archive/', () => {
  assert.deepEqual(listChanges(root), ['add-auth', 'half-done'])
})

test('listChanges is empty rather than throwing when openspec/ is absent', () => {
  assert.deepEqual(listChanges(join(root, 'nope')), [])
})

test('resolveChange reports ambiguity instead of guessing', () => {
  const r = resolveChange(root)
  assert.ok(r.error)
  assert.deepEqual(r.candidates, ['add-auth', 'half-done'])
})

test('resolveChange accepts an explicit name and rejects an unknown one', () => {
  assert.deepEqual(resolveChange(root, 'add-auth'), { name: 'add-auth' })
  const bad = resolveChange(root, 'ghost')
  assert.match(bad.error, /not found/)
})

test('a lone change resolves without being named', () => {
  const solo = mkdtempSync(join(tmpdir(), 'specflow-solo-'))
  mkdirSync(join(solo, 'openspec', 'changes', 'only-one'), { recursive: true })
  assert.deepEqual(resolveChange(solo), { name: 'only-one' })
  rmSync(solo, { recursive: true, force: true })
})

// --- inspection -----------------------------------------------------------

test('a complete change is ready, with task progress counted', () => {
  const r = inspectChange(root, 'add-auth')
  assert.equal(r.ready, true)
  assert.deepEqual(r.missing, [])
  assert.equal(r.tasks.total, 2)
  assert.equal(r.tasks.done, 1)
  assert.equal(r.tasks.remaining, 1)
  assert.deepEqual(r.specFiles, ['auth/spec.md'])
})

test('an incomplete change is not ready and names what is missing', () => {
  const r = inspectChange(root, 'half-done')
  assert.equal(r.ready, false)
  assert.deepEqual(r.missing, ['design.md', 'tasks.md'])
  assert.ok(r.problems.some(p => p.includes('design.md')))
})

test('a missing change reports exists:false rather than throwing', () => {
  const r = inspectChange(root, 'ghost')
  assert.equal(r.exists, false)
  assert.equal(r.ready, false)
})

// --- task parsing ---------------------------------------------------------

test('parses checked and unchecked task lines with line numbers', () => {
  const tasks = parseTasks('# Tasks\n\n- [ ] 1.1 alpha\n- [x] 1.2 beta\n* [X] 1.3 gamma\n')
  assert.equal(tasks.length, 3)
  assert.deepEqual(tasks.map(t => t.done), [false, true, true])
  assert.equal(tasks[0].text, '1.1 alpha')
  assert.equal(tasks[0].line, 3)
})

test('prose and headings are not mistaken for tasks', () => {
  assert.equal(parseTasks('# Tasks\n\nSome prose.\n\n## Section\n').length, 0)
  assert.equal(parseTasks('').length, 0)
  assert.equal(parseTasks(null).length, 0)
})

test('a tasks.md with no checkboxes is flagged as a problem', () => {
  const empty = mkdtempSync(join(tmpdir(), 'specflow-empty-'))
  const c = join(empty, 'openspec', 'changes', 'x')
  mkdirSync(c, { recursive: true })
  for (const f of ['proposal.md', 'design.md']) writeFileSync(join(c, f), '# x\n')
  writeFileSync(join(c, 'tasks.md'), '# Tasks\n\nTBD\n')
  const r = inspectChange(empty, 'x')
  assert.equal(r.ready, false)
  assert.ok(r.problems.some(p => p.includes('no checkbox')))
  rmSync(empty, { recursive: true, force: true })
})

// --- coverage filtering ---------------------------------------------------

test('real source files are coverable', () => {
  for (const p of ['src/a.ts', 'lib/b.tsx', 'pkg/c.go', 'app/d.py', 'x/e.rs', 'f.vue']) {
    assert.equal(isCoverableSource(p), true, p)
  }
})

test('tests, config, docs, dotfiles and generated output are not coverable', () => {
  for (const p of [
    'src/a.test.ts',
    'src/a.spec.tsx',
    '__tests__/a.ts',
    'e2e/a.ts',
    'tests/a.py',
    'node_modules/x/a.js',
    'dist/a.js',
    'coverage/a.js',
    'vendor/a.go',
    '.github/a.ts',
    'jest.config.js',
    'types/a.d.ts',
    'README.md',
    'package.json',
    'script.sh'
  ]) {
    assert.equal(isCoverableSource(p), false, p)
  }
})

test('degenerate paths are not coverable', () => {
  for (const p of ['', null, undefined, 42, 'noext']) {
    assert.equal(isCoverableSource(p), false, String(p))
  }
})
