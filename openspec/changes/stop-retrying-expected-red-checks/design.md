# Design

## Context

See `proposal.md` for the motivation and `specs/` for the required behaviour. The explore brief is `.claude/handoff/explore-stop-retrying-expected-red-checks-20261118-173210.md`.

`recordBatchResult` decides at each wave's end, in order: documentation skip, failing-test skip, cap skip, otherwise schedule a check (`lib/waves.mjs:2565-2595`). A checkpoint is spent when the check is scheduled. `run judge` hands the state machine summary strings only (`lib/run.mjs:3890-3896`), so a red result after a failing-test wave cannot be told from the expected one.

One spawn site emits all three verify cases with `model: null` (`lib/run.mjs:1555-1564`). Drivers forward a truthy model with no branch on kind, and `agents/worker.md` pins none.

History across 39 finished runs: 24 of the 26 readable first checks only ran the suite and reported. All 8 recorded fix attempts, including the 6 in the dial run, faced tests for code not yet built and edited nothing. Four agents made real repairs, all on Opus: 2 small ones in first checks, recorded at `high`, and the 2 hardest in final checks, from runs that predate effort recording. No run has used Sonnet for verify.

## Goals / Non-Goals

**Goals:**

- Spend no verify agent or checkpoint on a suite that is red because planned implementation has not run.
- Keep a real check, with its full fix budget, once that implementation exists.
- Match each verify step's model and effort to the work it does, and publish those values in one place.

**Non-Goals:**

- Comparing failing test names between checks.
- Comparing the exit code an agent reports with the one `interlock verify exec` records (D10).
- Changing the fix-attempt count, the checkpoint cap, or the first-check briefing.
- Changing the final check's model, effort or gate.
- Routing review, skeptic or implementer spawns.

## Decisions

**D1. Skip the waiting check; do not run it once.** A check that can only report "still red" tells the run nothing, costs a full suite and an agent, and would need its own slot rule to avoid starving the last check. Running it once without fix attempts was the first idea and is rejected for those reasons.

**D2. Compute the condition when the wave ends, from the run's waves and the plan's failing-test section.** A pure exported predicate, `checkAwaitsImplementation(run, index)`, takes a state or a plan. It is true when the run is test-first, the wave at `index` is not itself a failing-test wave, and a later wave has `kind !== 'test'`, is not red and is not documentation-only. It runs after `skipDependentsOfIncomplete`, so dropped and emptied waves no longer count.

A run is test-first when its plan names a failing-test section. `createRunState` copies the plan's `redWave` onto the state, and only when it is an integer, so the state of an ordinary change keeps the keys it has today. The waves alone are not enough. A re-run reuses the stored plan narrowed to the unticked tasks, `narrowPlan` drops the finished failing-test wave, and the state then holds no wave marked red. Measured at HEAD on a plan with three implementation sections and sections 1 and 2 ticked, that re-run spends 6 verify agents on a suite that is red by design. `plan.redWave` already survives narrowing (`lib/waves.mjs:1407`, `lib/plan-fingerprint.mjs:475-560`), so no plan format changes. A state written before the key existed falls back to a wave marked red at or before `index`, so a run in flight when the CLI is upgraded waits too.

One re-run is left as it is today. When an artifact was edited between runs the plan is rebuilt, not reused, and the planner classifies only the unticked tasks. A finished failing-test section then holds no task, the planner refuses it, the run says so (`TDD SHAPE REFUSED`), and every wave is checked. Covering that means reading the section's completion in `lib/run.mjs`, and is left out.

The branch sits after the failing-test skip and before the cap test, so it spends no slot. `projectedWaveLoopAgents` uses the same predicate over the plan, so a narrowed plan's preview agrees with its run, and also stops counting the failing-test wave, which it counts today. `formatPlan` marks a waiting wave, and the planner warning names the real gate.

**D3. Record the wait as a skipped verification, never as unresolved.** A new exported reason, `SKIP_VERIFY_RED_OWED = 'red-suite-implementation-owed'`, goes to `skippedVerifications`, which already reaches the `VERIFICATION SKIPPED` banner, the outcome record and the run drawing. `unresolved` means the fix budget was spent; putting expected failures there would tell the next implementer that its own target is "not yours to fix".

**D4. No failing-name baseline in this change.** It needs test names carried from the verdict into state and a baseline the skipped failing-test wave never produces. The check after the last implementation wave and the final verification remain the gates. See Risks.

**D5. The first inter-wave check runs on Sonnet at `medium`.** The owner asked for both, and this step almost always only runs a command and reports. `run judge` scores the exit codes the agent reports (`lib/run.mjs:3816,3842`). The code `interlock verify exec` measures is recorded for the time budget and is not compared with the report. A misreport can therefore move an inter-wave verdict, and both directions are bounded. A false green is still refused by the final check, which stays on the session model. A false red spends at most the published fix attempts, which re-run the suite and find it green. `EFFORT.verify` becomes `medium`.

**D6. A fix attempt stays on the session model at `xhigh`.** A red first check is where skill starts to matter, so the step escalates. No recorded fix attempt faced a real failure, so the history supports neither a lower effort nor Sonnet here. Once expected failures are skipped this step runs only on real ones, so the waste that prompted this change is gone without touching `EFFORT.verifyRetry`.

**D7. The final check is unchanged, under its own key.** It is the commit gate and repairs a red suite, including the hardest repair on record. It keeps the session model and `high`, now read from a new `EFFORT.verifyFinal`.

**D8. Publish the model as `VERIFY_MODEL` in `lib/limits.mjs`.** `SPAWN_ROUTING` is documented and pinned as the prose-skill roles, and `EFFORT` holds effort levels. `lib/run.mjs` reads the constant at the spawn site; `formatLimits` prints it and `interlock limits --json` emits it as `verifyModel`. A behavioural test compares the first check's spawn with the constant, which is a stronger pin than a token sweep because `cli/interlock` also names it.

**D9. An owed wave removed after the wait re-opens nothing.** A replan is offered at the start of the next wave (`lib/waves.mjs:2157`), after the end-of-wave decision, and skipped dependents can empty a later wave at any batch (`lib/waves.mjs:2472`). Either can remove the last owed wave after its predecessor's check was skipped. The run does not go back. The skip stays recorded under the owed-implementation reason, and the final verification is the gate, as it is for any plan whose last implementation wave is its last wave. Going back would need a second cursor for a case `LIMITS.replansPerRun` already bounds.

**D10. The judge does not compare exit codes in this change.** `interlock verify exec` already appends each command's exit code to `verify-timings.jsonl` (`cli/interlock:4337-4340`), so `run judge` could let the measured code decide when it disagrees with the report. That would make the first check's tier irrelevant to the verdict. It also changes the judge the final check uses, so it is a follow-up with its own tests, and the condition for routing a first check below Sonnet.

## Risks / Trade-offs

- [A real regression in an early implementation wave is reported later, with no attribution to its wave] → The later check and the final verification still catch it, and the skip is named at close. Today's check cannot attribute it either: the state holds one red verdict, and the next implementers are handed their own target tests as failures that are "not yours to fix". Name comparison is the follow-up if this proves costly.
- [A plan where one section turns the suite green and a later section is unrelated loses the check between them] → Accepted for the same reason; the last check remains.
- [Sonnet at `medium` is unmeasured on verify, and the verdict rests on its report] → Both wrong answers are bounded (D5), and D10 names the follow-up. The value is one line in `lib/limits.mjs`.
- [A session already on Sonnet gains no model step on a fix attempt] → A fix attempt carries no model, as today, so it runs on whatever the session runs on. Naming a larger model there would override a session the operator chose.
- [Fix attempts will now meet real failures, which the history never exercised] → They keep the session model and the highest verify effort, so this change does not weaken them.
- [Map-only hosts have no Sonnet mapping] → The spawn runs on the host default and the routing event says so, as implementer lanes already do.
- [A healthy test-first run now closes with one `VERIFICATION SKIPPED` line per waiting wave] → Each line carries the owed-implementation reason, so it reads as a wait and not as a lost check. Folding repeats of one reason into one counted line in `lib/receipt.mjs` is a follow-up.
