// Provisioning the pinned OpenSpec (spec: openspec-cli).
//
// `lib/openspec-cli.mjs` resolves an `openspec` (a user's own on PATH, else the
// provisioned pin), installs the pin with npm's lockfile-exact `ci`, writes a launcher
// beside the installed tree and places it only after it has run. Everything here
// runs with an injected `spawn` and `nodeVersion`: no case reaches npm, the registry
// or an installed OpenSpec. The contract script is driven against a stub CLI only.
//
// The interface these cases fix, where the design leaves it open:
//   - `resolveOpenSpec({ env, platform })` returns
//     `{ source: 'path' | 'provisioned' | 'none', bin, dataDir, dataDirSource }`, and
//     `dataDirSource` is `'INTERLOCK_PLUGIN_DATA'`, `'CLAUDE_PLUGIN_DATA'` or `'cache'`.
//   - `provision({ env, spawn, platform, nodeVersion })` returns (or resolves to)
//     `{ ok, message, bin?, already? }`. `message` is what the command prints; on
//     failure its first line names the cause and the next step.
//   - `spawn(command, args, { cwd, env, timeout })` answers like `spawnSync`:
//     `{ status, stdout, stderr, error? }`.
//   - `telemetryOff(env)` returns a copy of `env` with both variables set.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LAUNCHER_MARKER,
  OPENSPEC_INSTALL,
  OPENSPEC_PROVISION,
  PROVISION_TIMEOUT_MS,
  cmdLauncherSource,
  launcherSource,
  openspecCommand,
  provision,
  resolveOpenSpec,
  telemetryOff
} from '../../lib/openspec-cli.mjs'
import { OPENSPEC_PIN } from '../../lib/openspec-pin.mjs'
import { pathEntries, whichSync } from '../../lib/which.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONTRACT = join(ROOT, 'scripts', 'openspec-contract.mjs')
const VERSION = OPENSPEC_PIN.version

/** A scratch directory (realpathed, so a macOS /var symlink cannot differ between two spellings). */
function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-openspec-cli-')))
  return {
    root,
    cleanup: () => {
      try {
        chmodSync(join(root, 'ro'), 0o755)
      } catch {}
      rmSync(root, { recursive: true, force: true })
    }
  }
}

function put(path, contents, mode) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  if (mode) chmodSync(path, mode)
  return path
}

/** An executable named `name` in `dir`, carrying the launcher marker or not. */
function execFile(dir, name, { marker = false, body = 'exit 0' } = {}) {
  return put(join(dir, name), `#!/bin/sh\n${marker ? `# ${LAUNCHER_MARKER}\n` : ''}${body}\n`, 0o755)
}

/** PATH with the directory holding this Node in front, for a child that runs a `#!/usr/bin/env node` script. */
const withNode = env => ({ ...env, PATH: `${dirname(process.execPath)}:${(env && env.PATH) || ''}:/usr/bin:/bin` })

const NODE_OK = 'v22.11.0'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('the exported spellings and the timeout are what the doctor and the skills quote', () => {
  assert.equal(OPENSPEC_PROVISION, 'interlock openspec provision')
  assert.equal(OPENSPEC_INSTALL, 'npm install -g @fission-ai/openspec@latest')
  assert.equal(LAUNCHER_MARKER, 'interlock:openspec-launcher')
  assert.ok(Number.isInteger(PROVISION_TIMEOUT_MS) && PROVISION_TIMEOUT_MS >= 30_000, `got ${PROVISION_TIMEOUT_MS}`)
})

test('telemetryOff adds both variables to a copy and leaves the original alone', () => {
  const env = { PATH: '/x', OPENSPEC_TELEMETRY: '1' }
  const off = telemetryOff(env)
  assert.equal(off.OPENSPEC_TELEMETRY, '0')
  assert.equal(off.DO_NOT_TRACK, '1')
  assert.equal(off.PATH, '/x')
  assert.deepEqual(env, { PATH: '/x', OPENSPEC_TELEMETRY: '1' })
})

test('the launcher source carries the marker in its first 512 bytes and starts with a node shebang', () => {
  const source = launcherSource()
  assert.ok(source.startsWith('#!/usr/bin/env node'), source.slice(0, 40))
  assert.ok(source.slice(0, 512).includes(LAUNCHER_MARKER))
})

// ---------------------------------------------------------------------------
// resolveOpenSpec
// ---------------------------------------------------------------------------

/** A provisioned launcher for `version` under `data`, as provisioning leaves it. */
function provisioned(data, version = VERSION, { marker = true } = {}) {
  return execFile(join(data, 'openspec', version), 'openspec', { marker })
}

test('resolveOpenSpec: a user\'s openspec on PATH is the path source', () => {
  const t = scratch()
  try {
    const bin = execFile(join(t.root, 'userbin'), 'openspec')
    const r = resolveOpenSpec({ env: { PATH: join(t.root, 'userbin'), INTERLOCK_PLUGIN_DATA: join(t.root, 'data') }, platform: process.platform })
    assert.equal(r.source, 'path')
    assert.equal(r.bin, bin)
  } finally {
    t.cleanup()
  }
})

test('resolveOpenSpec: a PATH openspec carrying the launcher marker is skipped, and the next one wins', () => {
  const t = scratch()
  try {
    execFile(join(t.root, 'a'), 'openspec', { marker: true })
    const user = execFile(join(t.root, 'b'), 'openspec')
    const both = resolveOpenSpec({ env: { PATH: `${join(t.root, 'a')}:${join(t.root, 'b')}` }, platform: process.platform })
    assert.equal(both.source, 'path')
    assert.equal(both.bin, user)
    const only = resolveOpenSpec({ env: { PATH: join(t.root, 'a'), INTERLOCK_PLUGIN_DATA: join(t.root, 'data') }, platform: process.platform })
    assert.equal(only.source, 'none', 'a launcher on PATH is not a user CLI')
    assert.ok(!only.bin)
  } finally {
    t.cleanup()
  }
})

test('resolveOpenSpec: the provisioned pin counts only under <data>/openspec/<pin version>/ and with the marker', () => {
  const t = scratch()
  try {
    const data = join(t.root, 'data')
    const env = { PATH: '', INTERLOCK_PLUGIN_DATA: data }
    assert.equal(resolveOpenSpec({ env, platform: process.platform }).source, 'none')
    provisioned(data, '1.14.3')
    assert.equal(resolveOpenSpec({ env, platform: process.platform }).source, 'none', 'another version\'s launcher is not the pin')
    provisioned(data, VERSION, { marker: false })
    assert.equal(resolveOpenSpec({ env, platform: process.platform }).source, 'none', 'a file without the marker is not the launcher')
    const bin = provisioned(data, VERSION)
    const r = resolveOpenSpec({ env, platform: process.platform })
    assert.equal(r.source, 'provisioned')
    assert.equal(r.bin, bin)
    assert.equal(r.dataDir, data)
    assert.equal(r.dataDirSource, 'INTERLOCK_PLUGIN_DATA')
  } finally {
    t.cleanup()
  }
})

test('resolveOpenSpec: the data directory comes from INTERLOCK_PLUGIN_DATA, then CLAUDE_PLUGIN_DATA, then XDG_CACHE_HOME, then HOME', () => {
  const at = env => resolveOpenSpec({ env: { PATH: '', ...env }, platform: 'linux' })
  const all = at({ INTERLOCK_PLUGIN_DATA: '/i', CLAUDE_PLUGIN_DATA: '/c', XDG_CACHE_HOME: '/x', HOME: '/h' })
  assert.deepEqual([all.dataDir, all.dataDirSource], ['/i', 'INTERLOCK_PLUGIN_DATA'])
  const claude = at({ CLAUDE_PLUGIN_DATA: '/c', XDG_CACHE_HOME: '/x', HOME: '/h' })
  assert.deepEqual([claude.dataDir, claude.dataDirSource], ['/c', 'CLAUDE_PLUGIN_DATA'])
  const xdg = at({ XDG_CACHE_HOME: '/x', HOME: '/h' })
  assert.deepEqual([xdg.dataDir, xdg.dataDirSource], ['/x/interlock', 'cache'])
  const home = at({ HOME: '/h' })
  assert.deepEqual([home.dataDir, home.dataDirSource], ['/h/.cache/interlock', 'cache'])
})

test('resolveOpenSpec reads only the environment it is given, never process.env', () => {
  const t = scratch()
  const saved = { i: process.env.INTERLOCK_PLUGIN_DATA, c: process.env.CLAUDE_PLUGIN_DATA }
  try {
    const data = join(t.root, 'data')
    provisioned(data)
    process.env.INTERLOCK_PLUGIN_DATA = data
    process.env.CLAUDE_PLUGIN_DATA = data
    const r = resolveOpenSpec({ env: { PATH: '' }, platform: process.platform })
    assert.equal(r.source, 'none', 'the developer\'s own install must not decide a doctor test')
  } finally {
    for (const [k, v] of [['INTERLOCK_PLUGIN_DATA', saved.i], ['CLAUDE_PLUGIN_DATA', saved.c]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    t.cleanup()
  }
})

// ---------------------------------------------------------------------------
// provision
// ---------------------------------------------------------------------------

/**
 * The stub OpenSpec a fake install lays down at node_modules/@fission-ai/openspec/bin/openspec.js:
 * `--version` prints `version` (or fails), anything else prints what it saw and exits 3.
 */
function stubOpenSpec({ version = VERSION, versionFails = false } = {}) {
  return [
    '#!/usr/bin/env node',
    'const a = process.argv.slice(2)',
    `if (a[0] === '--version') {`,
    versionFails
      ? `  console.error('Error: this OpenSpec needs a newer Node'); process.exit(2)`
      : `  console.log(${JSON.stringify(version)}); process.exit(0)`,
    '}',
    `console.log(JSON.stringify({ argv: a, telemetry: process.env.OPENSPEC_TELEMETRY, dnt: process.env.DO_NOT_TRACK, foo: process.env.FOO }))`,
    'process.exit(3)',
    ''
  ].join('\n')
}

/**
 * A `spawn` that answers npm itself and runs anything else (the launcher's smoke
 * run) for real. Its npm either fails as told, or "installs" the stub OpenSpec into
 * the directory it was run in.
 */
function fakeSpawn({ npm = {}, stub = {} } = {}) {
  const calls = []
  const spawn = (command, args = [], opts = {}) => {
    const call = { command, args: [...args], cwd: opts.cwd, timeout: opts.timeout, env: opts.env }
    calls.push(call)
    if (basename(command).replace(/\.cmd$/i, '') === 'npm') {
      call.npm = true
      call.lockfile = existsSync(join(opts.cwd, 'package-lock.json')) ? JSON.parse(readFileSync(join(opts.cwd, 'package-lock.json'), 'utf8')) : null
      call.manifest = existsSync(join(opts.cwd, 'package.json')) ? JSON.parse(readFileSync(join(opts.cwd, 'package.json'), 'utf8')) : null
      if (npm.status) return { status: npm.status, stdout: '', stderr: npm.stderr || '' }
      put(join(opts.cwd, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js'), stubOpenSpec(stub), 0o755)
      return { status: 0, stdout: '', stderr: '' }
    }
    return spawnSync(command, args, { ...opts, env: withNode(opts.env || process.env), encoding: 'utf8' })
  }
  return { spawn, calls, npmCalls: () => calls.filter(c => c.npm), launcherCalls: () => calls.filter(c => !c.npm) }
}

/** A data directory, a PATH holding a stub npm, and the env a provisioning runs under. */
function setup(extra = {}) {
  const t = scratch()
  const npmDir = join(t.root, 'npmbin')
  execFile(npmDir, 'npm')
  const data = join(t.root, 'data')
  const env = { PATH: npmDir, INTERLOCK_PLUGIN_DATA: data, ...extra }
  return { ...t, npmDir, data, env, openspecDir: join(data, 'openspec') }
}

const run = (s, spawn, nodeVersion = NODE_OK) => provision({ env: s.env, spawn, platform: process.platform, nodeVersion })

/** Whatever lies under <data>/openspec/, or nothing when it was never made. */
const leftovers = s => (existsSync(s.openspecDir) ? readdirSync(s.openspecDir).sort() : [])

test('provision: a clean install is verified, run and placed, and npm ran the pin\'s lockfile with scripts off', async () => {
  const s = setup()
  try {
    const f = fakeSpawn()
    const r = await run(s, f.spawn)
    assert.equal(r.ok, true, r.message)
    const bin = join(s.openspecDir, VERSION, 'openspec')
    assert.equal(r.bin, bin)
    assert.ok(existsSync(bin), 'the launcher is in place')
    assert.ok((statSync(bin).mode & 0o111) !== 0, 'the launcher is executable')
    assert.ok(readFileSync(bin, 'utf8').slice(0, 512).includes(LAUNCHER_MARKER), 'and carries the marker')
    assert.ok(r.message.includes(VERSION) && r.message.includes(bin), `the output names the version and the path: ${r.message}`)

    const [npm, ...more] = f.npmCalls()
    assert.equal(more.length, 0, 'npm ran once')
    assert.equal(npm.args[0], 'ci')
    assert.ok(npm.args.includes('--ignore-scripts'), npm.args.join(' '))
    assert.ok(!npm.args.some(a => /registry/i.test(a)), 'no registry is set')
    assert.deepEqual(npm.lockfile, JSON.parse(JSON.stringify(OPENSPEC_PIN.lockfile)), 'in a directory holding the pin\'s lockfile')
    assert.deepEqual(npm.manifest.dependencies, { [OPENSPEC_PIN.package]: VERSION })
    assert.equal(npm.timeout, PROVISION_TIMEOUT_MS)
    assert.deepEqual(leftovers(s), [VERSION], 'nothing but the version directory remains')
  } finally {
    s.cleanup()
  }
})

test('provision: an integrity mismatch is refused, says so, quotes npm and leaves nothing behind', async () => {
  const s = setup()
  try {
    const line = 'npm ERR! code EINTEGRITY: sha512-AAAA integrity checksum failed when using sha512'
    const f = fakeSpawn({ npm: { status: 1, stderr: `npm ERR! something\n${line}\n\n` } })
    const r = await run(s, f.spawn)
    assert.equal(r.ok, false)
    assert.match(r.message, /differed from the pin/)
    assert.ok(r.message.includes(line), r.message)
    assert.deepEqual(leftovers(s), [])
  } finally {
    s.cleanup()
  }
})

test('provision: a launcher whose --version fails is not placed, and its output is quoted', async () => {
  const s = setup()
  try {
    const r = await run(s, fakeSpawn({ stub: { versionFails: true } }).spawn)
    assert.equal(r.ok, false)
    assert.match(r.message, /this OpenSpec needs a newer Node/)
    assert.deepEqual(leftovers(s), [])
  } finally {
    s.cleanup()
  }
})

test('provision: a launcher that reports another version is not placed, and its output is quoted', async () => {
  const s = setup()
  try {
    const r = await run(s, fakeSpawn({ stub: { version: '1.14.3' } }).spawn)
    assert.equal(r.ok, false)
    assert.ok(r.message.includes('1.14.3'), r.message)
    assert.deepEqual(leftovers(s), [])
  } finally {
    s.cleanup()
  }
})

test('provision: a version already in place runs no npm and says so', async () => {
  const s = setup()
  try {
    provisioned(s.data)
    const f = fakeSpawn()
    const r = await run(s, f.spawn)
    assert.equal(r.ok, true, r.message)
    assert.deepEqual(f.calls, [], 'nothing was spawned')
    assert.match(r.message, /already provisioned/i)
    assert.deepEqual(leftovers(s), [VERSION])
  } finally {
    s.cleanup()
  }
})

test('provision: another version\'s directory is removed; a name that is not a version, and another run\'s partial, are left alone', async () => {
  const s = setup()
  try {
    provisioned(s.data, '1.14.3')
    put(join(s.openspecDir, 'notes', 'keep.txt'), 'x')
    put(join(s.openspecDir, '.9.9.9.partial-1', 'x'), 'x')
    const r = await run(s, fakeSpawn().spawn)
    assert.equal(r.ok, true, r.message)
    assert.deepEqual(leftovers(s), ['.9.9.9.partial-1', VERSION, 'notes'])
  } finally {
    s.cleanup()
  }
})

test('provision: with no plugin data directory it uses the user cache and says the data directory was not available', async () => {
  const s = setup()
  try {
    const home = join(s.root, 'home')
    mkdirSync(home, { recursive: true })
    const env = { PATH: s.npmDir, HOME: home }
    const r = await provision({ env, spawn: fakeSpawn().spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(r.ok, true, r.message)
    const bin = join(home, '.cache', 'interlock', 'openspec', VERSION, 'openspec')
    assert.ok(existsSync(bin), 'placed under $HOME/.cache/interlock')
    assert.match(r.message, /data directory[^\n]*not available/i)

    const xdg = join(s.root, 'xdg')
    const viaXdg = await provision({ env: { PATH: s.npmDir, HOME: home, XDG_CACHE_HOME: xdg }, spawn: fakeSpawn().spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(viaXdg.ok, true, viaXdg.message)
    assert.ok(existsSync(join(xdg, 'interlock', 'openspec', VERSION, 'openspec')), 'XDG_CACHE_HOME wins over HOME')
  } finally {
    s.cleanup()
  }
})

test('provision: a Node below the floor is refused, naming both versions and the install route, with no spawn', async () => {
  const s = setup()
  try {
    const f = fakeSpawn()
    const r = await run(s, f.spawn, 'v18.20.8')
    assert.equal(r.ok, false)
    for (const token of ['18.20.8', OPENSPEC_PIN.node, OPENSPEC_INSTALL]) assert.ok(r.message.includes(token), `${token} in ${r.message}`)
    assert.deepEqual(f.calls, [])
    assert.deepEqual(leftovers(s), [])
  } finally {
    s.cleanup()
  }
})

test('provision: no npm on PATH is refused, naming npm, with no spawn', async () => {
  const s = setup()
  try {
    const f = fakeSpawn()
    const empty = join(s.root, 'empty')
    mkdirSync(empty, { recursive: true })
    const r = await provision({ env: { PATH: empty, INTERLOCK_PLUGIN_DATA: s.data }, spawn: f.spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(r.ok, false)
    assert.match(r.message, /npm/)
    assert.deepEqual(f.calls, [])
  } finally {
    s.cleanup()
  }
})

test('provision: a refused write names the path and the code, and the one unsandboxed rerun', async t => {
  if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
    t.skip('a read-only directory does not refuse a mkdir here')
    return
  }
  const s = setup()
  try {
    const ro = join(s.root, 'ro')
    mkdirSync(ro)
    chmodSync(ro, 0o555)
    const data = join(ro, 'data')
    const f = fakeSpawn()
    const r = await provision({ env: { PATH: s.npmDir, INTERLOCK_PLUGIN_DATA: data }, spawn: f.spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(r.ok, false)
    assert.ok(r.message.includes(data), r.message)
    assert.match(r.message, /EPERM|EACCES/)
    assert.ok(r.message.includes(OPENSPEC_PROVISION) && /outside the sandbox/.test(r.message), r.message)
    assert.deepEqual(f.npmCalls(), [])
  } finally {
    s.cleanup()
  }
})

test('provision: an unreachable registry is quoted and named with the one run outside the sandbox', async () => {
  const s = setup()
  try {
    const line = 'npm ERR! request to https://registry.npmjs.org/yaml failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org'
    const r = await run(s, fakeSpawn({ npm: { status: 1, stderr: `npm ERR! code ENOTFOUND\n${line}\n` } }).spawn)
    assert.equal(r.ok, false)
    assert.ok(r.message.includes(line), r.message)
    assert.match(r.message, /outside the sandbox/)
    assert.deepEqual(leftovers(s), [])
  } finally {
    s.cleanup()
  }
})

// ---------------------------------------------------------------------------
// The launcher
// ---------------------------------------------------------------------------

test('the launcher passes arguments and the exit status through and sets both telemetry variables', async () => {
  const s = setup()
  try {
    const r = await run(s, fakeSpawn().spawn)
    assert.equal(r.ok, true, r.message)
    const ran = spawnSync(r.bin, ['status', '--change', 'demo', '--json'], {
      encoding: 'utf8',
      env: withNode({ PATH: '', FOO: 'bar', OPENSPEC_TELEMETRY: '1' })
    })
    assert.equal(ran.status, 3, ran.stderr)
    assert.deepEqual(JSON.parse(ran.stdout), { argv: ['status', '--change', 'demo', '--json'], telemetry: '0', dnt: '1', foo: 'bar' })
    const version = spawnSync(r.bin, ['--version'], { encoding: 'utf8', env: withNode({ PATH: '' }) })
    assert.equal(version.status, 0)
    assert.equal(version.stdout.trim(), VERSION)
  } finally {
    s.cleanup()
  }
})

// ---------------------------------------------------------------------------
// Pruning, the user cache, `which`, stale staging directories, win32
// ---------------------------------------------------------------------------

test('provision: an older version is removed and named in the message; a newer one is left alone', async () => {
  const s = setup()
  try {
    provisioned(s.data, '0.1.0')
    provisioned(s.data, '99.0.0')
    const r = await run(s, fakeSpawn().spawn)
    assert.equal(r.ok, true, r.message)
    assert.deepEqual(leftovers(s), [VERSION, '99.0.0'])
    assert.match(r.message, /Removed 0\.1\.0, older than this pin/)
    assert.ok(!r.message.includes('99.0.0'), 'a newer pin is not reported as removed')
  } finally {
    s.cleanup()
  }
})

test('provision: in the user cache the message says the directory is not on PATH and names the launcher; with it on PATH it does not', async () => {
  const s = setup()
  try {
    const home = join(s.root, 'home')
    mkdirSync(home, { recursive: true })
    const bin = join(home, '.cache', 'interlock', 'openspec', VERSION, 'openspec')
    const off = await provision({ env: { PATH: s.npmDir, HOME: home }, spawn: fakeSpawn().spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(off.ok, true, off.message)
    assert.equal(off.onPath, false)
    assert.equal(off.bin, bin)
    assert.match(off.message, /is not on PATH/)
    assert.ok(off.message.includes(`run it as ${bin}`), off.message)

    const on = await provision({ env: { PATH: `${s.npmDir}:${dirname(bin)}`, HOME: home }, spawn: fakeSpawn().spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(on.ok, true, on.message)
    assert.equal(on.already, true)
    assert.equal(on.onPath, true)
    assert.ok(!/not on PATH/.test(on.message), on.message)
  } finally {
    s.cleanup()
  }
})

test('openspec which: text output says "not on PATH" for a provisioned copy PATH does not hold, and not when it does', () => {
  const t = scratch()
  try {
    const data = join(t.root, 'data')
    const bin = provisioned(data)
    const say = env => {
      const out = []
      openspecCommand({ env, platform: process.platform, emit: (_json, _obj, text) => out.push(text), die: m => assert.fail(m) }, ['openspec', 'which'], {}, false)
      return out.join('')
    }
    const off = say({ PATH: '', INTERLOCK_PLUGIN_DATA: data })
    assert.match(off, /^openspec: provisioned -> /m)
    assert.match(off, /^not on PATH: a bare `openspec` does not find this copy; run it as /m)
    assert.ok(off.includes(bin), off)
    const on = say({ PATH: dirname(bin), INTERLOCK_PLUGIN_DATA: data })
    assert.ok(!/not on PATH/.test(on), on)
  } finally {
    t.cleanup()
  }
})

test('provision: a staging directory of a dead run, and an old one, are removed and counted; a live, fresh one is left', async () => {
  const s = setup()
  try {
    const now = Date.now()
    put(join(s.openspecDir, '.9.9.9.partial-111', 'x'), 'x')
    put(join(s.openspecDir, '.9.9.8.partial-222', 'x'), 'x')
    put(join(s.openspecDir, '.9.9.7.partial-333', 'x'), 'x')
    const longAgo = new Date(now - 3 * PROVISION_TIMEOUT_MS)
    utimesSync(join(s.openspecDir, '.9.9.8.partial-222'), longAgo, longAgo)
    const r = await provision({
      env: s.env,
      spawn: fakeSpawn().spawn,
      platform: process.platform,
      nodeVersion: NODE_OK,
      alive: pid => pid !== 111,
      now
    })
    assert.equal(r.ok, true, r.message)
    assert.deepEqual(leftovers(s), ['.9.9.7.partial-333', VERSION])
    assert.match(r.message, /Removed 2 stale staging directories left by an interrupted provision\./)
  } finally {
    s.cleanup()
  }
})

test('provision: one removed staging directory is counted in the singular, and the running process own pid is never swept', async () => {
  const s = setup()
  try {
    put(join(s.openspecDir, '.9.9.9.partial-111', 'x'), 'x')
    put(join(s.openspecDir, `.9.9.8.partial-${process.pid}`, 'x'), 'x')
    const r = await provision({ env: s.env, spawn: fakeSpawn().spawn, platform: process.platform, nodeVersion: NODE_OK, alive: pid => pid !== 111 })
    assert.equal(r.ok, true, r.message)
    assert.match(r.message, /Removed 1 stale staging directory left by an interrupted provision\./)
    // This process's own pid is never swept (the run stages under it), whatever `alive` says.
    assert.ok(existsSync(join(s.openspecDir, `.9.9.8.partial-${process.pid}`)))
  } finally {
    s.cleanup()
  }
})

test('provision: on win32 it also writes an openspec.cmd carrying the marker, which a PATH lookup does not mistake for a user CLI', async () => {
  const s = setup()
  const posix = setup()
  try {
    const r = await provision({ env: s.env, spawn: fakeSpawn().spawn, platform: 'win32', nodeVersion: NODE_OK })
    assert.equal(r.ok, true, r.message)
    assert.equal(r.bin, join(s.openspecDir, VERSION, 'openspec'), 'what provisionedBin returns is unchanged')
    const cmd = join(s.openspecDir, VERSION, 'openspec.cmd')
    const text = readFileSync(cmd, 'utf8')
    assert.ok(text.slice(0, 512).includes(LAUNCHER_MARKER))
    assert.ok(text.startsWith('@rem'), 'the marker rides a @rem comment')
    assert.ok(text.includes('node "%~dp0openspec" %*') && text.includes('exit /b %errorlevel%'))
    assert.ok(!/[^\r]\n/.test(text), 'CRLF throughout')
    assert.equal(text, cmdLauncherSource())

    // PATHEXT is spelled in lower case so the lookup also matches on a case-sensitive file system.
    const found = resolveOpenSpec({ platform: 'win32', env: { Path: dirname(r.bin), PATHEXT: '.cmd', INTERLOCK_PLUGIN_DATA: s.data } })
    assert.notEqual(found.source, 'path')
    assert.equal(found.source, 'provisioned')
    assert.equal(found.onPath, true)

    // A user's own openspec.cmd (no marker) is still the path source.
    const own = put(join(s.root, 'own', 'openspec.cmd'), '@echo off\r\n')
    const mine = resolveOpenSpec({ platform: 'win32', env: { Path: join(s.root, 'own'), PATHEXT: '.cmd', INTERLOCK_PLUGIN_DATA: s.data } })
    assert.equal(mine.source, 'path')
    assert.equal(mine.bin, own)

    const p = await provision({ env: posix.env, spawn: fakeSpawn().spawn, platform: process.platform, nodeVersion: NODE_OK })
    assert.equal(p.ok, true, p.message)
    assert.ok(!existsSync(join(posix.openspecDir, VERSION, 'openspec.cmd')), 'no .cmd off win32')
  } finally {
    s.cleanup()
    posix.cleanup()
  }
})

test('whichSync: an accept callback skips a rejected candidate and returns the next; the platform picks the separator', () => {
  const t = scratch()
  try {
    const a = execFile(join(t.root, 'a'), 'tool', { marker: true })
    const b = execFile(join(t.root, 'b'), 'tool')
    const env = { PATH: `${join(t.root, 'a')}:${join(t.root, 'b')}` }
    assert.equal(whichSync('tool', env), a, 'no accept: the first wins, as before')
    assert.equal(whichSync('tool', env, { accept: f => f !== a }), b)
    assert.equal(whichSync('tool', env, { accept: () => false }), null)
    // On win32 the separator is ';', so a ':' PATH is one (unusable) entry.
    assert.equal(whichSync('tool', env, { platform: 'win32' }), null)
    assert.equal(whichSync('tool', { Path: `${join(t.root, 'b')};${join(t.root, 'a')}`, PATHEXT: '' }, { platform: 'win32' }), b)
  } finally {
    t.cleanup()
  }
})

test('pathEntries splits by the given platform, reads Path on win32, and drops empty entries', () => {
  assert.deepEqual(pathEntries({ PATH: '/a::/b:' }, 'linux'), ['/a', '/b'])
  assert.deepEqual(pathEntries({ PATH: '/a;/b:/c' }, 'linux'), ['/a;/b', '/c'])
  assert.deepEqual(pathEntries({ Path: 'C:\\a;;C:\\b;' }, 'win32'), ['C:\\a', 'C:\\b'])
  assert.deepEqual(pathEntries({}, 'linux'), [])
})

// ---------------------------------------------------------------------------
// The package
// ---------------------------------------------------------------------------

test('nothing named openspec ships, the bin map has no openspec key, and the test script never names the contract script', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(!('openspec' in pkg.bin), 'package.json declares an openspec bin')
  assert.ok(!/openspec-contract/.test(pkg.scripts.test), pkg.scripts.test)
  assert.ok(existsSync(CONTRACT), 'scripts/openspec-contract.mjs exists')
  assert.ok(!CONTRACT.endsWith('.test.mjs'))
  const named = []
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.name === 'openspec') named.push(abs.slice(ROOT.length + 1))
    }
  }
  for (const entry of pkg.files) {
    const abs = join(ROOT, entry)
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) walk(abs)
    else if (basename(abs) === 'openspec') named.push(entry)
  }
  assert.deepEqual(named, [])
})

// ---------------------------------------------------------------------------
// The contract script, against a stub CLI
// ---------------------------------------------------------------------------

/**
 * A stand-in OpenSpec that answers the six commands the contract script runs, and
 * `--version`. `STUB_OMIT` names what to leave out: `status.applyRequires` drops that
 * field, `archive.sync` makes `archive` skip the copy into openspec/specs/.
 */
function stubCli(dir) {
  const body = `#!${process.execPath}
const fs = require('fs')
const path = require('path')
const a = process.argv.slice(2)
const omit = (process.env.STUB_OMIT || '').split(',')
const cwd = process.cwd()
const flag = name => { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined }
const changeDir = name => path.join(cwd, 'openspec', 'changes', name)
const json = value => process.stdout.write(JSON.stringify(value) + '\\n')
const copy = (from, to) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name)
    const dst = path.join(to, e.name)
    if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); copy(src, dst) } else fs.copyFileSync(src, dst)
  }
}
const [cmd, sub] = a
if (cmd === '--version') { console.log('9.9.9') }
else if (cmd === 'init') {
  fs.mkdirSync(path.join(cwd, 'openspec', 'specs'), { recursive: true })
  fs.mkdirSync(path.join(cwd, 'openspec', 'changes'), { recursive: true })
  fs.writeFileSync(path.join(cwd, 'openspec', 'config.yaml'), 'schema: spec-driven\\n')
}
else if (cmd === 'new' && sub === 'change') {
  fs.mkdirSync(changeDir(a[2]), { recursive: true })
  fs.writeFileSync(path.join(changeDir(a[2]), '.openspec.yaml'), 'schema: spec-driven\\n')
}
else if (cmd === 'status') {
  const name = flag('--change')
  const dir = changeDir(name)
  const out = {
    changeName: name,
    schemaName: 'spec-driven',
    isComplete: false,
    applyRequires: ['tasks'],
    artifacts: ['proposal', 'design', 'specs', 'tasks'].map(id => ({ id, outputPath: id === 'specs' ? 'specs/**/*.md' : id + '.md', status: 'ready' })),
    artifactPaths: {
      proposal: { resolvedOutputPath: path.join(dir, 'proposal.md') },
      design: { resolvedOutputPath: path.join(dir, 'design.md') },
      specs: { resolvedOutputPath: path.join(dir, 'specs', '**', '*.md') },
      tasks: { resolvedOutputPath: path.join(dir, 'tasks.md') }
    }
  }
  for (const key of omit) if (key.startsWith('status.')) delete out[key.slice('status.'.length)]
  json(out)
}
else if (cmd === 'instructions') {
  const name = flag('--change')
  json({ changeName: name, artifactId: sub, instruction: 'Write the ' + sub + '.', template: '## Why\\n', resolvedOutputPath: path.join(changeDir(name), sub + '.md') })
}
else if (cmd === 'validate') {
  const dir = changeDir(sub)
  const ok = ['proposal.md', 'design.md', 'tasks.md', path.join('specs', 'area', 'cap', 'spec.md')].every(f => fs.existsSync(path.join(dir, f)))
  if (!ok) { console.error('Change "' + sub + '" has issues: an artifact is missing'); process.exit(1) }
  console.log('Change "' + sub + '" is valid')
}
else if (cmd === 'archive') {
  const dir = changeDir(sub)
  if (!omit.includes('archive.sync') && fs.existsSync(path.join(dir, 'specs'))) {
    fs.mkdirSync(path.join(cwd, 'openspec', 'specs'), { recursive: true })
    copy(path.join(dir, 'specs'), path.join(cwd, 'openspec', 'specs'))
  }
  fs.mkdirSync(path.join(cwd, 'openspec', 'changes', 'archive'), { recursive: true })
  fs.renameSync(dir, path.join(cwd, 'openspec', 'changes', 'archive', 'done-' + sub))
}
else { console.error('unknown command: ' + a.join(' ')); process.exit(2) }
`
  return put(join(dir, 'stub-openspec'), body, 0o755)
}

function contract(stub, env = {}) {
  const home = mkdtempSync(join(tmpdir(), 'interlock-contract-home-'))
  try {
    const r = spawnSync(process.execPath, [CONTRACT, '--openspec', stub], {
      encoding: 'utf8',
      timeout: 60_000,
      // TMPDIR is forwarded: a sandbox that denies /tmp denies the script's scratch project.
      env: withNode({ PATH: '', HOME: home, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), ...env })
    })
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('contract script: a conforming stub passes, and one line names the CLI, its version and the checks passed', () => {
  const t = scratch()
  try {
    const stub = stubCli(t.root)
    const r = contract(stub)
    assert.equal(r.status, 0, r.out)
    const lines = r.stdout.split('\n').filter(l => l.trim())
    assert.equal(lines.length, 1, r.stdout)
    assert.ok(lines[0].includes(stub), lines[0])
    assert.ok(lines[0].includes('9.9.9'), lines[0])
    assert.match(lines[0], /\d+/)
    assert.match(lines[0], /pass/i)
  } finally {
    t.cleanup()
  }
})

test('contract script: a status --json with no applyRequires fails naming status.applyRequires', () => {
  const t = scratch()
  try {
    const r = contract(stubCli(t.root), { STUB_OMIT: 'status.applyRequires' })
    assert.notEqual(r.status, 0, r.out)
    assert.match(r.out, /status\.applyRequires/)
  } finally {
    t.cleanup()
  }
})

test('contract script: an archive that does not sync the nested delta into the living specs fails naming archive', () => {
  const t = scratch()
  try {
    const r = contract(stubCli(t.root), { STUB_OMIT: 'archive.sync' })
    assert.notEqual(r.status, 0, r.out)
    assert.match(r.out, /archive/)
  } finally {
    t.cleanup()
  }
})
