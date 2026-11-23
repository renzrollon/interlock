# Spec Delta

## ADDED Requirements

### Requirement: The size signal SHALL place every changed file in one class by its path alone

With per-file counts, `diff.shape` SHALL place each changed file in exactly one class by its path, never by its content, as `lib/diff-reading.mjs` decides it. A path under a counts-as-source path of the review policy committed at the base SHALL be source. Otherwise a documentation path SHALL be prose and a test path SHALL be test, as the risk signal's merge-time reading defines both. Every other path SHALL be source. A renamed file SHALL be classed by its new path.

#### Scenario: Happy path — source, test and prose files are told apart

- **GIVEN** per-file counts for `lib/receipt.mjs`, `cli/interlock`, `test/spine/receipt.test.mjs`, `docs/15-merge-confidence.md`, `openspec/changes/a-change/design.md` and `openspec/specs/review/merge-confidence/spec.md`, and a base whose `REVIEW.md` has no `## Counts as Source` section
- **WHEN** the merge confidence is assessed with that base
- **THEN** the diff-shape signal's evidence counts the first two as source, the third as test and the last three as prose
- **AND** a documentation file under a test directory, `test/fixtures/review/note.md`, is counted as prose

#### Scenario: Edge case — a path no rule recognises is source

- **GIVEN** per-file counts for `package-lock.json`, `.github/workflows/ci.yml`, `site/index.html` and a binary file `assets/logo.png`
- **WHEN** the merge confidence is assessed
- **THEN** all four are counted as source files
- **AND** the binary file adds one file and no lines

#### Scenario: Edge case — a listed path is source whatever its name

- **GIVEN** a base whose `REVIEW.md` lists `./skills` and `test/fixtures/prompts/` under `## Counts as Source`, and per-file counts for `skills/settle/SKILL.md`, `test/fixtures/prompts/a.txt`, `skillsx/notes.md` and `docs/a.md`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the first two are counted as source, because a listed path is matched on the canonical path form
- **AND** the last two are counted as prose

#### Scenario: Edge case — a renamed file is classed by its new path

- **GIVEN** a diff that renames `docs/draft.md` to `lib/draft.mjs` and changes lines in it
- **WHEN** the merge confidence is assessed
- **THEN** the file is counted one time, as source

### Requirement: The size signal SHALL apply its caps to the source class

`diff.shape` SHALL compare the changed lines of the source class with the published line cap, and the number of source files with the published file cap. The lines and files of the test class and of the prose class SHALL NOT count toward either cap. The signal SHALL be green at or under both caps and amber, marked as needing a person, above either. Its reason SHALL state the source figures and cite each cap it applied by name and value.

#### Scenario: Happy path — a change that is mostly tests and prose is green on its source

- **GIVEN** per-file counts whose source class is under both published caps, whose test class alone holds more lines than the published line cap, and whose prose class alone holds more files than the published file cap
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is green
- **AND** its reason states the source lines and the source files, and names both caps with their published values

#### Scenario: Failure — source over either cap is amber whatever else the diff holds

- **GIVEN** one assessment whose source class holds one more line than the published line cap in one file, and another whose source class holds one more file than the published file cap with one line in each, neither with a test or prose file
- **WHEN** both are assessed
- **THEN** each reads the diff-shape signal amber, marked as needing a person
- **AND** the first's reason names the line cap and the second's the file cap, each with its published value

#### Scenario: Edge case — source at both caps is green

- **GIVEN** per-file counts whose source class holds as many lines as the published line cap in as many files as the published file cap, beside test and prose files
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is green

### Requirement: The size signal's evidence SHALL carry the source, test, prose and total figures

With per-file counts, whatever its band, `diff.shape` SHALL state in its evidence the changed lines and changed files of each class and of the whole diff, and SHALL say that the test and prose figures were not counted toward the caps. When the counts-as-source list placed a file in the source class that would otherwise be test or prose, the evidence SHALL name each listed path that did, the files and lines it placed, and the reference the list was read from.

#### Scenario: Happy path — a green reading shows what was set aside

- **GIVEN** per-file counts with three source lines in one file, more test lines than the published line cap in two files, and five prose lines in two files
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is green and its evidence states the source, test and prose figures, each as lines and files, and the total over all five files
- **AND** the evidence says the test and prose figures were not counted toward the caps

#### Scenario: Failure — an amber reading carries the same figures

- **GIVEN** per-file counts whose source class holds one more line than the published line cap, beside two test files and two prose files
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is amber and its evidence states all four figures

#### Scenario: Edge case — a listed path that placed files is named with what it placed

- **GIVEN** a base whose `REVIEW.md` lists `skills/` and `agents/` under `## Counts as Source`, and per-file counts in which two files under `skills/` hold seven lines between them and no changed file lies under `agents/`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the evidence names `skills/` with two files and seven lines, and the reference the list was read from
- **AND** it does not name `agents/`

### Requirement: The size signal SHALL count every changed line and file when the classes cannot be established

When `diff.shape` cannot establish the classes it SHALL apply the caps to every changed line and file, and its evidence SHALL say so and why. That SHALL hold when the diff carries no per-file counts, when the review policy committed at the base could not be read, and when the base's `## Counts as Source` section could not be read in full. A problem in another section of the policy SHALL NOT have this effect, and a base with no `REVIEW.md` SHALL be read as an empty list.

#### Scenario: Failure — a base policy that could not be read counts everything

- **GIVEN** per-file counts whose source class is under both published caps and whose test class holds more lines than the published line cap, and a review policy the base could not supply
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is amber, marked as needing a person, and its reason names the line cap
- **AND** its evidence says every changed line and file was counted because the review policy at the base could not be read

#### Scenario: Failure — a counts-as-source section that could not be read in full counts everything

- **GIVEN** the same per-file counts, and a base whose `## Counts as Source` section holds the item `skills/**`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the diff-shape signal is amber, and its evidence says every changed line and file was counted and names the item
- **AND** the same counts with the item written as `skills/` read green

#### Scenario: Edge case — a diff with totals and no per-file counts is judged on its totals

- **GIVEN** a diff that carries a changed-line total and a changed-file total and no per-file counts
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is green when both totals are at or under their published caps and amber above either
- **AND** its evidence says the diff carries no per-file counts, so every changed line and file was counted

#### Scenario: Edge case — another section's problem, and an absent policy, leave the classes alone

- **GIVEN** one base whose `## Do Not Report` section holds a pattern item and whose `## Always Human Review` section holds prose and no list item, and another base with no `REVIEW.md`, each with per-file counts whose source class is under both published caps and whose test class holds more lines than the published line cap
- **WHEN** each is assessed
- **THEN** each reads the diff-shape signal green on its source class
- **AND** neither evidence says that every changed line and file was counted

## MODIFIED Requirements

### Requirement: The change-shape signals SHALL read the diff, the ledger, drift and the run

The diff-shape signal (`diff.shape`) SHALL be green when the changed lines and changed files it counts are both at or under their published caps, amber above either, and unobserved when no base is given to diff against, or when the base is the head commit or a descendant of it, because that diff is empty by construction and says nothing about the change. What it counts SHALL be the source class, as the requirements on the size signal's classes and caps define it, and every changed line and file when the classes cannot be established. The open-decisions signal (`decisions.open`) SHALL be amber, marked as needing a person, when the ledger holds a needs-human row, an invalid row, or is missing. The drift signal (`drift.stale`) SHALL be amber, marked as needing a fix, when a living spec cites a file this change removed, and amber, marked as needing a person, when another change that is complete and unarchived has delta specs for a capability this change also has delta specs for. The change under assessment SHALL NOT count against itself; with no change under assessment, every complete, unarchived change SHALL count. Aging specs and changed files that no spec describes SHALL NOT move the drift signal. When the stale-citation check could not run because no usable graph exists, the drift signal SHALL carry a flag with the reason, and SHALL NOT read the empty result as clean. The run-integrity signal (`run.integrity`) SHALL be amber, marked as needing a person, when the run halted, its trajectory is incomplete, a stage marker was not published, a handoff report was rejected, a permission prompt or auto-mode denial occurred, or the run left tasks of the change unticked, and unobserved when no run record is given.

Rationale: drift on a pull request is about what this change did to the specs. A broken citation elsewhere, or a finished change in an unrelated capability, is the repository's backlog, which `interlock drift` already reports; counting it would hold every pull request at `HUMAN` for a reason no one on it can act on. A run that left a task unticked did not finish the change, and whether what remains matters is a person's call.

#### Scenario: Happy path — a small on-ledger change with a clean run

- **GIVEN** a diff under both caps, a ledger with only agent-resolved rows, no drift findings, and a run record with no degradation and no task left unticked
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape, open-decisions, drift and run-integrity signals are all green

#### Scenario: Failure — an open product question is amber and needs a person

- **GIVEN** a ledger with one needs-human row
- **WHEN** the merge confidence is assessed
- **THEN** the open-decisions signal is amber, marked as needing a person
- **AND** the evidence carries the row's identifier and question

#### Scenario: Failure — a removed cited file, and a competing unarchived change, are amber

- **GIVEN** one assessment whose changed paths include a file that a living spec cites and that no longer exists, and another in which a different, complete and unarchived change has delta specs for a capability the change under assessment also has delta specs for
- **WHEN** both are assessed
- **THEN** the first reads the drift signal amber, marked as needing a fix, naming the spec and the file
- **AND** the second reads it amber, marked as needing a person, naming the other change and the shared capability

#### Scenario: Failure — a run that left tasks unticked needs a person

- **GIVEN** a run record with no other degradation that records two tasks left unticked
- **WHEN** the merge confidence is assessed
- **THEN** the run-integrity signal is amber, marked as needing a person, and its reason states the two tasks
- **AND** the verdict is `HUMAN` or worse however clean the rest of the input is

#### Scenario: Edge case — no base to diff against, and a missing ledger

- **GIVEN** an assessment given no base reference and a change with no ledger file
- **WHEN** the merge confidence is assessed
- **THEN** the diff-shape signal is unobserved with the reason that no base was given
- **AND** the open-decisions signal is amber with the reason that the ledger is missing, not unobserved, because a missing ledger is a failure of the audit

#### Scenario: Edge case — no graph, another capability, and the change itself

- **GIVEN** three assessments with no other drift finding: one in a repository with no graph built; one in which a complete, unarchived change has delta specs only for capabilities the change under assessment does not touch; and one in which the change under assessment is itself complete and unarchived
- **WHEN** each is assessed
- **THEN** the first reads the drift signal green with the flag that no graph exists and the reason the stale-citation check did not run
- **AND** the second and third read it green with no flag

### Requirement: With `--markdown` the command SHALL print the description block and nothing else

With `--markdown`, standard output SHALL be one Markdown block and nothing else: a `## Merge confidence` heading; the verdict, the score and the band range on one line; directly after it, one legend line saying that `MERGE` means every local signal is green and is not a statement that the platform's branch rules would let the merge request merge, naming required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue as rules the verdict does not read; the commit assessed and the base; one group per kind of driving signal that has an entry, in the order needs a fix, needs a person, needs more evidence; the flags; the checks excluded from the pipeline input, when any; the two labels; and the full signal table inside a collapsed section. A signal's table row SHALL carry its reason and no more than a bounded number of its evidence lines; a row that leaves lines out SHALL end with one line stating how many it left out and that the JSON output carries them all. The block SHALL be rendered by `lib/merge-confidence.mjs` from the assessment and from the head, the base and the excluded names the command holds; the legend line SHALL be the same text in every verdict. Every reason and evidence line, and every excluded name, SHALL be rendered as an inline code span, with any backtick in it replaced, line breaks folded, and its length bounded, so that no name a platform, a review or a ledger supplied can render as a mention, a link or markup. The exit status SHALL be what it is without the flag. `--markdown` together with `--json` SHALL exit 1 with a usage error and nothing on standard output.

Rationale: a block a model renders from JSON is a block a model can mis-render. Printed by the command, the description shows what the command computed. A check is named by the workflow that defines it and a finding by the reviewer that wrote it; posted as plain Markdown under the account of whoever ran the skill, either could mention a person or close the collapsed section. The verdict's word is the platform's word, and every platform has gates the command never reads; the legend line is the one line the command controls that could otherwise be read as the platform's answer.

#### Scenario: Happy path — a human verdict's block

- **GIVEN** an assessment reading `HUMAN` with one signal needing a person, two needing more evidence and one flag
- **WHEN** the command runs with `--markdown`
- **THEN** standard output starts with `## Merge confidence`, carries the verdict line, the legend line, the commit and the base, a group for each of the two kinds, the flag, the two labels and one table row per registered signal
- **AND** it carries no group for needs a fix

#### Scenario: Failure — a name that tries to be markup stays text

- **GIVEN** a pipeline input with a failed check named with an `@` mention, a link and a closing `details` tag, and a backtick; and another whose check name is many times longer than a line
- **WHEN** the command runs with `--markdown` for each
- **THEN** in the first the name appears only inside an inline code span, with the backtick replaced
- **AND** with its code spans removed, the block holds one opening and one closing `details` tag
- **AND** in the second the name is cut short and ends with an ellipsis

#### Scenario: Failure — both output flags is a usage error

- **GIVEN** the command run with `--markdown` and `--json`
- **WHEN** it starts
- **THEN** it exits 1, standard error names the two flags, and standard output is empty

#### Scenario: Edge case — a blocking verdict still prints its block

- **GIVEN** an assessment reading `BLOCK`
- **WHEN** the command runs with `--markdown`
- **THEN** the block is printed and the exit status is 1

#### Scenario: Edge case — the legend line is in every verdict

- **GIVEN** three assessments reading `MERGE`, `HUMAN` and `BLOCK`
- **WHEN** the command runs with `--markdown` for each
- **THEN** each block carries, directly after the verdict line, one line naming `branch rules`, `approvals`, `code owners`, `draft`, `review threads` and `merge queue`
- **AND** the line is the same text in all three

#### Scenario: Edge case — a row with more evidence lines than it carries says how many it left out

- **GIVEN** an assessment in which one signal carries more evidence lines than a table row carries, and another carries two
- **WHEN** the command runs with `--markdown`, and again with `--json`
- **THEN** the first signal's row carries its reason, its first evidence lines up to the bound, and one last line stating how many lines were left out and naming `--json`
- **AND** the second signal's row carries both of its lines and no such line
- **AND** the JSON output carries every evidence line of both signals
