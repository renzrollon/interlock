## Purpose

Delta for the policy file.

## ADDED Requirements

### Requirement: The policy file SHALL declare always-human-review paths

DELTA-ONLY-BODY-SENTINEL: a second path list SHALL be read from the base commit.

#### Scenario: Happy path — a listed prefix

- **GIVEN** a listed prefix
- **WHEN** a change touches a path under it
- **THEN** a person is asked

## MODIFIED Requirements

### Requirement: The policy file SHALL NOT  be able to change the   survival arithmetic

DELTA-MODIFIED-BODY-SENTINEL: the restated rule.

#### Scenario: Failure — a band key in either list

- **GIVEN** a list item that is a band key
- **WHEN** it is parsed
- **THEN** it is reported and not read as a path
