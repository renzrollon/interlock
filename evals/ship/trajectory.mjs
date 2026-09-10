// The process half of the outcome eval: what the loop's own JSONL says it did.
//
// The disk graders in `graders.mjs` answer "what state did the run leave". This
// module answers the other question — did the run emit the events the run
// program contracts, did every recorded action come from the vocabulary the CLI
// already refuses unknown values against, and did a unit-red judgement the CLI
// already recorded close with a halt.
//
// THIS IS NOT TRANSCRIPT GRADING. The events walked here are the loop's own
// trajectory (`.claude/ship/runs/<runId>.jsonl`), written by `lib/run-log.mjs`
// from CLI invocations — not chat messages, not a plugin-eval trace, not an
// implementer's tool-call list. Nothing an agent SAID reaches this file.
//
// Three properties keep it honest:
//
//   1. **The allowed sets are imported, never copied.** `RUN_LOG_TYPES` and
//      `ACTIONS` are owned by the modules that write against them. A copy here
//      would drift the first time the run program gained a tail step, and the
//      drift would show up as an eval failing runs that were correct.
//   2. **Presence, not order.** A completed run must have emitted the
//      stage-bearing types; the ORDER of those events, and the order of an
//      implementer's tool calls, is not a criterion. Asserting a golden sequence
//      would fail honest runs that replanned.
//   3. **It re-judges nothing.** Redness is read off the `unitStatus` the CLI
//      already recorded. This module never runs a suite, never decides what red
//      means, and never gates: it is an observer, and `interlock run-log check`
//      remains the only reconstructability decision (design D6).
//
// Pure over `records[]`, so a test can feed it a planted event list with no
// scratch root and no spawn. The grader wrapper in `graders.mjs` supplies the
// records by way of `interlock run-log show --json`, which is the same reader
// the reconstructability criterion goes through.

import { RUN_LOG_TYPES } from '../../lib/run-log.mjs'
import { ACTIONS } from '../../lib/run.mjs'

/**
 * The three process criterion identifiers. Stable: they are keys in a committed
 * history record, and a reader of an older row finds them absent rather than
 * renamed.
 */
export const PROCESS_CRITERIA = Object.freeze({
  REQUIRED_TYPES: 'trajectory-required-event-types',
  KNOWN_ACTIONS: 'trajectory-known-actions',
  HALT_ON_UNIT_RED: 'trajectory-halt-on-unit-red'
})

/**
 * Statuses a finding may carry — the same three the disk graders use, minus
 * `n/a`, which is the arm's property rather than the walker's and is applied by
 * `graders.mjs` on the control arm.
 *
 * Spelled as literals rather than imported from `graders.mjs`, which imports
 * this module: a cycle would work today and break the moment either file grew a
 * module-level reference to the other. `test/spine/ship-trajectory.test.mjs`
 * pins these against `STATUS` so the two cannot drift apart in silence.
 */
export const PROCESS_STATUSES = Object.freeze(['pass', 'fail', 'unobserved'])

/**
 * The types a run that closed with `run-complete` must have emitted, ON TOP of
 * what reconstructability already requires.
 *
 * `run-start` and the close itself are deliberately absent: `checkRunLog`
 * decides those, and re-asserting them here would report one defect as two.
 * `agent-spawn` is absent for a different reason — a run that halted at
 * classification never spawned anything, and a completed run that reused a plan
 * and had nothing to do is rare but honest. Requiring a spawn would fail runs
 * that were right.
 */
export const COMPLETED_REQUIRED_TYPES = Object.freeze([
  'wave-action',
  'cli-exit',
  'verify-judgement',
  'run-receipt'
])

/**
 * The unit statuses `lib/verify.mjs`'s `judgeUnitResult` already treats as
 * halting, copied by value because they are what it WRITES onto the event
 * rather than a list it exports.
 *
 * `green` and `red-pre-existing` are not here: a suite that was already red
 * before the run touched it is not a run that ignored its own verdict.
 */
export const HALTING_UNIT_STATUSES = Object.freeze(['red', 'error', 'weakened'])

// Bounds on what a finding may carry back. Same reasoning as every other text
// bound in this repository: a finding is read by a human and copied into a
// history row, and neither should be handed an unbounded list built out of a
// malformed log.
const MAX_REPORTED = 20
const MAX_DETAIL = 300

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unique(values) {
  return [...new Set(values)]
}

function clip(text) {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text
}

/** One finding, shaped so `graders.mjs` can hand it straight to `criterion()`. */
function finding(id, status, detail, extra = {}) {
  return { id, status, detail: clip(detail), ...extra }
}

/**
 * How a trajectory closed. Both flags, never one derived from the other: a log
 * carrying BOTH a halt and a complete is malformed in a way that matters to
 * halt-on-unit-red, and collapsing it to a single "closed how" string would hide
 * that.
 */
function closeOf(records) {
  return {
    completed: records.some(r => r.type === 'run-complete'),
    halted: records.some(r => r.type === 'run-halt')
  }
}

/**
 * Every event type the log carries that the writer would not have accepted.
 *
 * A record with no `type` at all counts: `appendRunLogEvent` refuses to write
 * one, so a line without a type did not come from the writer.
 */
function unknownTypesIn(records) {
  return unique(
    records
      .filter(r => typeof r.type !== 'string' || !RUN_LOG_TYPES.includes(r.type))
      .map(r => (typeof r.type === 'string' && r.type.trim() ? r.type : '(no type)'))
  ).slice(0, MAX_REPORTED)
}

/**
 * Events carrying an `action` the run program does not know.
 *
 * The key's PRESENCE is the trigger, not its truthiness: `wave-action` always
 * writes the key, and `lib/run-log.mjs` copies the value as bounded text without
 * checking it against `ACTIONS` — so an invented value (`report`, the one a
 * control-plane ping has been observed to fabricate) lands in the file intact.
 * A `null` or empty value counts as unknown for the same reason: the writer's
 * caller always has a step action, so an absent one means something upstream
 * lost it.
 */
function unknownActionsIn(records) {
  const offenders = []
  for (const r of records) {
    if (!Object.prototype.hasOwnProperty.call(r, 'action')) continue
    const action = r.action
    if (typeof action === 'string' && ACTIONS.includes(action)) continue
    offenders.push({
      seq: Number.isFinite(r.seq) ? r.seq : null,
      type: typeof r.type === 'string' ? r.type : null,
      action: typeof action === 'string' && action.trim() ? action : null
    })
    if (offenders.length >= MAX_REPORTED) break
  }
  return offenders
}

/**
 * Walk one run's records and decide the three process criteria.
 *
 * Never throws and never spawns. An empty or unreadable record list leaves all
 * three UNOBSERVED — never passing: a missing trajectory is a run nobody can
 * grade on process, and reading its absence as clean would flatter exactly the
 * runs that failed to write one.
 *
 * @param {object[]} records as returned by `readRunLog`/`interlock run-log show --json`
 * @returns {Array<{id: string, status: 'pass'|'fail'|'unobserved', detail: string}>}
 */
export function walkTrajectory(records) {
  const list = (Array.isArray(records) ? records : []).filter(isObject)

  if (!list.length) {
    const why =
      'the run recorded no trajectory events, so its process could not be inspected — ' +
      'recorded unobserved, not clean'
    return [
      finding(PROCESS_CRITERIA.REQUIRED_TYPES, 'unobserved', why, { events: 0 }),
      finding(PROCESS_CRITERIA.KNOWN_ACTIONS, 'unobserved', why, { events: 0 }),
      finding(PROCESS_CRITERIA.HALT_ON_UNIT_RED, 'unobserved', why, { events: 0 })
    ]
  }

  const { completed, halted } = closeOf(list)
  const present = new Set(list.map(r => r.type))
  const events = list.length

  // --- required event types ------------------------------------------------
  const unknownTypes = unknownTypesIn(list)
  // Only a completed run is held to the stage-bearing set. A run that halted
  // never reached verification or its own receipt, and failing it for their
  // absence would score an honest early stop as a process defect (design D3).
  const missingTypes = completed ? COMPLETED_REQUIRED_TYPES.filter(t => !present.has(t)) : []
  const typesOk = unknownTypes.length === 0 && missingTypes.length === 0
  const required = finding(
    PROCESS_CRITERIA.REQUIRED_TYPES,
    typesOk ? 'pass' : 'fail',
    typesOk
      ? completed
        ? `the completed run emitted ${COMPLETED_REQUIRED_TYPES.join(', ')}, and every event type is one the writer accepts`
        : 'every event type is one the writer accepts; a run that did not complete is not held to the types only a completed ship emits'
      : [
          missingTypes.length
            ? `a run-complete close is missing ${missingTypes.join(', ')}`
            : '',
          unknownTypes.length ? `event type(s) the writer does not accept: ${unknownTypes.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('; '),
    { close: completed ? 'run-complete' : halted ? 'run-halt' : 'none', missingTypes, unknownTypes, events }
  )

  // --- known actions -------------------------------------------------------
  const unknownActions = unknownActionsIn(list)
  const known = finding(
    PROCESS_CRITERIA.KNOWN_ACTIONS,
    unknownActions.length ? 'fail' : 'pass',
    unknownActions.length
      ? `${unknownActions.length} event(s) carry an action the run program does not know: ` +
        unknownActions.map(o => `#${o.seq ?? '?'} ${o.type ?? '?'} → ${o.action ?? '(absent)'}`).join(', ')
      : 'every recorded action is one the run program allows',
    { unknownActions, events }
  )

  // --- halt on unit red ----------------------------------------------------
  // Read off the status the CLI already recorded. This criterion never runs a
  // suite and never decides what red means (design D4) — doing either would make
  // the eval a second judge of a question the loop already answered.
  const halting = list.filter(
    r => r.type === 'verify-judgement' && HALTING_UNIT_STATUSES.includes(r.unitStatus)
  )
  const haltStatuses = unique(halting.map(r => r.unitStatus)).slice(0, MAX_REPORTED)
  let haltStatus = 'pass'
  let haltDetail =
    'no verify judgement recorded a halting unit status, so there was no unit-red decision to honour'
  if (halting.length) {
    const honoured = halted && !completed
    haltStatus = honoured ? 'pass' : 'fail'
    haltDetail = honoured
      ? `a unit-halting judgement (${haltStatuses.join(', ')}) closed with run-halt`
      : `a unit-halting judgement (${haltStatuses.join(', ')}) closed with ` +
        `${completed ? 'run-complete' : 'no run-halt'} — the run did not honour a verdict the CLI had already recorded`
  }
  const haltOnRed = finding(PROCESS_CRITERIA.HALT_ON_UNIT_RED, haltStatus, haltDetail, {
    haltingJudgements: halting.length,
    unitStatuses: haltStatuses,
    close: completed ? 'run-complete' : halted ? 'run-halt' : 'none',
    events
  })

  return [required, known, haltOnRed]
}
