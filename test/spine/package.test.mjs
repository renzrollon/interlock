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
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

/**
 * The manifest's type contract, when it names one, as a path `files` must cover
 * (guard-ship-relaunch-in-process; spec: distribution/npm-package). A plugin
 * published without the file its manifest names fails the host's validation at
 * install, and its session state is refused. No `types` key: nothing to ship.
 *
 * @returns {string[]} the named path when it is uncovered, else nothing
 */
function uncoveredContract(manifest, files) {
  if (typeof manifest.types !== 'string') return []
  const path = manifest.types.replace(/^\.\//, '')
  return coveredBy(files, path) ? [] : [`${path} (named by the manifest's "types")`]
}

test('the manifest\'s type contract exists and ships in the tarball', () => {
  const manifest = readJson(PLUGIN_PATH)
  if (typeof manifest.types === 'string') {
    assert.ok(
      statSync(join(ROOT, manifest.types), { throwIfNoEntry: false })?.isFile(),
      `.claude-plugin/plugin.json names types ${manifest.types}, which does not exist`
    )
  }
  const uncovered = uncoveredContract(manifest, pkg.files)
  assert.deepEqual(uncovered, [], `the type contract ships in no "files" entry:\n  ${uncovered.join('\n  ')}`)
})

test('a contract the whitelist does not cover is named; a manifest without types asserts nothing', () => {
  const manifest = { name: 'p', types: './types/index.d.ts' }
  assert.deepEqual(uncoveredContract(manifest, ['types', 'lib']), [])
  assert.deepEqual(uncoveredContract(manifest, ['types/']), [])
  assert.deepEqual(uncoveredContract(manifest, ['lib', 'hooks']), ['types/index.d.ts (named by the manifest\'s "types")'])
  assert.deepEqual(uncoveredContract({ name: 'p' }, []), [], 'no types key, no contract to ship')
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

// --- the npm tarball is the plugin bundle ----------------------------------
//
// Plugin installs do not read this checkout. The marketplace entry names the
// `release` branch, and .github/workflows/plugin-bundle.yml fills that branch
// with the published tarball, unpacked unchanged; Anthropic's directory tracks
// the same branch. So `files` is no longer only what a global install needs: it
// is the whole plugin every marketplace and directory user receives. A path the
// plugin reaches that no entry covers loads under `claude --plugin-dir .` and
// is missing for every user.

const BUNDLE_WORKFLOW = '.github/workflows/plugin-bundle.yml'
const RELEASE_WORKFLOW = '.github/workflows/release.yml'
const BUNDLE_BRANCH = 'release'
const PLUGIN_ROOT_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g

/** `owner/repo` from package.json's `repository`, in its string or object form. */
function githubRepo(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(String(url ?? ''))
  return m ? m[1] : null
}

/** Every file under `dir`, recursively; a missing directory has none. */
function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap(e => {
    const abs = join(dir, e.name)
    if (e.isDirectory()) return walk(abs)
    return e.isFile() ? [abs] : []
  })
}

/**
 * Every repo-relative path the installed plugin reaches at runtime: the
 * component locations the host scans, the manifest's own `workflows` and
 * `types`, each `${CLAUDE_PLUGIN_ROOT}/…` that the manifest's hook commands, a
 * skill, an agent, a shared contract, a workflow or a briefing names, and the
 * import closure of every script among those.
 */
function pluginRuntimePaths(root) {
  const manifestPath = join(root, '.claude-plugin', 'plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const strip = p => p.replace(/^\.\//, '').replace(/[./]+$/, '')
  const named = new Set(['.claude-plugin/plugin.json', 'hooks/hooks.json', 'skills', 'agents'])
  for (const key of ['workflows', 'types']) {
    if (typeof manifest[key] === 'string') named.add(strip(manifest[key]))
  }
  const sources = [
    manifestPath,
    ...['skills', 'agents', 'shared', 'workflows', 'hooks', 'lib', 'bin'].flatMap(d => walk(join(root, d)))
  ]
  for (const file of sources) {
    for (const m of readFileSync(file, 'utf8').matchAll(PLUGIN_ROOT_PATH)) {
      const path = strip(m[1])
      if (path) named.add(path)
    }
  }
  const paths = new Set(named)
  for (const path of named) {
    if (/\.(m?js)$/.test(path) && statSync(join(root, path), { throwIfNoEntry: false })?.isFile()) {
      for (const abs of importClosure(join(root, path))) paths.add(relative(root, abs).split(sep).join('/'))
    }
  }
  return [...paths].sort()
}

test('the files whitelist is the whole plugin: every path the plugin reaches ships', () => {
  const uncovered = pluginRuntimePaths(ROOT).filter(path => !coveredBy(pkg.files, path))
  assert.deepEqual(
    uncovered,
    [],
    `the plugin reaches these, and no "files" entry ships them to the release branch plugin users install:\n  ${uncovered.join('\n  ')}`
  )
})

test('every path the plugin names under its root exists', () => {
  const missing = pluginRuntimePaths(ROOT).filter(path => !statSync(join(ROOT, path), { throwIfNoEntry: false }))
  assert.deepEqual(missing, [], `the plugin names these under \${CLAUDE_PLUGIN_ROOT}, and they do not exist:\n  ${missing.join('\n  ')}`)
})

test('a path a skill names under the plugin root, or a hook script imports, outside the whitelist is named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-bundle-paths-'))
  try {
    mkdirSync(join(dir, '.claude-plugin'))
    mkdirSync(join(dir, 'skills', 'x'), { recursive: true })
    mkdirSync(join(dir, 'hooks'))
    mkdirSync(join(dir, 'lib'))
    writeFileSync(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'p',
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.mjs"' }] }] }
      })
    )
    writeFileSync(join(dir, 'hooks', 'start.mjs'), "import { a } from '../lib/a.mjs'\nexport default a\n")
    writeFileSync(join(dir, 'lib', 'a.mjs'), 'export const a = 1\n')
    writeFileSync(join(dir, 'skills', 'x', 'SKILL.md'), 'Read `${CLAUDE_PLUGIN_ROOT}/extras/GUIDE.md`.\n')
    const files = ['.claude-plugin/plugin.json', 'skills', 'agents', 'hooks']
    assert.deepEqual(
      pluginRuntimePaths(dir).filter(path => !coveredBy(files, path)),
      ['extras/GUIDE.md', 'lib/a.mjs']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the plugin bundle carries plugin.json and no marketplace manifest', () => {
  assert.ok(coveredBy(pkg.files, '.claude-plugin/plugin.json'), '"files" does not ship .claude-plugin/plugin.json')
  assert.ok(
    !coveredBy(pkg.files, '.claude-plugin/marketplace.json'),
    '"files" ships .claude-plugin/marketplace.json: the bundle is one plugin, and a marketplace manifest inside it ' +
      'names a source of its own — list .claude-plugin/plugin.json alone'
  )
})

test('the marketplace entry installs the release branch of this repository', () => {
  const source = readJson(MARKETPLACE_PATH).plugins?.[0]?.source
  assert.deepEqual(
    source,
    { source: 'github', repo: githubRepo(pkg.repository), ref: BUNDLE_BRANCH },
    'a relative source ships the whole checkout from the default branch, and a pinned sha freezes plugin users on ' +
      `one release; the entry names the "${BUNDLE_BRANCH}" branch, which holds the published tarball and moves only on a release`
  )
})

test('the bundle workflow mirrors the published tarball onto the branch the marketplace names', () => {
  const text = readFileSync(join(ROOT, BUNDLE_WORKFLOW), 'utf8')
  for (const token of [
    'workflows: [Release]',
    'workflow_dispatch:',
    'contents: write',
    `PACKAGE: '${pkg.name}'`,
    `BRANCH: ${BUNDLE_BRANCH}`,
    'npm pack',
    'claude plugin validate',
    'refs/heads/$BRANCH'
  ]) {
    assert.ok(text.includes(token), `${BUNDLE_WORKFLOW} no longer contains ${JSON.stringify(token)}`)
  }
  assert.match(
    readFileSync(join(ROOT, RELEASE_WORKFLOW), 'utf8'),
    /^name: Release$/m,
    `${BUNDLE_WORKFLOW} follows the workflow named "Release"; renaming ${RELEASE_WORKFLOW} stops the release branch moving`
  )
})

// `.github/workflows/` is gitignored, so both definitions stay tracked only
// because they were force-added. An untracked workflow never runs on the
// remote, and plugin users would silently stop receiving releases. Where
// version-control status cannot be determined, this skips with its reason.
const inCheckout = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' })
const NOT_A_CHECKOUT =
  inCheckout.error || inCheckout.status !== 0
    ? 'not a git checkout (or git unavailable) — tracking status cannot be determined'
    : false

test('the release and bundle workflow definitions are tracked in version control', { skip: NOT_A_CHECKOUT }, () => {
  for (const workflow of [RELEASE_WORKFLOW, BUNDLE_WORKFLOW]) {
    const listed = spawnSync('git', ['ls-files', '--', workflow], { cwd: ROOT, encoding: 'utf8' })
    assert.ok(!listed.error, `git ls-files failed to run: ${listed.error && listed.error.message}`)
    assert.ok(
      listed.stdout.trim().length > 0,
      `${workflow} is not tracked. .gitignore ignores .github/workflows/, so it stays tracked only when ` +
        `force-added — restore it with \`git add -f ${workflow}\`.`
    )
  }
})
