## 1. Publish the effort defaults

- [x] 1.1 In `lib/limits.mjs`, add the tier→effort table `{1:'low', 2:'low', 3:null, 4:null, 5:'xhigh'}` plus `verifyEffort:'xhigh'` and `skepticEffort:'xhigh'` to the exported `LIMITS`, with a comment stating `null` means "inherit the session default — do not force." (Published as a separate `EFFORT` export, not inside `LIMITS`: the LIMITS invariant test requires every entry be a positive integer — same precedent as `EVAL_CAPS`/`REPORT_CAPS`.)
- [x] 1.2 Surface the effort mapping in the `interlock limits` output (its formatter), so an operator sees the tier→effort defaults and the fixed verify/skeptic effort.
- [x] 1.3 Add a unit test asserting `interlock limits` output contains the effort mapping (guards Requirement "The effort-by-tier defaults are published, not restated").

## 2. Derive effort in the planner (source of truth)

- [x] 2.1 In `lib/waves.mjs`, add `export function laneEffort(lane)` beside `laneModel`: read `laneTier(lane)`, look the tier up in the `lib/limits.mjs` table, return the mapped effort (or the inherit sentinel for an unreadable/untiered lane). Mirror `laneModel`'s "hardest task" reasoning in the doc comment.
- [x] 2.2 When the planner emits each lane (the block near `lib/waves.mjs:559` that sets `model: laneModel(lane)`), add `effort: laneEffort(lane)` beside `model`. (Live location is `lib/waves.mjs:~752` after `add-dependency-aware-wave-planning`.)
- [x] 2.3 Add an effort report to the plan: one entry per listed lane `{ ids, tier, effort }`, distinguishing "inherited by policy" (tier 3–4) from "inherited by fallback" (tier unreadable). Surface it in `formatPlan` alongside the existing clamp report.
- [x] 2.4 Unit tests for `laneEffort`: tier-1 lane → `low`; mixed tier-1+tier-5 lane → `xhigh` (hardest wins, not first); untiered lane → inherit sentinel and a recorded tier-unreadable report entry.

## 3. Mirror into the runtime and guard parity

- [x] 3.1 In `workflows/ship.js`, add `laneEffort` beside the existing mirrored `laneModel` (around line 212), behavior-identical to the `lib/waves.mjs` source, reading the same table shape from `lib/limits.mjs` values inlined per the runtime's no-import constraint. (Wrapped in `LANE_EFFORT_START/END` markers for extraction, matching the `STEP_SHAPE` precedent.)
- [x] 3.2 Add a parity unit test: feed a fixed table of lanes (tiers 1–5 and one untiered lane) through both `lib/waves.mjs` `laneEffort` and the `workflows/ship.js` mirror; assert every lane's two results are equal (guards Requirement "The planner and the runtime derive identical effort for the same lane").

## 4. Apply effort at dispatch

- [x] 4.1 At the implementer spawn (`workflows/ship.js:1404`), add `effort: laneEffort(lane)` to the `agent(…, { label, model, …workerExtra, schema })` options.
- [x] 4.2 Pass `effort: skepticEffort` (`xhigh`) to the adversarial review skeptic step spawn and `effort: verifyEffort` (`xhigh`) to the inter-wave verify step spawn — fixed, independent of lane tier. (Inlined as `SKEPTIC_EFFORT`/`VERIFY_EFFORT` per the no-import constraint; `cheap` gained an optional `extra` arg so the inter-wave verify keeps going through the cheap wrapper while carrying effort.)
- [x] 4.3 Add a test/assertion that the verify and skeptic spawns carry `xhigh` and are not left at the session default, and that an implementer spawn carries its lane's effort.

## 5. Validate

- [x] 5.1 Run `openspec validate add-lane-effort-routing --strict` and fix any spec/format issues.
- [x] 5.2 Run the full unit suite (`npm test`) and confirm green, including the new effort, parity, and limits tests.
