# Spec Delta

## Purpose

Decides which directories under `openspec/changes/` are changes, for `interlock changes` and for every command that picks the change on its own when the caller names none.

## ADDED Requirements

### Requirement: A directory whose name starts with a dot SHALL never be listed or resolved as a change

`interlock changes` SHALL list every directory under `openspec/changes/` except `archive` and any directory whose name starts with a dot. A command that picks the change when none is named SHALL choose among the same set, so a dot-named directory left by another tool never turns one active change into an ambiguous choice.

#### Scenario: Happy path — a stray tool directory is not a change

- **GIVEN** `openspec/changes/` holds `add-auth/` and `.claude/`
- **WHEN** `interlock changes` runs
- **THEN** it lists `add-auth` only

#### Scenario: Failure — the stray directory no longer makes the default ambiguous

- **GIVEN** `openspec/changes/` holds `add-auth/` and `.claude/`
- **WHEN** `interlock validate` runs with no change name
- **THEN** it validates `add-auth`
- **AND** it does not report multiple active changes

#### Scenario: Edge case — only dot-named directories

- **GIVEN** `openspec/changes/` holds only `archive/` and `.cache/`
- **WHEN** `interlock changes` runs
- **THEN** it reports that there are no active changes
