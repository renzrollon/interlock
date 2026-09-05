import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UNIT_MS } from '../src/units.mjs'

test('UNIT_MS carries every duration unit in milliseconds', () => {
  assert.deepEqual(UNIT_MS, { ms: 1, s: 1000, min: 60000, h: 3600000 })
})
