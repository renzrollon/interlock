# ship-run Specification

## Purpose

Records each `/interlock:ship` run as an append-only transcript so a halt can be reconstructed, queried, and later gated on completeness — without turning Interlock into a session host or replacing the wave loop.

## Requirements

### Requirement: Append-only trajectory per ship run

The system SHALL write one append-only JSON Lines file per `/interlock:ship` run that records, in order, every wave-state action, every load-bearing CLI exit, every agent spawn the workflow requested, and every verify judgement. The file MUST NOT be rewritten or truncated by a later step. A torn final line MUST cost at most that one record, not earlier records. The trajectory MUST be a different artifact from `.claude/learning/outcomes.jsonl`, which remains one summary line per planning→ship attempt and MUST NOT become this transcript.

#### Scenario: Wave mutations append rather than overwrite history

- **WHEN** `interlock wave-state` creates a run and then records a batch result that writes `.claude/ship/state.json`
- **THEN** the trajectory file contains a run-start event plus a wave-action event for that mutation, and the previous lines are still present

#### Scenario: Outcomes corpus stays a one-line summary

- **WHEN** a ship run halts and records an outcome
- **THEN** `.claude/learning/outcomes.jsonl` gains exactly one summary line for the attempt, and the trajectory file still holds the per-step events for that run

### Requirement: Event types cover a reconstructable walk

Each trajectory line MUST be a JSON object with a schema identifier, timestamp, run id, change name, monotonic sequence number, and a `type` of `run-start`, `wave-action`, `cli-exit`, `agent-spawn`, `verify-judgement`, `run-halt`, or `run-complete`. A `wave-action` event MUST include the state-machine `action` (`run-batch`, `test-wave`, `verify`, `replan`, `done`, `halt`) and enough cursor data to identify the wave and batch. A `cli-exit` event MUST include the subcommand and numeric exit code. An `agent-spawn` event MUST include the agent label and requested model. A `verify-judgement` event MUST include the verify context (`inter-wave` or `final`), whether the verdict halted, and the reason string. Payload fields MUST be copied by name so handing the writer a fat object cannot leak suite logs, diffs, or finding bodies into the log.

The change name on an event MUST be derived from the run's own state rather than supplied per invocation. The run state established when the run is created MUST carry the change name for the life of the run, the same way the run id does, and every event appended on behalf of that run MUST take the name from there. A per-invocation override MAY remain accepted for a state that predates this rule, but a caller that omits it MUST still produce correctly-named events whenever the state carries a name. An event for which no name is available from either source MUST record the absent-name placeholder rather than fail the append — losing a trajectory label MUST NOT lose the run.

#### Scenario: Halted run lists the walk that produced the halt

- **WHEN** a run halts because more than two task failures accumulated
- **THEN** the trajectory contains ordered `wave-action` / `agent-spawn` / `cli-exit` events up through a `run-halt` whose reason names the task-failure halt, and a reader can replay the wave-state actions in the same order without reading git history

#### Scenario: Verify judgement is logged without the suite transcript

- **WHEN** `interlock verify judge` returns a halt for a red unit suite in the `final` context
- **THEN** the trajectory contains a `verify-judgement` line with `context=final`, `halt=true`, and the CLI reason, and does not contain the raw test-runner stdout

#### Scenario: Serialized remaining batches log every implementer once

- **WHEN** a wave has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** the trajectory contains one `agent-spawn` per task across `remainingBatches`, and a subsequent `record-batch --write-state` of batch 0 does not append duplicate spawns for later batches

#### Scenario: Happy path — every event of a run carries the run's change name

- **GIVEN** a run created for change `add-widget-export` whose creating call named the change
- **WHEN** the run walks a wave, records a batch, spawns implementers, judges a verification, and closes
- **THEN** every appended event — `run-start`, `wave-action`, `cli-exit`, `agent-spawn`, `verify-judgement`, and the closing event — carries `add-widget-export` as its change name
- **AND** no event carries the absent-name placeholder

#### Scenario: Failure — a caller that omits the per-invocation name still produces named events

- **GIVEN** a run state that carries the change name `add-widget-export`
- **WHEN** a wave-state mutation is invoked without any per-invocation change argument
- **THEN** the appended `wave-action` and `cli-exit` events both carry `add-widget-export`
- **AND** the events are not labelled with the absent-name placeholder

#### Scenario: Edge case — a state carrying no name records the placeholder rather than failing

- **GIVEN** a run state written before the change name was carried on state, and an invocation that supplies no per-invocation name either
- **WHEN** a wave-state mutation appends its events
- **THEN** the events are written with the absent-name placeholder as the change name
- **AND** the append succeeds and the run continues

### Requirement: Session-query over trajectories

The system SHALL expose a read-only CLI to list ship runs, show one run's events in order, and filter by change name, event type, and whether the run halted. Query MUST tolerate a torn final line and unreadable lines the same way the outcomes reader does: skip the bad line, keep the rest, report skipped line numbers. Query MUST NOT interpret events as a new state machine — it reports the log.

#### Scenario: List and show a halted run

- **WHEN** an operator runs the list command after two ship attempts, one of which halted
- **THEN** the list identifies both run ids and which halted, and show for the halted id prints its events in sequence order

#### Scenario: Filter by event type

- **WHEN** an operator queries one run for `verify-judgement` events only
- **THEN** the output contains those events and omits `agent-spawn` and `wave-action` events

### Requirement: Reconstructability is a gate invariant

After the trajectory writer exists, the system SHALL treat a missing, unwritable, or incomplete trajectory as a loud halt of the ship run — not a reported no-op. Completeness MUST include contiguous sequence numbers from 1, a `run-start`, a matching `run-halt` or `run-complete`, and a logged `cli-exit` for every `wave-state` and `verify judge` invocation that ran. This gate MUST NOT apply to `.claude/learning/outcomes.jsonl`. Until this gate is implemented, the writer MAY record without halting so the log can land first.

#### Scenario: Unwritable trajectory halts the run

- **WHEN** the reconstructability gate is enabled and the CLI cannot append the next trajectory line (missing directory permissions, full disk, or absent run id on a wave-state mutation)
- **THEN** the command exits non-zero with a reconstructability reason, and the workflow treats that as a ship halt

#### Scenario: Gap in sequence numbers fails the gate

- **WHEN** the reconstructability gate is enabled and a run's log has sequence numbers 1, 2, 4
- **THEN** closing the run (halt or complete) exits non-zero and does not emit `run-complete`

#### Scenario: Outcomes write failure still does not halt

- **WHEN** the reconstructability gate is enabled and appending to `.claude/learning/outcomes.jsonl` fails
- **THEN** the ship run still finishes its halt or complete path; only the trajectory gate may stop it for bookkeeping