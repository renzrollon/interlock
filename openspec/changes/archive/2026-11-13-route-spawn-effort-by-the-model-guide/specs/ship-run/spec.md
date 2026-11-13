# Spec Delta

## ADDED Requirements

### Requirement: An agent-spawn event SHALL record the effort the spawn was given

Every `agent-spawn` event appended on the live run path SHALL carry an `effort` field: the level the spawn was given, or `inherit` when it carried none. An implementer lane's value SHALL be derived from the lane's tasks by the rule dispatch uses. The field records what was asked for, bounded the way every other free-text field is, never what a host applied. Leading and trailing whitespace is removed and each run of whitespace is collapsed to one space before the bound is applied. A string still longer than 40 characters after that SHALL be stored as the first 39 characters of that trimmed string plus an ellipsis (`…`), 40 characters in all. It SHALL NOT be dropped and SHALL NOT be replaced with null. A value that is not a string, or that is empty after that trim, SHALL be recorded as `effort: null`, the key present. A reader SHALL NOT treat that null as a level or as `inherit`. The schema tag SHALL not change. A row with no `effort` key SHALL be read as not recorded, never as `inherit` and never as null.

#### Scenario: Happy path — a run's rows carry the effort each spawn was given

- **GIVEN** a run with a tier-1 lane, an inter-wave verify and a commit
- **WHEN** the run completes and `interlock run-log query` lists its `agent-spawn` events
- **THEN** the lane's row carries the tier-1 effort, the verify row carries the published verify effort, and the commit row carries `inherit`
- **AND** the lane's value and the verify value each equal the `effort` the step that emitted that spawn carried, and the commit row's `inherit` records a spawn that carried no effort

#### Scenario: Failure — a lane's row and its dispatched spawn cannot disagree

- **GIVEN** a multi-task lane whose first task is tier 1 and whose hardest task is tier 4
- **WHEN** the lane is dispatched and its `agent-spawn` row is appended
- **THEN** the row's `effort` is the tier-4 effort the spawn carried, not the first task's

#### Scenario: Failure — a failed append is still fatal

- **GIVEN** a live step whose `agent-spawn` append fails
- **WHEN** the step finishes
- **THEN** it halts as it did before this field existed, and the field changes neither the halt nor its reason

#### Scenario: Edge case — an older trajectory reads as not recorded

- **GIVEN** a trajectory written by a release before this field, whose `agent-spawn` rows have no `effort` key
- **WHEN** `interlock run-log check` and `interlock run-log query` read it
- **THEN** the check's verdict is what it was before, because the field is not part of reconstructability
- **AND** the queried rows have no `effort` key, and no reader prints `inherit` for them

#### Scenario: Edge case — an over-long effort is truncated, and a value that is not a string is null

- **GIVEN** one `agent-spawn` source whose `effort` is 41 `x` characters, and another whose `effort` is not a string, is empty, or is only whitespace
- **WHEN** each event is built
- **THEN** the 41-character effort is stored as 39 `x` characters plus an ellipsis (`…`), not dropped and not null
- **AND** the other row carries `effort: null`, the key present, which is not a level and not `inherit`
