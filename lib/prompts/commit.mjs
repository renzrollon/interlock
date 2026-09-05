// The commit briefing — the lean form.
//
// The Workflow driver appended an autonomy-ladder record under `--strict`. That
// belongs to the strict tail, which this change does not move (design D6), and
// the lean form never carried it. So this is the lean text alone, and the tail's
// own briefing gains the ladder line when `emit-strict-tail-from-cli` moves it.

import { publishStageLine } from './stage.mjs'

/**
 * @param {object} input
 * @param {string} input.change
 * @param {number} input.stageIndex  the run's monotonic marker write count
 * @returns {string}
 */
export function assembleCommitPrompt({ change, stageIndex }) {
  return (
    `Commit change "${change}" as ONE feature-level commit.\n\n` +
    // The commit stage is the ONE stage guard-commit lets `git commit` through.
    // Publishing it first is what unblocks the commit below.
    publishStageLine('commit', change, stageIndex) +
    `Read the change artifacts and write a verb-phrase conventional-commit message with a short ` +
    `outcome summary. Stage only the files this run touched — never \`git add -A\`, never amend, ` +
    `never push.`
  )
}
