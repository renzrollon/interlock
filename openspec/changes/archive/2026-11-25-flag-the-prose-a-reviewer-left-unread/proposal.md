# Proposal

## Why

`review.ran` reads amber whenever a reviewer declares any input `unread`, and all nine settle reviews recorded with a proof carry at least one such entry. Some of those entries are about documentation a dimension's rubric never asked it to read, and today they cost the verdict as much as a skipped delta spec does. An entry is free text, so the CLI cannot tell the two apart.

This change gives an entry a place to name files and lets the CLI class them. Whether to do it at all was ledger row D1. The owner answered yes on 2026-11-23, with the mechanism and the measured effect below in front of them.

## What Changes

- An `unread` entry MAY carry `paths`, the changed files the entry is about. `input` and `reason` stay as they are. An entry with no `paths` reads exactly as it does today.
- The proof lists an entry apart, under a new `proof.proseUnread`, when every path it names is a changed file the CLI classes as prose and none is required prose. Such an entry no longer fails the proof. `proof.unread` holds the entries that still do.
- **Prose** is the class `lib/diff-reading.mjs` gives a path, so a path under `## Counts as Source` in the base's `REVIEW.md` is source and its entry stays under `unread`.
- **Required prose** is never listed apart: any path under `openspec/` or `.claude/`, and the review policy file. These are what a dimension brief hands a reviewer: the change's artifacts, the review context, the policy. Whether the change's own OpenSpec directory belongs here was ledger row D2; the owner answered on 2026-11-23 that it does.
- `review.ran` carries a new flag, `prose-unread`, when the proof lists any entry apart. Its evidence names the dimension, the files and the reason. A flag lowers the score and moves no band.
- Every surface that reads the proof says the same thing, because the decision is made once, in the proof: `interlock review` prints the dimensions on its `proof:` line, `interlock review proof` lists each entry on the lines after its answer, and the settle comment's last line names the dimensions and files.
- The dimension prompt asks a reviewer to name the changed files an `unread` entry is about, and says the CLI classes them. It does not say which class changes the proof.
- The counts-as-source list gains a second reader. The living requirement says the list moves no merge signal other than `diff.shape`; it is replaced by one that also names the proof of coverage. That was ledger row D9, and the owner answered yes on 2026-11-23. The list can keep an entry under `unread`. It can never move one out.

**This loosens a guard.** A reviewer that skipped a documentation file reads as a flag where it read as amber.

**Measured effect: none on the reviews recorded so far.** Nine final settle review records carry a proof, with 77 `unread` entries between them. Had each entry named its files, the rule as written would list one entry apart (PR #43 round 1, `technical-lead`, on two files under `docs/`), and no record's proof would hold: that same review also left the change's delta specs unread, which stays amber under D2. The explore brief's figure of one review in six assumed D2 answered the other way. With D2 answered yes, PR #43 round 1 is the one review in nine whose proof would hold. Every other record carries an entry of another kind.

**Not in this change.** Entries about a suite that was not run, a probe that was not available, or another dimension's remit. That was ledger row D3, and the owner answered on 2026-11-23 to leave them out. Sorted by hand, the 77 entries are: 36 about tests, a suite that was not run, a host probe or another dimension's remit; 16 about a change's own artifacts or other files under `openspec/`; 15 about source files a reviewer did not open; 9 that name several kinds at once; and 1 about prose alone. Each of the other eight records carries at least one entry that is not prose alone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `review/review-proof`: an `unread` entry may name changed files; the proof lists a prose-only entry apart and holds without it; `interlock review` and `interlock review proof` name what was listed apart.
- `review/merge-confidence`: `review.ran` raises `prose-unread` for a proof that lists an entry apart, and the flag joins the published vocabulary.
- `review/policy-file`: the counts-as-source list is read by the size signal and by the proof of coverage, and by nothing else.
- `review/review-briefs`: the dimension prompt asks for the changed files an `unread` entry is about.
- `review/settle-loop`: the settle comment's last line names the prose a reviewer left unread.

## Impact

- **Code.** `lib/review-proof.mjs` (the entry's `paths`, the rule, the lines every surface prints). `lib/review-core.mjs` (one helper that answers the list, or that it could not be established). `lib/diff-reading.mjs` (the policy file's name is defined there, so the proof never imports the policy module). `lib/review-cli.mjs` and `lib/run.mjs` (hand the list to the proof). `lib/merge-confidence.mjs` (the flag and its evidence). `lib/settle-cli.mjs` (the comment's last line). `lib/prompts/review-dimension.mjs` and `lib/findings.mjs` (what a reviewer is asked for).
- **Commands.** `interlock review --json` gains `proof.proseUnread`, and an entry under `coverage` may carry `paths`. `interlock review proof` may print lines after `proven`. No flag, argument or exit status changes.
- **Records.** A record written before this change has no `proseUnread` and reads as it always did. An older CLI reading a newer record sees `proof.proven` and ignores the new list, so it raises no flag.
- **Docs and prose.** `docs/07-cli-and-configuration.md`, `docs/12-repository-review-policy.md`, `docs/15-merge-confidence.md`, `skills/review-code/SKILL.md`, `skills/review-code/REVIEW.template.md`, `REVIEW.md`, `CHANGELOG.md`.
- **Limits.** No published limit is added, renamed or revalued.
- **Dependencies.** None.
- **Who sees it.** A pull request whose only declared gap is documentation outside `openspec/` and `.claude/` stops reading amber on `review.ran`. Where the label-keyed auto-approve recipe in `docs/15-merge-confidence.md` is installed, a `MERGE` label would act on that reading. The flag reads the last review record. When a scoped fix round carries a dimension instead of re-running it, that dimension's prose skip is not in the record, so the flag is gone although the skip stands. A failing skip leaves `unread` the same way today (design, Risks).
