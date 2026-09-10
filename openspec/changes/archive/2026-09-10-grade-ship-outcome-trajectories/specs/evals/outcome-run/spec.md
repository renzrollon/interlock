## MODIFIED Requirements

### Requirement: An outcome eval grades the environment, not the transcript

An outcome eval SHALL run a fixture's change to termination and then grade the state of the scratch root: which task boxes are ticked, whether a commit exists, whether the unit suite is green without a weakened test, whether the run's trajectory is reconstructable, whether the run's receipt carries observed values rather than unknowns, and — on the loop arm — whether the reconstructable run-log honours the loop's process contract.

It SHALL NOT grade anything an agent said. It SHALL NOT read a chat transcript, a plugin-eval trace, or an implementer's tool-call list to reach a verdict. Reading the scratch run-log the reconstructability check already consults is not reading a chat transcript: those events are the loop's own JSONL, not messages.

#### Scenario: Happy path — a clean run grades on disk state alone

- **WHEN** a fixture run terminates and grading begins
- **THEN** every disk criterion is decided from the scratch root's files and the run's own records
- **AND** no disk criterion is decided from what an agent reported about itself
- **AND** on the loop arm, process criteria are decided from that run's trajectory events, which are not a chat transcript

#### Scenario: Failure — a run that claimed success but left the suite red does not grade green

- **WHEN** a run reports itself complete while the fixture's unit suite is red
- **THEN** the graded outcome is a failure, because the suite was consulted rather than the claim

#### Scenario: Edge case — an implementer's tool order is not a criterion

- **WHEN** two reconstructable loop trajectories contain the same required event types and allowed actions but differ in the order of implementer tool calls
- **THEN** that difference SHALL NOT fail a process criterion

### Requirement: Every grader is an existing CLI decision

Each disk and reconstructability criterion SHALL be the exit code of a decision the CLI already makes, invoked against the scratch root.

Process criteria on the loop arm SHALL be deterministic checks over events the CLI already wrote: required event types present, no unknown `action`, and halt when a verify judgement the CLI already recorded says unit red. They SHALL introduce no model-graded criterion, no scoring function, and no threshold of the eval's own. They SHALL NOT re-judge whether the suite is red. They SHALL NOT be folded into the reconstructability check.

The disk and reconstructability criteria SHALL remain: every task the run's state machine recorded as succeeded is ticked and no task it did not is ticked; a commit exists, or the run was invoked so as to make none and none exists; the unit suite is green, judged by the same decision the loop itself uses, including its weakened-suite check against the fixture's committed baseline; the run's trajectory passes the reconstructability check; and the run's receipt is present and carries its tallies, spend, remediation rounds and leftover task ids as observed values.

#### Scenario: Happy path — the grading step is a list of CLI invocations and their exit codes

- **WHEN** a graded run is inspected
- **THEN** each disk and reconstructability criterion names the command that decided it and the exit code that command returned
- **AND** each process criterion names the check that decided it (required types, known actions, or halt-on-unit-red) and the events it consulted

#### Scenario: Failure — a weakened test is caught by the loop's own check, not a new one

- **WHEN** a run reaches a green suite by weakening an assertion the fixture's baseline pinned
- **THEN** the unit criterion fails on the existing weakened-suite decision
- **AND** no additional judgement was defined to catch it

#### Scenario: Edge case — a receipt field the run never observed fails its criterion

- **WHEN** a run's receipt carries an unknown where a tally, a remediation-round count or a leftover list was expected
- **THEN** the receipt criterion records that the field was unobserved
- **AND** the unobserved field is not read as a clean value

#### Scenario: Failure — process checks do not change reconstructability

- **WHEN** a loop trajectory is reconstructable but omits a required process event type or carries an unknown `action`
- **THEN** the reconstructability criterion still passes
- **AND** the process criterion that detected the omission or unknown value fails
- **AND** the reconstructability command's contract is unchanged

## ADDED Requirements

### Requirement: The loop arm grades required event types and forbids unknown actions

On the loop arm, after the reconstructability check, the eval SHALL inspect the scratch run-log's events.

Every event `type` present MUST be one the trajectory writer already accepts. A completed loop (a trajectory that closed with `run-complete`) MUST also contain the stage-bearing types the loop emits when it ran waves: `wave-action`, `cli-exit`, `verify-judgement`, and `run-receipt`. The types the reconstructability check already requires — a `run-start` and a closing `run-halt` or `run-complete` — SHALL NOT be re-asserted as process failures.

Every event that carries an `action` field MUST hold a value from the run program's allowed action set — the same vocabulary the CLI already refuses unknown values against. An invented value (including values a control-plane ping has been observed to fabricate) SHALL fail this criterion.

The eval SHALL require presence of those types, not a strict sequence of them, and SHALL NOT match implementer tool order.

A missing run-log on the loop arm SHALL leave these criteria unobserved, never passing.

#### Scenario: Happy path — a completed loop log carries the required types and only allowed actions

- **WHEN** a loop-arm trajectory closes with `run-complete` and contains `wave-action`, `cli-exit`, `verify-judgement`, and `run-receipt`, and every `action` field is in the allowed set
- **THEN** the required-types criterion passes
- **AND** the known-actions criterion passes

#### Scenario: Failure — a required type is absent on a completed loop

- **WHEN** a loop-arm trajectory closes with `run-complete` and lacks `verify-judgement`
- **THEN** the required-types criterion fails
- **AND** the reconstructability criterion is not failed on that account alone

#### Scenario: Failure — an unknown action fails the known-actions criterion

- **WHEN** a loop-arm trajectory contains a `wave-action` whose `action` is not in the allowed set
- **THEN** the known-actions criterion fails
- **AND** no process criterion requires a particular order of implementer tools

#### Scenario: Edge case — a halted loop is not failed for types only a completed ship emits

- **WHEN** a loop-arm trajectory closes with `run-halt` and never reached verification
- **THEN** the required-types criterion SHALL NOT fail solely for the absence of `verify-judgement` or `run-receipt`

#### Scenario: Edge case — an unknown event type fails required-types

- **WHEN** a loop-arm trajectory contains an event whose `type` is not one the trajectory writer accepts
- **THEN** the required-types criterion fails

### Requirement: The loop arm fails process when unit was red and the run did not halt

On the loop arm, if the scratch run-log contains a `verify-judgement` whose unit status the CLI already recorded as a halting unit result (`red`, `error`, or `weakened`), the trajectory MUST close with `run-halt` and MUST NOT close with `run-complete`.

The eval SHALL read that unit status and halt flag from the events the CLI wrote. It SHALL NOT re-run the suite to decide this criterion, and SHALL NOT introduce a new judgement of redness.

If no such unit-halting judgement is present, this criterion SHALL pass: there was no unit-red decision to honour.

#### Scenario: Happy path — a unit-red judgement is closed with run-halt

- **WHEN** a loop-arm trajectory contains a `verify-judgement` with a halting unit status and a `run-halt` close
- **THEN** the halt-on-unit-red criterion passes

#### Scenario: Failure — the loop completed after a unit-red judgement

- **WHEN** a loop-arm trajectory contains a `verify-judgement` with a halting unit status and a `run-complete` close
- **THEN** the halt-on-unit-red criterion fails

#### Scenario: Edge case — no unit-halting judgement is not a process failure

- **WHEN** a loop-arm trajectory contains no `verify-judgement` with a halting unit status
- **THEN** the halt-on-unit-red criterion passes
- **AND** a missing `verify-judgement` on a `run-complete` close is still a required-types failure

### Requirement: Process criteria are not-applicable on the control arm

The control arm has no ship loop and writes no trajectory. The required-types, known-actions, and halt-on-unit-red criteria SHALL be recorded not-applicable on that arm, never as failures. A process criterion recorded as failed for lacking a mechanism the control arm was defined not to have WOULD manufacture the difference the eval exists to measure.

The arm-to-arm difference SHALL continue to cover only the criteria both arms can be graded on, plus every measure, and SHALL attach no verdict.

#### Scenario: Happy path — control-arm process criteria are not-applicable

- **WHEN** the control arm of a fixture is graded
- **THEN** required-types, known-actions, and halt-on-unit-red are each recorded not-applicable
- **AND** none of them is recorded as a failure

#### Scenario: Edge case — the reported difference still carries no verdict

- **WHEN** the difference between the arms is reported after process criteria exist
- **THEN** it is stated as values and their denominators
- **AND** process criteria are excluded from that difference rather than counted against the control arm
- **AND** no arm is labelled better, acceptable, degraded or passing
