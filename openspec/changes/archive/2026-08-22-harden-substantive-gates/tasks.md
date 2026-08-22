A `## N.` boundary here is a **dependency boundary**: groups run in order, tasks within one group are independent and may run in parallel. No task in a group creates something another task in the same group consumes. Where two tasks in one group touch the same file, the description names that file so the planner serializes them into a later batch of the same wave.

## 1. Land the failing repro tests

Every task in this group leaves a **red** test. The reviewers already wrote and executed several of these and reported the expected failures, so the target red state is known rather than guessed. Do not fix any implementation in this group.

- [x] 1.1 Add `test/spine/planner-prompt.test.mjs`: extract the `plan-waves` prompt region from `workflows/ship.js`, evaluate it, and assert the assembled string contains all six tier rules and none of `NaN`, `undefined`, `[object Object]`, literal `null`. Expect 2 failures.
- [x] 1.2 Extend `test/spine/waves.test.mjs`: assert `collisionAwareChunk` serializes two tasks predicting the same file spelled as `src/a.ts` and `./src/a.ts`, plus the `foo/../`, duplicate-separator, trailing-separator and mixed-separator variants from `specs/ship/wave-isolation`. Assert distinct paths are not merged. Expect the normalization cases to fail.
- [x] 1.3 Extend `test/spine/review-core.test.mjs`: assert that evidence of `"👍"`, `"ok"`, `"x"`, a bare `"lib/a.ts"` and confident prose each produce a **non-vote** and leave the blocker surviving; assert `path:line`, `path:start-end`, a column suffix, a spaced path and a `./`-prefixed path are accepted; assert a shape-valid path absent from the diff is rejected. Expect 5 failures.
- [x] 1.4 Extend `test/spine/findings.test.mjs`: assert an out-of-enum severity is rejected rather than counted into `unknown`, and that casing and whitespace variants of a defined severity resolve to it.
- [x] 1.5 Extend `test/spine/ledger.test.mjs`: assert an `agent_resolved` row whose reference id is absent from the design text is invalid; assert `obvious` and its casing, whitespace and trailing-period variants count as empty while a longer citation containing the word is accepted; assert a missing `decisions.md` is reported distinguishably from a present-but-empty one.
- [x] 1.6 Extend `test/spine/ready.test.mjs`: assert the review-blockers check derives its count from a findings file; assert absent, empty and unparseable findings all resolve to *review did not run*, never zero; assert a transcribed count alone does not satisfy the check; assert findings win a disagreement and the disagreement is reported.
- [x] 1.7 Extend `test/spine/verify.test.mjs`: add first direct coverage of `checkResultFieldSizes`, asserting `summary`, `message`, `error` and `notes` are each checked, and asserting the boundary in both directions at exactly the ceiling and one character over.
- [x] 1.8 Extend `test/workflows.test.mjs`: assert the remediation bound is derived from `LIMITS.remediationRounds` rather than a literal; assert recorded round consumption differs between a one-round and a two-round run; assert the completion gate branches on `ok` and `unitGreen` including when absent; assert a cap-exhausted verification appears in the degradation block.

## 2. Define the one canonical path transform

- [x] 2.1 In `lib/risk.mjs`, promote the private `normalizePath` to an exported `canonicalizePath` and strengthen it per design D1: trim, backslashes to forward slashes, collapse `.` and `..` segments and duplicate separators lexically via `node:path` posix normalization, drop a trailing separator. Reject rather than rewrite an absolute path or one that escapes the repo root. Keep `classifyRisk`'s existing behavior unchanged and add unit coverage for each transform case.

## 3. Make every reader consume the canonical form, and fix the remaining `lib/` predicates

Tasks here are file-disjoint. 3.1 depends on 2.1.

- [x] 3.1 In `lib/waves.mjs`, apply `canonicalizePath` at the plan-validation boundary and make **all three** readers use the canonical form — the `claimed` collision key, `uniquePaths`' `seen` dedup key, and `isDocsOnlyWave` via `isDocsPath`. Per design D1 this is one invariant, not three fixes. Keep the authored spelling in `serialized[]` entries and in the emitted changed-path list so reports stay recognizable to the task author.
- [x] 3.2 In `lib/review-core.mjs`, replace the non-emptiness `hasEvidence` check with the design D2 predicate: the evidence must carry a `path:line` or `path:start-end` token whose path canonicalizes to one present in the reviewed diff. Preserve the existing non-vote semantics — the verdict is recorded, not deleted, so its `qualityScore` still reaches the tolerance band. Leave confirming verdicts uncited by design.
- [x] 3.3 In `lib/findings.mjs`, normalize a finding's severity by casing and surrounding whitespace, then reject any value outside the enum with a named error instead of mapping it to the `unknown` bucket the gate does not block on.
- [x] 3.4 In `lib/ledger.mjs`, add an optional design-text argument to the audit; require an `agent_resolved` row's reference id to appear in that text, and treat an absent or unparseable design document as making the reference unresolvable. Add `obvious` and equivalent hedges to `EMPTY_MARKERS`, matched after the existing lowercase-and-trim. Keep `parseLedger`/`serializeLedger` pure — the `readLedger` wrapper resolves `design.md` through `artifacts.mjs`.
- [x] 3.5 In `lib/verify.mjs`, add `summary`, `message`, `error` and `notes` to `RESULT_TEXT_FIELDS` so the oversized-result check covers every text-bearing field.
- [x] 3.6 In `lib/limits.mjs`, remove `memoryEntriesPerRun` from `LIMITS` and from `formatLimits`, per design D7 — it has no enforcement point to connect to.
- [x] 3.7 In `lib/spill.mjs`, read `LIMITS.verifySpillBytes` as the spill trigger instead of leaving the 8 KB threshold in prose, so the cap `interlock limits` prints is enforced by code.
- [x] 3.8 In `lib/ready.mjs`, accept the artifact review's findings and compute the blocker count by calling `evaluateGate` — the same evaluation the review gate uses, per design D4. Fail closed on absent, empty or unparseable findings. Keep the transcribed-count path working but no longer sufficient on its own, and report a disagreement when both are supplied.

## 4. Expose the changed predicates on the CLI

Depends on group 3. Single file, so this is one task rather than three racing edits.

- [x] 4.1 In `bin/interlock`, add `ready --findings <path>` and emit a deprecation warning when only `--review` is passed; make `ledger [change]` exit non-zero when `decisions.md` is absent, reporting *missing* distinguishably from *present and empty*; make `tasks tick` exit non-zero on an id it cannot mark, naming the id. Update the USAGE text for all three.

## 5. Fix the ship loop

Depends on group 4. Tasks 5.1 and 5.2 both edit `workflows/ship.js` and will be serialized against each other; 5.3 is a different file and runs in parallel with them.

- [x] 5.1 In `workflows/ship.js` prompt assembly: delete the stray unary `+` at the tier-ladder concatenation so tiers 1–3 and the `haiku` routing rule reach the classifier; read each dimension's criteria from `skills/review-code/dimensions/<dimension>.md` and include it in every reviewer's and re-reviewer's instructions per design D9; consume canonical paths from the plan when building the verify step's changed-file list.
- [x] 5.2 In `workflows/ship.js` loop and gate: derive the remediation bound from `LIMITS.remediationRounds` instead of the literal `3` and record actual round consumption instead of the constant `Math.min(round, 2)`; branch the completion gate on `verified.ok` and `verified.unitGreen`, treating an absent field as not-verified; branch on `tasks tick`'s new exit status; compute the degradation block from recorded run conditions — cap-exhausted verifications, skip reasons, unresolved errors and the closing step's own outcome — rather than from whether the `banners` array is non-empty.
- [x] 5.3 In `bin/interlock-ship-acp`, reconcile the second tier ladder with the workflow driver's so both hosts convey the same tier boundaries and the same model-routing rule, per design D6 and the host contract in `lib/host.mjs`.

## 6. Generalize prompt-integrity coverage

Depends on group 5 — the assertions run against the fixed prompts.

- [x] 6.1 Add a shared test helper that extracts and evaluates every prompt `workflows/ship.js` assembles, asserts none contains `NaN`, `undefined`, `[object Object]` or literal `null`, reports the number of prompts checked, and **fails** on a prompt it cannot extract rather than silently reducing coverage. Apply it to every assembled prompt, not a subset.
- [x] 6.2 In `test/spine/planner-prompt.test.mjs`, add the cross-host comparison: extract the tier boundaries and routing rule from both the workflow driver and the ACP driver and assert they state the same policy, comparing extracted policy rather than bytes so differing wording does not fail.

## 7. Make the docs describe shipped behavior

Depends on all prior groups. 7.2 and 7.3 both edit `README.md` and will be serialized.

- [x] 7.1 Update `skills/spec/continuity.md` to pass the artifact review's findings path to `interlock ready --findings` and remove the step that composes a file containing a blocker count. Update `skills/spec/SKILL.md` and `shared/DECISION-LEDGER.md` so the three `agent_resolved` claims describe what the CLI now enforces.
- [x] 7.2 Correct the dimension-name split: the rubric filename `technical-lead` is canonical, so fix `README.md:130` and `skills/review-code/SKILL.md`'s frontmatter which call it `delivery`, and make an unresolvable `--dimensions` name a rejection at selection rather than a silent no-match.
- [x] 7.3 Update `README.md:118` and `:128` and `docs/06-why-it-works.md` where they describe the collision guarantee, the dismissal-evidence rule and the `LIMITS` object, so each states the behavior this change ships; remove `memoryEntriesPerRun` from the `LIMITS` excerpt in `docs/06` and from `docs/10-agentic-workflow-ship-and-spec.md`.
