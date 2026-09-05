# evals/outcome-history Specification

## Purpose

Defines the committed record every outcome-eval run appends to — one bounded line per fixture per arm, keyed so that two releases are comparable — and states what that record may never carry and what it means when the append fails.

## Requirements

### Requirement: Outcome-eval results accumulate in one committed append-only record

The eval SHALL append its results to a single append-only, line-oriented file that is committed to the repository. Each line SHALL be one result for one fixture in one arm from one run. Existing lines SHALL NOT be rewritten, reordered or truncated by a later run.

Each line SHALL carry the key by which results are compared across time: the version of the software under test and the fixture's identity, together with the arm, the host, and the moment the run happened.

#### Scenario: Happy path — two releases produce two comparable rows per fixture and arm

- **WHEN** the eval runs once under one version and once under a later version
- **THEN** the record holds a line per fixture and arm for each version
- **AND** a reader can pair them by version and fixture and state the difference on every recorded field

#### Scenario: Failure — a later run does not rewrite an earlier line

- **WHEN** a run appends its results
- **THEN** every line written by an earlier run is still present and unaltered

#### Scenario: Edge case — a torn final line costs one record, not the file

- **WHEN** a line was truncated mid-write
- **THEN** every earlier line remains readable, and the torn line is skipped and counted

### Requirement: The record holds counts and measures only, copied by name

Each field of a result SHALL be copied by name into the record. Handing the writer a whole run summary SHALL NOT cause anything beyond the named fields to be written.

The record SHALL NOT carry a transcript, a prompt, an agent message, a diff, a file body, a suite log, a commit message, or any other unbounded text. Where a fact cannot travel as a count or a measure, the record SHALL carry a bounded identifier for it rather than its contents.

This keeps the file small enough to live in version control, which is the only reason it can be a time series at all.

#### Scenario: Happy path — a fat run summary yields only the named fields

- **WHEN** the writer is handed a run summary that also holds suite output and agent messages
- **THEN** the written line contains only the named result fields
- **AND** it contains no suite output, no agent message and no diff content

#### Scenario: Failure — an unbounded field is not written

- **WHEN** a value that would be unbounded is offered for the record
- **THEN** it is replaced by a bounded identifier or omitted, and the unbounded text is not written

### Requirement: A result declares its schema and is never mistaken for another corpus

Each line SHALL declare the schema it was written under, so that a later change to the result shape stays legible to a reader comparing two lines, and so that a result can never be read as a record from the outcome corpus, the trajectory corpus or the metrics corpus.

A line whose declared schema is not recognized SHALL be counted as unrecognized and excluded from every figure, rather than interpreted.

#### Scenario: Happy path — a result declares its schema

- **WHEN** a result line is read
- **THEN** it declares the schema it was written under

#### Scenario: Failure — an unrecognized schema is excluded, not guessed at

- **WHEN** a line declares a schema the reader does not recognize
- **THEN** it is counted as unrecognized and contributes to no figure

### Requirement: The identity of the measuring apparatus is recorded with the measurement

Each result SHALL record the identity of what produced it as well as what it measured: the version under test, the host, the arm, the model the run used, and the identity of the eval's own agent. A change in the instrument SHALL therefore be visible in the record rather than confounding a comparison between two versions.

#### Scenario: Happy path — a comparison can exclude runs whose instrument differed

- **WHEN** two results are compared across versions
- **THEN** a reader can tell whether the model and the eval's own agent were the same for both

#### Scenario: Failure — a result missing its instrument identity is not comparable

- **WHEN** a result carries no model or no eval-agent identity
- **THEN** it is not paired with another result for a version comparison, and the reason is stated

### Requirement: A failed append fails the eval run and nothing else

A failure to append a result SHALL exit the eval run non-zero with the reason stated. A metered run whose result nobody can read has defeated the reason the run exists, so this record is not one whose loss is merely reported.

That failure SHALL be confined to the eval run. It SHALL NOT halt, fail or alter any ship run, and it SHALL NOT change the exit status of the report or of any other command that reads the record.

#### Scenario: Happy path — a successful append leaves the eval exit status clean

- **WHEN** every result appends successfully
- **THEN** the eval run exits on the status its grading produced

#### Scenario: Failure — an unwritable record fails the eval loudly

- **WHEN** the record cannot be appended to
- **THEN** the eval run exits non-zero and names the reason
- **AND** it does not exit as though the results had been recorded

#### Scenario: Edge case — a reader of the record is unaffected by a past write failure

- **WHEN** a command reads the record after a run that failed to append
- **THEN** it reads the lines that are present and exits on its own terms
- **AND** the past write failure does not change its exit status
