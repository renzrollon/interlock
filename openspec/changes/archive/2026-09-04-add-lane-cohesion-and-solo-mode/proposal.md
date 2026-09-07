## Why

The wave planner is parallel-first by contract, not by accident: the `lanes` spec requires that a lane hold only tasks joined by a path collision, so any two path-disjoint tasks become two agents no matter how small they are. The last stored plan in this repository (`.claude/ship/plan.json`, 15 tasks) shows the bill — 14 lanes for 14 implementation tasks, zero folds, and a wave in which seven sonnet agents each wrote one `evals/*/case.yaml`, with a hand-authored "format exemplar" task added purely so the seven could agree on a convention that one agent would have produced for free. Of the 29 changes on disk, 17 have 20 tasks or fewer; these are changes a single capable agent would implement more coherently and more cheaply than a fan-out, and the planner has no way to say so.

## What Changes

- **Cohesion lanes.** Inside one dependency layer, after path-collision components are formed, components whose hardest tier is at or below a published cohesion tier pack greedily into shared lanes, bounded by a per-tier lane cap. Tier 4 and tier 5 work stays isolated unless a collision joins it. Every cohesion fold is reported the way collision folds are today. Applies to the trailing test wave as well.
- **Per-tier lane cap.** The single scalar `maxTasksPerAgent` (4) becomes a tier→cap table published by `interlock limits`, so a lane of trivial edits may carry more tasks than a lane of judgment-heavy ones. The planner-level override that reproduces one agent per task is kept as the rollback lever.
- **Solo mode.** A change may be planned as one lane: every implementation task in section, layer and id order, then every test task, executed by a single opus agent with the full-read context ladder. The decision is made inside a published envelope (`interlock limits`): a `--solo` / `--waves` flag on the ship invocation wins; otherwise the classifier's recommendation is honoured only when the plan is inside the envelope; otherwise the plan is waves, byte-identical to today. The mode, its source and its reason are reported on the plan.
- **Classifier emits a mode recommendation.** The `plan-waves` prompt asks for a top-level `recommendedMode` and `modeReason` beside the per-task classification, without restating the envelope's numbers.
- **Implementer prompt.** The multi-task lane heading is reworded once so it is true for collision and cohesion lanes alike (the lane is path-disjoint from everything running beside it; nobody else touches its files), and a solo lane gets its own heading. The single-task prompt stays byte-identical.
- **Plan fingerprint and run state** carry the mode, the lane-cap table and the solo envelope, so a stored waves plan is never reused as a solo plan or vice versa, and a replan lanes under the caps the run started with.
- **No `ship.js` dispatch change beyond the prompt flag.** A solo plan is a one-wave, one-batch, one-lane plan to the state machine, the record path, worktree isolation and the merge fold.

## Capabilities

### New Capabilities
- `solo-mode`: planning a whole change as one opus lane — the published envelope, the precedence of flag over classifier over default, the lane's order, model, effort and read scope, folding of test tasks, and how the decision is reported and fingerprinted.

### Modified Capabilities
- `lanes`: a lane may now be formed by cohesion as well as by collision (the "collision only" requirement is replaced); the lane-length cap becomes a per-tier table; the tier-implied model rule gains the solo exception.
- `waves`: the classifier prompt additionally asks for a mode recommendation; the "dependency edges are never folded into one lane" guarantee is scoped to waves mode, since a solo lane honours edges by order; the plan preview names the mode and every cohesion fold.
- `implementer-prompts`: the multi-task heading is truthful for cohesion lanes and a solo lane is briefed as a whole change; single-task byte-identity is preserved.
- `plan-reuse`: the fingerprint covers the mode override, the lane-cap table and the solo envelope, and a plan's format version is bumped so pre-cohesion plans are rebuilt rather than reused.

## Impact

- **Code**: `lib/limits.mjs` (lane-cap table, cohesion tier, solo envelope, `interlock limits` surface and the cap-authority reader test), `lib/waves.mjs` (cohesion packing, solo planning, promotion report, run-state `mode`/`laneCaps`), `bin/interlock` (`waves --mode`, `plan reuse|fingerprint --mode`, `wave-state next` echoing `mode`), `workflows/ship.js` (`parseInvocation` flags, classifier prompt, solo heading in `assembleImplementerPrompt`), `bin/interlock-ship-acp` (passes the solo flag to the assembler), `lib/plan-fingerprint.mjs` (format bump, new canonical lines), `skills/ship/SKILL.md` and `skills/spec/SKILL.md` (flag table, task-shape note), `docs/10`, `README.md`, `CHANGELOG.md`.
- **Behaviour**: fewer, fatter agents on small and low-tier work; unchanged for a plan with no tier ≤ 3 siblings and no solo decision. Latency on a solo change is serial by design.
- **Tests**: `test/spine/waves.test.mjs`, `limits.test.mjs`, `implementer-prompt.test.mjs` (five lane fixtures updated deliberately, solo fixtures added), `planner-prompt.test.mjs`, `plan-fingerprint.test.mjs`, `workflows.test.mjs`, `acp-host.test.mjs`, `test/skills.test.mjs`.
- **Dependencies**: none. No new library; nothing to pin.
- **Compatibility**: stored plans in the previous format are rebuilt (one classifier pass, which is what every run paid before plan reuse existed). A run state written before `mode` existed reads as waves.
