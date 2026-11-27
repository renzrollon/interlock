import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestCommand } from '../../lib/cli-flags.mjs'

const NAMES = ['validate', 'verify', 'review', 'run', 'doctor', 'settle']

test('suggestCommand names the nearest command', () => {
  assert.equal(suggestCommand('valdiate', NAMES), 'validate')
  assert.equal(suggestCommand('verfy', NAMES), 'verify')
})

test('suggestCommand returns null when nothing is near', () => {
  assert.equal(suggestCommand('xyzzy-plugh', NAMES), null)
  assert.equal(suggestCommand('', NAMES), null)
})

test('suggestCommand allows a short input one edit only', () => {
  assert.equal(suggestCommand('rn', NAMES), 'run')
  assert.equal(suggestCommand('xq', NAMES), null, 'two edits from run')
  assert.equal(suggestCommand('rvw', NAMES), null, 'three letters, more than one edit from any name')
  assert.equal(suggestCommand('settel', NAMES), 'settle', 'five letters or more keep two edits')
})

test('suggestCommand returns an exact name as itself', () => {
  assert.equal(suggestCommand('doctor', NAMES), 'doctor')
})
