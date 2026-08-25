## 1. Reproduce the defect

- [x] 1.1 Add a failing test in `test/spine/outcomes.test.mjs` that appends an outcome record whose payload supplies a halt state contradicting the run's observed one, and asserts the observed value is what gets written. It must fail today, because the current writer accepts whatever it is handed.
- [x] 1.2 Add a failing test asserting an agent-supplied `remediationRounds` is rejected rather than recorded.
- [x] 1.3 Add a check (test or lint over the prompt text) that the closing procedure contains no instruction to correct, adjust, or re-derive an observed field. It must fail today against the `"Correct any field that does not match what actually happened"` sentence.

## 2. Partition the record shape

- [x] 2.1 Bump `OUTCOME_SCHEMA` to `interlock.outcome/2` in `lib/outcomes.mjs`.
- [x] 2.2 Restructure the payload into named `observed` and `reported` groups. Observed: halt state, remediation rounds, surviving code blockers, per-wave tallies, commit identifier. Reported: unit-suite result, skipped-verification reasons, cap-exhausted count, unresolved-error count.
- [x] 2.3 Preserve every existing module guarantee: never throws, payload built key by key, tri-state `bool` where `null` means "nobody said", bounded free text.
- [x] 2.4 Keep absence as absence in both groups. A reported value the agent could not read is omitted; an observed value with no receipt reads as not-observed. Neither is defaulted to a clean value.
- [x] 2.5 Add tests for both absence cases from the spec.

## 3. Enforce provenance in the writer

- [x] 3.1 Make `appendOutcome` reject agent-supplied values for observed fields, returning the existing `{written, path, reason}` shape with a reason — not a silent drop, and not a throw.
- [x] 3.2 Write the record with the script's observed values even when a rejection occurred, so a partly-refused payload still yields a correct line.
- [x] 3.3 In `bin/interlock`, make `outcomes append` refuse observed fields from an agent-composed record file rather than passing them through.
- [x] 3.4 Confirm the tests from 1.1 and 1.2 now pass.
- [x] 3.5 Add the spec's containment test: a procedure text edited to reintroduce the correction invitation still cannot get an agent-supplied observed value into the record. This is the regression test for the actual failure mode — enforcement must not depend on wording.

## 4. Derive observed values from the receipt

- [x] 4.1 Source the observed group from the run's `run-receipt` event rather than assembling it a second time from `summary`.
- [x] 4.2 Add a test that the receipt and the outcome line report the same remediation rounds and halt state for one run, taken from the receipt rather than recomputed.
- [x] 4.3 When no receipt exists, record the receipt's absence in the observed group. Do **not** fall back to asking the agent — falling back to the untrusted source exactly when the trusted one is missing would defeat the change on the runs most likely to need it.
- [x] 4.4 Add a test for a receipt whose review counts were never observed: the outcome record reads not-observed, not zero blockers.

## 5. Fix the closing procedure

- [x] 5.1 In `workflows/ship.js`'s `recordOutcome`, remove the instruction to correct fields. Ask only for the four reported values: unit-suite result, skipped-verification reasons, cap-exhausted count, unresolved-error count.
- [x] 5.2 Keep the existing "leave a field out entirely rather than guessing it" rule — it is correct and now applies to the reported group.
- [x] 5.3 Confirm the check from 1.3 now passes.
- [x] 5.4 Update prompt-snapshot tests for the edited closing prompt.
- [x] 5.5 In `bin/interlock-ship-acp`'s closing path, write the same partitioned shape. That host has no agent in the path, so its observed half is trustworthy by construction — but it must still use one shape, or a reader has to know which host produced a line before interpreting it.

## 6. Correct the misleading spec prose

- [x] 6.1 Edit `openspec/specs/spec/continuity-provenance/spec.md`'s `## Purpose` directly (a delta cannot carry an existing capability's Purpose). Replace the claim that this is the one place the assessed party reports its own result with a statement of the defect class, cross-referencing the ship-run instance.
- [x] 6.2 Leave that capability's requirements untouched — they are correctly scoped to the readiness gate's blocker count.

## 7. Corpus documentation and migration

- [x] 7.1 Update the `README` template in `lib/outcomes.mjs` so new repositories describe the partitioned shape.
- [x] 7.2 Note in the template that `ensureReadme` never clobbers an existing file, so repositories with a corpus already keep the old description. Do not add clobbering to fix this.
- [x] 7.3 Confirm `readOutcomes` returns both `interlock.outcome/1` and `/2` lines and that consumers branch on the schema identifier rather than sniffing for keys.
- [x] 7.4 Do not rewrite existing corpus lines. The corpus is append-only and rewriting it is the one operation its design forbids.

## 8. Verify end to end

- [x] 8.1 Run the full unit suite and confirm green.
- [x] 8.2 Run a ship workflow against a scratch change and inspect `.claude/learning/outcomes.jsonl`: one `/2` line, groups populated, observed values matching the receipt.
- [x] 8.3 Run a halting ship workflow and confirm the observed group matches its receipt and the reported group carries what the agent could actually read.
- [x] 8.4 Confirm an outcomes write failure still does not halt the run — the existing guarantee must survive.
