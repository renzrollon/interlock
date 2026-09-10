# evals/outcome-run Specification

## Purpose

Defines the outcome eval itself: a scheduled, cost-bounded run of the real ship loop over a committed fixture, graded entirely by decisions the CLI already makes, measured against a sequential single-agent control arm, and stating out loud the parts of the product its host cannot exercise.

## Requirements

### Requirement: An outcome eval grades the environment, not the transcript

An outcome eval SHALL run a fixture's change to termination and then grade the state of the scratch root: which task boxes are ticked, whether a commit exists, whether the unit suite is green without a weakened test, whether the run's trajectory is reconstructable, and whether the run's receipt carries observed values rather than unknowns.

It SHALL NOT grade anything the agent said, and SHALL NOT read a transcript to reach a verdict.

#### Scenario: Happy path — a clean run grades on disk state alone

- **WHEN** a fixture run terminates and grading begins
- **THEN** every criterion is decided from the scratch root's files and the run's own records
- **AND** no criterion is decided from what an agent reported about itself

#### Scenario: Failure — a run that claimed success but left the suite red does not grade green

- **WHEN** a run reports itself complete while the fixture's unit suite is red
- **THEN** the graded outcome is a failure, because the suite was consulted rather than the claim

### Requirement: Every grader is an existing CLI decision

Each grading criterion SHALL be the exit code of a decision the CLI already makes, invoked against the scratch root. The eval SHALL introduce no new judgement: no model-graded criterion, no scoring function, and no threshold of its own.

The criteria SHALL be: every task the run's state machine recorded as succeeded is ticked and no task it did not is ticked; a commit exists, or the run was invoked so as to make none and none exists; the unit suite is green, judged by the same decision the loop itself uses, including its weakened-suite check against the fixture's committed baseline; the run's trajectory passes the reconstructability check; and the run's receipt is present and carries its tallies, spend, remediation rounds and leftover task ids as observed values.

#### Scenario: Happy path — the grading step is a list of CLI invocations and their exit codes

- **WHEN** a graded run is inspected
- **THEN** each criterion names the command that decided it and the exit code that command returned

#### Scenario: Failure — a weakened test is caught by the loop's own check, not a new one

- **WHEN** a run reaches a green suite by weakening an assertion the fixture's baseline pinned
- **THEN** the unit criterion fails on the existing weakened-suite decision
- **AND** no additional judgement was defined to catch it

#### Scenario: Edge case — a receipt field the run never observed fails its criterion

- **WHEN** a run's receipt carries an unknown where a tally, a remediation-round count or a leftover list was expected
- **THEN** the receipt criterion records that the field was unobserved
- **AND** the unobserved field is not read as a clean value

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

The eval SHALL be triggered on a schedule and on explicit manual invocation only. It SHALL NOT be triggered by a pull request, by a push, or by any path filter, because it consumes metered model calls and its result may not influence whether a change merges.

Every run SHALL carry a cost ceiling obtained from the project's published limits rather than restated in the job definition or in any prose. A run that reaches its ceiling SHALL be reported as partial, naming the ceiling as the reason, and SHALL NOT be reported as a completed run.

#### Scenario: Happy path — a scheduled run carries a ceiling read from the published limits

- **WHEN** the eval runs on its schedule
- **THEN** the ceiling it enforces is the one the published limits report
- **AND** the number appears in no other place

#### Scenario: Failure — a pull request never triggers the eval

- **WHEN** a pull request touches any file this change adds
- **THEN** no outcome eval run is triggered

#### Scenario: Edge case — a breached ceiling is partial, not a failing loop

- **WHEN** a run reaches its ceiling before every fixture and arm has run
- **THEN** the result is reported as partial with the ceiling named
- **AND** the fixtures that did not run are not recorded as failures

### Requirement: A run that could not happen is distinguishable from a run that went badly

Where the eval cannot execute — no model credential, no available agent for the host, an unreachable model, or a fixture that failed its own solvability check — it SHALL report that it produced no signal, naming the reason, and SHALL NOT record a graded result for the affected fixture or arm.

#### Scenario: Happy path — a missing credential yields no signal, not a regression

- **WHEN** the eval runs with no model credential available
- **THEN** it reports that it could not run and why
- **AND** it records no graded result

#### Scenario: Failure — an unreachable model is not recorded as a failed loop

- **WHEN** the model cannot be reached partway through a fixture
- **THEN** that fixture's result is reported as no signal with its reason
- **AND** it is not recorded as a graded failure of the arm

### Requirement: No outcome-eval result feeds a decision

No gate, readiness check, risk classification, autonomy record, promotion decision or workflow step SHALL consume an outcome-eval result, its recorded measures, or the difference between its arms. The eval's own job SHALL NOT be configured as a required check.

#### Scenario: Happy path — a failing outcome eval blocks nothing

- **WHEN** an outcome-eval run grades a fixture as a failure
- **THEN** no gate, check or workflow step changes its behaviour on account of it

#### Scenario: Failure — no threshold is applied to a recorded measure

- **WHEN** a recorded measure is reported
- **THEN** it is reported as a value with its denominator and is compared against no threshold

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
