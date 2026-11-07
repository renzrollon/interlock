// The `interlock run-log follow` verb: wait on one ship run's trajectory and
// print a line when the run halts or completes (make-the-run-surfaces-interactive,
// spec ship/run-follow, design D8, D15, D19).
//
// Every decision is `lib/run-follow.mjs`'s `followStep`; this module resolves the
// trajectory one time at start, re-reads it every `LIMITS.meterTickMs`, gives up
// at `LIMITS.launchLedgerMaxAgeMs`, and prints. It takes its clock and its wait
// as arguments, so a test runs it without a real wait, and it only reads: no
// trajectory event, no metric, no file is written.
//
// The entry file's `die` comes in as `io`, so a refused flag exits as the rest
// of the CLI does.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { LIMITS } from './limits.mjs'
import { readRunLog, runLogDir } from './run-log.mjs'
import { followStep } from './run-follow.mjs'

const realWait = ms => new Promise(resolve => setTimeout(resolve, ms))

/** The id of the trajectory under `home` written most recently, or null when there is none. */
function newestRunId(dir) {
  let entries
  try {
    entries = existsSync(dir) ? readdirSync(dir) : []
  } catch {
    return null
  }
  let best = null
  for (const name of entries.filter(n => n.endsWith('.jsonl')).sort()) {
    let mtimeMs
    try {
      mtimeMs = statSync(join(dir, name)).mtimeMs
    } catch {
      continue
    }
    if (best === null || mtimeMs >= best.mtimeMs) best = { id: name.slice(0, -'.jsonl'.length), mtimeMs }
  }
  return best ? best.id : null
}

/**
 * Follow one run to its end.
 *
 * @param {{ home: string, run?: string, write: (line: string) => void,
 *           now?: () => number, wait?: (ms: number) => Promise<void> }} opts
 * @returns {Promise<number>} the verb's exit code: 0 after a halt or complete
 *   line, 1 for nothing to report (no run, an unknown id, the age bound)
 */
export async function followRun({ home, run, write, now = Date.now, wait = realWait }) {
  const dir = runLogDir(home)
  const runId = typeof run === 'string' && run.trim() ? run.trim() : newestRunId(dir)
  if (!runId) {
    write(`No run is recorded: no trajectory under ${dir}.`)
    return 1
  }
  const first = readRunLog(home, runId)
  if (!first.exists) {
    write(`No trajectory is recorded for run ${runId} under ${dir}.`)
    return 1
  }

  for (;;) {
    const read = readRunLog(home, runId)
    if (read.reason) {
      write(`Could not read the trajectory of run ${runId} at ${read.path}: ${read.reason}.`)
      return 1
    }
    let lastWriteMs = null
    try {
      lastWriteMs = statSync(read.path).mtimeMs
    } catch {
      lastWriteMs = null
    }
    const step = followStep(read.records, {
      skipped: read.skipped,
      foreign: read.foreignLines,
      lastWriteMs,
      nowMs: now(),
      maxAgeMs: LIMITS.launchLedgerMaxAgeMs
    })
    if (step.done) {
      write(step.line)
      return step.exit
    }
    await wait(LIMITS.meterTickMs)
  }
}

/**
 * `interlock run-log follow [--run <id>]`. The state home is the one `run-log
 * show` resolves. Sets the exit code rather than ending the process, so a line
 * written to a pipe is flushed.
 */
export async function runLogFollow(io, home, flags, json) {
  if (json) io.die('run-log follow prints one text line; --json is not read')
  if (flags.run === true) io.die('--run requires a run id')
  process.exitCode = await followRun({
    home,
    run: flags.run,
    write: line => process.stdout.write(line + '\n')
  })
}
