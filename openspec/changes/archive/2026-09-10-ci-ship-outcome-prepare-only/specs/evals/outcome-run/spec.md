## MODIFIED Requirements

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

## ADDED Requirements

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
