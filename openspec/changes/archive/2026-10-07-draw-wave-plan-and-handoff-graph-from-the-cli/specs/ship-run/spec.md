## MODIFIED Requirements

### Requirement: Session-query over trajectories

The system SHALL expose a read-only CLI to list ship runs, show one run's events in order, and filter by change name, event type, and whether the run halted. Query MUST tolerate a torn final line and unreadable lines the same way the outcomes reader does: skip the bad line, keep the rest, report skipped line numbers. Query MUST NOT interpret events as a new state machine — it reports the log.

Show SHALL also draw a run: with `--format board` as a text handoff graph and with `--format mermaid` as a `flowchart TD`, each built from the same records in sequence order, with `--columns <n>` bounding the board's width. The drawn forms SHALL join the run's own state and manifest, read from the state home beside the trajectory, only when each exists and names the same run id, and SHALL name in their header each source they lacked — absent, or naming another run. They SHALL interpret no new state machine either: a packet status, an audit verdict, a briefing hash and an exit code are printed as recorded, and a spawn with no recorded result is printed as such. The exit code of show SHALL be the same with and without `--format`, and `--format` SHALL be refused beside `--json`.

#### Scenario: List and show a halted run

- **WHEN** an operator runs the list command after two ship attempts, one of which halted
- **THEN** the list identifies both run ids and which halted, and show for the halted id prints its events in sequence order

#### Scenario: Filter by event type

- **WHEN** an operator queries one run for `verify-judgement` events only
- **THEN** the output contains those events and omits `agent-spawn` and `wave-action` events

#### Scenario: Happy path — show draws the halted run as a board and as a flowchart

- **GIVEN** a state home holding the real halted run's trajectory and its state, and no manifest
- **WHEN** an operator runs show for that run id with `--format board`
- **THEN** the output opens with a header naming the run, the change, the record count, `state.json: this run` and `run.json: absent`
- **AND** the nodes follow sequence order and the transition to wave position 1 carries the four recorded packet statuses and audit verdicts
- **AND** `--format mermaid` for the same run opens with `flowchart TD` and a `%% source:` comment

#### Scenario: Failure — a state naming another run is named and not joined

- **GIVEN** a state home whose state file carries a different run id from the trajectory shown
- **WHEN** an operator runs show for the trajectory's run id with `--format board`
- **THEN** the header reads `state.json: another run` with that id
- **AND** no transition carries a packet status, and the exit code is 0

#### Scenario: Edge case — a run never recorded, and the flags that contradict

- **WHEN** an operator runs show for a run id with no trajectory, with `--format board`
- **THEN** the output is the same none-recorded line show prints without `--format`, and the exit code is 0
- **AND** show with `--format board --json` exits non-zero naming the two flags as mutually exclusive
- **AND** show with `--format wat` exits non-zero naming `board` and `mermaid`
