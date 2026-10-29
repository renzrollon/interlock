# Proposal

## Why

On PR #28 at `e177e7d`, `/interlock:settle --review` posted "the review raised no surviving finding" and the merge verdict read every review signal green, while `mr-code-review` and `mr-blast-radius` found ten real findings on the same commit (PR comments 6471559316 and 6471618730). The review raised nothing, so the skeptics dismissed nothing: the miss is recall, and the harness turned it into confidence. Four dimensions returned `{ "findings": [] }`, two of them after skipping the inputs their rubric requires, and the record said `ran`. Interlock has real users (2.3k npm downloads) who read that verdict as a statement about their pull request; an empty review has to prove what it covered, and the review has to ask the questions that found the misses.

## What Changes

- **An empty review proves what it covered.** Every dimension returns a coverage ledger beside its findings: what it checked, each cited at `path:line`, and which of its inputs it did not read. `interlock review` validates the ledger and records a proof per dimension: a dimension that raised nothing and checked nothing is `unproven`, one that left an input unread is listed under `unread`, and a changed source file that no dimension cited is `uncited`. The ship run's review step records the same proof.
- **The verdict reads proof, not silence.** `review.ran` reads amber, marked as needing more evidence, when any dimension is unproven or has unread inputs, any changed source file is uncited, or a record carries no ledger at all (D2). A dimension that ran on a cut domain text or a stale graph is a flag, not a band. **BREAKING** for verdicts: a review that cannot prove its coverage reads `HUMAN` where it read `MERGE`.
- **The settle comment stops saying clean when it is not.** `interlock settle comment` prints the clean sentence only for a proven review, with the coverage counts; an unproven review prints `REVIEW NOT PROVEN` and names each unproven dimension, unread input and uncited file.
- **The loop re-runs what it cannot prove.** `interlock review proof --review <file>` names the dimensions to re-run; review-code re-runs them, with their new findings adjudicated, at most the published `maxProofReruns` times per pass, before writing the record the settle loop and ship read.
- **The CLI writes every review prompt.** `interlock review brief --dimension <name>` and `interlock review brief --skeptics` print the whole prompt: the rubric verbatim, the repository review policy, the repository's review context and the domain text as quoted data, the scope the CLI computed, the emit shape with the coverage ledger, and leave to run read-only commands and to measure any quantitative claim. The skills relay the printed prompt and add nothing to it.
- **The rubrics ask the questions that found the misses.** A new `regression` dimension, always-on at both depths, asks: does every new start have an end, what state is left live, which tests were deleted or weakened, does a measurable promise in a living spec hold when measured, and which text outside the changed lines the change made stale. Blast radius is judged per hunk, so an unchanged reader in a changed file is an outside observer, and every end path of a changed lifecycle is enumerated.
- **Degraded inputs are spoken and move the verdict.** The domain text fills the cap by relevance and is `partial` whenever a requirement is cut, in the CLI as in a run; a capability whose living spec cites a changed file the graph lacks is selected anyway. A review updates a graph that does not hold a changed source file, and records blast radius as partial when it cannot. An archived change resolves read-only, by name or from the pull request's diff, and the output says it was read from the archive.
- **The miss is pinned.** Deterministic fixtures built from PR #28's own records land first and fail on today's code; an `evals/review-recall-pr28` case grades a real review of the PR #28 diff for M1, M2 and B1.

## Capabilities

### New Capabilities

- `review/review-proof`: the per-dimension coverage ledger, its validation, the recorded proof (`unproven`, `unread`, `uncited`), and the `review proof` re-run answer under the published cap, for the review command and the run's review step alike.
- `review/review-briefs`: the CLI-assembled dimension and skeptic prompts, what each carries, and the skills relaying them verbatim.
- `review/regression-dimension`: the bundled `regression` brief: lifecycle start and end, state left live, deleted or weakened tests, measured spec promises, and text outside the hunks the change made stale.

### Modified Capabilities

- `review/merge-confidence`: the review signals read the proof; an unproven, unread or uncited review, and a record with no ledger, read amber on `review.ran`; a degraded domain or blast-radius input is a flag; `review.blockers` and `review.warnings` name the proof they stand on.
- `review/settle-loop`: `settle comment` renders the proof and refuses to call an unproven review clean; the tree check tolerates an archived change's summary; the loop re-runs unproven dimensions; the loop resolves a change archived in the pull request read-only.
- `ship/run-program`: the run's always-on dimensions are the published strict set, which now holds `regression`, and an ungraphed file cited by a living spec selects `domain`.
- `hooks/settle-meter`: the skeptic role source is the skeptic assembler's prompts, and every printed dimension prompt is attributed.
- `review/blast-radius-dimension`: findings are raised for any observer outside the changed hunks, and every end path of a changed lifecycle is enumerated.
- `review/domain-review`: capabilities fill the cap by linked changed files; any cut makes the selection partial in the CLI verb as in a run; a capability whose living spec cites a changed file the graph lacks is selected.
- `review/review-depth`: the always-on set of both depths holds `regression`.
- `graph/staleness`: the graph reports which changed files it does not hold, and the review updates it before the fan-out.
- `evals/case-suite`: the suite holds a review-recall case that encodes the PR #28 miss.

## Impact

- `lib/review-core.mjs`, `lib/findings.mjs` (ledger shape and validation, proof), new `lib/review-proof.mjs` and `lib/review-cli.mjs` (the `review` command leaves `bin/interlock`, which shrinks), `lib/prompts/` (new dimension and skeptic assemblers, registered), `lib/run.mjs` (ship review records proof and uses the assemblers).
- `lib/merge-confidence.mjs` (review signals), `lib/limits.mjs` (`REVIEW_DEPTH`, `maxProofReruns`), `lib/settle-cli.mjs` (comment), `lib/settle-meter.mjs` (keyed kinds for the new lines).
- `lib/prompts/domain-context.mjs`, `lib/artifacts.mjs`, `lib/conformance.mjs`, `lib/merge-evidence.mjs`, `lib/graph/` (freshness against changed paths).
- `skills/review-code/SKILL.md`, `skills/review-code/dimensions/` (new `regression.md`, revised `blast-radius.md`), `skills/settle/SKILL.md`.
- Tests: `test/spine/` (review, merge-confidence fixtures, settle-cli, domain-context, artifacts, graph), `test/skills.test.mjs` pins, `test/evals.test.mjs`; new `evals/review-recall-pr28/`.
- Docs: `docs/15-merge-confidence.md`, `docs/07-cli-and-configuration.md`, `README.md`, `CHANGELOG.md` (a minor version: verdicts change).
- No new runtime dependency. Review cost rises by one lean dimension and at most `maxProofReruns` re-runs per unproven dimension.
