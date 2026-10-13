# review/evidence-gate Specification

## Purpose

Makes a verdict that dismisses a review finding carry a citation whose shape can be mechanically checked, and makes a finding's severity either a recognized value or a rejection. Both are the same rule applied twice: a claim about a model's own work is audited, and an unsubstantiated claim is treated as unresolved rather than accepted.

## Requirements

### Requirement: A dismissing verdict SHALL carry a checkable citation

A verdict that a finding is not real SHALL cite a source location in a checkable form — a path with a line number, or a path with a line range. A verdict whose evidence does not match that form SHALL NOT dismiss the finding.

Rationale: the check is a shape predicate deliberately, not a semantic one. A semantic check would relocate the judgement to another model; a shape check is deterministic and testable.

#### Scenario: Happy path — a cited dismissal removes the finding

- **GIVEN** a blocker finding and a verdict that it is not real, citing a path and a line number
- **WHEN** the review is resolved
- **THEN** the finding is counted as dismissed and does not survive to the gate

#### Scenario: Failure — an uncited dismissal does not dismiss

- **GIVEN** a blocker finding and a verdict that it is not real, whose evidence is prose, a bare filename with no line, a single word, or a single emoji
- **WHEN** the review is resolved
- **THEN** the verdict is recorded as a non-vote and the finding survives
- **AND** the verdict is not deleted, so its quality score still reaches the tolerance band

#### Scenario: Edge case — evidence in an accepted but unusual form

- **GIVEN** dismissal evidence expressed as a path with a line range, a path with a column suffix after the line, a path containing spaces, and the same path written with a leading `./`
- **WHEN** each verdict is resolved
- **THEN** each is accepted as a citation on the strength of its shape
- **AND** evidence naming a path absent from the reviewed diff is rejected even though its shape is valid

### Requirement: A finding's severity SHALL be a recognized value or be rejected

A finding whose severity is outside the defined set SHALL be rejected rather than mapped to an unrecognized bucket that the gate does not block on.

#### Scenario: Happy path — an in-enum blocker blocks

- **GIVEN** a surviving finding whose severity is the blocker value
- **WHEN** the gate counts findings
- **THEN** the blocker count includes it and the gate blocks

#### Scenario: Failure — an out-of-enum severity does not pass the gate

- **GIVEN** a surviving finding whose severity is a plausible but undefined value such as a higher-sounding word than the defined maximum
- **WHEN** the gate counts findings
- **THEN** the finding is rejected and reported as malformed
- **AND** it SHALL NOT be silently counted into a bucket the gate ignores

#### Scenario: Edge case — a severity differing only in casing or surrounding whitespace

- **GIVEN** findings whose severity values match a defined value except for letter casing or leading and trailing whitespace
- **WHEN** the gate counts findings
- **THEN** each resolves to the one canonical severity value and is counted there
- **AND** a value that is not a casing or whitespace variant of a defined value is rejected

### Requirement: The evidence rule SHALL be applied in the direction that fails closed

The requirement to cite SHALL apply to the verdict direction that removes a finding. A verdict that a finding is real SHALL NOT be required to cite, because that direction already resolves toward a human reading the finding.

#### Scenario: Happy path — an uncited confirming verdict still keeps the finding

- **GIVEN** a finding and a verdict that it is real, carrying no citation
- **WHEN** the review is resolved
- **THEN** the finding survives and reaches the gate

#### Scenario: Failure — a citation requirement is not extended to confirmations

- **GIVEN** an implementation that rejects uncited confirming verdicts
- **WHEN** a real finding is reported without a citation
- **THEN** requiring a citation there would drop the finding, which is the expensive error
- **AND** the specified behavior is that the confirmation stands

#### Scenario: Edge case — a finding with one cited dismissal and one uncited confirmation

- **GIVEN** two verdicts on one finding: a cited dismissal and an uncited confirmation
- **WHEN** the review is resolved
- **THEN** the outcome follows the stated survival rule with the non-vote excluded from the count
- **AND** the resulting counts of dismissed, surviving and non-voting verdicts are all reported

### Requirement: Every command that reads a findings input SHALL refuse an input that carries no findings list

A findings input SHALL be one of: a list of findings; a list of per-dimension records that each carry a `findings` list; one such record; or the record `interlock review --json` prints, from which the `surviving` list SHALL be read. Any other input carries no findings list, and no reader SHALL count it as zero findings. `interlock gate`, `interlock review` and `interlock remediate` SHALL exit 1 with the reason on standard error and nothing on standard output, as they do for a file they cannot read. `interlock ready` SHALL read it as an artifact review that has not run. An empty list SHALL still read as zero findings everywhere: it is a statement that nothing was found.

Rationale: one shape reader serves the gate, the review, the remediation plan and the readiness check. Handed an object it did not recognise it returned no findings, and each consumer read that as a clean review: the gate passed over surviving blockers, the remediation plan said there was nothing to fix, and the readiness check that may skip the human checkpoint counted zero blockers. A reader that cannot find the findings has not established that there are none.

#### Scenario: Happy path — the review's own record blocks on its surviving blocker

- **GIVEN** the record `interlock review --json` printed, holding one surviving blocker
- **WHEN** `interlock gate --findings <file>` is given that record
- **THEN** it reports the gate blocked, lists the blocker, and exits 1

#### Scenario: Failure — an object with no findings list is refused by the gate, the review and the remediation plan

- **GIVEN** a file holding a JSON object with neither a `findings` nor a `surviving` list
- **WHEN** `interlock gate --findings <file>`, `interlock review --findings <file>` and `interlock remediate --findings <file>` each run
- **THEN** each exits 1, standard error says the input carries no findings list, and standard output is empty

#### Scenario: Failure — the readiness check does not count a misshapen file as zero blockers

- **GIVEN** an artifact-review findings file holding an object with no findings list
- **WHEN** `interlock ready --findings <file>` decides whether continuity may skip the human checkpoint
- **THEN** it reads the artifact review as not run, names the reason, and is not ready

#### Scenario: Edge case — an empty list, and a record whose surviving list is empty

- **GIVEN** a file holding an empty list, and a review record whose `surviving` list is empty
- **WHEN** the gate is given each
- **THEN** each passes with zero findings and exits 0

### Requirement: A ship run SHALL adjudicate only findings this review wrote, and a missing findings list SHALL never clear a blocker

When a run emits its review step it SHALL remove the findings and verdicts work files, so that a review that writes nothing leaves nothing behind for the adjudication to read. The review briefing and the remediation briefing SHALL each tell the agent to write an empty list when nothing is found, so that a clean result is a file with a list in it.

When `run reviewed` adjudicates and the findings file is absent, unparseable or carries no findings list, the run SHALL record the review as not completed, with the reason, whatever the review step reported about itself; SHALL adjudicate as with no findings; and SHALL continue to final verification, as it does for a review step that returned nothing usable.

When `run remediated` adjudicates a round and the findings file is absent, unparseable or carries no findings list, the run SHALL adjudicate the round from the surviving findings of its last adjudication, unchanged: it SHALL NOT read the round as having cleared them, SHALL record that the round was not re-reviewed, with the reason, and SHALL plan the next round or reach its verdict from those findings. A blocker that survived the last adjudication is therefore still a blocker at the verdict round. When the last adjudication cannot be read back either, the run SHALL halt with a reason naming both files; it SHALL NOT proceed as with no findings.

Rationale: the work files outlive a run, so a review that wrote nothing was adjudicated from whatever an earlier run left there, and a review step that reported success over a missing file was a clean review. In a remediation round the same reading is worse: a fixer that leaves the file without a list would clear the blockers it was asked to fix, and the run would commit.

#### Scenario: Happy path — a review that finds nothing says so with an empty list

- **GIVEN** a strict run whose review step wrote an empty findings list
- **WHEN** `run reviewed` adjudicates
- **THEN** the review is recorded as completed with no surviving findings

#### Scenario: Failure — a review step that wrote nothing is not a clean review, even over an earlier run's file

- **GIVEN** a findings file left by an earlier run, holding no blocker, and a strict run whose review step reports success and writes no findings file
- **WHEN** the review step is emitted and `run reviewed` then adjudicates
- **THEN** the earlier file is gone before the reviewer starts, the review is recorded as not completed with the reason, and the run continues to final verification
- **AND** the merge verdict at close reads the review as not completed, never as a review that found nothing

#### Scenario: Failure — a round that leaves no findings list does not clear a blocker

- **GIVEN** a strict run whose review left one surviving blocker, and a remediation round after which the findings file holds an object with no findings list
- **WHEN** `run remediated` adjudicates that round, and the rounds are exhausted
- **THEN** the blocker still stands and the round is recorded as not re-reviewed with the reason
- **AND** the run halts at its verdict on the unresolved blocker, and does not commit

#### Scenario: Failure — neither the round's list nor the last adjudication can be read

- **GIVEN** a remediation round after which the findings file holds no findings list, and a record of the last adjudication that is absent or unparseable
- **WHEN** `run remediated` adjudicates that round
- **THEN** the run halts with a reason naming both files, and does not commit

#### Scenario: Edge case — both briefings ask for the empty list

- **GIVEN** the review briefing and the remediation briefing a run assembles
- **WHEN** the prompt suite reads each
- **THEN** each tells the agent to write an empty list to the findings file when nothing is found
