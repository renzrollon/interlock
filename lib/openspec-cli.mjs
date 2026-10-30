// Running OpenSpec without the user having installed it (spec: openspec-cli).
//
// The authoring skills call an `openspec` CLI Interlock does not ship. This module
// finds one (a user's own on PATH, else the pinned npm release provisioned into the
// plugin's data directory) and installs the pin when asked: `interlock openspec
// provision` runs npm's lockfile-exact `ci` of `OPENSPEC_PIN.lockfile` with install
// scripts off, writes a launcher beside the tree, runs the launcher's `--version`
// and only then renames the staging directory onto `<data>/openspec/<version>/`.
//
// Imports only `node:` modules, `./which.mjs`, `./openspec-pin.mjs` and
// `compareVersions`, never `./doctor.mjs`: the doctor imports this module for its
// spellings and its resolver, and a cycle would hand it half-initialised exports.
//
// Resolution reads only the environment it is handed, never `process.env` or
// `os.homedir()`, so a doctor test cannot see the developer's own install. There is
// no override variable. Every refusal exits non-zero and names its cause and the
// next step; nothing falls back to another version, a compiled build or `npx`.

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { compareVersions } from './host/claude-env.mjs'
import { OPENSPEC_PIN } from './openspec-pin.mjs'
import { pathEntries, whichSync } from './which.mjs'

/**
 * The one spelling of the command that provisions the pinned OpenSpec. The
 * doctor's fix strings lead with it, and the spec, bootstrap and dispatch skills
 * quote it verbatim; test/skills.test.mjs imports it to hold them to that.
 */
export const OPENSPEC_PROVISION = 'interlock openspec provision'

/**
 * The one spelling of the openspec install command. The doctor's fix strings
 * use it, and the spec, bootstrap and dispatch skills quote it verbatim;
 * test/skills.test.mjs imports this constant to hold them to it.
 */
export const OPENSPEC_INSTALL = 'npm install -g @fission-ai/openspec@latest'

/** How long `npm ci` of the pin may run: 57 packages over a slow link, not a hang. */
export const PROVISION_TIMEOUT_MS = 300_000

/** How long the launcher's `--version` smoke run may take. */
const SMOKE_TIMEOUT_MS = 30_000

/**
 * The text the launcher carries in its first 512 bytes. It, not a path
 * comparison, tells the launcher from a user's own `openspec`: the doctor can run
 * with a different data directory than the session that provisioned it.
 */
export const LAUNCHER_MARKER = 'interlock:openspec-launcher'

const MARKER_WINDOW = 512

/** Where a user installs OpenSpec themselves when the provisioned route is closed to them. */
const OWN_ROUTES = `install OpenSpec your own way: \`${OPENSPEC_INSTALL}\` once Node is ${OPENSPEC_PIN.node} or newer, or the standalone build from OpenSpec's releases page on GitHub`

/** A copy of `env` with OpenSpec's telemetry off. Upstream reads both variables. */
export function telemetryOff(env = {}) {
  return { ...env, OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' }
}

/**
 * The launcher `provision` writes beside the installed tree. It is CommonJS
 * because the staged package.json sets no `type`. It finds the OpenSpec entry
 * from its own location, so the rename that places the directory does not break
 * it, and it passes arguments, streams and exit status straight through.
 */
export function launcherSource() {
  return `#!/usr/bin/env node
// ${LAUNCHER_MARKER}. Written by \`${OPENSPEC_PROVISION}\`:
// runs the pinned OpenSpec beside this file with its telemetry off.
'use strict'
const { spawnSync } = require('node:child_process')
const { constants } = require('node:os')
const { join } = require('node:path')

const entry = join(__dirname, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js')
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' }
})
if (result.error) {
  process.stderr.write('openspec launcher: ' + result.error.message + '\\n')
  process.exit(1)
}
if (result.signal) process.exit(128 + ((constants.signals && constants.signals[result.signal]) || 0))
process.exit(result.status === null ? 1 : result.status)
`
}

/**
 * The `openspec.cmd` written beside the launcher on win32. `whichSync` there only
 * tries PATHEXT suffixes, and a shebang script cannot be exec'd, so the extensionless
 * launcher is invisible to a bare `openspec`; this batch file is what a PATH lookup
 * finds. It carries the marker in a `@rem` line (CRLF throughout), so a user's own
 * `openspec` is not mistaken for it and it is not mistaken for theirs.
 */
export function cmdLauncherSource() {
  return [
    `@rem ${LAUNCHER_MARKER}. Written by \`${OPENSPEC_PROVISION}\`:`,
    '@rem runs the pinned OpenSpec beside this file with its telemetry off.',
    '@echo off',
    'node "%~dp0openspec" %*',
    'exit /b %errorlevel%',
    ''
  ].join('\r\n')
}

/** True when `file` begins with the launcher marker within its first 512 bytes. */
function carriesMarker(file) {
  let fd
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(MARKER_WINDOW)
    const n = readSync(fd, buf, 0, MARKER_WINDOW, 0)
    return buf.subarray(0, n).toString('utf8').includes(LAUNCHER_MARKER)
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {}
    }
  }
}

function setting(env, name) {
  return typeof env[name] === 'string' && env[name] ? env[name] : ''
}

/**
 * The data directory and where it came from: `INTERLOCK_PLUGIN_DATA`, then
 * `CLAUDE_PLUGIN_DATA`, then `<XDG_CACHE_HOME or $HOME/.cache>/interlock`. With
 * none of them, `dataDir` is null and nothing can be provisioned.
 */
function dataDirOf(env) {
  for (const name of ['INTERLOCK_PLUGIN_DATA', 'CLAUDE_PLUGIN_DATA']) {
    if (setting(env, name)) return { dataDir: setting(env, name), dataDirSource: name }
  }
  const home = setting(env, 'HOME') || setting(env, 'USERPROFILE')
  const base = setting(env, 'XDG_CACHE_HOME') || (home ? join(home, '.cache') : '')
  return { dataDir: base ? join(base, 'interlock') : null, dataDirSource: 'cache' }
}

/** `<data>/openspec/<version>/openspec` when it exists and carries the marker, else null. */
function provisionedBin(dataDir, version = OPENSPEC_PIN.version) {
  if (!dataDir) return null
  const bin = join(dataDir, 'openspec', version, 'openspec')
  try {
    if (!statSync(bin).isFile()) return null
  } catch {
    return null
  }
  return carriesMarker(bin) ? bin : null
}

/**
 * True when `dir` is one of PATH's absolute entries, compared through symlinks
 * (and case-blind on win32). A relative entry is skipped, as `whichSync` skips it.
 */
function pathHolds(env, platform, dir) {
  const canonical = p => {
    let real
    try {
      real = realpathSync(p)
    } catch {
      real = resolve(p)
    }
    return platform === 'win32' ? real.toLowerCase() : real
  }
  const want = canonical(dir)
  return pathEntries(env, platform).some(entry => isAbsolute(entry) && canonical(entry) === want)
}

/** The first `openspec` on PATH that is not the provisioned launcher, or null. */
function userOpenSpec(env, platform) {
  return whichSync('openspec', env, { platform, accept: file => !carriesMarker(file) })
}

/**
 * Which OpenSpec would run: the first one on `env.PATH` that is not our launcher
 * (`path`), else the provisioned pin (`provisioned`), else `none`. A provisioned
 * pin also says whether its directory is on `env.PATH` (`onPath`): when it is
 * not, a bare `openspec` does not find it, though this resolver does.
 *
 * @returns {{ source: 'path' | 'provisioned' | 'none', bin?: string, onPath?: boolean, dataDir: string | null, dataDirSource: string }}
 */
export function resolveOpenSpec({ env = {}, platform = process.platform } = {}) {
  const { dataDir, dataDirSource } = dataDirOf(env)
  const own = userOpenSpec(env, platform)
  if (own) return { source: 'path', bin: own, dataDir, dataDirSource }
  const bin = provisionedBin(dataDir)
  if (bin) return { source: 'provisioned', bin, onPath: pathHolds(env, platform, dirname(bin)), dataDir, dataDirSource }
  return { source: 'none', dataDir, dataDirSource }
}

/** A `spawnSync` that answers `{ status, signal, stdout, stderr, error }`; a `.cmd` shim needs a shell on win32. */
function defaultSpawn(command, args = [], opts = {}) {
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const r = spawnSync(shell ? `"${command}"` : command, args, { ...opts, shell, encoding: 'utf8' })
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error }
}

const lines = text => String(text || '').split('\n').map(l => l.trimEnd()).filter(l => l.trim())

/** The last stderr line worth quoting: not npm's pointer at its own log file. */
function lastErrorLine(stderr, stdout) {
  const real = l => !/complete log of this run|log file|^npm (ERR!|error)\s*$/i.test(l)
  const all = lines(stderr)
  return all.filter(real).pop() || all.pop() || lines(stdout).pop() || ''
}

const NETWORK = /\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPROTO|ERR_SOCKET_TIMEOUT|FETCH_ERROR)\b/

const rmQuiet = path => {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {}
}

const fail = message => ({ ok: false, message })

/** Whether process `pid` exists. `EPERM` means it does, under another user. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return !(err && err.code === 'ESRCH')
  }
}

const PARTIAL = /^\.\d+\.\d+\.\d+\.partial-(\d+)$/

/**
 * Remove staging directories an interrupted provision left in `root`: a
 * `.x.y.z.partial-<pid>` of another process whose pid is no longer alive, or
 * whose mtime is older than twice the install timeout (a reused pid, or a hung
 * run no one is waiting for). A live, recent one belongs to a concurrent run and
 * stays. Returns the names removed and `name (code)` for those it could not.
 */
function sweepPartials(root, { alive, now }) {
  const removed = []
  const stuck = []
  let entries = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return { removed, stuck }
  }
  for (const entry of entries) {
    const m = entry.isDirectory() && PARTIAL.exec(entry.name)
    if (!m || Number(m[1]) === process.pid) continue
    const dir = join(root, entry.name)
    let old = false
    try {
      old = now - statSync(dir).mtimeMs > 2 * PROVISION_TIMEOUT_MS
    } catch {}
    if (alive(Number(m[1])) && !old) continue
    try {
      rmSync(dir, { recursive: true, force: true })
      removed.push(entry.name)
    } catch (err) {
      stuck.push(`${entry.name} (${(err && err.code) || 'error'})`)
    }
  }
  return { removed, stuck }
}

/**
 * Install the pinned OpenSpec into `<data>/openspec/<version>/`, verified and run
 * before it is placed.
 *
 * `spawn(command, args, { cwd, env, timeout })` answers like `spawnSync`
 * (`{ status, stdout, stderr, error? }`) and is injected so a test reaches
 * neither npm nor the registry. `alive(pid)` and `now` (ms) are injected the same
 * way for the sweep of dead runs' staging directories.
 *
 * A success says when the launcher's directory is not on `env.PATH`, and names
 * the launcher by its full path: a bare `openspec` (what the skills probe) does
 * not find it then, even though `resolveOpenSpec` and the doctor do. `onPath`
 * carries the same answer.
 *
 * @returns {{ ok: boolean, message: string, bin?: string, already?: boolean, onPath?: boolean }}
 */
export function provision({
  env = {},
  spawn = defaultSpawn,
  platform = process.platform,
  nodeVersion = process.version,
  alive = pidAlive,
  now = Date.now()
} = {}) {
  const { version, node: floor } = OPENSPEC_PIN

  // 1-2. Refuse before any request is made.
  if (compareVersions(nodeVersion, floor) === -1) {
    return fail(
      `Node ${String(nodeVersion).replace(/^v/, '')} is below ${floor}, which OpenSpec ${version} needs: ${OWN_ROUTES}. Nothing was installed.`
    )
  }
  const npm = whichSync('npm', env)
  if (!npm) {
    return fail(`npm was not found on PATH, and provisioning OpenSpec ${version} needs it: ${OWN_ROUTES}. Nothing was installed.`)
  }

  const { dataDir, dataDirSource } = dataDirOf(env)
  if (!dataDir) {
    return fail(
      'no data directory to provision into: set INTERLOCK_PLUGIN_DATA, XDG_CACHE_HOME or HOME, then run `' + OPENSPEC_PROVISION + '` again.'
    )
  }
  const cache = dataDirSource === 'cache'
  const note = cache
    ? `\nThe plugin's data directory was not available (neither INTERLOCK_PLUGIN_DATA nor CLAUDE_PLUGIN_DATA is set), so it used ${dataDir}.`
    : ''
  // Every success ends here: the data-directory note, then whether a bare `openspec` finds the launcher.
  const placed = (bin, message, extra = {}) => {
    const onPath = pathHolds(env, platform, dirname(bin))
    const why = cache ? " (the session preflight adds only the plugin's own data directory to PATH)" : ''
    const unreachable = onPath ? '' : `\n${dirname(bin)} is not on PATH${why}, so a bare \`openspec\` does not find this copy: run it as ${bin}.`
    return { ok: true, ...extra, bin, onPath, message: message + note + unreachable }
  }

  // 3. Already provisioned.
  const there = provisionedBin(dataDir)
  if (there) return placed(there, `OpenSpec ${version} is already provisioned at ${there}.`, { already: true })

  // 4. The data directory.
  const root = join(dataDir, 'openspec')
  try {
    mkdirSync(root, { recursive: true })
  } catch (err) {
    const code = (err && err.code) || 'error'
    const sandboxed = code === 'EPERM' || code === 'EACCES'
    return fail(
      `cannot create ${root} (${code}): ${sandboxed ? `one run of \`${OPENSPEC_PROVISION}\` outside the sandbox provisions it.` : `fix that path, then run \`${OPENSPEC_PROVISION}\` again.`}`
    )
  }

  // 5. Sweep the staging directories of runs that no longer exist, then stage.
  const swept = sweepPartials(root, { alive, now })
  const sweepNote = [
    swept.removed.length
      ? `Removed ${swept.removed.length} stale staging director${swept.removed.length === 1 ? 'y' : 'ies'} left by an interrupted provision.`
      : '',
    swept.stuck.length ? `Could not remove ${swept.stuck.join(', ')}.` : ''
  ].filter(Boolean)
  const stage = join(root, `.${version}.partial-${process.pid}`)
  const abandon = message => {
    rmQuiet(stage)
    return fail(message)
  }
  rmQuiet(stage)
  try {
    mkdirSync(stage, { recursive: true })
    writeFileSync(
      join(stage, 'package.json'),
      JSON.stringify({ private: true, dependencies: { [OPENSPEC_PIN.package]: version } }, null, 2) + '\n'
    )
    writeFileSync(join(stage, 'package-lock.json'), JSON.stringify(OPENSPEC_PIN.lockfile, null, 2) + '\n')
  } catch (err) {
    const code = (err && err.code) || 'error'
    return abandon(`cannot write ${stage} (${code}): one run of \`${OPENSPEC_PROVISION}\` outside the sandbox provisions it.`)
  }

  // 6. Install exactly the lockfile. No registry is set: the user's npm configuration applies.
  const installed = spawn(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: stage,
    env,
    timeout: PROVISION_TIMEOUT_MS
  })
  if (!installed || installed.status !== 0) {
    const r = installed || {}
    const all = `${r.stderr || ''}\n${r.stdout || ''}`
    const line = lastErrorLine(r.stderr, r.stdout)
    const quoted = line ? `: ${line}` : ''
    if (r.error && r.error.code === 'ETIMEDOUT') {
      return abandon(`npm ci did not finish within ${Math.round(PROVISION_TIMEOUT_MS / 1000)} s (the registry may be unreachable): one run outside the sandbox, or with the registry reachable, provisions it.`)
    }
    if (r.status === null || r.status === undefined) {
      const why = (r.error && r.error.message) || (r.signal ? `killed by ${r.signal}` : 'it did not start')
      return abandon(`npm ci could not run (${why}): fix npm, then run \`${OPENSPEC_PROVISION}\` again.`)
    }
    if (/EINTEGRITY/.test(all)) {
      return abandon(`a package's bytes differed from the pin (npm ci exit ${r.status})${quoted}. Nothing was installed.`)
    }
    if (NETWORK.test(all)) {
      return abandon(`npm ci could not reach the registry (exit ${r.status})${quoted}. One run outside the sandbox, or with the registry reachable, provisions it.`)
    }
    return abandon(`npm ci failed (exit ${r.status})${quoted}. Nothing was installed.`)
  }

  // 7. Launch.
  const launcher = join(stage, 'openspec')
  try {
    writeFileSync(launcher, launcherSource(), { mode: 0o755 })
    chmodSync(launcher, 0o755)
  } catch (err) {
    return abandon(`cannot write the launcher in ${stage} (${(err && err.code) || 'error'}).`)
  }

  // On win32 a PATH lookup only tries PATHEXT suffixes and cannot exec a shebang script:
  // `openspec.cmd` is what a bare `openspec` finds there.
  if (platform === 'win32') {
    try {
      writeFileSync(join(stage, 'openspec.cmd'), cmdLauncherSource())
    } catch (err) {
      return abandon(`cannot write the launcher in ${stage} (${(err && err.code) || 'error'}).`)
    }
  }

  // 8. Smoke: it must start and report the pinned version.
  const smoke = spawn(process.execPath, [launcher, '--version'], {
    cwd: stage,
    env: telemetryOff(env),
    timeout: SMOKE_TIMEOUT_MS
  })
  const said = `${(smoke && smoke.stdout) || ''}${(smoke && smoke.stderr) || ''}`.trim()
  if (!smoke || smoke.status !== 0) {
    return abandon(`the installed OpenSpec did not start: ${said || (smoke && smoke.error && smoke.error.message) || '(no output)'}`)
  }
  if (!(smoke.stdout || '').trim().split(/\s+/).includes(version)) {
    return abandon(`the installed OpenSpec did not report ${version}: ${said || '(no output)'}`)
  }

  // 9. Place. A rename within one directory is atomic.
  const target = join(root, version)
  try {
    renameSync(stage, target)
  } catch (err) {
    const won = provisionedBin(dataDir)
    rmQuiet(stage)
    if (won) return placed(won, [`OpenSpec ${version} is already provisioned at ${won}.`, ...sweepNote].join(' '), { already: true })
    return fail(`cannot place ${target} (${(err && err.code) || 'error'}): ${(err && err.message) || err}`)
  }

  // 10. Prune older versions: directories named x.y.z below the pin, once the pin is
  // in place. A newer one is another Interlock's pin sharing this data directory (a
  // plugin update with an older session still open, or an npm copy beside the plugin
  // on the cache fallback), so it is left alone: two installs never remove each
  // other's copy, and an older one still running provisions its own again once.
  const pruned = []
  const stuck = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+\.\d+\.\d+$/.test(entry.name)) continue
    if (compareVersions(entry.name, version) !== -1) continue
    try {
      rmSync(join(root, entry.name), { recursive: true, force: true })
      pruned.push(entry.name)
    } catch (err) {
      stuck.push(`${entry.name} (${(err && err.code) || 'error'})`)
    }
  }
  const bin = join(target, 'openspec')
  const extra = [
    pruned.length
      ? `Removed ${pruned.join(', ')}, older than this pin; an Interlock still pinned to ${pruned.length === 1 ? 'it' : 'one'} provisions its own again.`
      : '',
    stuck.length ? `Could not remove ${stuck.join(', ')}.` : ''
  ].filter(Boolean)
  return placed(bin, [`Provisioned OpenSpec ${version} at ${bin}.`, ...extra, ...sweepNote].join(' '))
}

/**
 * `interlock openspec provision|which [--json]`. `io` is the entry file's
 * `{ emit, die }`; it may also carry `env`, `spawn`, `platform` and `nodeVersion`
 * for a caller that is not the process itself.
 */
export function openspecCommand(io, positional, flags, json) {
  const sub = positional[1]
  const env = io.env || process.env
  const platform = io.platform || process.platform
  if (sub === 'provision') {
    const result = provision({ env, spawn: io.spawn, platform, nodeVersion: io.nodeVersion || process.version })
    if (result.ok) {
      io.emit(json, result, result.message + '\n')
      return
    }
    // The JSON shape goes to stdout first; `die` then names the cause on stderr and exits 1.
    if (json) io.emit(json, result, '')
    io.die(result.message)
    return
  }
  if (sub === 'which') {
    const found = resolveOpenSpec({ env, platform })
    const out = { ...found, bin: found.bin || null, pin: OPENSPEC_PIN.version }
    const text = [
      found.source === 'none'
        ? `openspec: none resolved (run \`${OPENSPEC_PROVISION}\`)`
        : `openspec: ${found.source === 'path' ? 'your PATH' : 'provisioned'} -> ${found.bin}`,
      found.source === 'provisioned' && found.onPath === false
        ? `not on PATH: a bare \`openspec\` does not find this copy; run it as ${found.bin}`
        : '',
      `pin: ${OPENSPEC_PIN.version} (Node ${OPENSPEC_PIN.node} or newer)`,
      `data directory: ${found.dataDir || '(none)'} (${found.dataDirSource})`
    ].filter(Boolean).join('\n')
    io.emit(json, out, text + '\n')
    return
  }
  io.die(`unknown openspec subcommand: ${sub || '(none)'} — expected provision|which`)
}
