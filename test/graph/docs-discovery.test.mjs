import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveDocsDirs, walkMarkdown } from '../../lib/graph/extract/walk.mjs'
import { buildDocsIndex } from '../../lib/graph/retrieve/docs-index.mjs'

// A hardcoded `docs/` default silently indexed zero files on any project that
// keeps prose somewhere else — which is most of them. Verified against a real
// clone of spf13/cobra, where the docs live in doc/ and the substantive
// documentation is the root README.
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'specflow-docs-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

describe('docs root discovery', () => {
  test('prefers docs/ when it exists', () => {
    const root = repo({ 'docs/guide.md': '# Guide\n', 'README.md': '# R\n' })
    const dirs = resolveDocsDirs(root, null)
    assert.equal(dirs[0], 'docs')
    rmSync(root, { recursive: true, force: true })
  })

  test('falls back to doc/ when docs/ is absent', () => {
    const root = repo({ 'doc/guide.md': '# Guide\n' })
    assert.equal(resolveDocsDirs(root, null)[0], 'doc')
    rmSync(root, { recursive: true, force: true })
  })

  test('probes other common docs roots', () => {
    for (const dir of ['documentation', 'site', 'guides', 'wiki']) {
      const root = repo({ [`${dir}/a.md`]: '# A\n' })
      assert.equal(resolveDocsDirs(root, null)[0], dir, `expected to find ${dir}/`)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('always includes root-level docs, which are often the only ones', () => {
    const root = repo({ 'README.md': '# R\n', 'CONTRIBUTING.md': '# C\n' })
    const dirs = resolveDocsDirs(root, null)
    assert.ok(dirs.includes('README.md'))
    assert.ok(dirs.includes('CONTRIBUTING.md'))
    rmSync(root, { recursive: true, force: true })
  })

  test('includes openspec/specs alongside the docs root', () => {
    const root = repo({ 'docs/a.md': '# A\n', 'openspec/specs/auth/spec.md': '# Auth\n' })
    assert.ok(resolveDocsDirs(root, null).includes('openspec/specs'))
    rmSync(root, { recursive: true, force: true })
  })

  test('an explicit --dirs always wins', () => {
    const root = repo({ 'docs/a.md': '# A\n', 'custom/b.md': '# B\n' })
    assert.deepEqual(resolveDocsDirs(root, ['custom']), ['custom'])
    rmSync(root, { recursive: true, force: true })
  })

  test('walkMarkdown accepts individual files as well as directories', () => {
    const root = repo({ 'README.md': '# R\n', 'docs/a.md': '# A\n' })
    const found = walkMarkdown(root, ['docs', 'README.md'])
    assert.equal(found.length, 2)
    assert.ok(found.some(f => f.endsWith('README.md')))
    rmSync(root, { recursive: true, force: true })
  })

  test('a file listed twice is only walked once', () => {
    const root = repo({ 'README.md': '# R\n' })
    assert.equal(walkMarkdown(root, ['README.md', 'README.md']).length, 1)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('docs index on a repo with no docs/ directory', () => {
  test('indexes doc/ and the root README instead of returning nothing', () => {
    // The exact shape that produced files=0 before this fix.
    const root = repo({
      'doc/user_guide.md': '# User Guide\n\nHow to use the thing.\n',
      'README.md': '# Cobra\n\n## Flags\n\nA flag modifies behavior.\n',
      'cmd/root.go': 'package cmd\n'
    })
    const index = buildDocsIndex(root)
    assert.ok(index.totals.files >= 2, `expected >= 2 files, got ${index.totals.files}`)
    assert.ok(index.totals.sections > 0, 'expected indexed sections')
    assert.ok(index.files.some(f => f.path === 'README.md'))
    assert.ok(index.files.some(f => f.path.startsWith('doc/')))
    rmSync(root, { recursive: true, force: true })
  })

  test('never indexes openspec/changes/', () => {
    const root = repo({
      'README.md': '# R\n',
      'openspec/specs/a/spec.md': '# A\n',
      'openspec/changes/wip/proposal.md': '# WIP\n'
    })
    const index = buildDocsIndex(root)
    assert.ok(index.files.every(f => !f.path.startsWith('openspec/changes/')))
    rmSync(root, { recursive: true, force: true })
  })
})
