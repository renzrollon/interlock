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
//    timestamp, a change name and four integers, plus four enumerations that
//    say what ran (brief-and-record-the-artifact-gate design §6): the `stage`
//    (`REVIEW_STAGES`), the `depth` (`REVIEW_DEPTHS`), the `reviewer`
//    (`REVIEW_READERS`) and the `lenses`, a list of lens-shaped names. Each is
//    checked against its vocabulary or shape and written as `null` otherwise, so
//    none can carry text. No transcripts, no finding bodies, no prompts, no file
//    paths from the diff. The fields are copied out by name rather than spread
//    in, so handing this function an entire review result cannot leak a
//    finding's text into `.claude/metrics/`.
//
// Exposed to skills as a `interlock` subcommand.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVIEW_DEPTHS } from './routing.mjs'

/** Where metrics land, relative to the repo root. */
export const METRICS_DIR = join('.claude', 'metrics')

/** Bump when the payload shape changes, so old files stay readable. */
export const REVIEW_METRICS_SCHEMA = 'interlock.review-metrics/1'

/** The only counts that are ever written. */
const COUNT_KEYS = ['raised', 'dismissed', 'droppedByQuality', 'surviving']

/** The review stages a record can name: an artifact gate or a code review. */
export const REVIEW_STAGES = Object.freeze(['artifacts', 'code'])

/** The readers a record can name: the session itself, a spawned agent, or another vendor's reader. */
export const REVIEW_READERS = Object.freeze(['session', 'agent', 'external'])

/** The depths a record can name: the routing depth table's. */
export { REVIEW_DEPTHS }

/** What a lens name looks like: a bundled lens file's name. */
export const LENS_NAME = /^[a-z0-9][a-z0-9-]*$/

const enumOf = (vocabulary, value) => (typeof value === 'string' && vocabulary.includes(value) ? value : null)
const lensesOf = value =>
  Array.isArray(value) && value.every(name => typeof name === 'string' && LENS_NAME.test(name)) ? [...value] : null

/**
 * The four recording fields of `interlock gate --metrics`, read from its flags
 * (design §6). An absent flag is `null`. An unknown value, an empty one, or a
 * flag given with no value is warned through `warn`, naming the flag and the
 * known values, and is `null`: a bad value never moves a verdict (D17).
 * `--lenses` is `none` (the empty list) or a comma-separated list of lens-shaped
 * names; `none` beside a name, an empty element or an element of another shape
 * makes the whole value `null`. The names are not checked against the bundled
 * lenses: this module reads no plugin file, and the shape is what keeps the
 * record to names, never text.
 *
 * @param {Record<string, unknown>} flags
 * @param {(message: string) => void} warn
 * @returns {{stage: string|null, depth: string|null, reviewer: string|null, lenses: string[]|null}}
 */
export function recordFieldsOf(flags = {}, warn = () => {}) {
  const enumFlag = (key, vocabulary) => {
    const value = flags[key]
    if (value === undefined) return null
    const known = enumOf(vocabulary, value)
    if (known === null) {
      warn(`--${key} ${JSON.stringify(value === true ? '' : value)} is not recorded: known values are ${vocabulary.join(', ')}`)
    }
    return known
  }
  let lenses = null
  if (flags.lenses !== undefined) {
    const parts = typeof flags.lenses === 'string' ? flags.lenses.split(',').map(part => part.trim()) : []
    if (parts.length === 1 && parts[0] === 'none') lenses = []
    else if (parts.length && parts.every(part => LENS_NAME.test(part)) && !parts.includes('none')) lenses = parts
    else {
      const shown = flags.lenses === true ? '' : flags.lenses
      warn(`--lenses ${JSON.stringify(shown)} is not recorded: give none, or a comma-separated list of lens names`)
    }
  }
  return {
    stage: enumFlag('stage', REVIEW_STAGES),
    depth: enumFlag('depth', REVIEW_DEPTHS),
    reviewer: enumFlag('reviewer', REVIEW_READERS),
    lenses
  }
}

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
 * @param {{change?: string, counts?: object, stage?: string, depth?: string, reviewer?: string,
 *   lenses?: string[], now?: Date|string}} [input]
 *   `counts` is a `resolveReview` result's `counts` (extra keys are ignored);
 *   `stage`, `depth`, `reviewer` and `lenses` are written when known and `null`
 *   otherwise; `now` is an injection point for deterministic tests
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
      counts,
      stage: enumOf(REVIEW_STAGES, input.stage),
      depth: enumOf(REVIEW_DEPTHS, input.depth),
      reviewer: enumOf(REVIEW_READERS, input.reviewer),
      lenses: lensesOf(input.lenses)
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
