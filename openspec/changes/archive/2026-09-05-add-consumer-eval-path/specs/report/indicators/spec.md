## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Plan fidelity reports what is recorded and declares what is not

**Reason**: The requirement's whole premise was that no corpus records a comparison between the committed diff and the plan that produced it, so the indicator had to be published as a declared gap with a `wouldRequire` text. This change records exactly what that text asked for, so the gap no longer exists and an indicator that still declared one would be false. The two recorded figures it also governed — the plan-reuse status distribution and the mid-run revision share — are carried forward unchanged into the replacement requirement above, along with the rule that neither may be presented under the diff-matches-plan name.

**Migration**: No consumer migration: the report is read by a human and by the skill that explains it, and nothing in the loop consumes it. The `computable: false` / `reason` / `wouldRequire` shape is replaced by a value, a denominator and a per-reason exclusion count; a reader that keyed on the absence of a value now finds one, or finds the value unobserved with its reason, which is the shape every other indicator in the report already uses.
