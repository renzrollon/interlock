# Spec Delta

## ADDED Requirements

### Requirement: Review-metrics figures SHALL be split by the stage, depth and reader each record names

Beside the existing totals, the report SHALL group the recognized review-metrics records by `stage`, and within each stage by `depth` and `reviewer`. Each group SHALL carry its file count and its four counts. A record that names no known stage SHALL be counted in an `unrecorded` group, never folded into a stage, and a missing or unknown depth or reader SHALL read `unrecorded` the same way. The JSON, text and HTML surfaces SHALL carry the same groups.

#### Scenario: Happy path — artifact gates and code reviews are told apart

- **GIVEN** a metrics corpus holding two records with `stage` `artifacts` (one `strict`/`agent`, one `lean`/`session`) and one with `stage` `code`
- **WHEN** `interlock report --json` runs
- **THEN** the review figures carry an `artifacts` group of two files, split into a `strict`/`agent` group and a `lean`/`session` group of one file each, and a `code` group of one file, each with its four counts

#### Scenario: Failure — a record from before this change is unrecorded, not a code review

- **GIVEN** a recognized record carrying no `stage`, `depth` or `reviewer`
- **WHEN** the report runs
- **THEN** that record is counted in the `unrecorded` group, and neither the `artifacts` group nor the `code` group counts it

#### Scenario: Edge case — the split leaves the totals unchanged

- **GIVEN** any corpus
- **WHEN** the report runs
- **THEN** the existing totals of raised, dismissed, dropped-by-quality and surviving findings equal the sums over the stage groups, `unrecorded` included

#### Scenario: Edge case — the three surfaces carry the same groups

- **GIVEN** the corpus of the happy path
- **WHEN** the report is printed as JSON, as text and as HTML
- **THEN** each surface names the same groups with the same file counts and the same four counts

#### Scenario: Edge case — an empty corpus has no groups

- **GIVEN** a metrics directory holding no recognized record
- **WHEN** `interlock report --json` runs
- **THEN** the stage groups are an empty object, and the text and HTML surfaces print no group line

#### Scenario: Edge case — a record that names its reader and not its depth

- **GIVEN** a recognized record with `stage` `artifacts`, `depth` `null` and `reviewer` `session`, as a gate line written after `ROUTING UNAVAILABLE` records it
- **WHEN** the report runs
- **THEN** it is counted in the `artifacts` group, under the reader group `unrecorded/session`

#### Scenario: Failure — a value outside the vocabulary is unrecorded, never a new group

- **GIVEN** a recognized record whose `stage` is `design` and whose `reviewer` is `human`
- **WHEN** the report runs
- **THEN** it is counted in the `unrecorded` stage group, the reviewer half of its reader group reads `unrecorded`, and no `design` group or `human` reader appears
