// The downloads badge (scripts/npm-downloads.mjs), with a stub for fetch:
// nothing here reaches npm. The pins are the three things a reader of the
// badge relies on: the windows cover every day once, the figure never
// overstates, and a failed read is carried forward or named, never fatal.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LIVE_URL, allTime, badge, formatCount, resolveBadge, windows } from '../scripts/npm-downloads.mjs'

const reply = body => ({ ok: true, status: 200, json: async () => body })
const fail = status => ({ ok: false, status, json: async () => ({}) })

function stubNpm ({ created = '2025-03-01T10:00:00.000Z', perWindow = 100, live } = {}) {
  const seen = []
  const fetchImpl = async url => {
    seen.push(url)
    if (url.startsWith('https://registry.npmjs.org/')) return created ? reply({ time: { created } }) : reply({})
    if (url.startsWith('https://api.npmjs.org/')) return perWindow == null ? fail(429) : reply({ downloads: perWindow })
    if (url === LIVE_URL) return live ? reply(live) : fail(404)
    throw new Error(`unexpected ${url}`)
  }
  return { fetchImpl, seen }
}

test('npm-downloads: the windows cover every day from creation to today exactly once', () => {
  const w = windows('2025-03-01', '2026-10-21')
  assert.deepEqual(w[0], ['2025-03-01', '2026-02-28'])
  assert.deepEqual(w.at(-1)[1], '2026-10-21')
  for (let i = 1; i < w.length; i++) {
    assert.equal(Date.parse(w[i][0]) - Date.parse(w[i - 1][1]), 86400000, 'no gap and no overlap')
  }
  assert.deepEqual(windows('2026-10-21', '2026-10-21'), [['2026-10-21', '2026-10-21']])
  assert.throws(() => windows('2026-10-22', '2026-10-21'))
})

test('npm-downloads: the figure rounds down, so the badge never overstates', () => {
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(999), '999')
  assert.equal(formatCount(1967), '1.9k')
  assert.equal(formatCount(12345), '12k')
  assert.equal(formatCount(999999), '999k')
  assert.equal(formatCount(1250000), '1.2M')
  assert.deepEqual(badge(1967), { schemaVersion: 1, label: 'downloads', message: '1.9k', color: '1d5bd6', cacheSeconds: 3600 })
})

test('npm-downloads: all time is the sum of the windows, scoped name encoded for the registry', async () => {
  const { fetchImpl, seen } = stubNpm()
  assert.equal(await allTime({ fetchImpl, today: '2026-10-21' }), 200)
  assert.equal(seen[0], 'https://registry.npmjs.org/@renzrollon%2Finterlock')
  assert.equal(seen[1], 'https://api.npmjs.org/downloads/point/2025-03-01:2026-02-28/@renzrollon/interlock')
})

test('npm-downloads: a failed npm read carries the live count forward and says so', async () => {
  const live = { schemaVersion: 1, label: 'downloads', message: '1.9k', color: '1d5bd6' }
  const r = await resolveBadge({ fetchImpl: stubNpm({ perWindow: null, live }).fetchImpl, today: '2026-10-21' })
  assert.deepEqual(r.doc, live)
  assert.match(r.warning, /carried forward the live count, 1\.9k/)
  assert.match(r.warning, /429/)
})

test('npm-downloads: with nothing to carry forward it writes nothing, names the broken badge, and does not throw', async () => {
  const r = await resolveBadge({ fetchImpl: stubNpm({ created: null }).fetchImpl, today: '2026-10-21' })
  assert.equal(r.doc, null)
  assert.match(r.warning, /no creation date/)
  assert.match(r.warning, /badge shows an error until the next deploy/)
})
