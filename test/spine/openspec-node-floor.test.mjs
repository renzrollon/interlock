import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodeFloorOf, declaredNodeFloor } from '../../lib/openspec-node-floor.mjs'

const PKG = '@fission-ai/openspec'

function root() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'node-floor-')))
}

function pkgDir(base, manifest, raw) {
  const dir = join(base, 'lib', 'node_modules', ...PKG.split('/'))
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), raw ?? JSON.stringify(manifest))
  writeFileSync(join(dir, 'bin', 'openspec.js'), '')
  return dir
}

test('nodeFloorOf table', () => {
  assert.equal(nodeFloorOf('>=20.19.0'), '20.19.0')
  assert.equal(nodeFloorOf(' >= 22.12.0 '), '22.12.0')
  assert.equal(nodeFloorOf('>=18'), null)
  assert.equal(nodeFloorOf('>=18 <23'), null)
  assert.equal(nodeFloorOf('^20.19.0'), null)
  assert.equal(nodeFloorOf('20.19.0'), null)
  assert.equal(nodeFloorOf(undefined), null)
  assert.equal(nodeFloorOf(22), null)
})

test('a declared >=20.19.0 is the floor', () => {
  const b = root()
  try {
    const dir = pkgDir(b, { name: PKG, engines: { node: '>=20.19.0' } })
    assert.deepEqual(declaredNodeFloor(join(dir, 'bin', 'openspec.js'), PKG, 'linux'), { floor: '20.19.0', reason: null })
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('a symlinked bin resolves through its realpath', () => {
  const b = root()
  try {
    const dir = pkgDir(b, { name: PKG, engines: { node: '>=20.19.0' } })
    mkdirSync(join(b, 'bin'))
    const link = join(b, 'bin', 'openspec')
    symlinkSync(join(dir, 'bin', 'openspec.js'), link)
    assert.equal(declaredNodeFloor(link, PKG, 'darwin').floor, '20.19.0')
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('a manifest of another package name is skipped and the walk goes on', () => {
  const b = root()
  try {
    const dir = pkgDir(b, { name: PKG, engines: { node: '>=20.19.0' } })
    writeFileSync(join(dir, 'bin', 'package.json'), JSON.stringify({ name: 'other', engines: { node: '>=99.0.0' } }))
    assert.equal(declaredNodeFloor(join(dir, 'bin', 'openspec.js'), PKG, 'linux').floor, '20.19.0')
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('a range that is not one >=x.y.z returns no floor with a reason', () => {
  const b = root()
  try {
    const dir = pkgDir(b, { name: PKG, engines: { node: '>=18 <23' } })
    const got = declaredNodeFloor(join(dir, 'bin', 'openspec.js'), PKG, 'linux')
    assert.equal(got.floor, null)
    assert.match(got.reason, />=18 <23/)
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('no engines returns no floor with a reason', () => {
  const b = root()
  try {
    const dir = pkgDir(b, { name: PKG })
    const got = declaredNodeFloor(join(dir, 'bin', 'openspec.js'), PKG, 'linux')
    assert.equal(got.floor, null)
    assert.match(got.reason, /engines\.node/)
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('broken JSON returns no floor and does not throw', () => {
  const b = root()
  try {
    const dir = pkgDir(b, null, '{ not json')
    const got = declaredNodeFloor(join(dir, 'bin', 'openspec.js'), PKG, 'linux')
    assert.equal(got.floor, null)
    assert.match(got.reason, /not valid JSON/)
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('no manifest within four levels returns no floor with a reason', () => {
  const b = root()
  try {
    const deep = join(b, 'a', 'b', 'c', 'd', 'e', 'f')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(b, 'package.json'), JSON.stringify({ name: PKG, engines: { node: '>=20.19.0' } }))
    writeFileSync(join(deep, 'openspec'), '')
    const got = declaredNodeFloor(join(deep, 'openspec'), PKG, 'linux')
    assert.equal(got.floor, null)
    assert.match(got.reason, /four|4 levels/)
  } finally { rmSync(b, { recursive: true, force: true }) }
})

test('a missing path returns no floor and does not throw', () => {
  assert.equal(declaredNodeFloor('/nonexistent/x/openspec', PKG, 'linux').floor, null)
  assert.equal(declaredNodeFloor(undefined, PKG, 'linux').floor, null)
})

test('the win32 shim layout reads node_modules/<package>/package.json beside it', () => {
  const b = root()
  try {
    const dir = join(b, 'node_modules', ...PKG.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PKG, engines: { node: '>=20.19.0' } }))
    for (const ext of ['cmd', 'bat', 'ps1']) {
      assert.equal(declaredNodeFloor(join(b, `openspec.${ext}`), PKG, 'win32').floor, '20.19.0')
    }
    const none = declaredNodeFloor(join(root(), 'openspec.cmd'), PKG, 'win32')
    assert.equal(none.floor, null)
    assert.ok(none.reason)
  } finally { rmSync(b, { recursive: true, force: true }) }
})
