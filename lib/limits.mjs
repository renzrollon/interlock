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
  const width = Math.max(...rows.map(([label]) => label.length))
  return (
    rows.map(([label, value]) => `  ${String(label).padEnd(width)}  ${value}`).join('\n') +
    `\n\nruntime ceilings: ${RUNTIME.maxConcurrentAgents} concurrent, ` +
    `${RUNTIME.maxAgentsPerRun} agents per run\n`
  )
}
