Tasks are grouped per review requirement (R5–R10) and ordered so dependencies come first: the case-schema readers (group 1) are needed by R5 and R10; the calibration report (R8, group 5) is an input to the promotion decision (R7, group 6).

## 1. Case-schema foundations (prerequisite for R5 and R10)

- [x] 1.1 In `test/evals.test.mjs`, generalise the existing inline-or-block list reader (`readTags`) into a keyed reader so it can read any top-level list field, keeping `tags` behaviour unchanged.
- [x] 1.2 Verify against one existing case that the eval harness tolerates an unknown top-level `case.yaml` key, and record the result as a comment in `test/evals.test.mjs`; if it does not, switch `twin_of:` / `exercises:` to the stable comment-prefix form named in `design.md` Risks before writing any further task in groups 2 or 4.
- [x] 1.3 Add a `twin_of:` reader and a `exercises:` reader to `test/evals.test.mjs`, both optional, so the eight existing cases stay valid with neither field present.

## 2. R5 — conditional instructions get both sides

- [x] 2.1 Add the structural assertion that a `twin_of:` value resolves to a case directory that exists in the suite, failing with the case name and the unresolved twin.
- [x] 2.2 Add the structural assertion that a case declaring `twin_of:` is separable from one carrying only an observed-failure `provenance:`, so the two citation kinds can be counted apart.
- [x] 2.3 Author `evals/trampoline-launch/` — Workflow tool present, exactly one `Workflow()` call and no second call on leftover boxes — with `twin_of: trampoline-halt`, deterministic graders only (`tool_used` bounds, no `tool_order`), and a header comment stating it is a gap-class twin.
- [x] 2.4 Author `evals/skill-routing-explore/` — "explore the auth flow" routes to `explore`, not `graph` — with `twin_of: skill-routing`, and mark any skill-invocation grader `arm: with-only` per the case-suite spec.
- [x] 2.5 Author `evals/tier-read-scope-full/` — tier 4 reads `design.md` and the delta specs in full — with `twin_of: tier-read-scope` and deterministic graders only.
- [x] 2.6 Decide the `smoke` tag for each of the three new cases and record the reason in each case's header comment; leave `trampoline-launch` untagged if the smoke environment cannot present a Workflow tool.

## 3. R6 — reading transcripts is a recorded step

- [x] 3.1 Add a step to `skills/evals/SKILL.md` §3 requiring at least one transcript per judged case to be read before the explanation is written, and stating that reading never reclassifies a verdict triage produced.
- [x] 3.2 Add the `transcripts read:` line to the skill's report shape, with the explicit "none" and "unavailable, because …" forms.
- [x] 3.3 Token-pin the instruction in `test/skills.test.mjs` — assert the tokens (`transcripts read:`, the transcript-before-explanation requirement, the none-form), not sentences — with a comment naming the `--metrics` precedent this pin exists to avoid repeating.

## 4. R10 — eval-coverage report, never a gate

- [x] 4.1 Write the surface discovery: every file under `skills/`, `shared/`, `agents/`, plus every label in `EXPECTED_PROMPT_LABELS` from `test/helpers/ship-harness.mjs`.
- [x] 4.2 Write the exact-path classifier that maps each case's `provenance:` and `exercises:` entries onto discovered surfaces, matching only paths that exist in the repository.
- [x] 4.3 Assert totality — every discovered surface lands in exactly one of exercised/unexercised — and assert the discovered set is non-empty and includes each component directory, so a classifier that stops discovering cannot pass vacuously.
- [x] 4.4 Assert that every path a case names in `exercises:` resolves to a file that exists, failing with the case name and the unresolved path.
- [x] 4.5 Print the unexercised set by name, and assert nothing about its size, so coverage reports and never gates.

## 5. R8 — judged graders get a calibration path

- [x] 5.1 Create the committed judged-grader deferral record under `evals/`, listing each judged grader with the reason its calibration set does not yet exist, seeded with `trampoline-halt/halts-and-explains` and `skill-routing/implements-not-replans`.
- [x] 5.2 Add the structural assertion that every judged grader has either a calibration set directory or a deferral entry, failing by grader name when it has neither.
- [x] 5.3 Add the staleness assertion: a deferral entry naming a grader that no longer exists, or one that now has a calibration set, fails.
- [x] 5.4 Define and document the stored calibration-set layout under `evals/<case>/calibration/` — per-transcript human label and the identity that matches it to a judge vote in a results file.
- [x] 5.5 Write `lib/evals-calibrate.mjs`: a pure function taking stored labels and a parsed results file, returning per-judged-grader agreement with its denominator, the unmatched items by name, and the unmeasured graders by name. No verdict, no network.
- [x] 5.6 Add the one-sided-set report path: when a calibration set carries labels for only one outcome, the report says so rather than presenting a complete measurement.
- [x] 5.7 Wire `interlock evals calibrate` into `bin/interlock` alongside `triage`, exiting successfully whatever the agreement, and add its line to the CLI help and the exit-code documentation block.
- [x] 5.8 Unit-test `lib/evals-calibrate.mjs` in `test/spine/`: both-sided agreement with denominator, one-sided set, unmatched label, unmatched vote, no calibration set at all, every item unmatched.

## 6. R7 — promotion is a CLI decision

- [x] 6.1 Add the three promotion-rule entries to `EVAL_CAPS` in `lib/limits.mjs` — consecutive qualifying runs, trials per qualifying run, judge-agreement floor — each with a comment naming its reader, and print them from `formatLimits()`.
- [x] 6.2 Write `lib/evals-promote.mjs`: a pure function over a list of parsed history records plus per-grader agreement, returning per-case promotable/refused with a reason, and an `EXIT` map of `0` promotable, `1` refused, `2` insufficient history.
- [x] 6.3 Implement the pass^k rule — a case qualifies only when it passed every trial of every qualifying run across the published consecutive-run count — reading all three caps by name from `EVAL_CAPS`.
- [x] 6.4 Implement run qualification: a run triage classified as no-signal or configuration is excluded and named, and does not break the consecutive chain.
- [x] 6.5 Implement the judged-case rule — a case with any judged grader is refused unless each judged grader has a measured agreement at or above the floor, with "unmeasured" refused distinctly from "insufficient history".
- [x] 6.6 Implement the unreadable-history-entry path: name the file, state it was excluded, and report insufficient history when nothing parses.
- [x] 6.7 Write `formatPromotion()` — human-readable rendering that states the exit code is the verdict, mirroring `formatTriage()`.
- [x] 6.8 Wire `interlock evals promote --history <dir>` into `bin/interlock`, reading the directory and exiting with the module's verdict; add its line to the CLI help and the exit-code documentation block.
- [x] 6.9 Establish `evals/history/` with a README stating the record shape (per-case pass/fail counts and the run's triage verdict only, no transcripts) and who appends to it.
- [x] 6.10 Unit-test `lib/evals-promote.mjs` in `test/spine/`: clean promotion, an intermittent case refused by name, a chain broken by a no-signal run, an empty history, an unparseable entry, a judged case with sufficient agreement, a judged case with no agreement measurement, and a deterministic case unaffected by the absence of one.
- [x] 6.11 Add a `test/spine/` assertion that each new `EVAL_CAPS` entry is read by `lib/evals-promote.mjs` by name, so none of the three joins `runsPerCase` as a printed cap with no reader.
- [x] 6.12 In `.github/workflows/evals.yml`, add a step that runs `interlock evals promote --history evals/history --json` and sets an output, and replace the triage step's literal `continue-on-error: true` with an expression over that output, in both the smoke and full jobs.
- [x] 6.13 Confirm by reading the workflow that with `evals/history/` empty the expression resolves to the advisory posture, and record that in the workflow's header comment.

## 7. R9 — audit the spec path for provenance

- [x] 7.1 Sweep `openspec/changes/archive/*/proposal.md` `## Why` sections for observed model-behaviour failures on `spec`, `review-artifacts`, `review-code`, `explore`, `bootstrap`, and record the hits with their paths.
- [x] 7.2 Sweep `CHANGELOG.md` for the same, and record the hits with their line spans.
- [x] 7.3 Sweep `.docs/WORKFLOW-REVIEW-2026-08-21.md` for the same, and record the hits.
- [x] 7.4 Sweep the run corpora (`.claude/ship/runs`, `.claude/learning`, `.claude/metrics`) for the same, and record explicitly whether each corpus was empty rather than reporting the sweep as complete over it.
- [x] 7.5 Author one case per observed failure the sweep found, each citing its provenance and passing the structural gate; author none where the sweep found nothing.
- [x] 7.6 Record in `openspec/changes/archive/2026-08-26-add-interlock-evals/baseline.md` the surfaces the sweep covered that yielded no provenance, by name, as unexercised-no-provenance, and note which sources were empty.
- [x] 7.7 Cross-check the R10 coverage output against the R9 record and reconcile any surface the two disagree about.

## 8. Verification

- [x] 8.1 Run `npm test` and paste the output; fix code, never tests, on any failure.
- [x] 8.2 Run `npm run validate` and confirm the plugin manifest still validates.
- [x] 8.3 Run `openspec validate --change harden-eval-suite-hygiene --strict` and confirm it passes.
- [x] 8.4 Run `interlock limits` and confirm the three new promotion caps are printed.
- [x] 8.5 Run `interlock evals promote --history evals/history` against the empty history and confirm it reports insufficient history rather than success or refusal.
