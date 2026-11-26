# Spec Delta

## ADDED Requirements

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
