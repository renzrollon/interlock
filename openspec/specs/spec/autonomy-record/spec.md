# spec/autonomy-record Specification

## Purpose

Keeps the autonomy record's history from being lost silently: a record that cannot be read is preserved beside a fresh one, and the loss is said where the command reports.

## Requirements

### Requirement: An unreadable autonomy record SHALL be preserved and named, never overwritten silently

When `interlock autonomy record` or `interlock autonomy clean` finds an autonomy record that exists but cannot be read or parsed, it SHALL do the following:

- move the file aside under a name carrying the time it was moved;
- write a fresh record;
- report on stderr that the record was unreadable, where it was moved, and that the counters restarted;
- with `--json`, carry the same text as a warning.

The exit code SHALL be the one the command would have returned for a fresh record. An absent record SHALL be read as empty, as today.

#### Scenario: Failure — a corrupt record

- **GIVEN** an autonomy record whose content is not valid JSON
- **WHEN** `interlock autonomy record review-artifacts --blockers 0` runs
- **THEN** the original bytes survive in a moved-aside file whose name the output gives
- **AND** stderr says the counters restarted, and the command exits 0

#### Scenario: Happy path — no record yet

- **GIVEN** no autonomy record
- **WHEN** `interlock autonomy record review-artifacts --blockers 0` runs
- **THEN** a record is written and no unreadable-record warning is raised

### Requirement: `interlock autonomy record <skill> --human-override` SHALL record a person's send-back against that skill alone

`interlock autonomy record <skill> --human-override` SHALL count one run and one human override for the named skill, set its consecutive clean count to zero, and move it from `L3` to `L2` when it stood at `L3`. It SHALL change no other skill's entry and SHALL count no blocker, whatever `--blockers` says beside it. It SHALL print the skill's level and clean count and exit 0. A test SHALL run the CLI line itself against a scratch state home.

#### Scenario: Happy path — a send-back takes an autonomous skill back to the human-in-the-loop level

- **GIVEN** a scratch state home whose record holds `spec` at `L3` with a consecutive clean count above zero
- **WHEN** `interlock autonomy record spec --human-override` runs
- **THEN** the record holds `spec` at `L2` with a consecutive clean count of zero, one more run and one more human override than before
- **AND** it prints the line for `spec` with its level and its clean count against the CLI's own needed count, and exits 0

#### Scenario: Failure — a blocker count beside the flag is not counted, and no upstream skill is touched

- **GIVEN** a record holding `review-artifacts` and `explore` entries with clean counts above zero
- **WHEN** `interlock autonomy record review-artifacts --human-override --blockers 2` runs
- **THEN** the `review-artifacts` entry counts one human override and no blocker caught
- **AND** the `explore` entry is byte for byte what it was

#### Scenario: Edge case — a skill with no entry yet

- **GIVEN** a scratch state home with no autonomy record
- **WHEN** `interlock autonomy record spec --human-override` runs
- **THEN** the record is created holding `spec` at `L2` with one run, one human override and a clean count of zero
- **AND** it exits 0
