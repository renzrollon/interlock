import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOKENS } from '../src/tokens.mjs'

test('TOKENS carries a light and a dark palette', () => {
  assert.deepEqual(Object.keys(TOKENS).sort(), ['dark', 'light'])
  assert.deepEqual(TOKENS.light, { bg: '#ffffff', fg: '#111111' })
  assert.deepEqual(TOKENS.dark, { bg: '#111111', fg: '#ffffff' })
})
