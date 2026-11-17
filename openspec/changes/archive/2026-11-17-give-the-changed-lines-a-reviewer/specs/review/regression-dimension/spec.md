# Spec Delta

## ADDED Requirements

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
