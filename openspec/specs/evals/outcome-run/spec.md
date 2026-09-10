# evals/outcome-run Specification

## Purpose

Defines the outcome eval itself: a scheduled, cost-bounded run of the real ship loop over a committed fixture, graded on disk by decisions the CLI already makes and — on the loop arm — on process by deterministic checks over the run-log events the CLI already wrote, measured against a sequential single-agent control arm, and stating out loud the parts of the product its host cannot exercise. The run-log is the loop's own JSONL, not a chat transcript; nothing here grades what an agent said.

## Requirements

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

### Requirement: The host's limits are declared, not left to inference

The eval SHALL run the loop on a host that can be driven from a shell without an interactive runtime, and SHALL state in its own committed description which parts of the product that host does not exercise — in particular that per-tier model routing is not in effect on it and that the interactive runtime's launch behaviour is not under test.

A result produced on that host SHALL carry the host's identity, so a reader cannot mistake it for a measurement of the full product.

#### Scenario: Happy path — the eval's description names what it does not cover

- **WHEN** a reader opens the eval's description
- **THEN** it states that model routing per tier and the interactive runtime's launch behaviour are outside what this eval measures

#### Scenario: Failure — a result without a host identity is incomplete

- **WHEN** a result record carries no host identity
- **THEN** the record is incomplete, because the coverage of the measurement cannot be established from it

### Requirement: The eval measures cost and effort and never fabricates a measurement

Each run SHALL record, alongside its graded criteria: output-token spend, the number of agents spawned, wall-clock duration, and remediation rounds consumed.

Where the host cannot measure a figure, the eval SHALL record that figure as absent together with the reason it is absent, and SHALL NOT record zero. A figure the host does not expose MUST remain distinguishable from a figure that was measured and found to be zero, and MUST NOT be reconstructed by arithmetic over agent counts or any other proxy.

#### Scenario: Happy path — a measurable figure is recorded as measured

- **WHEN** the host exposes the accounting a figure needs
- **THEN** the figure is recorded with its measured value

#### Scenario: Failure — an unmeasurable spend is recorded absent, never zero

- **WHEN** the host exposes no token accounting
- **THEN** the spend figure is recorded as absent with the reason
- **AND** it is not recorded as zero, and no estimate is substituted for it

#### Scenario: Edge case — a genuine zero stays distinguishable from an absence

- **WHEN** a measured figure is zero
- **THEN** a reader can tell it apart from the same field on a run where the host could not measure at all

### Requirement: Every fixture is run through a control arm as well as the loop

Each fixture SHALL be run through two arms with the same model, the same fixture starting state and the same graders: the loop under test, and a control in which the change's tasks are implemented sequentially by a single agent with no wave loop, no planner and no state machine.

Each result SHALL name which arm produced it. The eval SHALL report the per-fixture difference between the arms on every recorded criterion and measure, as a difference with its denominators, and SHALL attach no verdict to it.

#### Scenario: Happy path — one fixture yields one result per arm

- **WHEN** an eval run completes over one fixture
- **THEN** it produces one result naming the loop arm and one naming the control arm

#### Scenario: Failure — an arm that could not run is reported as such, not as a loss

- **WHEN** the control arm cannot be executed
- **THEN** the run reports that arm as not run with its reason
- **AND** the difference is reported as unavailable rather than computed against a missing arm

#### Scenario: Edge case — the reported difference carries no verdict

- **WHEN** the difference between the arms is reported
- **THEN** it is stated as values and their denominators
- **AND** no arm is labelled better, acceptable, degraded or passing

### Requirement: The eval runs the default configuration of the loop

The arm under test SHALL run the loop in the configuration the product ships as its default. The optional adversarial tail SHALL NOT be enabled in this eval, because the default is what consumers run and it is the default that has never been measured.

#### Scenario: Happy path — the measured arm is the default configuration

- **WHEN** the loop arm is invoked
- **THEN** it runs the default configuration with no optional review, handoff or conformance tail enabled

#### Scenario: Failure — a host that cannot honour the requested configuration refuses rather than substituting one

- **WHEN** a configuration is requested that the host cannot run
- **THEN** the run refuses and states why, rather than running a different configuration under the requested name

### Requirement: The eval is scheduled, bounded, and never runs on a pull request

The metered outcome eval — the sweep that invokes a model and grades a fixture on disk — SHALL be triggered on a schedule and on explicit manual invocation only. It SHALL NOT be triggered by a pull request, by a push, or by any path filter, because it consumes metered model calls and its result may not influence whether a change merges.

This requirement does not forbid the model-free prepare path from running on a pull request or a push. That path is specified separately and MUST NOT be read as a metered outcome eval run.

Every metered run SHALL carry a cost ceiling obtained from the project's published limits rather than restated in the job definition or in any prose. A run that reaches its ceiling SHALL be reported as partial, naming the ceiling as the reason, and SHALL NOT be reported as a completed run.

#### Scenario: Happy path — a scheduled run carries a ceiling read from the published limits

- **WHEN** the metered eval runs on its schedule
- **THEN** the ceiling it enforces is the one the published limits report
- **AND** the number appears in no other place

#### Scenario: Failure — a pull request never triggers the eval

- **WHEN** a pull request touches any file this change adds
- **THEN** no metered outcome eval run is triggered
- **AND** a model-free prepare on that pull request is not a metered outcome eval run

#### Scenario: Edge case — a breached ceiling is partial, not a failing loop

- **WHEN** a metered run reaches its ceiling before every fixture and arm has run
- **THEN** the result is reported as partial with the ceiling named
- **AND** the fixtures that did not run are not recorded as failures

### Requirement: A run that could not happen is distinguishable from a run that went badly

Where the metered eval cannot execute — no model credential, no available agent for the host, an unreachable model, or a fixture that failed its own solvability check — it SHALL report that it produced no signal, naming the reason, and SHALL NOT record a graded result for the affected fixture or arm.

This no-signal rule applies to the metered sweep. It SHALL NOT be used to skip, pass, or silence the model-free prepare path when a credential is absent.

#### Scenario: Happy path — a missing credential yields no signal, not a regression

- **WHEN** the metered eval runs with no model credential available
- **THEN** it reports that it could not run and why
- **AND** it records no graded result

#### Scenario: Failure — an unreachable model is not recorded as a failed loop

- **WHEN** the model cannot be reached partway through a fixture
- **THEN** that fixture's result is reported as no signal with its reason
- **AND** it is not recorded as a graded failure of the arm

### Requirement: No outcome-eval result feeds a decision

No gate, readiness check, risk classification, autonomy record, promotion decision or workflow step SHALL consume an outcome-eval result, its recorded measures, or the difference between its arms. The metered eval's own job SHALL NOT be configured as a required check.

A non-zero exit from the model-free prepare path is not an outcome-eval result. Failing the CI workflow that invoked that path SHALL NOT be read as wiring a graded score into ready, gate, ship, or promotion.

#### Scenario: Happy path — a failing outcome eval blocks nothing

- **WHEN** a metered outcome-eval run grades a fixture as a failure
- **THEN** no gate, check or workflow step changes its behaviour on account of it

#### Scenario: Failure — no threshold is applied to a recorded measure

- **WHEN** a recorded measure is reported
- **THEN** it is reported as a value with its denominator and is compared against no threshold

#### Scenario: Edge case — a failed prepare is not a graded result

- **WHEN** the model-free prepare path exits non-zero
- **THEN** the CI workflow that invoked it fails
- **AND** no gate, readiness check or promotion decision consumed a graded outcome-eval result, because none was produced

### Requirement: The eval's own model loop SHALL request caching for the prefix it measures

The outcome eval tallies the cache-read and cache-creation tokens its own model requests report. Those tallies are only a measurement if the eval asked for caching in the first place: the provider writes a cache entry only where the request marks one, so a loop that marks none reports a zero that means "never asked", indistinguishable from "asked and missed".

The eval's model loop SHALL mark its stable prefix — the portion that does not change between turns of one loop — as cacheable, so that its recorded cache tallies reflect cache behaviour. The eval SHALL NOT report a cache tally it did not request the conditions for.

#### Scenario: Happy path — a multi-turn loop reads its prefix from cache after the first turn

- **GIVEN** an eval loop that issues several model requests sharing one stable prefix
- **WHEN** the loop runs
- **THEN** the first request records cache creation for that prefix
- **AND** later requests record cache reads rather than re-creating it

#### Scenario: Failure — a loop that marks no cacheable prefix is a defect, not a zero result

- **GIVEN** an eval model loop that issues requests without marking any prefix cacheable
- **WHEN** the eval's tallies are inspected
- **THEN** the recorded cache-read tally is zero for structural reasons rather than measured ones
- **AND** this is a defect in the apparatus, not a finding about the loop under test

#### Scenario: Edge case — a prefix too short to cache is reported as unmeasured, not as a miss

- **GIVEN** a loop whose stable prefix falls below the provider's minimum cacheable size
- **WHEN** the provider writes no cache entry
- **THEN** the eval does not report the resulting zero as a cache miss
- **AND** the condition is distinguishable from a prefix that was cacheable and was not reused

### Requirement: Ordinary CI SHALL run the model-free prepare path without a credential

Ordinary continuous integration — the workflow that already runs the unit suite on a pull request and on a push to the default branch — SHALL invoke the outcome eval's model-free prepare path for every committed fixture.

That invocation SHALL NOT require a model credential, SHALL NOT contact a model provider, SHALL NOT record spend, and SHALL NOT append a history row. A missing model credential SHALL NOT skip the path and SHALL NOT mark the workflow successful.

A non-zero exit from the prepare path SHALL fail the CI workflow that invoked it, so a broken fixture, a failed copy, or an isolation refusal cannot land silently.

The path MAY run as its own job in that workflow rather than inside the unit-suite matrix, so it is not multiplied across runtime versions. It SHALL NOT introduce a new build system and SHALL NOT introduce a fourth eval framework.

#### Scenario: Happy path — a pull request prepares every fixture without a credential

- **WHEN** a pull request runs ordinary CI with no model credential available
- **THEN** the model-free prepare path is invoked for every committed fixture
- **AND** it completes without contacting a model provider and without recording spend

#### Scenario: Failure — a broken prepare fails the build

- **WHEN** the model-free prepare path exits non-zero because a fixture cannot be copied, validated, or isolated
- **THEN** the CI workflow that invoked it fails
- **AND** the failure is not reported as no-signal of a metered sweep

#### Scenario: Edge case — a missing credential does not skip prepare

- **WHEN** ordinary CI has no model credential
- **THEN** the model-free prepare path still runs
- **AND** it is not skipped, marked successful, or classified as no-signal

#### Scenario: Edge case — prepare writes no history row

- **WHEN** the model-free prepare path completes
- **THEN** no line is appended to the outcome-eval history
- **AND** no graded result is recorded
