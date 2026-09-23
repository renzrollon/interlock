## MODIFIED Requirements

### Requirement: Reconstructability is a gate invariant

The system SHALL treat a missing, unwritable, or incomplete run trajectory as a loud halt of the ship run — not a reported no-op and not a warning that lets the step continue. Completeness MUST include contiguous sequence numbers from 1, a `run-start`, a matching `run-halt` or `run-complete`, and a logged `cli-exit` for every `wave-state` and `verify judge` invocation that ran.

A failed append of a trajectory event on the live `interlock run` path — including a failed `wave-action` / paired `cli-exit` write after run start, record-batch, record-verify, or replan, and a failed `agent-spawn`, `cli-exit`, `run-start`, `run-receipt`, `run-halt`, or `run-complete` write — SHALL halt that step before any subsequent task tick or commit. The `wave-state` command path already exits non-zero on a failed trajectory append; the live run path SHALL do the same.

This gate MUST NOT apply to `.claude/learning/outcomes.jsonl` or to review metrics. A failed write there is reported and MUST NOT change the run's exit code.

#### Scenario: Happy path — a successful trajectory append lets the step continue

- **GIVEN** a live `interlock run` step whose next trajectory event writes successfully
- **WHEN** the step finishes recording
- **THEN** the run continues to the next action
- **AND** the trajectory contains the new event with the next contiguous sequence number

#### Scenario: Unwritable trajectory halts the run

- **GIVEN** the CLI cannot append the next trajectory line (missing directory permissions, full disk, or absent run id on a wave-state mutation)
- **WHEN** the live `interlock run` path or the `wave-state` command attempts that append
- **THEN** the command or step exits non-zero with a reconstructability reason
- **AND** the workflow treats that as a ship halt
- **AND** no subsequent task tick or commit of that step runs

#### Scenario: Failure — a failed record-batch trajectory append does not tick or commit

- **GIVEN** a live `interlock run record-batch` whose wave-action or paired cli-exit append fails after the batch result was recorded in memory
- **WHEN** the step handles that write failure
- **THEN** it SHALL halt before ticking tasks and before committing
- **AND** it SHALL NOT warn-and-continue

#### Scenario: Gap in sequence numbers fails the gate

- **GIVEN** a run's log has sequence numbers 1, 2, 4
- **WHEN** closing the run (halt or complete)
- **THEN** the close exits non-zero and does not emit `run-complete`

#### Scenario: Outcomes write failure still does not halt

- **GIVEN** appending to `.claude/learning/outcomes.jsonl` fails
- **WHEN** the ship run finishes its halt or complete path
- **THEN** the ship run still finishes that path
- **AND** only the trajectory gate may stop it for bookkeeping
- **AND** the outcome write failure is reported rather than silent

#### Scenario: Edge case — a failed live-path agent-spawn append is fatal, a failed outcome append is not

- **GIVEN** a live `interlock run` step that both fails to append an `agent-spawn` event and later fails to append an outcome record
- **WHEN** those two failures are handled
- **THEN** the `agent-spawn` failure SHALL halt the step
- **AND** the outcome failure, on its own, SHALL NOT halt
