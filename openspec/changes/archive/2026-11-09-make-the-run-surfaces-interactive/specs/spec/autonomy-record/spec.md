# Spec Delta

## ADDED Requirements

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
