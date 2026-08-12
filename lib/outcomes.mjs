// The outcomes corpus (§F4, §F6.5) — one line per planning→ship attempt.
//
// `.claude/memory/` already records code gotchas for the next implementer. It
// cannot answer the only question continuity actually needs answered: *should
// we have skipped the human that time?* That question needs a record per
// attempt, in a fixed shape, written for both modes — the checkpoint runs are
// the control group, and a corpus of only the runs we already trusted would
// tell us nothing.
//
// Per §4.15(a) this release **records and nothing else**. There is no
// eligibility gating, no scorecard, no threshold: F6.6 is deliberately out of
// scope until real cold-start data exists. Anyone wiring a gate to this file
// is implementing a decision that has not been made.
//
// This is the second impure module in `lib/`, and it copies `lib/metrics.mjs`'s
// contract exactly, for the same reasons:
//
//   1. **It never throws.** Bookkeeping is a side effect of a run, never part
//      of it. A read-only checkout or an unwritable `.claude/` degrades to a
//      reported no-op — a run must not fail because the corpus could not grow.
//   2. **It writes a fixed shape, not whatever it was handed.** The payload is
//      built key by key, so passing an entire readiness result (artifact text,
//      finding bodies, evidence strings) cannot leak content into a file that
//      will be read back by future agents.
//
// Append-only, one JSON object per line. The reader tolerates a torn final
// line: a log truncated by a crash must cost you that one record, not every
// record before it.
//
// Exposed to skills as `interlock outcome append|list`.

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

/** Where the corpus lives, relative to the repo root. */
export const LEARNING_DIR = join('.claude', 'learning')

/** The append-only log itself. */
export const OUTCOMES_FILE = 'outcomes.jsonl'

/** Bump when the record shape changes, so old lines stay readable. */
export const OUTCOME_SCHEMA = 'interlock.outcome/1'

/** The two modes a change reaches ship by. Both are recorded (§F6.5). */
export const MODES = Object.freeze(['checkpoint', 'continue'])

/** §F4's 0–5 self-assessments. Absent scores stay null rather than becoming 0. */
export const SCORE_KEYS = Object.freeze(['implementability', 'specFidelity', 'postShipChurn'])

const MAX_SCORE = 5

// Free text is the one place a human's words are kept. Bounded so one pasted
// stack trace cannot dominate the corpus.
const MAX_TEXT = 500

// A change name is a value here, never a path component, but it is still model-
// or branch-derived, so it is bounded and stripped of newlines that would break
// the one-record-per-line invariant.
const MAX_NAME = 120

function messageOf(err) {
  return (err && err.message) || String(err)
}

function text(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return ''
  const s = value.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function count(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

// Tri-state on purpose: `null` means "nobody said", which is different from
// "no". Coercing an unknown to false would invent data in a corpus whose whole
// job is to be honest about what happened.
function bool(value) {
  return typeof value === 'boolean' ? value : null
}

function score(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_SCORE, Math.max(0, Math.round(n)))
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Absolute-from-root path of the corpus. */
export function outcomesPath(root) {
  return join(root, LEARNING_DIR, OUTCOMES_FILE)
}

// Written once, never clobbered: a human may well have added notes to it, and
// this module is not important enough to overwrite someone's file.
const README = `# Learning corpus

One line per planning→ship attempt, in \`${OUTCOMES_FILE}\` — append-only JSON Lines.

## What it is for

Interlock's default flow stops at a human checkpoint between \`spec\` and \`ship\`.
The opt-in continuity path can skip that checkpoint. This corpus exists to
answer, later and from evidence rather than from memory, whether skipping it
was a good idea: each record pairs what the gate believed before the run
(readiness, risk class, decisions needing a human, artifact-review counts) with
what actually happened afterwards (ship outcome, remediation rounds, whether a
human had to step in).

Records are written for **both** modes. The checkpoint runs are the control
group — a corpus containing only the runs we already trusted would prove
nothing.

## What currently reads it

**Nothing gates on this file.** Per decision §4.15(a) this release records and
nothing more: no eligibility rules, no failure-streak threshold, no scorecard.
Continuity is gated solely by \`interlock ready\` (structural checks + risk class)
and by the user passing the flag.

If you are about to wire a gate to these records, that is decision §4.16 / slice
F6.6, and it has not been made.

## Contents of a record

\`schema\`, \`ts\`, \`change\`, \`mode\`, \`riskClass\`, \`ready\`, \`decisionsHuman\`,
\`reviewArtifacts\`, \`ship\`, \`human\`, \`scores\`, \`feedback\`.

Counts, classes and short free-text notes only. No artifact text, no finding
bodies, no diffs, no transcripts — the payload is assembled field by field so
that handing the writer a fat object cannot leak content in here.

## Safe to delete

Deleting this directory loses history and breaks nothing.
`

function ensureReadme(dir) {
  const path = join(dir, 'README.md')
  if (existsSync(path)) return
  writeFileSync(path, README)
}

// If a previous append was torn mid-line (crash, full disk), a naive append
// would splice the new record onto the broken one and destroy two records
// instead of one. Reading the final byte is cheap and makes the log
// self-healing at the seam.
function endsWithNewline(file) {
  const size = statSync(file).size
  if (size === 0) return true
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1)
    readSync(fd, buf, 0, 1, size - 1)
    return buf[0] === 0x0a
  } finally {
    closeSync(fd)
  }
}

/**
 * Append one outcome record to `.claude/learning/outcomes.jsonl`.
 *
 * Every field is copied out by name; anything else on `input` is ignored, so a
 * caller may pass a whole readiness or review result without leaking its text.
 *
 * @param {string} root repo root; `.claude/learning` is created beneath it
 * @param {{
 *   change?: string,
 *   mode?: 'checkpoint'|'continue',
 *   riskClass?: string|null,
 *   ready?: boolean,
 *   decisionsHuman?: number,
 *   reviewArtifacts?: {blockers?: number, warnings?: number},
 *   ship?: {ok?: boolean, remediationRounds?: number, unitGreen?: boolean, codeBlockersSurviving?: number},
 *   human?: {intervened?: boolean, wouldRejectSpec?: boolean, notes?: string},
 *   scores?: {implementability?: number, specFidelity?: number, postShipChurn?: number},
 *   feedback?: string,
 *   now?: Date|string
 * }} [input]
 * @returns {{written: boolean, path: string|null, reason: string|null}}
 *   `reason` explains a `written: false` — it is never an exception
 */
export function appendOutcome(root, input = {}) {
  try {
    if (typeof root !== 'string' || !root.trim()) {
      return { written: false, path: null, reason: 'no root directory given' }
    }
    if (!existsSync(root)) {
      return { written: false, path: null, reason: `root does not exist: ${root}` }
    }
    const source = isObject(input) ? input : {}

    const mode = typeof source.mode === 'string' ? source.mode.trim() : ''
    if (!MODES.includes(mode)) {
      // Not defaulted: a record whose mode we guessed is worse than no record,
      // because the whole corpus is a comparison between the two modes.
      return { written: false, path: null, reason: `mode must be one of ${MODES.join(', ')}` }
    }

    const when = source.now instanceof Date ? source.now : new Date(source.now || Date.now())
    const iso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString()

    const review = isObject(source.reviewArtifacts) ? source.reviewArtifacts : {}
    const ship = isObject(source.ship) ? source.ship : {}
    const human = isObject(source.human) ? source.human : {}
    const scores = isObject(source.scores) ? source.scores : {}

    // Built key by key: see the module header. Nothing not named here is
    // written, whatever the caller passed.
    const payload = {
      schema: OUTCOME_SCHEMA,
      ts: iso,
      change: text(source.change, MAX_NAME) || 'unnamed',
      mode,
      riskClass: typeof source.riskClass === 'string' ? text(source.riskClass, 32) : null,
      // Fail closed in the record too: anything that is not literally `true`
      // was not a ready run.
      ready: source.ready === true,
      decisionsHuman: count(source.decisionsHuman),
      reviewArtifacts: {
        blockers: count(review.blockers),
        warnings: count(review.warnings)
      },
      ship: {
        ok: bool(ship.ok),
        remediationRounds: count(ship.remediationRounds),
        unitGreen: bool(ship.unitGreen),
        codeBlockersSurviving: count(ship.codeBlockersSurviving)
      },
      human: {
        intervened: bool(human.intervened),
        wouldRejectSpec: bool(human.wouldRejectSpec),
        notes: text(human.notes)
      },
      scores: {},
      feedback: text(source.feedback)
    }
    for (const key of SCORE_KEYS) payload.scores[key] = score(scores[key])

    const dir = join(root, LEARNING_DIR)
    mkdirSync(dir, { recursive: true })
    ensureReadme(dir)

    const file = join(dir, OUTCOMES_FILE)
    const prefix = existsSync(file) && !endsWithNewline(file) ? '\n' : ''
    // JSON.stringify never emits a raw newline, so one record is always one line.
    appendFileSync(file, `${prefix}${JSON.stringify(payload)}\n`)
    return { written: true, path: file, reason: null }
  } catch (err) {
    // Deliberately swallowed: see the module header. The caller gets a reason,
    // never an exception.
    return { written: false, path: null, reason: messageOf(err) }
  }
}

/**
 * Read the corpus back. Never throws, and never lets one bad line cost you the
 * rest of the log — an append-only file torn by a crash is expected, not
 * exceptional.
 *
 * @param {string} root repo root
 * @returns {{
 *   path: string|null, exists: boolean,
 *   records: object[], skipped: Array<{line: number, reason: string}>,
 *   reason: string|null
 * }}
 */
export function readOutcomes(root) {
  if (typeof root !== 'string' || !root.trim()) {
    return { path: null, exists: false, records: [], skipped: [], reason: 'no root directory given' }
  }
  const path = outcomesPath(root)
  try {
    if (!existsSync(path)) {
      return { path, exists: false, records: [], skipped: [], reason: null }
    }
    const lines = readFileSync(path, 'utf8').split('\n')
    const records = []
    const skipped = []
    lines.forEach((line, i) => {
      if (!line.trim()) return
      try {
        const parsed = JSON.parse(line)
        if (isObject(parsed)) records.push(parsed)
        else skipped.push({ line: i + 1, reason: 'line is not a JSON object' })
      } catch (err) {
        skipped.push({ line: i + 1, reason: messageOf(err) })
      }
    })
    return { path, exists: true, records, skipped, reason: null }
  } catch (err) {
    return { path, exists: true, records: [], skipped: [], reason: messageOf(err) }
  }
}

/** Human-readable rollup, for a skill to echo. Counts only — never a verdict. */
export function formatOutcomes(result) {
  if (!result.exists) return `OUTCOMES — none recorded (${result.path ?? LEARNING_DIR})\n`
  const lines = []
  const byMode = {}
  for (const r of result.records) {
    const mode = typeof r.mode === 'string' ? r.mode : 'unknown'
    byMode[mode] = (byMode[mode] || 0) + 1
  }
  lines.push(
    `OUTCOMES — ${result.records.length} record(s): ` +
      (Object.keys(byMode).length
        ? Object.keys(byMode)
            .sort()
            .map(m => `${byMode[m]} ${m}`)
            .join(', ')
        : 'none')
  )
  if (result.skipped.length) {
    lines.push(`  ${result.skipped.length} unreadable line(s) skipped: ${result.skipped.map(s => s.line).join(', ')}`)
  }
  lines.push('  nothing gates on these records (§4.15a)')
  return lines.join('\n') + '\n'
}
