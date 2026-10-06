## MODIFIED Requirements

### Requirement: The card SHALL be a record, never a trigger, and SHALL say so in the file

Nothing SHALL read the card back to decide anything. The ship loop, plan reuse and dispatch SHALL each decide exactly as they did before the card existed: reuse is established from the stored plan fingerprint alone, so a card that is missing, stale or hand-edited SHALL NOT change what a later run does. Two readers SHALL show the card and nothing more: the SessionStart preflight lists the cards of changes still open under `openspec/changes/`, from the stamp on each card's first line, so the hooks module can name them at session start; and the hooks module's `/interlock-handoff` renders a card verbatim on request. Neither SHALL act on its content, mark it, move it or delete it, and a card nobody shows is a card that still changes nothing.

The card SHALL state this about itself, in the file, and SHALL carry the same instruction not to start another ship run unless the user asks that the terminal summary ends with. The realistic reader of a file named for resuming is a model in a later session, and a markdown artifact that looks like a handoff is exactly the input that would otherwise be read as permission to act.

The card SHALL NOT be a mid-run resume. The wave cursor and the previous wave's handoff packets are not restored, because the run state file is replaced at the first wave of the next run, and the card SHALL state that limitation rather than let a reader infer continuity it does not have.

#### Scenario: Happy path — the card disclaims itself in its own body

- **WHEN** a card is written
- **THEN** it states that it is a record and not a trigger, and that the next ship decides what to skip from the stored plan fingerprint and never from the card
- **AND** it carries the instruction not to start another ship run unless the user asks

#### Scenario: Failure — a hand-edited card does not change a later run

- **GIVEN** a card whose plan section has been edited by hand to claim a plan is reusable
- **WHEN** a later ship run starts for that change
- **THEN** the reuse decision is made from the stored fingerprint alone
- **AND** the card is not read by the run

#### Scenario: Edge case — the card states that mid-run state is not resumed

- **WHEN** a card is written for a run that halted after executing waves
- **THEN** it states that the wave cursor and the previous wave's handoff packets are not resumed, and why
- **AND** it directs the reader to tick work already done but unticked before re-shipping, so it is not implemented twice

#### Scenario: Edge case — a card shown at session start is still only a record

- **GIVEN** a card for an open change listed by the SessionStart preflight and rendered by `/interlock-handoff`
- **WHEN** the next ship run starts for that change
- **THEN** the run's plan-reuse verdict, its dispatch and its gates are what they would be with no card on disk
- **AND** the card's content and its path are unchanged by having been shown
