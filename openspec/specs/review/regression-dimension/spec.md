# review regression-dimension Specification

## Purpose
TBD

## Requirements

### Requirement: `review-code` SHALL bundle a `regression` dimension brief

The skill SHALL ship `skills/review-code/dimensions/regression.md`, opening with `# Dimension: regression`, emitting the shared finding schema with the coverage ledger, under `"dimension": "regression"`, and resolvable by `--dimensions regression` like every bundled name.

#### Scenario: Happy path — the brief resolves

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** `regression.md` exists, opens with `# Dimension: regression`, and is in the list of names the skill and `interlock review brief` resolve

#### Scenario: Failure — a misspelled name

- **GIVEN** `--dimensions regresion`
- **WHEN** the review resolves its dimensions
- **THEN** it stops naming `regresion` and listing every bundled name, and runs nothing

### Requirement: The brief SHALL require every changed start, transition and registration to be paired with its end

For each state the change starts, enters, registers or widens (a run, a session, a listener, a timer, a lock, a live flag), the brief SHALL require the reviewer to enumerate every path that ends it, in or outside the diff, to say whether any trigger now starts it with no path that ends it, and to name what stays live and who reads it meanwhile.

#### Scenario: Happy path — the PR #28 lifecycle question is asked

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries the tokens `every end path`, `starts`, `stays live` and `who reads it`

#### Scenario: Edge case — an end path outside the diff counts

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief says an end path in an unchanged line or an unchanged file is enumerated like one in the diff

### Requirement: The brief SHALL ask for deleted or weakened tests, measured spec promises and text made stale outside the hunks

The brief SHALL require the reviewer to name each deleted or weakened test and whether the behaviour it protected still holds; to measure any size, width, count or duration a living requirement promises for the changed behaviour, citing the measurement; and to find text outside the changed lines (descriptions, comments, help, docs) that the change made untrue.

#### Scenario: Happy path — the three checks are present

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `deleted or weakened test`, `measure`, and `outside the changed lines`

#### Scenario: Failure — a measured claim with no measurement

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief says a finding about a size, width, count or duration without a measurement is a suggestion at most

### Requirement: The brief SHALL ask what each removed line protected

For every line the diff deletes or replaces, the brief SHALL require the reviewer to name the invariant or behaviour that line enforced and where the new code re-establishes it, with its `path:line`, and to raise a finding when a removed protection is re-established nowhere. Because the scope lists only lines that remain, the brief SHALL tell the reviewer to read the deletions from the diff against the base the scope names.

#### Scenario: Happy path — the removed-behaviour question is asked

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `deletes or replaces`, `invariant` and `re-establish`

#### Scenario: Edge case — deletions are read from the diff, on either review path

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `git diff` and `the base the scope names`
- **AND** it carries no `...HEAD`, since a ship run's review judges a working tree that is not yet committed

#### Scenario: Failure — the earlier checks are displaced

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** every token the capability's other requirements name is still found in it
