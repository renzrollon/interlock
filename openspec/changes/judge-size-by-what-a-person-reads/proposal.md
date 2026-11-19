# Proposal

## Why

The merge verdict has read `HUMAN` on all 19 recorded assessments, and the size signal (`diff.shape`) was amber on every one. It counts every added and deleted line of every file, and on the last eight merged pull requests 72 to 98 percent of those lines were tests, OpenSpec artifacts and documentation. A signal with one value in 19 readings tells a reader nothing, and no evidence a run produces can lift it.

## What Changes

- `diff.shape` places each changed file in one class by its path alone: **prose** (a documentation path, which includes the OpenSpec tree), **test**, or **source** (every other path). The published line cap and file cap are applied to the source class. The caps keep their names and their values.
- Test lines and prose lines are not counted toward the caps. Whether test lines count is ledger row D1, which awaits the owner; the artifacts are written to the recommended answer and say what changes if the answer is the other one.
- The signal's evidence carries every figure: source, test, prose and the total, each as lines and files. A reader sees what was set aside and how much of it there was.
- `REVIEW.md` gains a third path list, `## Counts as Source`. A changed path under a listed path is source whatever its name, so a repository whose prose is behaviour can say so. The list is read from the base, as the always-human-review list is, and only `diff.shape` reads it. Whether a repository may name such paths is ledger row D7, which awaits the owner.
- This repository's `REVIEW.md` lists `skills/`, `agents/` and `shared/` under the new section.
- When the split cannot be established, every changed line and file is counted, as today, and the evidence says why. That covers a diff with no per-file counts, a review policy the base could not supply, and a committed `## Counts as Source` section that could not be read in full.
- The Markdown block bounds how many evidence lines one signal's table row carries and states how many it left out. The JSON and text outputs still carry every line.

**This loosens a gate.** Measured on the last eight merged pull requests with the rule as written: with test lines set aside, four of eight read `diff.shape` green (#38, #40, #42, #43); with test lines counted, one does (#42). The three listed directories add 2 to 58 lines a pull request and move none of the eight across a cap.

**Not in this change.** The brief's second move, a reviewer's `unread` entry on a prose file becoming a flag on `review.ran`, is carved out (ledger row D2). An `unread` entry is free text and names no path, so the verdict cannot classify one, and flagging it at the verdict alone would label a pull request `MERGE` under a findings comment that ends `REVIEW NOT PROVEN:`. The follow-up brief is `.claude/handoff/explore-flag-the-prose-a-reviewer-left-unread-20261119-173500.md`. Until it lands, `review.ran` still reads amber on most settle passes, so this change alone rarely moves the verdict's label: it lifts one signal and the score.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review/merge-confidence`: the size signal judges source lines and source files, reports the test and prose figures beside them, and counts everything when the split cannot be established; the Markdown block bounds a signal's evidence lines.
- `review/policy-file`: `REVIEW.md` may declare a `## Counts as Source` path list, parsed like the other two lists, read from the base, and read by the size signal alone.

## Impact

- **Code.** A new pure module `lib/diff-reading.mjs` (the path classes and the split). `lib/merge-confidence.mjs` (the size reader, the block's table rows). `lib/risk.mjs` (exports its test-path rule beside `isDocsPath`). `lib/review-core.mjs` (the third section: parse, compose, print). `lib/merge-evidence.mjs` (the list and its problems reach the assessment). `lib/run-base.mjs` (the policy shape). `cli/interlock` (`diffShape` returns per-file rows; two usage lines).
- **Commands.** `interlock review-policy` prints the new list, and `--json` gains `sourcePaths`. `interlock merge-confidence` output changes only in the `diff.shape` entry and, with `--markdown`, in long table rows. No flag, exit status or argument changes.
- **Docs and templates.** `docs/04-when-it-stops.md`, `docs/07-cli-and-configuration.md`, `docs/12-repository-review-policy.md`, `docs/15-merge-confidence.md`, `skills/review-code/REVIEW.template.md`, `REVIEW.md`, `CHANGELOG.md`.
- **Limits.** No published limit is added, renamed or revalued.
- **Dependencies.** None.
- **Who sees it.** A pull request whose source lines and source files are under the caps stops reading amber on size. Where the label-keyed auto-approve recipe in `docs/15-merge-confidence.md` is installed, a `MERGE` label would act on that reading.
