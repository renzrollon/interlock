# ship/outcome-provenance Specification

## Purpose

Keeps the ship run's outcome record honest about where each of its values came from, so the corpus that exists to answer "should we have skipped the human that time?" is not partly written by the party being assessed.

## Requirements

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

### Requirement: An agent SHALL NOT be asked to correct an observed value

The procedure that closes a ship run SHALL NOT instruct an agent to adjust, correct, verify, or replace any value in the observed group. An agent MAY be asked only for values in the reported group. The writer SHALL enforce this independently of the procedure's wording, so that a prompt edit cannot reopen the hole.

This mirrors the rule already established for the readiness gate's blocker count: the party whose work is being assessed does not write the assessment's inputs.

#### Scenario: Happy path — the closing procedure asks only for reported values

- **GIVEN** the procedure text that closes a ship run
- **WHEN** it is inspected for what it asks the closing agent to supply
- **THEN** it asks for the unit suite result, skipped-verification reasons, cap-exhausted count, and unresolved-error count
- **AND** it contains no instruction to correct, adjust, or re-derive the halt state, remediation rounds, or blocker count

#### Scenario: Failure — an agent-supplied observed value does not reach the corpus

- **GIVEN** a closing agent that supplies a halt state contradicting what the run observed
- **WHEN** the outcome record is written
- **THEN** the recorded halt state is the one the run observed
- **AND** the agent-supplied value is not written

#### Scenario: Edge case — a procedure edit that reintroduces the invitation is still contained

- **GIVEN** a procedure text modified to ask the closing agent to correct any field that looks wrong
- **WHEN** the agent supplies corrections to observed fields and the record is written
- **THEN** the observed fields still carry the run's own values
- **AND** the enforcement does not depend on the procedure's wording

### Requirement: Observed values SHALL be derived from the run receipt, not composed twice

The observed group SHALL be derived from the run's recorded receipt rather than assembled a second time for the outcome record. Nothing that appears in both places may be reported independently, so the two records cannot disagree about the same run.

When no receipt exists for a run, the observed group MUST record that the receipt was absent rather than falling back to reassembling the values from prose or from an agent.

#### Scenario: Happy path — receipt and outcome record agree by construction

- **GIVEN** a run whose receipt records two remediation rounds and a halt
- **WHEN** the outcome record is written
- **THEN** its observed group reports the same two remediation rounds and the same halt
- **AND** the values were taken from the receipt rather than recomputed

#### Scenario: Failure — a run with no receipt records the absence

- **GIVEN** a run that died before writing a receipt
- **WHEN** an outcome record is written for it
- **THEN** the observed group records that no receipt was available
- **AND** it does not carry observed values sourced from an agent instead

#### Scenario: Edge case — a receipt whose fields are partly absent propagates absence

- **GIVEN** a receipt in which the review counts were never observed because the run halted first
- **WHEN** the outcome record derives its observed group from that receipt
- **THEN** the review count in the record reads as not observed
- **AND** it does not read as zero blockers
