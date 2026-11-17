# review/language-dimension Specification

## Purpose
States what the bundled `language` review brief asks of its reviewer, so that the correctness of the changed lines has one named owner among the review dimensions.

## Requirements

### Requirement: The `language` brief SHALL own the correctness of the changed lines

The brief `skills/review-code/dimensions/language.md` SHALL tell its reviewer that it owns whether the changed lines are correct, SHALL require it to read every changed hunk and the function that encloses it, and SHALL ask of each changed line what input, state, timing or platform makes it wrong. No other bundled brief SHALL make that claim.

#### Scenario: Happy path — the brief claims the changed lines

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `You own`, `changed lines`, `function that encloses` and `makes this line wrong`
- **AND** it names the defects `off-by-one`, `await` and `swallowed`

#### Scenario: Failure — a second brief claims them

- **GIVEN** the nine shipped briefs
- **WHEN** the skill suite runs
- **THEN** `You own` is found in `language.md` and in no other brief

#### Scenario: Edge case — the briefs that defer the question still defer it

- **GIVEN** the shipped `regression` and `blast-radius` briefs
- **WHEN** the skill suite runs
- **THEN** each still carries `Another reviewer owns`
- **AND** the `technical-lead` brief, whose production-risk bullet names defects a changed line can hold, now carries it too

#### Scenario: Edge case — the name and the heading are unchanged

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** its file is `language.md` and its first line is `# Dimension: language & framework`

### Requirement: The brief SHALL bound what it raises on an unchanged line

The brief SHALL tell the reviewer that a defect in an unchanged line of the enclosing function is raised at its own severity only when a changed line reaches it or relies on it, with that changed line named, and that any other defect in an unchanged line is a suggestion at most.

#### Scenario: Happy path — the bound is stated

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `reaches it or relies on it` and `suggestion at most`

#### Scenario: Failure — the bound is dropped

- **GIVEN** a copy of the brief with the sentence that carries `suggestion at most` removed
- **WHEN** the same check the skill suite uses runs over that copy
- **THEN** it reports the missing token

### Requirement: The brief SHALL name pitfalls in the detected language's own terms

The brief SHALL tell the reviewer to determine the repository's language before reviewing and SHALL list language pitfalls without presenting one framework's vocabulary as the checklist. It SHALL keep type safety and hot-path performance. It SHALL NOT carry the test-quality check, which the `technical-lead` brief owns.

#### Scenario: Happy path — pitfalls, type safety and performance are asked

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `Language pitfalls`, `Type safety` and `hot path`
- **AND** it names `mutable default`, `float equality` and `not closed`

#### Scenario: Failure — one framework's vocabulary

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** it finds none of `React`, `prop drilling` and `re-render`

#### Scenario: Edge case — test quality has left this brief

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** it finds no `Test quality`
