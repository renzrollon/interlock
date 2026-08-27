## Context

See proposal.md — Why. The planner (`lib/waves.mjs`) is a pure, replay-safe function: a resumed run is re-derived by replaying the same transitions from cached results (`lib/waves.mjs:36-53`), so any new signal must be a pure function of the (possibly enriched) classified-task input, not something fetched at plan time. Today the input carries `group` (integer, from the numbered `tasks.md` section) and optional `paths` (string array). Ordering emerges from exactly two rules: distinct groups become sequential waves (`lib/waves.mjs:507-526`), and canonical-path collisions within a group become one sequential lane (`buildLanes`, `lib/waves.mjs:249-317`). The living `lanes` spec fixes strong invariants this design must not break: a lane is *only* a canonical-path collision component, lanes in a batch are path-disjoint, and the lane cap is a single published scalar.

## Goals / Non-Goals

**Goals:**
- Give the classifier a precise cross-file ordering signal (`dependsOn`) so it stops using a whole new section to serialize one task after another.
- Keep the planner pure, deterministic, and replay-safe; keep every existing plan byte-identical when no edges are present.
- Add zero runtime-dispatch surface: the change is confined to plan-time ordering plus the classifier prompt.

**Non-Goals:**
- Automatic edge inference from the import/symbol graph (D5).
- Auto-collapsing over-incremented sections into parallel waves (D6).
- Changing the lane model, the lane cap, or per-model lane depth (D7 — that is separate change (a)).
- Any change to how a lane is dispatched, prompted, or its results recorded.

## Decisions

**D1 — Edges are additive to section groups; neither overrides the other; the effective order is their union.** A task runs only after everything its section-predecessors *and* its edge-predecessors require. A `## N.` section boundary remains a hard barrier (backward-compatible), and a `dependsOn` edge can only *add* an ordering constraint, never remove a section barrier. Alternative considered: make the edge DAG authoritative and demote section numbers to a fallback hint. Rejected — it silently reorders across an author's explicit section barrier, breaks existing `waves` scenarios, and turns a missing edge into a correctness regression rather than a no-op. The additive model captures the high-value, low-risk half (catching missed cross-file dependencies) and is a pure superset of today's behavior.

**D2 — A dependency edge orders tasks between waves/batches; it never folds path-disjoint tasks into one lane.** If two tasks collided on a path they are already one lane; if they do not, an edge between them adds ordering but leaves them separate agents. This preserves the `lanes` invariant that "a lane SHALL contain only tasks joined by a canonical-path collision" and "lanes in a batch are path-disjoint," so the `lanes` capability is untouched. Alternative: fold a path-disjoint dependent pair into one serial lane for shared context. Rejected — it violates the lane invariant and inflates the fat-lane replay-loss cost (`lib/limits.mjs:38-43`) for tasks that gain nothing by sharing one agent.

**D3 — Edges are realized as topological wave-depth constraints feeding the existing wave→batch→lane→singleton-fold pipeline.** Each task's implementation wave = the longest chain of section-predecessors and edge-predecessors ahead of it (a longest-path depth over the combined partial order), tie-broken by `byTaskId` so the result stays reproducible. The existing pipeline then runs unchanged over those depths, and the existing singleton-fold (`waves`: "Singleton implementation waves fold onto the previous wave") reclaims the checkpoint: a lone dependent task at a new depth folds back as a later batch of the previous wave, so a precise edge does not buy an extra inter-wave verify. Alternative: add a dependency constraint directly to `packLanes`. Rejected — it duplicates ordering logic across two mechanisms and forces a `lanes`-spec change; layering keeps all ordering in one place (wave assignment) and reuses machinery already proven correct.

The **replan path** (`makeWave`, `lib/waves.mjs:1005`) re-lanes a revised group's tasks mid-run and is therefore a second consumer of the edge signal: it MUST re-derive the same depth ordering from `dependsOn` that initial planning does, so a replanned wave preserves edge order rather than silently dropping it. This is the same-file continuation of the D3 mechanism, not a separate rule — but it is named here and in task 1.1 so the replan branch is not overlooked.

**D4 — Malformed edges are rejected fail-closed and reported, in the planner's existing `validate` pass.** `dependsOn`, when present, MUST be an array of strings; every referenced id MUST resolve to a task in the same plan; the edge set MUST be acyclic. A dangling reference or a cycle fails the plan with a named reason, mirroring how an absolute/out-of-repo `paths` entry is already rejected (`lib/waves.mjs:151-185`, `lanes` spec: absolute paths rejected, not normalized into scope). Alternative: drop unknown references or break cycles by dropping an edge. Rejected — silent degradation of a structural ordering signal is exactly the failure this planner is built to avoid; a wrong order that looks successful is worse than a halt.

**D5 — Automatic graph-derived edge inference is out of scope.** The planner is pure and cannot reach `interlock-graph`; inference would have to be attached by the caller (`interlock waves` in `bin/interlock` or the plan-waves step) and reintroduces graph-staleness as a nondeterminism source. This change adds the explicit signal first; inference is a deferrable follow-up that changes neither these specs nor this task breakdown.

**D6 — Auto-parallelizing over-incremented sections is out of scope.** Sections remain a barrier (D1). The parallelization win in this change comes from the classifier no longer *needing* an extra section to serialize one cross-file dependency, so independent siblings stop being dragged along — not from the planner second-guessing an author's section boundary.

**D7 — The lane cap stays a single scalar (`LIMITS.maxTasksPerAgent`).** Per-tier / deeper-opus lane depth is separate change (a) and coordinates with in-flight `add-lane-effort-routing`; this change does not touch `lib/limits.mjs` cap shape or `buildLanes`' cap application.

**D8 — No runtime-dispatch change; the only `workflows/ship.js` edit is the `plan-waves` classifier prompt.** Lanes-of-N, schema-by-lane-length, and batch fan-out already dispatch whatever the planner emits (`workflows/ship.js:98-201,1403-1416`), and a test forbids `ship.js` from owning plan-time caps. The classifier prompt gains `dependsOn` emission guidance because the `waves` spec anchors that guidance to the prompt text.

**D9 — `dependsOn` is folded into the plan fingerprint.** `lib/plan-fingerprint.mjs` includes the edge set so plan-reuse identity reflects it; a plan that gains or changes edges is correctly treated as a different plan. This can invalidate a previously cached/reused plan — intended.

**D10 — Absent edges are a strict no-op.** When no task carries `dependsOn`, the depth function reduces to today's section grouping and the whole pipeline emits byte-identical waves, batches, and lanes. This is the compatibility guarantee and the primary reproducibility test.

## Risks / Trade-offs

- **A dependency cycle or dangling id crashes or mis-orders the plan** → D4: `validate` rejects both fail-closed with a named reason before any wave is built; covered by a `task-dependencies` failure scenario.
- **The depth computation introduces nondeterminism and breaks replay** → D3: longest-path depth is a pure function with a `byTaskId` tie-break; a reproducibility test asserts byte-identical output across repeated runs and the D10 no-op equivalence to the pre-change planner.
- **A fingerprint change invalidates in-flight reused plans** → D9: intended and documented; the fingerprint already versions `maxParallel`/`maxTasksPerAgent`, so edges join the same surface.
- **Merge collision with in-flight `add-lane-effort-routing`** → this change does not touch `lib/limits.mjs` or `laneModel`; the only shared file is `workflows/ship.js` (classifier prompt vs. dispatch effort — different regions). Sequence-aware, no logical conflict.

## Open Questions

None that can be deferred without changing the specs or task breakdown. The two planner-semantics questions surfaced in exploration (edges-vs-sections precedence, and lane-fold-vs-ordering) are resolved by D1 and D2 respectively.
