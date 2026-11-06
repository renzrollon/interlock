# Spec Delta

## Purpose

Defines `interlock run-log follow`, a reader that waits on one ship run's trajectory and prints a line when the run halts or completes. It is the text twin of the meter's notification for runs no interactive session is drawing (`-p`, cloud and `interlock-run`) and for a session that asks to watch one. It only reads, and it says what it cannot see.

## ADDED Requirements

### Requirement: `interlock run-log follow` SHALL print one line when the followed run halts or completes, and SHALL then exit 0

`interlock run-log follow` SHALL follow the trajectory most recently written under the state home's runs directory, or the one `--run <id>` names. When that trajectory holds a `run-halt` event it SHALL print one line naming the run, the change and the recorded reason; when it holds a `run-complete` event, one line naming the run and the change as complete. It SHALL exit 0 after either line. A run that already holds one of the two events when the verb starts SHALL get its line at once.

#### Scenario: Happy path — a halt appended while following is printed and ends the verb

- **GIVEN** a state home whose newest trajectory is run `r-7` of change `add-foo`, holding a `run-start` and wave events and no terminal event
- **WHEN** `interlock run-log follow` is running and a `run-halt` event with the reason `unit failures after 2 fix attempts` is appended
- **THEN** within one polling period it prints one line naming `r-7`, `add-foo`, the word `halted` and that reason
- **AND** it exits 0 and prints nothing else on standard output

#### Scenario: Failure — a named run that does not exist

- **GIVEN** a state home with trajectories, none for run `r-404`
- **WHEN** `interlock run-log follow --run r-404` runs
- **THEN** it prints one line naming `r-404` and saying no trajectory is recorded for it
- **AND** it exits 1

#### Scenario: Edge case — a run already complete, and a named run among newer ones

- **GIVEN** a state home whose newest trajectory `r-9` holds no terminal event and whose older trajectory `r-8` of change `fix-baz` holds a `run-complete` event
- **WHEN** `interlock run-log follow --run r-8` runs
- **THEN** it prints one line naming `r-8`, `fix-baz` and the word `complete`, and exits 0 without waiting
- **AND** the same verb with no `--run` follows `r-9`

### Requirement: The follower SHALL poll at the published meter tick, give up at the published launch-ledger age, and print no quiet line

Between reads the verb SHALL wait the period `interlock limits` prints as `meter tick (ms)`. When the followed trajectory was last written longer ago than `launch ledger max age (ms)` and holds neither terminal event, it SHALL print one line saying it stopped following a run with no recorded end, and exit 1. It SHALL print no line for a quiet run: the trajectory records the CLI's steps, so silence between two is a lane at work, and the verb's help SHALL say so.

#### Scenario: Happy path — a run at work prints nothing until it ends

- **GIVEN** a followed trajectory whose last event is an `agent-spawn` written twenty minutes ago
- **WHEN** three polling periods pass with nothing appended
- **THEN** the verb has printed nothing and is still following
- **AND** when a `run-complete` event is then appended, it prints the complete line and exits 0

#### Scenario: Failure — a run with no recorded end is given up on, aloud

- **GIVEN** a followed trajectory last written longer ago than the published launch-ledger age, holding no `run-halt` and no `run-complete` event
- **WHEN** the verb reads it
- **THEN** it prints one line naming the run, the time of its last event, and that it stopped following a run with no recorded end
- **AND** it exits 1

#### Scenario: Edge case — the bounds are the limits module's

- **GIVEN** the follow module and its CLI glue as text
- **WHEN** the limits tests run
- **THEN** both bounds are read from the limits module and no number of milliseconds is spelled in either file
- **AND** the pure reader, called with a clock and a wait passed in, makes each decision above without a real wait

### Requirement: The follower SHALL only read, SHALL say when there is nothing to follow, and its halt line SHALL be a record, never a request

The verb SHALL write nothing: no trajectory event, no metric and no other file. With no trajectory under the runs directory it SHALL print one line saying no run is recorded, and exit 1. A trajectory line it cannot parse SHALL be skipped, and the line it prints at the end SHALL say how many were. The halt line SHALL end by saying it is a record and asks for no relaunch, because a session's monitor may hand the line to a model.

#### Scenario: Happy path — following leaves the trajectory as it was

- **GIVEN** a trajectory that already holds a `run-halt` event
- **WHEN** `interlock run-log follow` runs and exits
- **THEN** the trajectory file's bytes are what they were, and no file was created under the state home
- **AND** the halt line ends with the words that it is a record and asks for no relaunch

#### Scenario: Failure — nothing to follow

- **GIVEN** a state home with no runs directory, or an empty one
- **WHEN** `interlock run-log follow` runs
- **THEN** it prints one line saying no run is recorded and names the directory it looked in
- **AND** it exits 1 and creates nothing

#### Scenario: Edge case — an unparseable line is skipped and counted

- **GIVEN** a trajectory holding two lines that are not JSON and then a `run-complete` event
- **WHEN** `interlock run-log follow` runs
- **THEN** it prints the complete line, which says two lines were skipped
- **AND** it exits 0
