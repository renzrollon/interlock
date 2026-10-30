// Residue test for the rename of the pull request skill to `settle`
// (openspec change rename-the-review-loop-to-settle, design D10).
//
// A rename that only a reviewer's eye enforces comes back at the first
// copy-paste from an old note. This lists the tracked shipped surfaces,
// strips a closed allow-list of tokens GitLab owns or history fixed, and
// fails with one `path:line: text` per remaining hit of the retired name.
//
// The patterns are built from fragments so this file never matches itself,
// and the scan leaves this file out besides. A new exception means editing
// ALLOWED below, which a reviewer sees.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'test/retired-names.test.mjs'

// The retired name, in pieces.
const SHORT = ['m', 'r'].join('')
const LONG_A = ['merge', 'requests?'].join('[ -]')

// Case-insensitive: the word itself.
const WORD = new RegExp(`\\b${SHORT}s?\\b`, 'i')
// Case-sensitive: an identifier segment. With case folded, fromReceipt,
// memRoot, resumeFromRunId and armResult would match, and none is the name.
const CAMEL_HEAD = new RegExp(`\\b${SHORT}(?=[A-Z])`)
const CAMEL_TAIL = new RegExp(`[a-z]${SHORT[0].toUpperCase()}${SHORT[1]}(?![a-z])`)
const SCREAMING = new RegExp(`\\b${SHORT.toUpperCase()}_`)
const PHRASE = new RegExp(LONG_A, 'i')
// Case-sensitive: the long form as one identifier, mergeRequest or MergeRequest.
const CAMEL_LONG = new RegExp(['[Mm]erge', '(?=Request)'].join(''))
const PATTERNS = [WORD, CAMEL_HEAD, CAMEL_TAIL, SCREAMING, PHRASE, CAMEL_LONG]

// The closed allow-list (D4, D6). Order matters: the change and capability
// ids contain the phrase and go first. Nothing else is stripped.
const ALLOWED = [
  // History (D6): change ids, and a living capability id (D7).
  new RegExp(['close-the', 'merge-request', 'loop'].join('-'), 'g'),
  new RegExp(['label-the', 'merge-request', 'with-confidence'].join('-'), 'g'),
  new RegExp(['merge-request', 'delivery'].join('-'), 'g'),
  // GitLab-owned (D4).
  new RegExp(`glab ${SHORT} [a-z][a-z-]*`, 'g'),
  new RegExp(['--merge', 'request'].join('-'), 'g'),
  new RegExp(['CI', 'MERGE', 'REQUEST', ''].join('_'), 'g'),
  new RegExp(['merge', 'requests'].join('_'), 'g'),
  new RegExp(['refs/merge', 'requests/'].join('-'), 'g'),
  // A data: URI can hold the two letters between word boundaries in base64.
  /data:[^\s"'`)>]+/g,
]

export function strip(line) {
  // A regex literal spells the GitLab ref with escaped slashes: the same token.
  let out = line.replaceAll('\\/', '/')
  for (const re of ALLOWED) out = out.replace(re, ' ')
  return out
}

export function matches(line) {
  const s = strip(line)
  return PATTERNS.some(re => re.test(s))
}

// Help text and comments wrap at a column, so the phrase can end one line and
// finish the next. Join the two with the second line's comment leader and
// indent dropped, and report the first line, unless either line already
// matches on its own (that one reports itself).
const LEADER = /^\s*(?:\/\/+|\/\*+|\*+|#+|>+)?\s*/
export function wrapped(a, b) {
  if (matches(a) || matches(b)) return false
  const left = strip(a).trimEnd()
  const right = strip(b).replace(LEADER, '')
  return PHRASE.test(left.endsWith('-') ? `${left}${right}` : `${left} ${right}`)
}

// The surfaces the ADDED requirement lists. Everything else (docs/notes,
// briefs, openspec, test/fixtures/ship, the release history) is out.
export function inSurface(path) {
  if (path === SELF) return false
  if (path.startsWith('test/fixtures/ship/')) return false
  if (path === 'README.md' || path === 'REVIEW.md' || path === 'CHANGELOG.md') return true
  if (/^docs\/\d[^/]*\.md$/.test(path)) return true
  if (/^docs\/assets\/flow-[^/]*\.svg$/.test(path)) return true
  if (path === 'site/DESIGN-PROMPT.md') return true
  if (/^site\/[^/]*\.html$/.test(path)) return true
  return /^(skills|shared|cli|lib|hooks|scripts|workflows|\.claude-plugin|test)\//.test(path)
}

// CHANGELOG.md: only the [Unreleased] section is shipped surface. Inside it,
// the rename note (D11) has to name the retired commands to tell a reader what
// changed, so that one BREAKING bullet and the Upgrading subsection are left
// out. Both are a rename note by construction: a retired name anywhere else in
// [Unreleased] still fails.
export function changelogSlice(text) {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^## \[Unreleased\]/i.test(l))
  if (start === -1) return []
  const out = []
  let inUpgrading = false
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^## /.test(l)) break
    if (/^### /.test(l)) inUpgrading = /^### Upgrading\b/.test(l)
    if (inUpgrading || /^- \*\*BREAKING:/.test(l)) continue
    out.push({ line: i + 1, text: l })
  }
  return out
}

// One `path:line: text` per hit. Binary content (a NUL byte) is skipped.
export function scan(path, text) {
  if (text.includes('\0')) return []
  const rows = path === 'CHANGELOG.md'
    ? changelogSlice(text)
    : text.split('\n').map((t, i) => ({ line: i + 1, text: t }))
  return rows
    .filter((r, i) => {
      const next = rows[i + 1]
      return matches(r.text) || (next !== undefined && next.line === r.line + 1 && wrapped(r.text, next.text))
    })
    .map(r => `${path}:${r.line}: ${r.text.trim()}`)
}

function trackedSurface() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split('\0').filter(p => p && inSurface(p) && existsSync(join(ROOT, p)))
}

test('retired names: no tracked shipped surface carries the retired pull request name', () => {
  const files = trackedSurface()
  assert.ok(files.length > 100, `the surface list found only ${files.length} files: is git ls-files working?`)
  const hits = files.flatMap(p => scan(p, readFileSync(join(ROOT, p), 'utf8')))
  assert.deepEqual(hits, [], `retired name in a shipped surface (the allow-list is closed, edit ALLOWED to widen it):\n${hits.join('\n')}`)
})

test('retired names: the surface list covers what the requirement names and leaves history out', () => {
  for (const p of [
    'README.md', 'REVIEW.md', 'CHANGELOG.md', 'docs/07-cli-and-configuration.md', 'docs/assets/flow-dark.svg',
    'skills/settle/SKILL.md', 'shared/CONTEXT-HYGIENE.md', 'site/index.html', 'site/DESIGN-PROMPT.md',
    'cli/interlock', 'lib/settle-cli.mjs', 'hooks/guard-commit.mjs', 'scripts/gen-flow-svg.mjs',
    'workflows/ship.js', '.claude-plugin/plugin.json', 'test/skills.test.mjs',
  ]) assert.equal(inSurface(p), true, p)
  for (const p of [
    SELF, 'test/fixtures/ship/halted-run-6e9d0b02/plan.json', 'docs/notes/compound.md', 'docs/assets/DESIGN-PROMPT.md',
    'briefs/merge-confidence-gate-epic.md', 'openspec/specs/review/merge-request-delivery/spec.md', 'CONTRIBUTING.md',
  ]) assert.equal(inSurface(p), false, p)
})

test('retired names: skills/mr is gone and nothing aliases it', () => {
  assert.equal(existsSync(join(ROOT, 'skills', SHORT)), false, 'the retired skill directory is back')
  assert.equal(existsSync(join(ROOT, 'skills', 'settle', 'SKILL.md')), true)
})

test(`retired names: 'interlock ${SHORT} comment' exits non-zero and writes nothing under .claude/ship/`, () => {
  // A scratch cwd, so a command that did write would leave a trace we can see.
  const cwd = mkdtempSync(join(tmpdir(), 'retired-names-'))
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'cli', 'interlock'), SHORT, 'comment'], { cwd, encoding: 'utf8' })
    assert.notEqual(r.status, 0, 'the retired command must not run')
    assert.match(`${r.stdout}${r.stderr}`, /unknown command/i)
    assert.equal(existsSync(join(cwd, '.claude', 'ship', 'settle')), false)
    assert.equal(existsSync(join(cwd, '.claude', 'ship')), false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  // No assertion on ROOT/.claude/ship/settle: the child ran in the scratch cwd,
  // and the settle loop leaves its own work directory there after every pass.
})

// ---- the matcher itself, in memory ----

test('matcher: a retired command in a doc fails naming the file and the line', () => {
  const doc = ['# CLI', '', `run interlock ${SHORT} comment`, 'fine line'].join('\n')
  assert.deepEqual(scan('docs/07-cli-and-configuration.md', doc), [`docs/07-cli-and-configuration.md:3: run interlock ${SHORT} comment`])
})

test('matcher: every shape of the retired name is caught', () => {
  const Cap = SHORT.toUpperCase()
  const Title = SHORT[0].toUpperCase() + SHORT[1]
  for (const line of [
    `the ${Cap} loop`, `${Cap}s`, `/interlock:${SHORT}`, `${SHORT}-summary.md`, `.claude/ship/${SHORT}/`,
    `${SHORT}Remediate`, `fix${Title}`, `${Cap}_FILE`, 'a merge request', 'the merge-request step', 'Merge Requests',
    `const ${['merge', 'Request'].join('')} = 1`, `${['Merge', 'Request'].join('')}Note`,
  ]) assert.equal(matches(line), true, line)
})

test('matcher: a phrase a line wrap split is caught on its first line', () => {
  const help = ['  2  the pipeline is not the merge', "     request's head pipeline", 'ok'].join('\n')
  assert.deepEqual(scan('cli/interlock', help), ['cli/interlock:1: 2  the pipeline is not the merge'])
  const comment = ['  // what it pipes to the merge', '  // request', '  # the merge-', '  # request step'].join('\n')
  assert.deepEqual(scan('scripts/x.mjs', comment), ['scripts/x.mjs:1: // what it pipes to the merge', 'scripts/x.mjs:3: # the merge-'])
  // Each word on its own line is not the phrase, and an allowed id stays allowed across a wrap.
  assert.deepEqual(scan('lib/x.mjs', ['merge', 'conflicts', 'request a review'].join('\n')), [])
  assert.deepEqual(scan('lib/x.mjs', ['see close-the-merge-request-loop', 'request body'].join('\n')), [])
})

test('matcher: identifiers that only contain the two letters pass', () => {
  for (const line of [
    'fromReceipt', 'memRoot', 'resumeFromRunId', 'armResult', 'const format = 1', 'form', 'primary', 'normal mrkdwn-free text',
  ]) assert.equal(matches(line), false, line)
})

test('matcher: GitLab-owned tokens and historical ids pass', () => {
  for (const line of [
    `glab ${SHORT} view <iid> --output json | interlock pipeline --gitlab-pr - --out p.json`,
    `glab ${SHORT} list`,
    'see design D3 of close-the-merge-request-loop',
    'label-the-merge-request-with-confidence',
    'review/merge-request-delivery',
    ['--merge', 'request'].join('-'),
    `${['CI', 'MERGE', 'REQUEST'].join('_')}_IID`,
    ['merge', 'requests'].join('_'),
    `${['refs/merge', 'requests/'].join('-')}12/head`,
    String.raw`/^refs\/${['merge', 'requests'].join('-')}\//`,
  ]) assert.equal(matches(line), false, line)
})

test('matcher: the allow-list is closed, a retired name beside an allowed token still fails', () => {
  assert.equal(matches(`glab ${SHORT} view then run interlock ${SHORT} comment`), true)
  assert.equal(matches('close-the-merge-request-loop and a merge request'), true)
  assert.equal(matches(`glab ${SHORT}`), true, 'glab with no verb is not a GitLab command')
})

test('matcher: a data: URI is stripped, base64 around it is not', () => {
  const uri = `data:image/png;base64,iVBOR/${SHORT}/${SHORT.toUpperCase()}+x=`
  assert.equal(matches(`<img src="${uri}">`), false)
  assert.equal(matches(`<img src="${uri}"> ${SHORT}`), true)
})

test('matcher: only the [Unreleased] slice of CHANGELOG.md is scanned, minus the rename note', () => {
  const log = [
    '# Changelog', '',
    '## [Unreleased]', '',
    '### Changed', '',
    `- **BREAKING: renamed.** \`/interlock:${SHORT}\` is now \`/interlock:settle\`.`,
    `- A stray ${SHORT} mention`,
    '',
    '### Upgrading', '',
    `- Run \`interlock settle\` where you ran \`interlock ${SHORT}\`.`,
    '',
    '## [1.9.0] - 2026-10-25', '',
    `- \`interlock ${SHORT}\` family`,
  ].join('\n')
  assert.deepEqual(scan('CHANGELOG.md', log), [`CHANGELOG.md:8: - A stray ${SHORT} mention`])
  assert.deepEqual(scan('CHANGELOG.md', '# Changelog\n\n## [1.9.0]\n\n- merge request'), [])
})

test('matcher: a file with a NUL byte is skipped', () => {
  assert.deepEqual(scan('lib/x.mjs', `a ${SHORT}\0b`), [])
})
