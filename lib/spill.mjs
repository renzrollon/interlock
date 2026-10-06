// Spill store for oversized verify output (add-ship-run-inspectability §3).
//
// A unit suite's combined stdout/stderr can run into hundreds of KB. Pasting
// that into a verify agent's structured result would blow past the very
// token-economy rules the ship loop exists to enforce. This module writes the
// full bytes to a stable on-disk locator once, and hands back a head-and-tail
// preview plus a hash — the caller's result object carries the locator and
// preview, never the full text.
//
// Not a dsh `ctx.spillStore`, not a generic tool-result bus: one function, one
// directory layout, consumed by the verify CLI helper (task 3.3). This module
// never judges pass/fail — that stays in `lib/verify.mjs`, which stays pure.
//
// Exposed to skills indirectly via `interlock verify` (spill wiring lands in
// task 3.3); this module is pure I/O with no agent, no fs-reading-back.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, posix as pathPosix } from 'node:path'
import { createHash } from 'node:crypto'
import { LIMITS } from './limits.mjs'

/** Where spilled suite output lives, relative to the repo root, POSIX-joined. */
export const SPILL_DIR = '.claude/ship/spill'

// Falls back to the design's pinned default if `lib/limits.mjs` has not yet
// grown `verifyPreviewChars` (see task 3.1) — keeps this module usable
// independent of load order, without restating the number as policy.
const DEFAULT_PREVIEW_CHARS = 4096

/**
 * Is this output big enough to spill?
 *
 * The threshold `interlock limits` prints, read here rather than described in
 * prose. It used to be a sentence in a prompt — "if a check's combined
 * stdout/stderr exceeds the spill threshold" — with the number itself living
 * only in `LIMITS.verifySpillBytes` and in a test asserting it equals 8192. A
 * cap whose only reader is a test pinning its value is not an enforced cap; it
 * just looks like one.
 *
 * @param {string|Buffer|number} output the bytes, or a byte count
 * @param {{threshold?: number}} [opts]
 * @returns {boolean} true when the caller must spill rather than inline
 */
export function shouldSpill(output, opts = {}) {
  const threshold =
    Number.isInteger(opts.threshold) && opts.threshold >= 0
      ? opts.threshold
      : (LIMITS.verifySpillBytes ?? 8192)
  return byteLength(output) > threshold
}

function byteLength(output) {
  if (typeof output === 'number') return Number.isFinite(output) ? output : 0
  if (Buffer.isBuffer(output)) return output.length
  return Buffer.byteLength(String(output ?? ''), 'utf8')
}

function safeSegment(value, fallback) {
  const s = typeof value === 'string' ? value.trim() : ''
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, '-')
  return cleaned.length ? cleaned : fallback
}

// Next seq for this run's spill directory: contiguous, starting at 1, derived
// from what is already on disk rather than threaded through by the caller —
// `spillBytes`'s only inputs are the run id, the kind, and the bytes.
function nextSeq(dirAbs) {
  if (!existsSync(dirAbs)) return 1
  let max = 0
  for (const name of readdirSync(dirAbs)) {
    const m = /^(\d+)-/.exec(name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

/**
 * Build a head-and-tail preview with an explicit omission marker, so a model
 * can see the start of a failure and its summary line without loading the
 * middle of the suite output.
 *
 * @param {string} text - full decoded content
 * @param {number} bytes - byte length of the full content
 * @param {string} locator - repo-relative POSIX path the full bytes live at
 * @param {number} previewChars - total character budget for the preview
 * @returns {{ preview: string, truncated: boolean }}
 */
export function buildPreview(text, bytes, locator, previewChars = DEFAULT_PREVIEW_CHARS) {
  if (text.length <= previewChars) {
    return { preview: text, truncated: false }
  }
  const marker = `\n…[spilled ${bytes} bytes, locator=${locator}]…\n`
  const half = Math.max(0, Math.floor((previewChars - marker.length) / 2))
  const head = text.slice(0, half)
  const tail = half > 0 ? text.slice(text.length - half) : ''
  return { preview: `${head}${marker}${tail}`, truncated: true }
}

/**
 * Write verify output to `.claude/ship/spill/<runId>/<seq>-<kind>.log` and
 * return a locator plus a bounded preview so callers never have to paste the
 * full bytes into an agent-facing result.
 *
 * Never throws on its own account beyond what `mkdirSync`/`writeFileSync`
 * raise for a genuinely unwritable tree — spill is only ever called from an
 * impure CLI helper (task 3.3) that decides how to report that upward.
 *
 * The returned record carries `overThreshold`, computed by `shouldSpill` from
 * `LIMITS.verifySpillBytes`, so the caller can report a step that spilled
 * output it did not have to — and so the published threshold has a reader on
 * the path it governs.
 *
 * @param {string} root - repo root
 * @param {{ runId: string, kind: string, bytes: string|Buffer, previewChars?: number }} opts
 * @returns {{ locator: string, bytes: number, overThreshold: boolean, threshold: number,
 *   preview: string, truncated: boolean, sha256: string }}
 */
export function spillBytes(root, { runId, kind, bytes, previewChars } = {}) {
  const runSeg = safeSegment(runId, 'unknown-run')
  const kindSeg = safeSegment(kind, 'output')
  const budget = Number.isInteger(previewChars)
    ? previewChars
    : (LIMITS.verifyPreviewChars ?? DEFAULT_PREVIEW_CHARS)

  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'utf8')

  const dirRel = pathPosix.join(SPILL_DIR, runSeg)
  const dirAbs = join(root, ...dirRel.split('/'))
  mkdirSync(dirAbs, { recursive: true })

  const seq = nextSeq(dirAbs)
  const fileName = `${seq}-${kindSeg}.log`
  const locator = pathPosix.join(dirRel, fileName)
  const fileAbs = join(dirAbs, fileName)

  writeFileSync(fileAbs, buf)

  const sha256 = createHash('sha256').update(buf).digest('hex')
  const { preview, truncated } = buildPreview(buf.toString('utf8'), buf.length, locator, budget)

  return {
    locator,
    bytes: buf.length,
    overThreshold: shouldSpill(buf),
    threshold: LIMITS.verifySpillBytes ?? 8192,
    preview,
    truncated,
    sha256
  }
}
