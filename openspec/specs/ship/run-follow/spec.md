# ship/run-follow Specification

## Purpose
Lets a person or a session follow a ship run from outside it: `interlock run-log follow` reads the run's trajectory and prints one line when the run halts or completes, then exits, so a waiting terminal or background task learns the end without polling by hand. Read-only, bounded by the published meter tick and launch-ledger age.

## Requirements

### Requirement: `interlock run-log follow` SHALL print one line when the followed run halts or completes, and SHALL then exit 0

`interlock run-log follow` SHALL follow the trajectory most recently written under the state home's runs directory, resolved one time at start, or the one `--run <id>` names. When that trajectory holds a `run-halt` event it SHALL print one line naming the run, the change and the recorded reason; when it holds a `run-complete` event, one line naming the run and the change as complete. It SHALL exit 0 after either line, at once for a run that already holds one.

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
- **AND** the same verb with no `--run` follows `r-9`, and keeps following `r-9` when a newer trajectory `r-10` is written while it waits

### Requirement: The end that counts SHALL be the run's latest, and the start-time race SHALL be said

The terminal event that counts SHALL be the last `run-halt` or `run-complete` after the last `run-start`, never the first one the file holds, and a halt line SHALL end the reason with one period, never two. Because the newest trajectory is resolved one time at start, a follower started before a new run writes its first event follows the previous run; the printed line names the run id, and the verb's help SHALL say so.

#### Scenario: Edge case — an old end before a later run-start is not the run's end

- **GIVEN** a trajectory `r-4` holding a `run-start`, a `run-halt` with the reason `the first halt`, and a second `run-start`
- **WHEN** `interlock run-log follow --run r-4` runs and a `run-complete` event is then appended
- **THEN** it waits rather than printing the first halt, then prints one line naming `r-4` as complete
- **AND** a halt whose recorded reason already ends in a period is printed with that one period

#### Scenario: Failure — the help names the start-time race

- **GIVEN** the shipped CLI
- **WHEN** `interlock run-log follow --help` is printed
- **THEN** it says the newest trajectory is resolved one time at start, that a follower started before a new run's first event follows the previous run, and that `--run <id>` pins one run

### Requirement: The follower SHALL poll at the published meter tick, give up at the published launch-ledger age, and print no quiet line

Between reads the verb SHALL wait the period `interlock limits` prints as `meter tick (ms)`. When the followed trajectory was last written longer ago than `launch ledger max age (ms)` and holds neither terminal event, it SHALL print one line saying it stopped following a run with no recorded end, and exit 1. It SHALL print no line for a quiet run, because the trajectory records only the CLI's steps. Its help SHALL say so and name the give-up bound by its limits label.

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
- **WHEN** the follower's tests run
- **THEN** both bounds are read from the limits module and no number of milliseconds is spelled in either file, and the help names the launch-ledger age by its limits label
- **AND** the pure reader, called with a clock and a wait passed in, makes each decision above without a real wait

### Requirement: The follower SHALL only read, SHALL say when there is nothing to follow, and its halt line SHALL be a record, never a request

The verb SHALL write nothing: no event, metric or other file. With no trajectory under the runs directory it SHALL print one line saying no run is recorded, and exit 1. A trajectory line it cannot parse SHALL be skipped, and a line another release wrote under a foreign schema SHALL be set aside; the line it prints at the end SHALL say how many of each were. The halt line SHALL end by saying it is a record and asks for no relaunch, because a session's monitor may hand the line to a model.

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

#### Scenario: Edge case — a foreign-schema line is set aside and said

- **GIVEN** a trajectory holding a `run-start`, one line tagged with another release's schema, one line that is not JSON, and a `run-halt` event
- **WHEN** `interlock run-log follow` runs
- **THEN** it prints the halt line, which says one unparseable line was skipped and one foreign-schema line was set aside
- **AND** it exits 0
