## Why

A separate agent is worth its spawn prefix only when it runs beside another one, and today the planner spends agents with no regard for that. The last real plan it built was jumphour's `github-app-and-openspec-discovery`: 32 tasks became 18 implementation lanes, and **every batch held exactly one lane**, so all of them ran one after another.

- Wave 1 was `[1.1] → [1.2] → [1.3] → [2.1]`: four serial sonnet agents, each starting cold. Batches inside a wave never see each other's handoffs.
- Every lane ran on sonnet, including the tier-4 tasks and the multi-task lanes. Sonnet was chosen because of the model clamp, not because a lane was small.

The maintainer's instruction (2026-09-23) states the rule this change encodes: worker lanes default to opus, sonnet is for a single subtask, and single-subtask agents exist only where they actually run in parallel. Where work cannot run in parallel, one opus work agent does more of it.

## What Changes

- **Chain lanes.** After the singleton fold, and inside the trailing test wave, every maximal run of two or more consecutive batches that each hold exactly one lane is fused into one **chain** lane. One agent runs its tasks in the batch order they would have run in anyway.
  - A chain is bounded by the existing per-tier lane cap for its hardest tier, packed next-fit. The uniform override still applies, so an override of 1 means no fusion.
  - A chain never crosses a wave boundary. The red wave and the test wave fuse only internally, and a solo plan is untouched.
  - A batch holding two or more lanes is never fused, so no parallelism is lost.
  - A replanned group fuses the same way.
- **Lane-shape model routing.** A lane of two or more tasks, whether collision, cohesion or chain, dispatches on **opus**. A lane of one task keeps that task's clamped model: haiku or sonnet, and opus only for a tier-5 opus task or a solo promotion.
  - Effort is unchanged and stays derived from tier.
  - The per-task model clamp is unchanged, and replanned tasks are now clamped too.
  - The trajectory's `agent-spawn` model is taken from the same rule as dispatch, rather than from a hand-kept copy.
- **One crashed agent is one failure.** A multi-task lane whose agent returns no result at all charges its first task as failed and marks the rest `not-attempted`. Without this, one briefing-ack miss on a three-task chain would halt the run. A result that *omits* an outcome still fails every task.
- **Reporting.** Chain lanes are a reported lane kind: they are listed on the plan, warned about with the ids they joined, and named in the preview. The "effectively serial" warning is measured before fusion.
- **Plan format bumped** to `interlock.ship-plan/4`, so a stored plan built by the old planner is rebuilt rather than reused unfused.
- **Unchanged on purpose:**
  - The cohesion ceiling. The only recorded runs show predicted-path disjointness failing on 2 of 5 cohesion lanes, and unpacking them would write one file concurrently in the default shared tree.
  - The lane-cap table.
  - The classifier prompt.
  - The implementer briefing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `lanes`:
  - A lane may also be a chain fused from serial single-lane batches.
  - Cohesion's no-dependency rule is scoped to cohesion lanes.
  - The fold report gains the `chain` kind, and the lane cap bounds chains.
  - In-lane order gains the chain exception.
  - The lane-model rule moves from "the hardest task's model" to lane shape.
  - A lane with no result charges one failure.
- `waves`:
  - A dependency edge may now join two tasks in one chain lane, in dependency order, but still never in one batch.
  - The singleton-fold staircase ends as a chain.
  - The preview names chain lanes and measures "effectively serial" before fusion.
- `task-dependencies`: the edge-free guarantee is restated against the current section-and-path planner rather than a historical one, so the dependency signal stays purely additive.
- `plan-reuse`: a plan built before chain lanes existed is rebuilt rather than reused.
- `effort-routing`: the rationale no longer claims effort mirrors the lane-model rule. An opus lane of low-tier tasks keeps low effort.

## Impact

- **Code:**
  - `lib/waves.mjs`: the fusion step in planning and replan, the lane-model rule, the replan clamp, reports, warnings and preview.
  - `lib/run.mjs`: no-result lane accounting.
  - `bin/interlock`: the trajectory writer imports the lane label and model functions.
  - `lib/plan-fingerprint.mjs`: format bump.
  - `lib/limits.mjs`: comments that call tier 5 the only opus lane.
- **Behaviour:**
  - Fewer implementer agents whenever a wave has serial batches: the jumphour plan drops from 18 implementation agents to 10.
  - Most multi-task lanes now run on opus, at about 5x sonnet's list price per token.
  - No change to what may run concurrently.
- **Hosts:** Codex and Qwen operators who mapped only `sonnet` in `INTERLOCK_MODEL_MAP` will see multi-task lanes bannered as unrouted until they map `opus`. The Claude Workflow and CLI hosts pass `opus` through unmapped.
- **Tests:**
  - `test/spine/waves.test.mjs`: several pins of the superseded "never fold an edge into one lane" and "staircase stays separate agents" behaviour are rewritten to the new contract.
  - `test/spine/run.test.mjs`, `test/spine/cli.test.mjs` and `test/spine/plan-fingerprint.test.mjs`.
- **Docs:** `docs/04`, `docs/06`, `docs/07` and `docs/10`, where they restate the clamp, lane or model rules.
- **Dependencies:** none.
