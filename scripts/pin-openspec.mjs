#!/usr/bin/env node
// Regenerate lib/openspec-pin.mjs, the one OpenSpec npm release Interlock
// provisions (design "The pin is a lockfile, generated"; D4, D7, D18).
//
// Development tooling only. `scripts/` is not in package.json `files`, so this
// never ships, and nothing in `npm test` runs its main: the unit suite imports
// the two pure exports, `checkPin` and `buildPin`, and hands them lockfiles it
// builds itself, so the suite never touches the network.
//
// What it does:
//   1. In the realpath of a fresh `mkdtemp` directory (a symlinked tmp prefix
//      would write `../../../private/tmp/…` keys), write the same package.json
//      provisioning writes, naming the exact version.
//   2. Run `npm install --package-lock-only --ignore-scripts` there. That
//      resolves the tree and writes the lockfile, and installs nothing.
//   3. Build the record from that lockfile and check it. Any entry that breaks
//      a rule is named and the script exits 1 with the pin file untouched.
//   4. Only then rewrite lib/openspec-pin.mjs. The pin file is data only, so
//      regenerating it rewrites no code.
//
// The rules (checkPin): the package is `@fission-ai/openspec` at a version at
// or above the floor, the lockfile is version 3, its `@fission-ai/openspec`
// entry is at that version with an `engines.node` of one `>=x.y.z`, and every
// package entry sits under `node_modules/`, carries a `sha512-` integrity, is
// resolved from https://registry.npmjs.org/ and has no install script.
//
// Usage:
//   node scripts/pin-openspec.mjs <version>
//
// It needs npm and the registry. Inside the Bash sandbox the registry may be
// refused; one run outside the sandbox regenerates the pin.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compareVersions } from '../lib/host/claude-env.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PIN_FILE = join(HERE, '..', 'lib', 'openspec-pin.mjs')

export const OPENSPEC_PACKAGE = '@fission-ai/openspec'
export const OPENSPEC_ENTRY = `node_modules/${OPENSPEC_PACKAGE}`
export const REGISTRY = 'https://registry.npmjs.org/'

// The floor the pin is held to is the doctor's. Read it without a static
// import, so a missing or broken pin file (which the doctor's own imports may
// come to need) never stops this script from regenerating it. A floor that
// cannot be read is said by main, never assumed away.
const DEFAULT_FLOOR = await import('../lib/doctor.mjs').then(m => m.OPENSPEC_MIN_VERSION, () => null)

const SEMVER = /^\d+\.\d+\.\d+$/

/**
 * The Node floor an `engines.node` value states, when it is exactly one
 * `>=x.y.z`; null for anything else (a range, a caret, a bare major).
 */
export function nodeFloorOf(range) {
  if (typeof range !== 'string') return null
  const m = /^\s*>=\s*(\d+\.\d+\.\d+)\s*$/.exec(range)
  return m ? m[1] : null
}

/**
 * Every rule `pin` breaks, one line each, naming the entry or both versions.
 * An empty list is a pin provisioning can trust.
 *
 * @param {{ package?: string, version?: string, node?: string, lockfile?: object }} pin
 * @param {string|null} floor the lowest OpenSpec version Interlock supports
 * @returns {string[]}
 */
export function checkPin(pin, floor) {
  const problems = []
  if (!pin || typeof pin !== 'object') return ['the pin is not a record']
  if (pin.package !== OPENSPEC_PACKAGE) problems.push(`the pin names package ${JSON.stringify(pin.package)}, not ${OPENSPEC_PACKAGE}`)
  const version = pin.version
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    problems.push(`the pin's version ${JSON.stringify(version)} is not major.minor.patch`)
  } else if (floor) {
    const order = compareVersions(version, floor)
    if (order === null) problems.push(`the pin's version ${version} cannot be compared with the floor ${floor}`)
    else if (order < 0) problems.push(`the pin's version ${version} is below the floor ${floor}`)
  }
  if (typeof pin.node !== 'string' || !SEMVER.test(pin.node)) {
    problems.push(`the pin's node floor ${JSON.stringify(pin.node)} is not major.minor.patch`)
  }

  const lockfile = pin.lockfile
  if (!lockfile || typeof lockfile !== 'object') return [...problems, 'the pin carries no lockfile']
  if (lockfile.lockfileVersion !== 3) problems.push(`the lockfile is version ${JSON.stringify(lockfile.lockfileVersion)}, not 3`)
  const packages = lockfile.packages
  if (!packages || typeof packages !== 'object') return [...problems, 'the lockfile has no packages']

  const own = packages[OPENSPEC_ENTRY]
  if (!own || typeof own !== 'object') {
    problems.push(`${OPENSPEC_ENTRY} is missing from the lockfile`)
  } else {
    if (own.version !== version) problems.push(`${OPENSPEC_ENTRY} is at ${JSON.stringify(own.version)}, not the pin's ${version}`)
    const engines = own.engines && typeof own.engines === 'object' ? own.engines.node : undefined
    const nodeFloor = nodeFloorOf(engines)
    if (!nodeFloor) problems.push(`${OPENSPEC_ENTRY} declares engines.node ${JSON.stringify(engines)}, not a single >=x.y.z`)
    else if (typeof pin.node === 'string' && nodeFloor !== pin.node) {
      problems.push(`${OPENSPEC_ENTRY} declares engines.node ${engines}, but the pin's node floor is ${pin.node}`)
    }
  }

  for (const [key, e] of Object.entries(packages)) {
    if (key === '') continue
    if (!key.startsWith('node_modules/')) {
      problems.push(`${key}: outside node_modules/`)
      continue
    }
    if (!e || typeof e !== 'object') {
      problems.push(`${key}: not an entry`)
      continue
    }
    if (typeof e.integrity !== 'string' || !e.integrity.startsWith('sha512-')) {
      problems.push(`${key}: integrity ${JSON.stringify(e.integrity)} is not sha512-`)
    }
    if (typeof e.resolved !== 'string' || !e.resolved.startsWith(REGISTRY)) {
      problems.push(`${key}: resolved ${JSON.stringify(e.resolved)} is outside ${REGISTRY}`)
    }
    if (e.hasInstallScript) problems.push(`${key}: has an install script`)
  }
  return problems
}

/**
 * The pin record for `version`, built from the lockfile npm generated, after
 * `checkPin` accepts it. Throws, naming every problem, when it does not.
 *
 * The lockfile is kept as npm wrote it, apart from the root's `name` and
 * `version`, which come from the scratch directory and would make two runs of
 * the same version differ.
 *
 * @param {object} lockfile a parsed package-lock.json
 * @param {string} version the OpenSpec version it was generated for
 * @param {string|null} [floor]
 */
export function buildPin(lockfile, version, floor = DEFAULT_FLOOR) {
  if (!lockfile || typeof lockfile !== 'object' || !lockfile.packages || typeof lockfile.packages !== 'object') {
    throw new Error('the generated lockfile has no packages')
  }
  const own = lockfile.packages[OPENSPEC_ENTRY]
  const engines = own && own.engines && typeof own.engines === 'object' ? own.engines.node : undefined
  const { name: _name, version: _version, ...rest } = lockfile
  const packages = { ...lockfile.packages }
  if (packages['']) {
    const { name: _rootName, version: _rootVersion, ...root } = packages['']
    packages[''] = root
  }
  const pin = {
    package: OPENSPEC_PACKAGE,
    version,
    node: nodeFloorOf(engines),
    lockfile: { ...rest, packages }
  }
  const problems = checkPin(pin, floor)
  if (problems.length) throw new Error(`the pin for ${OPENSPEC_PACKAGE}@${version} was not written:\n  ${problems.join('\n  ')}`)
  return pin
}

/** Deep-freeze a JSON value, so the generated module exports an immutable pin. */
function frozenLiteral(value, indent = '') {
  if (Array.isArray(value)) {
    if (!value.length) return 'Object.freeze([])'
    const inner = indent + '  '
    return `Object.freeze([\n${value.map(v => inner + frozenLiteral(v, inner)).join(',\n')}\n${indent}])`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    if (!keys.length) return 'Object.freeze({})'
    const inner = indent + '  '
    return `Object.freeze({\n${keys.map(k => `${inner}${JSON.stringify(k)}: ${frozenLiteral(value[k], inner)}`).join(',\n')}\n${indent}})`
  }
  return JSON.stringify(value)
}

/** The text of lib/openspec-pin.mjs for `pin`. */
export function renderPinModule(pin) {
  return [
    '// Generated by scripts/pin-openspec.mjs from `npm install --package-lock-only`.',
    '// Regenerate it; never edit it by hand.',
    '//',
    '// The one OpenSpec npm release `interlock openspec provision` installs: its',
    '// package, its version, the Node floor its engines.node declares, and the npm',
    '// lockfile of its whole tree. npm ci installs exactly this lockfile and refuses',
    '// any package whose sha512 differs, so trusting the installed tree is trusting',
    '// the plugin release that carries this file.',
    '',
    `export const OPENSPEC_PIN = ${frozenLiteral(pin)}`,
    ''
  ].join('\n')
}

function lastLine(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

function main(argv) {
  const version = argv[0]
  if (!version || !SEMVER.test(version)) {
    process.stderr.write('usage: node scripts/pin-openspec.mjs <version>   (e.g. 1.15.0)\n')
    return 2
  }
  if (!DEFAULT_FLOOR) process.stderr.write('pin-openspec: the doctor floor could not be read; the pin is checked without a floor\n')
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'interlock-pin-')))
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, dependencies: { [OPENSPEC_PACKAGE]: version } }, null, 2) + '\n')
    const npm = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: dir,
      encoding: 'utf8',
      shell: process.platform === 'win32'
    })
    if (npm.error || npm.status !== 0) {
      const line = lastLine(npm.stderr) || (npm.error && npm.error.message) || `exit ${npm.status}`
      process.stderr.write(`pin-openspec: npm could not resolve ${OPENSPEC_PACKAGE}@${version}: ${line}\n`)
      process.stderr.write('pin-openspec: the pin file is unchanged. If the registry was refused, one run outside the sandbox regenerates it.\n')
      return 1
    }
    const lockfile = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
    let pin
    try {
      pin = buildPin(lockfile, version)
    } catch (err) {
      process.stderr.write(`pin-openspec: ${err.message}\n`)
      return 1
    }
    const text = renderPinModule(pin)
    writeFileSync(PIN_FILE, text)
    const count = Object.keys(pin.lockfile.packages).filter(k => k !== '').length
    process.stdout.write(`pinned ${OPENSPEC_PACKAGE}@${pin.version} (node >=${pin.node}, ${count} packages, ${Buffer.byteLength(text)} bytes) in lib/openspec-pin.mjs\n`)
    return 0
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}
