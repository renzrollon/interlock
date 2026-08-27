## Context

See proposal.md — Why. The model clamp (`lib/waves.mjs:219`, `laneModel`) is the only capability dial today; `opts.effort` is unused across the repo. Two structural facts shape the approach:

1. **`laneModel` is already mirrored.** `lib/waves.mjs` owns the source; `workflows/ship.js:212` carries a behavior-identical copy because the workflow runtime rejects module loading (it "can import nothing"). `laneEffort` inherits the same duplication and the same parity obligation.
2. **The planner already reports every clamp.** `clampModel` returns a record `{ id, from, to, tier }` when it changes a model, and the plan surfaces it. Effort assignment slots into that same reporting discipline rather than inventing a new one.

The tier is produced by the classifier (a judgement call that stays with the model); everything downstream — including effort — is mechanical and lives in code. Effort is derived from tier, so it is assigned *after* classification and cannot be self-escalated, exactly like the model clamp.

## Goals / Non-Goals

**Goals:**
- One deterministic function, `laneEffort(lane)`, that maps a lane to a reasoning effort by its hardest task's tier.
- The mapping lives in `lib/limits.mjs` and is surfaced by `interlock limits` — one source, read not restated.
- Every effort assignment is reported on the plan; verify and skeptic steps are pinned to `xhigh`.
- Byte-for-byte behavior parity between the `lib/waves.mjs` source and the `workflows/ship.js` mirror, guarded by a test.

**Non-Goals:**
- Touching the model clamp. Effort is orthogonal; `laneModel` is unchanged.
- Per-task effort inside a lane. A lane is one agent; it gets one effort, the hardest task's — the same granularity `laneModel` already uses.
- Dynamic/budget-aware effort. The mapping is static tier→effort; adapting it to a token budget is a later change, not this one.

## Decisions

**D1 — `laneEffort` is a sibling of `laneModel`, keyed on `laneTier`.** It reuses the existing `laneTier(lane)` (highest tier among tasks) and looks the tier up in the published table. Alternative considered: derive effort from the already-clamped `model`. Rejected — that couples two independent dials, so a future model-clamp tweak would silently move effort. Deriving both from tier keeps them independent.

**D2 — The tier→effort table lives in `lib/limits.mjs`.** Default: `{1: 'low', 2: 'low', 3: null, 4: null, 5: 'xhigh'}`, where `null` means "inherit the session default — do not force." Plus `verifyEffort: 'xhigh'` and `skepticEffort: 'xhigh'`. Rationale: the wave caps already live there for the stated reason that a cap written twice drifts; effort defaults are caps of the same kind. `interlock limits` gains an `effort` section. Alternative considered: constants in `waves.mjs`. Rejected — it would be the one number the runtime mirror could disagree with.

**D3 — `null` (inherit) is a first-class value, not "medium".** Tiers 3–4 deliberately emit no effort override so the run honors whatever the session/model default is (which since w16 is `xhigh` for coding). Forcing `medium` there would *lower* effort on the default path — the opposite of intent. So the emitted lane omits `effort` (or carries `null`) for those tiers, and the report says "inherited."

**D4 — Mirror, then guard.** `laneEffort` is copied into `workflows/ship.js` beside the mirrored `laneModel`, and a unit test feeds a fixed table of lanes (tiers 1–5 plus an untiered lane) through both copies and asserts equality. This is the same guard shape the codebase already relies on for the planner/runtime boundary. Alternative considered: a shared JSON the runtime reads at spawn. Rejected — the runtime has no filesystem of its own during a run; the mirror-plus-test is the established pattern.

**D5 — Reporting reuses the clamp channel.** Every listed lane gains an `effort` field beside `model`; the plan's report gains an `effort` array of `{ ids|lane, tier, effort }`. No new user-facing surface beyond what `formatPlan` already prints for clamps. An untiered lane is reported as tier-unreadable, effort inherited — never silently upgraded.

**D6 — Verify and skeptic effort is fixed at the call site.** The `step(...)` spawns for the inter-wave verify and the review skeptics pass `effort: LIMITS.verifyEffort` / `LIMITS.skepticEffort` (both `xhigh`) directly, independent of any lane tier — these steps have no lane. Implementer spawns at `workflows/ship.js:1404` pass `effort: laneEffort(lane)`.

## Risks / Trade-offs

- **Mirror drift** → the D4 parity test fails the suite the moment the two copies disagree; the mapping itself is not duplicated (both read the concept from the same table shape), so the only thing to keep in sync is the lookup function body.
- **Runtime ignores `effort`** → additive key; an older runtime drops it and behaves exactly as today. Covered by an edge scenario. No banner needed because it silently *preserves* current behavior rather than changing a tier.
- **`xhigh` on every skeptic raises cost on the review step** → intended trade: the skeptics are the dismissing direction that must be right, and review is already the most expensive step. The mapping is tunable in `lib/limits.mjs` if an operator wants to walk it back.
- **`null`-as-inherit is easy to misread as "no routing happened"** → the report distinguishes "tier 3 → inherited (by policy)" from "tier unreadable → inherited (by fallback)"; they are different report entries.

## Open Questions

None that change the specs, approach, or task breakdown. The concrete tier→effort values (D2) are the one judgement call — flagged to the parent for confirmation — but they are data in `lib/limits.mjs`, so revising them later touches no code and no spec.
