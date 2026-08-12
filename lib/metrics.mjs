// The one impure module in lib/.
//
// Everything else in `lib/` is a pure decision — data in, decision out, no fs,
// no clock, no I/O — precisely so it can be tested without a fixture and called
// from a runtime that has no filesystem of its own. This module deliberately
// breaks that rule: it writes a file. It is isolated here so the exception is
// visible, and so nothing pure ever grows a write path by accident.
//
// Two consequences of being the exception:
//
// 1. **It never throws.** A metrics write is a side effect of a run, never part
//    of it. A read-only checkout, a missing `.claude/`, a full disk — each
//    degrades to a no-op that *reports* itself via the return value. A run must
//    never fail because bookkeeping failed.
// 2. **It writes counts, not content.** Per decision §4.7 the payload is a
//    timestamp, a change name and four integers. No transcripts, no finding
//    bodies, no prompts, no file paths from the diff. The fields are copied out
//    by name rather than spread in, so handing this function an entire review
//    result cannot leak a finding's text into `.claude/metrics/`.
//
// Exposed to skills as a `interlock` subcommand.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where metrics land, relative to the repo root. */
export const METRICS_DIR = join('.claude', 'metrics')

/** Bump when the payload shape changes, so old files stay readable. */
export const REVIEW_METRICS_SCHEMA = 'interlock.review-metrics/1'

/** The only counts that are ever written. */
const COUNT_KEYS = ['raised', 'dismissed', 'droppedByQuality', 'surviving']

// A change name reaches us from a branch, a directory or a model, so it is
// untrusted as a path component: `../` or a slash would put the file somewhere
// other than the metrics directory. Reduce it to a filename-safe slug.
function slugify(change) {
  const s = typeof change === 'string' ? change.trim() : ''
  const safe = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return safe.slice(0, 80) || 'unnamed'
}

// ISO 8601 with the characters that are awkward in filenames replaced, so the
// name still sorts chronologically as a string.
function stampOf(iso) {
  return iso.replace(/[:.]/g, '-')
}

function toCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

/**
 * Append a review's counts to `.claude/metrics/`.
 *
 * @param {string} root repo root; `.claude/metrics` is created beneath it
 * @param {{change?: string, counts?: object, now?: Date|string}} [input]
 *   `counts` is a `resolveReview` result's `counts` (extra keys are ignored);
 *   `now` is an injection point for deterministic tests
 * @returns {{written: boolean, path: string|null, reason: string|null}}
 *   `reason` explains a `written: false` — it is never an exception
 */
export function writeReviewMetrics(root, input = {}) {
  try {
    if (typeof root !== 'string' || !root.trim()) {
      return { written: false, path: null, reason: 'no root directory given' }
    }
    if (!existsSync(root)) {
      return { written: false, path: null, reason: `root does not exist: ${root}` }
    }

    const when = input.now instanceof Date ? input.now : new Date(input.now || Date.now())
    const iso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString()

    const counts = {}
    for (const k of COUNT_KEYS) counts[k] = toCount(input.counts && input.counts[k])

    // Built key by key: whatever else the caller passed cannot ride along.
    const payload = {
      schema: REVIEW_METRICS_SCHEMA,
      timestamp: iso,
      change: slugify(input.change),
      counts
    }

    const dir = join(root, METRICS_DIR)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `review-${payload.change}-${stampOf(iso)}.json`)
    writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
    return { written: true, path: file, reason: null }
  } catch (err) {
    // Deliberately swallowed: see the module header. The caller gets a reason,
    // never an exception.
    return { written: false, path: null, reason: (err && err.message) || String(err) }
  }
}
