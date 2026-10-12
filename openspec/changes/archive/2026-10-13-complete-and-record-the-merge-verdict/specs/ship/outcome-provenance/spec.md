## MODIFIED Requirements

### Requirement: The outcome record SHALL separate observed values from reported ones

The ship run's outcome record SHALL group its values by provenance into two named groups that are never merged:

- **Observed** — values the orchestrator itself saw during the run: whether the run halted and why, remediation rounds consumed, surviving code-review blocker count, per-wave tallies, the commit identifier, and the merge verdict the close assessed.
- **Reported** — values only an agent can supply because nothing else in the run has seen them: whether the unit suite was green, the reasons any verification was skipped, how many verifications were skipped for cap exhaustion, and how many unresolved errors were carried past a wave.

A reader of the record MUST be able to tell, per value, which group it came from, without consulting the code that wrote it. The merge verdict SHALL be one of the three published verdict words or absent. It SHALL be absent when the close assessed nothing, and SHALL NOT be defaulted to any verdict. It is stored for a reader; no gate, readiness check, autonomy record or later run SHALL read it to decide anything.

#### Scenario: Happy path — a clean run's record names both groups

- **GIVEN** a run that completed, consumed one remediation round, skipped no verifications, left the unit suite green, and whose close assessed a verdict of `HUMAN`
- **WHEN** the outcome record is written
- **THEN** the record carries the halt state, remediation round count, commit identifier and the `HUMAN` verdict in the observed group
- **AND** it carries the green unit suite and the empty skip list in the reported group

#### Scenario: Failure — a value in the wrong group is rejected rather than accepted

- **GIVEN** a closing payload that supplies a remediation round count, or a merge verdict, in the reported group
- **WHEN** the outcome record is written
- **THEN** the value is rejected rather than recorded, because both are observed values
- **AND** the record is still written with the observed values the run actually saw

#### Scenario: Edge case — an unread reported value stays absent rather than becoming clean

- **GIVEN** a closing step that could not read the run state and therefore knows none of the reported values
- **WHEN** the outcome record is written
- **THEN** the reported values are absent from the record
- **AND** they are not defaulted to zero skips, zero unresolved errors, or a green suite

#### Scenario: Edge case — a run that assessed nothing records no verdict

- **GIVEN** a run that halted before its close could assess merge confidence
- **WHEN** the outcome record is written
- **THEN** the observed group's merge verdict is absent
- **AND** it does not read as `HUMAN`, `BLOCK` or any other verdict
