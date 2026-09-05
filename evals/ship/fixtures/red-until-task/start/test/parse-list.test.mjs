import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseList } from '../src/parse.mjs'

test('parseList splits on commas and trims', () => {
  assert.deepEqual(parseList('a, b ,c'), ['a', 'b', 'c'])
})

test('parseList drops empty entries', () => {
  assert.deepEqual(parseList('a,,b,'), ['a', 'b'])
  assert.deepEqual(parseList('   '), [])
})
