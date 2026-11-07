# Spec Delta

## Purpose

Defines the card a person reads at the spec checkpoint: the change's artifacts with the question asked of each, the ledger, validate and gate lines, and the five outcomes with the command each one runs. One pure renderer builds it for the CLI verb `interlock checkpoint <change>` and for the spec pane, so the two cannot drift, and the spec skill prints it where it stops. The card decides nothing: the person picks the outcome.

## ADDED Requirements

### Requirement: The checkpoint card SHALL be rendered by one pure, Node-free module, and its questions and outcomes SHALL be the checkpoint document's

`lib/checkpoint-card.mjs` SHALL import no `node:` module and SHALL render the card from the fields passed to it, the same way for the CLI and for the pane. Its per-artifact questions and its five outcome titles SHALL be the ones `docs/02-the-checkpoint.md` prints, in that order, and a test SHALL read that file and fail when either list differs. A field that was not passed SHALL read `not observed`, never a zero, a pass or a clear. The card SHALL combine nothing into a verdict of its own.

#### Scenario: Happy path — the same fields render the same card for both callers

- **GIVEN** the fields of change `add-the-thing`: four artifacts with their paths and status words, a ledger line, a validate line, a gate line and a findings path
- **WHEN** the renderer is called twice with those fields
- **THEN** both calls return the same lines: each artifact's path and status beside its question, the three lines as passed, the findings path, and the five outcomes in the document's order
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

### Requirement: Each outcome SHALL print the command it runs, and a send-back SHALL print no record line

The card SHALL print `/interlock:ship <change>` under the outcome that it looks right; `/interlock:spec` alone under each send-back outcome (no record line: D6); `interlock validate <change>` under small gaps; and, under reported blockers, `/interlock:review-artifacts <change> --since <findings file>` only when a findings file was passed. A command that takes a change SHALL carry its name; none SHALL hold a placeholder; each SHALL be one the plugin ships.

#### Scenario: Happy path — five outcomes, each with its command

- **GIVEN** the fields of change `add-the-thing` with the findings path `.claude/metrics/review-artifacts-add-the-thing-20261106-101500.json`
- **WHEN** the card is rendered
- **THEN** it prints `/interlock:ship add-the-thing`, `/interlock:spec` under each send-back outcome with no `interlock autonomy record` line, `interlock validate add-the-thing`, and `/interlock:review-artifacts add-the-thing --since .claude/metrics/review-artifacts-add-the-thing-20261106-101500.json`
- **AND** `printedCommands` over the card's text returns exactly those lines, each one time, in the order printed

#### Scenario: Failure — no findings file, no re-gate command

- **GIVEN** the fields of a change with no findings path
- **WHEN** the card is rendered
- **THEN** the outcome for reported blockers prints no command and says no findings file was observed
- **AND** the other four outcomes print their commands as before

#### Scenario: Edge case — every printed command is one the plugin ships

- **GIVEN** the card rendered for a fixture change
- **WHEN** the checkpoint-card tests read its printed commands
- **THEN** each `interlock` line is accepted by the CLI's own verb and flag inventory
- **AND** each `/interlock:` line names a skill directory the plugin ships, and no line holds `<` or `>`

### Requirement: `interlock checkpoint <change>` SHALL print the card in any session, from the change's own files, and SHALL only read

`interlock checkpoint <change>` SHALL print the card for the named change: each artifact's path and whether it is present, the ledger audit with its `needs_human` rows, the validate result, and the newest review-artifacts findings file under `.claude/metrics/` with the gate's reading of it. It SHALL write no file and start no process. It SHALL exit 0 when the change resolves, and 1 naming the open changes when it does not. `--json` SHALL print the fields the card was rendered from.

#### Scenario: Happy path — a change at its checkpoint prints its card

- **GIVEN** a change `add-the-thing` with its four artifacts, a `decisions.md` holding one `needs_human` row `D3`, and a findings file under `.claude/metrics/` whose gate reading is one blocker
- **WHEN** `interlock checkpoint add-the-thing` runs
- **THEN** it prints the four artifact paths as present with their questions, the ledger line with row `D3` and its question beneath it, the validate line, the gate line with one blocker, and the five outcomes with their commands
- **AND** it exits 0, and no file under the working root or the state home was created or changed

#### Scenario: Failure — a change that does not resolve

- **GIVEN** no directory `openspec/changes/nope/`
- **WHEN** `interlock checkpoint nope` runs
- **THEN** it prints that `nope` was not found and the names of the open changes, and with `--json` an object holding `error` and `candidates`
- **AND** it exits 1

#### Scenario: Edge case — no ledger, no findings file, and a missing artifact

- **GIVEN** a change with no `decisions.md`, no findings file under `.claude/metrics/`, and no `design.md`
- **WHEN** `interlock checkpoint` runs for it
- **THEN** the ledger line says the ledger is missing as `interlock ledger` words it, the gate line says no findings file is recorded, and `design.md` reads as missing beside its question
- **AND** it exits 0, because the verb reports the checkpoint and gates nothing

### Requirement: The spec skill SHALL print the card where it stops, and the line SHALL be pinned by token and left unread by the spec meter

`skills/spec/SKILL.md` SHALL carry, in its hand-off section before `interlock notify checkpoint`, the fenced line `interlock checkpoint "<change-name>"`, pinned in `test/skills.test.mjs` by its tokens and order and passed through unread by the spec meter. The line SHALL be the plain command, with no redirect or compound. A non-zero exit SHALL be reported in one line and SHALL NOT stop the hand-off; an `Unknown command` answer SHALL be named as version skew.

#### Scenario: Happy path — the card is printed before the checkpoint line

- **GIVEN** the spec skill as shipped
- **WHEN** the skill tests read its fenced lines
- **THEN** `interlock checkpoint "<change-name>"` is present in the hand-off section and comes before `interlock notify checkpoint "<change-name>"`
- **AND** the spec meter's classifier returns no kind for it, and the run still stops at its checkpoint when the notify line crosses

#### Scenario: Failure — the line removed or moved fails the pin

- **GIVEN** `skills/spec/SKILL.md` with the checkpoint line deleted, or moved after the notify line
- **WHEN** `node --test test/skills.test.mjs` runs
- **THEN** the pin fails naming the token `checkpoint` or the order
- **AND** a reworded sentence beside the line does not fail it

#### Scenario: Edge case — a card that could not be printed does not stop the hand-off

- **GIVEN** a spec run whose `interlock checkpoint` line exits 1
- **WHEN** the skill reaches its hand-off
- **THEN** the skill's text says to report it in one line and go on to the notify line
- **AND** an older `interlock` that answers `Unknown command` is reported as version skew, naming `interlock doctor`
- **AND** the checkpoint document names `interlock checkpoint <change-name>` as the way to print the card again in a later session
