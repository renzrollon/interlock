import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDuration } from '../src/parse.mjs'

test('parseDuration reads milliseconds and seconds', () => {
  assert.equal(parseDuration('250ms'), 250)
  assert.equal(parseDuration('90s'), 90000)
})

test('parseDuration reads minutes and hours', () => {
  assert.equal(parseDuration('5min'), 300000)
  assert.equal(parseDuration('2h'), 7200000)
})

test('parseDuration names the value it could not parse', () => {
  assert.throws(() => parseDuration('later'), /later/)
})
