// The ship meter's time words: the gutter's local clock, the header's start,
// and a turn's humanised duration. Pure rules, pinned here under Node in UTC so
// the readings are fixed; the hooks module's use of them, in the kit's own zone,
// is `test/mod/meter.test.ts`'s.

process.env.TZ = 'UTC'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { specifiers, walkModule } from '../helpers/module-walk.mjs'
import { clockText, durationText, stampText } from '../../lib/meter-time.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY = join(ROOT, 'lib', 'meter-time.mjs')
const AT = Date.parse('2026-10-09T07:04:05.678Z')

test('the zone this suite reads in is UTC, so every reading below is fixed', () => {
  assert.equal(new Date(AT).getTimezoneOffset(), 0)
})

test('the gutter is the local wall-clock time, zero-padded, and nothing for no reading', () => {
  assert.equal(clockText(AT), '07:04:05')
  assert.equal(clockText(Date.parse('2026-10-09T00:00:00.000Z')), '00:00:00')
  assert.equal(clockText(Date.parse('2026-10-09T23:59:59.999Z')), '23:59:59')
  for (const none of [null, undefined, NaN, Infinity, -Infinity, '2026-10-09', {}]) assert.equal(clockText(none), '', String(none))
})

test('the header\'s start is the local date and time, and nothing for no reading', () => {
  assert.equal(stampText(AT), '2026-10-09 07:04:05')
  assert.equal(stampText(Date.parse('2026-01-02T03:04:05.000Z')), '2026-01-02 03:04:05')
  for (const none of [null, undefined, NaN, 'x']) assert.equal(stampText(none), '', String(none))
})

test('the time words follow the local zone, not UTC', () => {
  const before = process.env.TZ
  try {
    process.env.TZ = 'Asia/Singapore'
    assert.equal(clockText(AT), '15:04:05')
    assert.equal(stampText(Date.parse('2026-10-09T20:00:00.000Z')), '2026-10-10 04:00:00')
  } finally {
    process.env.TZ = before
  }
  assert.equal(clockText(AT), '07:04:05')
})

test('a duration under a minute is seconds to one decimal, cut down so it never reads a minute', () => {
  assert.equal(durationText(0), '0.0s')
  assert.equal(durationText(800), '0.8s')
  assert.equal(durationText(4200), '4.2s')
  assert.equal(durationText(41_200), '41.2s')
  assert.equal(durationText(59_940), '59.9s')
  assert.equal(durationText(59_999), '59.9s')
})

test('a duration under an hour is whole minutes and seconds; at an hour or more, hours and minutes', () => {
  assert.equal(durationText(60_000), '1m 00s')
  assert.equal(durationText(134_200), '2m 14s')
  assert.equal(durationText(3_599_000), '59m 59s')
  assert.equal(durationText(3_599_999), '59m 59s')
  assert.equal(durationText(3_600_000), '1h 00m')
  assert.equal(durationText(3_783_000), '1h 03m')
  assert.equal(durationText(36_000_000 + 59 * 60_000 + 59_000), '10h 59m')
})

test('no figure, a negative one or a non-number formats as nothing', () => {
  for (const none of [null, undefined, -1, -60_000, NaN, Infinity, '4200', {}]) assert.equal(durationText(none), '', String(none))
})

test('the time words import nothing, so the hooks module can load them in the engine', () => {
  assert.deepEqual(specifiers(readFileSync(ENTRY, 'utf8')), [])
  const { files, problems } = walkModule(ENTRY, ROOT)
  assert.deepEqual(problems, [], problems.join('\n'))
  assert.deepEqual(files, [ENTRY])
})

test('the time words never spell the clean close\'s word', () => {
  assert.equal(readFileSync(ENTRY, 'utf8').search(/complete/i), -1)
})
