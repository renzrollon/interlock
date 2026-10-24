// The merge-request fix briefing: one fixing round, and nothing after it.
//
// `interlock mr remediate-brief` prints this (design D5 of
// close-the-merge-request-loop). It is the ship loop's remediation briefing
// with the verification half removed on purpose: the fixer fixes and writes a
// result file, and the `mr` skill commits, pushes and puts a fresh review on
// the pushed head, by reviewers who did not write the fix. A fixer that judged
// its own work would make "fixed" mean "the fixer said so".
//
// Findings are listed with the id `interlock mr comment` printed for them
// (`findingId`), so a reply table, a comment and this briefing name one finding
// one way. The finding-rendering helpers are the remediation briefing's own.

import { findingId } from '../findings.mjs'
import { renderFinding } from './remediate.mjs'

const withId = finding => renderFinding(finding).replace(/^- /, `- ${findingId(finding)} `)

function renderGroup(group) {
  const g = group || {}
  const findings = Array.isArray(g.findings) ? g.findings : []
  return `File ${g.file}:\n${findings.map(withId).join('\n')}`
}

/**
 * @param {object} input
 * @param {string} input.change
 * @param {number} input.round  1-based fix round number
 * @param {{fix: {byFile: Array<{file: string, findings: Array}>, unscoped: Array}}} input.plan
 *   the round's plan, as `lib/remediate.mjs`'s `planRemediation` returns it
 * @param {string} input.head  the commit the findings were raised against
 * @param {number|string|null} [input.prNumber]
 * @param {string[]} [input.protectedPaths]  paths the fixer must not edit
 * @param {string} [input.resultPath]  where the fixer writes its result
 * @returns {string}
 */
export function assembleMrRemediatePrompt({ change, round, plan, head, prNumber, protectedPaths, resultPath }) {
  const fix = (plan && plan.fix) || {}
  const byFile = Array.isArray(fix.byFile) ? fix.byFile : []
  const unscoped = Array.isArray(fix.unscoped) ? fix.unscoped : []
  const protectedList = (Array.isArray(protectedPaths) ? protectedPaths : []).filter(p => typeof p === 'string' && p)
  const result = typeof resultPath === 'string' && resultPath ? resultPath : `.claude/ship/mr/remediate-r${round}.json`
  const mergeRequest =
    prNumber !== null && prNumber !== undefined && `${prNumber}` !== ''
      ? `merge request #${prNumber}`
      : 'the merge request under review'

  const byFileBlock = byFile.map(renderGroup).join('\n\n')
  const unscopedBlock = unscoped.map(withId).join('\n')
  const protectedBlock = protectedList.length
    ? protectedList.map(p => `- ${p}`).join('\n')
    : '(none known: no test profile was found, so nothing could be classified as protected)'

  return (
    `Fix round ${round} for change "${change}", ${mergeRequest}, at head ${head}.\n\n` +
    `You are on the diff of that commit. Fix the root cause of each finding listed below, not the ` +
    `symptom a reviewer happened to point at. Fix blockers and warnings; never fix a suggestion. A ` +
    `finding you do not fix is recorded with its reason, never silently dropped.\n\n` +
    (byFileBlock ? `${byFileBlock}\n\n` : '(no file-scoped findings to fix)\n\n') +
    (unscopedBlock ? `Unscoped (no single owning file), apply last:\n${unscopedBlock}\n\n` : '') +
    `PROTECTED PATHS — never edit, create or delete any of these. They are the repository's tests; ` +
    `a change to one is reverted after your round and reported:\n${protectedBlock}\n\n` +
    `Do not commit, do not push and do not stage. The skill commits what you leave in the working ` +
    `tree. Do not judge your own fixes: another reviewer reads the pushed head.\n\n` +
    `When you are done, write JSON to ${result} in exactly this shape and then stop:\n` +
    `{ "ok": true|false, "fixed": ["<finding id>", ...], "notFixed": [{ "id": "<finding id>", "reason": "<why>" }] }\n` +
    `ok is false only when the round could not be carried out at all. Every listed id appears in ` +
    `exactly one of fixed and notFixed. Return the counts only; do not paste your reasoning into ` +
    `this result.`
  )
}
