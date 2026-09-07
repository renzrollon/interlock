import { test } from 'node:test'
import assert from 'node:assert/strict'
import { themeFor } from '../src/theme.mjs'

test('themeFor resolves a named theme from the tokens', () => {
  assert.deepEqual(themeFor('light'), { name: 'light', bg: '#ffffff', fg: '#111111' })
  assert.deepEqual(themeFor('dark'), { name: 'dark', bg: '#111111', fg: '#ffffff' })
})

test('themeFor names the theme it could not resolve', () => {
  assert.throws(() => themeFor('sepia'), /sepia/)
})
