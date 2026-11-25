# Proposal

## Why

A settle pass records what it ran and what came back: the verification plan, each command's exit code and counts, the platform's checks, the confirmation of every scenario. Almost none of it reaches the pull request. The reader gets one-line reasons inside the confidence block and a `## Testing` section the model types from memory (`skills/settle/SKILL.md:577-580`). A person approving cannot see the command that ran, what it returned, or what none of the checks would catch.

Two of the records are weaker than they look. The confirmation of the scenarios is five counts and a paragraph the worker reports about itself, so a green conformance signal rests on self-report (`.docs/SETTLE-REVIEW-2026-10-31.md` Q14). And the exit code and counts of the final verification are typed into `results.json` by the session, while `interlock verify exec`, which ran the command, writes what it observed to a file the settle loop never reads.

## What Changes

- `interlock settle validation` renders one comment for the assessed commit, headed `## Validation — <sha>`, from the pass's own records. It has four parts, and a fifth when the diff touches a screen: the commands that ran with their exit codes, durations and counts; the platform's checks; the scenarios and living requirements confirmed, row by row; what these checks would not catch; and the changed UI paths nobody looked at. It refuses a verification record for another commit, carries no verdict or score, and holds every piece of worker, reviewer and platform text inert.
- `/interlock:settle --review` posts that comment one time per pass, as printed, after the assessment and before it composes the description, and only from records that pass wrote itself. A pass that cannot render or post it says `VALIDATION NOT POSTED:` and carries on. Without `--review` nothing is posted.
- With `--review`, `## Testing` in the description becomes the three lines `interlock settle validation --summary` prints: what ran, what did not, and where the proof is, or that none was posted. The lines show the same exit codes and marks as the comment. Without `--review` it stays hand-written.
- The confirmation is cited. `interlock settle conformance-brief` asks the worker for one row per briefed id, `{ id, status, cite }`, and keeps its own record with `--out`. A new `interlock settle handoff-check` reads the worker's reply against that record and writes the handoff the verdict reads: a row counts as confirmed only when its citation names a file and line that exist at the head and that are not the requirement's own text. The verdict and the comment read the same checked counts, so they cannot disagree.
- `interlock verify exec` gains `--record <file>`: it appends the command, the exit code it observed and the duration to that file. The settle loop's final verification names one, and the comment shows the observed exit code, saying `RESULT DISAGREES:` when the session recorded another.
- The comment lists the changed paths that are a screen as a visual check owed, read from `interlock surface`, the classifier the manual test plan and the devops trigger already share, so it works in any project with no setup. No screenshot is taken or uploaded: a person who has looked adds images to the thread.
- The comment is bounded by a new published limit. Rows are dropped last first from the collapsed blocks, the comment says how many were left out, and the section on what the checks would not catch is cut last.

Not in this change: the merge-confidence block and its seventeen signals are untouched, `--confidence-comment` stays opt-in as it is today, the ship run's own handoff keeps its five counts, the settle meter draws neither new command, and `interlock verify judge` still reads the results the session wrote.

## Capabilities

### New Capabilities
- `review/validation-comment`: the comment that shows what a settle pass ran against the assessed commit and what it returned, the command that renders it, its bound, and how the skill posts it.

### Modified Capabilities
- `review/settle-loop`: the confirmation briefing asks for a cited row per id and keeps its record; the skill writes the worker's reply to its own file; a new `handoff-check` command writes the handoff the verdict reads.
- `review/pull-request-description`: with `--review`, `## Testing` is written from the lines the CLI printed.
- `verify`: `interlock verify exec` records what it observed to a file the caller names.

## Impact

- `lib/settle-handoff.mjs` (new): the citation rule, pure.
- `lib/settle-validation.mjs` (new): the comment's renderer and its summary, pure. It reads `lib/surface.mjs`, which is not edited.
- `lib/settle-cli.mjs`: two subcommands (`handoff-check`, `validation`), `conformance-brief --out` and its row request, the default reply path.
- `lib/cli-flags.mjs`, `scripts/postinstall-smoke.mjs`: the new subcommands' flags and smoke entries, and `--record` on `verify exec`.
- `cli/interlock`: the `--record` append in `verify exec`. The entry file is near its size bound, so the edit is a few lines.
- `lib/limits.mjs`: one new limit, published by `interlock limits`.
- `skills/settle/SKILL.md`: §5e (the reply file and the check), §5f (`--record`), a new §6d (the comment), §7 (`## Testing`). This is a shipped surface, so each edit is a behaviour change.
- `docs/07-cli-and-configuration.md`, `docs/15-merge-confidence.md`, `CHANGELOG.md`.
- Tests: new `test/spine/settle-handoff.test.mjs` and `test/spine/settle-validation.test.mjs`; pins added to `test/skills.test.mjs`, `test/spine/settle-cli.test.mjs`, `test/spine/settle-meter.test.mjs` and `test/spine/cli.test.mjs`.
- No dependency is added.
- A conformance signal that read green on self-report can read amber after this ships, when a confirmed row carries no citation that resolves. That is the point of the change, and it is the one way an existing pull request's verdict can move.
