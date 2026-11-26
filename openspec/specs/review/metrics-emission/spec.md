# review/metrics-emission Specification

## Purpose
Closes the gap between a review-metrics writer that already exists and a review path that never invokes it — so the report's review-finding indicators become observable without loosening the recognizer, without letting bookkeeping influence a verdict, and without leaving the emission as an optional flag that the next caller can silently omit.

## Requirements

### Requirement: Every gated review path can emit review metrics

Each command that evaluates review findings to a verdict SHALL accept a change name and, when given one, write one review-metrics record carrying the counts it computed: findings raised, findings dismissed, findings dropped by the tolerance band, and findings surviving to the verdict.

#### Scenario: The adversarial review path emits when given a change

- **WHEN** the review command evaluates findings against verdicts and is given a change name
- **THEN** a review-metrics record is written carrying that evaluation's raised, dismissed, dropped and surviving counts

#### Scenario: The deterministic gate path emits when given a change

- **WHEN** the gate command evaluates a findings file and is given a change name
- **THEN** a review-metrics record is written carrying that evaluation's raised, dismissed, dropped and surviving counts

#### Scenario: The emitted counts are the counts that produced the verdict

- **WHEN** dismissals and the tolerance band have been applied to reach a verdict
- **THEN** the counts in the record are the ones that produced that verdict, not counts recomputed by a second reading of the input

#### Scenario: A passing evaluation emits as readily as a failing one

- **WHEN** an evaluation reaches a passing verdict with zero surviving findings
- **THEN** a record is still written, carrying zero as an observed count rather than as an absence

### Requirement: The record declares the schema the report recognizes

An emitted record SHALL declare the review-metrics schema the report's classifier recognizes, so it is counted as recognized rather than surfaced as an unrecognized file.

#### Scenario: An emitted record is recognized by the report

- **WHEN** the report classifies a metrics file emitted by a review path
- **THEN** it is counted as recognized and contributes to the review-finding indicators

#### Scenario: Skill-written findings files remain unrecognized

- **WHEN** the metrics corpus also holds a skill-written findings file declaring no recognized schema
- **THEN** that file is still counted as unrecognized and contributes to no indicator, unchanged by this capability

### Requirement: Emission cannot change a verdict, an exit status, or machine-readable output

Emission SHALL be bookkeeping only. It SHALL NOT alter the verdict, the exit status, or the existing machine-readable structure, and a failed write SHALL NOT raise.

#### Scenario: A failed write leaves the verdict intact

- **WHEN** the record cannot be written because the destination is not writable
- **THEN** the command reports the same verdict and the same exit status it would have reported had the write succeeded

#### Scenario: A failed write is reported, not raised

- **WHEN** the record cannot be written
- **THEN** the reason is surfaced to the caller and no exception propagates

#### Scenario: A read-only checkout still yields a verdict

- **WHEN** the repository cannot be written to at all
- **THEN** the evaluation completes and returns its verdict

### Requirement: A record is attributed to a named change, never to an inferred one

A record SHALL be attributed to the change the caller named. When no change name is given, no record SHALL be written and no name SHALL be derived from the findings file's name or path.

#### Scenario: A named change is carried onto the record

- **WHEN** a review path is invoked with a change name
- **THEN** the emitted record is attributed to that change

#### Scenario: An unnamed invocation writes nothing rather than guessing

- **WHEN** a review path is invoked without a change name
- **THEN** no record is written and no name is inferred from the findings file's path

#### Scenario: An empty change name is refused rather than accepted

- **WHEN** a review path is invoked with a change name flag carrying no value
- **THEN** the invocation is refused with a message naming the missing value

### Requirement: The review skills' emission is pinned against silent regression

The command lines the review skills document SHALL carry the change name that triggers emission, and that SHALL be asserted by a test — so a skill that stops requesting metrics fails the suite rather than silently emptying the corpus.

#### Scenario: A skill dropping the change name fails the suite

- **WHEN** a review skill's documented command line no longer carries the change name that triggers emission
- **THEN** the test suite fails and names the skill

#### Scenario: Both review skills are covered

- **WHEN** the pinning test runs
- **THEN** it covers every review skill whose documented command line reaches a gated review path

### Requirement: A review-metrics record SHALL name the stage, depth, reader and lenses that produced it, or `null` for each it was not told

Each record SHALL carry `stage` (`artifacts` or `code`), `depth` (`lean` or `strict`), `reviewer` (`session`, `agent` or `external`) and `lenses` (a list of names, empty for none). Each SHALL be `null` when the writer was not given a known value. `interlock gate --metrics` SHALL take them from `--stage`, `--depth`, `--reviewer` and `--lenses` (`none` meaning the empty list). The code-review writers SHALL record `stage` `code`, `reviewer` `agent` and their depth. The schema id SHALL not change.

#### Scenario: Happy path — an artifact gate records what ran

- **WHEN** `interlock gate --findings <f> --metrics <change> --stage artifacts --depth strict --reviewer agent --lenses agentic-harness --json` runs
- **THEN** the record it writes carries `stage` `artifacts`, `depth` `strict`, `reviewer` `agent` and `lenses` `["agentic-harness"]` beside its four counts

#### Scenario: Failure — an unknown value is recorded as null and moves nothing

- **GIVEN** the same gate line with `--reviewer human`
- **WHEN** it runs
- **THEN** standard error names `--reviewer` and the known values, the record carries `reviewer` `null`, and `passed`, the other output fields and the exit code are what the line gives without the flag

#### Scenario: Edge case — a gate line with no recording flags records nulls, never a guess

- **GIVEN** `interlock gate --findings .claude/metrics/review-artifacts-x-1.json --metrics x --json`, whose findings declare `dimension` `artifacts`
- **WHEN** it runs
- **THEN** the record carries `stage`, `depth`, `reviewer` and `lenses` as `null`, and nothing is inferred from the findings file's name or its contents

#### Scenario: Edge case — `--lenses none` is an observed empty list

- **WHEN** the gate line carries `--lenses none`
- **THEN** the record carries `lenses` `[]`, which is not the `null` a line without the flag records

#### Scenario: Edge case — the code-review writers record their stage

- **WHEN** `interlock review --metrics <change>` writes a record from a dimension record whose `depth` is `lean`, and a ship run's review step writes one
- **THEN** both carry `stage` `code` and `reviewer` `agent`, the first `depth` `lean` and the second the depth its review ran at
- **AND** `interlock review --metrics <change>` from a dimension record with no `depth` records `depth` `null`

#### Scenario: Edge case — an older reader still recognizes the record

- **GIVEN** a record carrying the four new fields
- **WHEN** the report's classifier reads it
- **THEN** its schema id is the one the classifier already recognizes, and its counts reach the indicators as before

### Requirement: `--lenses` SHALL record lens-shaped names or `none`, and `null` for anything else

`--lenses` SHALL be `none` or a comma-separated list of lens-shaped names: lowercase letters, digits and hyphens. A flag with no value, an empty value, `none` beside a name, or an element of another shape SHALL be warned on standard error and recorded as `null`, never as part of a list.

#### Scenario: Failure — a malformed lens list records null, never part of a list

- **GIVEN** gate lines carrying, one each, `--lenses` with no value, `--lenses ""`, `--lenses none,agentic-harness` and `--lenses "Bad Name"`
- **WHEN** each runs
- **THEN** each warns on standard error naming `--lenses` and the accepted forms, each record carries `lenses` `null`, and `passed` and the exit code are what the line gives without the flag

### Requirement: A gate's review-metrics record SHALL name the findings file it read, or `null`

A record written by `interlock gate --metrics` SHALL carry `findings`: the `--findings` path relative to the repository root, with `/` separators, when that path is a file inside the root. Otherwise it SHALL be `null`, as for `-` (standard input) or a file outside the root. The other writers SHALL record `findings` as `null`. The schema id SHALL not change.

#### Scenario: Happy path — the artifact gate's record names its findings file

- **WHEN** `interlock gate --findings .claude/metrics/review-artifacts-x-20261125-120000.json --metrics x --stage artifacts --json` runs at the repository root
- **THEN** the record it writes carries `findings` `.claude/metrics/review-artifacts-x-20261125-120000.json`

#### Scenario: Edge case — findings read from standard input

- **WHEN** the gate reads `--findings -` with `--metrics x`
- **THEN** the record carries `findings` `null`, and its counts are what the gate counted

#### Scenario: Edge case — an absolute path inside the root

- **WHEN** `--findings` names an absolute path to a file under the repository root
- **THEN** the record carries that file's path relative to the root

#### Scenario: Edge case — an older reader still recognizes the record

- **GIVEN** a record carrying `findings`
- **WHEN** the report's classifier reads it
- **THEN** its schema id is the one the classifier already recognizes, and its counts reach the indicators as before
