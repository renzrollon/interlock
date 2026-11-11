# Proposal

## Why

`interlock review proof` asks for a dimension to be re-run whenever its ledger declares an `unread` input, whatever the reason. On the settle pass over dial PR #1 that line asked for every dimension in all three review passes, and the only gaps were the reviewers' own declarations ("the brief allows a single test file", "needs a host probe", "outside this dimension"). The re-runs took about 2.26M of about 5.06M reported subagent tokens and closed nothing. Seven recorded passes on three pull requests show the same thing: every re-run was asked for `unread` entries alone, and none made the proof hold.

## What Changes

- `interlock review proof` names a dimension for a re-run only when it is unproven or is the target for uncited changed source files. A declared `unread` input no longer names one.
- A record whose only gap is `unread` inputs answers `PROOF LEFT UNREAD: <dimensions>` and exits 0, with the entries on the lines after it. The proof still does not hold, and every reader that prints `REVIEW NOT PROVEN` still prints it.
- `interlock review brief --dimension <name> … --rerun-of <draft>` prints the prompt for a re-run the draft's proof names: the whole prompt for an unproven dimension, and a prompt scoped to the uncited files for a dimension named for uncited files alone. It refuses a dimension the proof names no re-run for.
- `interlock review --rerun-of` replaces the ledger of an unproven dimension only. Every other re-run dimension keeps its first ledger and gains the re-run's entries.
- `skills/review-code/SKILL.md` prints the proof line before it re-runs anything, asks for the re-run's prompt with `--rerun-of <draft>`, and promotes the draft on `PROOF LEFT UNREAD`.
- The settle meter shows the new first line as it shows the other three.

Not in this change: the fix round's whole-PR re-review and the loop's missing scale line. They are the next two briefs of the same epic (`re-review-only-the-fix-round`, `say-the-review-loop-scale-up-front`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review/review-proof`: which gaps name a re-run, the answer for a record whose only gap is `unread` inputs, and which re-run dimension has its ledger replaced.
- `review/review-briefs`: a dimension prompt for a re-run, read from the draft with `--rerun-of`.
- `review/settle-loop`: the loop's statement of the merge rule, and the scenario that re-ran a dimension for an unread input.
- `hooks/settle-meter`: the first lines of `interlock review proof` the meter repeats.

## Impact

- Code: `lib/review-proof.mjs` (`rerunTargets`, `proofAnswer`, `mergeRerun`), `lib/review-cli.mjs` (`briefDimension`), `lib/prompts/review-dimension.mjs` (the scope block of a re-run for uncited files).
- Skill prose: `skills/review-code/SKILL.md` §3. `skills/settle/SKILL.md` runs no proof line; its one sentence on a record left unproven gains the `unread` case.
- Docs and help: `docs/07-cli-and-configuration.md`, `docs/15-merge-confidence.md`, the `review proof` usage text in `cli/interlock`, the `maxProofReruns` comment in `lib/limits.mjs`, `CHANGELOG.md`.
- Tests: `test/spine/review-proof.test.mjs`, `test/spine/cli.test.mjs`, `test/spine/settle-meter.test.mjs`, `test/skills.test.mjs`.
- Unchanged: `proof.proven`, `proof.unread`, the `review.ran` signal, the settle comment's gap lines, `maxProofReruns`, and the ship run, which records a proof and runs no re-run.
- Behaviour a caller can see: a review whose reviewers declared unread inputs spawns no second set of reviewers and skeptics for them, so its record carries the first pass's findings only.
