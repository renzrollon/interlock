// The tarball, and the three manifests that must agree about the version.
//
// `npm pack` succeeding proves nothing: a `files` whitelist that omits a `lib/`
// file still packs cleanly, installs cleanly, and fails at the first import the
// user makes. So the closure is walked here from every declared `bin` entry,
// and a reached file no whitelist entry covers is named. Same shape as the
// cap-authority test: a shipped surface must have a reader that would notice
// its absence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const PKG_PATH = join(ROOT, 'package.json')
const PLUGIN_PATH = join(ROOT, '.claude-plugin', 'plugin.json')
const MARKETPLACE_PATH = join(ROOT, '.claude-plugin', 'marketplace.json')

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const pkg = readJson(PKG_PATH)

/** Repo-relative, POSIX-separated — the form a `files` entry is written in. */
const rel = abs => relative(ROOT, abs).split(sep).join('/')

/**
 * Every relative specifier a module names: `import ... from`, `export ... from`,
 * a bare side-effect `import '...'` (which is how `bin/interlock-graph` reaches
 * the whole graph CLI — a walk that only understood `from` would find nothing
 * there and pass on an empty closure), and `import('...')`.
 */
function relativeSpecifiers(text) {
  const found = new Set()
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (m[1].startsWith('.')) found.add(m[1])
    }
  }
  return [...found]
}

/** Transitive closure of relative imports, starting from `entry`. */
function importClosure(entry) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (err) {
      assert.fail(`${rel(file)} is imported but cannot be read: ${err.message}`)
    }
    for (const spec of relativeSpecifiers(text)) {
      const target = resolve(dirname(file), spec)
      assert.ok(
        statSync(target, { throwIfNoEntry: false })?.isFile(),
        `${rel(file)} imports '${spec}', which does not resolve to a file`
      )
      queue.push(target)
    }
  }
  return seen
}

/** npm's `files` semantics: a directory entry ships the directory, recursively. */
function coveredBy(files, path) {
  return files.some(entry => {
    const e = entry.replace(/^\.\//, '').replace(/\/$/, '')
    return path === e || path.startsWith(`${e}/`)
  })
}

test('every declared bin entry is an executable node script', () => {
  const bin = pkg.bin
  assert.ok(bin && Object.keys(bin).length > 0, 'package.json declares no bin entries')

  for (const [name, declared] of Object.entries(bin)) {
    const abs = join(ROOT, declared)
    const stat = statSync(abs, { throwIfNoEntry: false })
    assert.ok(stat, `bin.${name} points at ${declared}, which does not exist`)
    assert.ok(stat.isFile(), `bin.${name} points at ${declared}, which is not a file`)
    assert.ok(
      readFileSync(abs, 'utf8').startsWith('#!/usr/bin/env node'),
      `bin.${name} (${declared}) must start with #!/usr/bin/env node`
    )
    assert.ok(
      (stat.mode & 0o111) !== 0,
      `bin.${name} (${declared}) is not executable — chmod +x it, or a global install lands an unrunnable command`
    )
  }
})

test('the files whitelist is closed over every binary\'s import graph', () => {
  const files = pkg.files
  assert.ok(Array.isArray(files) && files.length > 0, 'package.json declares no files whitelist')

  const uncovered = []
  for (const [name, declared] of Object.entries(pkg.bin)) {
    for (const abs of importClosure(join(ROOT, declared))) {
      const path = rel(abs)
      if (!coveredBy(files, path)) uncovered.push(`${path} (reachable from bin.${name})`)
    }
  }

  assert.deepEqual(
    uncovered,
    [],
    `these files ship in no "files" entry and would be missing from the tarball:\n  ${uncovered.join('\n  ')}`
  )
})

/**
 * The hooks modules `hooks/hooks.json` names under `modules`, resolved against
 * that file (design D11). A bare specifier such as `claude-code` is the
 * engine's, so `relativeSpecifiers` never walks it.
 */
function hooksModuleRoots(root) {
  const path = join(root, 'hooks', 'hooks.json')
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return (Array.isArray(parsed.modules) ? parsed.modules : []).map(m => resolve(dirname(path), m))
}

/** Every file reachable from `entries` that `files` does not cover, named with its root. */
function uncoveredFrom(root, files, entries, label) {
  const out = []
  for (const entry of entries) {
    for (const abs of importClosure(entry)) {
      const path = relative(root, abs).split(sep).join('/')
      if (!coveredBy(files, path)) out.push(`${path} (reachable from ${label})`)
    }
  }
  return out
}

test('the files whitelist is closed over the hooks module\'s import graph', () => {
  const entries = hooksModuleRoots(ROOT)
  assert.equal(entries.length, 1, 'hooks/hooks.json names no hooks module')
  const uncovered = uncoveredFrom(ROOT, pkg.files, entries, 'the hooks module')
  assert.deepEqual(uncovered, [], `these files ship in no "files" entry:\n  ${uncovered.join('\n  ')}`)
})

test('a file the hooks module imports outside the whitelist is named; claude-code is not walked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-hooks-closure-'))
  try {
    mkdirSync(join(dir, 'hooks'))
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {}, modules: ['./mod.mjs'] }))
    writeFileSync(
      join(dir, 'hooks', 'mod.mjs'),
      "import { h } from 'claude-code'\nimport { pure } from '../lib/pure-thing.mjs'\nexport function register() { return [h, pure] }\n"
    )
    writeFileSync(join(dir, 'lib', 'pure-thing.mjs'), 'export const pure = 1\n')
    assert.deepEqual(uncoveredFrom(dir, ['hooks'], hooksModuleRoots(dir), 'the hooks module'), [
      'lib/pure-thing.mjs (reachable from the hooks module)'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the files whitelist never ships the repository-only directories', () => {
  const never = ['test', 'openspec', 'docs', 'evals', '.claude']
  for (const entry of pkg.files) {
    const e = entry.replace(/^\.\//, '').replace(/\/$/, '')
    assert.ok(
      !never.includes(e),
      `"files" includes ${entry}, which must never ship — correct the whitelist rather than the check`
    )
  }
})

test('package.json, plugin.json and marketplace.json carry one version', () => {
  const versions = [
    ['package.json', pkg.version],
    ['.claude-plugin/plugin.json', readJson(PLUGIN_PATH).version],
    ['.claude-plugin/marketplace.json (plugins[0])', readJson(MARKETPLACE_PATH).plugins?.[0]?.version]
  ]

  for (const [file, version] of versions) {
    assert.match(
      String(version),
      /^\d+\.\d+\.\d+$/,
      `${file} carries version ${JSON.stringify(version)}; the accepted form is MAJOR.MINOR.PATCH only — ` +
        'pre-release versions are not published by the release workflow, which triggers on a v<version> tag'
    )
  }

  const distinct = new Set(versions.map(([, v]) => v))
  assert.equal(
    distinct.size,
    1,
    `the version-bearing manifests disagree:\n  ${versions.map(([f, v]) => `${f}: ${v}`).join('\n  ')}`
  )
})

// A `String.replace` whose replacement contained `$`` spliced this file's
// preamble in twice, mid-line. A line-anchored check of the opening heading
// still passes on that file, because the copies do not start a line; the
// substring count is what fails. Unique `## ` headings catch the `$&` and `$'`
// variants of the same mistake.
test('CHANGELOG.md names itself once and its section headings do not repeat', () => {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  assert.equal(text.startsWith('# Changelog\n'), true, 'CHANGELOG.md must open with "# Changelog"')
  const nameCount = text.split('# Changelog').length - 1
  assert.equal(
    nameCount,
    1,
    `"# Changelog" occurs ${nameCount} times; a replacement splice lands it mid-line, where a line-anchored check would still pass`
  )
  const headings = [...text.matchAll(/^## .+$/gm)].map(match => match[0])
  const seen = new Set()
  const repeated = []
  for (const heading of headings) {
    if (seen.has(heading)) repeated.push(heading)
    else seen.add(heading)
  }
  assert.deepEqual(
    [...new Set(repeated)],
    [],
    `a ## heading repeats:\n  ${[...new Set(repeated)].join('\n  ')}`
  )
})
