// The prompt fragment that asks a step's own agent to publish the ship stage.
//
// The stage marker is the one channel from a run to the stateless `PreToolUse`
// guards, which fire in a different process and share no memory with the run
// (`lib/ship-stage.mjs`). Neither host writes it directly — the Workflow runtime
// has no filesystem at all — so the agent doing the work writes it first, and
// the recorded `pid` is that agent session's process: alive for the run's
// duration, gone once it ends, which is how a later session rejects an orphan.
//
// The shape used to be a set of literals duplicated in `workflows/ship.js` and
// drift-tested against `lib/ship-stage.mjs`. It is rendered from that module's
// own constants now, so there is nothing left to drift (design D8).

import { MARKER_FIELDS, STAGES, stagePath } from '../ship-stage.mjs'

/**
 * The fragment for `stage`, published for `change` at write count `index`.
 *
 * A failed write is a non-fatal note, never a halt: the marker is a guard
 * input, not a gate the run depends on.
 *
 * @param {string} stage  one of `lib/ship-stage.mjs` STAGES
 * @param {string} change
 * @param {number} index  the run's monotonic marker write count
 * @returns {string}
 */
export function publishStageLine(stage, change, index) {
  if (!STAGES.includes(stage)) {
    throw new Error(
      `unknown ship stage "${stage}" — the guards read only ${STAGES.join(', ')}, and a marker ` +
        `holding anything else reads back as unknown`
    )
  }
  const values = { stage, change, index, pid: '<PID>' }
  const json =
    '{' +
    MARKER_FIELDS.map(
      field => `"${field}":${field === 'stage' || field === 'change' ? `"${values[field]}"` : values[field]}`
    ).join(',') +
    '}'
  return (
    `\nBefore anything else, publish the ship stage so the PreToolUse guards can read it. ` +
    `Write the file ${stagePath(change)} (create its parent directory) containing exactly ` +
    `this one-line JSON, substituting the number \`echo $PPID\` prints for <PID>:\n` +
    `  ${json}\n` +
    `If the write fails, add a note "stage-marker write failed: <reason>" to your result and continue.\n`
  )
}
