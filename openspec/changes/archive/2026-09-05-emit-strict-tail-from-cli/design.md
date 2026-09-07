## Context

See proposal.md — Why. The constraints that shape the how:

- **The run program and its interpreters exist** (`emit-wave-steps-from-cli`): steps carry `then.argv`, briefings are files, the manifest holds the flags, and the drivers hold no policy except the named `HOST_TAIL_SEAM` allowance. This change adds steps to the program and deletes the allowance.
- **The review engine is already in the CLI.** `lib/review-core.mjs` decides survival, the tolerance band and the gate (`openspec/specs/review/evidence-gate/spec.md`); `interlock review --findings --verdicts --changed --metrics` is what the review agent runs today (`workflows/ship.js:2082-2087`). `lib/remediate.mjs` plans a round (`byFile` groups, the unscoped group, `reReviewDimensions`) and publishes `roundCap` from `LIMITS.remediationRounds` (`workflows/ship.js:2129-2134`, `openspec/specs/ship/cap-authority/spec.md:13-31`).
- **Rubrics and policy are delivered as instructions today**: `RUBRIC_INSTRUCTIONS` tells the review agent where each dimension's criteria live and `POLICY_INSTRUCTIONS` tells it to run `interlock review-policy --json` and prepend the prose (`workflows/ship.js:535-565`). The rubric-delivery spec requires every dimension, including on re-review, to receive its written criteria (`openspec/specs/review/rubric-delivery/spec.md`); the policy-file spec requires the prose to be injected and the do-not-report filter to be CLI-side (`openspec/specs/review/policy-file/spec.md`).
- **Dimension choice is a judgement in the prompt today** ("devops when the diff touches deploy, config or infrastructure; security when it touches auth, input handling or data exposure", `workflows/ship.js:2066-2068`), while the run already observes its changed paths and classifies their blast radius deterministically (`lib/risk.mjs`, `lib/surface.mjs`, `openspec/specs/ship/handoff-evidence/spec.md:38`).
- **Observed values are never asked of an agent** (`openspec/specs/ship/outcome-provenance/spec.md:39`). The commit agent is currently asked to run `interlock autonomy record review-code --blockers <n>` (`workflows/ship.js:2368-2372`), which hands an observed count to the party being assessed.
- **The stage marker** for `review` and `remediation` is published by the agent from a briefing line (`lib/prompts/stage.mjs` after the first change; `hooks/guard-tests.mjs` denies test edits during `remediation`).

No new library. Nothing to pin.

## Goals / Non-Goals

**Goals:**

- The strict tail is one sequence of CLI-emitted steps, identical on every host, with every judgement that has a correct answer (survival, band, gate, rounds, dimension choice, autonomy record) computed in the CLI.
- The Workflow script and the ACP driver contain no tail text and no tail policy; the no-policy sweep has no allowance left.
- Every guarantee of today's strict run is preserved: evidence-gated dismissal, tie keeps, the verdict round as the only halting round, rubric delivery on re-review, conformance as questions, stage markers for the guards.

**Non-Goals:**

- Changing what the reviewers, skeptics, fixers or handoff writers are told to do. The text moves; it is not reworded beyond removing the CLI invocations the agent no longer makes.
- Changing the review policy file format, the survival arithmetic, the tolerance band or the remediation cap.
- Running dimension reviewers as separate spawns. As today, one worker agent fans out dimensions and skeptics in its own context; splitting them is a separate cost decision.

## Decisions

### D1 — The tail is emitted in today's order, as steps

When the manifest carries any tail flag and the wave state reaches `done`, `run next` emits `review` (if `review`), whose continuation is `run reviewed`; `run reviewed` emits `remediate` rounds and the verdict, each continuing to `run remediated --round N`; the verdict continues to `run verify-final`; `run judge --context final` emits `handoff` (if `handoff` or `conformance`) continuing to `run commit`, else `commit`; `run close` finishes. The same order as `workflows/ship.js` sections 4, 5, 6, 7 and 8. Without any tail flag the program is byte-for-byte the lean program.

### D2 — Adjudication and the budget run in the CLI

`run reviewed --results <file>` reads `.claude/ship/findings.json` and `.claude/ship/verdicts.json` (written by the agent), takes `--changed` from the run's observed changed paths, runs `lib/review-core.mjs` exactly as `interlock review --metrics <change>` would (writing `review.json` and the metrics file), and asks `lib/remediate.mjs` for round one. It emits a `remediate` step with the plan inlined, or `verify-final` when nothing needs fixing. `run remediated --round N --results <file>` re-adjudicates the rewritten files, records `fixed`/`deferred` on the manifest, increments `fixRoundsRun`, and asks `lib/remediate.mjs` for round N+1: a fixing round, the verdict, or a halt when blockers survive the verdict. `roundCap` never leaves the CLI; `remediationRounds`'s reader stays `lib/remediate.mjs`.

*Why the agent stops running `interlock review`:* it was one more model-mediated CLI call whose stdout the agent had to copy, and the changed-path list it passed was self-reported. The CLI has both the files and the observed paths.

### D3 — Rubrics and policy are inlined, and a missing rubric is said on the step

`lib/prompts/review.mjs` and `lib/prompts/remediate.mjs` take `dimensions: [{ name, rubric: string | null }]` and `policyProse`. `run` reads each dimension's criteria through the same rubric reader `interlock review` uses (the rubric-delivery implementation) and the policy prose through the review-policy parser; a dimension whose criteria cannot be read gets `rubric: null`, the briefing says the reviewer works from the dimension name alone, and the step carries `REVIEW RUBRIC UNAVAILABLE: <dimension>`. Re-review inlines the same files again for `reReviewDimensions`, and a dimension in that list that did not run in the first pass is either given its criteria or marked not applicable — the rule the prompt states today (`workflows/ship.js:2163-2166`), now applied by the CLI when it assembles the briefing.

### D4 — Dimensions are selected by a recorded rule, and the agent may add one

`lib/prompts/dimensions.mjs` exports `selectDimensions(changedPaths)`: `language`, `architecture`, `qa` and `technical-lead` always; `devops` when the changed paths include deploy, CI, configuration or infrastructure files by the classification `lib/surface.mjs` and `lib/risk.mjs` already make; `security` when they include authentication, input-handling or data-exposure paths by the same classification. The step records `dimensions` and a reason per optional dimension. The review briefing tells the agent it may add a dimension with a one-line reason; `run reviewed` accepts findings under an unlisted dimension and records the addition on the manifest.

*Why a rule:* "does this diff touch infrastructure" has an answer the run already computes for the risk class. Leaving it to the reviewer made the dimension set unreportable.

### D5 — The handoff briefing is pre-computed

Before emitting `handoff`, `run judge --context final` runs `interlock surface --changed <observed>` and, when `conformance` is set, `interlock conformance <change> --changed <observed>`, and inlines `needsManualTestPlan` (with the reason when false) and the scenario checklist into the briefing. The agent writes `manual-test-plan.md`, `code-explanation.md`, `conformance.md` and at most three memory entries, as today, and reports the counts.

### D6 — The autonomy record is written at close

`run close` runs the equivalent of `interlock autonomy record review-code --blockers <n>` when the manifest is `strict`, with `n` the surviving-blocker count from the last adjudication the CLI performed. The commit briefing loses the paragraph that asked the agent to do it.

### D7 — Receipt and summary fields come from the manifest

`lib/receipt.mjs` reads `summary.review` (counts from `review.json`), `summary.remediation`, `summary.remediationRounds` (= `fixRoundsRun`), handoff counts and the autonomy record outcome from the manifest and the work files; the `LEAN SHIP` line prints exactly when a tail piece was skipped, as today.

### D8 — Effort for the review and remediation spawns comes from the limits table

The spawns carry `effort: EFFORT.skeptic` and `EFFORT.verify` from `lib/limits.mjs`, read by `lib/run.mjs`; the `SKEPTIC_EFFORT` / `VERIFY_EFFORT` literals leave the script.

## Risks / Trade-offs

- **[Briefings grow]** → four to six rubric files inlined make a review briefing tens of kilobytes. It is a file delivered by reference on the Workflow host and inline on ACP; it replaces the agent reading the same files itself.
- **[The rule under-selects a dimension]** → the agent may add one and the addition is recorded; the reported dimension set makes under-selection visible across runs where it was invisible before.
- **[A halted verdict on the ACP host]** → identical to the Workflow host: `halt` step, `run close --halt`, exit `1`.

## Migration Plan

Lands after `emit-wave-steps-from-cli`. Removing the `HOST_TAIL_SEAM` allowance from the no-policy sweep is the last task, so the sweep fails if any tail text survives in a driver.

## Open Questions

None that change the specs or the task breakdown.
