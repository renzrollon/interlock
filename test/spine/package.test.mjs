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

import { OPENSPEC_INSTALL } from '../../lib/openspec-cli.mjs'
import { OPENSPEC_PIN } from '../../lib/openspec-pin.mjs'

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
 * a bare side-effect `import '...'` (which is how `cli/interlock-graph` reaches
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
  const never = ['test', 'openspec', 'docs', 'evals', '.claude', 'CHANGELOG.md']
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

/** What the directory's size limit leaves alone: images and fonts. */
const IMAGE_OR_FONT = /\.(png|jpe?g|gif|webp|svg|ttf|otf|woff2?)$/i
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

/**
 * Every file `npm pack` would ship from `root`, with its size: the `files`
 * whitelist walked as the closure tests read it, and the three npm always
 * ships. Finder's own `.DS_Store` is npm's to leave out, and is left out here.
 */
function shippedFiles(root, files) {
  const paths = new Set()
  for (const entry of [...files, 'package.json', 'README.md', 'LICENSE']) {
    const e = entry.replace(/^\.\//, '').replace(/\/$/, '')
    const stat = statSync(join(root, e), { throwIfNoEntry: false })
    if (stat?.isFile()) paths.add(e)
    else if (stat?.isDirectory()) for (const abs of walk(join(root, e))) paths.add(relative(root, abs).split(sep).join('/'))
  }
  return [...paths]
    .filter(path => !path.endsWith('.DS_Store'))
    .sort()
    .map(path => ({ path, bytes: statSync(join(root, path)).size }))
}

// The pixel bounds of a listing image, as the directory states them.
const ICON_MIN_PX = 512
const ICON_MAX_PX = 2048

/** The width and height a complete PNG declares, or why the bytes are not one. */
function pngSize(buf) {
  if (buf.length < 45 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return { reason: 'is not a png' }
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return { reason: 'is a png with no header chunk' }
  if (buf.subarray(-8, -4).toString('latin1') !== 'IEND') return { reason: 'is a png cut short: it does not end in IEND' }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * What is wrong with the manifest's listing image (clear-the-plugin-directory-
 * holds design D8; spec: distribution/npm-package). The plugin directory reads
 * the image from the manifest's `icon`, so the key names a path that begins
 * `./`, that `files` covers, and that is a complete, square PNG inside the
 * pixel bounds. A bundled image nothing declares is named too.
 */
function listingImageProblems(manifest, files, root = ROOT) {
  const icon = manifest.icon
  if (typeof icon !== 'string' || !icon) {
    const images = shippedFiles(root, files).map(f => f.path).filter(path => IMAGE.test(path))
    return images.length
      ? images.map(path => `the bundle ships an image the manifest does not declare under "icon": ${path}`)
      : ['the manifest declares no "icon"']
  }
  if (!icon.startsWith('./')) return [`the manifest's "icon" is ${JSON.stringify(icon)}, which does not begin ./`]
  const path = icon.slice(2)
  if (!coveredBy(files, path)) return [`${path} (named by the manifest's "icon") ships in no "files" entry`]
  let buf
  try {
    buf = readFileSync(join(root, path))
  } catch (err) {
    return [`${path} (named by the manifest's "icon") cannot be read: ${err.message}`]
  }
  const { reason, width, height } = pngSize(buf)
  if (reason) return [`${path} ${reason}`]
  if (width !== height) return [`${path} is ${width} by ${height} pixels; the listing image must be square`]
  if (width < ICON_MIN_PX || width > ICON_MAX_PX) return [`${path} is ${width}px; the directory wants ${ICON_MIN_PX} to ${ICON_MAX_PX}`]
  return []
}

test('the manifest names its listing image, and the image ships as a square png inside the directory\'s bounds', () => {
  const manifest = readJson(PLUGIN_PATH)
  assert.equal(typeof manifest.icon, 'string', 'plugin.json names no "icon": the directory reads the listing image from that key')
  assert.deepEqual(listingImageProblems(manifest, pkg.files), [])
})

test('the manifest is the only shipped file that spells the listing image\'s path', () => {
  // The plugin directory's scan raises one finding for each shipped file that
  // names a bundled image, and for each file that names such a file (its
  // report on the scan branch, 2026-10-13: a changelog entry that quoted the
  // manifest's value was two of four). The manifest must name it, because
  // the directory reads the listing image from `icon`; nothing else may.
  const manifestPath = '.claude-plugin/plugin.json'
  const icon = String(readJson(PLUGIN_PATH).icon).replace(/^\.\//, '')
  const spelled = [icon, icon.split('/').pop()]
  const named = shippedFiles(ROOT, pkg.files)
    .map(f => f.path)
    .filter(path => path !== manifestPath && !IMAGE_OR_FONT.test(path))
    .filter(path => {
      const text = readFileSync(join(ROOT, path), 'utf8')
      return spelled.some(s => text.includes(s))
    })
  assert.deepEqual(named, [], `these shipped files name the listing image (${icon}):\n  ${named.join('\n  ')}`)
})

/** The fewest bytes `pngSize` reads as a complete PNG of this size: the signature, a header chunk and the end chunk. */
function pngOf(width, height) {
  const buf = Buffer.alloc(45)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf.write('IEND', 37, 'latin1')
  return buf
}

test('an absent key, an uncovered path, a value without ./ and an image that is not square are each named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-listing-image-'))
  try {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'assets', 'icon.png'), pngOf(512, 512))
    writeFileSync(join(dir, 'assets', 'wide.png'), pngOf(512, 256))
    writeFileSync(join(dir, 'assets', 'small.png'), pngOf(256, 256))
    writeFileSync(join(dir, 'assets', 'cut.png'), pngOf(512, 512).subarray(0, 40))
    writeFileSync(join(dir, 'assets', 'text.png'), 'not an image\n'.repeat(8))
    const declared = { name: 'p', icon: './assets/icon.png' }
    assert.deepEqual(listingImageProblems(declared, ['assets', 'lib'], dir), [])
    assert.deepEqual(listingImageProblems(declared, ['lib', 'hooks'], dir), [
      'assets/icon.png (named by the manifest\'s "icon") ships in no "files" entry'
    ])
    const undeclared = listingImageProblems({ name: 'p' }, ['assets'], dir)
    assert.ok(
      undeclared.includes('the bundle ships an image the manifest does not declare under "icon": assets/icon.png'),
      undeclared.join('\n')
    )
    assert.deepEqual(listingImageProblems({ name: 'p' }, ['lib'], dir), ['the manifest declares no "icon"'])
    assert.deepEqual(listingImageProblems({ name: 'p', icon: 'assets/icon.png' }, ['assets'], dir), [
      'the manifest\'s "icon" is "assets/icon.png", which does not begin ./'
    ])
    assert.deepEqual(listingImageProblems({ name: 'p', icon: './assets/wide.png' }, ['assets'], dir), [
      'assets/wide.png is 512 by 256 pixels; the listing image must be square'
    ])
    assert.deepEqual(listingImageProblems({ name: 'p', icon: './assets/small.png' }, ['assets'], dir), [
      'assets/small.png is 256px; the directory wants 512 to 2048'
    ])
    assert.deepEqual(listingImageProblems({ name: 'p', icon: './assets/cut.png' }, ['assets'], dir), ['assets/cut.png is not a png'])
    assert.deepEqual(listingImageProblems({ name: 'p', icon: './assets/text.png' }, ['assets'], dir), ['assets/text.png is not a png'])
    assert.match(listingImageProblems({ name: 'p', icon: './assets/gone.png' }, ['assets'], dir)[0], /^assets\/gone\.png .* cannot be read: /)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The plugin directory's two file limits, from its pre-submission checklist
// (claude.com/docs/plugins/pre-submission-checklist): a version is held for a
// reviewer when a file that is not an image or a font reaches 256 KiB, or when
// the bundle holds more than 512 files. They are the directory's numbers, not
// caps of a run, so they are recorded here and not in lib/limits.mjs
// (clear-the-plugin-directory-holds design D9).
const DIRECTORY_FILE_BYTES = 262144
const DIRECTORY_FILE_COUNT = 512
// A warning zone below the size limit, so the file that is about to reach it
// fails here one release early instead of holding a version at submission.
// cli/interlock sat about 16 KB under the limit when PR #20's review raised it
// (M3), which is why the note handlers moved out of it (now lib/note-cli.mjs).
const DIRECTORY_HEADROOM_BYTES = 16384

/** Each shipped file at or over the size limit, with its size, and the count when it is over. */
function bundleLimitProblems(entries) {
  const problems = entries
    .filter(e => !IMAGE_OR_FONT.test(e.path) && e.bytes >= DIRECTORY_FILE_BYTES)
    .map(e => `${e.path} is ${e.bytes} bytes; a shipped file that is not an image or a font must be under ${DIRECTORY_FILE_BYTES}`)
  if (entries.length > DIRECTORY_FILE_COUNT) {
    problems.push(`the bundle holds ${entries.length} files; the directory's limit is ${DIRECTORY_FILE_COUNT}`)
  }
  return problems
}

test('the bundle stays inside the plugin directory\'s file limits', () => {
  const shipped = shippedFiles(ROOT, pkg.files)
  assert.ok(shipped.length > 0, 'the "files" whitelist covers no file')
  const problems = bundleLimitProblems(shipped)
  assert.deepEqual(problems, [], `the directory holds a version for a reviewer on:\n  ${problems.join('\n  ')}`)
})

test('the limits pin names a text file at the limit and a count over it, and leaves an image alone', () => {
  const few = [
    { path: 'lib/under.mjs', bytes: DIRECTORY_FILE_BYTES - 1 },
    { path: 'lib/at.mjs', bytes: DIRECTORY_FILE_BYTES },
    { path: 'lib/over.mjs', bytes: DIRECTORY_FILE_BYTES + 1 },
    { path: 'assets/large.png', bytes: 300000 },
    { path: 'assets/face.woff2', bytes: 300000 }
  ]
  assert.deepEqual(bundleLimitProblems(few), [
    'lib/at.mjs is 262144 bytes; a shipped file that is not an image or a font must be under 262144',
    'lib/over.mjs is 262145 bytes; a shipped file that is not an image or a font must be under 262144'
  ])
  const many = n => Array.from({ length: n }, (_, i) => ({ path: `skills/s${i}/SKILL.md`, bytes: 10 }))
  assert.deepEqual(bundleLimitProblems(many(DIRECTORY_FILE_COUNT)), [])
  assert.deepEqual(bundleLimitProblems(many(DIRECTORY_FILE_COUNT + 1)), ["the bundle holds 513 files; the directory's limit is 512"])
})

/** Each shipped text file inside the headroom below the size limit, with how much is left. */
function headroomProblems(entries) {
  return entries
    .filter(e => !IMAGE_OR_FONT.test(e.path) && e.bytes > DIRECTORY_FILE_BYTES - DIRECTORY_HEADROOM_BYTES)
    .map(e => `${e.path} is ${e.bytes} bytes, ${DIRECTORY_FILE_BYTES - e.bytes} under the ${DIRECTORY_FILE_BYTES}-byte limit; move code out before it holds a version`)
}

test('every shipped text file keeps the headroom below the directory\'s size limit', () => {
  const problems = headroomProblems(shippedFiles(ROOT, pkg.files))
  assert.deepEqual(problems, [], `inside the warning zone:\n  ${problems.join('\n  ')}`)
})

test('the headroom pin names a file inside the zone and leaves the edge and an image alone', () => {
  const edge = DIRECTORY_FILE_BYTES - DIRECTORY_HEADROOM_BYTES
  assert.deepEqual(headroomProblems([
    { path: 'bin/edge', bytes: edge },
    { path: 'bin/inside', bytes: edge + 1 },
    { path: 'assets/large.png', bytes: 300000 }
  ]), [`bin/inside is ${edge + 1} bytes, ${DIRECTORY_HEADROOM_BYTES - 1} under the 262144-byte limit; move code out before it holds a version`])
})

// ---------------------------------------------------------------------------
// What the plugin directory reads as a credential, and a send
// (remove-the-push-notification). Its hold "Uses a credential from the user's
// machine" pairs a read of a credential from the environment or a file with a
// request off the machine, "even in a README example", and the bundle's text is
// what it reads: shipped prose counts. Each rule is a named function with a
// self-test, so a check that silently matches nothing fails here first.
// ---------------------------------------------------------------------------

/** Every shipped file that is not an image or a font, with its text. */
function shippedTexts(root = ROOT, files = pkg.files) {
  return shippedFiles(root, files)
    .filter(e => !IMAGE_OR_FONT.test(e.path))
    .map(e => ({ path: e.path, text: readFileSync(join(root, e.path), 'latin1') }))
}

// Credential variables and files, the host's option-variable prefix, and the
// removed push's variables. No shipped file is excepted, the changelog included:
// it no longer ships, and an exception for it was the gap the 1.14.0 scan held.
const CREDENTIAL_NAMES = Object.freeze([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'apiKeyHelper',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  '.credentials.json',
  'auth.json',
  '.netrc',
  'AWS_SECRET_ACCESS_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'find-generic-password',
  'CLAUDE_PLUGIN_OPTION_',
  'INTERLOCK_NTFY_'
])

/** `path: name, name` for each text that spells a credential name. */
function credentialNameProblems(entries) {
  return entries
    .map(({ path, text }) => {
      const hits = CREDENTIAL_NAMES.filter(name => text.includes(name))
      return hits.length ? `${path}: ${hits.join(', ')}` : null
    })
    .filter(Boolean)
}

// What the removed push left behind, were any of it to come back.
const PUSH_RESIDUE = Object.freeze([/ntfy/i, /notify-option/, /notifyTimeoutMs/, /postNtfy/, /push timeout/i])

/** `path: residue` for each text that still carries the removed push. */
function pushResidueProblems(entries) {
  return entries
    .map(({ path, text }) => {
      const hits = PUSH_RESIDUE.filter(re => re.test(text)).map(re => re.source)
      return hits.length ? `${path}: ${hits.join(', ')}` : null
    })
    .filter(Boolean)
}

const NETWORK_MODULES = '(?:node:)?(?:http|https|http2|net|tls|dgram)|undici'
const NETWORK_CONSTRUCTS = Object.freeze([
  ['a fetch call', /(?<![\w$.])fetch\s*\(|\bglobalThis\.fetch\b/],
  ['a network module import', new RegExp(`\\bfrom\\s*['"](?:${NETWORK_MODULES})['"]`)],
  ['a network module import', new RegExp(`\\bimport\\s*\\(\\s*['"](?:${NETWORK_MODULES})['"]`)],
  ['a network module import', new RegExp(`\\bimport\\s+['"](?:${NETWORK_MODULES})['"]`)],
  ['a network module require', new RegExp(`\\brequire\\s*\\(\\s*['"](?:${NETWORK_MODULES})['"]`)],
  ['a socket or request constructor', /\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/]
])

/** A shipped file a JavaScript engine runs: by extension, or a node shebang. */
const isScript = ({ path, text }) => /\.(?:mjs|cjs|js)$/.test(path) || /^#!.*\bnode\b/.test(text)

/** `path: construct` for each shipped script that could open a connection. */
function networkProblems(entries) {
  return entries
    .filter(isScript)
    .flatMap(({ path, text }) => [...new Set(NETWORK_CONSTRUCTS.filter(([, re]) => re.test(text)).map(([what]) => what))].map(what => `${path}: ${what}`))
}

// ---------------------------------------------------------------------------
// Package-manager commands (clear-the-directory-validation-findings design D6,
// D7, D8, D13, D16). The plugin directory's `LAUNCHER_REGISTRY_REDIRECT` is a
// parser that could not read a package-manager command: a short verb, a short
// option, a floating tag or an unversioned launcher in shipped text. Nothing
// shipped sets a registry; the rule here is stricter than the finding so the
// next shipped string cannot trip it. It reads only where a text spells code,
// so prose ("npm users") needs no exception list.
// ---------------------------------------------------------------------------

/** Dynamic pins a shipped module may spell, exactly: the template, not a version. */
const ALLOWED_DYNAMIC_PINS = Object.freeze(['${OPENSPEC_PIN.package}@${OPENSPEC_PIN.version}', '${CLI_PACKAGE}@${version}'])

/** Options that take a value, which must be joined to it with `=`. */
const VALUE_OPTIONS = Object.freeze(['--location', '--tag', '--package', '--prefix', '--workspace', '--omit', '--include', '--python', '--with', '--spec'])

/** Options whose value names a package to fetch. */
const PACKAGE_OPTIONS = Object.freeze(['--package', '--with', '--spec'])

/** Launchers: the first argument is the package they fetch and run. */
const LAUNCHER_WORDS = Object.freeze(['npx', 'bunx', 'uvx'])

/**
 * Each manager's commands (`verbs`, aliases included), the short `aliases` among
 * them, the verbs that install what they are given, and the verbs that fetch
 * and run a package. A word after the manager that is none of its verbs is prose.
 */
const MANAGERS = Object.freeze({
  npm: {
    verbs: 'install ci test run run-script exec start stop restart pack publish view config init link uninstall update ls list outdated audit cache login logout whoami version prune dedupe doctor explain rebuild root search pkg ping query help set get'.split(' '),
    aliases: ['i', 'in', 'ins', 'it', 'add', 'x', 't', 'un', 'up', 'rm'],
    install: ['install', 'i', 'in', 'ins', 'it', 'add'],
    launch: ['exec', 'x']
  },
  pnpm: {
    verbs: 'install add remove update run exec dlx test start create init list outdated audit publish pack link unlink store why prune rebuild dedupe fetch import patch deploy env setup config licenses'.split(' '),
    aliases: ['i', 'rm', 'un', 'up', 't', 'ln'],
    install: ['install', 'add', 'i'],
    launch: ['dlx']
  },
  yarn: {
    verbs: 'install add remove upgrade up run dlx test init link unlink list why publish pack config cache global workspace workspaces set'.split(' '),
    aliases: [],
    install: ['add'],
    launch: ['dlx']
  },
  bun: {
    verbs: 'install add remove update run x test init create build link pm upgrade'.split(' '),
    aliases: ['i', 'a', 'rm', 'x'],
    install: ['install', 'add', 'i', 'a'],
    launch: ['x']
  },
  uv: {
    verbs: 'pip tool run add remove sync lock init venv python build publish cache self export tree version'.split(' '),
    aliases: [],
    install: ['add', 'pip install', 'tool install'],
    launch: ['tool run']
  },
  pipx: {
    verbs: 'install run uninstall upgrade inject list ensurepath runpip reinstall environment'.split(' '),
    aliases: [],
    install: ['install'],
    launch: ['run']
  },
  corepack: {
    verbs: 'enable disable prepare use install pack hydrate up cache init'.split(' '),
    aliases: [],
    install: ['prepare', 'use'],
    launch: []
  }
})

const COMMAND_WORD = new RegExp(String.raw`(?<![\w@./$-])(${[...Object.keys(MANAGERS), ...LAUNCHER_WORDS].join('|')})(?![\w-])`, 'g')

/** An exact version pin: `name@1.2.3`, `@scope/name@1.2.3` or `name==1.2.3`, or an allow-listed template. */
function isExactPin(token) {
  return (
    ALLOWED_DYNAMIC_PINS.includes(token) ||
    /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(token) ||
    /^[A-Za-z0-9._-]+(?:\[[\w,-]+\])?==\d+(?:\.\d+)*$/.test(token)
  )
}

/** Why `words` (a manager or launcher word and what follows it) is not a readable, pinned command; `[]` when it is, or is not a command. */
function commandReasons(words) {
  const first = words[0]
  const rest = words.slice(1)
  let kind = 'other'
  let verb = null
  let args = rest
  if (LAUNCHER_WORDS.includes(first)) {
    kind = 'launch'
  } else {
    const manager = MANAGERS[first]
    verb = rest[0]
    if (!verb || ![...manager.verbs, ...manager.aliases].includes(verb)) return []
    args = rest.slice(1)
    let full = verb
    if (first === 'uv' && (verb === 'pip' || verb === 'tool') && args[0]) full = `${verb} ${args[0]}`
    if (manager.install.includes(full)) kind = 'install'
    else if (manager.launch.includes(full)) kind = 'launch'
    if (full !== verb && kind !== 'other') args = args.slice(1)
  }
  const reasons = []
  if (verb && MANAGERS[first].aliases.includes(verb)) reasons.push(`the verb \`${verb}\` is not spelled in full`)
  const positional = []
  const named = []
  for (let k = 0; k < args.length; k++) {
    const token = args[k]
    if (token === '--') break
    if (/^-[A-Za-z]/.test(token)) {
      reasons.push(`the option \`${token}\` is a short option`)
    } else if (token.startsWith('--')) {
      const [name, value] = token.split(/=(.*)/s)
      if (VALUE_OPTIONS.includes(name) && value === undefined) {
        reasons.push(`the option \`${name}\` is not joined to its value with \`=\``)
        k++
      } else if (value !== undefined && PACKAGE_OPTIONS.includes(name)) {
        named.push(value)
      }
    } else if (/^[@\w$.{][^\s]*$/.test(token) && !/^\.{1,2}$/.test(token) && !/^\.{0,2}\//.test(token)) {
      positional.push(token)
    }
  }
  if (kind === 'launch' && positional.length === 0 && named.length === 0) return []
  const toPin = kind === 'launch' ? (named.length ? [] : positional.slice(0, 1)) : kind === 'install' ? positional : []
  for (const token of [...named, ...toPin]) {
    if (!isExactPin(token)) reasons.push(`\`${token}\` is not pinned to an exact version`)
  }
  return reasons
}

/** `{ line, text }` for each place a text spells code: a fenced line or a backtick span in Markdown. */
function markdownRegions(text) {
  const regions = []
  let fenced = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
    } else if (fenced) {
      regions.push({ line: i + 1, text: line })
    } else {
      for (const m of line.matchAll(/`([^`\n]+)`/g)) regions.push({ line: i + 1, text: m[1] })
    }
  })
  return regions
}

/** `{ line, text }` for each string or template literal in a script, and each backtick span in its comments. */
function scriptRegions(text) {
  const n = text.length
  const found = []
  const lineAt = at => text.slice(0, at).split('\n').length
  const quoteEnd = at => {
    let j = at + 1
    while (j < n && text[j] !== text[at] && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
    return j
  }
  const templateEnd = from => {
    let j = from
    while (j < n && text[j] !== '`') {
      if (text[j] === '\\') j += 2
      else if (text[j] === '$' && text[j + 1] === '{') j = placeholderEnd(j + 2)
      else j++
    }
    return j
  }
  const placeholderEnd = from => {
    let depth = 1
    let j = from
    while (j < n && depth > 0) {
      if (text[j] === "'" || text[j] === '"') j = quoteEnd(j) + 1
      else if (text[j] === '`') j = templateEnd(j + 1) + 1
      else {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
    }
    return j
  }
  const add = (from, to, kind) => {
    text
      .slice(from, to)
      .split('\n')
      .reduce((at, piece) => {
        if (kind === 'comment') for (const m of piece.matchAll(/`([^`\n]+)`/g)) found.push({ line: lineAt(at), text: m[1] })
        else found.push({ line: lineAt(at), text: piece })
        return at + piece.length + 1
      }, from)
  }
  let last = ''
  for (let i = 0; i < n; ) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      add(i, end === -1 ? n : end, 'comment')
      i = end === -1 ? n : end
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      add(i, end === -1 ? n : end, 'comment')
      i = end === -1 ? n : end + 2
    } else if (c === "'" || c === '"') {
      const end = quoteEnd(i)
      add(i + 1, end, 'literal')
      i = end + 1
      last = '"'
    } else if (c === '`') {
      const end = templateEnd(i + 1)
      add(i + 1, end, 'literal')
      i = end + 1
      last = '"'
    } else if (c === '/' && (last === '' || '(,=:[!&|?{};'.includes(last) || last === 'return')) {
      let j = i + 1
      let inClass = false
      while (j < n && text[j] !== '\n' && (text[j] !== '/' || inClass)) {
        if (text[j] === '\\') j++
        else if (text[j] === '[') inClass = true
        else if (text[j] === ']') inClass = false
        j++
      }
      if (text[j] === '/') {
        i = j + 1
        last = '"'
      } else {
        i++
        last = '/'
      }
    } else if (/\s/.test(c)) {
      i++
    } else if (/[\w$]/.test(c)) {
      let j = i
      while (j < n && /[\w$]/.test(text[j])) j++
      last = text.slice(i, j)
      i = j
    } else {
      last = c
      i++
    }
  }
  return found
}

/** Every package-manager or launcher command a text spells as code, as `{ line, words }`. */
function commandsOf({ path, text }) {
  const regions = /\.md$/i.test(path) ? markdownRegions(text) : scriptRegions(text)
  const commands = []
  for (const { line, text: fragment } of regions) {
    for (const m of fragment.matchAll(COMMAND_WORD)) {
      // `npm,` and `npm's` are prose: a command word is followed by a space, or ends the span.
      if (/^\S/.test(fragment.slice(m.index + m[1].length))) continue
      const spelled = fragment.slice(m.index).split(/[);|`]|&&|\s#\s/)[0]
      const words = spelled
        .split(/\s+/)
        .map(w => w.replace(/^["'`,]+/, '').replace(/["'`,.:;]+$/, '') || w)
        .filter(Boolean)
      commands.push({ line, words })
    }
  }
  return commands
}

/** Package sources a shipped text must not set, wherever it says so (design D6). */
const PACKAGE_SOURCES = Object.freeze([
  ['--registry', /--registry\b/],
  ['--index-url', /--index-url\b/],
  ['--extra-index-url', /--extra-index-url\b/],
  ['--proxy', /--proxy\b/],
  ['registry=', /\bregistry=/],
  ['npm_config_', /npm_config_/],
  ['npm config set', /npm\s+config\s+set\b/],
  // `publishConfig` is the package.json block that lets a scoped package publish publicly (`access`);
  // it is a package source only where it carries a `registry`, which the loop below reads.
  ['publishConfig', /publishConfig/],
  ['.npmrc', /\.npmrc\b/],
  ['bunfig.toml', /bunfig\.toml/],
  ['uv.toml', /uv\.toml/],
  ['pip.conf', /pip\.conf/],
  ['.yarnrc', /\.yarnrc/]
])

/** The one shipped file that may name the default registry: the pin's lockfile. */
const REGISTRY_HOST_HOME = 'lib/openspec-pin.mjs'

/**
 * `path:line: reason` for each shipped text that spells a package-manager command
 * badly, and each that sets a package source (spec distribution/npm-package
 * "Every package-manager command a shipped text spells SHALL be readable and
 * exactly pinned").
 */
function packageCommandProblems(entries) {
  const problems = []
  for (const entry of entries) {
    for (const { line, words } of commandsOf(entry)) {
      for (const reason of commandReasons(words)) problems.push(`${entry.path}:${line}: ${reason} (${words.join(' ').slice(0, 80)})`)
    }
    let manifest = null
    if (entry.path === 'package.json') {
      try {
        manifest = JSON.parse(entry.text)
      } catch {
        // Not JSON: the line scan below reads it as text.
      }
      if (manifest?.publishConfig && typeof manifest.publishConfig === 'object' && 'registry' in manifest.publishConfig) {
        problems.push('package.json:1: publishConfig.registry is a package source')
      }
    }
    entry.text.split('\n').forEach((text, i) => {
      for (const [name, re] of PACKAGE_SOURCES) {
        if (name === 'publishConfig' && manifest) continue
        if (re.test(text)) problems.push(`${entry.path}:${i + 1}: ${name} is a package source`)
      }
      if (entry.path !== REGISTRY_HOST_HOME && /registry\.npmjs\.org/.test(text)) {
        problems.push(`${entry.path}:${i + 1}: registry.npmjs.org is a package source`)
      }
    })
  }
  return problems
}

test('no shipped text spells a package-manager command the directory cannot read, or sets a package source', () => {
  const problems = packageCommandProblems(shippedTexts())
  assert.deepEqual(problems, [], `these shipped texts spell a package command badly:\n  ${problems.join('\n  ')}`)
})

test('the command check names a short verb, a short option, a floating tag, an unversioned launcher and a loose value option', () => {
  const md = text => [{ path: 'docs/x.md', text }]
  const named = (text, ...tokens) => {
    const problems = packageCommandProblems(md(text))
    for (const token of tokens) assert.ok(problems.some(p => p.includes(token)), `${token} is not named in: ${problems.join(' | ')}`)
    return problems
  }
  assert.match(named('Run `npm i -g x@1.0.0` first.', 'x.md:1', '`i`', '`-g`')[0], /^docs\/x\.md:1: /)
  named('`npm install -g @fission-ai/openspec@latest`', '@latest')
  named('`npx tsc --noEmit`', '`tsc` is not pinned')
  named('`npm install --tag latest x@1.0.0`', '`--tag`')
  named('`npm install --location=global x@^1.0.0`', '`x@^1.0.0`')
  named('`npm install --location=global x`', '`x` is not pinned')
  named('`uvx ruff check`', '`ruff` is not pinned')
  named('`pnpm dlx create-thing@next`', '`create-thing@next`')
  named('`yarn add left-pad`', '`left-pad`')
  for (const alias of ['i', 'in', 'ins', 'it', 'add', 'x', 't', 'un', 'up', 'rm']) named(`\`npm ${alias} y@1.0.0\``, `\`${alias}\``)
})

test('the command check reads a command to the end of its span, and inside a module\'s literal', () => {
  const module = [{ path: 'lib/m.mjs', text: 'const msg = `install the matching CLI (npm i -g @scope/cli@${v}) or expect`\n' }]
  const problems = packageCommandProblems(module)
  assert.equal(problems.length, 3, problems.join(' | '))
  assert.ok(problems.some(p => p.includes('`i`')) && problems.some(p => p.includes('`-g`')) && problems.some(p => p.includes('@scope/cli@${v}')))
  assert.ok(problems.every(p => p.startsWith('lib/m.mjs:1: ')), problems.join(' | '))
  const tool = packageCommandProblems([{ path: 'README.md', text: 'Use `npx tool --flag` here.\n' }])
  assert.equal(tool.length, 1)
  assert.match(tool[0], /`tool` is not pinned/)
})

test('the command check passes long-form pinned commands and plain prose', () => {
  const texts = [
    'Install: `npm install --location=global @fission-ai/openspec@1.15.0`',
    '```bash\nnpm ci --ignore-scripts --no-audit --no-fund\nnpm test\nnpm run typecheck\nnpm install --package-lock-only\n```',
    'Prose: npm users should read `npm test`, and the npm release notes, `npm release` and `npm = whichSync(`.',
    'Pinned: `npx tsc@5.4.2 --noEmit`, `uvx ruff@0.5.0`, `uv tool install ruff==0.5.0`, `npm exec --package=typescript@5.4.2 -- tsc`',
    'After the dashes: `npm test -- -t name`',
    'Prose with a comma or a possessive: (npm, install scripts) and `npm\'s lockfile-exact ci`.'
  ]
  for (const text of texts) assert.deepEqual(packageCommandProblems([{ path: 'docs/ok.md', text }]), [], text)
})

test('the command check leaves a bare launcher, a regex over npm\'s output, a tool pattern and prose outside code alone', () => {
  assert.deepEqual(
    packageCommandProblems([
      // The devops rubric's rule text, skills/review-code/dimensions/devops.md:11.
      { path: 'skills/review-code/dimensions/devops.md', text: 'installs nothing at a version chosen at run time: no `@latest`, no unversioned global install, no `npx`, no `curl | sh`.' },
      // lib/openspec-cli.mjs:223, :17; lib/host/registry.mjs:227; lib/host/acp.mjs:123; lib/doctor.mjs:8, :865.
      { path: 'lib/openspec-cli.mjs', text: "const real = l => !/complete log of this run|log file|^npm (ERR!|error)\\s*$/i.test(l)\n// a compiled build or `npx`.\n" },
      { path: 'lib/host/registry.mjs', text: ' * not by an argument of `npx`.\n' },
      { path: 'lib/host/acp.mjs', text: ' * A launcher whose own name is `npx` is not in this set: the command name does\n' },
      { path: 'lib/doctor.mjs', text: "// installed, or because `Bash(npm test:*)` is missing from the allowlist and an\n  // Provisioning leads. It needs Node and npm; the npm install stays as the user's own route.\n" }
    ]),
    []
  )
})

test('the command check passes an allow-listed dynamic pin and names one that is not', () => {
  const ok = 'export const A = `npm install --location=global ${OPENSPEC_PIN.package}@${OPENSPEC_PIN.version}`\nexport const B = `npm install --location=global ${CLI_PACKAGE}@${version}`\n'
  assert.deepEqual(packageCommandProblems([{ path: 'lib/ok.mjs', text: ok }]), [])
  const other = packageCommandProblems([{ path: 'lib/no.mjs', text: 'export const C = `npm install --location=global ${NAME}@${v}`\n' }])
  assert.equal(other.length, 1)
  assert.match(other[0], /`\$\{NAME\}@\$\{v\}` is not pinned/)
  assert.deepEqual([...ALLOWED_DYNAMIC_PINS], ['${OPENSPEC_PIN.package}@${OPENSPEC_PIN.version}', '${CLI_PACKAGE}@${version}'])
})

test('the command check names a package source wherever it is spelled', () => {
  const sources = [
    'npm config set registry https://x',
    'see .npmrc for it',
    'plain prose with --registry=https://x in it',
    'export npm_config_prefix=/x',
    'registry=https://x',
    'a publishConfig block',
    'pip install --index-url https://x y==1.0.0',
    'set a --proxy',
    'bunfig.toml, uv.toml, pip.conf and .yarnrc'
  ]
  for (const text of sources) {
    assert.ok(packageCommandProblems([{ path: 'README.md', text }]).some(p => p.endsWith('is a package source')), `not named: ${text}`)
  }
  // package.json's `publishConfig` is a source only where it carries a registry.
  assert.deepEqual(packageCommandProblems([{ path: 'package.json', text: '{ "publishConfig": { "access": "public" } }' }]), [])
  assert.deepEqual(packageCommandProblems([{ path: 'package.json', text: '{ "publishConfig": { "registry": "https://x" } }' }]), [
    'package.json:1: publishConfig.registry is a package source'
  ])
  assert.deepEqual(packageCommandProblems([{ path: 'lib/openspec-pin.mjs', text: '"resolved": "https://registry.npmjs.org/x/-/x-1.0.0.tgz"' }]), [])
  assert.equal(packageCommandProblems([{ path: 'lib/other.mjs', text: '"resolved": "https://registry.npmjs.org/x/-/x-1.0.0.tgz"' }]).length, 1)
})

// The install lines the README and the first-hour guide quote must equal what the
// CLI prints, and the README's CLI install line must name this package's version
// (design D8, D12). A bump or an OpenSpec pin regeneration that forgets one of
// them is named here instead of shipping a stale command.

/** Every fenced line and backtick span in a Markdown text that names the OpenSpec package. */
function openspecInstallQuotes(text) {
  return markdownRegions(text)
    .map(r => r.text.trim())
    .filter(t => t.includes('@fission-ai/openspec'))
}

test('the OpenSpec install line in the README and the first-hour guide equals the constant the CLI prints', () => {
  for (const file of ['README.md', 'docs/01-first-hour.md']) {
    const quotes = openspecInstallQuotes(readFileSync(join(ROOT, file), 'utf8'))
    assert.ok(quotes.length >= 1, `${file} quotes no OpenSpec install line`)
    for (const quote of quotes) assert.equal(quote, OPENSPEC_INSTALL, `${file} quotes an OpenSpec install line that is not OPENSPEC_INSTALL`)
  }
})

test('the README\'s CLI install line is the long form with this package\'s name and version', () => {
  const line = `npm install --location=global ${pkg.name}@${pkg.version}`
  const spans = markdownRegions(readFileSync(join(ROOT, 'README.md'), 'utf8')).map(r => r.text.trim())
  assert.ok(spans.includes(line), `README.md has no backtick span or fenced line \`${line}\`: a version bump also edits it`)
})

test('the install-line pin names a stale quote and passes an equal one', () => {
  assert.deepEqual(openspecInstallQuotes('```bash\nnpm install -g @fission-ai/openspec@latest\n```\nand `npm install --location=global @fission-ai/openspec@1.15.0`'), [
    'npm install -g @fission-ai/openspec@latest',
    'npm install --location=global @fission-ai/openspec@1.15.0'
  ])
  assert.deepEqual(openspecInstallQuotes('no package named here, only `interlock openspec provision`'), [])
})

// The Node floor the setup docs and the two design prompts name for OpenSpec must
// be the pin's own (design D8, D18). Provisioning refuses a Node below the pin's
// floor, so a page that still says the old one sends a reader to an install that
// then fails. A later pin regeneration that leaves one stale is named here.

/** A version padded to three parts, so `22.12` and `22.12.0` compare equal. */
const threePart = v => (v.split('.').concat(['0', '0']).slice(0, 3)).join('.')

/**
 * The docs rule: every two- or three-part version that follows the word Node
 * (`Node.js 22.12+`, `Node.js **22.12.0+**`, `a Node below 22.12.0`) must be the
 * floor. A one-part version (`Node.js >= 18`, the plugin's own floor) is not
 * matched, and a file with no such version at all is named, so a reword that
 * drops them fails instead of passing empty.
 */
const NODE_VERSION = /\bNode(?:\.js)?[\s*≥>=v]*(?:(?:below|at least|older than)[\s*≥>=v]*)?(\d+\.\d+(?:\.\d+)?)/g

function docNodeFloorProblems(files, floor) {
  const problems = []
  for (const { path, text } of files) {
    const found = [...text.matchAll(NODE_VERSION)].map(m => m[1])
    if (found.length === 0) problems.push(`${path}: names no Node version for OpenSpec`)
    for (const v of found) if (threePart(v) !== floor) problems.push(`${path}: names Node ${v}, not the pin's floor ${floor}`)
  }
  return problems
}

/**
 * The design-prompt rule: their sample `node` row names the running Node beside
 * the word, and they name many Claude Code versions as `X+`, so only a
 * three-part version that follows `OpenSpec requires` or `OpenSpec CLI needs`
 * is read. Each prompt must hold at least one.
 */
const PROMPT_NODE_VERSION = /OpenSpec (?:requires|CLI needs)\s+v?(\d+\.\d+\.\d+)/g

function promptNodeFloorProblems(files, floor) {
  const problems = []
  for (const { path, text } of files) {
    const found = [...text.matchAll(PROMPT_NODE_VERSION)].map(m => m[1])
    if (found.length === 0) problems.push(`${path}: has no "OpenSpec requires" or "OpenSpec CLI needs" version`)
    for (const v of found) if (v !== floor) problems.push(`${path}: says OpenSpec needs ${v}, not the pin's floor ${floor}`)
  }
  return problems
}

const readRepo = paths => paths.map(path => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }))

test('the setup docs name the pin\'s Node floor wherever they name one for OpenSpec', () => {
  assert.deepEqual(docNodeFloorProblems(readRepo(['README.md', 'docs/01-first-hour.md', 'docs/07-cli-and-configuration.md']), OPENSPEC_PIN.node), [])
})

test('the design prompts name the pin\'s Node floor after "OpenSpec requires" and "OpenSpec CLI needs"', () => {
  assert.deepEqual(promptNodeFloorProblems(readRepo(['site/DESIGN-PROMPT.md', 'docs/assets/DESIGN-PROMPT.md', 'site/FirstHour.dc.html', 'site/Limits.dc.html']), OPENSPEC_PIN.node), [])
})

test('the docs Node-floor check reads every form, skips the plugin\'s own floor, and names a stale or missing version', () => {
  const floor = '22.12.0'
  const ok = text => docNodeFloorProblems([{ path: 'd.md', text }], floor)
  assert.deepEqual(ok('Node.js **22.12+** with npm'), [])
  assert.deepEqual(ok('Needs Node.js 22.12+, npm and the registry'), [])
  assert.deepEqual(ok('a Node below 22.12.0, no npm'), [])
  assert.deepEqual(ok('requires **Node.js 22.12.0+** (higher than the plugin\'s Node.js ≥ 18)'), [])
  assert.deepEqual(ok('Node.js ≥ 18 runs the CLIs. Provisioning OpenSpec needs Node.js 22.12+.'), [])
  assert.deepEqual(ok('Node.js 22.12.0 or newer'), [])
  // Stale floors, in each form the docs used.
  assert.equal(ok('Node.js **20.19+** with npm').length, 1)
  assert.equal(ok('Needs Node.js 20.19+, npm').length, 1)
  assert.equal(ok('a Node below 20.19.0').length, 1)
  assert.equal(ok('**Node.js 20.19.0+**').length, 1)
  assert.equal(ok('Node.js 22.12+ here, Node.js 20.19+ there').length, 1)
  assert.equal(ok('Node v26.8.1').length, 1)
  // A text that names no Node version fails instead of passing empty.
  assert.deepEqual(ok('Node.js ≥ 18 only'), ['d.md: names no Node version for OpenSpec'])
  assert.match(ok('Node.js 20.19+')[0], /^d\.md: names Node 20\.19, not the pin's floor 22\.12\.0$/)
})

test('the design-prompt Node-floor check reads only the anchored phrases and demands one', () => {
  const floor = '22.12.0'
  const ok = text => promptNodeFloorProblems([{ path: 'p.md', text }], floor)
  assert.deepEqual(ok('[ok  ] node: Node v26.8.1 (plugin requires >=18, OpenSpec requires 22.12.0+)'), [])
  assert.deepEqual(ok('| Node floor | 18 or newer for Interlock; the OpenSpec CLI needs 22.12.0 or newer | engines |'), [])
  // The running Node and Claude Code versions are not the floor and are not read.
  assert.deepEqual(ok('Node v26.8.1 and Claude Code 2.1.154+ or 2.1.291 or newer; OpenSpec requires 22.12.0+'), [])
  // Stale, in both anchored forms.
  assert.equal(ok('OpenSpec requires 20.19.0+').length, 1)
  assert.equal(ok('the OpenSpec CLI needs 20.19.0 or newer').length, 1)
  assert.equal(ok('OpenSpec requires 22.12.0+ and the OpenSpec CLI needs 20.19.0 or newer').length, 1)
  // A reword that drops the anchor fails instead of passing empty.
  assert.deepEqual(ok('Node v26.8.1; needs 20.19.0'), ['p.md: has no "OpenSpec requires" or "OpenSpec CLI needs" version'])
  assert.equal(ok('').length, 1)
})

// ---------------------------------------------------------------------------
// The plugin directory's six local-code policy codes (design D10, D14). They
// refuse a bundle that carries hooks, a hooks module, workflow scripts, tool
// grants beyond reading, or files outside text and image types, and only a
// Verified organization clears them. This is a detector over the file set that
// ships, held against a declared inventory: it asserts today's state and names
// drift with its code and path, so a later prose-only edition changes numbers,
// not code.
// ---------------------------------------------------------------------------

const POLICY_TEXT = /\.(?:md|txt|json|ya?ml)$/i
const POLICY_IMAGE = /\.(?:png|jpe?g|gif|webp|ico)$/i
/** Extension-less files the policy reads as plain text. */
const POLICY_PLAIN_NAMES = Object.freeze(['LICENSE', 'LICENCE', 'README', '.gitignore'])
/** Package-manager configuration files, a file type of their own in the policy. */
const POLICY_MANAGER_CONFIGS = Object.freeze([
  'pnpm-workspace.yaml',
  '.pnpmfile.cjs',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'bunfig.toml',
  'uv.toml',
  'pip.conf',
  'pip.ini'
])
const PLAIN_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'LS'])

/**
 * What the shipped bundle holds, per policy code, as of this version. Frozen: a
 * count that moves, a place or a grant path that appears or empties is named by
 * `directoryPolicyProblems`, and updating it is the owner's reading of the change.
 */
const DIRECTORY_INVENTORY = Object.freeze({
  // LOCAL_CODE_HOOK_COMMAND, LOCAL_CODE_MOD, LOCAL_CODE_NOT_READ, LOCAL_CODE_WORKFLOW.
  counts: Object.freeze({ hooks: 13, hooksModules: 1, hooksFilesNamingModule: 1, workflowScripts: 1, workflowsKey: 1 }),
  // LOCAL_CODE_FILE_TYPE: where files outside the allowed types ship. `LICENSE` is plain text and is no place.
  fileTypePlaces: Object.freeze(['cli/', 'hooks/', 'lib/', 'workflows/', 'skills/spec/scripts/', 'types/']),
  // LOCAL_CODE_TOOL_GRANT: every skill and agent that grants beyond Read, Grep, Glob and LS. Only skills/ship/SKILL.md does not.
  toolGrantPaths: Object.freeze([
    'agents/ping.md',
    'agents/settle-fixer.md',
    'agents/worker.md',
    'skills/bootstrap/SKILL.md',
    'skills/commit/SKILL.md',
    'skills/dispatch/SKILL.md',
    'skills/docs-digest/SKILL.md',
    'skills/evals/SKILL.md',
    'skills/explain-code/SKILL.md',
    'skills/explore/SKILL.md',
    'skills/fix-tests/SKILL.md',
    'skills/graph/SKILL.md',
    'skills/manual-test-plan/SKILL.md',
    'skills/report/SKILL.md',
    'skills/review-artifacts/SKILL.md',
    'skills/review-code/SKILL.md',
    'skills/settle/SKILL.md',
    'skills/spec/SKILL.md'
  ])
})

/** The `allowed-tools`, `allowedTools` or `tools` entries of a file's frontmatter, split on spaces and commas outside parentheses. */
function frontmatterGrants(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return []
  const lines = m[1].split(/\r?\n/)
  const grants = []
  for (let i = 0; i < lines.length; i++) {
    const key = /^(?:allowed-tools|allowedTools|tools):\s*(.*)$/.exec(lines[i])
    if (!key) continue
    let value = key[1]
    while (i + 1 < lines.length && /^\s+(?:-\s*)?\S/.test(lines[i + 1])) value += ` ${lines[++i].replace(/^\s*-\s*/, '')}`
    value = value.replace(/^\[|\]$/g, '')
    let depth = 0
    let token = ''
    for (const ch of value) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (depth === 0 && /[\s,]/.test(ch)) {
        if (token) grants.push(token)
        token = ''
      } else {
        token += ch
      }
    }
    if (token) grants.push(token)
  }
  return grants.map(g => g.replace(/^["']|["']$/g, ''))
}

/** Whether a tool grant reaches beyond plain Read, Grep, Glob and LS. */
function grantsBeyondPlain(grant) {
  const m = /^(Read|Grep|Glob|LS)(?:\(([\s\S]*)\))?$/.exec(grant)
  if (!m) return true
  const path = m[2]
  return path !== undefined && (/\$\{/.test(path) || /^(?:\/\/|\\\\)/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path))
}

/** The hook entries a manifest or a hooks file declares, of every type. */
function hookEntries(hooks) {
  if (!hooks || typeof hooks !== 'object') return []
  return Object.values(hooks).flatMap(groups =>
    (Array.isArray(groups) ? groups : []).flatMap(group => (Array.isArray(group?.hooks) ? group.hooks : group && group.type ? [group] : []))
  )
}

/** Whether `data` is a file the policy refuses by type, and why; `null` when it allows it. */
function fileTypeReason(path, data) {
  const base = path.split('/').pop()
  if (POLICY_MANAGER_CONFIGS.includes(base)) return 'a package-manager configuration file'
  if (POLICY_IMAGE.test(base)) return null
  if (data.includes(0)) return 'a file holding a NUL byte'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return 'a file that is not UTF-8'
  }
  if (data.subarray(0, 2).toString('latin1') === '#!') return 'a file starting with #!'
  if (!POLICY_TEXT.test(base) && !POLICY_PLAIN_NAMES.includes(base)) return 'a file outside the allowed types'
  return null
}

/**
 * The directory's six `LOCAL_CODE_*` refusals over `files` (`{ path, data }`)
 * and the manifests (`{ plugin, hooksFiles: [{ path, json }] }`), held against
 * `inventory`: every undeclared file or grant by code and path, every declared
 * place or grant path that holds nothing as stale, every count that differs
 * with expected and actual (spec distribution/npm-package "The bundle's
 * local-code inventory SHALL be declared…").
 */
function directoryPolicyProblems(files, manifests, inventory) {
  const problems = []
  const hooksFiles = manifests.hooksFiles || []
  const actual = {
    hooks: hookEntries(manifests.plugin?.hooks).length + hooksFiles.reduce((n, f) => n + hookEntries(f.json?.hooks).length, 0),
    hooksModules:
      (Array.isArray(manifests.plugin?.modules) ? manifests.plugin.modules.length : 0) +
      hooksFiles.reduce((n, f) => n + (Array.isArray(f.json?.modules) ? f.json.modules.length : 0), 0),
    hooksFilesNamingModule: hooksFiles.filter(f => Array.isArray(f.json?.modules) && f.json.modules.length > 0).length,
    workflowScripts: files.filter(f => /^workflows\/[^/]+\.js$/.test(f.path)).length,
    workflowsKey: manifests.plugin && 'workflows' in manifests.plugin ? 1 : 0
  }
  const codes = {
    hooks: 'LOCAL_CODE_HOOK_COMMAND',
    hooksModules: 'LOCAL_CODE_MOD',
    hooksFilesNamingModule: 'LOCAL_CODE_NOT_READ',
    workflowScripts: 'LOCAL_CODE_WORKFLOW',
    workflowsKey: 'LOCAL_CODE_WORKFLOW'
  }
  for (const [name, code] of Object.entries(codes)) {
    if (actual[name] !== inventory.counts[name]) problems.push(`${code}: ${name} expected ${inventory.counts[name]}, actual ${actual[name]}`)
  }

  const held = new Set()
  for (const { path, data } of files) {
    const reason = fileTypeReason(path, data)
    if (!reason) continue
    const place = inventory.fileTypePlaces.find(p => path.startsWith(p))
    if (place) held.add(place)
    else problems.push(`LOCAL_CODE_FILE_TYPE: ${path} is ${reason}, in a place the inventory does not declare`)
  }
  for (const place of inventory.fileTypePlaces) {
    if (!held.has(place)) problems.push(`LOCAL_CODE_FILE_TYPE: ${place} is declared but nothing outside the allowed types ships there (a stale declaration)`)
  }

  const granting = new Set()
  for (const { path, data } of files) {
    if (!/^skills\/[^/]+\/SKILL\.md$|^agents\/[^/]+\.md$|^commands\/[^/]+\.md$/.test(path)) continue
    const beyond = frontmatterGrants(data.toString('utf8')).filter(grantsBeyondPlain)
    if (beyond.length === 0) continue
    granting.add(path)
    if (!inventory.toolGrantPaths.includes(path)) {
      problems.push(`LOCAL_CODE_TOOL_GRANT: ${path} grants ${beyond.join(' ')}, beyond Read, Grep, Glob and LS, and the inventory does not declare it`)
    }
  }
  for (const path of inventory.toolGrantPaths) {
    if (!granting.has(path)) problems.push(`LOCAL_CODE_TOOL_GRANT: ${path} is declared but grants nothing beyond Read, Grep, Glob and LS (a stale declaration)`)
  }
  return problems
}

/** The shipped file set with each file's bytes, and the manifests the policy reads. */
function shippedBundle() {
  const files = shippedFiles(ROOT, pkg.files).map(e => ({ path: e.path, data: readFileSync(join(ROOT, e.path)) }))
  const hooksFiles = files.filter(f => /(?:^|\/)hooks\.json$/.test(f.path)).map(f => ({ path: f.path, json: JSON.parse(f.data.toString('utf8')) }))
  return { files, manifests: { plugin: readJson(PLUGIN_PATH), hooksFiles } }
}

test('the bundle\'s local code is the declared inventory: counts, places and grant paths', () => {
  const { files, manifests } = shippedBundle()
  const problems = directoryPolicyProblems(files, manifests, DIRECTORY_INVENTORY)
  assert.deepEqual(problems, [], `the shipped bundle differs from DIRECTORY_INVENTORY:\n  ${problems.join('\n  ')}`)
})

const buf = text => Buffer.from(text, 'utf8')
const EMPTY_INVENTORY = Object.freeze({
  counts: Object.freeze({ hooks: 0, hooksModules: 0, hooksFilesNamingModule: 0, workflowScripts: 0, workflowsKey: 0 }),
  fileTypePlaces: Object.freeze([]),
  toolGrantPaths: Object.freeze([])
})
const PROSE_ONLY = Object.freeze([
  { path: 'README.md', data: buf('# x\n') },
  { path: 'LICENSE', data: buf('MIT License\n') },
  { path: '.gitignore', data: buf('node_modules\n') },
  { path: 'assets/icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]) },
  { path: 'skills/a/SKILL.md', data: buf('---\nname: a\nallowed-tools: Read Grep Glob LS\n---\nbody\n') },
  { path: 'agents/b.md', data: buf('---\nname: b\ntools: Read, Grep, Glob, LS\n---\n') },
  { path: 'package.json', data: buf('{}\n') }
])
const PROSE_MANIFESTS = Object.freeze({ plugin: { name: 'x' }, hooksFiles: [] })

test('the directory detector passes a bundle with no local code against an empty inventory', () => {
  assert.deepEqual(directoryPolicyProblems(PROSE_ONLY, PROSE_MANIFESTS, EMPTY_INVENTORY), [])
})

test('the directory detector names a new command hook, a hooks module, a workflow and a non-command hook by code', () => {
  const plugin = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'x' }, { type: 'http', url: 'https://x' }] }] }, workflows: './workflows' }
  const hooksFiles = [{ path: 'hooks/hooks.json', json: { hooks: {}, modules: ['./mod.mjs'] } }]
  const files = [...PROSE_ONLY, { path: 'workflows/ship.js', data: buf('export default 1\n') }]
  const problems = directoryPolicyProblems(files, { plugin, hooksFiles }, EMPTY_INVENTORY)
  for (const wanted of [
    'LOCAL_CODE_HOOK_COMMAND: hooks expected 0, actual 2',
    'LOCAL_CODE_MOD: hooksModules expected 0, actual 1',
    'LOCAL_CODE_NOT_READ: hooksFilesNamingModule expected 0, actual 1',
    'LOCAL_CODE_WORKFLOW: workflowScripts expected 0, actual 1',
    'LOCAL_CODE_WORKFLOW: workflowsKey expected 0, actual 1'
  ]) {
    assert.ok(problems.includes(wanted), `${wanted} is not among:\n${problems.join('\n')}`)
  }
  assert.ok(problems.some(p => p.startsWith('LOCAL_CODE_FILE_TYPE: workflows/ship.js ')), problems.join('\n'))
})

test('the directory detector names a tool grant beyond the four plain tools, with the path that makes it', () => {
  const skill = grant => ({ path: 'skills/foo/SKILL.md', data: buf(`---\nname: foo\nallowed-tools: ${grant}\n---\n`) })
  const beyond = ['WebFetch', 'Read Bash(git *)', 'Read(//etc/**)', 'Read(\\\\host\\share)', 'Read(${HOME}/x)', 'Read(https://example.com/x)', 'Write']
  for (const grant of beyond) {
    const problems = directoryPolicyProblems([skill(grant)], PROSE_MANIFESTS, EMPTY_INVENTORY)
    assert.ok(problems.some(p => p.startsWith('LOCAL_CODE_TOOL_GRANT: skills/foo/SKILL.md grants ')), `${grant}: ${problems.join(' | ')}`)
  }
  for (const grant of ['Read Grep Glob LS', 'Read(./docs/**) Grep', 'Read, Grep, Glob']) {
    assert.deepEqual(directoryPolicyProblems([skill(grant)], PROSE_MANIFESTS, EMPTY_INVENTORY), [], grant)
  }
  // A YAML list and an agent's `tools` line count too.
  const list = { path: 'agents/x.md', data: buf('---\nname: x\ntools:\n  - Read\n  - Bash\n---\n') }
  assert.equal(directoryPolicyProblems([list], PROSE_MANIFESTS, EMPTY_INVENTORY).length, 1)
  // Declared, it passes; declared and not granting, it is stale.
  const declared = { ...EMPTY_INVENTORY, toolGrantPaths: ['skills/foo/SKILL.md'] }
  assert.deepEqual(directoryPolicyProblems([skill('WebFetch')], PROSE_MANIFESTS, declared), [])
  assert.deepEqual(directoryPolicyProblems([skill('Read')], PROSE_MANIFESTS, declared), [
    'LOCAL_CODE_TOOL_GRANT: skills/foo/SKILL.md is declared but grants nothing beyond Read, Grep, Glob and LS (a stale declaration)'
  ])
})

test('the directory detector names a file outside the allowed types in an undeclared place, and a declared place that is empty', () => {
  const script = { path: 'skills/foo/run.mjs', data: buf('export {}\n') }
  const problems = directoryPolicyProblems([...PROSE_ONLY, script], PROSE_MANIFESTS, EMPTY_INVENTORY)
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0], /^LOCAL_CODE_FILE_TYPE: skills\/foo\/run\.mjs /)
  const stale = directoryPolicyProblems(PROSE_ONLY, PROSE_MANIFESTS, { ...EMPTY_INVENTORY, fileTypePlaces: ['types/'] })
  assert.deepEqual(stale, ['LOCAL_CODE_FILE_TYPE: types/ is declared but nothing outside the allowed types ships there (a stale declaration)'])
})

test('the directory detector counts a #! text in its declared place, and allows a plain-text license and a new module under a declared place', () => {
  const inventory = { ...EMPTY_INVENTORY, fileTypePlaces: ['cli/', 'lib/'] }
  const files = [
    ...PROSE_ONLY,
    { path: 'cli/interlock', data: buf('#!/usr/bin/env node\nconsole.log(1)\n') },
    { path: 'lib/a.mjs', data: buf('export {}\n') },
    { path: 'lib/new-module.mjs', data: buf('export {}\n') }
  ]
  assert.deepEqual(directoryPolicyProblems(files, PROSE_MANIFESTS, inventory), [])
})

test('the directory detector names a package-manager configuration file, a #! in a text type, a NUL byte and non-UTF-8 text', () => {
  const named = file => directoryPolicyProblems([...PROSE_ONLY, file], PROSE_MANIFESTS, EMPTY_INVENTORY)
  const cases = [
    { path: 'pnpm-workspace.yaml', data: buf('packages: []\n') },
    { path: 'notes.md', data: buf('#!/bin/sh\n') },
    { path: 'data.json', data: Buffer.from([0x7b, 0x00, 0x7d]) },
    { path: 'notes.txt', data: Buffer.from([0xff, 0xfe, 0x41]) },
    { path: 'run.sh', data: buf('echo\n') },
    { path: 'LICENSE.exe', data: buf('MZ\n') }
  ]
  for (const file of cases) {
    const problems = named(file)
    assert.equal(problems.length, 1, `${file.path}: ${problems.join(' | ')}`)
    assert.ok(problems[0].startsWith(`LOCAL_CODE_FILE_TYPE: ${file.path} `), problems[0])
  }
  // A plain-text license with no #! and an image with any bytes are allowed.
  assert.deepEqual(named({ path: 'docs/pic.webp', data: Buffer.from([0xff, 0, 1]) }), [])
})

test('the directory detector names a count that differs, with the expected and the actual', () => {
  const problems = directoryPolicyProblems(PROSE_ONLY, PROSE_MANIFESTS, { ...EMPTY_INVENTORY, counts: { ...EMPTY_INVENTORY.counts, hooks: 3 } })
  assert.deepEqual(problems, ['LOCAL_CODE_HOOK_COMMAND: hooks expected 3, actual 0'])
})

/**
 * Where each `userConfig` option is referenced in the manifest, and the shipped
 * files other than the manifest that spell an option reference. A sensitive
 * option may reach only an MCP or LSP server's `env` or `headers`: hook args
 * trip the directory's hook-command rule, and a hook that reads the option from
 * its environment is the credential read this hold is about. An option nothing
 * references is a value the person is asked for and that goes nowhere.
 */
function sensitiveOptionProblems(manifest, entries = []) {
  const problems = []
  const options = manifest && typeof manifest.userConfig === 'object' && manifest.userConfig ? manifest.userConfig : {}
  const refs = new Map(Object.keys(options).map(key => [key, []]))
  const visit = (value, path) => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)) {
        if (!refs.has(m[1])) problems.push(`${path.join('.')} references ${m[1]}, which userConfig does not declare`)
        else refs.get(m[1]).push(path)
      }
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, [...path, k])
    }
  }
  for (const [key, value] of Object.entries(manifest || {})) if (key !== 'userConfig') visit(value, [key])
  const serverField = path =>
    (path[0] === 'mcpServers' || path[0] === 'lspServers') && path.length >= 4 && (path[2] === 'env' || path[2] === 'headers')
  for (const [key, paths] of refs) {
    if (!paths.length) problems.push(`${key} is declared and never referenced`)
    if (options[key] && options[key].sensitive === true) {
      for (const path of paths.filter(p => !serverField(p))) {
        problems.push(`${key} is sensitive and reaches ${path.join('.')}: only an MCP or LSP server's env or headers may take it`)
      }
    }
  }
  for (const { path, text } of entries) {
    if (path !== '.claude-plugin/plugin.json' && text.includes('${user_config.')) problems.push(`${path} spells an option reference`)
  }
  return problems
}

test('no shipped file names a credential variable, a credential file or the host\'s option variables', () => {
  const problems = credentialNameProblems(shippedTexts())
  assert.deepEqual(problems, [], `these shipped files spell a credential name:\n  ${problems.join('\n  ')}`)
})

test('the credential pin names each name it finds, and passes a file that spells none', () => {
  assert.deepEqual(
    credentialNameProblems([
      { path: 'README.md', text: 'set GITHUB_TOKEN, then read CLAUDE_PLUGIN_OPTION_TOKEN' },
      { path: 'CHANGELOG.md', text: 'the doctor read ANTHROPIC_API_KEY' },
      { path: 'lib/a.mjs', text: "const v = env['INTERLOCK_NTFY_TOPIC']" },
      { path: 'lib/b.mjs', text: 'nothing to see' }
    ]),
    ['README.md: GITHUB_TOKEN, CLAUDE_PLUGIN_OPTION_', 'CHANGELOG.md: ANTHROPIC_API_KEY', 'lib/a.mjs: INTERLOCK_NTFY_']
  )
})

test('the changelog does not ship', () => {
  // The directory reads shipped prose as evidence (its 1.6.0 report cited
  // "CHANGELOG.md: host"), and the changelog names what earlier versions read.
  // The repository keeps it; the bundle does not carry it.
  assert.ok(!pkg.files.some(entry => entry.replace(/^\.\//, '') === 'CHANGELOG.md'), '"files" lists CHANGELOG.md again')
  assert.ok(!shippedFiles(ROOT, pkg.files).some(e => e.path === 'CHANGELOG.md'), 'CHANGELOG.md is in the shipped file set')
})

test('no shipped file carries the removed push', () => {
  const problems = pushResidueProblems(shippedTexts())
  assert.deepEqual(problems, [], `the removed push is still named in:\n  ${problems.join('\n  ')}`)
})

test('the residue pin names a relay, an option hook and the retired cap, and passes the checkpoint marker', () => {
  assert.deepEqual(
    pushResidueProblems([
      { path: 'README.md', text: 'push to the NTFY server' },
      { path: 'hooks/x.mjs', text: "import('./notify-option.mjs')" },
      { path: 'lib/limits.mjs', text: "['push timeout (ms)', LIMITS.notifyTimeoutMs]" },
      { path: 'skills/spec/SKILL.md', text: 'interlock notify checkpoint "<change-name>"' }
    ]),
    ['README.md: ntfy', 'hooks/x.mjs: notify-option', 'lib/limits.mjs: notifyTimeoutMs, push timeout']
  )
})

test('no shipped code opens a network connection', () => {
  const problems = networkProblems(shippedTexts())
  assert.deepEqual(problems, [], `these shipped files can reach the network:\n  ${problems.join('\n  ')}`)
})

test('the network check names a fetch, each import form, a require and a socket, and leaves argv words alone', () => {
  const shebang = '#!/usr/bin/env node\n'
  assert.deepEqual(
    networkProblems([
      { path: 'lib/a.mjs', text: 'const r = await fetch(url)' },
      { path: 'lib/b.mjs', text: "import { request } from 'node:https'" },
      { path: 'lib/c.mjs', text: "const net = await import('net')" },
      { path: 'lib/d.cjs', text: "const { Agent } = require('undici')" },
      { path: 'cli/tool', text: `${shebang}const ws = new WebSocket(url)` },
      { path: 'lib/e.mjs', text: 'const f = globalThis.fetch' },
      { path: 'lib/f.mjs', text: "spawnSync('git', ['fetch', 'origin']); // git fetch, never ours; also obj.fetch(x)" },
      { path: 'lib/g.mjs', text: "import { readFileSync } from 'node:fs'" },
      { path: 'README.md', text: 'call fetch(url) in your own code' }
    ]),
    [
      'lib/a.mjs: a fetch call',
      'lib/b.mjs: a network module import',
      'lib/c.mjs: a network module import',
      'lib/d.cjs: a network module require',
      'cli/tool: a socket or request constructor',
      'lib/e.mjs: a fetch call'
    ]
  )
})

test('a sensitive option reaches only a server\'s env or headers, and only the manifest spells an option reference', () => {
  const problems = sensitiveOptionProblems(readJson(PLUGIN_PATH), shippedTexts())
  assert.deepEqual(problems, [], `the manifest hands an option where it must not go:\n  ${problems.join('\n  ')}`)
})

test('the option check names hook args, an unused option, an undeclared reference and a file outside the manifest', () => {
  const token = { type: 'string', title: 'Token', description: 'A token.', sensitive: true }
  const hookArgs = {
    userConfig: { token },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: ['x.mjs', '${user_config.token}'] }] }] }
  }
  assert.deepEqual(sensitiveOptionProblems(hookArgs), [
    "token is sensitive and reaches hooks.SessionStart.0.hooks.0.args.1: only an MCP or LSP server's env or headers may take it"
  ])
  assert.deepEqual(sensitiveOptionProblems({ userConfig: { token } }), ['token is declared and never referenced'])
  const server = { userConfig: { token }, mcpServers: { api: { command: 'node', args: ['s.mjs'], env: { API_TOKEN: '${user_config.token}' } } } }
  assert.deepEqual(sensitiveOptionProblems(server), [])
  const headers = { userConfig: { token }, mcpServers: { api: { type: 'http', url: 'https://example.invalid', headers: { Authorization: 'Bearer ${user_config.token}' } } } }
  assert.deepEqual(sensitiveOptionProblems(headers), [])
  assert.deepEqual(sensitiveOptionProblems({ mcpServers: { api: { env: { X: '${user_config.other}' } } } }), [
    'mcpServers.api.env.X references other, which userConfig does not declare'
  ])
  assert.deepEqual(sensitiveOptionProblems(server, [{ path: 'hooks/a.mjs', text: 'reads ${user_config.token}' }]), [
    'hooks/a.mjs spells an option reference'
  ])
})

// ---------------------------------------------------------------------------
// The bundle's shape: no top-level bin/, no compiled executable, no install-time
// download (spec: distribution/npm-package). The directory holds a plugin for a
// reviewer on `BUNDLES_BINARIES`, which covers files in bin/, compiled executables
// elsewhere in the plugin and a `binaries` key in plugin.json, and a lockfile at the
// root is one the host installs when the plugin is.
// ---------------------------------------------------------------------------

/** The first bytes of a compiled executable, by format. */
const EXECUTABLE_SIGNATURES = [
  ['ELF', [0x7f, 0x45, 0x4c, 0x46]],
  ['Mach-O', [0xfe, 0xed, 0xfa, 0xce]],
  ['Mach-O', [0xfe, 0xed, 0xfa, 0xcf]],
  ['Mach-O', [0xce, 0xfa, 0xed, 0xfe]],
  ['Mach-O', [0xcf, 0xfa, 0xed, 0xfe]],
  ['Mach-O', [0xca, 0xfe, 0xba, 0xbe]],
  ['PE', [0x4d, 0x5a]]
]
const ROOT_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb']

/** The format whose signature `head` begins with, or null. */
function executableFormat(head) {
  const bytes = Buffer.from(head || [])
  const hit = EXECUTABLE_SIGNATURES.find(([, sig]) => bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b))
  return hit ? hit[0] : null
}

/**
 * What is wrong with a bundle's shape, named. Pure: `entries` are `{ path, head }` (the
 * first bytes of each shipped file), `bin` is package.json's `bin` map and `manifest`
 * is plugin.json.
 */
function bundleShapeProblems({ entries, bin, manifest }) {
  const problems = []
  for (const { path, head } of entries) {
    if (path.split('/')[0] === 'bin') problems.push(`${path} is under a top-level bin/`)
    const format = executableFormat(head)
    if (format) problems.push(`${path} is a compiled executable (${format})`)
    if (!path.includes('/') && ROOT_LOCKFILES.includes(path)) problems.push(`${path} is a lockfile at the bundle root, which the host installs with the plugin`)
  }
  for (const [name, target] of Object.entries(bin || {})) {
    if (!/^(?:\.\/)?cli\//.test(String(target))) problems.push(`bin.${name} points at ${target}, outside cli/`)
  }
  if (manifest && Object.hasOwn(manifest, 'binaries')) problems.push('.claude-plugin/plugin.json declares binaries')
  return problems
}

/** The first four bytes of a shipped file. */
function headOf(root, path) {
  const buf = readFileSync(join(root, path))
  return buf.subarray(0, 4)
}

test('the bundle as shipped has no top-level bin/, no compiled executable, no binaries key and no root lockfile', () => {
  const shipped = shippedFiles(ROOT, pkg.files)
  const entries = shipped.map(({ path }) => ({ path, head: headOf(ROOT, path) }))
  const problems = bundleShapeProblems({ entries, bin: pkg.bin, manifest: readJson(PLUGIN_PATH) })
  assert.deepEqual(problems, [], `the directory holds a plugin for a reviewer on:\n  ${problems.join('\n  ')}`)
  for (const name of ['interlock', 'interlock-graph', 'interlock-run', 'interlock-ship-acp']) {
    assert.equal(pkg.bin[name], `cli/${name}`, `bin.${name} must point under cli/`)
    assert.ok(readFileSync(join(ROOT, `cli/${name}`), 'utf8').startsWith('#!/usr/bin/env node'), `cli/${name} must start with #!/usr/bin/env node`)
    assert.ok((statSync(join(ROOT, `cli/${name}`)).mode & 0o111) !== 0, `cli/${name} must be executable`)
  }
})

test('the shape check names a file under bin/, a bin entry outside cli/, each executable format, a binaries key and each root lockfile', () => {
  const text = Buffer.from('export const x = 1\n')
  const clean = [
    { path: 'cli/interlock', head: Buffer.from('#!/u') },
    { path: 'lib/openspec-pin.mjs', head: text },
    { path: 'package.json', head: Buffer.from('{\n  ') }
  ]
  const cleanBin = { interlock: 'cli/interlock' }
  assert.deepEqual(bundleShapeProblems({ entries: clean, bin: cleanBin, manifest: {} }), [])

  const one = (entries, bin = cleanBin, manifest = {}) => bundleShapeProblems({ entries: [...clean, ...entries], bin, manifest })

  assert.deepEqual(one([{ path: 'bin/interlock', head: Buffer.from('#!/u') }]), ['bin/interlock is under a top-level bin/'])
  assert.deepEqual(one([{ path: 'bin', head: text }]), ['bin is under a top-level bin/'])
  assert.deepEqual(one([{ path: 'lib/bin/helper', head: text }]), [], 'only a top-level bin/ counts')

  assert.deepEqual(one([], { interlock: 'bin/interlock' }), ['bin.interlock points at bin/interlock, outside cli/'])
  assert.deepEqual(one([], { interlock: 'lib/interlock' }), ['bin.interlock points at lib/interlock, outside cli/'])
  assert.deepEqual(one([], { interlock: './cli/interlock' }), [])

  for (const [format, sig] of EXECUTABLE_SIGNATURES) {
    const head = Buffer.from([...sig, 0x00, 0x00])
    assert.deepEqual(one([{ path: 'lib/vendor/tool', head }]), [`lib/vendor/tool is a compiled executable (${format})`], `${format} ${sig}`)
  }
  assert.deepEqual(one([{ path: 'lib/vendor/short', head: Buffer.from([0x7f, 0x45]) }]), [], 'a truncated signature is not one')

  assert.deepEqual(one([], cleanBin, { name: 'interlock', binaries: {} }), ['.claude-plugin/plugin.json declares binaries'])

  for (const name of ROOT_LOCKFILES) {
    assert.match(one([{ path: name, head: text }]).join('\n'), new RegExp(`^${name.replace('.', '\\.')} is a lockfile at the bundle root`))
  }
  // A lockfile carried as data inside a module, or beside a fixture, is not a root lockfile.
  assert.deepEqual(one([{ path: 'lib/openspec-pin.mjs', head: Buffer.from('{ "lo') }, { path: 'test/fixtures/package-lock.json', head: text }]), [])
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
    ...['skills', 'agents', 'shared', 'workflows', 'hooks', 'lib', 'cli'].flatMap(d => walk(join(root, d)))
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

// An untracked workflow never runs on the remote, and plugin users would
// silently stop receiving releases. (Only copilot-setup-steps.yml in that
// directory is gitignored.) Where
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
      `${workflow} is not tracked, so it never runs on the remote. Restore it with \`git add ${workflow}\`.`
    )
  }
})
