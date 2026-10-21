#!/usr/bin/env node
// The README's downloads badge: the package's all-time npm downloads, written
// as a shields.io endpoint file the Pages deploy publishes beside the site.
//
// Development and CI tooling only. `scripts/` is not in package.json `files`,
// so this never ships. .github/workflows/pages.yml runs it on every deploy,
// including the one that follows each release, and writes
// site/badges/downloads.json, which the README's badge reads through
// https://img.shields.io/endpoint. shields.io then fetches one small file from
// Pages instead of asking npm itself, so npm's rate limit on shields' shared
// traffic ("rate limited by upstream service") never reaches the badge.
//
// npm has no all-time endpoint: a point query covers at most 18 months. The
// total is the sum of yearly windows from the package's creation date (the
// registry's `time.created`) to today.
//
// It never fails a deploy. When npm cannot be read, the count the live site
// already serves is carried forward, and a GitHub `::warning::` says so; when
// that cannot be read either, no file is written and the warning says the
// badge will show an error until the next deploy. Degradation is spoken.
//
// Usage:
//   node scripts/npm-downloads.mjs --out site/badges/downloads.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE = '@renzrollon/interlock'
export const LIVE_URL = 'https://renzrollon.github.io/interlock/badges/downloads.json'
const REGISTRY = 'https://registry.npmjs.org/'
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/'
const COLOR = '1d5bd6' // color-accent, light: the brand's one hue
const WINDOW_DAYS = 365 // npm caps a point query at 18 months
const DAY = 86400000

const ymd = ms => new Date(ms).toISOString().slice(0, 10)

/** Inclusive [start, end] date windows of at most WINDOW_DAYS, covering start..end. */
export function windows (start, end) {
  const out = []
  let from = Date.parse(start)
  const last = Date.parse(end)
  if (!(from <= last)) throw new Error(`no window from ${start} to ${end}`)
  while (from <= last) {
    const to = Math.min(from + (WINDOW_DAYS - 1) * DAY, last)
    out.push([ymd(from), ymd(to)])
    from = to + DAY
  }
  return out
}

/** The badge text: 999, 1.9k, 12k, 1.2M. Rounded down, so it never overstates. */
export function formatCount (n) {
  const short = (v, unit) => {
    const fixed = v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)
    return `${fixed}${unit}`
  }
  if (n < 1000) return String(n)
  if (n < 1e6) return short(n / 1e3, 'k')
  return short(n / 1e6, 'M')
}

/** The shields.io endpoint document (https://shields.io/badges/endpoint-badge). */
export function badge (total) {
  return { schemaVersion: 1, label: 'downloads', message: formatCount(total), color: COLOR, cacheSeconds: 3600 }
}

async function json (fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.json()
}

/** All-time downloads of `pkg` up to `today`, read from the registry and the downloads API. */
export async function allTime ({ fetchImpl = fetch, pkg = PACKAGE, today = ymd(Date.now()) } = {}) {
  const meta = await json(fetchImpl, REGISTRY + pkg.replace('/', '%2F'))
  const created = meta?.time?.created
  if (typeof created !== 'string') throw new Error(`the registry gave no creation date for ${pkg}`)
  let total = 0
  for (const [from, to] of windows(created.slice(0, 10), today)) {
    const point = await json(fetchImpl, `${DOWNLOADS}${from}:${to}/${pkg}`)
    if (!Number.isInteger(point?.downloads)) throw new Error(`no download count for ${from}:${to}: ${point?.error ?? 'malformed reply'}`)
    total += point.downloads
  }
  return total
}

/**
 * What to write, and what to say about it. Never throws: a deploy must not
 * fail for a badge, and every fallback is named in `warning`.
 */
export async function resolveBadge ({ fetchImpl = fetch, today, liveUrl = LIVE_URL } = {}) {
  try {
    const total = await allTime({ fetchImpl, today })
    return { doc: badge(total), total }
  } catch (err) {
    try {
      const prev = await json(fetchImpl, liveUrl)
      if (prev?.schemaVersion !== 1 || typeof prev.message !== 'string') throw new Error('not an endpoint document')
      return { doc: prev, warning: `npm downloads unreadable (${err.message}); carried forward the live count, ${prev.message}` }
    } catch (err2) {
      return { doc: null, warning: `npm downloads unreadable (${err.message}) and no live count to carry forward (${err2.message}); the downloads badge shows an error until the next deploy` }
    }
  }
}

async function main (argv) {
  const i = argv.indexOf('--out')
  if (i < 0 || !argv[i + 1]) {
    process.stderr.write('usage: node scripts/npm-downloads.mjs --out <file>\n')
    return 2
  }
  const out = resolve(argv[i + 1])
  const { doc, total, warning } = await resolveBadge()
  if (warning) process.stdout.write(`::warning title=downloads badge::${warning}\n`)
  if (!doc) return 0
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(doc) + '\n')
  process.stdout.write(`wrote ${out}: ${doc.message}${total === undefined ? ' (carried forward)' : ` (${total} all time)`}\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
