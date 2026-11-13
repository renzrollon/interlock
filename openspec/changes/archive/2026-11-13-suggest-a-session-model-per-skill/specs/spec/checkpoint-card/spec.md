# Spec Delta

## MODIFIED Requirements

### Requirement: The checkpoint card SHALL be rendered by one pure, Node-free module, and its questions and outcomes SHALL be the checkpoint document's

`lib/checkpoint-card.mjs` SHALL import no `node:` module and SHALL render the card from the fields passed to it, the same way for the CLI and for the pane. Its per-artifact questions and its five outcome titles SHALL be the ones `docs/02-the-checkpoint.md` prints, in that order, and a test SHALL read that file and fail when either list differs. A field that was not passed SHALL read `not observed`, never a zero, a pass or a clear. The card SHALL combine nothing into a verdict of its own. One line is neither a passed field nor a title of the document: the session suggestion line, which is the published session-advice table's and takes no field.

#### Scenario: Happy path — the same fields render the same card for both callers

- **GIVEN** the fields of change `add-the-thing`: four artifacts with their paths and status words, a ledger line, a validate line, a gate line and a findings path
- **WHEN** the renderer is called twice with those fields
- **THEN** both calls return the same lines: each artifact's path and status beside its question, the three lines as passed, the findings path, the five outcomes in the document's order, and the session suggestion line
- **AND** no line states whether the change may ship

#### Scenario: Failure — a reworded checkpoint document fails the test

- **GIVEN** `docs/02-the-checkpoint.md` with an outcome title reworded, or a question added to its table
- **WHEN** the checkpoint-card tests run
- **THEN** a test fails naming the title or the question the module does not carry
- **AND** the same test fails when the module carries one the document does not print

#### Scenario: Edge case — a field that was not passed reads not observed

- **GIVEN** fields with no ledger line and no gate line
- **WHEN** the renderer is called
- **THEN** the ledger line and the gate line each read `not observed`
- **AND** an artifact passed with a path and no status reads its path and `not observed`

## ADDED Requirements

### Requirement: The card SHALL print the published session suggestion for the run after the outcome that starts it

The card SHALL end with one line keyed `checkpoint-session` that carries the model and effort the published session-advice table gives the `ship` skill, in the words the first line of `interlock suggest ship` prints. The line SHALL be the same for the CLI and for the pane, SHALL take no field, and SHALL hold no command, so no control is offered on it. It SHALL state nothing about the session the card is read in.

#### Scenario: Happy path — the card ends with the run's suggestion

- **GIVEN** the fields of change `add-the-thing` and the published `ship` row
- **WHEN** the card is rendered
- **THEN** its last line is keyed `checkpoint-session`, follows `checkpoint-outcome-5`, and names the row's model and effort
- **AND** the line's text equals the first line `interlock suggest ship` prints

#### Scenario: Failure — one table edit moves the card and the verb together

- **GIVEN** the `ship` row's effort changed in `lib/limits.mjs`
- **WHEN** the card is rendered and `interlock suggest ship` runs
- **THEN** both carry the new effort
- **AND** no edit to the card module was required

#### Scenario: Edge case — the line offers no command and observes nothing

- **GIVEN** the card rendered for a fixture change
- **WHEN** the checkpoint-card tests read its printed commands
- **THEN** the list is the one the five outcomes print, with nothing added by the session suggestion line
- **AND** the line names no observed effort and no observed model
