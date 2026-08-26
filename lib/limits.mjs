// Every cap the ship loop obeys, in one place.
//
// These numbers used to live in `skills/ship/SKILL.md` as prose — "cap two
// attempts", "cap five root-cause iterations", "more than two task failures".
// Prose caps drift: a number written in one heading gets restated differently
// three headings later, and nothing catches it. Worse, a model reading a cap in
// prose treats it as guidance, and the whole point of a cap is that it is not.
//
// So the loop engines read them from here, the CLI prints them, and the skills
// cite the CLI rather than restating the number. When a cap changes it changes
// once.
//
// Pure: no fs, no agent, no I/O.
// Exposed to skills as `interlock limits [--json]`.

/**
 * Ceilings that come from the dynamic-workflow runtime rather than from
 * Interlock policy. The runtime caps concurrency at 16 and total agents at 1000
 * per run; exceeding either is the runtime's error, not ours, so the planner
 * clamps below them rather than discovering them the hard way.
 * @see https://code.claude.com/docs/en/workflows
 */
export const RUNTIME = {
  maxConcurrentAgents: 16,
  maxAgentsPerRun: 1000
}

export const LIMITS = {
  /** Agents spawned per batch. Waves wider than this are split. */
  maxParallel: 8,

  /**
   * Tasks one agent may execute in a single lane. A lane is a chain of tasks
   * that a path collision already forced to run one after another, so folding
   * them into one agent costs nothing in parallelism and saves a spawn prefix
   * per task. A collision component longer than this splits into lanes that
   * stay sequential relative to each other.
   *
   * The bound exists because a lane is also the unit an interruption can lose:
   * the workflow runtime's replay discards every agent started after the first
   * unfinished one, so a fat lane re-runs entirely. Set it to 1 to reproduce
   * one-agent-per-task exactly — this cap is the rollback lever for lanes.
   *
   * Read by `lib/waves.mjs` (lane construction), printed by `interlock limits`.
   */
  maxTasksPerAgent: 4,

  /**
   * Targeted fix attempts after a failed inter-wave check, per wave. After
   * this the errors are logged and the run either halts (if they block the
   * next wave) or continues with a warning.
   */
  interWaveFixAttempts: 2,

  /** Revisions of not-yet-executed wave groups, per run. */
  replansPerRun: 2,

  /** Review → fix → re-review cycles. Surviving blockers after this halt. */
  remediationRounds: 2,

  /**
   * Root-cause repair iterations against a red unit suite, across the whole
   * run. Repairing by root cause is slow by design; this bounds it before the
   * run turns into an open-ended debugging session.
   */
  rootCauseIterations: 5,

  /**
   * Task failures tolerated across all waves. Strictly more than this halts —
   * a run losing three tasks is not producing a coherent change.
   */
  taskFailureHalt: 2,

  // `memoryEntriesPerRun` was removed here rather than wired. It had no reader
  // anywhere outside this file and its own value-pinning test, and memory
  // writing is not implemented as a counted operation — so wiring it would have
  // meant inventing an enforcement point to justify a number. A cap this module
  // prints but nothing obeys is the same failure as a cap written in prose,
  // which is the failure this module exists to end.

  /**
   * Soft budget for inter-wave verification. Past this, drop to typecheck only
   * rather than letting the checks outweigh the work they guard.
   */
  interWaveVerifyBudgetMs: 60_000,

  /**
   * Combined stdout/stderr byte threshold past which a verify step's output is
   * spilled to disk (`lib/spill.mjs`) instead of returned inline. See
   * add-ship-run-inspectability design.md §3.
   */
  verifySpillBytes: 8192,

  /**
   * Character budget for a spilled step's head-and-tail preview, and the
   * ceiling every other verify-result text field must stay under. A result
   * field larger than this is rejected as an oversized-result leak rather than
   * judged.
   */
  verifyPreviewChars: 4096,

  /**
   * Inter-wave verification checkpoints allowed per run. A wave boundary is
   * ordering; a checkpoint is an agent. Ordering is free, so the cap is on
   * checkpoints, not on waves. Docs-only waves skip without consuming a slot.
   */
  interWaveVerifications: 3,

  /**
   * Character budget for one task's wave handoff — `summary`, `next`,
   * `blocker` and the joined `evidence` locators added together. A packet over
   * this fails its task rather than being truncated: silent truncation is the
   * degradation the schema exists to forbid, and a next wave reading half a
   * sentence is worse off than one told the report was rejected.
   * See add-wave-handoff-and-prompt-snapshots design.md §2.
   */
  maxHandoffChars: 2000
}

/**
 * Caps the eval suite obeys, published here so nothing restates them in
 * `.github/workflows/evals.yml` — a cost written in workflow YAML and echoed in
 * a skill drifts exactly like a prose cap does. The CI job reads them from
 * `interlock limits` (add-interlock-evals design.md D8), following the same
 * precedent the implementer prompt sets at `workflows/ship.js:194-195`.
 *
 * These are deliberately a separate object from LIMITS rather than more entries
 * in it: LIMITS counts loop iterations and every entry must be read as
 * `LIMITS.<cap>` by a lib/bin/workflows code path (its invariant test), whereas
 * these caps are read only by the CI workflow — which that test cannot see —
 * and a cost ceiling is a dollar amount, not an iteration count.
 *
 * The two cost ceilings are first guesses to be tuned from the `cost_usd` the
 * first runs actually report (design.md D15), not numbers the specs depend on.
 */
export const EVAL_CAPS = {
  /** US dollars. Ceiling for the per-pull-request smoke subset. */
  smokeCostUsd: 2,

  /** US dollars. Ceiling for the scheduled full-suite run. */
  fullRunCostUsd: 15,

  /** Agent runs per case — the harness `runs` default the suite pins. */
  runsPerCase: 3,

  /**
   * Score at or above which a completed run reports a case as passing. A case
   * below it is reported as a regression; the gate stays advisory (design.md
   * D3), so this threshold reports — it does not block.
   */
  reportingThreshold: 1
}

/**
 * Caps for the corpus reader (`interlock report`).
 *
 * Not a policy ceiling like the ones above — nothing halts on it. It bounds how
 * much of an unbounded, ever-growing corpus one invocation opens, so a
 * repository with fifty thousand trajectories still gets a report. Reaching it
 * is stated in the output rather than sampled silently: a truncated scan that
 * looked complete would be worse than no report at all.
 */
export const REPORT_CAPS = {
  /** Trajectory files opened in one `interlock report` invocation. */
  maxRunsScanned: 2000
}

/**
 * Clamp a requested parallelism to something both Interlock and the runtime
 * will honour. A caller asking for 40 gets the runtime ceiling, not an error:
 * over-asking is a preference, not a mistake worth failing a run over.
 * @param {number} [requested]
 * @returns {{value: number, clamped: boolean, reason: string|null}}
 */
export function clampParallel(requested) {
  if (!Number.isInteger(requested) || requested <= 0) {
    return { value: LIMITS.maxParallel, clamped: false, reason: null }
  }
  if (requested > RUNTIME.maxConcurrentAgents) {
    return {
      value: RUNTIME.maxConcurrentAgents,
      clamped: true,
      reason: `workflow runtime allows at most ${RUNTIME.maxConcurrentAgents} concurrent agents`
    }
  }
  return { value: requested, clamped: false, reason: null }
}

/** Human-readable dump, so a skill can show the caps without hardcoding them. */
export function formatLimits() {
  const rows = [
    ['max parallel agents per batch', LIMITS.maxParallel],
    ['max tasks per agent (lane cap)', LIMITS.maxTasksPerAgent],
    ['inter-wave fix attempts (per wave)', LIMITS.interWaveFixAttempts],
    ['replans (per run)', LIMITS.replansPerRun],
    ['remediation rounds', LIMITS.remediationRounds],
    ['root-cause iterations (per run)', LIMITS.rootCauseIterations],
    ['task failures tolerated', LIMITS.taskFailureHalt],
    ['inter-wave verify budget', `${LIMITS.interWaveVerifyBudgetMs / 1000}s`],
    ['inter-wave verifications (per run)', LIMITS.interWaveVerifications],
    ['verify spill threshold (bytes)', LIMITS.verifySpillBytes],
    ['verify preview budget (chars)', LIMITS.verifyPreviewChars],
    ['wave handoff budget (chars, per task)', LIMITS.maxHandoffChars]
  ]
  const evalRows = [
    ['eval smoke cost ceiling (per PR)', `$${EVAL_CAPS.smokeCostUsd}`],
    ['eval full-run cost ceiling (scheduled)', `$${EVAL_CAPS.fullRunCostUsd}`],
    ['eval runs per case', EVAL_CAPS.runsPerCase],
    ['eval reporting threshold', EVAL_CAPS.reportingThreshold]
  ]
  const reportRows = [['report trajectory scan cap', REPORT_CAPS.maxRunsScanned]]
  const width = Math.max(...[...rows, ...evalRows, ...reportRows].map(([label]) => label.length))
  const fmt = ([label, value]) => `  ${String(label).padEnd(width)}  ${value}`
  return (
    rows.map(fmt).join('\n') +
    '\n\n' +
    evalRows.map(fmt).join('\n') +
    '\n\n' +
    reportRows.map(fmt).join('\n') +
    `\n\nruntime ceilings: ${RUNTIME.maxConcurrentAgents} concurrent, ` +
    `${RUNTIME.maxAgentsPerRun} agents per run\n`
  )
}
