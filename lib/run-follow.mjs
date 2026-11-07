// What `interlock run-log follow` decides on each read of a trajectory.
//
// The verb waits on one ship run and prints a line when the run halts or
// completes (make-the-run-surfaces-interactive design D8, D15, D19). Everything
// it decides lives here as a pure step, so a test calls it with a clock and a
// wait passed in and makes each decision without a real one; the CLI glue
// (`lib/run-follow-cli.mjs`) only reads the file, sleeps and prints.
//
// The terminal events are `run-halt` and `run-complete`, the same two
// `checkRunLog` (`lib/run-log.mjs`) treats as a run's end. There is no quiet
// line: the trajectory records the CLI's steps, not every tool call, so a wave of
// implementers leaves it silent for longer than any quiet threshold in an
// ordinary run. The one clock decision is the give-up: a trajectory last written
// longer ago than the bound the caller passes, with no terminal event, is a run
// with no recorded end. The bound is passed in; this module holds no number.
//
// Node-free and import-free, like the other modules the panes share. Pure:
// records in, a decision out.

/** One line of text from any value; whitespace collapsed. */
function oneLine(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/** The first non-empty string `key` among the records, last to first. */
function recorded(records, key, terminal) {
  if (terminal && oneLine(terminal[key])) return oneLine(terminal[key])
  for (let i = records.length - 1; i >= 0; i--) {
    const value = oneLine(records[i] && records[i][key])
    if (value) return value
  }
  return ''
}

/** How many unparseable lines the reader skipped: a count, or the reader's own list. */
function skippedCount(skipped) {
  if (Array.isArray(skipped)) return skipped.length
  return Number.isFinite(skipped) && skipped > 0 ? Math.floor(skipped) : 0
}

function skippedSentence(count) {
  if (count <= 0) return ''
  return count === 1
    ? ' 1 unparseable line was skipped.'
    : ` ${count} unparseable lines were skipped.`
}

/** The time of the last event the trajectory holds, as the record wrote it; else the file's mtime. */
function lastEventTime(records, lastWriteMs) {
  for (let i = records.length - 1; i >= 0; i--) {
    const ts = records[i] && records[i].ts
    if (typeof ts === 'string' && ts.trim()) return ts.trim()
  }
  if (Number.isFinite(lastWriteMs)) return new Date(lastWriteMs).toISOString()
  return 'an unrecorded time'
}

/**
 * One read of the followed trajectory.
 *
 * Returns `{ done: false, exit: null, line: null }` for a run at work, which is
 * nothing to print. Otherwise `done` is true and `exit` is the verb's exit code:
 * 0 after a halt line or a complete line (the verb reports and gates nothing,
 * design D19), 1 after the give-up line. A halt line ends by saying it is a
 * record and asks for no relaunch, because a session's monitor may hand the line
 * to a model.
 *
 * @param {Array<object>} records  the trajectory's parsed events, in file order
 * @param {{ skipped?: number|Array<unknown>, lastWriteMs?: number|null,
 *           nowMs?: number, maxAgeMs?: number }} [clock]
 * @returns {{ done: boolean, exit: number|null, line: string|null }}
 */
export function followStep(records, { skipped = 0, lastWriteMs = null, nowMs, maxAgeMs } = {}) {
  const events = Array.isArray(records) ? records.filter(r => r && typeof r === 'object') : []
  const terminal = events.find(r => r.type === 'run-halt' || r.type === 'run-complete') || null
  const count = skippedCount(skipped)
  const run = recorded(events, 'runId', terminal) || 'unknown run'
  const change = recorded(events, 'change', terminal) || 'change not recorded'

  if (terminal && terminal.type === 'run-halt') {
    const reason = oneLine(terminal.reason) || 'no reason recorded'
    return {
      done: true,
      exit: 0,
      line:
        `Run ${run} (${change}) halted: ${reason}.${skippedSentence(count)} ` +
        'This line is a record of the halt; it asks for no relaunch.'
    }
  }
  if (terminal) {
    return {
      done: true,
      exit: 0,
      line: `Run ${run} (${change}) complete.${skippedSentence(count)}`
    }
  }

  const stale =
    Number.isFinite(lastWriteMs) &&
    Number.isFinite(nowMs) &&
    Number.isFinite(maxAgeMs) &&
    nowMs - lastWriteMs > maxAgeMs
  if (stale) {
    return {
      done: true,
      exit: 1,
      line:
        `Stopped following run ${run} (${change}): its last event was at ${lastEventTime(events, lastWriteMs)} ` +
        `and the trajectory records no end, so the run may have crashed.${skippedSentence(count)}`
    }
  }
  return { done: false, exit: null, line: null }
}
