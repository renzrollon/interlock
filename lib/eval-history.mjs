// The outcome eval's committed results record.
//
// One append-only line per fixture per arm per run, at
// `evals/history/ship-outcomes.jsonl`. Two releases produce two comparable rows;
// that is the whole reason the file is committed rather than uploaded as a CI
// artefact, and the whole reason it holds counts and measures only.
//
// THREE PROPERTIES, EACH LOAD-BEARING.
//
//   1. FIELDS ARE COPIED BY NAME. The writer builds the payload key by key, so
//      handing it an entire run summary — one that also carries suite output,
//      agent messages and a diff — writes only the named fields. This is the
//      same stance `lib/outcomes.mjs` and `lib/metrics.mjs` take, for the same
//      reason: a corpus that grows without bound in version control stops being
//      readable within a year, and a transcript in git is a decision nobody
//      made.
//
//   2. THE INSTRUMENT IS RECORDED WITH THE MEASUREMENT. Version under test,
//      fixture, arm, host, model, the eval's own agent, the price table's
//      identifier and the Node version travel on every row. A change to the
//      apparatus is then visible in the record rather than confounding a
//      comparison between two releases — the same lesson the eval exists to
//      apply to the loop, applied to the eval.
//
//   3. A FAILED APPEND IS FATAL TO THE EVAL RUN AND TO NOTHING ELSE. This
//      module never throws: it reports `written: false` with a reason, and the
//      eval runner exits non-zero on it. The repository's corpus-loss classes
//      differ deliberately — the outcome corpus and review metrics report a lost
//      line and never touch an exit code, while the run trajectory and the
//      verify spill are fatal because a run nobody can reconstruct defeats the
//      reason the file exists. This record is in the fatal class by that same
//      test read literally: the row IS the product of a metered scheduled run,
//      and a run that spends real money and then drops its only durable result
//      is indistinguishable from a run that was never scheduled.
//
//      The fatality is scoped to the eval runner's own exit code. No ship run is
//      in the path when this appends, and `interlock report` keeps its
//      never-throw, always-zero contract when it reads this back.
//
// Written by `evals/ship/run.mjs`. Read by `lib/report.mjs` as a fourth corpus,
// under exactly the rules the other three are read by.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Where the record lives, relative to the repository root. */
export const EVAL_HISTORY_DIR = join('evals', 'history')

/** The append-only log itself. */
export const SHIP_OUTCOMES_FILE = 'ship-outcomes.jsonl'

/**
 * Bump when the record shape changes, so two lines stay legible side by side.
 *
 * Distinct from every other corpus's schema on purpose: a stray row landing in
 * the outcome corpus, the trajectory corpus or the metrics corpus is still not
 * readable as a record of a real run, because none of their readers recognizes
 * this string.
 */
export const SHIP_OUTCOME_SCHEMA = 'interlock.ship-outcome-eval/1'

/** The arms a row may name. A row naming neither is refused rather than guessed at. */
export const ARMS = Object.freeze(['loop', 'control'])

/** Every criterion status a row may carry, mirroring `evals/ship/graders.mjs`. */
export const CRITERION_STATUSES = Object.freeze(['pass', 'fail', 'unobserved', 'n/a'])

/**
 * The measures a row carries, each as a value-with-reason pair.
 *
 * The two token fields are separate and MUST NOT be merged. `receiptOutputTokens`
 * is the loop's own accounting — absent on a host without token accounting, with
 * that host's reason, which `ship-run` already requires. `agentOutputTokens` is
 * what the eval's own agent read off the API responses it made itself. Merging
 * them would let an apparatus measurement masquerade as a product measurement.
 */
export const MEASURE_FIELDS = Object.freeze([
  'agentsSpawned',
  'wallClockMs',
  'remediationRounds',
  'agentInputTokens',
  'agentOutputTokens',
  'receiptOutputTokens',
  'spendUsd'
])

const MAX_ID = 80
const MAX_REASON = 240
const MAX_CRITERIA = 16

function messageOf(err) {
  return (err && err.message) || String(err)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** A bounded identifier. Never a sentence, never a body of text. */
function id(value, max = MAX_ID) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** A bounded reason. The one place free text is allowed, and it is capped. */
function reason(value) {
  return id(value, MAX_REASON)
}

/** A finite number, or `null`. Never a zero standing in for an absence. */
function measure(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * One measure, as the pair a reader has to branch on.
 *
 * `{value: null, reason: '…'}` is "not measured"; `{value: 0, reason: null}` is
 * "measured, and it was zero". Those are different facts and the record keeps
 * them apart — a measure recorded as zero when nothing measured it is the single
 * error this eval is most able to commit.
 */
function measurePair(input) {
  const source = isObject(input) ? input : { value: input }
  const value = measure(source.value)
  return {
    value,
    reason: value === null ? reason(source.reason) || 'not measured' : null
  }
}

/** Absolute path of the record, from a repository root. */
export function shipOutcomesPath(root) {
  return join(root, EVAL_HISTORY_DIR, SHIP_OUTCOMES_FILE)
}

// A previous append torn mid-line (crash, full disk) would otherwise be spliced
// onto by the next one, destroying two records instead of one. Reading the final
// byte is cheap and makes the log self-healing at the seam — the same guard
// `lib/outcomes.mjs` carries.
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
 * Append one graded result.
 *
 * Never throws. A failure comes back as `{written: false, reason}` and the eval
 * runner exits non-zero on it — see property 3 in the module header.
 *
 * @param {string} root repository root; `evals/history/` is created beneath it
 * @param {{
 *   version?: string, fixture?: string, arm?: 'loop'|'control', host?: string,
 *   model?: string, evalAgent?: string, priceTable?: string, node?: string,
 *   criteria?: Array<{id: string, status: string, exitCode?: number|null}>,
 *   measures?: Record<string, {value: number|null, reason: string|null}>,
 *   tally?: {met?: number, applicable?: number, notApplicable?: number, unobserved?: number},
 *   now?: Date|string
 * }} [input] anything not named here is ignored, however fat the object is
 * @returns {{written: boolean, path: string|null, reason: string|null}}
 */
export function appendShipOutcome(root, input = {}) {
  try {
    if (typeof root !== 'string' || !root.trim()) {
      return { written: false, path: null, reason: 'no root directory given' }
    }
    const source = isObject(input) ? input : {}

    const arm = id(source.arm)
    if (!ARMS.includes(arm)) {
      // Not defaulted: the record exists to compare two arms, and a row whose
      // arm was guessed is worse than no row at all.
      return { written: false, path: null, reason: `arm must be one of ${ARMS.join(', ')}` }
    }
    const fixture = id(source.fixture)
    if (!fixture) {
      return { written: false, path: null, reason: 'a fixture identity is required' }
    }

    const when = source.now instanceof Date ? source.now : new Date(source.now || Date.now())
    const ts = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString()

    const criteria = (Array.isArray(source.criteria) ? source.criteria : [])
      .slice(0, MAX_CRITERIA)
      .map(entry => {
        const c = isObject(entry) ? entry : {}
        const status = id(c.status, 16)
        return {
          id: id(c.id),
          status: CRITERION_STATUSES.includes(status) ? status : null,
          // The deciding exit code travels with the criterion, so a row can be
          // re-derived by hand without the run that produced it.
          exitCode: measure(c.exitCode)
        }
      })
      .filter(c => c.id && c.status)

    const measures = {}
    const given = isObject(source.measures) ? source.measures : {}
    for (const field of MEASURE_FIELDS) measures[field] = measurePair(given[field])

    const tally = isObject(source.tally) ? source.tally : {}

    const payload = {
      schema: SHIP_OUTCOME_SCHEMA,
      ts,
      // --- the instrument, recorded with the measurement (design D8)
      version: id(source.version) || 'unknown',
      fixture,
      arm,
      host: id(source.host) || 'unknown',
      model: id(source.model) || 'unknown',
      evalAgent: id(source.evalAgent) || 'unknown',
      priceTable: id(source.priceTable) || 'unknown',
      node: id(source.node) || 'unknown',
      // --- the measurement
      criteria,
      tally: {
        met: measure(tally.met),
        applicable: measure(tally.applicable),
        notApplicable: measure(tally.notApplicable),
        unobserved: measure(tally.unobserved)
      },
      measures
    }

    const dir = join(root, EVAL_HISTORY_DIR)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, SHIP_OUTCOMES_FILE)
    const prefix = existsSync(file) && !endsWithNewline(file) ? '\n' : ''
    // JSON.stringify never emits a raw newline, so one record is always one line.
    appendFileSync(file, `${prefix}${JSON.stringify(payload)}\n`)
    return { written: true, path: file, reason: null }
  } catch (err) {
    return { written: false, path: null, reason: messageOf(err) }
  }
}

/**
 * Read the record back.
 *
 * Never throws, tolerates a torn line, and classifies by the declared schema
 * rather than by filename — the same three rules the other corpora are read
 * under. A line declaring a schema this reader does not know is counted as
 * unrecognized and contributes to nothing; it is never interpreted hopefully.
 *
 * @param {string} root repository root
 * @returns {{path: string|null, exists: boolean, records: object[],
 *   unrecognized: Array<{line: number, schema: string|null}>,
 *   skipped: Array<{line: number, reason: string}>, reason: string|null}}
 */
export function readShipOutcomes(root) {
  const empty = { path: null, exists: false, records: [], unrecognized: [], skipped: [], reason: null }
  if (typeof root !== 'string' || !root.trim()) {
    return { ...empty, reason: 'no root directory given' }
  }
  const path = shipOutcomesPath(root)
  try {
    if (!existsSync(path)) return { ...empty, path }
    const records = []
    const unrecognized = []
    const skipped = []
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (!line.trim()) return
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch (err) {
          skipped.push({ line: i + 1, reason: messageOf(err) })
          return
        }
        if (!isObject(parsed)) {
          skipped.push({ line: i + 1, reason: 'line is not a JSON object' })
          return
        }
        if (parsed.schema !== SHIP_OUTCOME_SCHEMA) {
          unrecognized.push({
            line: i + 1,
            schema: typeof parsed.schema === 'string' ? parsed.schema : null
          })
          return
        }
        records.push(parsed)
      })
    return { path, exists: true, records, unrecognized, skipped, reason: null }
  } catch (err) {
    return { ...empty, path, exists: true, reason: messageOf(err) }
  }
}
