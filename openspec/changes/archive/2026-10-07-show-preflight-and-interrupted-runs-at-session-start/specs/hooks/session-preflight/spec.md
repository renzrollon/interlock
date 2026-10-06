## ADDED Requirements

### Requirement: The SessionStart preflight SHALL leave this session's report in one schema-stamped file

In a project where a ship run can start, which is one whose working root holds an `openspec/` directory, the SessionStart hook SHALL write the report it computed to `.claude/ship/preflight.json` under the working root, as one JSON object stamped `interlock.preflight/1`, carrying: the time it was written; the session-start source the host named in its event, or null; the working root; the state home and surface the doctor resolved, or null when the doctor could not run; the advisory message the hook folded into the session, verbatim; whether the doctor ran and could be parsed, its overall verdict, its counts, and for every check its id, status, detail and fix; the interrupted-run notes the hook spoke at this session start, each with its banner line and whether its mark landed; the notes it could not read; and the halt resume cards it listed. In any other repository the hook SHALL write nothing and create no directory, and its advisory output SHALL be what it is today. The file is session-shaped working state, not a corpus: it SHALL be written whole, the previous session's file SHALL be removed before the new one is written so a failed write leaves no stale report, and a write that fails SHALL be one line on the hook's error stream with the hook still exiting 0 and still emitting its advisory output. The hook SHALL start no process for the write and SHALL NOT touch the run trajectory.

#### Scenario: Happy path — an OpenSpec project gets this session's report

- **GIVEN** a working root with an `openspec/` directory and a doctor reporting one warning and no failure
- **WHEN** the SessionStart hook runs
- **THEN** `.claude/ship/preflight.json` exists under the working root, stamped `interlock.preflight/1`, carrying the message `interlock preflight OK (1 warning).`, the doctor's verdict and counts, and the warning check's id, status and detail
- **AND** the hook's advisory output is unchanged and the process exits 0

#### Scenario: Failure — the file cannot be written

- **GIVEN** an OpenSpec project whose `.claude/ship/` cannot be created or written
- **WHEN** the SessionStart hook runs
- **THEN** the hook names the failed write and its reason on its error stream
- **AND** it exits 0 and its advisory output still carries the preflight's verdict
- **AND** no earlier session's file is left in place for the write that failed

#### Scenario: Edge case — a repository with no OpenSpec project writes nothing

- **GIVEN** a working root with no `openspec/` directory
- **WHEN** the SessionStart hook runs
- **THEN** no `.claude/ship/preflight.json` exists and no directory was created
- **AND** the advisory output is exactly what the hook emits today for that root

#### Scenario: Edge case — a doctor that could not run is still reported in the file

- **GIVEN** an OpenSpec project in which the `interlock` binary cannot be resolved
- **WHEN** the SessionStart hook runs
- **THEN** the file is written with the doctor marked as not run, no checks, a null state home, and the message saying the preflight could not run
- **AND** the hook exits 0

### Requirement: The SessionStart preflight SHALL list the halt resume cards of open changes

The SessionStart hook SHALL list the halt resume cards under the handoff directory of the state home the doctor resolved and, when the working root differs from it, under the working root's handoff directory too, reading each card's first-line stamp for its change and run id. A card whose change still has a directory under the working root's `openspec/changes/` SHALL be recorded in the report file with its absolute path, change, run id and modification time; the cards of changes no longer under `openspec/changes/` SHALL be counted, not listed; a file in the handoff directory without a readable card stamp SHALL be named as unreadable with its reason. A card is a record and never a trigger: the hook SHALL NOT read past the stamp, SHALL NOT mark, move or delete a card, and SHALL NOT change its advisory output on account of a card. An absent handoff directory is no cards and no error.

#### Scenario: Happy path — one open change has a card

- **GIVEN** a state home whose `.claude/handoff/` holds `ship-add-foo-r-1.md` stamped `interlock.resume-card/1 change=add-foo run=r-1`, and `openspec/changes/add-foo/` in the working root
- **WHEN** the SessionStart hook runs
- **THEN** the report file lists one card with that path, change `add-foo`, run `r-1` and the file's modification time
- **AND** the card's content is unchanged and the advisory output does not mention it

#### Scenario: Failure — a card without a readable stamp is named

- **GIVEN** a handoff directory holding `ship-x-y.md` whose first line is not a card stamp
- **WHEN** the SessionStart hook runs
- **THEN** the report file names that file as unreadable with the reason
- **AND** the hook exits 0

#### Scenario: Edge case — an archived change's card is counted, not listed

- **GIVEN** a card for change `old-thing` and no `openspec/changes/old-thing/` directory
- **WHEN** the SessionStart hook runs
- **THEN** the report file lists no card for `old-thing` and counts one card of an archived change
- **AND** a root with no handoff directory lists no card, counts none and creates nothing

## MODIFIED Requirements

### Requirement: The SessionStart preflight SHALL surface unspoken interrupted-run notes

The SessionStart hook SHALL read the interrupted-run notes in the project root and, for each not yet spoken, SHALL add `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>` to its advisory output and SHALL mark that note spoken at the same session start, because a session start now reaches the person as well as the model and a note nobody clears must not be said at every session start. A note that cannot be marked SHALL be said so in the report file and SHALL be spoken again at the next session start and the next run start, which is the direction to fail in. The run program's own marking at run start is unchanged, so a note no session start preceded is still spoken there. A note that cannot be read SHALL be named as unreadable. The hook SHALL exit 0 on every path, and a root with no notes SHALL produce the advisory output it produces today.

#### Scenario: Happy path — an unspoken note is surfaced at session start

- **GIVEN** an unspoken note for run `r-1` of change `add-foo` at stage `verify`
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output contains `PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage verify`
- **AND** the note on disk now carries a spoken time, and the report file records the note with its banner line and its mark as landed
- **AND** a second session start speaks it no more and the report file then records no note

#### Scenario: Failure — an unreadable note is named and the session starts

- **GIVEN** a note file that is not valid JSON
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output says a note could not be read and names the file
- **AND** the hook exits 0

#### Scenario: Failure — a note that cannot be marked is spoken again

- **GIVEN** an unspoken note on a filesystem the hook cannot write
- **WHEN** the SessionStart hook runs twice
- **THEN** the banner is in the advisory output both times
- **AND** the report file records the note with its mark as not landed and the reason, and the hook exits 0 both times

#### Scenario: Edge case — no notes leaves the preflight's output unchanged

- **GIVEN** a root with no `.claude/ship/interrupted/` directory
- **WHEN** the SessionStart hook runs
- **THEN** its advisory output is exactly the preflight's existing confirmation or failure report
- **AND** no notes directory is created

### Requirement: The SessionStart preflight SHALL read interrupted-run notes from the state home the doctor resolved

The preflight SHALL read the home from the doctor's machine-readable output and surface unspoken interrupted-run notes from that home's notes directory, marking each note it speaks in the directory it was read from, so a worktree session reports the notes a worktree run left in the main checkout and marks them there. When the doctor's output carries no home the preflight SHALL read from the working directory as before. A run whose note is in both places SHALL be spoken once and marked in both.

#### Scenario: Happy path — a note in the main checkout is surfaced in the worktree

- **GIVEN** an unspoken note under `/r/.claude/ship/interrupted/` and a session starting in a linked worktree of `/r`
- **WHEN** the preflight runs
- **THEN** its output carries the note's line and the note under `/r` now carries a spoken time
- **AND** the report file under the worktree records the note and names `/r` as the state home

#### Scenario: Failure — the doctor could not run

- **GIVEN** a preflight whose doctor invocation produced no readable output
- **WHEN** the preflight runs
- **THEN** it reads notes from the working directory, marks the ones it speaks there, says the preflight could not run, and exits 0

#### Scenario: Edge case — a note in the worktree itself

- **GIVEN** a note written under the worktree's own `.claude/ship/interrupted/` by a run whose manifest recorded no home
- **WHEN** the preflight runs in that worktree with the doctor resolving `/r`
- **THEN** the note under `/r` is read and the worktree's own note is read too, so neither is lost
- **AND** a run whose note is in both is spoken once and both notes carry a spoken time afterwards
