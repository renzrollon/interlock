## ADDED Requirements

### Requirement: A clean completion that made a commit SHALL name the settle step

On a close that did not halt, recorded a commit and left no leftover tasks, the summary SHALL print, directly before the archive reminder, the line `NEXT — push the branch and open the pull request: /interlock:settle --create --review`. A halted run, a close that recorded no commit, and a close with leftovers SHALL print no such line. The existing contract lines SHALL be untouched.

Rationale: the only shipped text naming `/interlock:settle` was one line in the commit skill, and the summary a person reads after a ship ended in an instruction not to start another run, answering a question nobody asked.

#### Scenario: Happy path — a clean committed close

- **GIVEN** a closed summary that did not halt, with a commit recorded and no leftovers, for a change not yet archived
- **WHEN** the summary is rendered
- **THEN** the `NEXT —` line names `/interlock:settle --create --review`
- **AND** it precedes the `ARCHIVE PENDING` line, and `Do not start another ship run unless the user asks.` still follows

#### Scenario: Failure — a halt, and a close with no commit

- **GIVEN** a halted summary, and a clean summary whose commit was skipped or failed
- **WHEN** each is rendered
- **THEN** neither carries a `NEXT —` line
- **AND** every line the halt carried before this requirement is still present

#### Scenario: Edge case — leftovers

- **GIVEN** a clean committed close with one leftover task
- **WHEN** the summary is rendered
- **THEN** it carries no `NEXT —` line and no archive reminder
- **AND** a lean run's `LEAN SHIP` line is unchanged
