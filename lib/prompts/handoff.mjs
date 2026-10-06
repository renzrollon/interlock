// The handoff briefing — manual test plan, code explanation, spec
// conformance and learnings capture, in that order.
//
// Moved from `workflows/ship.js` (the handoff section) as part of
// `emit-strict-tail-from-cli`. The only change is where the two decisions
// come from (design D5): the retired text told the agent to run
// `interlock surface` and, when conformance was on, `interlock conformance`,
// itself. `run judge --context final` now runs both in-process before this
// briefing is assembled and inlines what they decided — whether a manual
// test plan is needed (with the reason when it is not) and the scenario
// checklist to answer. The agent still writes every artifact and reports
// the counts; nothing about what it is asked to do changed.
//
// `needsManualTestPlan` is `null` when the manifest's `handoff` flag is off
// (a conformance-only run): the manual-test-plan and code-explanation
// artifacts, and the learnings capture, belong to `handoff`, not to
// `conformance`, in the retired text (`workflows/ship.js:2295-2328`), so a
// `null` here skips that whole section rather than guessing which way a
// boolean should default.

/**
 * @param {{id: string, artifact: string, line: number, title: string}} scenario
 * @returns {string} one checklist line, matching `lib/conformance.mjs`'s own `formatChecklist`
 */
function renderScenario(scenario) {
  const s = scenario || {}
  const loc = s.artifact ? `${s.artifact}:${s.line}` : null
  return loc ? `  ${s.id}  ${s.title}\n      ${loc}` : `  ${s.id}  ${s.title}`
}

/**
 * Assemble the handoff briefing.
 *
 * @param {object} input
 * @param {string} input.change
 * @param {boolean|null} input.needsManualTestPlan  from `interlock surface`; `null` when `handoff` is off
 * @param {string} [input.testPlanReason]  why no plan is needed, when `needsManualTestPlan` is `false`
 * @param {Array<{id: string, artifact: string, line: number, title: string}>|null} input.conformance
 *   the scenario checklist from `interlock conformance`, or `null` when `conformance` is off
 * @param {boolean} input.learnings  whether to ask for the learnings-capture paragraph
 * @returns {string}
 */
export function assembleHandoffPrompt({ change, needsManualTestPlan, testPlanReason, conformance, learnings }) {
  const wantsHandoffArtifacts = needsManualTestPlan !== null && needsManualTestPlan !== undefined
  const scenarios = Array.isArray(conformance) ? conformance : null

  const parts = [`Produce the handoff artifacts for change "${change}".\n`]

  if (wantsHandoffArtifacts) {
    parts.push(
      needsManualTestPlan
        ? `Write openspec/changes/${change}/manual-test-plan.md covering every touched file, with ` +
          `spec scenarios and tasks mapped to numbered cases.\n`
        : `Skip the manual test plan and say why: ${testPlanReason || 'no UI-testable surface was touched'} ` +
          `— a backend-only change does not get a UI test plan.\n`
    )
    parts.push(
      `Then write openspec/changes/${change}/code-explanation.md as a commit teach-in: why each ` +
        `file changed, what changed, the blast radius, and what would break if it were left out.\n`
    )
  }

  if (scenarios !== null) {
    const list = scenarios.length ? scenarios.map(renderScenario).join('\n') : '  (no scenarios listed)'
    parts.push(
      `Spec conformance — for each scenario below, read the implementation and answer whether the ` +
        `described behaviour was actually built, citing file:line. Write the answers to ` +
        `openspec/changes/${change}/conformance.md with one section per scenario id. A scenario you ` +
        `cannot confirm is recorded as unconfirmed with what you looked at — never as satisfied, and ` +
        `never omitted. If the checklist is empty, say so and move on.\n\n${list}\n\n` +
        `This never halts the run: a prose scenario matched to code is a judgement, and a judgement ` +
        `that stopped a ship run would be a gate built on a guess. Report it and let a person read it.\n`
    )
  }

  if (learnings) {
    parts.push(
      `Finally, capture at most three learnings from fixes made during this run — recurring failure ` +
        `modes under .claude/memory/failure-modes/, module coupling under .claude/memory/coupling/ — ` +
        `each one small file, indexed in .claude/memory/MEMORY.md. Only genuinely recurring patterns; ` +
        `write nothing if nothing recurred. This is silent.`
    )
  }

  return parts.join('\n')
}
