## 1. Implementation

<!-- Four independent files, no cross-dependency — one parallel batch. -->

- [x] 1.1 In `lib/waves.mjs`: extend `validate` to check `dependsOn` fail-closed — an array of strings when present, every referenced id resolves to a task in the plan, and the edge set is acyclic (a self-edge is a cycle), naming the cause on rejection; then assign each task's implementation wave as its topological depth over the **union** of section groups and `dependsOn` edges (strictly greater than every section- and edge-predecessor, `byTaskId` tie-break), feeding the existing wave→batch→lane→singleton-fold pipeline; guarantee an edge-connected pair is never co-scheduled in one batch and never folded into one lane (lane membership stays a canonical-path collision component); guarantee an edge-free plan is byte-identical to today; and ensure the replan path (`makeWave`) re-derives the same depth ordering from `dependsOn` so a revised wave preserves edge order. (specs: `task-dependencies`, `waves`; design D1–D4, D10)
- [x] 1.2 In `lib/plan-fingerprint.mjs`: fold each task's `dependsOn` into the plan fingerprint so plan-reuse identity reflects the edge set and an absent edge set does not change the fingerprint. (design D9)
- [x] 1.3 In `workflows/ship.js`: update the `plan-waves` classifier prompt so it instructs the model to populate `dependsOn` with the ids of earlier tasks a task's output needs, and to prefer a precise `dependsOn` edge over incrementing `group` when the dependency crosses to a different file. No dispatch change. (spec: `waves` MODIFIED; design D8)
- [x] 1.4 In `skills/spec/SKILL.md`: mirror the classifier guidance in the task-shape rules — a cross-file dependency is a reason to add a `dependsOn` edge, not to increment the numbered section. (spec: `waves` MODIFIED)

## 2. Tests

<!-- Each test file is independent of the others — one parallel batch — but all need section 1's implementation to exist. -->

- [x] 2.1 In `test/spine/waves.test.mjs`: cover `dependsOn` validation (accept a valid edge; reject non-array / non-string / dangling reference / cycle / self-edge, each naming the cause); depth ordering (a cross-file edge orders without a new section while an independent sibling stays parallel; an edge cannot pull a task earlier than its section; a diamond serializes only along its edges); the no-co-schedule / no-lane-fold guarantee for path-disjoint dependents; and the edge-free byte-identical no-op plus cross-run reproducibility. (specs: `task-dependencies`, `waves`)
- [x] 2.2 In `test/spine/plan-fingerprint.test.mjs`: assert a changed `dependsOn` changes the fingerprint and an absent `dependsOn` leaves it unchanged. (design D9)
- [x] 2.3 In `test/spine/planner-prompt.test.mjs`: assert the `plan-waves` prompt (`workflows/ship.js`) instructs emitting `dependsOn` and preferring an edge over incrementing `group` for a cross-file dependency, and assert `skills/spec/SKILL.md` carries the same guidance so the prose mirror cannot drift from the prompt. (spec: `waves` MODIFIED; covers 1.3 and 1.4)
