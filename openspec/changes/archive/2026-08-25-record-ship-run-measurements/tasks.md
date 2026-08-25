## 1. Make `durationMs` honest

- [x] 1.1 Document at `lib/run-log.mjs`'s `durationMs` field what it measures — CLI command execution time — and what it explicitly does not: agent turn wall clock. A reader of the field must not be able to mistake one for the other.
- [x] 1.2 In `bin/interlock`, measure each load-bearing command's own execution and pass it to the `cli-exit` append. Keep the existing `nullableCount` coercion so an unmeasured duration stays absent.
- [x] 1.3 Add a test that a measured `cli-exit` carries a non-negative duration.
- [x] 1.4 Add a test that an unmeasured duration is absent, not `0`.
- [x] 1.5 Do not add a recorded wave-duration or run-duration field. Wave elapsed time is derived from event timestamps (design.md — Decision 2).

## 2. Wave elapsed time from timestamps

- [x] 2.1 Add a reader-side helper that derives per-wave elapsed time from the first and last event timestamps bounding a wave.
- [x] 2.2 Add a test for the spec's edge case: wave elapsed time is answerable with no recorded wave-duration field, and no recorded field can contradict the timestamps.
- [x] 2.3 Surface derived wave elapsed time in `formatRunLog`.

## 3. Token spend fields

- [x] 3.1 Add spend fields to the relevant `TYPE_FIELDS` entries in `lib/run-log.mjs`, coerced through `nullableCount` so an unavailable source stays `null`.
- [x] 3.2 Add a test that a malformed spend value coerces to `null`, not `0`. A `0` would assert a wave that spent nothing, which is never true of a wave that ran agents — the error would be silent and systematic.
- [x] 3.3 Add a test that a host recording absence is distinguishable by a reader from a run that measured and found no spend.

## 4. Source the spend on the workflow host

- [x] 4.1 In `workflows/ship.js`, read `budget.spent()` at wave boundaries and at close, and compute per-wave deltas.
- [x] 4.2 Guard on `budget` and `budget.spent` existing — **not** on `budget.total` being set, which is `null` when no target was given while `spent()` remains meaningful. A runtime without `budget` degrades to `null`, never throws.
- [x] 4.3 Take each delta at the same point the script pushes to `summary.waves`, so the script's wave boundary and the recorded attribution derive from one place (design.md — the boundary-drift risk).
- [x] 4.4 Transport the deltas in the closing payload. The prompt must **not** ask the agent to sanity-check, correct, or re-derive spend — that sentence is what caused the defect this change set fixes elsewhere.
- [x] 4.5 Add a test that a run of three waves records three wave figures and one run total.
- [x] 4.6 Add a test for the spec's edge case: a verification-only wave with no implementer spawns records its measured delta, not an assumed zero.

## 5. Declare the ACP host's limit

- [x] 5.1 In `bin/interlock-ship-acp`, record spend fields as absent, explicitly rather than by omission.
- [x] 5.2 Do not estimate. `workflows/ship.js:333` already carries a "roughly 285 tokens per agent" comment for another purpose, so the temptation is concrete — an estimate here would put a fabricated number in the one corpus whose value is containing none.
- [x] 5.3 Add a test that an ACP-produced run's spend fields read as unknown and that a reader can tell this from a measured zero.

## 6. Presentation must not undo the coercion

- [x] 6.1 In `formatRunLog`, render an absent duration and an absent spend as unknown — never as `0`, `0ms`, or an empty column. Printing `null` as zero would undo the whole change at the presentation layer.
- [x] 6.2 Add a test asserting the rendered output for an absent measurement contains no zero.
- [x] 6.3 State the aggregate framing wherever spend is rendered: the figure covers everything in the wave's span, including orchestrator turns, and is not implementer cost.
- [x] 6.4 Do not add spend to `summarizeRunLog` — a run summary is identity and outcome, not cost.

## 7. Verify end to end

- [x] 7.1 Run the full unit suite and confirm green.
- [x] 7.2 Run a ship workflow on the default host and inspect the trajectory: `cli-exit` events carry measured durations, waves carry spend figures, the run carries a total. *(No model-backed run was available in this environment. Verified by driving the same append paths — `wave-state create|next|record-batch` against a real repo, plus a receipt built from `buildReceipt`'s own payload — and reading the trajectory back with `run-log show`: durations 2ms/1ms/14ms, wave spend figures present, run total present.)*
- [x] 7.3 Confirm no recorded field claims a wave duration, and that wave elapsed time still comes out of the timestamps.
- [x] 7.4 Confirm `interlock run-log check` still passes — a missing measurement must not be a reconstructability problem.
- [x] 7.5 If `add-ship-run-receipt` has landed, confirm the shared `TYPE_FIELDS` table carries both changes' fields and that neither dropped the other's.
