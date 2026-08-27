## Why

The wave planner has exactly two ways to keep task B from running before task A: put them in the same file so a **path collision** serializes them into one lane, or push B into a later **numbered section** so it becomes a later wave. Neither fits the common case — B depends on A but they edit *different* files. A path collision cannot see it (disjoint paths), so the only tool left is a new section, and a section is an all-or-nothing barrier: pushing B into section 2 to sit after A drags every task independent of A that happened to land in section 2 behind *all* of section 1. The planner over-serializes precisely because its finest cross-file ordering tool is the coarsest one it has. `lib/waves.mjs:249-317` and `skills/spec/SKILL.md:131-139` confirm there is no per-task dependency signal today.

## What Changes

- Add an optional `dependsOn: [taskId, …]` edge to the classified-task schema — a sibling of the existing optional `paths`. A task declares the earlier tasks whose output it needs. This is the precise cross-file ordering signal the planner lacks.
- Teach the deterministic planner to order tasks by the **union** of two constraints: the numbered-section group (unchanged, still a barrier) and the explicit dependency edges. Each task's implementation wave becomes its **topological depth** — the longest chain of section-predecessors and edge-predecessors ahead of it — with the existing `byTaskId` tie-break preserving reproducibility. An edge `A→B` guarantees B is scheduled in a strictly later batch or wave than A, even when A and B share no path and sit in the same section.
- Realize edges through the **existing** wave→batch→lane→singleton-fold machinery rather than a new scheduling path: a depth increment that lands a lone dependent task in its own layer folds back onto the previous wave as a later batch (the singleton-fold requirement in `waves` already reclaims that checkpoint), so a precise edge does not buy an extra inter-wave verify. Lanes remain path-collision components only; batch packing stays path-disjoint. `lanes` is unchanged.
- Validate the edge fail-closed in the planner's existing `validate` pass (`lib/waves.mjs:151-185`): `dependsOn` must be an array of strings when present, every referenced id must exist in the task list, and the edge set must be acyclic. A dangling reference or a cycle is a malformed plan and is **rejected and reported**, exactly as an out-of-repo `paths` entry is today — never silently dropped.
- Update the `plan-waves` classifier prompt in `workflows/ship.js` to emit `dependsOn` and to prefer a precise edge over a new section number for a cross-file dependency, and mirror that guidance in `skills/spec/SKILL.md`'s task-shape rules. Independent tasks stay in one section (parallel); only the genuine dependency is expressed, so a section barrier is needed less often.
- Fold `dependsOn` into the plan fingerprint (`lib/plan-fingerprint.mjs`) so plan-reuse identity reflects the new signal.

Back-compatible by construction: a plan with no `dependsOn` on any task produces byte-identical waves, batches and lanes to today.

Out of scope (recorded as decisions): automatic edge inference from the codebase import/symbol graph, and auto-collapsing over-incremented sections into parallel waves. Both are deferred follow-ups; this change adds the explicit signal first.

## Capabilities

### New Capabilities
- `task-dependencies`: the optional `dependsOn` edge on a classified task — its schema, its validation (array-of-strings, references resolve, acyclic), its fail-closed rejection of malformed edges, and the guarantee that an absent edge set leaves planning byte-identical to the path-and-section model.

### Modified Capabilities
- `waves`: a task's implementation wave is derived from the topological depth over the union of its section group and its explicit dependency edges, not from the section group alone; two tasks connected by a dependency edge are never co-scheduled in the same batch; and the `plan-waves` classifier prompt now emits `dependsOn` and prefers an edge over a new section for a cross-file dependency.

## Impact

- **Code**:
  - `lib/waves.mjs` — extend `validate` for `dependsOn` (shape, ref-resolution, acyclicity, fail-closed); derive per-task wave depth from section ∪ edges before the existing grouping/fold pipeline runs; ensure edge-connected tasks never land in one batch.
  - `workflows/ship.js` — the `plan-waves` classifier prompt only (grouping rules gain `dependsOn` guidance). **No runtime dispatch change**: lanes-of-N and batch fan-out already handle whatever the planner emits.
  - `lib/plan-fingerprint.mjs` — include `dependsOn` in the fingerprint so reuse identity is correct.
  - `skills/spec/SKILL.md` — task-shape guidance mirrors the classifier prompt.
- **Behavior**: fewer false serializations (independent tasks no longer dragged behind a section they share with a dependent one) and no missed real ones (cross-file dependencies now expressed precisely). Determinism and replay-safety are preserved — the depth computation is a pure function of the enriched input.
- **Dependencies**: none. No new library; the `dependsOn` field rides the existing classified-task JSON.
- **Compatibility**: additive optional field; absent edges reproduce today's plans exactly. Coordinates with in-flight `add-lane-effort-routing` (adjacent in `lib/limits.mjs`/lane routing, no logical conflict) and `isolate-ship-waves-in-worktrees` (per-lane spawn; this change is pure-planner and does not touch that spawn).
