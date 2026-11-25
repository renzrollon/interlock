// `interlock verify exec`: run one planned check through the shell, its output
// and exit code passed through, and append one timing line for it.
//
// The timing line feeds `run judge`'s inter-wave budget (`lib/run.mjs` reads
// `VERIFY_TIMINGS_PATH`). `--record <file>` appends the same line, byte for
// byte, to a second file: the exec record `interlock settle validation --exec`
// reads. Neither write is a gate. A failed append is a stderr warning and the
// command's exit code stands, and a `--record` with no file is said, not dropped.

import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { constants as osConstants } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { VERIFY_TIMINGS_PATH } from './run.mjs'

/** The exit code of a finished `spawnSync`: its own, 128 + the signal's number, or 127 when it never started. */
export function execExitCode(ran, warn) {
  if (ran.error) {
    warn(`interlock: verify exec could not run the command: ${ran.error.message}`)
    return 127
  }
  if (typeof ran.status === 'number') return ran.status
  const signal = ran.signal && osConstants.signals[ran.signal]
  return Number.isInteger(signal) ? 128 + signal : 1
}

/**
 * Run `command` and return its exit code.
 *
 * @param {object} given
 * @param {string} given.root  the repository root the timing file lives under
 * @param {string} given.kind
 * @param {string} given.command
 * @param {string} [given.cwd]
 * @param {string|boolean} [given.record]  the `--record` flag as parsed: a path, or `true` when no file followed it
 * @param {(line: string) => void} [given.warn]
 * @returns {number}
 */
export function verifyExec({ root, kind, command, cwd, record, warn = line => process.stderr.write(`${line}\n`) }) {
  const file = typeof record === 'string' && record.trim() ? record : null
  if (record !== undefined && !file) warn('interlock: --record needs a file; no exec record will be written')
  // Timed here, around the command and nothing else: the inter-wave budget
  // used to be clocked from the step's dispatch to its judgement, which
  // charged two relays and the verify agent's own turns to "verification"
  // and spent the whole budget on the first checkpoint of every Workflow run.
  const started = performance.now()
  const ran = spawnSync(command, { shell: true, stdio: 'inherit', cwd })
  const durationMs = Math.round(performance.now() - started)
  const exitCode = execExitCode(ran, warn)
  const line = JSON.stringify({ kind, exitCode, durationMs, command, at: new Date().toISOString() }) + '\n'
  const append = (path, failed) => {
    try {
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, line)
    } catch (err) {
      warn(`${failed}: ${(err && err.message) || err}`)
    }
  }
  // A timing is a budget input, not a gate: losing it costs the budget its
  // precision (the judge falls back to the round trip, and says so), never the
  // check its result.
  append(join(root, VERIFY_TIMINGS_PATH), 'interlock: verify timing not recorded')
  if (file) {
    const at = resolve(root, file)
    append(at, `interlock: exec record not written to ${at}`)
  }
  return exitCode
}
