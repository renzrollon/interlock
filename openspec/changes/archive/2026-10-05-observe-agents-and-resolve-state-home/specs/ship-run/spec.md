## MODIFIED Requirements

### Requirement: Event types cover a reconstructable walk

Each trajectory line MUST be a JSON object with a schema identifier, timestamp, run id, change name, monotonic sequence number, and a `type` of `run-start`, `wave-action`, `cli-exit`, `agent-spawn`, `agent-result`, `verify-judgement`, `run-halt`, or `run-complete`. A `wave-action` event MUST include the state-machine `action` (`run-batch`, `test-wave`, `verify`, `replan`, `done`, `halt`) and enough cursor data to identify the wave and batch. A `cli-exit` event MUST include the subcommand and numeric exit code. An `agent-spawn` event MUST include the agent label and requested model. An `agent-result` event MUST include the agent label, the source of the observation (the host's envelope or the agent's transcript), the host's subtype and error flag, its bounded errors, its permission denials, its session identifier, its turn count, the routed model, the turn-scoped and session-scoped models with the scope the verdict read, whether a substitution was found, whether the structured result was missing, the agent's own usage with cache tiers kept apart, and the host's cost estimate, each absent when unobserved and never zero. A `verify-judgement` event MUST include the verify context (`inter-wave` or `final`), whether the verdict halted, and the reason string. Payload fields MUST be copied by name so handing the writer a fat object cannot leak suite logs, diffs, or finding bodies into the log. Adding `agent-result` MUST NOT change the schema identifier: a trajectory written without it MUST still list, check and render.

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

#### Scenario: Happy path — an agent result is recorded beside its spawn

- **GIVEN** a runner lane whose host reported subtype `success`, one served model, no denials and a session identifier
- **WHEN** the batch is recorded
- **THEN** the trajectory carries an `agent-result` for that label with the source `envelope`, the served model, the session identifier and the usage with its cache tiers apart
- **AND** the event carries no field that was not copied by name

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

#### Scenario: Edge case — a trajectory without agent results still reconstructs

- **GIVEN** a trajectory written before the `agent-result` type existed
- **WHEN** it is listed, checked and shown
- **THEN** it is reconstructable on the same terms as before and no problem names the absent type

### Requirement: A host without cache accounting SHALL record unknown, not zero

Where a host's runtime exposes no cache accounting and the plugin's recorder hooks recorded nothing, the cache figures SHALL be recorded as absent and the host's inability to supply them SHALL be visible to a reader of the run's summary as well as to a reader of the trajectory. Where the recorder hooks recorded every briefed spawn of a wave, that wave's cache figures SHALL be the recorded sums and the run SHALL say its cache accounting was observed through the hooks; where they recorded some but not all, the affected waves SHALL be recorded as absent and the run SHALL say how many agents went unrecorded. A host that cannot measure cache behaviour MUST NOT record `0`, and MUST NOT omit the figures in a way indistinguishable from a run that measured and found none.

This SHALL be stated as a declared difference between hosts, not left to be inferred from missing data. A run whose host cannot report cache figures SHALL say so in its summary, on the same footing as any other degradation.

#### Scenario: Happy path — a host with cache accounting records real figures

- **GIVEN** a run on a host whose usage envelope carries cache-read and cache-creation fields
- **WHEN** the run closes
- **THEN** the recorded cache figures are present and non-negative

#### Scenario: Happy path — the recorder hooks supply what the runtime cannot

- **GIVEN** a run on the Workflow host whose every briefed spawn was recorded by the recorder hooks
- **WHEN** the run closes
- **THEN** the recorded cache figures are present per wave and for the run
- **AND** the receipt says the accounting was observed through the hooks, and the summary carries no not-reported line

#### Scenario: Failure — a host without cache accounting is spoken, not silently empty

- **GIVEN** a run on a host whose runtime exposes only a cumulative scalar with no cache decomposition, and no recorded agent usage
- **WHEN** the run closes
- **THEN** the cache figures are recorded as absent
- **AND** the run's summary names the host's inability to report them
- **AND** a reader can distinguish this from a run that measured and found no cache activity

#### Scenario: Edge case — a host that reports cache fields inconsistently degrades rather than failing

- **GIVEN** a run whose host supplies cache fields for some spawns and omits them for others
- **WHEN** the affected waves close
- **THEN** those waves record their cache figures as absent
- **AND** the run continues without failing on account of the missing measurement

#### Scenario: Edge case — a partial recording names its count

- **GIVEN** a Workflow-host run in which the recorder hooks recorded two of three briefed spawns
- **WHEN** the run closes
- **THEN** the wave with the unrecorded spawn records absent cache figures
- **AND** the summary says `2` of `3` agents were recorded as unrecorded in its partial line, and the exit code is unchanged by it

## ADDED Requirements

### Requirement: A run SHALL record the surface it ran on, the state home it wrote to and the working directory it ran in

The `run-start` event SHALL carry the run's surface (`main`, `linked-worktree`, `lane-worktree` or `unknown`), the absolute state home its corpora were written to, and the absolute working directory it ran in; the receipt SHALL carry the surface and the state home. A trajectory written before these fields existed SHALL read them as absent, and a reader SHALL count such a run as surface-unrecorded rather than as any named surface.

#### Scenario: Happy path — a linked-worktree run records three paths

- **GIVEN** a run started in `/r/.claude/worktrees/w1`, a linked worktree of `/r`
- **WHEN** the run starts and closes
- **THEN** the `run-start` event carries surface `linked-worktree`, state home `/r` and working directory `/r/.claude/worktrees/w1`
- **AND** the receipt carries the surface and the state home

#### Scenario: Failure — an unresolved surface is recorded as unknown

- **GIVEN** a run whose state home could not be resolved
- **WHEN** the run starts
- **THEN** the `run-start` event carries surface `unknown` and a state home equal to the working directory

#### Scenario: Edge case — an older trajectory

- **GIVEN** a trajectory whose `run-start` event carries no surface
- **WHEN** a reader partitions runs by surface
- **THEN** that run is counted as unrecorded and under no named surface
