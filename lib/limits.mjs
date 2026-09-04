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

  // `maxTasksPerAgent` — the single scalar lane cap — was REMOVED here rather
  // than aliased to the tier table that replaced it (`LANE_CAPS.byTier` below).
  // It had six readers: the planner, `makeWave`, `createRunState`, the plan
  // fingerprint's canonical text, `formatFingerprint` and `formatLimits`. A
  // deprecated alias would have let any one of them keep reading a scalar while
  // the rest read the table, and the two would disagree silently about how long
  // a lane may get — which is the drift this module exists to prevent. Removing
  // it makes the sweep enforceable instead: a stale reader fails at import.

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
  maxHandoffChars: 2000,

  /**
   * Byte ceiling for the repo-root `REVIEW.md` policy file. A file larger than
   * this is not scanned: it is reported as a problem and the run proceeds under
   * default policy (fail-open, add-interlock-review-policy design.md D3). The
   * bound exists so a pathological or accidental (a committed build log named
   * `REVIEW.md`) file cannot make the policy reader do unbounded work — the same
   * reason every other scan in this loop is bounded rather than trusting.
   * Read by `readReviewPolicy` in `lib/review-core.mjs`.
   */
  maxReviewPolicyBytes: 65_536
}

/**
 * Caps the eval suite obeys, published here so nothing restates them in
 * `.github/workflows/evals.yml` — a cost written in workflow YAML and echoed in
 * a skill drifts exactly like a prose cap does. The CI job reads them from
 * `interlock limits` (add-interlock-evals design.md D8), following the same
 * precedent the implementer prompt sets at `workflows/ship.js:194-195`.
 *
 * These are deliberately a separate object from LIMITS rather than more entries
 * in it: LIMITS counts loop iterations, whereas a cost ceiling is a dollar
 * amount. They are held to the same reader invariant all the same — the
 * cap-authority test walks `.github/workflows/` alongside `lib/`, `bin/` and
 * `workflows/`, and a CI reader counts when it names the published field
 * (`evals.<cap>`) rather than the export. There is no exemption: a cap here with
 * no reader fails the same test a cap in LIMITS would.
 *
 * `reportingThreshold` was removed rather than wired, following the
 * `memoryEntriesPerRun` precedent above. It described a score at or above which
 * a case reported as passing, but `lib/evals-triage.mjs` reads no score at all —
 * `classifyCase` branches on each grader's `passed` boolean — so there was no
 * path it could govern without inventing one. Publishing it told a contributor
 * that a scoring rule existed which did not.
 *
 * The two cost ceilings are first guesses to be tuned from the `cost_usd` the
 * first runs actually report (design.md D15), not numbers the specs depend on.
 */
export const EVAL_CAPS = {
  /** US dollars. Ceiling for the per-pull-request smoke subset. */
  smokeCostUsd: 2,

  /** US dollars. Ceiling for the scheduled full-suite run. */
  fullRunCostUsd: 15,

  /**
   * Agent runs per case. Passed as `--runs` by the scheduled full-suite job,
   * which overrides each case's own value: those were chosen for the fast
   * per-change subset, and the scheduled arm is the one that can afford
   * repetition. The smoke job's `--runs 1` is that subset's single-run posture,
   * not a restatement of this cap.
   */
  runsPerCase: 3,

  // --- the promotion rule (spec: evals/promotion) --------------------------
  //
  // These three are the whole rule that decides whether an eval case may fail a
  // build. They live here, with readers, for the reason the module header gives:
  // a promotion threshold written in a specification is a sentence a reviewer
  // re-argues once per proposal. `lib/evals-promote.mjs` reads all three by
  // name, and nothing restates them in a skill, a spec, a doc, or the workflow
  // YAML.
  //
  // Landing them WITH readers is deliberate: `runsPerCase` sat here printed and
  // unread, and `reportingThreshold` was removed for the same reason. A fourth
  // unread cap is the one thing this group must not gain.

  /**
   * Consecutive qualifying runs a case must pass across before it may be
   * promoted from advisory to blocking. A run triage classified no-signal or
   * configuration does not qualify, is named, and does not break the chain.
   * Read by `promote()` in `lib/evals-promote.mjs`.
   */
  promotionRuns: 3,

  /**
   * Trials of a case a run must carry to count as evidence for promotion. Below
   * this the run is real but too thin to prove repeatability, and the case is
   * refused naming the run rather than promoted on it.
   * Read by `promote()` in `lib/evals-promote.mjs`.
   */
  promotionTrialsPerRun: 3,

  /**
   * Minimum measured judge/human agreement, as a fraction, for each judged
   * grader of a case being promoted. `interlock evals calibrate` measures;
   * this is the floor it is measured against, applied only here — the
   * calibration report itself issues no verdict.
   *
   * The one non-integer in this group, which is why the positive-integer
   * invariant is over LIMITS rather than over every cap group.
   * Read by `promote()` in `lib/evals-promote.mjs`.
   */
  judgeAgreementFloor: 0.8
}

/**
 * Reasoning-effort defaults for the wave planner and the two adversarial steps.
 *
 * Deliberately a separate object from LIMITS, exactly like EVAL_CAPS/REPORT_CAPS:
 * LIMITS holds positive-integer iteration counts (its invariant test asserts
 * every entry is one, and every entry must be read as `LIMITS.<cap>` by a
 * code path). These are a tier→effort table and two fixed effort strings —
 * neither an integer nor a loop count. Keeping them here still satisfies the one
 * property that matters: the mapping is read from a single source and surfaced
 * by `interlock limits`, never restated in code that can drift.
 *
 * `byTier` maps a lane's hardest tier to a workflow-runtime effort. `null` means
 * "inherit the session default — do not force": tiers 3–4 inherit by policy so
 * the run keeps whatever the session/model default is (xhigh for coding since
 * w16); an untiered lane inherits by fallback. `verify` and `skeptic` pin the
 * inter-wave verify and the review skeptics regardless of any lane tier — the
 * two steps whose whole job is catching what an implementer missed.
 */
export const EFFORT = {
  byTier: { 1: 'low', 2: 'low', 3: null, 4: null, 5: 'xhigh' },
  verify: 'xhigh',
  skeptic: 'xhigh'
}

/**
 * How long a lane may get, per tier, and which tiers may be packed together.
 *
 * A lane is an ordered task list one agent executes start to finish. Until this
 * table existed the bound was one scalar for every lane in the run, which forced
 * one number to answer two different questions: how much sequential trivia one
 * agent may hold, and how much judgement-heavy work it may hold. Those have
 * different answers, so this is a table.
 *
 * `byTier` is keyed by the lane's HARDEST task tier (`laneTier`), because that is
 * the tier the lane's agent is dispatched at. An untiered lane (tier 0) uses the
 * tier-1 entry. Tier 4 keeps the old scalar's 4 — cross-file pattern-following is
 * where a fresh context per task still pays. Tier 5 is raised to 8 because a
 * tier-5 lane is the only opus lane in waves mode, and the point of an opus
 * worker is that it can hold more of one design in its head.
 *
 * `cohesionMaxTier` is the ceiling for COHESION: path-disjoint components in one
 * dependency layer whose hardest tier is at or below it may be packed into one
 * lane. Above it a component stays a lane of its own, joined only by a real path
 * collision. Set it to 0 to disable cohesion while keeping the table.
 *
 * A separate export from LIMITS for the same reason `EFFORT` is: the LIMITS
 * invariant asserts every entry is a positive integer, and `byTier` is a table.
 * The cap-authority check covers this group all the same — every entry here must
 * have a reader in `lib/`, `bin/` or `workflows/`.
 *
 * Read by `lib/waves.mjs` (lane construction, cohesion packing) and
 * `lib/plan-fingerprint.mjs`; printed by `interlock limits` and emitted as
 * `laneCaps` by `interlock limits --json`.
 */
export const LANE_CAPS = {
  byTier: { 1: 8, 2: 8, 3: 6, 4: 4, 5: 8 },
  cohesionMaxTier: 3
}

/**
 * The envelope inside which a change may be planned as ONE lane — every task,
 * in order, on one opus agent (`--solo`, or the classifier's recommendation).
 *
 * One bound, task count, on purpose. The classifier supplies the shape
 * judgement ("this change is one coherent edit"); this supplies the ceiling.
 * Neither restates the other, which is why the `plan-waves` prompt is forbidden
 * from naming this number: a model that can read the bound can argue with it.
 *
 * A recommendation above the envelope is refused and named. An explicit `--solo`
 * flag may exceed it — a human flag is the one input allowed to, the same way
 * `--max-parallel` may ask for anything under the runtime ceiling — and the plan
 * warns that it did.
 *
 * Read by `lib/waves.mjs` (mode decision) and `lib/plan-fingerprint.mjs`;
 * printed by `interlock limits` and emitted as `solo` by `--json`.
 */
export const SOLO = {
  maxTasks: 20
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
    ['inter-wave fix attempts (per wave)', LIMITS.interWaveFixAttempts],
    ['replans (per run)', LIMITS.replansPerRun],
    ['remediation rounds', LIMITS.remediationRounds],
    ['root-cause iterations (per run)', LIMITS.rootCauseIterations],
    ['task failures tolerated', LIMITS.taskFailureHalt],
    ['inter-wave verify budget', `${LIMITS.interWaveVerifyBudgetMs / 1000}s`],
    ['inter-wave verifications (per run)', LIMITS.interWaveVerifications],
    ['verify spill threshold (bytes)', LIMITS.verifySpillBytes],
    ['verify preview budget (chars)', LIMITS.verifyPreviewChars],
    ['wave handoff budget (chars, per task)', LIMITS.maxHandoffChars],
    ['review policy scan cap (bytes)', LIMITS.maxReviewPolicyBytes]
  ]
  const evalRows = [
    ['eval smoke cost ceiling (per PR)', `$${EVAL_CAPS.smokeCostUsd}`],
    ['eval full-run cost ceiling (scheduled)', `$${EVAL_CAPS.fullRunCostUsd}`],
    ['eval runs per case', EVAL_CAPS.runsPerCase],
    ['eval promotion: consecutive qualifying runs', EVAL_CAPS.promotionRuns],
    ['eval promotion: trials per qualifying run', EVAL_CAPS.promotionTrialsPerRun],
    ['eval promotion: judge agreement floor', `${Math.round(EVAL_CAPS.judgeAgreementFloor * 100)}%`]
  ]
  const reportRows = [['report trajectory scan cap', REPORT_CAPS.maxRunsScanned]]
  // One row per tier, rather than a rendered object: an operator reading this
  // wants to know what bounds the lane in front of them, and a tier is how they
  // find it. The cohesion ceiling and the solo envelope print beside them because
  // all three answer one question — how many tasks may one agent be handed.
  const laneRows = [
    ['lane cap: tier 1 lane (also untiered)', LANE_CAPS.byTier[1]],
    ['lane cap: tier 2 lane', LANE_CAPS.byTier[2]],
    ['lane cap: tier 3 lane', LANE_CAPS.byTier[3]],
    ['lane cap: tier 4 lane', LANE_CAPS.byTier[4]],
    ['lane cap: tier 5 lane', LANE_CAPS.byTier[5]],
    ['cohesion tier ceiling (packs at or below)', LANE_CAPS.cohesionMaxTier],
    ['solo envelope (max tasks in one lane)', SOLO.maxTasks]
  ]
  // `null` in the tier table means inherit the session default; print it as
  // "inherit" so an operator reads the policy, not an empty cell.
  const inherit = v => (v === null || v === undefined ? 'inherit (session default)' : v)
  const effortRows = [
    ['effort: tier 1 lane', inherit(EFFORT.byTier[1])],
    ['effort: tier 2 lane', inherit(EFFORT.byTier[2])],
    ['effort: tier 3 lane', inherit(EFFORT.byTier[3])],
    ['effort: tier 4 lane', inherit(EFFORT.byTier[4])],
    ['effort: tier 5 lane', inherit(EFFORT.byTier[5])],
    ['effort: inter-wave verify step', EFFORT.verify],
    ['effort: review skeptic step', EFFORT.skeptic]
  ]
  const width = Math.max(
    ...[...rows, ...laneRows, ...evalRows, ...reportRows, ...effortRows].map(
      ([label]) => label.length
    )
  )
  const fmt = ([label, value]) => `  ${String(label).padEnd(width)}  ${value}`
  return (
    rows.map(fmt).join('\n') +
    '\n\n' +
    laneRows.map(fmt).join('\n') +
    '\n\n' +
    evalRows.map(fmt).join('\n') +
    '\n\n' +
    reportRows.map(fmt).join('\n') +
    '\n\n' +
    effortRows.map(fmt).join('\n') +
    `\n\nruntime ceilings: ${RUNTIME.maxConcurrentAgents} concurrent, ` +
    `${RUNTIME.maxAgentsPerRun} agents per run\n`
  )
}
