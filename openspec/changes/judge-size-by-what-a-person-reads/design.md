# Design

## Context

See `proposal.md` for the motivation and the measured effect.

How size is read today:

- `diffShape` (`cli/interlock:2992-3040`) runs `git diff --numstat -z <base>...HEAD` and sums it into two totals, `changedLines` and `changedFiles`. The per-file rows are read and thrown away.
- `readDiffShape` (`lib/merge-confidence.mjs:890-911`) compares the two totals with `MERGE_BANDS.maxChangedLinesForMerge` and `MERGE_BANDS.maxChangedFilesForMerge` (`lib/limits.mjs:783-787`).
- The gather (`lib/merge-evidence.mjs:391-400`) hands the whole `diffShape` result to the assessment as `input.diff`, for the command and for a ship run's close alike.

What already exists and is reused:

- The risk signal's merge-time reading sets documentation and test paths aside by path (`lib/risk.mjs:109-117, 297`). The living requirement is "The risk signal SHALL be computed over the touched paths and SHALL never be red".
- `REVIEW.md` has two enforced path lists. One function parses both, given a descriptor per section (`lib/review-core.mjs:858-869, 1081-1143`), and the gather reads them from the base (`lib/merge-evidence.mjs:186-212`).
- A listed path is matched as a canonical prefix by `pathExcludedBy` (`lib/review-core.mjs:528`).

Constraints that shape the approach:

- `cli/interlock` is 242,369 bytes. The headroom check (`test/spine/package.test.mjs:436-445`) fails above 245,760, so about 3.3 KB is left and the classes cannot live there.
- `test/spine/merge-confidence.test.mjs:2433-2456` refuses, in `lib/merge-confidence.mjs`, any literal of two or more digits that equals a published merge band value. A display bound of 20, 39, 79, 80, 100 or 400 cannot be written in that module.
- The same check, and the scenario "a literal threshold in the decision is detected", require every test to read a cap from `MERGE_BANDS` and never write it as a number.
- An unknown `##` section in `REVIEW.md` is ignored by today's parser (`lib/review-core.mjs:919-927`), so an older CLI reads a file with the new section as it reads one without.

## Goals / Non-Goals

**Goals:**

- The size signal reads what a person must read, and shows what it set aside.
- Whenever a fact the split needs is missing, the signal takes the stricter reading and says so.
- Each decision that awaits the owner is one switch: answering it the other way edits a named sentence, scenario and line, and nothing else.

**Non-Goals:**

- The cap values and names. The brief rejected raising them (its option C).
- The verdict rule, the score formula, or any weighting of signals (D3).
- `review.ran` and a reviewer's `unread` entries (D2).
- `run.integrity` reading unobserved when no run record covers the head, and how `spec.coverage` and `verify.coverage` count changed lines. Each has its own rule.
- The risk signal and `interlock risk`. Neither reads the new list.
- The label-keyed auto-approve recipe. Its text is not changed (D19).

## Decisions

### The classes, and one definition of each (D8, D9, D4)

Each changed file is placed in one class by its path, first match wins:

1. Under a counts-as-source path of the base's review policy: **source**.
2. A documentation path: **prose**.
3. A test path: **test**.
4. Anything else: **source**.

The documentation and test rules are the risk signal's own. `isDocsPath` is already exported; the test rule (`TEST_PATH`, `lib/risk.mjs:110-111`) gains an exported `isTestPath` beside it. Two signals of one verdict that disagreed on what a test file is would be two definitions to keep in step (D9).

The rule is a deny-list (D8). A path no rule recognises is source, so a lockfile, a workflow file or a page under `site/` keeps counting exactly as it does today. The alternative, counting only what `isReviewSource` (`lib/artifacts.mjs:57`) accepts, was rejected: it would stop counting every file type that function does not know, which loosens the gate by omission.

The documentation rule covers the whole `openspec/` tree (`lib/risk.mjs:109`), which settles D4: the change's own artifacts, the delta specs and an archive move are prose. They were read at the artifact gate and the human checkpoint before any code existed.

A documentation file under a test directory is prose, because rule 2 runs before rule 3. The order moves no band: neither class is counted.

### What the caps are applied to (D1, D6)

The line cap and the file cap are applied to the source class, both counted the same way (D6). The classes that count are one list in the reader, `['source']`.

**D1 awaits the owner.** The artifacts are written to the recommended answer: test lines do not count. If the owner answers that they count, exactly this changes:

- In the delta spec, the requirement "The size signal SHALL apply its caps to the source class" names the source and test classes, and its first scenario's test class moves under the cap.
- In the requirement on evidence, "not counted toward the caps" is said of the prose figure alone.
- In the reader, the list becomes `['source', 'test']`.

The measured difference is in `proposal.md`: four of eight recent pull requests clear the caps without test lines, one with them.

### What the evidence says (D5)

With per-file counts the evidence carries four figures, each as lines and files: source, test, prose and the whole diff. The test and prose lines say they were not counted toward the caps. The binary-file line stays as it is. The reason states the source figures and cites both caps by published name and value, as today's reason cites them for the totals.

Tests pin tokens, not sentences: the two cap names, the words `source`, `test` and `prose`, `not counted toward the caps`, and for the fallback `every changed line and file was counted`.

### The list of prose that counts as source (D7, D12, D13, D14)

**D7 awaits the owner.** The artifacts are written to the recommended answer: a repository may name such paths, and this repository names `skills/`, `agents/` and `shared/`.

- The section is `## Counts as Source` and the parsed key is `sourcePaths` (D12), beside `## Do Not Report` / `excludePaths` and `## Always Human Review` / `humanPaths`.
- It is a third descriptor for the existing `parsePathList`: same grammar, canonical form, pattern refusal and problem wording.
- A listed path is source whatever class it would otherwise have, a test path included (D13). One rule, and no second list for tests.
- Only `diff.shape` reads it (D14). The review, the gate, the risk signal and the human-paths signal do not. The policy-file capability gives the reason for the always-human list, and it holds here: one fact should not move two gates.
- It is read from the base by the same call that reads the always-human list, so a change cannot edit the list applied to it. A ship run's close passes its start commit as the base to the same gather, so it reads the list from there with no new code.

If the owner answers D7 "no": the `review/policy-file` delta is dropped whole; rule 1 of the classes, the scenarios that name the list, and the "could not be read in full" clause are removed from the `review/merge-confidence` delta; and task 2.1, the `REVIEW.md` and template edits and the `docs/12` edit are dropped. Skill prose under `skills/` would then read as prose and never count.

### When the classes cannot be established (D10, D15)

The reader counts every changed line and file, which is today's rule, and adds one evidence line saying so and why. Three cases:

1. The diff carries totals and no per-file counts. Only a hand-built input does this; the existing fixtures do, and they keep their meaning.
2. The review policy at the base could not be read (`input.reviewPolicy` is not an object).
3. The committed `## Counts as Source` section could not be read in full: the parser reported a problem in it, or the base copy as a whole was not parsed (oversized, or the reader returned nothing).

The alternative, reading the signal unobserved, was rejected. A diff small enough to pass with everything counted is small, and unobserved would turn those readings amber for nothing.

Problems are told apart by section (D15). The gather tells them apart today by matching problem wording with its own regular expression (`lib/merge-evidence.mjs:208-210`), and a third section would leak through it: a pattern under `## Counts as Source` would turn `policy.humanPaths` amber. So the knowledge moves beside the descriptors that produce the wording. `lib/review-core.mjs` exports `sectionOfProblem(problem)`, which answers `exclusions`, `human`, `source` or null (front matter, a threshold-shaped line, a copy that was not parsed), and the gather calls it. `reviewPolicyAtBase` then returns, beside `humanPaths` and `problems`:

- `sourcePaths`, the committed list;
- `sourceProblems`, the base copy's `source` problems plus the problem `reviewPolicyAtBase` itself raises when the base copy was not parsed at all (`lib/merge-evidence.mjs:195-203`).

`problems` keeps what it holds today, every base problem that is not an `exclusions` one, now also without the `source` ones. What `policy.humanPaths` reads for the two existing sections does not change. The parsed policy's public shape gains one key, `sourcePaths`, and no other.

A base with no `REVIEW.md` is the empty list with no problem, as it is for the other two lists.

### How the per-file counts reach the reader (D11)

`diffShape` adds `files` to what it returns: one `{ path, lines, binary }` row per changed file, `path` being the file's path after the change (the new path of a rename, the old path of a deletion) and `lines` its added plus deleted lines, 0 for a binary file. Its totals, `paths` and `renamedFrom` are unchanged, so no other reader of the result moves. The edit to `cli/interlock` is those rows and two usage lines.

The classes and the sums are a new pure module, `lib/diff-reading.mjs`, with no I/O and no threshold:

- `readingClassOf(path, sourcePaths)` returns the class and the listed path that decided it, if one did.
- `splitByReading(files, sourcePaths)` returns the lines and files of each class and of the whole, and for each listed path the files and lines it placed in the source class that would otherwise be test or prose.

`readDiffShape` calls the split and applies the published caps. The module is separate because the follow-up change on `unread` entries (D2) needs the same answer to "is this changed path prose?".

### The block's table rows (D16, D17)

`formatMergeConfidenceMarkdown` keeps a signal's reason and at most 25 of its evidence lines, in the signal's own order. When it leaves lines out it ends the row with one line giving the count and naming `--json`. The bound is a display constant beside `SPAN_MAX_CHARS` (`lib/merge-confidence.mjs:1299-1301`) and is not a published limit: the verdict never reads it (D16).

Why 25: in the recorded assessment at `.claude/ship/merge-confidence.json` every signal carries one to three lines except `ci.pipeline` (14, one per check) and `conformance.living` (43); PR #43's block carried 110 on `conformance.living`. 25 keeps every row seen so far whole except the living list. It cannot be 20 for the literal check named under Context.

Only the Markdown table is cut (D17). The driving groups print reasons, not evidence, and are untouched. `--json` and the plain text output carry every line.

### What stays as it is (D2, D3, D18, D19)

**D2 awaits the owner.** The brief recommended that a reviewer's `unread` entry on a documentation path become a flag. The artifacts are written to a different recommendation: decide it in its own change. Three facts the brief did not have:

- An `unread` entry is `{ input, reason }`, both free text (`lib/review-proof.mjs:76-85`). PR #43's two entries read "docs/04-when-it-stops.md and docs/10-agentic-workflow-ship-and-spec.md changed lines" and "delta specs under openspec/changes/stop-retrying-expected-red-checks/specs/ and decisions.md". The CLI has no path to classify.
- `proof.proven` stays false while any entry exists, and the findings comment ends `REVIEW NOT PROVEN:`. Flagging the entry at the verdict alone would label a pull request `MERGE` under that line.
- In the five other recorded settle reviews (`.claude/ship/settle-pr31/`, `settle-pr37/` and `settle/`), every one also carries an entry that is not prose: a test file not opened, a suite not run, or a host probe not possible. A prose-only rule would have lifted none of them.

So the move needs a path on the entry, a prompt change, and a decision about what the proof says. That is a change of its own, and the earlier design that left the question open said the same (`openspec/changes/archive/2026-11-13-stop-proof-re-runs-for-unread-inputs/design.md:151`). The brief is `.claude/handoff/explore-flag-the-prose-a-reviewer-left-unread-20261119-173500.md`. If the owner wants it in this change instead, this change is re-specced.

D3: the verdict stays the worst band over the gating signals, and the score formula is untouched.

D18: no limit is added, renamed or revalued, and the two `interlock limits` labels stay (`lib/limits.mjs:923-924`, pinned at `test/spine/limits.test.mjs:823-824`). The doc comments on the two caps (`lib/limits.mjs:783-787`) say what is counted.

D19: no `SKILL.md` is edited. The policy paragraph of `skills/review-code/SKILL.md` (`:42`) lists the review's own inputs, and the new list is not one. The template beside it, `skills/review-code/REVIEW.template.md`, gains the section. `docs/15-merge-confidence.md` says what the size signal sets aside, in the signal's table row and beside the auto-approve recipe (`:250-293`), whose text does not change. `docs/12-repository-review-policy.md` gains the third list in its consumer table, and `docs/07-cli-and-configuration.md` in the `review-policy` row. Two sentences that count the enforced lists as two are corrected: `docs/04-when-it-stops.md:750` and `docs/15-merge-confidence.md:437`.

### Test pins that move (D20)

Known pins:

- `test/spine/review-policy.test.mjs:480-493`: the shipped template declares both path-list sections. It gains the third, shipped empty.
- `test/spine/merge-confidence.test.mjs:1481-1497`: the diff shape at both caps. It hands in totals with no per-file counts, so it now pins the fallback and keeps passing unedited.
- `test/spine/cli.test.mjs:4269-4291`: `review-policy --base --json`. The new key is additive.

The rule for any other: an assertion that pins a meaning the delta specs change is updated in the task that changes that meaning, never in a remediation stage, and the update names the assertion and the requirement it now pins.

## Shapes the tests and the implementation share

Both read these from here.

| Where | Shape |
|---|---|
| `diffShape` result (`cli/interlock`) | gains `files: Array<{ path: string, lines: number, binary: boolean }>`; every other key as today |
| `lib/risk.mjs` | exports `isTestPath(path)`, normalising as `isDocsPath` does |
| `lib/diff-reading.mjs` | `READING_CLASSES` is `['source', 'test', 'prose']`, frozen |
| `lib/diff-reading.mjs` | `readingClassOf(path, sourcePaths = [])` returns `{ class, listedUnder }`; `listedUnder` is the canonical listed path that decided the class, else null |
| `lib/diff-reading.mjs` | `splitByReading(files, sourcePaths = [])` returns `{ source, test, prose, total, binaryFiles, listed }`; the first four are `{ lines, files }`; `listed` is `Array<{ path, files, lines }>`, in list order, one entry per listed path that placed a file which would otherwise be test or prose |
| `lib/review-core.mjs` | the third descriptor: label `Counts as Source`, `noPaths` `no path counted as source`, `entry` `source entry`, `nothing` `counts nothing as source` |
| `lib/review-core.mjs` | `parseReviewPolicy`, `readReviewPolicy`, `composePolicy` and the empty policy gain `sourcePaths: string[]`; `composePolicy` takes it from the base copy |
| `lib/review-core.mjs` | exports `sectionOfProblem(problem)`: `'exclusions'`, `'human'`, `'source'` or null |
| `lib/review-core.mjs` | `formatReviewPolicy` prints `  source: <paths, or (none)>` on the line after `human-review:` |
| `input.reviewPolicy` (`lib/merge-evidence.mjs`) | gains `sourcePaths: string[]` and `sourceProblems: string[]` |
| `interlock review-policy --json` | gains `sourcePaths`; no other key |

What the size reader accepts as per-file counts: `diff.files` is an array and every row is an object with a string `path` and a finite `lines` of 0 or more. Anything else is the first fallback case.

Evidence and row tokens the tests pin: `source`, `test`, `prose`, `not counted toward the caps`, `every changed line and file was counted`, `Counts as Source`, the two cap names, and for a cut table row `left out` and `--json`.

New tests carry one of four name prefixes, so each task in section 2 can run its own and nothing else: `size:`, `counts as source:`, `block rows:`, `size docs:`.

## Risks / Trade-offs

- **This loosens a gate.** → The measured effect is in the proposal, the evidence shows every figure set aside, and `policy.humanPaths` still holds any path the repository names for a person. `MERGE` still claims local signals only, and the block's legend says so.
- **The first `MERGE` this repository records could follow, and the auto-approve recipe acts on the label where installed.** → `docs/15` says what the size signal no longer counts, next to the recipe. This change alone rarely moves the label: `review.ran` was amber on four of five settle verdicts and `run.integrity` unobserved on four of five.
- **Classes are decided by path.** Source kept under `docs/`, or behaviour written in a `.md` file, reads as prose. Everything under `.claude/` does too, a settings file or a hook script included. → A repository lists such paths under `## Counts as Source`, and a path that needs a person under `## Always Human Review`. The risk signal has read paths this way since it stopped reading prose at merge.
- **Documentation a person does read is set aside too.** A change that only rewrites `docs/` or the README reads green on size at any length, and this repository's `REVIEW.md` keeps `docs/` in review scope. → A repository that wants its documentation counted lists it under `## Counts as Source`. Whether this one lists `docs/` is part of D7: measured on pull requests #36 to #43, it adds 0 to 63 lines each and moves none across a cap.
- **Test lines are not counted, and a test can be wrong.** → The test figure is in the evidence on every reading, the suite signal still reads the run, and the question is D1.
- **A generated file counts as source.** A lockfile of five thousand lines keeps `diff.shape` amber, as it does today. → Unchanged behaviour, and no exclusion list for size is added here.
- **A branch older than the list.** The list is read from the base, so it applies to pull requests opened after it merges. The pull request that adds the section reads `policy.humanPaths` amber, because it edits `REVIEW.md`. → Intended: a change to review policy is a person's call.
- **`cli/interlock` headroom.** → The edit there is the per-file rows and two usage lines, and the headroom test fails the suite if it grows past the warning zone.

## Migration Plan

Nothing stored changes shape. Recorded verdicts are not re-read, and no file on disk is rewritten. Rolling back is reverting the commit: an older CLI ignores the `## Counts as Source` section and counts every line again.
