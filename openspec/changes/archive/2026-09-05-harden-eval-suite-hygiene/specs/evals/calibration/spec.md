## Purpose
Measures how often each judged grader agrees with a human label on the same transcript, and reports that agreement with its denominator, so a model judge that has drifted is visible before its verdict is trusted to block anything.

## ADDED Requirements

### Requirement: Every judged grader is measured against human labels

Each grader whose verdict depends on a model judge SHALL be measurable against a stored set of human-labelled transcripts kept with the case it belongs to. The set SHALL carry labels for both outcomes — transcripts a human judged passing and transcripts a human judged failing — so agreement is not measured on one side only.

#### Scenario: Labelled set holds both outcomes

- **WHEN** a calibration set is stored for a judged grader
- **THEN** it contains transcripts labelled as passing and transcripts labelled as failing

#### Scenario: One-sided set is reported as such

- **WHEN** a calibration set holds labels for only one outcome
- **THEN** the report states that agreement was measured on one side only
- **AND** it does not present the result as a complete measurement

### Requirement: Agreement is reported with its denominator and never as a verdict

The calibration report SHALL state, per judged grader, how many labelled transcripts the judge agreed with out of how many were compared. It SHALL NOT classify a grader as acceptable or unacceptable, SHALL NOT fail a build on the result, and SHALL exit successfully whether agreement is high or low. The promotion decision, not this report, applies the floor.

#### Scenario: Report carries the denominator

- **WHEN** agreement is reported for a judged grader
- **THEN** both the number of agreements and the number of comparisons are stated

#### Scenario: Low agreement does not fail

- **WHEN** a judged grader agrees with the human label on few transcripts
- **THEN** the report states the agreement and its denominator
- **AND** the command exits successfully

#### Scenario: Report issues no classification

- **WHEN** the report is read
- **THEN** it names no grader as passing or failing calibration

### Requirement: Calibration runs offline against stored labels and stored judge votes

The measurement SHALL compare labels stored with the case against judge votes recorded in a completed results file. It SHALL NOT call a model to re-judge a transcript, SHALL NOT reach the network, and SHALL be reproducible from the same inputs.

#### Scenario: No model call is made

- **WHEN** calibration is computed
- **THEN** no model is invoked and no network request is made

#### Scenario: Same inputs yield the same agreement

- **WHEN** calibration is computed twice over the same labels and the same results file
- **THEN** the reported agreement is identical

### Requirement: A transcript with no matching judge vote is reported, not dropped

When a labelled transcript has no corresponding judge vote in the supplied results file, or a judge vote has no corresponding label, the report SHALL name the unmatched item and exclude it from the denominator explicitly. Unmatched items SHALL NOT be silently discarded.

#### Scenario: Labelled transcript with no vote

- **WHEN** a labelled transcript has no judge vote in the results file
- **THEN** the report names it as unmatched and excludes it from the comparison count

#### Scenario: Every item unmatched

- **WHEN** no labelled transcript matches any judge vote
- **THEN** the report states that agreement could not be measured
- **AND** it does not report an agreement figure

### Requirement: A judged grader with no calibration set is stated, never assumed

When a judged grader has no stored calibration set, the report SHALL name that grader as unmeasured. It SHALL NOT omit the grader, and it SHALL NOT report it as agreeing.

#### Scenario: Unmeasured grader is named

- **WHEN** a judged grader has no calibration set
- **THEN** the report lists it as unmeasured, with no agreement figure

#### Scenario: Unmeasured is distinct from disagreeing

- **WHEN** the report is read
- **THEN** a grader with no calibration set is distinguishable from a grader whose judge disagreed with every label
