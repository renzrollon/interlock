## 1. Extract the shared locator vocabulary

- [x] 1.1 Move `CITATION_TOKEN`, `citesLineIn`, `canonicalizePath`, and `diffIndex` out of `lib/review-core.mjs` into a shared pure module. Behavior-preserving move only — no logic edits.
- [x] 1.2 Re-point `lib/review-core.mjs` at the shared module and confirm `test/spine/review-core.test.mjs` passes unchanged. These tests are the contract; `review-core` feeds the gated blocker count, so a behavior change here is out of scope.
- [x] 1.3 Add a test asserting the extracted canonicalizer strips leading `./` and does **not** case-fold, so a case-differing path is not treated as a match.
- [x] 1.4 Leave `validateHandoff`'s `EVIDENCE_LOCATOR` anchoring in place. Do not unify it with `CITATION_TOKEN` — the two inputs differ (discrete locators vs. prose) and merging them would loosen handoff validation. Note this in the commit body so it is not "cleaned up" later.

## 2. The pure audit predicate

- [x] 2.1 Add `auditHandoffEvidence(packet, changedPaths, opts)` to `lib/waves.mjs`. Pure: takes the path set as an argument, returns `{ verdict, source, reason, unmatched[] }`. No fs, no clock.
- [x] 2.2 Implement the two conditions: locator shape, plus path membership in `changedPaths` after canonicalization. Path membership only — do not check that the cited line exists.
- [x] 2.3 Return `confirmed` / `unconfirmed` / `not-audited` per the spec, with `not-audited` when no path set was available from either source.
- [x] 2.4 Record on the verdict whether `changedPaths` came from the observed source or the task's own report, and record the task's own reported-set match separately, so a reader can tell the two conditions apart (design.md — Decision 3).
- [x] 2.5 Unit-test all three verdicts plus the spec's edge cases: `./`-prefixed locator confirmed, case-differing locator not confirmed, empty path set yielding `not-audited`.

## 3. Retain what is currently discarded

- [x] 3.1 In `recordBatchResult`, store each task's reported `filesChanged` alongside its handoff packet. Initialize a missing container the way the existing handoffs guard does, so a pre-existing in-flight state records normally.
- [x] 3.2 Store the audit verdict per task on the state.
- [x] 3.3 Add a test that a task reporting no `filesChanged` stores an empty reported-path set and does **not** substitute its evidence locators for the missing report.
- [x] 3.4 Add a test that an unattempted task retains no path entry and that this absence is not an error.
- [x] 3.5 Confirm `nextStep` passes stored verdicts through with the packets it hands to the next wave.

## 4. Observe the path set at record time

- [x] 4.1 In `bin/interlock`'s `wave-state record-batch` handler, resolve the changed-path set from version control (`git status --porcelain`) and pass it to `recordBatchResult`. Follow `lib/drift.mjs`'s `execFileSync` precedent and wrap it so it never throws.
- [x] 4.2 On any git failure, fall back to the per-task reported paths and mark the verdict source accordingly.
- [x] 4.3 Add a test that a git failure yields stored packets with a `reported` (or `not-audited`) source and that the batch records normally — no throw, no non-zero exit on account of the audit.
- [x] 4.4 Surface the verdict in `formatRunState` so a human reading a halt can see it.

## 5. Prove the audit changes no control flow

- [x] 5.1 Add a test: a wave of three tasks, one with an `ok` packet whose evidence fails membership. Assert all three are recorded as succeeded, the failure count is unchanged, and the wave advances identically.
- [x] 5.2 Add a test: a run whose every packet is `unconfirmed` reaches its final wave and completes rather than halting.
- [x] 5.3 Add a test: a run one failure below the failure-budget halt does not halt when a batch records with unconfirmed verdicts.
- [x] 5.4 Add a test: an oversized or invalid packet still fails closed exactly as before, with no verdict stored for it.
- [x] 5.5 Confirm `assembleImplementerPrompt` output is byte-identical — an unconfirmed packet renders the same as a confirmed one (design.md — Decision 6). Check the prompt-snapshot tests still pass unmodified; if they changed, the change is wrong.

## 6. Verify end to end

- [x] 6.1 Run the full unit suite and confirm green, including the untouched `review-core` tests.
- [x] 6.2 Run a ship workflow against a scratch change and inspect the resulting `state.json`: packets carry verdicts and reported paths, with the source named.
- [x] 6.3 Deliberately have one task cite a path outside its own changes and confirm the verdict distinguishes the failed condition without affecting the run's outcome.
- [x] 6.4 Confirm `interlock run-log check` still passes — this change must not affect reconstructability.
