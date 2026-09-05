import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from '../src/summary.mjs'

test('summarize composes both formatters', () => {
  assert.equal(summarize({ bytes: 2048, ms: 1500 }), '2.0 KB in 1.5 s')
  assert.equal(summarize({ bytes: 512, ms: 250 }), '512 B in 250 ms')
})
