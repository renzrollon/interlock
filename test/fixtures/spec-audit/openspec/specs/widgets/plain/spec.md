# widgets/plain Specification

## Purpose

A fixture capability with no bound, no failure scenario and no edge case.

## Requirements

### Requirement: Widgets SHALL be listed

The service SHALL list every widget it holds.

#### Scenario: Happy path — a listing

- **GIVEN** two widgets
- **WHEN** the list is requested
- **THEN** both are returned

#### Scenario: Happy path — an empty listing

- **GIVEN** no widgets
- **WHEN** the list is requested
- **THEN** nothing is returned

### Requirement: Widgets are shown

Widgets appear in the console.

#### Scenario: Rendering

- **WHEN** the console opens
