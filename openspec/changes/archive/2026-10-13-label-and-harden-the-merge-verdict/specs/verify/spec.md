## MODIFIED Requirements

### Requirement: The coverage input the merge verdict reads SHALL be produced by the CLI from the head report, the baseline and the diff

`interlock verify coverage --base <ref>` SHALL print the coverage input the merge-confidence command reads, with the fields that input's schema names and no other judgement: the head total, the base total and its commit when a baseline is usable or present, whether the baseline's commit is an ancestor of the head, the changed-line coverage, the number of changed lines, the changed source files the report does not list (`unreportedFiles`), and the number of lines the diff adds in those files (`unreportedAddedLines`), all computed against the diff from the merge base of the reference to the head. A file SHALL be listed as unreported only when the diff adds at least one line to it, the report holds no record for it, and the project counts it as coverable source: a test, a configuration file or a document SHALL never be listed. Both fields SHALL be computed in `lib/coverage.mjs` from the report and the diff alone, and the changed-line figure SHALL still count only lines the report instruments. When the test profile declares no coverage command, or declares coverage disabled, and no report is named, it SHALL print an input that says coverage is not configured, in which both unreported fields are null. When a coverage command is declared and its report cannot be found or read, or is in a format the reader does not support, it SHALL exit 1, naming the report and the supported format, and print nothing on standard output. It SHALL run no coverage command unless asked to compute the base.

Rationale: the verdict's coverage signal reads exactly this schema; the producer computes figures and never bands them, so the thresholds stay in one module. The changed-line figure is honest about what it measured and silent about what it did not: the files a report never saw are the ones no test loaded, and the verdict cannot say so unless the input names them.

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

#### Scenario: Failure — a new source file no test loaded is named, not passed over

- **GIVEN** a diff that adds a source file of forty lines which the report holds no record for, beside a source file the report does list
- **WHEN** `interlock verify coverage --base <ref> --json` runs
- **THEN** `unreportedFiles` lists the first file only and `unreportedAddedLines` is forty
- **AND** the changed-line figure and count are what they are without that file

#### Scenario: Edge case — a test file outside the report, and no coverage configured

- **GIVEN** a diff that adds a test file the report holds no record for, and separately a profile that declares no coverage command
- **WHEN** the command runs for each
- **THEN** the first prints an empty `unreportedFiles` and an `unreportedAddedLines` of zero
- **AND** the second prints both fields as null
