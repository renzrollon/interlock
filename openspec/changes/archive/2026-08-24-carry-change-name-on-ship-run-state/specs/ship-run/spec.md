## MODIFIED Requirements

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
