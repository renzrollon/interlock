// The locator vocabulary is shared by two surfaces that audit citations — a
// review skeptic's prose and a wave handoff packet's evidence array. These
// tests pin the two properties that decide whether a citation matches, because
// both are the kind of thing a well-meaning "normalization" would break:
//
//   - `./lib/a.mjs` and `lib/a.mjs` are ONE identity, so a locator is not
//     rejected over a spelling nobody can see.
//   - `lib/A.mjs` and `lib/a.mjs` are TWO identities, so a case-differing
//     locator is not confirmed by a path the task never touched. Case-folding
//     here would silently confirm citations on every case-sensitive filesystem
//     the repo actually runs on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizePath, citesLineIn, diffIndex, locatorPath } from '../../lib/locators.mjs'

test('the canonicalizer strips a leading ./ so one file is one identity', () => {
  assert.equal(canonicalizePath('./lib/export.mjs'), 'lib/export.mjs')
  assert.equal(canonicalizePath('lib/./export.mjs'), 'lib/export.mjs')
  assert.equal(canonicalizePath('lib/export.mjs'), 'lib/export.mjs')
})

test('the canonicalizer does NOT case-fold, so a case-differing path is not a match', () => {
  assert.equal(canonicalizePath('lib/Export.mjs'), 'lib/Export.mjs')
  assert.notEqual(canonicalizePath('lib/Export.mjs'), canonicalizePath('lib/export.mjs'))

  // The property that matters is the one the audit reads: membership.
  const index = diffIndex(['lib/export.mjs'])
  assert.equal(index.has(canonicalizePath('./lib/export.mjs')), true)
  assert.equal(index.has(canonicalizePath('lib/Export.mjs')), false)
})

test('a path that cannot be placed in the repository is no identity at all', () => {
  for (const outside of ['/etc/passwd', '../secrets.mjs', 'C:/Windows/system32', '.', '']) {
    assert.equal(canonicalizePath(outside), null, `${JSON.stringify(outside)} must not canonicalize`)
  }
})

test('diffIndex holds both the canonical identity and the spelling the caller used', () => {
  const index = diffIndex(['./lib/export.mjs', '  test/export.test.mjs  '])
  assert.equal(index.has('lib/export.mjs'), true)
  assert.equal(index.has('./lib/export.mjs'), true, 'the authored spelling is kept too')
  assert.equal(index.has('test/export.test.mjs'), true)
})

test('an absent path set is null, not an empty set', () => {
  // "We could not name the changed files" and "nothing changed" are different
  // facts about a citation that failed, so they must not be one value.
  assert.equal(diffIndex([]), null)
  assert.equal(diffIndex(undefined), null)
  assert.equal(diffIndex(['', '   ']), null)
})

test('locatorPath takes the path half of a discrete locator', () => {
  assert.equal(locatorPath('lib/export.mjs'), 'lib/export.mjs')
  assert.equal(locatorPath('lib/export.mjs:40'), 'lib/export.mjs')
  assert.equal(locatorPath('lib/export.mjs:40-58'), 'lib/export.mjs')
  assert.equal(locatorPath('./lib/export.mjs:12'), 'lib/export.mjs')
  assert.equal(locatorPath('/etc/passwd:1'), null)
  assert.equal(locatorPath(42), null)
})

test('citesLineIn finds a cited path even when the path contains a space', () => {
  assert.equal(citesLineIn('see src/my file.ts:12 for the fix', 'src/my file.ts'), true)
  assert.equal(citesLineIn('see src/my file.ts for the fix', 'src/my file.ts'), false)
})
