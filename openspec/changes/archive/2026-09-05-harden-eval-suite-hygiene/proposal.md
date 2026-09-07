## Why

The eval suite matches the eval literature on every axis it touches, and then stops short in six places that the 2026-09-03 evals review (`.docs/EVALS-REVIEW-2026-09-03.md` §3.2) names: three of its cases test only one side of a conditional instruction (G4), nothing requires anyone to read a transcript before explaining a score (G5), the two judged graders have no calibration set (G6), the rule that would promote the eval job from advisory to blocking is a sentence a reviewer re-argues per pull request rather than a decision in code (G8), the entire `spec` path has no cases and nothing records that fact (G9), and no map exists from a shipped instruction to the case that exercises it (G10).

Each is cheap, each is hygiene the suite needs before its first blocking promotion, and none of them is architecture. This is Slice E2 of that review — requirements R5 through R10.

## What Changes

- **Two-sided cases (R5).** Three gap-class twin cases are authored — `trampoline-launch`, `skill-routing-explore`, `tier-read-scope-full` — each citing the case it twins through a new structurally-checkable `twin_of:` field in `case.yaml`. `test/evals.test.mjs` fails a `twin_of:` that names a case which does not exist.
- **Transcript reading becomes a recorded step (R6).** The `interlock:evals` skill gains a step requiring at least one transcript per judged case to be read before an explanation is written, and a `transcripts read:` line in its report naming them or stating that none were read. The instruction is token-pinned in `test/skills.test.mjs`.
- **Promotion becomes a CLI decision (R7).** A new `interlock evals promote --history <dir>` reads a directory of triaged results files and decides whether a case may move from advisory to blocking. Its exit code is the verdict. The rule's numbers live in `lib/limits.mjs` beside `EVAL_CAPS`, with a reader, never in spec or skill prose. The eval workflow's `continue-on-error` is driven from that decision instead of being hand-edited.
- **Judged graders get a calibration path (R8).** A new `interlock evals calibrate` reports judge/human agreement per judged grader, with its denominator, from human-labelled transcripts under `evals/<case>/calibration/`. It issues no verdict; `promote` reads it. Every judged grader must carry a calibration set or a committed, reasoned deferral — an unlabelled judge is stated, never silent.
- **The spec path is audited, not padded (R9).** A provenance sweep of the archived proposals, `CHANGELOG.md`, `.docs/WORKFLOW-REVIEW-2026-08-21.md` and the run corpora for observed model-behaviour failures on `spec`, `review-artifacts`, `review-code`, `explore` and `bootstrap`. Cases are authored only where provenance exists; surfaces with none are recorded by name as unexercised.
- **An eval-coverage report (R10).** Every model-facing file under `skills/`, `shared/`, `agents/` and every prompt label in `EXPECTED_PROMPT_LABELS` is partitioned into exercised and unexercised by the cases that name it (through `provenance:` or a new `exercises:` field), and the unexercised set is printed by name. It never fails a build on coverage.

Not in scope, and recorded so nobody re-opens them (review §6): no eval result feeds `ready`, `gate`, `autonomy` or the ship loop — R7 governs only whether the eval *job* blocks a pull request on its own account; no numeric threshold is written into a skill, doc, or spec; no judged grader replaces a deterministic assertion; no `tool_order` grader is introduced.

## Capabilities

### New Capabilities
- `evals/promotion`: the model-free decision that says whether an eval case may be promoted from advisory to blocking, computed from a history of triaged results files, communicated by exit code — the same contract `evals/triage` holds for classification.
- `evals/calibration`: the measurement of judge/human agreement for every judged grader, reported with its denominator and issuing no verdict, so that promotion has something to read and a drifting judge is visible.

### Modified Capabilities
- `evals/case-suite`: adds the two-sided-case requirement and the `twin_of:` citation that makes it checkable; requires a calibration set or a recorded deferral for every judged grader; requires surfaces with no observed failure to be recorded by name rather than filled with hypotheticals; adds the coverage partition over the model-facing surface.
- `evals/authoring`: adds the transcript-reading step before an explanation of a judged case, and requires the report to name the transcripts read — or to say that none were.
- `evals/gate`: replaces "promotion requires observed run-to-run variance", which is a rule a reviewer re-argues, with delegation to the promotion decision, and requires the job's advisory/blocking posture to be driven by that decision rather than hand-edited.

## Impact

- **Code**: `lib/evals-promote.mjs` (new), `lib/evals-calibrate.mjs` (new), `lib/limits.mjs` (`EVAL_CAPS` gains the promotion-rule constants), `bin/interlock` (two new `evals` subcommands and their help and exit-code documentation).
- **Eval suite**: three new case directories under `evals/`, plus any case the R9 sweep finds provenance for; `evals/<case>/calibration/` for judged cases; a new optional `exercises:` field and a new optional `twin_of:` field in `case.yaml`.
- **Tests**: `test/evals.test.mjs` (twin resolution, calibration presence-or-deferral, coverage partition), `test/skills.test.mjs` (the R6 token pin), new spine tests for the two decision modules.
- **CI**: `.github/workflows/evals.yml` — the triage step's `continue-on-error` is computed from `interlock evals promote` rather than fixed.
- **Documentation**: `openspec/changes/archive/2026-08-26-add-interlock-evals/baseline.md` gains the unexercised-surface record from R9.
- **Dependencies**: none. Every new module is stdlib Node, consistent with the repository's zero-runtime-dependency rule; the two new `case.yaml` fields are read by the same minimal top-level scalar reader `test/evals.test.mjs` already uses, so no YAML parser is introduced.
- **Assumed prerequisite**: Slice E1 (`ground-evals-in-a-real-run`) supplies the first real results fixture. R7's CI wiring and R8's populated calibration sets are blocked on it; everything else in this change lands without it. See `design.md`.
