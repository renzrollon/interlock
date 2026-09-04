## MODIFIED Requirements

### Requirement: The skill authors a case only from an observed failure

Given a described failure, the skill SHALL require evidence that the failure was observed — an archived proposal, a changelog entry, a run artifact, a transcript, or a case skeleton captured from a recorded run trajectory — before writing a case. When no evidence is offered, it SHALL say so and stop rather than author a speculative case.

A captured skeleton is admissible evidence because it is a run artifact: its provenance names the trajectory and the events it was derived from, and a reader can go back to that trajectory. It is a draft rather than a finished case: the skill SHALL resolve every value the capture marked as requiring confirmation before the case is authored, and SHALL NOT author a case that still carries an unconfirmed grader pattern or an unconfirmed prompt placeholder.

#### Scenario: Evidence present, case written

- **WHEN** the user describes a failure and cites where it was observed
- **THEN** the skill writes a case that encodes it, recording the citation in the case

#### Scenario: Evidence absent, authoring refused

- **WHEN** the user describes a failure with no observed evidence
- **THEN** the skill states that a case needs an observed failure and does not write one

#### Scenario: A captured skeleton satisfies the evidence requirement

- **WHEN** the user offers a case skeleton captured from a recorded run trajectory
- **THEN** the skill treats its provenance as observed-failure evidence and proceeds to author

#### Scenario: An unconfirmed value in a skeleton is resolved before authoring

- **WHEN** a captured skeleton carries a grader pattern or a prompt marked as requiring confirmation
- **THEN** the skill resolves it against the cited trajectory or asks the user
- **AND** it does not author a case that still carries the unconfirmed marker
