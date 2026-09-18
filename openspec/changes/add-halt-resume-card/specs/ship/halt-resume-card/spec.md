## Purpose

Leaves a halted run legible to whoever picks it up in a session that saw none of it. Everything a halt records is already true and already scattered — the reason in a terminal nobody was watching, the walk in the trajectory, the plan beside its fingerprint, the unfinished boxes in `tasks.md` — and reassembling it by hand is the tax the loop charges precisely where it stopped on purpose. The card is that reassembly, written once, in one place, in prose. It is a record and never a trigger: nothing reads it back, so a card that is missing, stale or hand-edited cannot change what a later run does, and it never predicts a verdict that will be recomputed after it was written.

## ADDED Requirements

### Requirement: A halted close SHALL write exactly one resume card, and a clean close SHALL write none

When a ship run's close carries a halt reason, it SHALL write one markdown card under the repository's handoff directory, at a repo-relative path naming the change and the run. When the run closed without a halt, it SHALL write no card: a completed change has nothing to resume, and its summary already ends in the archive reminder.

A close that runs a second time for the same run SHALL replace that run's own card rather than add a second one. The card describes the run's final state, and two cards for one run would only ask a reader to work out which is current.

A run that halted before a plan was adopted has no run id. Its card SHALL still be written, under a name carrying a fixed literal in place of the run id rather than a blank or a clock-derived value, and the card SHALL state the absence of a run id rather than printing an empty value. A timestamped name would accumulate one file per failed invocation; what a reader wants is the latest state of this change, not a pile of them.

#### Scenario: Happy path — a halted run leaves one card the reader can find

- **GIVEN** a run for `add-widget` with a run id that closes with a halt reason
- **WHEN** the close runs
- **THEN** a card exists under the handoff directory named for `add-widget` and that run id
- **AND** its path is repo-relative, under a directory that is already ignored by version control

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

### Requirement: The card's path SHALL be derived from untrusted components that cannot escape the handoff directory

The change name and the run id both reach the close from a branch, a directory or a model, and SHALL be treated as untrusted path components. Each SHALL be reduced to a single filename-safe segment before it is joined into the path, and the resulting path SHALL always lie inside the handoff directory.

No segment SHALL contain a literal parent-directory marker. Removing the separators alone would already make traversal impossible, but a filename carrying that marker invites the next reader to decide it is acceptable somewhere else, so the marker SHALL be collapsed rather than merely rendered inert.

#### Scenario: Happy path — an ordinary change and run name map to themselves

- **GIVEN** a change name and run id made only of letters, digits, dots, dashes and underscores
- **WHEN** the card's path is derived
- **THEN** both appear in the filename unchanged
- **AND** the path is under the handoff directory

#### Scenario: Failure — a traversal attempt cannot leave the handoff directory

- **GIVEN** a change name of `../../etc/passwd` and a run id of `a/b/../c`
- **WHEN** the card's path is derived
- **THEN** the path still starts with the handoff directory
- **AND** the path contains no parent-directory marker

#### Scenario: Edge case — a name that reduces to nothing still yields a card

- **GIVEN** a change name or run id that is empty, absent, or made entirely of characters that are stripped
- **WHEN** the card's path is derived
- **THEN** a fixed fallback segment is used in its place
- **AND** the path is still a single file under the handoff directory

### Requirement: The card SHALL be a record, never a trigger, and SHALL say so in the file

Nothing SHALL read the card back. The ship loop, plan reuse and dispatch SHALL each decide exactly as they did before the card existed: reuse is established from the stored plan fingerprint alone, so a card that is missing, stale or hand-edited SHALL NOT change what a later run does.

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
- **AND** the card is not read

#### Scenario: Edge case — the card states that mid-run state is not resumed

- **WHEN** a card is written for a run that halted after executing waves
- **THEN** it states that the wave cursor and the previous wave's handoff packets are not resumed, and why
- **AND** it directs the reader to tick work already done but unticked before re-shipping, so it is not implemented twice

### Requirement: The card SHALL report this run's own plan verdict and SHALL NOT predict the next one

The card SHALL state which plan path this run took: that the stored plan was reused, or that the plan was rebuilt — each with the status and reason the run recorded — or, when the run ended before the plan-reuse check reported, that the verdict was never observed. Those are three distinct facts and SHALL NOT be collapsed: "we never found out" is not "the plan was rebuilt".

It SHALL then state whether a stored plan and its fingerprint are on disk and name this change, and SHALL state the reuse rule: ticking a task box does not invalidate the fingerprint, while editing an artifact, adding, removing, reordering or rewording a task, or passing a different mode shape does.

It SHALL NOT state or imply what the next run will decide. The fingerprint is recomputed at the next run's start, against artifacts that may change in between, so a prediction would be wrong exactly when a reader relied on it.

#### Scenario: Happy path — a reused plan is reported as reused, with what is stored

- **GIVEN** a run that reused a stored plan and halted afterwards
- **WHEN** the card is written
- **THEN** it states that this run reused the stored plan, with the recorded status and reason
- **AND** it names the stored plan and fingerprint files as present for this change
- **AND** it states the reuse rule rather than a verdict for the next run

#### Scenario: Failure — a verdict this run never reached is reported as unobserved

- **GIVEN** a run that halted before the plan-reuse check reported
- **WHEN** the card is written
- **THEN** it states that the run ended before the plan-reuse check reported
- **AND** it does not report the plan as rebuilt

#### Scenario: Edge case — no stored plan names this change

- **GIVEN** a halted run for a change with no stored plan on disk
- **WHEN** the card is written
- **THEN** it states that the next ship classifies the waves again, as the normal cost of a first run
- **AND** it does not name a stored fingerprint file that is not there

### Requirement: The card SHALL carry what a reader with no context needs, and SHALL state each absence

The card SHALL carry: the halt reason; where the run stopped — the change, the run id, the project slug, the directory the close ran in, the trajectory path, and the commands that replay that trajectory and filter it to the events explaining the halt; the task ids still unticked, with a ready-to-paste command that ticks them; the plan section; the per-wave tallies as far as the run got; the degradation banners raised before the halt; and how to pick the change up, including the command that starts a new run when a person asks for one.

Each absent section SHALL be stated as a sentence rather than printed as an empty section: every box already ticked, no wave recorded, no banner raised, and a halt that recorded no reason at all. A heading over nothing reads as a fact the writer failed to gather.

A replay command SHALL be printed only when there is a run id to name in it. A command a reader cannot run is worse than its absence.

#### Scenario: Happy path — a halted run with leftovers, waves and banners

- **GIVEN** a run that halted with unticked tasks, at least one recorded wave, and at least one degradation banner
- **WHEN** the card is written
- **THEN** it names the halt reason, the run id, the project slug and the directory the close ran in
- **AND** it names the trajectory and the commands that replay it and filter it to the halt
- **AND** it lists the unticked task ids and a ready-to-paste command that ticks exactly those ids
- **AND** it lists the wave tallies and the banners

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

### Requirement: Every list SHALL be bounded by the published cap, and the truncation SHALL be spoken

Every list the card prints — unticked task ids, wave tallies, degradation banners — SHALL be capped at the published per-list row cap, read from the limits the CLI publishes rather than restated anywhere. The cap's value SHALL NOT appear in prose, in a spec, or as a literal in a test.

When a list is truncated, the card SHALL state how many rows it left out and name where the full list is. A silent head would make the card lie about the one thing it exists to summarize. An oversized halt reason SHALL likewise be truncated with a visible marker rather than cut.

#### Scenario: Happy path — a list within the cap prints whole and says nothing about omission

- **GIVEN** a halted run whose unticked task ids number no more than the published cap
- **WHEN** the card is written
- **THEN** every id is listed
- **AND** no omission line is printed

#### Scenario: Failure — an oversized list names what it left out

- **GIVEN** a halted run with more unticked task ids than the published cap allows
- **WHEN** the card is written
- **THEN** the ids beyond the cap are absent from the list
- **AND** the card states how many rows were left out and names the file that holds the full list

#### Scenario: Edge case — an oversized halt reason is truncated visibly

- **GIVEN** a halt reason far longer than the card's reason budget
- **WHEN** the card is written
- **THEN** the reason is shortened and carries a visible truncation marker
- **AND** the full reason is not printed

### Requirement: A card that cannot be written SHALL be bannered and SHALL NOT move the exit code

The card writer SHALL NOT throw. A read-only checkout, a full disk, an unwritable handoff path, a missing root or an empty root SHALL each return a stated reason rather than an exception.

A failed write SHALL raise a degradation banner naming the reason, and SHALL leave the close's exit code exactly as the halt set it. The summary's row naming the card SHALL then be absent, because a row naming a file that is not there would be worse than no row.

This is deliberately the outcome-corpus class of this repository's corpus-loss semantics and not the trajectory's. The card is a pointer to records that were already written — the trajectory, the receipt, the plan, the task boxes — so losing it costs a reader convenience, not evidence. A fatal card would also let a read-only checkout change *how a run halted*, which is the one thing a post-halt artifact must never do. The loss SHALL NOT be silent: the banner is what distinguishes a lost card from a run that had nothing to write.

#### Scenario: Happy path — a written card returns its repo-relative path

- **GIVEN** a writable repository root
- **WHEN** the card is written
- **THEN** the handoff directory is created if absent and the card is written into it
- **AND** the returned path is repo-relative, so it can be printed beside the directory the close ran in

#### Scenario: Failure — an unwritable handoff path is bannered, not thrown

- **GIVEN** a halted close whose handoff directory cannot be created
- **WHEN** the close runs
- **THEN** it raises a degradation banner naming the card as not written and stating the reason
- **AND** the exit code is the halt's own, unchanged
- **AND** the summary carries no row naming a card

#### Scenario: Edge case — a missing or empty root is refused by name

- **GIVEN** a root that is empty or does not exist
- **WHEN** a card write is attempted against it
- **THEN** the attempt reports that it did not write and states which of the two conditions held
- **AND** no exception propagates to the close
