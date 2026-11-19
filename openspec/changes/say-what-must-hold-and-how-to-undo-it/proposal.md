# Proposal

## Why

A pull request description written by `/interlock:settle` answers two of the four questions a reviewer needs answered. It says what changed and what must happen before production. It never names the OpenSpec change it implements, has no place for what the change must leave alone, and gives rollback half a sentence inside the risk section. Pull request #43 shows all three: its body never names `stop-retrying-expected-red-checks`, and its undo is "Rollback: revert the two commits" under a risk bullet.

Nothing checks any of it. Of the template's five human-written headings, a living requirement names one. A reword of `skills/settle/SKILL.md` can drop the rest and no test fails, and a model that skips a section publishes a description nobody is told is incomplete.

The sources for the missing answers already exist. Ninety of the 91 archived designs carry `## Goals / Non-Goals`, 60 carry `## Migration Plan`, and the CLI already computes which living requirements are in force over a diff. The skill tells the model to read the artifacts and extracts nothing.

## What Changes

- The description template gains a `Change:` line as the first line under `## Summary`, a `## Must Not Change` section and a `## How to Roll Back` section. `## High Risk Changes` keeps its risks and mitigations and loses the rollback note. `## Prerequisites to Production` names its two halves: before merging, and before deploying.
- `interlock settle description-brief [<change>] --changed <files|-> --base <ref>` prints the facts those sections rest on: the `Change:` line to copy, every requirement the change's delta specs add, modify, remove or rename, the living requirements in force over the changed paths that the change does not modify, and where in the artifacts each section's source sits, or that it was not found. With no change named it says so and prints `Change: none`.
- `interlock settle description-check --file <file|-> [--from-json <key>] [--change <name>]` reads a description and exits 1, naming each problem, when a required section is missing or empty, when `## Must Not Change` or `## How to Roll Back` holds a bare `None`, or when the `Change:` line is absent or names another change.
- `/interlock:settle` runs the brief while it gathers, writes the new sections from it, and after publishing checks the description the platform holds. An incomplete description is republished one time; if it is still incomplete the skill says `DESCRIPTION INCOMPLETE:` with the problems and carries on. The check never stops a pull request, a verdict or a label.
- The seven section names, the three command lines and the three spoken lines are pinned by token in the skill suite.

Not in this change: `## Testing` keeps its present shape (the sibling brief `post-the-proof-beside-the-findings` owns it), the merge-confidence block is untouched, and no publish line changes its arguments.

## Capabilities

### New Capabilities
- `review/pull-request-description`: what a pull request description written by the settle skill must contain, the CLI facts it is written from, and the check that reads the published text.

### Modified Capabilities

None. `review/merge-request-delivery` keeps every requirement as written: the confidence block still goes in unedited, `## High Risk Changes` is still narrative under the CLI's verdict, and the create and publish lines keep their arguments. `review/settle-loop` is untouched: both new commands run outside the `--review` loop's ordered steps.

## Impact

- `lib/settle-description.mjs` (new): the pure rules, with no file or process access.
- `lib/settle-cli.mjs`: two subcommands in the `settle` family, with their usage and help lines.
- `lib/cli-flags.mjs`: the two subcommands' accepted flags.
- `scripts/postinstall-smoke.mjs`: one smoke entry for each.
- `skills/settle/SKILL.md`: the template, one line in the gather step, two lines after the publish step, one line in the closing report. This is a shipped surface, so each of these is a behaviour change.
- `docs/07-cli-and-configuration.md`, `docs/15-merge-confidence.md`, `CHANGELOG.md`.
- Tests: a new `test/spine/settle-description.test.mjs`; pins added to `test/skills.test.mjs`, `test/spine/settle-cli.test.mjs` and `test/spine/settle-meter.test.mjs`.
- No dependency is added. `cli/interlock` is not edited: the family already dispatches into `lib/settle-cli.mjs`.
- A pull request settled after this ships carries two more sections and one more line than one settled before it. Nothing reads the description back, so no stored record changes shape.
