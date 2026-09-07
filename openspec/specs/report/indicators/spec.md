# report/indicators Specification

## Purpose
Defines which indicators `interlock report` computes over the three corpora Interlock writes, how each one is derived, and which one is declared uncomputable rather than approximated — so the meaning of a printed figure cannot be re-argued on each reading.

## Requirements

### Requirement: Corpus coverage is reported before any indicator

The report SHALL report corpus coverage first: how many trajectories exist, how many carry a `run-start`, how many carry a terminal event (`run-complete` or `run-halt`), how many carry a `run-receipt`; how many outcome records exist by mode; and how many metrics files were recognized. Coverage SHALL be reported even when every subsequent indicator is unobserved.

#### Scenario: An empty corpus still yields a coverage section

- **WHEN** no outcome corpus exists and no trajectory carries a receipt
- **THEN** the report states the trajectory count, states that no trajectory carries a receipt, and states that no outcome record exists

#### Scenario: Coverage precedes the indicators in the human-readable output

- **WHEN** the report is printed without `--json`
- **THEN** the coverage section appears before the first indicator

### Requirement: First-pass ship rate is derived from receipts and named as such

The report SHALL compute a first-pass ship rate: the share of runs whose receipt reports the run did not halt and reports zero remediation rounds. Its denominator SHALL be receipts in which both facts were observed. The indicator SHALL NOT be labelled a CI success rate, because no CI result is recorded.

#### Scenario: A receipt missing remediation rounds is excluded from the denominator

- **WHEN** a receipt reports `halted: false` and reports remediation rounds as unobserved
- **THEN** that run is counted as not observed and is excluded from the rate's denominator

#### Scenario: No receipts yields a null rate with a reason

- **WHEN** no trajectory carries a receipt
- **THEN** the rate is reported as unobserved with a reason, and not as zero

### Requirement: Rework is reported as two separate figures

The report SHALL report in-run remediation rounds and attempts-per-change separately, and SHALL NOT combine them into one rework number. Remediation rounds SHALL be derived from receipts. Attempts per change SHALL be derived by grouping runs by their recorded change name.

#### Scenario: Runs attributed to no change are reported as unattributed

- **WHEN** trajectories record a change name of `unnamed`
- **THEN** the report states the unattributed share rather than including those runs in a per-change tally

#### Scenario: The two figures are not summed

- **WHEN** both remediation rounds and attempts per change are observed
- **THEN** each is reported under its own label with its own denominator

### Requirement: Plan fidelity reports the recorded figures and the computed diff-vs-plan share

The report SHALL report the distribution of recorded plan-reuse statuses, and the share of runs in which the plan was revised mid-run. It SHALL additionally compute, from the touched and predicted path sets the receipt records, the share of touched paths that the executed plan predicted, and SHALL report it with its denominator. It SHALL NOT present either of the two recorded plan figures under that name, because neither observes the diff.

A run SHALL contribute to that share only when both path sets were observed, the prediction was complete, and neither set was truncated. Every other run SHALL be excluded and counted under the reason it was excluded — no commit was made, a set could not be read, the plan did not predict for every task, or a set exceeded its bound — and those counts SHALL be reported alongside the share. A zero denominator SHALL yield an unobserved value with its reason, never zero.

#### Scenario: The diff-matches-plan indicator is computed with a denominator

- **WHEN** at least one scanned run recorded both path sets, complete and untruncated
- **THEN** the report states the share of touched paths that were predicted, and states the number of runs and the number of paths the share was computed over

#### Scenario: A run that made no commit is excluded and named

- **WHEN** a scanned run's receipt records the touched set as unobserved because it made no commit
- **THEN** that run does not contribute to the share
- **AND** the report counts it under an exclusion reason naming the absent commit, rather than counting it as a run whose diff matched nothing

#### Scenario: A run whose plan did not predict for every task is excluded and named

- **WHEN** a scanned run's receipt records the prediction as incomplete
- **THEN** that run does not contribute to the share
- **AND** the report counts it under an exclusion reason naming the incomplete prediction

#### Scenario: A run whose path set was truncated is excluded and named

- **WHEN** a scanned run's receipt marks either path set truncated
- **THEN** that run does not contribute to the share
- **AND** the report counts it under an exclusion reason naming the truncation

#### Scenario: No qualifying run yields an unobserved share with a reason

- **WHEN** no scanned run recorded both path sets complete and untruncated
- **THEN** the share is reported as unobserved with a reason
- **AND** it is not reported as zero, which would assert that nothing the runs touched was predicted

#### Scenario: Mid-run revision is counted from recorded wave actions

- **WHEN** a run records at least one wave action whose source is a replan
- **THEN** that run is counted as having revised its plan mid-run

### Requirement: The plan-fidelity share states its direction

The report SHALL state which way the share is computed — the share of paths the run touched that the plan predicted — and SHALL NOT present the converse figure, the share of predicted paths that were touched, under the same name. The two answer different questions: one measures a plan that under-predicted what the run did, the other a plan that predicted work the run never did.

#### Scenario: The reported figure names the direction it was computed in

- **WHEN** the plan-fidelity share is reported
- **THEN** its label or its stated definition identifies the touched set as the denominator

#### Scenario: The converse figure is not published under the same name

- **WHEN** the report presents plan fidelity
- **THEN** no figure computed over the predicted set as denominator appears under the diff-matches-plan name

### Requirement: Review-finding figures from different writers are kept apart

The report SHALL report review-finding counts from the review-metrics corpus and from receipts as separate series, and SHALL NOT sum them. Where raised and dismissed counts are both observed, it SHALL report the dismissal share.

#### Scenario: Metrics-file counts and receipt counts are not combined

- **WHEN** both a review-metrics file and a receipt report finding counts
- **THEN** each series is reported separately, each with its own denominator

#### Scenario: A dismissal share requires a non-zero raised count

- **WHEN** no findings were raised in the window
- **THEN** the dismissal share is reported as unobserved rather than as zero

### Requirement: Deterministic-gate exit health is reported per command

The report SHALL report, from recorded command-exit events, how often each deterministic command exited non-zero, grouped by command name.

#### Scenario: Exit health names the command

- **WHEN** a command exited non-zero in the window
- **THEN** the report names that command and its non-zero count

#### Scenario: Commands with no recorded exits are absent rather than zero

- **WHEN** a command recorded no exit events in the window
- **THEN** that command does not appear in the exit-health group

### Requirement: Every indicator declares its source corpus

Each indicator SHALL declare which corpus it was derived from, distinguishing a value the run observed from a value an agent reported.

#### Scenario: A reported value is distinguishable from an observed one

- **WHEN** an indicator is derived from the agent-reported half of an outcome record
- **THEN** its declared source identifies it as reported rather than observed
