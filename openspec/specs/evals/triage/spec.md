# evals/triage Specification

## Purpose
Turns a completed eval results run into a verdict without a model — classifying each case as a regression, as run-to-run variance, or as no signal — so the rule that decides whether evals blocked cannot be re-argued on each run.

## Requirements

### Requirement: Triage runs without a model and without the network

The triage decision SHALL be computed from the results file alone. It SHALL NOT call a model, SHALL NOT reach the network, and SHALL be reproducible from the same input.

#### Scenario: Same input yields same verdict

- **WHEN** triage is run twice over the same results file
- **THEN** it produces the same classification for every case

#### Scenario: No network access required

- **WHEN** triage runs with no network available
- **THEN** it completes and reports a verdict

### Requirement: A deterministic grader failure is a regression

When a case fails a grader whose verdict does not depend on a model judge, triage SHALL classify that case as a regression, on the evidence of a single run.

#### Scenario: Deterministic failure on one run

- **WHEN** a case fails a pattern, tool-invocation, file-existence or ordering grader
- **THEN** triage classifies it as a regression

#### Scenario: Regression names the grader

- **WHEN** a case is classified as a regression
- **THEN** the output names which grader failed

### Requirement: A judged-only dip on a single run is variance, not regression

When every failing grader for a case depends on a model judge, and the results file carries only one run of that case, triage SHALL classify it as variance and SHALL state what would confirm it as a regression.

#### Scenario: Single judged run dips

- **WHEN** a case's only failing graders are judged, and the case ran once
- **THEN** triage classifies it as variance
- **AND** the output states that corroboration across further runs would confirm it

#### Scenario: Judged failure repeats across runs

- **WHEN** a case fails the same judged grader on a majority of its runs
- **THEN** triage classifies it as a regression

### Requirement: An incomplete run yields no signal

When the run did not complete — exhausted budget, interruption, rejected credential, or a results file reporting itself partial — triage SHALL report no signal and SHALL NOT classify any case.

#### Scenario: Partial run

- **WHEN** the results file reports the run as partial
- **THEN** triage reports no signal, naming the reason
- **AND** it classifies no case as a regression

#### Scenario: Credential rejected before any case ran

- **WHEN** the run aborted because its credential was rejected
- **THEN** triage reports no signal rather than a suite failure

### Requirement: An empty or unloadable suite is a configuration problem

When the results file records zero cases, or records cases that failed to load, triage SHALL report a configuration problem distinctly from both a regression and a clean pass.

#### Scenario: Zero cases discovered

- **WHEN** the run discovered no cases
- **THEN** triage reports a configuration problem and does not report a pass

#### Scenario: Case failed to load

- **WHEN** a case could not be loaded
- **THEN** triage names that case as unloadable, separately from any scored case

### Requirement: The exit status is the verdict

Triage SHALL communicate its verdict through its exit status: zero when no case is classified as a regression, non-zero when at least one is. No consumer SHALL be required to re-derive the verdict from the printed output.

#### Scenario: Regression present

- **WHEN** at least one case is classified as a regression
- **THEN** triage exits non-zero

#### Scenario: Only variance present

- **WHEN** cases are classified as variance and none as a regression
- **THEN** triage exits zero
- **AND** the variance is still reported in the output

#### Scenario: No signal does not read as success

- **WHEN** triage reports no signal
- **THEN** its exit status is distinguishable from a clean pass
