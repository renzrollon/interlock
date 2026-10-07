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

// A retry's own facts, stated. The state machine already knows which attempt
// this is and what was red last time; without them the second agent is briefed
// byte-identically to the first and re-runs the same commands with no knowledge
// that they already failed, which is what `LIMITS.interWaveFixAttempts` would
// otherwise buy.
function retryPreamble(fixAttempt, fixAttemptsRemaining, errors) {
  const attempt = Number.isInteger(fixAttempt) ? fixAttempt : 0
  if (attempt <= 0) return ''
  const remaining = Number.isInteger(fixAttemptsRemaining) ? fixAttemptsRemaining : 0
  const listed = (Array.isArray(errors) ? errors : []).filter(e => typeof e === 'string' && e.trim())
  const bullets = listed.length
    ? listed.map(e => `  - ${e.trim()}`).join('\n')
    : '  - (the previous attempt reported no error text)'
  return (
    `This is fix attempt ${attempt} of ${attempt + remaining} for this wave. ` +
    `The previous attempt reported:\n${bullets}\n\n`
  )
}

// Shell-quoted, because a planned command is one argument to the wrapper and
// routinely holds spaces, `&&` or a pipe. The same rule `workflows/ship.js`
// quotes a relay's argv with.
const quote = a => (/[^\w@%+=:,./-]/.test(String(a)) ? `'${String(a).replace(/'/g, `'\\''`)}'` : String(a))

/**
 * One planned step as the line the agent runs: the command, verbatim, inside
 * `interlock verify exec`, which passes its output and exit code through and
 * records how long it took. The inter-wave budget is charged from that record —
 * the CLI's own clock around the command — rather than from the relay and agent
 * time between the step's dispatch and its judgement.
 *
 * The line is the shell command and nothing else. The briefing says to run each
 * line exactly as written, so a `kind:` label in front of it would be run too —
 * and fail. The kind is already on the line, as `--kind`.
 */
function execLine(s) {
  const cwd = typeof s.cwd === 'string' && s.cwd.trim() && s.cwd.trim() !== '.' ? ` --cwd ${quote(s.cwd.trim())}` : ''
  return `  interlock verify exec --kind ${quote(s.kind)}${cwd} --command ${quote(s.command)}`
}

/**
 * @param {object} input
 * @param {string} input.change
 * @param {'inter-wave'|'final'} input.context
 * @param {Array<{ kind: string, command: string }>} input.steps  from `interlock verify plan`
 * @param {string|null} [input.runId]      the run whose spill tree oversized output goes to
 * @param {string|null} [input.statePath]  where to read the runId when it was not resolved
 * @param {number} [input.fixAttempt]            which retry this is (0 / absent = the first run)
 * @param {number} [input.fixAttemptsRemaining]  attempts left after this one
 * @param {string[]} [input.errors]              what the previous attempt reported
 * @returns {string}
 */
export function assembleVerifyPrompt({
  change,
  context,
  steps,
  runId,
  statePath,
  fixAttempt,
  fixAttemptsRemaining,
  errors
}) {
  const planned = (Array.isArray(steps) ? steps : []).map(execLine).join('\n')
  // A run id the CLI already knows is stated; otherwise the agent is told where
  // to read it, rather than being left to invent one and spill into nowhere.
  const spillRunId = runId
    ? String(runId)
    : statePath
      ? `<the "runId" in ${statePath}>`
      : '<runId>'
  const first = context === 'inter-wave' ? 'first ' : ''
  const retry = retryPreamble(fixAttempt, fixAttemptsRemaining, errors)

  return (
    `Run these verification steps for change "${change}" and report what happened.\n\n` +
    retry +
    planned +
    `\n\nRun each line above exactly as written, as one shell command: \`interlock verify exec\` runs the command unchanged — its ` +
    `output and exit code are the command's own — and records how long the check took.` +
    // The repair clause is the one sentence a retry must not inherit: "do not
    // repair on a first failure" is exactly wrong on the second attempt, which
    // exists to repair.
    (retry
      ? `\n\nRun ONLY these steps — do not invent extra suites. The previous run of these steps was ` +
        `red. Repair the root cause of each listed failure, then re-run the steps. Never weaken a ` +
        `test, loosen an assertion or narrow the suite: a suite that went green by shrinking is ` +
        `not green.\n\n`
      : `\n\nRun ONLY these steps — do not invent extra suites, and do not repair anything on a ` +
        `${first}failure unless the step is red for a reason you can fix by root cause without ` +
        `weakening a test. Never weaken a test, loosen an assertion or narrow the suite: a suite ` +
        `that went green by shrinking is not green.\n\n`) +
    `If a step's combined stdout/stderr exceeds the spill threshold (\`interlock limits\`), spill it:\n` +
    `  interlock verify spill --run-id ${spillRunId} --kind <kind> --input <raw-output-file> --json\n` +
    `and report that step's locator and preview instead of the text. Never paste a suite log into a ` +
    `result field — the judge rejects oversized fields.\n\n` +
    `Report one entry per step with kind, exitCode and the counts you can read. Report what the ` +
    `steps did, not whether the run may continue — that verdict is not yours to render.`
  )
}
