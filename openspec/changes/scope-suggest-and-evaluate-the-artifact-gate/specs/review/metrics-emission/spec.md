# Spec Delta

## ADDED Requirements

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
