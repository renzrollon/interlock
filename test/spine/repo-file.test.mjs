// The repository-confined reader and writer the artifact gate's I/O goes through
// (PR #47 review, H1-H3 and M3): a path is inside the root as written and again
// once its links are resolved, a reason never quotes a file, nothing throws.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { locateRepoFile, readRepoFile, writeRepoFile } from '../../lib/repo-file.mjs'

let root
let outside

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'interlock-repo-file-'))
  outside = mkdtempSync(join(tmpdir(), 'interlock-repo-file-outside-'))
  writeFileSync(join(outside, '.env'), 'API_SECRET=hunter2\n')
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'a.md'), 'hello\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test('readRepoFile reads a regular file inside the root, by a relative or an absolute path', () => {
  assert.equal(readRepoFile(root, 'docs/a.md').text, 'hello\n')
  assert.equal(readRepoFile(root, join(root, 'docs', 'a.md')).text, 'hello\n')
})

test('an absolute path naming the root by its real path is inside it (macOS /var and /private/var)', () => {
  const real = realpathSync(root)
  assert.equal(readRepoFile(root, join(real, 'docs', 'a.md')).ok, true)
})

test('readRepoFile answers absent for a missing file and refuses a path outside the root', () => {
  const missing = readRepoFile(root, 'docs/none.md')
  assert.equal(missing.ok, false)
  assert.equal(missing.absent, true)
  const out = readRepoFile(root, join(outside, '.env'))
  assert.equal(out.ok, false)
  assert.equal(out.absent, undefined)
  assert.match(out.reason, /outside the repository root/)
  assert.equal(readRepoFile(root, '../x').ok, false)
})

test('a link out of the root is refused, a link inside it is followed, and no reason quotes the file', () => {
  symlinkSync(join(outside, '.env'), join(root, 'docs', 'leak.md'))
  const leak = readRepoFile(root, 'docs/leak.md')
  assert.equal(leak.ok, false)
  assert.match(leak.reason, /outside the repository root/)
  assert.ok(!leak.reason.includes('API_SECRET'), leak.reason)
  symlinkSync(join(root, 'docs', 'a.md'), join(root, 'docs', 'inside.md'))
  assert.equal(readRepoFile(root, 'docs/inside.md').text, 'hello\n')
  symlinkSync(outside, join(root, 'out'))
  assert.equal(readRepoFile(root, 'out/.env').ok, false)
  assert.equal(locateRepoFile(root, 'out/.env').ok, false)
})

test('a directory is not a regular file, and a file over the cap is refused by its size alone', () => {
  assert.match(readRepoFile(root, 'docs').reason, /not a regular file/)
  const big = readRepoFile(root, 'docs/a.md', { maxBytes: 3 })
  assert.equal(big.ok, false)
  assert.match(big.reason, /6 bytes, over the 3-byte cap/)
  assert.equal(readRepoFile(root, 'docs/a.md', { maxBytes: 6 }).ok, true)
})

test('writeRepoFile makes the directory and writes inside the root', () => {
  assert.deepEqual(writeRepoFile(root, 'a/b/c.json', '{}\n'), { ok: true })
  assert.equal(readFileSync(join(root, 'a', 'b', 'c.json'), 'utf8'), '{}\n')
  assert.equal(writeRepoFile(root, 'a/b/c.json', '[]\n').ok, true, 'a regular file is overwritten')
  assert.equal(readFileSync(join(root, 'a', 'b', 'c.json'), 'utf8'), '[]\n')
})

test('writeRepoFile refuses a path outside, an ancestor that links out, and a link at the file', () => {
  assert.equal(writeRepoFile(root, '../escape.json', 'x').ok, false)
  symlinkSync(outside, join(root, 'link'))
  const viaDir = writeRepoFile(root, 'link/deeper/x.json', 'x')
  assert.equal(viaDir.ok, false)
  assert.match(viaDir.reason, /links outside the repository root/)
  assert.equal(existsSync(join(outside, 'deeper')), false, 'no directory was made outside the root')
  symlinkSync(join(outside, '.env'), join(root, 'docs', 'target.json'))
  const viaFile = writeRepoFile(root, 'docs/target.json', 'x')
  assert.equal(viaFile.ok, false)
  assert.equal(readFileSync(join(outside, '.env'), 'utf8'), 'API_SECRET=hunter2\n')
  assert.deepEqual(readdirSync(outside).sort(), ['.env'])
})
