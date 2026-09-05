// The verification briefing — one form for both contexts and both hosts.
//
// The two drivers ran verification differently. The ACP driver planned with the
// CLI, handed the planned steps to one agent, and judged the reported results
// with the CLI. The Workflow driver asked its agent to run `verify plan`,
// `verify judge`, `verify cluster` and `verify repair` itself, which put the
// judgement inside the party being judged.
//
// The ACP shape is the one that survives: the CLI plans, the agent RUNS the
// planned steps and reports what happened, the CLI judges. The agent is never
// told a threshold and never renders a verdict.

/**
 * @param {object} input
 * @param {string} input.change
 * @param {'inter-wave'|'final'} input.context
 * @param {Array<{ kind: string, command: string }>} input.steps  from `interlock verify plan`
 * @param {string|null} [input.runId]      the run whose spill tree oversized output goes to
 * @param {string|null} [input.statePath]  where to read the runId when it was not resolved
 * @returns {string}
 */
export function assembleVerifyPrompt({ change, context, steps, runId, statePath }) {
  const planned = (Array.isArray(steps) ? steps : []).map(s => `  ${s.kind}: ${s.command}`).join('\n')
  // A run id the CLI already knows is stated; otherwise the agent is told where
  // to read it, rather than being left to invent one and spill into nowhere.
  const spillRunId = runId
    ? String(runId)
    : statePath
      ? `<the "runId" in ${statePath}>`
      : '<runId>'
  const first = context === 'inter-wave' ? 'first ' : ''

  return (
    `Run these verification steps for change "${change}" and report what happened.\n\n` +
    planned +
    `\n\nRun ONLY these steps — do not invent extra suites, and do not repair anything on a ` +
    `${first}failure unless the step is red for a reason you can fix by root cause without ` +
    `weakening a test. Never weaken a test, loosen an assertion or narrow the suite: a suite that ` +
    `went green by shrinking is not green.\n\n` +
    `If a step's combined stdout/stderr exceeds the spill threshold (\`interlock limits\`), spill it:\n` +
    `  interlock verify spill --run-id ${spillRunId} --kind <kind> --input <raw-output-file> --json\n` +
    `and report that step's locator and preview instead of the text. Never paste a suite log into a ` +
    `result field — the judge rejects oversized fields.\n\n` +
    `Report one entry per step with kind, exitCode and the counts you can read. Report what the ` +
    `steps did, not whether the run may continue — that verdict is not yours to render.`
  )
}
