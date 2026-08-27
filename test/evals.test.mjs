// Structural validation of every eval case under evals/.
//
// The eval *run* needs a model, a credential and early-access enablement, so it
// cannot gate an ordinary pull request — least of all one from a fork. This test
// is the part of the suite that gates everything: it runs offline in the same
// `npm test` job as everything else, and it holds the case files to the
// case-suite spec so a malformed case fails loudly here rather than silently at
// harness load time.
//
// It is the eval-suite twin of test/skills.test.mjs, and deliberately shaped
// like it: a minimal frontmatter reader (no YAML dependency — that would be the
// only one in the repo), a discovery walk, and one assertion per requirement.
//
// The requirements it enforces (specs/evals/case-suite):
//   - every case pins schema_version
//   - every case carries a provenance citation
//   - no case directory sits under skills/, agents/, commands/ or workflows/
//   - every grader file declares one of the known grader types
//   - every case tagged `smoke` uses only non-judged (deterministic) graders

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EVALS_DIR = join(ROOT, 'evals')

// The grader types the harness accepts, read from the shipped binary's schema:
//   regex | tool_order | tool_used | file_exists | llm | baseline
// A grader .md whose frontmatter `type:` is none of these fails to load.
const KNOWN_GRADER_TYPES = new Set([
  'regex', 'tool_order', 'tool_used', 'file_exists', 'llm', 'baseline'
])

// Judged graders call a model to reach a verdict, so their failures carry
// run-to-run variance. A `smoke` case is one triage trusts on a single run, so
// it must use only deterministic graders.
const JUDGED_GRADER_TYPES = new Set(['llm', 'baseline'])

// Directories the case suite must not live inside — placing a case under a
// declared plugin component would shadow it and trip the harness's
// component-overlap warning (case-suite spec).
const COMPONENT_DIRS = ['skills', 'agents', 'commands', 'workflows']

// Non-case entries that legitimately appear under evals/.
const NON_CASE_ENTRIES = new Set(['results', 'mocks'])

// Minimal top-level scalar reader for a case.yaml. We only need `schema_version`,
// `provenance`, and `tags` — all top-level — so a full YAML parser is overkill.
function readTopLevel(text, key) {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm')
  const m = re.exec(text)
  return m ? m[1].trim() : null
}

// `tags: [smoke]` or a block list. Returns a lowercased set.
function readTags(text) {
  const inline = /^tags:\s*\[([^\]]*)\]/m.exec(text)
  if (inline) {
    return new Set(
      inline[1]
        .split(',')
        .map(t => t.trim().replace(/['"]/g, '').toLowerCase())
        .filter(Boolean)
    )
  }
  const block = /^tags:\s*\n((?:\s*-\s*.+\n?)+)/m.exec(text)
  if (block) {
    return new Set(
      block[1]
        .split('\n')
        .map(l => /^\s*-\s*(.+)$/.exec(l))
        .filter(Boolean)
        .map(m => m[1].trim().replace(/['"]/g, '').toLowerCase())
    )
  }
  return new Set()
}

// The grader type is the frontmatter `type:` in a graders/*.md file.
function readGraderType(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  const block = m ? m[1] : text
  const t = /^type:\s*(\S+)/m.exec(block)
  return t ? t[1].trim().replace(/['"]/g, '') : null
}

// Discover case directories: any directory under evals/ that holds a case.yaml
// (or a prompt.md), excluding results/ and mocks/.
function discoverCases(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (NON_CASE_ENTRIES.has(entry.name)) continue
    const caseDir = join(dir, entry.name)
    if (existsSync(join(caseDir, 'case.yaml')) || existsSync(join(caseDir, 'prompt.md'))) {
      out.push({ name: entry.name, dir: caseDir })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const cases = discoverCases(EVALS_DIR)

test('the eval suite lives at evals/ and holds cases', () => {
  assert.ok(existsSync(EVALS_DIR), 'evals/ directory is missing')
  assert.ok(cases.length >= 8, `expected at least the 8 seeded cases, found ${cases.length}`)
})

test('no case directory sits under a declared plugin component', () => {
  // evals/ is at the repository root by construction; this proves no case
  // escaped into skills/, agents/, commands/ or workflows/ where it would
  // shadow a component (case-suite spec).
  for (const comp of COMPONENT_DIRS) {
    const compDir = join(ROOT, comp)
    if (!existsSync(compDir)) continue
    const strays = discoverCases(compDir)
    assert.deepEqual(
      strays.map(c => `${comp}/${c.name}`),
      [],
      `eval cases must not live under ${comp}/`
    )
  }
})

test('.claude-plugin/plugin.json declares no experimental.evals key', () => {
  // evals/ is the harness default for a plugin whose root is the repo root, so
  // no manifest declaration is needed — and declaring one puts the change on an
  // undocumented, changeable manifest surface (case-suite spec, design D2).
  const manifestPath = join(ROOT, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.ok(
    !('experimental' in manifest),
    'plugin.json must not declare an experimental key for evals'
  )
})

for (const kase of cases) {
  const caseYaml = join(kase.dir, 'case.yaml')

  test(`${kase.name}: is a case.yaml that pins schema_version`, () => {
    // schema_version is a case.yaml field; the harness rejects it as an unknown
    // key in prompt.md frontmatter. Pinning it is required (case-suite spec), so
    // every case takes the case.yaml form.
    assert.ok(existsSync(caseYaml), `${kase.name}: must use case.yaml to pin schema_version`)
    const text = readFileSync(caseYaml, 'utf8')
    const version = readTopLevel(text, 'schema_version')
    assert.ok(version, `${kase.name}: case.yaml does not pin schema_version`)
  })

  test(`${kase.name}: carries a provenance citation`, () => {
    const text = readFileSync(caseYaml, 'utf8')
    const provenance = readTopLevel(text, 'provenance')
    assert.ok(
      provenance && provenance.length > 0,
      `${kase.name}: case.yaml carries no provenance citation`
    )
  })

  test(`${kase.name}: every grader declares a known type`, () => {
    const gradersDir = join(kase.dir, 'graders')
    assert.ok(existsSync(gradersDir), `${kase.name}: has no graders/ directory`)
    const graderFiles = readdirSync(gradersDir).filter(f => f.endsWith('.md'))
    assert.ok(graderFiles.length >= 1, `${kase.name}: has no grader files`)
    for (const file of graderFiles) {
      const type = readGraderType(readFileSync(join(gradersDir, file), 'utf8'))
      assert.ok(
        type && KNOWN_GRADER_TYPES.has(type),
        `${kase.name}/graders/${file}: type "${type}" is not one of ${[...KNOWN_GRADER_TYPES].join(', ')}`
      )
    }
  })

  test(`${kase.name}: if tagged smoke, uses only deterministic graders`, () => {
    const text = readFileSync(caseYaml, 'utf8')
    if (!readTags(text).has('smoke')) return
    const gradersDir = join(kase.dir, 'graders')
    const graderFiles = readdirSync(gradersDir).filter(f => f.endsWith('.md'))
    const judged = []
    for (const file of graderFiles) {
      const type = readGraderType(readFileSync(join(gradersDir, file), 'utf8'))
      if (JUDGED_GRADER_TYPES.has(type)) judged.push(file)
    }
    assert.deepEqual(
      judged,
      [],
      `${kase.name}: a smoke case must use only deterministic graders, but ${judged.join(', ')} is judged`
    )
  })
}
