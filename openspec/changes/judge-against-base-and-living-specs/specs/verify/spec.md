## ADDED Requirements

### Requirement: The coverage reader SHALL compute a project total and changed-line coverage on canonical repository paths

Given an lcov coverage report, the CLI SHALL compute the project total as covered lines over instrumented lines across every record, from each record's line-found and line-hit summary when present and from its per-line entries otherwise. Given the lines a diff adds, it SHALL compute changed-line coverage over the added lines that the report instruments, and SHALL report how many such lines there were. A report file path SHALL be resolved to one canonical repository-relative form before it is matched against a diff path, whether the report wrote it absolute, relative to the directory the coverage command ran in, or with a leading `./`. A record whose file lies outside the repository SHALL be left out of both figures and counted, and the count SHALL be stated. An added line the report does not instrument (a comment, a blank line, a file the report does not cover) SHALL NOT count as a changed line.

Rationale: no code in the repository reads a coverage report today, so the merge verdict's coverage input has no producer; and a report path that fails to match a diff path silently reads as "no changed lines", which the verdict treats as a small change and passes.

#### Scenario: Happy path — a total and a changed-line figure from one report

- **GIVEN** an lcov report with two file records whose summaries give 80 of 100 and 15 of 20 lines hit, and a diff that adds four instrumented lines in the first file, three of them hit
- **WHEN** the coverage figures are computed
- **THEN** the project total is 79.2 percent, from 95 of 120 lines
- **AND** the changed-line coverage is 75 percent over 4 changed lines

#### Scenario: Failure — a report with no instrumented line has no total

- **GIVEN** an lcov report whose records instrument no line at all
- **WHEN** the coverage figures are computed
- **THEN** the project total is absent, not zero
- **AND** the absence is stated, so no caller can record it as a measured figure

#### Scenario: Edge case — three spellings of one file resolve to the same path

- **GIVEN** a report run from the repository root whose records name `./lib/a.mjs`, and a second report whose records name the same file by its absolute path inside the repository, and a diff that adds lines to `lib/a.mjs`
- **WHEN** the changed-line coverage is computed from each report
- **THEN** both reports match the diff's lines to the same file and give the same figure
- **AND** a record naming a file outside the repository is left out of both figures and counted in the output

### Requirement: A coverage baseline SHALL be recorded only with a project total, and SHALL be usable only from an ancestor of the head

`interlock verify baseline` SHALL record the project total of a coverage report taken on the current commit, together with that commit, the branch it was taken on when there is one, the time it was written and a schema identifier, in the working root's testing directory or at a path the caller names. It SHALL refuse to write, exit 1 and leave any previous baseline in place when the report yields no project total or cannot be read. A reader SHALL look for the baseline at the path the caller names, else in the working root and then in the state home, as the test profile is found, and SHALL NOT write it into the state home. A baseline SHALL be usable as the base figure only when its commit is an ancestor of the head; whether it is SHALL be a fact read from the repository, never an age. A baseline file that exists and does not match the schema SHALL end the reading command with exit 1, naming the file.

Rationale: a baseline from another branch compares the change against code it never had; a baseline of any age on the change's own line of history is still the right comparison. A corrupt baseline read as "no baseline" would quietly move the judgement to a different rule.

#### Scenario: Happy path — a baseline from the default branch is used on a branch made from it

- **GIVEN** a baseline recorded on a commit of the default branch, and a branch whose head descends from that commit
- **WHEN** the coverage input is produced on the branch
- **THEN** the base figure is the baseline's total, with the baseline's commit
- **AND** the input states that the baseline's commit is an ancestor of the head

#### Scenario: Failure — a report with no total writes no baseline

- **GIVEN** an existing baseline, and a coverage report whose records instrument no line
- **WHEN** `interlock verify baseline` runs on that report
- **THEN** it exits 1, naming the missing total
- **AND** the existing baseline is unchanged

#### Scenario: Edge case — an old baseline on the same line of history, and a new one from another branch

- **GIVEN** a baseline recorded many commits ago on an ancestor of the head, and separately a baseline recorded today on a branch the head does not descend from
- **WHEN** the coverage input is produced against each
- **THEN** the first states that its commit is an ancestor of the head, whatever its age
- **AND** the second states that its commit is not an ancestor, so the merge verdict reads the coverage signal unobserved

#### Scenario: Edge case — a baseline file that does not match the schema

- **GIVEN** a baseline file whose schema identifier is missing or whose total is not a number between 0 and 100
- **WHEN** the coverage input is produced
- **THEN** the command exits 1 naming the baseline file
- **AND** standard output carries no coverage input

### Requirement: The coverage input the merge verdict reads SHALL be produced by the CLI from the head report, the baseline and the diff

`interlock verify coverage --base <ref>` SHALL print the coverage input the merge-confidence command reads, with the fields that input's schema names and no other judgement: the head total, the base total and its commit when a baseline is usable or present, whether the baseline's commit is an ancestor of the head, the changed-line coverage, and the number of changed lines, all computed against the diff from the merge base of the reference to the head. When the test profile declares no coverage command, or declares coverage disabled, and no report is named, it SHALL print an input that says coverage is not configured. When a coverage command is declared and its report cannot be found or read, or is in a format the reader does not support, it SHALL exit 1, naming the report and the supported format, and print nothing on standard output. It SHALL run no coverage command unless asked to compute the base.

Rationale: the verdict's coverage signal reads exactly this schema; the producer computes figures and never bands them, so the thresholds stay in one module.

#### Scenario: Happy path — a configured repository with a usable baseline

- **GIVEN** a test profile with a coverage command, a readable lcov report at its report path, a usable baseline, and a base reference
- **WHEN** `interlock verify coverage --base <ref> --json` runs
- **THEN** it prints `configured: true`, the head total, the base total and commit, `baseIsAncestor: true`, the changed-line coverage and the changed-line count
- **AND** it exits 0 and prints no band or verdict

#### Scenario: Failure — a declared report that is missing

- **GIVEN** a test profile with a coverage command whose report path does not exist
- **WHEN** `interlock verify coverage --base <ref> --json` runs
- **THEN** it exits 1, naming the report path and saying the coverage command must run first
- **AND** standard output is empty, so the merge verdict reads the coverage signal unobserved rather than clean

#### Scenario: Edge case — no coverage tooling, and no baseline

- **GIVEN** one repository whose test profile declares no coverage command, and another with a readable report and no baseline anywhere
- **WHEN** `interlock verify coverage --base <ref> --json` runs in each
- **THEN** the first prints an input saying coverage is not configured
- **AND** the second prints the head total and changed-line figures with every base field empty, so the verdict judges the change on its changed lines alone

### Requirement: Computing the base figure on demand SHALL run in a temporary worktree that is always removed

With `--compute-base`, when no usable baseline exists, `interlock verify coverage` SHALL check out the merge base of the reference and the head in a temporary worktree outside the repository, run the test profile's coverage command there with the profile read from the main working tree, read the report at the profile's report path inside that worktree, record its total as the baseline with the merge base as its commit, and use it as the base figure. The temporary worktree SHALL be removed whether the command succeeded, failed or could not start. A failed or unreadable base measurement SHALL exit 1, naming the coverage command and its exit status, after the worktree is removed. The command SHALL state on standard error that it recorded a baseline.

Rationale: a repository with no job on its default branch has no other way to obtain a base figure; a worktree left behind on failure is the cleanup gap the existing lane code already has.

#### Scenario: Happy path — a base figure computed and recorded

- **GIVEN** a repository with no baseline, a coverage command that passes on the merge base, and a base reference
- **WHEN** `interlock verify coverage --base <ref> --compute-base --json` runs
- **THEN** the input carries the merge base's total as the base figure and the merge base as its commit
- **AND** a baseline is recorded for that commit, the temporary worktree no longer exists, and standard error says a baseline was recorded

#### Scenario: Failure — the coverage command fails on the merge base

- **GIVEN** a coverage command that exits non-zero when run on the merge base
- **WHEN** `interlock verify coverage --base <ref> --compute-base --json` runs
- **THEN** it exits 1 naming the command and its exit status
- **AND** the temporary worktree no longer exists, and no baseline is recorded

#### Scenario: Edge case — a usable baseline already exists

- **GIVEN** a usable baseline whose commit is an ancestor of the head
- **WHEN** `interlock verify coverage --base <ref> --compute-base --json` runs
- **THEN** no worktree is created and no coverage command runs
- **AND** the existing baseline is the base figure
