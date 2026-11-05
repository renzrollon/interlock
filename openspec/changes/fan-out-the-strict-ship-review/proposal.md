# Proposal

## Why

A strict ship run's review is one worker spawn asked to run five to seven dimensions and two skeptics per blocker and warning inside its own context, then write the findings and verdicts files itself (`lib/run.mjs:1629-1760`). The settle loop gives the same review one agent per dimension and one spawn per skeptic prompt, each blind to the others, and folds their answers in the session. The report shows what the single worker produces: 436 findings raised and 433 surviving across the corpus, and not one recorded trajectory with `"strict": true`. Epic 2 of `docs/notes/2026-10-31-five-epics.md` is that ship should get settle's review; this change is its first two phases, the reviewers and the skeptics, and nothing after them.

## What Changes

- **The review step spawns one reviewer per selected dimension.** Each spawn is labelled `review-<dimension>`, carries the dimension's own briefing (`assembleDimensionPrompt`, the one `interlock review brief` prints, plus the run's stage line and unvalidated-reports block), is routed from the published table at the strict depth (`review-dimension`), and writes one answer file, `.claude/ship/review/dimensions/<dimension>.json`, and nothing else. The step's continuation is a new verb, `interlock run found`.
- **`interlock run found` folds the reviewers and emits the skeptics.** It reads each expected answer by name, records per dimension whether it ran (file present, well-formed, under its own dimension name), banners `REVIEW INCOMPLETE:` and continues when one did not, writes the folded answers to the findings work file in the ledger shape the rounds already rewrite, and emits a `skeptics` step: `assembleSkepticPrompts` at the strict depth's shape, one spawn per prompt, labelled `skeptic-<finding id>-<role>` or `skeptic-review-<role>`, routed from `review-skeptic`, each writing `.claude/ship/review/skeptics/<label>.json`. Policy-excluded findings are never briefed. With nothing to judge it writes an empty verdict list and adjudicates at once.
- **A published cap bounds the skeptics step.** `LIMITS.maxSkepticSpawns` (printed by `interlock limits`) caps the step's spawns: blockers first, then warnings, two spawns per finding; when the remainder does not fit, one per-review pair reserved inside the cap judges it, bannered `SKEPTIC CAP REACHED:`. Every step prints `REVIEW WAVE: <n> reviewers (<model>/<effort>), <m> skeptics (<model>/<effort>)`.
- **`interlock run reviewed` folds the skeptics and adjudicates as today.** It reads each expected verdict file by name, concatenates them into the verdicts work file, sets aside the pair of any file that is missing or misshapen (bannered `SKEPTIC VERDICTS MISSING:`, the finding survives unjudged and merge confidence flags its vote count), then runs the unchanged adjudication: `resolveReview`, the dimension record, the proof, `review.json`, metrics, and the first remediation plan. Without a `run found` record it halts naming the step it needed.
- **The dimension record becomes observable per dimension.** `ran` is the list `run found` recorded, `completed` means every dispatched dimension ran, and the agent-added-dimension channel is removed: a reviewer briefed for one dimension cannot add one, and an answer under another dimension's name is recorded as a mismatch, not adjudicated.
- **Routing.** The run program reads the published spawn table through `lib/routing.mjs` for its `review` and new `skeptic` spawn kinds; the remediation worker keeps the published skeptic effort. No new role, no new row.
- **Remediation rounds are unchanged.** One worker per round fixes, re-reviews and runs skeptics as it does now, rewriting the same two work files; `interlock run remediated` is untouched.
- **Not in this change**, each a later change of the epic or an owner decision: splitting the fix round from its re-review, host chunking of wide steps (`maxStepSpawns`, a `fanout` capability key, bannering the subagent model and effort environment), the Code Review interop, `blast-radius` in ship's selection, a proof re-run inside the run, a second metrics schema, and a change to any value in the routing table.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ship/run-program`: the review step emits one spawn per dimension and continues to `run found`; a new `skeptics` step and action; adjudication reads files the CLI folded; the dimension-selection and dimension-record requirements are replaced by ones without the agent-added channel, the record saying per dimension what ran; three added requirements for `run found`, the skeptic cap and the verdict fold.
- `review/evidence-gate`: the work files a run removes at its review step gain the two answer directories; the empty-list instruction moves to each reviewer's answer; a missing skeptic file never clears a finding.
- `review/review-proof`: the run's review proof is computed over per-dimension ledgers the reviewers wrote; the no-re-run rule stays.
- `review/review-depth`: the per-finding skeptic rule applies to ship's skeptics step as it does to `review-code`.
- `effort-routing`: the review and skeptic spawns carry the routing table's strict-depth values; the remediation spawn keeps the published skeptic effort; the spawn-kind closure gains `skeptic`.
- `spawn-routing`: the run program is a code reader of the table through `lib/routing.mjs`, with no site prose and no new role.
- `workflow-host`: the strict tail every host interprets gains the `skeptics` step.
- `spec/compound-notes`: the ship reviewer's finding shape that lists `specGap` as optional moves from the retired single-worker briefing to each reviewer's own briefing.

## Impact

- Code: `lib/run.mjs` (review step, `run found`, `run reviewed`), a new pure module for the fold, the cap allocation and pair completeness, `lib/prompts/review-dimension.mjs` (`answerPath`), `lib/prompts/schemas.mjs` and `lib/prompts/index.mjs` (two result schemas, registry), `lib/limits.mjs` (`maxSkepticSpawns` and its printed row), `lib/run-log.mjs` (`skeptic` kind), `lib/meter-timeline.mjs` (step text), `lib/cli-flags.mjs` and `cli/interlock` (the `run found` verb), `scripts/postinstall-smoke.mjs`.
- Prose: `docs/04`, `docs/06`, `docs/10`, `docs/15`, `docs/03`, `README.md`, `CHANGELOG.md`; the ship skill is not touched (it names no dimension and no skeptic).
- Tests: `test/spine/run.test.mjs`, `prompts.test.mjs`, `run-log.test.mjs`, `limits.test.mjs`, `meter-timeline.test.mjs`, `postinstall-smoke.test.mjs`, `prompt-integrity.test.mjs`, `test/helpers/ship-harness.mjs`, `test/fixtures/hosts/ship-answers.mjs`, `test/workflows.test.mjs`, and the new module's own test.
- Hosts and drivers: no change. Neither driver dispatches on a step's action or a spawn's kind; the relay of a nine-spawn step and a sixteen-spawn step stays far below the recorded 23 KB failure.
- Cost: a strict run spends one spawn per dimension plus two per judged finding where it spent one; each is a short, single-purpose context at the routed effort, whose current strict value is inherit.
- No new dependency, no new flag outside `run found`, one new published cap.
