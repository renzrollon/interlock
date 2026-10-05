## MODIFIED Requirements

### Requirement: Corpus coverage is reported before any indicator

The report SHALL report corpus coverage first: how many trajectories exist, how many carry a `run-start`, how many carry a terminal event (`run-complete` or `run-halt`), how many carry a `run-receipt`; how many outcome records exist by mode; and how many metrics files were recognized. Runs without a terminal event SHALL be split into interrupted — an interrupted-run note names the run — and unexplained, each printed as a count with the scanned runs as its denominator; a note that names no scanned trajectory SHALL be counted separately rather than joined to nothing. Coverage SHALL be reported even when every subsequent indicator is unobserved.

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

#### Scenario: Failure — a run without a terminal event and no note is unexplained

- **GIVEN** a scanned trajectory with no terminal event and no note naming it
- **WHEN** the report runs
- **THEN** coverage counts it as unexplained, not as interrupted
- **AND** the report exits zero

#### Scenario: Edge case — a note without a trajectory is counted apart

- **GIVEN** an interrupted-run note whose run id matches no scanned trajectory
- **WHEN** the report runs
- **THEN** coverage reports one note without a trajectory
- **AND** the interrupted and unexplained counts are unchanged by it
