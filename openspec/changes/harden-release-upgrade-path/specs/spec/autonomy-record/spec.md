## Purpose

Keeps the autonomy record's history from being lost silently: a record that cannot be read is preserved beside a fresh one, and the loss is said where the command reports.

## ADDED Requirements

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
