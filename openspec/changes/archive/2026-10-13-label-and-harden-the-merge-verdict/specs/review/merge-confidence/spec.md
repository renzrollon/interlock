## MODIFIED Requirements

### Requirement: The pipeline signal SHALL read the platform's checks for the head commit

The pipeline input SHALL carry the commit it describes and one entry per check with its name, state and whether the platform requires it. A failed required check SHALL make the pipeline signal (`ci.pipeline`) red. A failed non-required check SHALL make it amber. A pending check SHALL make it unobserved. An input whose commit is not the head SHALL make it unobserved even when the input records a failed required check, and the evidence SHALL name that check. An input whose check list is present and empty SHALL be green with a flag. An absent input SHALL be unobserved.

An input that is not well-formed SHALL never read as an input with no checks. The command SHALL accept a `--pipeline` file only when it is well-formed by the one rule `lib/pipeline.mjs` publishes: an object carrying a string `sha` and a list `checks` in which every entry is an object with a non-empty string `name`, a `state` that is one of `pass`, `fail`, `pending` or `skipped`, and a boolean `required`; an `excluded` list of strings MAY be present. Any other file SHALL exit 1 with the fault named on standard error and nothing on standard output, as an unreadable input does. The assessment itself SHALL read a pipeline whose `checks` is not a list, or holds an entry that is not an object, as unobserved, naming the fault, and SHALL read an entry whose state is none of the four as amber, marked as needing more evidence.

When the input records excluded check names, the pipeline signal SHALL name each one in its evidence, whatever band it reads.

Rationale: a check that failed on another commit says nothing certain about the head, which may have fixed it; reading it red would block on stale evidence, and dropping it from the evidence would hide it. An absent or misspelt list and an empty list are different statements: read alike, a file whose only fault is a misspelt key hides a failed required check behind a green signal. A check the caller left out has to stay visible wherever the verdict is shown.

#### Scenario: Happy path — every check passed

- **GIVEN** a pipeline input for the head commit in which every check passed or was skipped
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is green with no flag

#### Scenario: Failure — a failed required check is red

- **GIVEN** a pipeline input for the head commit in which a required check failed
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is red and the verdict is `BLOCK`
- **AND** the evidence names the failed check

#### Scenario: Edge case — a failed optional check, a pending check, and a stale commit

- **GIVEN** three pipeline inputs: one for the head commit with a failed non-required check, one for the head commit with a pending check, and one for a different commit with every check passed
- **WHEN** each is assessed
- **THEN** the first reads the pipeline signal amber
- **AND** the second reads it unobserved with the reason that a check is pending
- **AND** the third reads it unobserved with the reason that the input describes another commit

#### Scenario: Edge case — a failed required check on another commit is unobserved, not red

- **GIVEN** a pipeline input for a different commit in which a required check failed
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is unobserved with the reason that the input describes another commit
- **AND** the evidence names the failed required check, and the verdict is not `BLOCK` on its account

#### Scenario: Failure — a misspelt key over a failed required check never reads green

- **GIVEN** a pipeline file for the head commit that carries a failed required check under the key `check`, and no `checks`
- **WHEN** `interlock merge-confidence --pipeline <file>` runs
- **THEN** it exits 1, standard error says the file carries no `checks` list, and no verdict is printed

#### Scenario: Failure — the assessment reads a misshapen list as unobserved

- **GIVEN** an assessment input whose pipeline carries the head commit and a `checks` value that is a string
- **WHEN** the merge confidence is assessed
- **THEN** the pipeline signal is unobserved with a reason saying the input is not well-formed
- **AND** the verdict is not `MERGE`

#### Scenario: Edge case — an explicit empty list, and a state outside the four

- **GIVEN** a pipeline file for the head commit whose `checks` is an empty list; a pipeline file with an entry whose state is `SUCCESS`; and an assessment input holding that same entry
- **WHEN** the command is given each file, and the assessment is given the input
- **THEN** the first reads the pipeline signal green with the flag `no-pipeline`
- **AND** the second exits 1 naming the entry and the four states the file may carry
- **AND** the assessment reads the pipeline signal amber, marked as needing more evidence

#### Scenario: Edge case — an excluded check is named beside a green signal

- **GIVEN** a pipeline input for the head commit in which every check passed and `excluded` holds `merge-gate`, and another with no `excluded` list
- **WHEN** each is assessed
- **THEN** the first reads the pipeline signal green and its evidence says `merge-gate` was excluded by the caller
- **AND** the second carries no exclusion line

## ADDED Requirements

### Requirement: A run's evidence SHALL be used only for the diff that run reviewed

In addition to the conditions under which a run's evidence file is used at all, when a base is given the command SHALL use the file only when the commit the file records as its base equals the merge base of that base and the head. When they differ, when the file records no base, or when the merge base cannot be read, the command SHALL take nothing from the file, SHALL name on standard error the diff the run reviewed and the diff under assessment, and SHALL read each of the run-supplied signals as it would with no file. The command SHALL NOT take a base from the file: with no base given, every signal that needs one SHALL stay unobserved, as it is without an evidence file, so the verdict cannot be `MERGE`.

Rationale: a run reviews the diff from its start commit to the commit it made. A pull request of five commits whose last commit came from a reviewed run is not a reviewed pull request, and the evidence file ends at the same head either way. A base the file supplied would let that same file choose the diff it is judged on.

#### Scenario: Happy path — one run, one pull request

- **GIVEN** a branch whose only commit beyond the target branch is the one a ship run made, that run's evidence file, and `--base` naming the target branch
- **WHEN** the command runs with `--run`
- **THEN** the file is used, and with a passing pipeline input for the head the verdict can read `MERGE`

#### Scenario: Failure — a run that reviewed only the last of several commits

- **GIVEN** a branch five commits beyond the target branch, the evidence file of a run that started at the fourth, and `--base` naming the target branch
- **WHEN** the command runs with `--run`
- **THEN** nothing is taken from the file, and standard error names the run's base and the merge base
- **AND** the review signals read as they would with no file, and the verdict is not `MERGE`

#### Scenario: Failure — no base given never borrows the file's

- **GIVEN** the same five-commit branch and evidence file, a passing pipeline input for the head, and no `--base`
- **WHEN** the command runs with `--run`
- **THEN** the diff shape, the spec coverage and the human-paths signals are unobserved for want of a base
- **AND** the verdict is not `MERGE`, and with `--require-merge` the command exits 1

#### Scenario: Edge case — a target branch that moved on after the run started

- **GIVEN** a one-commit branch and its run's evidence file, and a target branch that gained a commit after the run started
- **WHEN** the command runs with `--run` and `--base` naming the target branch
- **THEN** the file is used, because the merge base is still the commit the run started on

### Requirement: An observation the run record does not carry SHALL be unobserved, never a zero

The run-integrity signal (`run.integrity`) SHALL read the observations a run's close records: whether the run halted, whether its trajectory is complete, and its counts of unpublished stage markers, rejected handoff reports, permission prompts, auto-mode denials and unticked tasks. A recorded degradation SHALL read amber, marked as needing a person, whatever else is absent. With no recorded degradation, a record that lacks any of those observations, or carries one as null, SHALL read unobserved and SHALL name the observations it lacks by the keys the record uses for them. Only a record that carries every observation, none of them a degradation, SHALL read green.

Rationale: a host that observed no permission prompt and a host that could not observe one are different facts. Counting the second as zero is the reading this repository refuses everywhere else it records an observation.

#### Scenario: Happy path — every observation present and clean

- **GIVEN** a run record carrying every observation, with no halt, a complete trajectory and every count zero
- **WHEN** the merge confidence is assessed
- **THEN** the run-integrity signal is green

#### Scenario: Failure — an empty record never reads as a clean run

- **GIVEN** a run record that is an empty object
- **WHEN** the merge confidence is assessed
- **THEN** the run-integrity signal is unobserved and names every observation as missing
- **AND** the verdict is not `MERGE`

#### Scenario: Edge case — counts the host could not observe, and a degradation beside them

- **GIVEN** two run records whose permission-prompt and auto-mode-denial counts are null: one otherwise clean, one that also records an unticked task
- **WHEN** each is assessed
- **THEN** the first reads the signal unobserved, naming the two counts by their record keys
- **AND** the second reads it amber, marked as needing a person, naming the unticked task

### Requirement: Changed source the coverage report does not list SHALL be flagged, and SHALL NOT pass unremarked

When the coverage input records changed source files the report does not list, a coverage signal that reads green SHALL carry the flag `unmeasured-source`, and its evidence SHALL name the files and state the number of lines the diff adds in them. A coverage signal that reads any other band SHALL state the same in its evidence. The flag SHALL NOT move the band: the small-change floor, the decline rule and the patch rule SHALL each be applied as they are without it. An input that carries neither unreported field SHALL raise no flag, and the evidence SHALL say the input does not state unreported files. A repository with no coverage configured SHALL read green with the flag `no-coverage` and SHALL NOT carry `unmeasured-source`.

Rationale: a report lists the files the tests loaded. A new source file no test loads is absent from it, so its lines count neither for nor against any figure, and the change that most needs the signal read "under the small-change floor" with nothing said. A report cannot tell a file no test loaded from one the project left out of coverage on purpose, so holding the band would give some repositories an amber nothing can lift; a flag is what "green, but you should know" is for.

#### Scenario: Happy path — every changed source file is in the report

- **GIVEN** a coverage input whose unreported list is empty
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal carries no `unmeasured-source` flag

#### Scenario: Failure — a new, unloaded source file is flagged where it used to pass unremarked

- **GIVEN** a coverage input reporting zero measured changed lines and one unreported source file with three hundred added lines
- **WHEN** the merge confidence is assessed
- **THEN** the coverage signal is green under the small-change floor and carries the flag `unmeasured-source`
- **AND** its evidence names the file and the three hundred lines
- **AND** the score is lower than the same input scores with an empty unreported list

#### Scenario: Edge case — a decline with unreported source, an input from an older producer, and no coverage configured

- **GIVEN** a coverage input whose head total fell beyond the tolerance and which lists one unreported source file; an input that carries neither unreported field; and an input saying coverage is not configured
- **WHEN** each is assessed
- **THEN** the first reads the coverage signal amber, and its evidence names the unreported file
- **AND** the second raises no `unmeasured-source` flag, and its evidence says the input does not state unreported files
- **AND** the third reads green with `no-coverage` and without `unmeasured-source`

### Requirement: The command SHALL name the commit and the base it assessed, and SHALL print the labels for its verdict

The command's JSON output SHALL carry `head`, an object holding the assessed commit as `sha`, or null when the head could not be read; `base`, an object holding the reference given as `ref` and the merge base the diff was taken from as `sha`, with `sha` null when the reference resolves and its merge base cannot be read, or null when no base was assessed; and `labels`, an object holding `verdict` and `score`, each an object with a `name`, a `color` and a `description`, together with `verdictNames`, the three verdict label names, and `scorePrefix`. The verdict label SHALL be `interlock/merge` for `MERGE`, `interlock/human-review` for `HUMAN` and `interlock/blocked` for `BLOCK`. The score label SHALL be `interlock/score-` followed by the integer score with no padding. The label names SHALL be defined in one place in `lib/merge-confidence.mjs` and SHALL NOT be restated as literals by the command or the skill. The text output SHALL print the two label names on one line.

Rationale: a label name composed in a skill is a second definition of the verdict's vocabulary; the documentation, the skill and the platform recipes all have to agree with one list.

#### Scenario: Happy path — a human verdict prints its two labels

- **GIVEN** an assessment that reads `HUMAN` with a score of 72 for a readable head commit and a given base
- **WHEN** the command prints JSON
- **THEN** `labels.verdict.name` is `interlock/human-review` and `labels.score.name` is `interlock/score-72`
- **AND** `labels.verdictNames` lists the three verdict names and `labels.scorePrefix` is `interlock/score-`
- **AND** `head.sha` is the head commit, `base.ref` is the reference given and `base.sha` is the merge base

#### Scenario: Failure — an unreadable head is null, not a guess

- **GIVEN** a directory that is not a repository
- **WHEN** the command prints JSON
- **THEN** `head` is null and `base` is null
- **AND** the labels are still printed for the verdict, which is not `MERGE`

#### Scenario: Edge case — the score is written as the integer it is

- **GIVEN** two assessments, one whose score has three digits and one whose score has fewer
- **WHEN** the labels are printed
- **THEN** each score label name is the prefix followed by the decimal digits of that assessment's score, with no leading zero

### Requirement: With `--markdown` the command SHALL print the description block and nothing else

With `--markdown`, standard output SHALL be one Markdown block and nothing else: a `## Merge confidence` heading; the verdict, the score and the band range on one line; the commit assessed and the base; one group per kind of driving signal that has an entry, in the order needs a fix, needs a person, needs more evidence; the flags; the checks excluded from the pipeline input, when any; the two labels; and the full signal table inside a collapsed section. The block SHALL be rendered by `lib/merge-confidence.mjs` from the assessment and from the head, the base and the excluded names the command holds. Every reason and evidence line, and every excluded name, SHALL be rendered as an inline code span, with any backtick in it replaced, line breaks folded, and its length bounded, so that no name a platform, a review or a ledger supplied can render as a mention, a link or markup. The exit status SHALL be what it is without the flag. `--markdown` together with `--json` SHALL exit 1 with a usage error and nothing on standard output.

Rationale: a block a model renders from JSON is a block a model can mis-render. Printed by the command, the description shows what the command computed. A check is named by the workflow that defines it and a finding by the reviewer that wrote it; posted as plain Markdown under the account of whoever ran the skill, either could mention a person or close the collapsed section.

#### Scenario: Happy path — a human verdict's block

- **GIVEN** an assessment reading `HUMAN` with one signal needing a person, two needing more evidence and one flag
- **WHEN** the command runs with `--markdown`
- **THEN** standard output starts with `## Merge confidence`, carries the verdict line, the commit and the base, a group for each of the two kinds, the flag, the two labels and one table row per registered signal
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

### Requirement: Every registered signal and every flag SHALL have a row in the delivery documentation

`docs/15-merge-confidence.md` SHALL carry, under a heading `## The signals`, one table row per registered signal, saying what the signal reads and what moves it to each band, and under a heading `## The flags`, one table row per flag. The first cell of each row SHALL be the identifier in backticks. The set of signal identifiers under the first heading SHALL equal the registry's, and the set of flags under the second SHALL equal the published flag list; the suite SHALL fail, naming the identifier, when either differs. An informational signal SHALL be marked as not gating.

#### Scenario: Happy path — the tables and the registry agree

- **GIVEN** the shipped page and the registry
- **WHEN** the suite compares the two sets of signal identifiers and the two sets of flags
- **THEN** each pair is equal

#### Scenario: Failure — a signal registered without a row fails the suite

- **GIVEN** a registry that gained a signal the page does not list
- **WHEN** the suite runs
- **THEN** it fails naming the signal

#### Scenario: Edge case — the informational signal is listed and marked

- **GIVEN** the registry's one informational signal
- **WHEN** a reader finds its row
- **THEN** the row says it is reported and never banded

### Requirement: A file at the repository root SHALL be named by its `./` form, and a bare file name SHALL NOT be read as a path mention

The rule that recognises a path mention in spec text (`lib/spec-text.mjs`) SHALL read a path as a mention only when it carries a directory and a file extension. A file at the repository root that carries an extension SHALL therefore be named as `./<file>`, which SHALL be read as the same path. A bare file name SHALL NOT name a file.

Rationale: a bare file name in a spec is usually an example or a file elsewhere in the tree. Reading it as a mention would link specs to every root file that happens to share the name.

#### Scenario: Happy path — a root file named by its `./` form

- **GIVEN** a change that adds a source file with an extension at the repository root and a delta spec that mentions it as `./<file>` in backticks
- **WHEN** the merge confidence is assessed with a base
- **THEN** the spec-coverage signal reads the file as named

#### Scenario: Failure — a bare file name names nothing

- **GIVEN** the same change with the delta spec mentioning only the bare file name in backticks
- **WHEN** the merge confidence is assessed with a base
- **THEN** the spec-coverage signal is amber and names the file as added and named by no spec

#### Scenario: Edge case — a path with a directory is unaffected

- **GIVEN** a spec that mentions a source file two directories deep by its repository-relative path in backticks
- **WHEN** the mention rule reads the spec
- **THEN** the file is named, with or without a leading `./`
