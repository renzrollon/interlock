## MODIFIED Requirements

### Requirement: Corpus coverage is reported before any indicator

The report SHALL report corpus coverage first: how many trajectories exist, how many carry a `run-start`, how many carry a terminal event (`run-complete` or `run-halt`), how many carry a `run-receipt`; how many outcome records exist by mode; and how many metrics files were recognized. Runs without a terminal event SHALL be split into interrupted — an interrupted-run note names the run — and unexplained, each printed as a count with the scanned runs as its denominator; a note that names no scanned trajectory SHALL be counted separately rather than joined to nothing. Scanned runs SHALL be partitioned by the surface their `run-start` event recorded — `main`, `linked-worktree`, `lane-worktree`, `unknown` — with a run that recorded none counted as unrecorded, each as a count over the scanned runs. Coverage SHALL also state how many trajectories exist in other linked worktrees of the state home's repository that the report did not read, as a count of files and of worktrees, read from version control's worktree list without opening any of them, or the reason that scan could not be made. Coverage SHALL be reported even when every subsequent indicator is unobserved.

#### Scenario: An empty corpus still yields a coverage section

- **WHEN** no outcome corpus exists and no trajectory carries a receipt
- **THEN** the report states the trajectory count, states that no trajectory carries a receipt, and states that no outcome record exists

#### Scenario: Coverage precedes the indicators in the human-readable output

- **WHEN** the report is printed without `--json`
- **THEN** the coverage section appears before the first indicator

#### Scenario: Happy path — a run without a terminal event and a note is interrupted

- **GIVEN** three scanned trajectories, one with no terminal event, and an interrupted-run note naming that run
- **WHEN** the report runs
- **THEN** coverage states one run without a terminal event, one interrupted and zero unexplained, over three scanned
- **AND** the JSON carries the same three counts

#### Scenario: Happy path — runs are partitioned by surface

- **GIVEN** four scanned trajectories whose `run-start` events record `main`, `main`, `linked-worktree` and no surface
- **WHEN** the report runs
- **THEN** coverage states two main, one linked-worktree and one unrecorded, over four scanned
- **AND** the JSON and the HTML carry the same partition

#### Scenario: Failure — a run without a terminal event and no note is unexplained

- **GIVEN** a scanned trajectory with no terminal event and no note naming it
- **WHEN** the report runs
- **THEN** coverage counts it as unexplained, not as interrupted
- **AND** the report exits zero

#### Scenario: Failure — the worktree scan cannot be made

- **GIVEN** a state home that is not a repository, or a `git` that fails
- **WHEN** the report runs
- **THEN** coverage states that trajectories in other worktrees could not be counted, with the reason
- **AND** every other coverage figure is reported and the report exits zero

#### Scenario: Edge case — a note without a trajectory is counted apart

- **GIVEN** an interrupted-run note whose run id matches no scanned trajectory
- **WHEN** the report runs
- **THEN** coverage reports one note without a trajectory
- **AND** the interrupted and unexplained counts are unchanged by it

#### Scenario: Edge case — trajectories stranded in another worktree are counted, not read

- **GIVEN** a state home whose repository has two linked worktrees, one holding three trajectory files under its own `.claude/ship/runs/`
- **WHEN** the report runs in the state home
- **THEN** coverage states three trajectories across one worktree were not read
- **AND** no indicator changes on their account, because none was opened
