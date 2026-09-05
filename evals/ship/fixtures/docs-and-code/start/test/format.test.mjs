import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCount, formatBytes, formatDuration } from '../src/format.mjs'

test('formatCount pluralises', () => {
  assert.equal(formatCount(1, 'file'), '1 file')
  assert.equal(formatCount(3, 'file'), '3 files')
})

test('formatBytes scales to B, KB and MB', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('formatDuration scales to ms, s and min', () => {
  assert.equal(formatDuration(250), '250 ms')
  assert.equal(formatDuration(1500), '1.5 s')
  assert.equal(formatDuration(90000), '1.5 min')
})
