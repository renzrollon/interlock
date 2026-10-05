## MODIFIED Requirements

### Requirement: A halted close SHALL write exactly one resume card, and a clean close SHALL write none

When a ship run's close carries a halt reason, it SHALL write one markdown card under the handoff directory of the run's state home — the main checkout when the run ran in a linked worktree, the working root otherwise — at a home-relative path naming the change and the run. When the run closed without a halt, it SHALL write no card: a completed change has nothing to resume, and its summary already ends in the archive reminder.

A close that runs a second time for the same run SHALL replace that run's own card rather than add a second one. The card describes the run's final state, and two cards for one run would only ask a reader to work out which is current.

A run that halted before a plan was adopted has no run id. Its card SHALL still be written, under a name carrying a fixed literal in place of the run id rather than a blank or a clock-derived value, and the card SHALL state the absence of a run id rather than printing an empty value. A timestamped name would accumulate one file per failed invocation; what a reader wants is the latest state of this change, not a pile of them.

#### Scenario: Happy path — a halted run leaves one card the reader can find

- **GIVEN** a run for `add-widget` with a run id that closes with a halt reason
- **WHEN** the close runs
- **THEN** a card exists under the handoff directory named for `add-widget` and that run id
- **AND** its path is repo-relative, under a directory that is already ignored by version control

#### Scenario: Happy path — a linked-worktree halt leaves its card in the main checkout

- **GIVEN** a run in a linked worktree of `/r` that closes with a halt reason
- **WHEN** the close runs
- **THEN** the card exists under `/r/.claude/handoff/` and not under the worktree
- **AND** the summary's resume-card row names it relative to `/r`

#### Scenario: Failure — a clean close leaves nothing to resume

- **GIVEN** a run that closes without a halt reason
- **WHEN** the close runs
- **THEN** no card is written for that run
- **AND** the summary carries no row naming one

#### Scenario: Edge case — a halt before any plan was adopted

- **GIVEN** a run that halted before a plan was adopted, so no run id exists
- **WHEN** the card is written
- **THEN** its name carries the fixed no-run-id literal rather than a blank or a timestamp
- **AND** the card states that no run id exists rather than printing an empty value
- **AND** it prints no trajectory-replay command, because there is no run id to name in one

#### Scenario: Edge case — a second close of the same run replaces its own card

- **GIVEN** a card already written for a run
- **WHEN** that run is closed again with a different halt reason
- **THEN** the card at the same path carries the second reason
- **AND** no second card exists for that run

### Requirement: The card SHALL carry what a reader with no context needs, and SHALL state each absence

The card SHALL carry: the halt reason; where the run stopped — the change, the run id, the project slug, the directory the close ran in, the state home when it differs, the trajectory path, and the commands that replay that trajectory and filter it to the events explaining the halt; the task ids still unticked, with the tick command a reader runs after deciding which of them are actually done; the plan section; the per-wave tallies as far as the run got; the lanes for which the host recorded a session identifier, each with its outcome and the command `claude --resume <session-id> --fork-session`, and the sentence that the command works only if the session still exists, because the host deletes transcripts after its retention period and a session deleted in the desktop app is gone with its transcript; the degradation banners raised before the halt; and how to pick the change up, including the command that starts a new run when a person asks for one.

The tick command SHALL NOT be runnable over the whole leftover list. A halt leaves two kinds of unticked box — work done on disk and never marked, and work never attempted at all — and the card cannot tell them apart: `interlock tasks tick` flips a marker by id and verifies nothing. A command carrying every leftover id would therefore tick unimplemented work, destroying the only on-disk record of what remains, which is the outcome the halt that wrote the card exists to prevent. The ids SHALL be listed for reading, and the command SHALL carry a placeholder the reader replaces with the subset they have checked.

Each absent section SHALL be stated as a sentence rather than printed as an empty section: every box already ticked, no wave recorded, no banner raised, no lane with a recorded session, and a halt that recorded no reason at all. A heading over nothing reads as a fact the writer failed to gather.

A replay command SHALL be printed only when there is a run id to name in it. A resume command SHALL be printed only for a lane with a recorded session identifier. A command a reader cannot run is worse than its absence.

#### Scenario: Happy path — a halted run with leftovers, waves and banners

- **GIVEN** a run that halted with unticked tasks, at least one recorded wave, and at least one degradation banner
- **WHEN** the card is written
- **THEN** it names the halt reason, the run id, the project slug and the directory the close ran in
- **AND** it names the trajectory and the commands that replay it and filter it to the halt
- **AND** it lists the unticked task ids, and a tick command whose id list is a placeholder rather than those ids
- **AND** it says to tick only the ids the reader has checked are implemented
- **AND** it lists the wave tallies and the banners

#### Scenario: Happy path — failed runner lanes list their sessions

- **GIVEN** a `--host claude` run that halted after two lanes failed, each with a session identifier in its host record
- **WHEN** the card is written
- **THEN** it lists both lanes with their outcome and a `claude --resume <session-id> --fork-session` command each
- **AND** it says the command works only if the session still exists, naming the retention period and the deleted-session case as the two reasons it may not

#### Scenario: Edge case — an empty run states each absence

- **GIVEN** a run that halted before any wave, with every task box ticked and no banner raised
- **WHEN** the card is written
- **THEN** it states that every box is ticked and that the halt was not about unfinished tasks
- **AND** it states that no wave was recorded and that no degradation banner was raised
- **AND** it prints no replay command, because the run has no run id

#### Scenario: Edge case — a halt with no recorded reason

- **GIVEN** a close that carries a halt but no reason text
- **WHEN** the card is written
- **THEN** it states that the run halted without recording a reason
- **AND** it does not print a blank where the reason belongs

#### Scenario: Edge case — a Workflow-host halt has no lane sessions

- **GIVEN** a halted run on the Workflow host, where no lane has a host session identifier
- **WHEN** the card is written
- **THEN** it states that no lane recorded a host session rather than printing an empty lane list
- **AND** it prints no resume command
