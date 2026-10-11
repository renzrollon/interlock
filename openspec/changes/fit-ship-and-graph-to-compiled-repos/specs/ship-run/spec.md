## MODIFIED Requirements

### Requirement: A run's reported tallies SHALL be its recorded outcomes

Every per-wave tally a run reports — to the reader of its summary and to the record of its trajectory alike — SHALL count the outcomes the state machine recorded, not the outcomes the implementing agents reported for themselves. A run whose tallies are built from self-reports can produce a record that contradicts itself: all waves clean, beside a halt naming failures none of those waves admit to.

A tally SHALL be internally consistent with the run's own halt: if a run halted because recorded task failures accumulated past their cap, the failures counted in its tallies SHALL account for the failures named in its halt reason.

Tasks recorded as done whose report was rejected SHALL be tallied as a count of their own, named by task id, beside the succeeded and failed counts. They SHALL be included in the succeeded count, because the task was recorded as done, and SHALL NOT be included in the failed count. The run's summary SHALL state them on a row of their own and SHALL leave every row it already printed unchanged.

Where a task's recorded outcome is unavailable to the reporting path, the tally SHALL be reported as unobserved rather than as zero, on the same rule that governs every other receipt field: a count that was never read MUST NOT be presented as a count that came back clean. A record written before rejected reports were tallied carries no such count, and a reader of it SHALL report that count as unobserved.

#### Scenario: Happy path — a clean run's tallies match what was recorded

- **GIVEN** a run whose two waves recorded two and three succeeded tasks respectively, with no failures
- **WHEN** the run reports its summary and appends its receipt
- **THEN** both carry per-wave tallies of two succeeded and three succeeded, with no failures
- **AND** the two agree, having counted the same recorded outcomes

#### Scenario: Failure — an adjudicated task is counted as the failure it was recorded as

- **GIVEN** a run in which every implementing agent claimed success but the state machine recorded five tasks as failed because their lanes omitted outcomes, halting the run on its failure cap
- **WHEN** the run reports its summary and appends its receipt
- **THEN** the per-wave tallies report those five as failures
- **AND** neither the summary nor the receipt reports a wave as clean while the halt reason names its tasks as failures

#### Scenario: Edge case — rejected reports are tallied apart from failures

- **GIVEN** a run in which four tasks were recorded as done with rejected reports and no task failed
- **WHEN** the run reports its summary and appends its receipt
- **THEN** both report zero failures and name the four task ids as rejected reports
- **AND** the summary states them on one row of their own, beside a banner naming each task's rejection reason
- **AND** every other row of the summary is what it would have been had the four reports been accepted

#### Scenario: Edge case — an unread outcome is reported as unknown, not as clean

- **GIVEN** a run that ended before the recorded outcomes for a wave could be read back
- **WHEN** the receipt is appended
- **THEN** that wave's tally reads as unobserved rather than as zero failures

#### Scenario: Edge case — a record from an earlier version reports the new count as unobserved

- **GIVEN** a receipt appended before rejected reports were tallied
- **WHEN** that receipt is read back and shown
- **THEN** the record read from it carries the rejected-report count as unobserved rather than as zero
- **AND** what is shown for that receipt is what was shown before the count existed, and states no count of zero rejected reports

## ADDED Requirements

### Requirement: A run SHALL say truthfully who was told about a rejected report

When a batch records a task as done with a rejected report, the banner the run raises SHALL say who reads that report next, and SHALL say only what is true of the run it is raised in. When a later wave exists, the banner SHALL say the next wave is told. When the batch belongs to the last wave, the banner SHALL NOT say a next wave is told; it SHALL say that no later wave remains and SHALL name what stands between that work and the commit: the review when the run reviews, final verification when it does not, and nothing when the run ends after its waves without verifying.

A run that reviews its diff SHALL hand the review every rejected report the run recorded — each task, its rejection reason and the paths it reported — bounded exactly as the notice to the next wave is bounded, framed as quoted run data about where to look and not as a finding or an instruction. A review of a run that recorded no rejected report SHALL be briefed exactly as it would have been before this requirement existed.

A rejected report on the last wave SHALL NOT stop the commit. Whether the work is sound is established by verification, which gates the commit either way; what this requirement removes is the banner claiming a reader that does not exist.

A later wave is the only reader the run briefs about its predecessor. The last wave's rejected reports therefore reach no implementer at all, and a banner that says otherwise is a degradation spoken falsely.

#### Scenario: Happy path — a later wave exists and the banner says it is told

- **GIVEN** a three-wave run in which a wave 1 task is recorded as done with a rejected report
- **WHEN** the batch is recorded
- **THEN** the banner names the task and its rejection reason and says the next wave is told the task filed no usable report

#### Scenario: Failure — the last wave does not claim a reader it does not have

- **GIVEN** a run whose last wave records a task as done with a rejected report
- **WHEN** the batch is recorded
- **THEN** the banner does not say that a next wave is told
- **AND** it says no later wave remains and that final verification is the only check on that work
- **AND** the run goes on to final verification and is not halted by the rejected report

#### Scenario: Edge case — a reviewed run tells the review, and a run that stops after its waves says nothing checks

- **GIVEN** two single-wave runs that each record a task as done with a rejected report, one started with review and one started to stop after its waves
- **WHEN** each batch is recorded
- **THEN** the reviewed run's banner says the review is told instead, and its review briefing names the task, the rejection reason and the reported path, and carries no text of the rejected packet
- **AND** the other run's banner says nothing in that run checks the work

#### Scenario: Edge case — a review of a run with no rejected report is unchanged

- **GIVEN** a reviewed run in which every report was accepted
- **WHEN** the review briefing is assembled
- **THEN** it is byte-identical to the briefing assembled for the same run before rejected reports were handed to the review
