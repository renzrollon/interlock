// The reading classes of a changed file (change judge-size-by-what-a-person-reads,
// spec review/merge-confidence: "The size signal SHALL place every changed file
// in one class by its path alone").
//
// `lib/diff-reading.mjs` is reached through a dynamic import inside a helper, so
// this file loads before the module exists and each test fails on its own.
//
//   READING_CLASSES                     ['source', 'test', 'prose'], frozen
//   readingClassOf(path, sourcePaths)   { class, listedUnder }
//   splitByReading(files, sourcePaths)  { source, test, prose, total, binaryFiles, listed }

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as risk from '../../lib/risk.mjs'

const reading = () => import('../../lib/diff-reading.mjs')

const classOf = async (path, sourcePaths = []) => (await reading()).readingClassOf(path, sourcePaths).class

test('size: READING_CLASSES is source, test and prose, frozen', async () => {
  const { READING_CLASSES } = await reading()
  assert.deepEqual([...READING_CLASSES], ['source', 'test', 'prose'])
  assert.ok(Object.isFrozen(READING_CLASSES))
})

test('size: source, test and prose files are told apart by path', async () => {
  assert.equal(await classOf('lib/receipt.mjs'), 'source')
  assert.equal(await classOf('cli/interlock'), 'source')
  assert.equal(await classOf('test/spine/receipt.test.mjs'), 'test')
  assert.equal(await classOf('docs/15-merge-confidence.md'), 'prose')
  assert.equal(await classOf('openspec/changes/a-change/design.md'), 'prose')
  assert.equal(await classOf('openspec/specs/review/merge-confidence/spec.md'), 'prose')
})

test('size: a documentation file under a test directory is prose', async () => {
  assert.equal(await classOf('test/fixtures/review/note.md'), 'prose')
})

test('size: a path no rule recognises is source', async () => {
  for (const path of ['package-lock.json', '.github/workflows/ci.yml', 'site/index.html', 'assets/logo.png']) {
    assert.equal(await classOf(path), 'source', path)
  }
})

test('size: a listed path is source whatever its name, matched on the canonical path form', async () => {
  const { readingClassOf } = await reading()
  const listed = ['./skills', 'test/fixtures/prompts/']
  const skill = readingClassOf('skills/settle/SKILL.md', listed)
  assert.deepEqual(skill, { class: 'source', listedUnder: 'skills' })
  const prompt = readingClassOf('test/fixtures/prompts/a.txt', listed)
  assert.deepEqual(prompt, { class: 'source', listedUnder: 'test/fixtures/prompts' })
  assert.deepEqual(readingClassOf('skillsx/notes.md', listed), { class: 'prose', listedUnder: null })
  assert.deepEqual(readingClassOf('docs/a.md', listed), { class: 'prose', listedUnder: null })
})

test('size: a listed test path is source', async () => {
  const { readingClassOf } = await reading()
  assert.deepEqual(readingClassOf('test/spine/a.test.mjs', ['test/spine']), { class: 'source', listedUnder: 'test/spine' })
  assert.deepEqual(readingClassOf('test/spine/a.test.mjs', []), { class: 'test', listedUnder: null })
})

test('size: an unlisted path decided by a rule carries no listed path', async () => {
  const { readingClassOf } = await reading()
  assert.deepEqual(readingClassOf('lib/a.mjs', ['skills']), { class: 'source', listedUnder: null })
  assert.deepEqual(readingClassOf('lib/a.mjs'), { class: 'source', listedUnder: null })
})

test('size: splitByReading sums each class and the whole, a binary row as one file and no lines', async () => {
  const { splitByReading } = await reading()
  const split = splitByReading([
    { path: 'lib/a.mjs', lines: 3, binary: false },
    { path: 'assets/logo.png', lines: 0, binary: true },
    { path: 'test/a.test.mjs', lines: 40, binary: false },
    { path: 'test/b.test.mjs', lines: 2, binary: false },
    { path: 'docs/a.md', lines: 5, binary: false }
  ])
  assert.deepEqual(split.source, { lines: 3, files: 2 })
  assert.deepEqual(split.test, { lines: 42, files: 2 })
  assert.deepEqual(split.prose, { lines: 5, files: 1 })
  assert.deepEqual(split.total, { lines: 50, files: 5 })
  assert.equal(split.binaryFiles, 1)
  assert.deepEqual(split.listed, [])
})

test('size: listed holds only the listed paths that placed a file which would otherwise be test or prose, in list order', async () => {
  const { splitByReading } = await reading()
  const split = splitByReading(
    [
      { path: 'skills/settle/SKILL.md', lines: 4, binary: false },
      { path: 'shared/x.md', lines: 1, binary: false },
      { path: 'skills/spec/SKILL.md', lines: 3, binary: false },
      { path: 'lib/tools/a.mjs', lines: 9, binary: false },
      { path: 'docs/a.md', lines: 2, binary: false }
    ],
    ['shared', 'agents/', 'lib/tools', './skills']
  )
  // lib/tools/a.mjs is source by every rule, so the listed path placed nothing.
  assert.deepEqual(split.listed, [
    { path: 'shared', files: 1, lines: 1 },
    { path: 'skills', files: 2, lines: 7 }
  ])
  assert.deepEqual(split.source, { lines: 17, files: 4 })
  assert.deepEqual(split.prose, { lines: 2, files: 1 })
  assert.deepEqual(split.total, { lines: 19, files: 5 })
})

test('size: isTestPath is exported beside isDocsPath and agrees with it on a documentation file under a test directory', () => {
  assert.equal(typeof risk.isTestPath, 'function', 'lib/risk.mjs exports no isTestPath')
  assert.equal(risk.isTestPath('test/spine/receipt.test.mjs'), true)
  assert.equal(risk.isTestPath('lib/receipt.mjs'), false)
  assert.equal(risk.isTestPath('TEST\\Spine\\a.mjs'), true, 'normalised as isDocsPath is')
  // Both rules hold for the file; the class order makes it prose.
  assert.equal(risk.isTestPath('test/fixtures/review/note.md'), true)
  assert.equal(risk.isDocsPath('test/fixtures/review/note.md'), true)
})
