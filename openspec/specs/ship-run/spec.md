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

### Requirement: A run SHALL record one receipt event carrying what it observed

The system SHALL append exactly one `run-receipt` event per ship run, at run close, for halted and clean runs alike. The receipt MUST carry, from what the orchestrator observed rather than from prose: the per-wave tally of succeeded, failed, and not-attempted tasks; whether the plan was reused or rebuilt and under which verdict; the plan fingerprint hash; review blocker and warning counts when a review ran; remediation rounds consumed; the count of skipped verifications and how many were skipped for cap exhaustion; the count of unresolved errors carried past a wave; the leftover task ids; the halt reason or the fact of completion; the commit identifier when a commit was made; and the run's degradation list.

The degradation list MUST be the same list the run reports to its reader, produced once and used for both, so the banner a human reads and the record a later process reads cannot disagree. The leftover task ids MUST likewise be one list, reported to the reader and recorded in the receipt, on a halted run as well as a clean one.

The leftover task ids are every task still unticked at close, which is not the same set as the tasks that failed: a run that halts at a verification checkpoint leaves whole waves that never ran and therefore never failed, and those are precisely the tasks a later reader has to be told about. The tick state MUST be read from the change's own task list at close rather than inferred from the run's failure list. A run that cannot read that list MUST leave the field unobserved rather than empty, because an empty list claims the run finished everything.

The receipt MUST be written with fields copied by name, like every other event type, so handing the writer the run's whole summary object cannot leak prompts, diffs, finding bodies, or suite output into the trajectory.

#### Scenario: Happy path — a clean run records a complete receipt

- **GIVEN** a run that executed three waves, reused its plan, ran no review, consumed no remediation rounds, and committed
- **WHEN** the run reaches its close
- **THEN** the trajectory contains exactly one `run-receipt` event carrying the three wave tallies, the plan-reuse verdict, the fingerprint hash, zero remediation rounds, an empty leftover list, the commit identifier, and the run's degradation list

#### Scenario: Failure — a halted run records a receipt naming the halt and what was left

- **GIVEN** a run that halts partway through its second wave with two tasks unticked
- **WHEN** the run closes on its halt path
- **THEN** the trajectory contains one `run-receipt` whose halt reason names the halt and whose leftover task ids list both unticked tasks
- **AND** the receipt is present even though no commit was made

#### Scenario: Edge case — a halt at a checkpoint lists the waves that never ran

- **GIVEN** a run that halts at the verification checkpoint after its first wave, leaving every task of the later waves unticked and unattempted
- **WHEN** the run closes on its halt path
- **THEN** the receipt's leftover task ids list those tasks, none of which failed
- **AND** the run reports the same list to its reader rather than reporting nothing left behind

#### Scenario: Edge case — a fat summary object cannot leak content into the receipt

- **GIVEN** a run whose summary object also holds a review result with finding bodies and a verification result with suite output
- **WHEN** the receipt is appended from that object
- **THEN** the written event contains only the named receipt fields
- **AND** it contains no finding text, no suite transcript, and no diff content

### Requirement: A run SHALL record the commit identifier next to the run

When a ship run creates a commit, the receipt SHALL carry that commit's identifier. A run that made no commit MUST record the absence explicitly rather than omitting the field, so that "did not commit" and "we never found out" remain distinguishable.

This exists so a later process can ask what happened to the changed files afterwards. That question cannot be asked at all from a commit identifier that only ever reached standard output.

#### Scenario: Happy path — a committing run records its commit identifier

- **GIVEN** a run whose commit step reports success with an identifier
- **WHEN** the receipt is written
- **THEN** the receipt carries that identifier

#### Scenario: Failure — a run stopped before committing records no-commit explicitly

- **GIVEN** a run invoked so that it stops after its waves without committing
- **WHEN** the receipt is written
- **THEN** the receipt records that no commit was made, distinctly from a run whose commit outcome was never observed

#### Scenario: Edge case — a commit step that reported failure does not yield an identifier

- **GIVEN** a run whose commit step reports failure
- **WHEN** the receipt is written
- **THEN** the receipt records the absence of a commit identifier and does not carry a fabricated or partial one

### Requirement: A missing receipt SHALL NOT by itself make a run unreconstructable

The reconstructability check SHALL recognize `run-receipt` as a valid event type and SHALL NOT require one for a run to pass. A run that halted before reaching its own close could not have written a receipt, and refusing to reconstruct such a run would withhold exactly the trajectory a reader most needs.

The absence of a receipt on an otherwise-closed run MUST remain observable to a reader, because it means the run did not reach its own close.

#### Scenario: Happy path — a run with a receipt passes reconstructability

- **GIVEN** a closed run whose trajectory has contiguous sequence numbers, a run-start, a receipt, and a closing event
- **WHEN** the reconstructability check runs
- **THEN** it reports the run reconstructable

#### Scenario: Failure — a run that died before its close still reconstructs

- **GIVEN** a run whose trajectory has a run-start and a closing event but no receipt
- **WHEN** the reconstructability check runs
- **THEN** the check does not report a problem on account of the absent receipt
- **AND** a reader listing the run can still tell that no receipt was recorded

#### Scenario: Edge case — a second receipt on one run is reported

- **GIVEN** a trajectory that somehow carries two `run-receipt` events for the same run
- **WHEN** the reconstructability check runs
- **THEN** it reports the duplicate as a problem, because a run has one close and therefore one receipt

### Requirement: A trajectory file SHALL be scorable without the repository beside it

After this change a trajectory file SHALL carry enough observed facts that a reader on a different machine, with no version-control checkout, no change artifacts, and no test suite available, can determine what the run did and what it degraded on. Facts that cannot travel MUST be represented by an identifier rather than silently omitted: the executed plan is represented by its fingerprint hash, not by its contents.

#### Scenario: Happy path — a copied trajectory answers the run's outcome

- **GIVEN** a trajectory file copied to a machine with no checkout of the repository it came from
- **WHEN** a reader lists and shows that run
- **THEN** the reader can state the change name, whether it halted and why, the per-wave tallies, the degradations, and the commit identifier without consulting version control

#### Scenario: Failure — an absent fact reads as unknown, not as clean

- **GIVEN** a run that halted before its review step ran
- **WHEN** the receipt is read from a copied trajectory
- **THEN** the review counts read as not observed rather than as zero blockers

#### Scenario: Edge case — two runs of the same plan are identifiable as such

- **GIVEN** two trajectory files from runs that executed identical plans over identical artifacts
- **WHEN** their receipts are compared on a machine holding neither repository
- **THEN** their plan fingerprint hashes match
- **AND** neither receipt carries the plan's full contents

### Requirement: A recorded duration SHALL state what it measured

Where the trajectory records a duration on a CLI exit, that duration SHALL be the measured execution time of the command that wrote the event, and the specification SHALL state that this is what it is. It MUST NOT be presented as, or read as, the wall-clock time an agent spent on the corresponding turn — the command runs between agent turns and cannot observe them.

A duration the writer could not measure MUST be recorded as absent, not as zero.

Wave-level and run-level elapsed time SHALL be derived by a reader from event timestamps rather than recorded as an additional field, because the timestamps already carry it and a second recorded field could disagree with them.

#### Scenario: Happy path — a CLI exit carries its own measured execution time

- **GIVEN** a wave-state mutation that runs to completion
- **WHEN** its `cli-exit` event is appended
- **THEN** the event carries a non-negative measured duration for that command's execution

#### Scenario: Failure — an unmeasurable duration is absent rather than zero

- **GIVEN** an append path where the command's execution time was not measured
- **WHEN** the `cli-exit` event is appended
- **THEN** the duration field is absent
- **AND** it is not recorded as zero, which would assert an instantaneous command

#### Scenario: Edge case — wave elapsed time is derivable without a wave duration field

- **GIVEN** a run whose trajectory holds a wave's first and last events
- **WHEN** a reader is asked how long that wave took
- **THEN** the answer is derived from the two timestamps
- **AND** no recorded field claims a wave duration that could contradict them

### Requirement: A run SHALL record output-token spend per wave and per run

The trajectory SHALL record the output-token spend attributable to each wave and to the run as a whole, so that cost per shipped task is answerable from the corpus. The figure SHALL be sourced from the orchestrating runtime's own accounting, not estimated.

The figure is a cumulative process-wide delta over the wave's span. The specification SHALL state that it therefore includes the orchestrator's own turns as well as the implementers', and SHALL NOT claim per-agent or per-lane attribution, which the runtime does not expose.

#### Scenario: Happy path — each wave records a spend figure and the run records a total

- **GIVEN** a run of three waves on a host whose runtime exposes token accounting
- **WHEN** the run closes
- **THEN** the trajectory carries a spend figure for each of the three waves and a total for the run

#### Scenario: Failure — a fabricated per-lane attribution is not recorded

- **GIVEN** a wave that ran four lanes concurrently
- **WHEN** its spend is recorded
- **THEN** the recorded figure is the wave's aggregate
- **AND** no per-lane or per-agent figure is recorded or derived by division

#### Scenario: Edge case — a wave that spawned no agents records its spend as measured, not as zero by assumption

- **GIVEN** a wave whose only work was a verification with no implementer spawns
- **WHEN** its spend is recorded
- **THEN** the figure recorded is the measured delta across that wave's span, whatever it was
- **AND** it is not assumed to be zero on the grounds that no implementer ran

### Requirement: A host without token accounting SHALL record unknown, not zero

Where a host's runtime exposes no token accounting, the spend figures SHALL be recorded as absent and the host's inability to supply them SHALL be visible to a reader. A host that cannot measure spend MUST NOT record `0`, and MUST NOT omit the field in a way indistinguishable from a run that genuinely spent nothing.

The specification SHALL name this as a declared difference between hosts rather than leaving readers to infer it from missing data.

#### Scenario: Happy path — a host with accounting records real figures

- **GIVEN** a run on the default host, whose runtime exposes cumulative output-token spend
- **WHEN** the run closes
- **THEN** the recorded spend figures are present and non-negative

#### Scenario: Failure — a host without accounting records absence explicitly

- **GIVEN** a run on a host whose runtime exposes no token accounting
- **WHEN** the run closes
- **THEN** the spend figures are recorded as absent
- **AND** a reader can distinguish this from a run that measured and found no spend

#### Scenario: Edge case — a runtime that exposes accounting inconsistently degrades rather than throwing

- **GIVEN** a run whose runtime exposes token accounting at the start and stops exposing it partway through
- **WHEN** the later waves close
- **THEN** those waves record their spend as absent
- **AND** the run continues without failing on account of the missing measurement

### Requirement: A run's reported tallies SHALL be its recorded outcomes

Every per-wave tally a run reports — to the reader of its summary and to the record of its trajectory alike — SHALL count the outcomes the state machine recorded, not the outcomes the implementing agents reported for themselves. A run whose tallies are built from self-reports can produce a record that contradicts itself: all waves clean, beside a halt naming failures none of those waves admit to.

A tally SHALL be internally consistent with the run's own halt: if a run halted because recorded task failures accumulated past their cap, the failures counted in its tallies SHALL account for the failures named in its halt reason.

Where a task's recorded outcome is unavailable to the reporting path, the tally SHALL be reported as unobserved rather than as zero, on the same rule that governs every other receipt field: a count that was never read MUST NOT be presented as a count that came back clean.

#### Scenario: Happy path — a clean run's tallies match what was recorded

- **GIVEN** a run whose two waves recorded two and three succeeded tasks respectively, with no failures
- **WHEN** the run reports its summary and appends its receipt
- **THEN** both carry per-wave tallies of two succeeded and three succeeded, with no failures
- **AND** the two agree, having counted the same recorded outcomes

#### Scenario: Failure — an adjudicated task is counted as the failure it was recorded as

- **GIVEN** a run in which every implementing agent claimed success but the state machine recorded five tasks as failed for invalid handoff packets, halting the run on its failure cap
- **WHEN** the run reports its summary and appends its receipt
- **THEN** the per-wave tallies report those five as failures
- **AND** neither the summary nor the receipt reports a wave as clean while the halt reason names its tasks as failures

#### Scenario: Edge case — an unread outcome is reported as unknown, not as clean

- **GIVEN** a run that ended before the recorded outcomes for a wave could be read back
- **WHEN** the receipt is appended
- **THEN** that wave's tally reads as unobserved rather than as zero failures

### Requirement: The receipt SHALL record the paths the run's commit touched

The receipt SHALL carry the set of repository-relative paths the run's commit touched, observed from version control rather than reported by an agent. The set MUST be bounded and copied by name, like every other receipt field, so the run's summary object cannot leak diffs, file contents or handoff bodies into the trajectory through it.

The set MUST be tri-state. A run that made a commit whose paths were read records the observed set, which MAY be empty only if the commit genuinely touched nothing. A run that made no commit, whose commit step failed, or whose paths could not be read from version control MUST record the set as **unobserved**, not as empty — an empty set asserts a measured zero, and this indicator's whole value depends on that distinction surviving into the corpus.

The reason a set is unobserved MUST be recorded with it, so a reader of a copied trajectory can tell "no commit was made" from "a commit was made and its paths could not be read".

#### Scenario: Happy path — a committing run records the paths its commit touched

- **GIVEN** a run whose commit step reports success with an identifier and whose commit touched three files
- **WHEN** the receipt is written
- **THEN** the receipt carries those three repository-relative paths as the observed touched set

#### Scenario: Failure — a run that made no commit records the touched set as unobserved

- **GIVEN** a run that halted before its commit step, or was invoked so that it does not commit
- **WHEN** the receipt is written
- **THEN** the touched set is recorded as unobserved with a reason naming the absent commit
- **AND** it is not recorded as an empty set, which would assert that a commit touched nothing

#### Scenario: Edge case — an unreadable commit records unobserved rather than partial

- **GIVEN** a run whose commit identifier is present but whose touched paths could not be read from version control
- **WHEN** the receipt is written
- **THEN** the touched set is recorded as unobserved with a reason naming the failed read
- **AND** no partial or fabricated path list is recorded

#### Scenario: Edge case — a fat summary object cannot leak file content through the path set

- **GIVEN** a summary object whose commit result also carries diff hunks and per-file contents
- **WHEN** the receipt is appended from that object
- **THEN** the written event carries only the named path strings
- **AND** it carries no diff content and no file content

### Requirement: The receipt SHALL record the paths the executed plan predicted

The receipt SHALL carry the set of repository-relative paths the executed plan predicted its tasks would touch, taken from the plan the run actually executed. The set MUST be bounded and copied by name on the same terms as the touched set.

Path prediction is optional for a plan's task: a classifier that cannot predict which files a task will touch is required to say nothing rather than guess. The receipt MUST therefore also record whether the prediction was **complete** — whether every task in the executed plan declared its paths — so a later reader can tell a plan that predicted nothing extra from a plan that declined to predict. A run whose plan could not be read at all MUST record both the set and its completeness as unobserved.

#### Scenario: Happy path — a plan whose every task declared paths records a complete predicted set

- **GIVEN** a run whose executed plan has four tasks, each declaring the paths it expects to touch
- **WHEN** the receipt is written
- **THEN** the receipt carries the union of those declared paths as the predicted set
- **AND** it records the prediction as complete

#### Scenario: Failure — a plan with an unpredicting task records the prediction as incomplete

- **GIVEN** a run whose executed plan has four tasks, one of which declared no paths
- **WHEN** the receipt is written
- **THEN** the receipt carries the union of the declared paths of the other three
- **AND** it records the prediction as incomplete, naming that not every task declared paths

#### Scenario: Edge case — an unreadable plan records the predicted set as unobserved

- **GIVEN** a run whose executed plan could not be read back at close
- **WHEN** the receipt is written
- **THEN** the predicted set and its completeness are both recorded as unobserved
- **AND** neither is recorded as empty or as complete

### Requirement: A path set that exceeded its bound SHALL say so

Each recorded path set is bounded, and a set that reached its bound MUST be recorded as truncated rather than silently shortened. A truncated set is not the set the run touched or predicted, and any comparison made over it would be a comparison over a denominator nobody stated.

The bound itself SHALL live in code, not in this specification and not in any prose surface, so it cannot be re-argued per reading.

#### Scenario: Happy path — a set within its bound is not marked truncated

- **GIVEN** a run whose touched and predicted sets both fit within the recorded bound
- **WHEN** the receipt is written
- **THEN** neither set is marked truncated

#### Scenario: Failure — a set that reached its bound is marked truncated

- **GIVEN** a run whose commit touched more paths than the recorded bound admits
- **WHEN** the receipt is written
- **THEN** the touched set is marked truncated
- **AND** a reader can tell that the recorded paths are a prefix of the real set rather than the whole of it

#### Scenario: Edge case — truncation does not fail the append

- **GIVEN** a run whose predicted set far exceeds the bound
- **WHEN** the receipt is appended
- **THEN** the append succeeds with the bounded set and the truncation marker
- **AND** the run's close is not failed on account of the truncation

### Requirement: A run SHALL record cache-token figures alongside its output-token spend

The trajectory SHALL record, per wave and for the run as a whole, the cache-read and cache-creation input tokens attributable to that span, so that the cost of a re-written prefix is answerable from the corpus rather than inferred. Cache-creation figures SHALL be recorded split by the lifetime tier the host reports them under, because a prefix written for five minutes and one written for an hour are priced differently and a single total conflates them.

The figures SHALL be sourced from the host's own usage accounting, never estimated and never derived by subtraction from a total. Like the output-token figure they cover, they are a span aggregate that includes the orchestrator's own turns; the specification SHALL NOT claim per-agent or per-lane attribution, which no host exposes.

#### Scenario: Happy path — a wave records what it read from cache and what it wrote

- **GIVEN** a run on a host whose usage envelope carries cache accounting
- **WHEN** a wave closes
- **THEN** the trajectory carries that wave's cache-read token figure and its cache-creation token figure
- **AND** the cache-creation figure is recorded split by the lifetime tier the host reported

#### Scenario: Failure — a cache figure is not derived by arithmetic on other figures

- **GIVEN** a host that reports a total input-token figure but no cache breakdown
- **WHEN** the wave's figures are recorded
- **THEN** no cache-read or cache-creation figure is computed by subtracting one reported figure from another
- **AND** the cache figures are recorded as absent

#### Scenario: Edge case — a wave that read entirely from cache records a real zero for creation

- **GIVEN** a wave whose every spawn hit a warm prefix
- **WHEN** its figures are recorded
- **THEN** the cache-creation figure recorded is the measured zero
- **AND** it is distinguishable in the record from a wave whose host could not report the figure at all

### Requirement: A host without cache accounting SHALL record unknown, not zero

Where a host's runtime exposes no cache accounting, the cache figures SHALL be recorded as absent and the host's inability to supply them SHALL be visible to a reader of the run's summary as well as to a reader of the trajectory. A host that cannot measure cache behaviour MUST NOT record `0`, and MUST NOT omit the figures in a way indistinguishable from a run that measured and found none.

This SHALL be stated as a declared difference between hosts, not left to be inferred from missing data. A run whose host cannot report cache figures SHALL say so in its summary, on the same footing as any other degradation.

#### Scenario: Happy path — a host with cache accounting records real figures

- **GIVEN** a run on a host whose usage envelope carries cache-read and cache-creation fields
- **WHEN** the run closes
- **THEN** the recorded cache figures are present and non-negative

#### Scenario: Failure — a host without cache accounting is spoken, not silently empty

- **GIVEN** a run on a host whose runtime exposes only a cumulative scalar with no cache decomposition
- **WHEN** the run closes
- **THEN** the cache figures are recorded as absent
- **AND** the run's summary names the host's inability to report them
- **AND** a reader can distinguish this from a run that measured and found no cache activity

#### Scenario: Edge case — a host that reports cache fields inconsistently degrades rather than failing

- **GIVEN** a run whose host supplies cache fields for some spawns and omits them for others
- **WHEN** the affected waves close
- **THEN** those waves record their cache figures as absent
- **AND** the run continues without failing on account of the missing measurement

### Requirement: A run SHALL record the host session identifier that produced it

The trajectory SHALL record the identifier of the host session under which the run executed, so that a run joins to the host's own transcript by a key rather than by overlapping wall-clock timestamps. Timestamp overlap is not an identity: concurrent sessions in one project produce overlapping windows that cannot be told apart without reading their contents.

Where the host exposes no session identifier, the field SHALL be recorded as absent under the same unknown-not-zero rule that governs every other host-supplied figure. A run SHALL NOT fail, halt, or degrade its behaviour on account of a missing session identifier.

#### Scenario: Happy path — a run records the session it ran under

- **GIVEN** a run started on a host that exposes a session identifier
- **WHEN** the run's opening event is recorded
- **THEN** that event carries the host session identifier
- **AND** a reader can select the host transcript for that run without consulting timestamps

#### Scenario: Failure — an absent identifier is recorded as absent, not fabricated

- **GIVEN** a run on a host that exposes no session identifier
- **WHEN** the run's opening event is recorded
- **THEN** the session identifier is recorded as absent
- **AND** no substitute value is synthesised from the run identifier, the process id, or the timestamp

#### Scenario: Edge case — a missing session identifier does not make a run unreconstructable

- **GIVEN** a trajectory whose opening event carries no session identifier
- **WHEN** the run is checked for reconstructability
- **THEN** the absence alone does not render the run unreconstructable
- **AND** the run's exit code is unaffected
