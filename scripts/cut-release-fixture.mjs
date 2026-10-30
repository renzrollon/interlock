#!/usr/bin/env node
// Cut a snapshot of the run state a released CLI writes, for the upgrade tests.
//
// Development tooling only. `scripts/` is not in package.json `files`, so this
// never ships. test/spine/upgrade-fixtures.test.mjs copies every
// test/fixtures/ship/release-<version>/ it finds into a fresh root and feeds it
// to the CURRENT CLI, so a run left behind by release N-1 is proved to resume
// under release N, or be refused by name, rather than assumed to.
//
// What it does (design D24):
//   1. `git archive <tag> <cli dir> lib package.json` into a scratch directory.
//      That is the whole CLI: zero runtime dependencies, so nothing else is
//      needed. The CLI's directory is read from the tag's own package.json
//      `bin` map, because tags cut before the move to `cli/` hold it in `bin/`.
//   2. Build a scratch repository holding one fixed change.
//   3. Drive that old CLI by hand, the way a host would, with every agent
//      answered by a canned result: `run start` -> `run classified` (a
//      hand-written classification) -> `run record-batch` (one task ok, the
//      rest not attempted) -> `run close --halt fixture`.
//   4. Copy `.claude/ship/`, the change and the file its tasks name into
//      test/fixtures/ship/release-<version>/, with every absolute scratch path
//      replaced by the token ${ROOT}. The test substitutes the token back.
//
// No model and no network. The old CLI runs from the scratch directory with
// the ntfy topic emptied, so it notifies nobody, and with INTERLOCK_STATE_HOME
// unset, so its corpora land in the scratch repository and nowhere else.
//
// The script refuses to write a fixture that still holds a machine path: it
// scans the output for the same shapes the test does and exits 1 naming the
// file. It needs `git` and `tar` on PATH.
//
// Usage:
//   node scripts/cut-release-fixture.mjs <tag>                 cut release-<version>
//   node scripts/cut-release-fixture.mjs <tag> --out <dir>     write somewhere else (an empty
//                                                              directory or a previous cut; it is replaced)
//   node scripts/cut-release-fixture.mjs <tag> --keep          keep the scratch directory
//   node scripts/cut-release-fixture.mjs <tag> --verbose       print every step the CLI named
//
// Re-cut at each release bump (CONTRIBUTING.md); the old fixtures stay.

import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
export const TOKEN = '${ROOT}'

/** The change the scratch repository holds. Fixed, so a re-cut differs only where the CLI does. */
export const CHANGE = 'fixture-change'

/** Files larger than this are dropped: the tests read none of them and the repository should not carry them. */
export const MAX_FILE_BYTES = 256 * 1024

/** The tasks the fixture change declares, and the paths each one touches. */
export const TASKS = [
  { id: '1.1', description: 'first task', path: 'src/first.mjs' },
  { id: '1.2', description: 'second task', path: 'src/second.mjs' }
]

const die = message => {
  process.stderr.write(`cut-release-fixture: ${message}\n`)
  process.exit(1)
}

// --- plumbing -----------------------------------------------------------------

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function write(root, path, body) {
  const dest = join(root, path)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
  return dest
}

/** Every regular file under `dir`, as absolute paths. */
function filesUnder(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(abs))
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

/**
 * Where a machine path would show: a scratch directory, a macOS temp directory,
 * or a home directory. Mirrors the scan in test/spine/upgrade-fixtures.test.mjs.
 */
export function machinePathsIn(text) {
  const found = new Set()
  const patterns = [/\/tmp\//g, /\/private\//g, /\/var\/folders\//g, /\/Users\/[A-Za-z0-9._-]+/g, /\/home\/[A-Za-z0-9._-]+/g]
  for (const re of patterns) for (const m of text.matchAll(re)) found.add(m[0])
  const home = homedir()
  if (home && home !== '/' && text.includes(home)) found.add(home)
  return [...found]
}

/**
 * Replace each absolute path in `paths` by the token, longest first, so a path
 * that contains another is not half-rewritten. A trailing slash is not part of a
 * path, so `${ROOT}/x` and a bare `${ROOT}` both come out right.
 */
export function tokenise(text, paths) {
  let out = text
  const ordered = [...new Set(paths)].filter(p => p && p !== '/').sort((a, b) => b.length - a.length)
  for (const p of ordered) out = out.split(p).join(TOKEN)
  return out
}

/**
 * Why `outDir` may not be written, or null when it may. `copyOut` removes the
 * directory it is given before it writes, so a mistyped `--out` must be refused
 * here, before anything runs: the filesystem root, the home directory, the
 * repository root or anything above it, a path that is a file, and an existing
 * directory that holds something other than a previous cut. A previous cut is
 * recognised by the change it always holds, `openspec/changes/${CHANGE}`.
 */
export function outDirRefusal(outDir, { repo = REPO, home = homedir() } = {}) {
  const real = path => {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }
  const target = real(outDir)
  const within = (inner, outer) => {
    const rel = relative(outer, inner)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }
  if (target === dirname(target)) return `--out resolves to the filesystem root (${target})`
  if (home && target === real(home)) return `--out resolves to the home directory (${target})`
  if (within(real(repo), target)) return `--out resolves to the repository root or a directory above it (${target})`
  const info = statSync(target, { throwIfNoEntry: false })
  if (!info) return null
  if (!info.isDirectory()) return `--out names an existing file, not a directory (${target})`
  if (readdirSync(target).length === 0) return null
  if (existsSync(join(target, 'openspec', 'changes', CHANGE))) return null
  return `--out is a non-empty directory that does not look like a previous cut (no openspec/changes/${CHANGE}): ${target}`
}

/** The version a tag names: `v1.7.0` -> `1.7.0`. */
export function versionOfTag(tag) {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(tag)
  return m ? m[1] : null
}

// --- the old CLI -----------------------------------------------------------------

/**
 * The path of the `interlock` executable as `tag`'s own package.json `bin` map
 * names it: `bin/interlock` before the move to `cli/`, `cli/interlock` after.
 */
export function cliPathOfManifest(manifest) {
  const bin = manifest && manifest.bin
  const target = typeof bin === 'string' ? bin : bin && typeof bin === 'object' ? bin.interlock : null
  if (typeof target !== 'string' || !target) return null
  const rel = target.replace(/^\.\//, '')
  if (isAbsolute(rel) || rel.split('/').includes('..') || !rel.includes('/')) return null
  return rel
}

/**
 * Extract the CLI's directory, `lib` and `package.json` as of `tag` into `dest`.
 * Returns the executable's path relative to `dest`, as the tag's `bin` map names it.
 */
function extractCli(tag, dest) {
  mkdirSync(dest, { recursive: true })
  const shown = spawnSync('git', ['show', `${tag}:package.json`], { cwd: REPO, encoding: 'utf8' })
  if (shown.status !== 0) {
    die(`git show ${tag}:package.json failed: ${String(shown.stderr || shown.error || '').trim() || 'is the tag present locally? try git fetch --tags'}`)
  }
  let manifest
  try {
    manifest = JSON.parse(shown.stdout)
  } catch (err) {
    die(`${tag}'s package.json is not JSON: ${err.message}`)
  }
  const cliPath = cliPathOfManifest(manifest)
  if (!cliPath) die(`${tag}'s package.json names no interlock entry in its bin map`)
  const cliDir = cliPath.split('/')[0]
  const archive = spawnSync('git', ['archive', tag, cliDir, 'lib', 'package.json'], {
    cwd: REPO,
    maxBuffer: 256 * 1024 * 1024
  })
  if (archive.status !== 0) {
    die(`git archive ${tag} failed: ${String(archive.stderr || archive.error || '').trim() || 'is the tag present locally? try git fetch --tags'}`)
  }
  const untar = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout })
  if (untar.status !== 0) die(`tar could not unpack the archive: ${String(untar.stderr || untar.error || '').trim()}`)
  if (!existsSync(join(dest, cliPath))) die(`${tag} holds no ${cliPath}`)
  return cliPath
}

/** The scratch repository: one change, its tasks, and the files they name. */
function buildRepo(root) {
  git(root, 'init', '-q', '.')
  git(root, 'config', 'user.email', 'fixture@example.com')
  git(root, 'config', 'user.name', 'fixture')
  const base = `openspec/changes/${CHANGE}`
  write(root, `${base}/.openspec.yaml`, 'schema: spec-driven\n')
  write(root, `${base}/proposal.md`, '# Fixture change\n\n## Why\n\nA frozen change for the upgrade tests.\n')
  write(root, `${base}/design.md`, '# Design\n\nD1: nothing real is built.\n')
  write(root, `${base}/tasks.md`, ['# Tasks', '', '## 1. Work', '', ...TASKS.map(t => `- [ ] ${t.id} ${t.description}`), ''].join('\n'))
  write(root, 'README.md', 'fixture repository\n')
  for (const t of TASKS) write(root, t.path, `// ${t.description}\n`)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'fixture: initial')
}

/** Run the extracted CLI in `root`. Never throws: the exit code is part of the answer. */
function makeCli({ cliBin, root, verbose }) {
  const env = { ...process.env, INTERLOCK_NTFY_TOPIC: '' }
  delete env.INTERLOCK_STATE_HOME
  delete env.CLAUDE_PLUGIN_ROOT
  return (args, { input } = {}) => {
    const full = [...args]
    if (input !== undefined) {
      write(root, '.claude/ship/results.json', input)
      full.push('--results', '.claude/ship/results.json')
    }
    const r = spawnSync(process.execPath, [cliBin, ...full], { cwd: root, encoding: 'utf8', env })
    if (r.error) die(`could not spawn the old CLI: ${r.error.message}`)
    let json = null
    try {
      json = r.stdout.trim() ? JSON.parse(r.stdout) : null
    } catch {
      json = null
    }
    if (verbose) {
      process.stderr.write(`$ interlock ${full.join(' ')}\n  exit ${r.status}  action ${json && json.action}\n`)
    }
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json }
  }
}

const classification = () => ({
  tasks: TASKS.map(t => ({
    id: t.id,
    group: 1,
    description: t.description,
    tier: 2,
    model: 'sonnet',
    isTestTask: false,
    paths: [t.path]
  }))
})

const handoff = (id, status) => ({
  schema: 'interlock.wave-handoff/1',
  taskId: id,
  status,
  summary: status === 'ok' ? 'done' : 'not reached',
  evidence: status === 'ok' ? ['README.md:1'] : [],
  next: 'nothing',
  blocker: status === 'ok' ? null : 'the lane stopped before this task'
})

/**
 * The batch results a host would send: the first task of the first lane `ok`,
 * every other task `not-attempted`. The old CLI folds a not-attempted task into
 * the wave without charging it as a failure, which is the state a run is in
 * when it halts mid-chain.
 */
function batchResults(step) {
  const lanes = Array.isArray(step.lanes) ? step.lanes : []
  const spawns = Array.isArray(step.spawns) ? step.spawns : []
  let first = true
  return spawns.map((_, i) => ({
    tasks: (lanes[i] || []).map(t => {
      const id = String(t.id)
      if (first) {
        first = false
        return { id, outcome: 'ok', filesChanged: [TASKS.find(x => x.id === id)?.path || 'README.md'], handoff: handoff(id, 'ok') }
      }
      return { id, outcome: 'not-attempted' }
    })
  }))
}

/**
 * start -> classified -> record-batch -> halted close, each call exactly the argv
 * the previous step named. Returns the close step.
 */
function driveRun(cli, root) {
  const started = cli(['run', 'start', '--change', CHANGE, '--json'])
  if (!started.json) die(`run start printed no step (exit ${started.code})\n${started.stdout}\n${started.stderr}`)
  if (started.json.action !== 'classify') die(`run start answered '${started.json.action}', not 'classify': ${started.json.reason || started.stdout.slice(0, 300)}`)

  write(root, '.claude/ship/classified.json', classification())
  const planned = cli([...started.json.then.argv, '--json'])
  if (!planned.json || planned.json.action !== 'run-batch') {
    die(`run classified answered '${planned.json && planned.json.action}', not 'run-batch': ${(planned.json && planned.json.reason) || planned.stdout.slice(0, 300) || planned.stderr}`)
  }

  const results = batchResults(planned.json)
  const attempted = results.flatMap(r => r.tasks)
  if (!attempted.some(t => t.outcome === 'ok') || !attempted.some(t => t.outcome === 'not-attempted')) {
    die(`the first batch holds ${attempted.length} task(s); the fixture needs one ok and one not attempted. Lanes: ${JSON.stringify(planned.json.lanes)}`)
  }
  const recorded = cli([...planned.json.then.argv, '--json'], { input: results })
  if (!recorded.json) die(`run record-batch printed no step (exit ${recorded.code})\n${recorded.stdout}\n${recorded.stderr}`)

  // Halt here, whatever the program named next: the snapshot is a run that
  // stopped part-way, which is what an upgrade meets.
  const closed = cli(['run', 'close', '--halt', 'fixture', '--json'])
  if (!closed.json) die(`run close printed no step (exit ${closed.code})\n${closed.stdout}\n${closed.stderr}`)
  return closed
}

// --- the copy ----------------------------------------------------------------------

/**
 * Copy what the tests read out of the scratch repository into `outDir`, rewriting
 * every scratch path to the token. Returns the files dropped for size.
 */
function copyOut({ root, scratch, outDir }) {
  const real = path => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
  // The repository root as the CLI saw it (realpath) and as mkdtemp named it,
  // then the scratch directory above both (the extracted CLI lives there).
  const paths = [root, real(root), join(scratch, 'cli'), real(join(scratch, 'cli')), scratch, real(scratch)]

  const sources = [
    ['.claude/ship', '.claude/ship'],
    [`openspec/changes/${CHANGE}`, `openspec/changes/${CHANGE}`],
    ...TASKS.map(t => [t.path, t.path]),
    ['README.md', 'README.md']
  ]

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  const dropped = []
  for (const [from, to] of sources) {
    const src = join(root, from)
    if (!existsSync(src)) continue
    const files = statSync(src).isDirectory() ? filesUnder(src) : [src]
    for (const abs of files) {
      const rel = relative(root, abs)
      const dest = join(outDir, to === from ? rel : join(to, relative(src, abs)))
      if (statSync(abs).size > MAX_FILE_BYTES) {
        dropped.push(rel)
        continue
      }
      mkdirSync(dirname(dest), { recursive: true })
      const bytes = readFileSync(abs)
      // A NUL byte means binary; nothing in a run's state is, and a path in one
      // could not be rewritten safely.
      if (bytes.includes(0)) {
        cpSync(abs, dest)
      } else {
        writeFileSync(dest, tokenise(bytes.toString('utf8'), paths))
      }
    }
  }
  return dropped
}

/** Any file under `dir` that still holds a machine path, as `rel: hits` lines. */
function offenders(dir) {
  const out = []
  for (const abs of filesUnder(dir)) {
    const hits = machinePathsIn(readFileSync(abs, 'utf8'))
    if (hits.length) out.push(`${relative(REPO, abs)}: ${hits.join(', ')}`)
  }
  return out
}

// --- main ------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { tag: null, out: null, keep: false, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') opts.out = argv[++i] || die('--out needs a directory')
    else if (a === '--keep') opts.keep = true
    else if (a === '--verbose') opts.verbose = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a.startsWith('-')) die(`unknown flag: ${a}`)
    else if (!opts.tag) opts.tag = a
    else die(`unexpected argument: ${a}`)
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || !opts.tag) {
    process.stdout.write(
      'usage: node scripts/cut-release-fixture.mjs <tag> [--out <dir>] [--keep] [--verbose]\n' +
        '  <tag>      a released tag present locally, e.g. v1.7.0\n' +
        '  --out      where to write the fixture (default test/fixtures/ship/release-<version>)\n'
    )
    process.exit(opts.help ? 0 : 2)
  }
  const version = versionOfTag(opts.tag)
  if (!version) die(`'${opts.tag}' is not a release tag like v1.7.0`)
  const outDir = opts.out ? resolve(opts.out) : join(REPO, 'test', 'fixtures', 'ship', `release-${version}`)
  const refusal = outDirRefusal(outDir)
  if (refusal) die(`refusing to replace it: ${refusal}`)

  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-cut-')))
  const root = join(scratch, 'repo')
  try {
    const cliPath = extractCli(opts.tag, join(scratch, 'cli'))
    const cliVersion = JSON.parse(readFileSync(join(scratch, 'cli', 'package.json'), 'utf8')).version
    if (cliVersion !== version) die(`${opts.tag} archives package.json ${cliVersion}, not ${version}`)

    mkdirSync(root)
    buildRepo(root)
    const cli = makeCli({ cliBin: join(scratch, 'cli', cliPath), root, verbose: opts.verbose })
    driveRun(cli, root)

    const dropped = copyOut({ root, scratch, outDir })
    const bad = offenders(outDir)
    if (bad.length) {
      rmSync(outDir, { recursive: true, force: true })
      die(`the snapshot still holds machine paths, so it was not written:\n  ${bad.join('\n  ')}`)
    }
    const count = filesUnder(outDir).length
    process.stdout.write(`cut ${opts.tag} -> ${relative(REPO, outDir) || outDir}: ${count} file(s)\n`)
    if (dropped.length) process.stdout.write(`dropped over ${MAX_FILE_BYTES} bytes: ${dropped.join(', ')}\n`)
  } finally {
    if (opts.keep) process.stdout.write(`scratch kept at ${scratch}\n`)
    else rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main()
