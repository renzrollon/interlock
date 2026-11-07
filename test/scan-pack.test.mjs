// scripts/plugin-scan-pack.mjs (`npm run scan-pack`): the bundle lands on a
// local branch through a temporary index, and nothing is pushed.
// Spec: distribution/npm-package, "The scan pack SHALL build the bundle onto a
// local branch and SHALL NOT push" (change remove-the-push-notification).
//
// The script resolves its repository from its own location, so each test copies
// it into a throwaway repository with a two-file package and runs it there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(ROOT, 'scripts', 'plugin-scan-pack.mjs')

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'scan-pack test',
  GIT_AUTHOR_EMAIL: 'scan-pack@example.invalid',
  GIT_COMMITTER_NAME: 'scan-pack test',
  GIT_COMMITTER_EMAIL: 'scan-pack@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null'
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A committed repository holding a two-file package and a copy of the script. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'interlock-scan-pack-test-'))
  mkdirSync(join(dir, '.claude-plugin'))
  mkdirSync(join(dir, 'lib'))
  mkdirSync(join(dir, 'scripts'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'scan-pack-fixture', version: '0.0.1', files: ['.claude-plugin', 'lib'] }, null, 2) + '\n'
  )
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture', version: '0.0.1' }) + '\n')
  writeFileSync(join(dir, 'lib', 'a.mjs'), 'export const a = 1\n')
  writeFileSync(join(dir, 'NOT-SHIPPED.md'), 'stays out of the pack\n')
  copyFileSync(SCRIPT, join(dir, 'scripts', 'plugin-scan-pack.mjs'))
  git(dir, ['init', '-q', '-b', 'work'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'fixture'])
  return dir
}

function scanPack(dir, args = []) {
  return spawnSync(process.execPath, [join(dir, 'scripts', 'plugin-scan-pack.mjs'), ...args], {
    cwd: dir,
    env: ENV,
    encoding: 'utf8'
  })
}

test('scan pack: the bundle lands on temp/plugin-scan, the checkout is untouched, and nothing is pushed', t => {
  const dir = fixture()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const statusBefore = git(dir, ['status', '--porcelain', '--untracked-files=all'])
  const indexBefore = readFileSync(join(dir, '.git', 'index'))

  const ran = scanPack(dir)
  assert.equal(ran.status, 0, ran.stderr)

  const files = git(dir, ['ls-tree', '-r', '--name-only', 'temp/plugin-scan']).split('\n').sort()
  assert.deepEqual(files, ['.claude-plugin/plugin.json', 'lib/a.mjs', 'package.json'])
  assert.equal(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'work')
  assert.equal(git(dir, ['status', '--porcelain', '--untracked-files=all']), statusBefore)
  assert.ok(readFileSync(join(dir, '.git', 'index')).equals(indexBefore), 'the real index was rewritten')

  assert.match(ran.stdout, /git push origin temp\/plugin-scan/)
  assert.match(ran.stdout, /Validate against temp\/plugin-scan/)
  assert.equal(git(dir, ['remote']), '', 'the fixture has no remote to push to')
  assert.doesNotMatch(git(dir, ['log', '-1', '--format=%B', 'temp/plugin-scan']), /uncommitted changes/)
})

test('scan pack: an untracked file under a shipped path marks the next pack, which builds on the previous tip', t => {
  const dir = fixture()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(scanPack(dir).status, 0)
  const first = git(dir, ['rev-parse', 'temp/plugin-scan'])

  writeFileSync(join(dir, 'NOT-SHIPPED-2.md'), 'outside files\n')
  const clean = scanPack(dir)
  assert.equal(clean.status, 0, clean.stderr)
  assert.doesNotMatch(git(dir, ['log', '-1', '--format=%B', 'temp/plugin-scan']), /uncommitted changes/, 'a path that does not ship marked the pack')
  const second = git(dir, ['rev-parse', 'temp/plugin-scan'])
  assert.equal(git(dir, ['rev-parse', `${second}^`]), first)

  writeFileSync(join(dir, 'lib', 'b.mjs'), 'export const b = 2\n')
  const dirty = scanPack(dir)
  assert.equal(dirty.status, 0, dirty.stderr)
  assert.match(git(dir, ['log', '-1', '--format=%B', 'temp/plugin-scan']), /with uncommitted changes/)
  assert.equal(git(dir, ['rev-parse', 'temp/plugin-scan^']), second)
  assert.ok(git(dir, ['ls-tree', '-r', '--name-only', 'temp/plugin-scan']).split('\n').includes('lib/b.mjs'))
})

test('scan pack: refuses to write the branch that is checked out', t => {
  const dir = fixture()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const refsBefore = git(dir, ['for-each-ref', '--format=%(refname) %(objectname)'])
  const ran = scanPack(dir, ['--branch', 'work'])
  assert.equal(ran.status, 1)
  assert.match(ran.stderr, /refusing to write work while it is checked out/)
  assert.equal(ran.stdout, '')
  assert.equal(git(dir, ['for-each-ref', '--format=%(refname) %(objectname)']), refsBefore)
})

test('scan pack: the script runs no push and opens no network connection', () => {
  const source = readFileSync(SCRIPT, 'utf8')
  assert.doesNotMatch(source, /\[\s*['"]push['"]/, 'a git argv starts with push')
  assert.doesNotMatch(source, /'git',\s*\[[^\]]*['"]push['"]/, 'a git argv names push')
  const net = "['\"](?:node:)?(?:https?|http2|net|tls|dgram)['\"]"
  assert.doesNotMatch(source, new RegExp(`(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)${net}`), 'a network module is loaded')
  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /['"](?:curl|wget)['"]/, 'a download tool is spawned')
  assert.match(source, /'pack', '--json', '--offline', '--no-update-notifier'/, 'npm pack may reach the registry')
})

test('scan pack: reads the npm 12 `npm pack --json` shape, an object keyed by package name', t => {
  // npm <= 11 prints an array of entries; npm 12, which the release job runs,
  // prints `{ "<name>": { filename, entryCount, ... } }`. v1.15.0's release job
  // failed on exactly this. A shim npm rewraps the real output into that shape.
  const dir = fixture()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const realNpm = execFileSync('sh', ['-c', 'command -v npm'], { env: ENV, encoding: 'utf8' }).trim()
  const shimDir = join(dir, '.shim')
  mkdirSync(shimDir)
  writeFileSync(
    join(shimDir, 'npm'),
    `#!${process.execPath}\n` +
      "const { spawnSync } = require('node:child_process')\n" +
      `const ran = spawnSync(${JSON.stringify(realNpm)}, process.argv.slice(2), { encoding: 'utf8' })\n` +
      'let out = ran.stdout\n' +
      "if (process.argv.includes('--json')) { const r = JSON.parse(out); if (Array.isArray(r)) out = JSON.stringify(Object.fromEntries(r.map(e => [e.name, e]))) }\n" +
      'process.stdout.write(out); process.stderr.write(ran.stderr); process.exit(ran.status ?? 1)\n',
    { mode: 0o755 }
  )
  writeFileSync(join(shimDir, 'package.json'), '{"type":"commonjs"}\n')

  const ran = spawnSync(process.execPath, [join(dir, 'scripts', 'plugin-scan-pack.mjs')], {
    cwd: dir,
    env: { ...ENV, PATH: `${shimDir}:${ENV.PATH}` },
    encoding: 'utf8'
  })
  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /\(3 files, plugin 0\.0\.1/)
  const files = git(dir, ['ls-tree', '-r', '--name-only', 'temp/plugin-scan']).split('\n').sort()
  assert.deepEqual(files, ['.claude-plugin/plugin.json', 'lib/a.mjs', 'package.json'])
})
