import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The CHANGELOG's semver rule (spec: distribution/upgrade-notes; design D3, D33).
//
// A breaking entry makes a release at least a minor, and it carries upgrade
// notes. Judged from 1.8.0 on: the history before it is left as written, because
// 1.6.1 carries a breaking bullet in a patch and rewriting a release's notes
// after the fact would be the larger fault.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIRST_JUDGED = [1, 8, 0]

/** `[major, minor, patch]` from a heading in either style, or null. */
function headingVersion(heading) {
  const m = /^\[?(\d+)\.(\d+)\.(\d+)\]?/.exec(heading.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Numeric, never string, comparison: 1.10.0 is after 1.9.0. */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * Split a changelog on its `## ` headings. A section is `{ heading, version,
 * unreleased, lines }`; a heading that is neither `[Unreleased]` nor a version
 * is not a release section and is dropped.
 */
export function parseChangelog(text) {
  const sections = []
  let current = null
  for (const line of text.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(line)
    if (h) {
      const heading = h[1]
      const unreleased = /^\[?unreleased\]?/i.test(heading)
      const version = unreleased ? null : headingVersion(heading)
      current = unreleased || version ? { heading, version, unreleased, lines: [] } : null
      if (current) sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  return sections
}

/** A breaking marker in a bullet or a quoted line, never in a heading. */
function hasBreaking(section) {
  return section.lines.some(line => /^\s*(?:[-*+]|>)/.test(line) && /\bbreaking\b/i.test(line))
}

function hasUpgrading(section) {
  return section.lines.some(line => /^###\s+Upgrading\s*$/i.test(line))
}

/** Every problem the rule finds in `text`, one string each. */
export function changelogProblems(text) {
  const problems = []
  for (const section of parseChangelog(text)) {
    if (!section.unreleased && compareVersions(section.version, FIRST_JUDGED) < 0) continue
    if (!hasBreaking(section)) continue
    const name = section.unreleased ? 'the unreleased section' : section.version.join('.')
    if (!section.unreleased && section.version[2] > 0) {
      problems.push(`${name} carries a breaking entry in a patch release: a breaking change is at least a minor`)
    }
    if (!hasUpgrading(section)) {
      problems.push(`${name} carries a breaking entry and has no "### Upgrading" subsection`)
    }
  }
  return problems
}

test('the CHANGELOG holds breaking entries to the semver rule', () => {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  assert.deepEqual(changelogProblems(text), [])
})

test('the rule is not vacuous: the unreleased section is parsed and carries an Upgrading subsection', () => {
  const sections = parseChangelog(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'))
  const unreleased = sections.find(s => s.unreleased)
  assert.ok(unreleased, 'the CHANGELOG has an [Unreleased] section')
  assert.ok(hasBreaking(unreleased), 'the unreleased section names its breaking entries')
  assert.ok(hasUpgrading(unreleased), 'and carries the Upgrading subsection the rule asks for')
  assert.ok(sections.some(s => s.version && compareVersions(s.version, FIRST_JUDGED) < 0), 'released sections are parsed in both heading styles')
})

test('a breaking bullet in a patch release fails, naming the version', () => {
  const text = [
    '## [1.8.1] - 2026-11-01',
    '',
    '### Changed',
    '',
    '- **BREAKING: a flag is gone.**',
    '',
    '### Upgrading',
    '',
    '- Stop passing it.',
    ''
  ].join('\n')
  const problems = changelogProblems(text)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /1\.8\.1/)
  assert.match(problems[0], /patch/)
})

test('a breaking bullet with no Upgrading subsection fails, in a release and in the unreleased section', () => {
  const released = changelogProblems('## [1.9.0] - 2026-11-02\n\n### Changed\n\n- Breaking: a flag is gone.\n')
  assert.equal(released.length, 1)
  assert.match(released[0], /1\.9\.0/)
  assert.match(released[0], /Upgrading/)

  const unreleased = changelogProblems('## [Unreleased]\n\n### Changed\n\n- **BREAKING: a flag is gone.**\n')
  assert.equal(unreleased.length, 1)
  assert.match(unreleased[0], /unreleased/i)
})

test('the unreleased section is held to the Upgrading rule only', () => {
  // Its version is not known until the bump, so it cannot be called a patch.
  const text = '## [Unreleased]\n\n- **BREAKING: x.**\n\n### Upgrading\n\n- Do y.\n'
  assert.deepEqual(changelogProblems(text), [])
})

test('a minor with a breaking entry and upgrade notes passes', () => {
  const text = '## [1.8.0] - 2026-11-01\n\n- **BREAKING: x.**\n\n### Upgrading\n\n- Do y.\n'
  assert.deepEqual(changelogProblems(text), [])
})

test('sections before 1.8.0 are not judged, in either heading style', () => {
  const text = [
    '## [1.7.1] - 2026-10-22',
    '',
    '- **BREAKING: old.**',
    '',
    '## 1.6.1 — 2026-10-14',
    '',
    '### Changed',
    '',
    '- **BREAKING: an inter-wave check never halts the run.**',
    ''
  ].join('\n')
  assert.deepEqual(changelogProblems(text), [])
})

test('versions are compared numerically, not as strings', () => {
  // As strings "1.10.0" sorts before "1.8.0" and would escape the rule.
  const text = '## [1.10.0] - 2027-01-01\n\n- **BREAKING: x.**\n'
  const problems = changelogProblems(text)
  assert.equal(problems.length, 1)
  assert.match(problems[0], /1\.10\.0/)
  assert.ok(compareVersions([1, 10, 0], [1, 9, 0]) > 0)
})

test('a breaking word in a heading or in prose is not a breaking entry', () => {
  const text = [
    '## [1.8.1] - 2026-11-01',
    '',
    '### Not breaking anything',
    '',
    'This paragraph mentions a breaking change in passing.',
    '',
    '- A bullet with no marker.',
    ''
  ].join('\n')
  assert.deepEqual(changelogProblems(text), [])
})

test('a breaking marker in a quoted line counts', () => {
  const problems = changelogProblems('## [1.8.2] - 2026-11-03\n\n> **Breaking:** x.\n')
  assert.equal(problems.length, 2, 'a patch with no Upgrading subsection fails both rules')
})
