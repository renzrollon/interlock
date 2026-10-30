// The OpenSpec pin: one npm release recorded as a lockfile, every package carrying a
// sha512 integrity and a registry.npmjs.org source (spec: openspec-cli, "Interlock SHALL
// pin one OpenSpec npm release as a lockfile with an integrity per package").
//
// Imports the pin from `lib/openspec-pin.mjs` and its checker from
// `scripts/pin-openspec.mjs`, never from `lib/openspec-cli.mjs`: the pin cases turn green
// when the pin is generated, while the provisioner is still absent.
//
// Nothing here touches the network. `checkPin` and `buildPin` are pure, and the cases
// below hand them lockfiles built in this file.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OPENSPEC_PIN } from '../../lib/openspec-pin.mjs'
import { buildPin, checkPin } from '../../scripts/pin-openspec.mjs'
import { OPENSPEC_MIN_VERSION } from '../../lib/doctor.mjs'
import { compareVersions } from '../../lib/host/claude-env.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OPENSPEC_ENTRY = 'node_modules/@fission-ai/openspec'
const REGISTRY = 'https://registry.npmjs.org/'

/**
 * What a pure checker said, whichever way it says it: a thrown error, a list of
 * problems, or a `{ ok: false }` record. `failed` is whether it refused; `text` is
 * everything it named, so a case asserts what was named and not how it was returned.
 */
function outcome(fn) {
  let value
  try {
    value = fn()
  } catch (err) {
    return { failed: true, text: String((err && err.message) || err) }
  }
  if (Array.isArray(value)) return { failed: value.length > 0, text: value.join('\n') }
  if (value && typeof value === 'object' && value.ok === false) return { failed: true, text: JSON.stringify(value) }
  return { failed: false, text: '' }
}

const entry = (name, version, extra = {}) => ({
  version,
  resolved: `${REGISTRY}${name}/-/${name.split('/').pop()}-${version}.tgz`,
  integrity: 'sha512-AAAA',
  ...extra
})

/** A lockfile that satisfies every rule; a case overrides one entry. */
function lockfileOf(version, overrides = {}) {
  return {
    name: 'stage',
    lockfileVersion: 3,
    packages: {
      '': { name: 'stage', dependencies: { '@fission-ai/openspec': version } },
      [OPENSPEC_ENTRY]: entry('@fission-ai/openspec', version, { engines: { node: '>=20.19.0' } }),
      'node_modules/chalk': entry('chalk', '5.3.0'),
      'node_modules/yaml': entry('yaml', '2.5.0'),
      ...overrides
    }
  }
}

const pinOf = (version, lockfile) => ({ package: '@fission-ai/openspec', version, node: '20.19.0', lockfile })

// ---------------------------------------------------------------------------
// The committed pin
// ---------------------------------------------------------------------------

test('the committed pin is well formed and at or above the floor', () => {
  assert.equal(OPENSPEC_PIN.package, '@fission-ai/openspec')
  assert.match(OPENSPEC_PIN.version, /^\d+\.\d+\.\d+$/)
  assert.match(OPENSPEC_PIN.node, /^\d+\.\d+\.\d+$/)
  assert.ok(compareVersions(OPENSPEC_PIN.version, OPENSPEC_MIN_VERSION) >= 0, `${OPENSPEC_PIN.version} is below ${OPENSPEC_MIN_VERSION}`)
  assert.equal(OPENSPEC_PIN.lockfile.lockfileVersion, 3)
  assert.equal(OPENSPEC_PIN.lockfile.packages[OPENSPEC_ENTRY].version, OPENSPEC_PIN.version)
  assert.equal(Object.isFrozen(OPENSPEC_PIN), true, 'the pin is frozen')
  const problems = outcome(() => checkPin(OPENSPEC_PIN, OPENSPEC_MIN_VERSION))
  assert.equal(problems.failed, false, problems.text)
})

test('every package in the committed pin carries a sha512 integrity and a registry.npmjs.org source', () => {
  const entries = Object.entries(OPENSPEC_PIN.lockfile.packages).filter(([key]) => key !== '')
  assert.ok(entries.length > 1, 'the lockfile holds the whole dependency tree')
  const bad = []
  for (const [key, e] of entries) {
    if (!key.startsWith('node_modules/')) bad.push(`${key}: outside node_modules/`)
    if (typeof e.integrity !== 'string' || !e.integrity.startsWith('sha512-')) bad.push(`${key}: integrity ${e.integrity}`)
    if (typeof e.resolved !== 'string' || !e.resolved.startsWith(REGISTRY)) bad.push(`${key}: resolved ${e.resolved}`)
    if (e.hasInstallScript) bad.push(`${key}: has an install script`)
  }
  assert.deepEqual(bad, [])
})

test('the committed pin stays data: the file is under 64 KiB', () => {
  assert.ok(statSync(join(ROOT, 'lib', 'openspec-pin.mjs')).size < 64 * 1024)
})

// ---------------------------------------------------------------------------
// checkPin
// ---------------------------------------------------------------------------

test('checkPin: a pin below the floor fails naming both versions', () => {
  const r = outcome(() => checkPin(pinOf('1.7.0', lockfileOf('1.7.0')), '1.8.0'))
  assert.equal(r.failed, true)
  assert.match(r.text, /1\.7\.0/)
  assert.match(r.text, /1\.8\.0/)
})

test('checkPin: a package with a sha1 integrity fails naming it', () => {
  const lockfile = lockfileOf('1.15.0', { 'node_modules/yaml': entry('yaml', '2.5.0', { integrity: 'sha1-AAAA' }) })
  const r = outcome(() => checkPin(pinOf('1.15.0', lockfile), '1.8.0'))
  assert.equal(r.failed, true)
  assert.match(r.text, /node_modules\/yaml/)
  assert.doesNotMatch(r.text, /node_modules\/chalk/, 'only the offender is named')
})

test('checkPin: a pin whose openspec entry is another version, a package outside node_modules/, an install script and a foreign source each fail naming it', () => {
  const cases = [
    ['the entry at another version', lockfileOf('1.15.0', { [OPENSPEC_ENTRY]: entry('@fission-ai/openspec', '1.14.3') }), OPENSPEC_ENTRY],
    ['a key outside node_modules/', lockfileOf('1.15.0', { 'packages/local': entry('local', '1.0.0') }), 'packages/local'],
    ['an install script', lockfileOf('1.15.0', { 'node_modules/chalk': entry('chalk', '5.3.0', { hasInstallScript: true }) }), 'node_modules/chalk'],
    ['a foreign registry', lockfileOf('1.15.0', { 'node_modules/chalk': entry('chalk', '5.3.0', { resolved: 'https://example.invalid/chalk.tgz' }) }), 'node_modules/chalk']
  ]
  for (const [what, lockfile, named] of cases) {
    const r = outcome(() => checkPin(pinOf('1.15.0', lockfile), '1.8.0'))
    assert.equal(r.failed, true, what)
    assert.ok(r.text.includes(named), `${what}: ${r.text} must name ${named}`)
  }
})

test('checkPin: a well-formed lockfile at the floor passes', () => {
  const r = outcome(() => checkPin(pinOf('1.8.0', lockfileOf('1.8.0')), '1.8.0'))
  assert.equal(r.failed, false, r.text)
})

// ---------------------------------------------------------------------------
// buildPin
// ---------------------------------------------------------------------------

test('buildPin: a package that resolves to a git URL fails naming it', () => {
  const lockfile = lockfileOf('1.15.0', {
    'node_modules/chalk': entry('chalk', '5.3.0', { resolved: 'git+ssh://git@github.com/chalk/chalk.git#abc123' })
  })
  const r = outcome(() => buildPin(lockfile, '1.15.0'))
  assert.equal(r.failed, true)
  assert.match(r.text, /node_modules\/chalk/)
})

test('buildPin: an entry with an install script, and an engines range that is not a single floor, each fail', () => {
  const withScript = lockfileOf('1.15.0', { 'node_modules/chalk': entry('chalk', '5.3.0', { hasInstallScript: true }) })
  const script = outcome(() => buildPin(withScript, '1.15.0'))
  assert.equal(script.failed, true)
  assert.match(script.text, /node_modules\/chalk/)
  const ranged = lockfileOf('1.15.0', {
    [OPENSPEC_ENTRY]: entry('@fission-ai/openspec', '1.15.0', { engines: { node: '>=18 <23' } })
  })
  const range = outcome(() => buildPin(ranged, '1.15.0'))
  assert.equal(range.failed, true)
  assert.ok(range.text.includes('@fission-ai/openspec') || range.text.includes(OPENSPEC_ENTRY), range.text)
})

test('buildPin: a clean lockfile builds the record from the package, the version and engines.node', () => {
  const lockfile = lockfileOf('1.15.0')
  const pin = buildPin(lockfile, '1.15.0')
  assert.equal(pin.package, '@fission-ai/openspec')
  assert.equal(pin.version, '1.15.0')
  assert.equal(pin.node, '20.19.0')
  assert.equal(pin.lockfile.lockfileVersion, 3)
  assert.equal(pin.lockfile.packages[OPENSPEC_ENTRY].version, '1.15.0')
  assert.ok('node_modules/chalk' in pin.lockfile.packages)
  // What it built is what checkPin accepts.
  const again = outcome(() => checkPin(pin, OPENSPEC_MIN_VERSION))
  assert.equal(again.failed, false, again.text)
})
