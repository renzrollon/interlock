## 1. The event type and its whitelist

- [x] 1.1 Add `run-receipt` to `RUN_LOG_TYPES` in `lib/run-log.mjs`.
- [x] 1.2 Add its `TYPE_FIELDS` entry, every field copied by name through a coercer. Use `nullableCount` / `nullableText` for anything that can be genuinely unobserved — never `count`, which floors to `0` and would report an unobserved value as a clean one (design.md — Decision 5).
- [x] 1.3 Implement the nested groups (per-wave tallies, degradation list) element by element with their own coercers. Do **not** pass a nested object through — a spread would defeat the whitelist one level down.
- [x] 1.4 Add a test handing the writer a fat object containing a review result with finding bodies and a verification result with suite output, asserting the written event carries only the named fields and none of that content.
- [x] 1.5 Add tests for the field-level absence rules: review counts unobserved read as absent not zero; a `--no-commit` run reads as "did not commit", distinctly from "never found out".

## 2. Reading and checking

- [x] 2.1 Teach `checkRunLog` that `run-receipt` is a valid type. Do **not** add it to the required set — a run that halted before its close must still reconstruct.
- [x] 2.2 Add a duplicate check: two `run-receipt` events for one run is a reported problem, since a run has one close.
- [x] 2.3 Surface the commit identifier and halt state through `summarizeRunLog`.
- [x] 2.4 Render the receipt in `formatRunLog`, with absent fields shown as unknown rather than as `0` or blank.
- [x] 2.5 Add a test that a closed run with no receipt passes reconstructability, and that a reader listing it can still tell no receipt was recorded.

## 3. Build the receipt from what the run already has

- [x] 3.1 In `workflows/ship.js`, add a function that serializes `summary` into the receipt payload: per-wave tallies from `summary.waves`, plan reuse from `summary.plan`, review counts from `summary.review`, remediation rounds, leftover ids from `leftoverIds()`, halt reason from `summary.halted`, commit identifier from `summary.commit`.
- [x] 3.2 Read the plan fingerprint hash from `.claude/ship/plan-fingerprint.json` for the receipt's plan identity. Carry the hash only — never the plan contents.
- [x] 3.3 Call `degradationLines()` exactly once and use its result for both the printed banner and the receipt (design.md — Decision 3). Assert in a test that the two are the same list.
- [x] 3.4 Pull the skipped-verification, cap-exhaustion, and unresolved-error counts from `summary.closing`, which is what `degradationLines()` already reads.

## 4. Append it, in the right order

- [x] 4.1 Sequence the close as: `recordOutcome()` → `summary.closing` set → build receipt → append receipt → `finish()`. The receipt must be appended after the closing step reports, because its inputs are not complete until then.
- [x] 4.2 On the workflow host, transport the receipt JSON through the closing step's prompt and append it with `interlock run-log append --event`. The prompt must instruct the agent to write the payload **verbatim** — it must not invite the agent to adjust, correct, or re-derive any field.
- [x] 4.3 In `bin/interlock-ship-acp`, write and append the receipt directly with no agent in the path. Same event shape as the workflow host — a reader must not be able to tell which host produced it.
- [x] 4.4 Add a test that a run dying between the closing step and the receipt append leaves no receipt, and that this is observable rather than silently absent.

## 5. Halt and edge paths

- [x] 5.1 Confirm the halt path (`halt()` → `recordOutcome()` → `finish()`) also writes a receipt. A halted run is the most informative record in the corpus and must not be the one that skips it.
- [x] 5.2 Add a test for the spec's halted-run scenario: halt partway through wave 2 with two tasks unticked produces a receipt naming the halt and listing both leftover ids, with no commit identifier.
- [x] 5.3 Add a test for the `--apply-only` and `--no-commit` early-return paths, which reach `recordOutcome()` and `finish()` without a commit step.
- [x] 5.4 Confirm a receipt append failure does not fail the run — it degrades to a reported no-op like every other trajectory append.

## 6. Portability

- [x] 6.1 Add a test that copies a trajectory file to a scratch directory with no repository and asserts a reader can state the change name, halt state and reason, wave tallies, degradations, and commit identifier from it alone.
- [x] 6.2 Add a test that two runs over identical plans and artifacts produce matching plan fingerprint hashes in their receipts, and that neither receipt carries plan contents.
- [x] 6.3 Update `interlock run-log --help` text to name the new type.

## 7. Verify end to end

- [x] 7.1 Run the full unit suite and confirm green. 1040 tests, 1039 pass, 0 fail, 1 skipped (the opt-in real-ACP-agent test, which needs `INTERLOCK_ACP_COMMAND`).
- [x] 7.2 Run a ship workflow against a scratch change to completion and inspect the receipt: one per run, values matching the printed banner. RUN on the ACP host (`bin/interlock-ship-acp`) against a scratch repo with a 5-task fixture change, driven by a scripted ACP agent — real driver process, real CLI decisions, real state and trajectory files, real `npm test`, real commit. Result: exactly one receipt, seq 25 of 25 (after `run-complete`), `committed: true` with the sha the banner printed, tallies matching, `leftoverTaskIds: []` against 5/5 ticked. **Still unverified by a live model:** the workflow host's path where the receipt is transported through the closing step's prompt for an agent to append (4.2). The scripted agent covers the driver, not model judgement — which the receipt does not depend on.
- [x] 7.3 Run a ship workflow that halts and confirm the receipt is present and names the halt. RUN on the ACP host against the same fixture with a deliberately red suite: the run halted at the inter-wave check after wave 1. Result: one receipt, seq 26 of 26 (after `run-halt`), halt reason carried verbatim, `commit`/`committed` both absent ("never found out", not "declined to"), and `leftoverTaskIds: ["2.1","2.2","3.1"]` matching the three unticked boxes. **This run found a defect:** leftovers were derived from the failure list, so a halt at verification — which leaves whole waves that never ran and therefore never failed — reported `leftoverTaskIds: []` with three boxes unchecked. Fixed by asking the CLI what is still unticked at close (`lib/artifacts.mjs` now resolves each task's id; both hosts read it, the ACP host directly and the workflow host through the closing step), and the banner now prints the leftover list on a halt too rather than only on a clean finish.
- [x] 7.4 Diff the printed degradation banner against the receipt's degradation list and confirm they are identical strings. Diffed on the live completing run: 11 printed lines vs 10 in the receipt, identical in content and order except the printed `LEAN SHIP: skipped review, handoff, conformance` line. That one is a mode statement rather than a run degradation — the receipt records the same fact structurally, as absent review counts (1.2, 1.5) — so nothing is lost. Every actual degradation matched.
- [x] 7.5 Confirm `interlock run-log check` passes on both runs. RECONSTRUCTABLE on both: 25 events on the completing run, 26 on the halted one.
- [x] 7.6 Run the workflow host (`/interlock:ship`) once against the same scratch change and confirm the agent-transported receipt (4.2) is byte-identical to what the run measured. ⚠️ NOT RUN — the installed plugin resolves to the marketplace clone at commit `d16c909`, whose `workflows/ship.js` has no receipt code, so a run today would exercise the old loop. Needs this work committed and the plugin pointed at it, or an ACP-speaking Claude Code adapter installed.
