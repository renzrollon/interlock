## ADDED Requirements

### Requirement: The reader SHALL read every corpus from the state home and SHALL report the home it used

`interlock report`, and every other command that reads a corpus — the run-log commands, the outcome commands and the eval capture — SHALL resolve the state home for the root it was given, or take the explicit home from the flag or the environment, and SHALL read the trajectories, the outcome corpus, the review metrics and the interrupted-run notes from there. The report's output SHALL name the home it read from and the surface of the root it ran in. A reader whose home could not be resolved SHALL read from the root and SHALL say the home was unresolved and why, and SHALL still exit zero.

#### Scenario: Happy path — the report in a worktree reads the main checkout

- **GIVEN** `interlock report` run from a linked worktree of `/r` holding no corpora
- **WHEN** the report runs
- **THEN** it reads `/r/.claude/ship/runs/`, `/r/.claude/learning/outcomes.jsonl` and `/r/.claude/metrics/`
- **AND** its output names `/r` as the home and `linked-worktree` as the surface

#### Scenario: Failure — the home cannot be resolved

- **GIVEN** a root where version control cannot be read
- **WHEN** the report runs
- **THEN** it reads from the root, says the home was unresolved with the reason, and exits zero

#### Scenario: Edge case — an explicit home wins

- **GIVEN** `--state-home /elsewhere` passed to the report from a linked worktree
- **WHEN** the report runs
- **THEN** it reads every corpus from `/elsewhere` and names it as the home
- **AND** the surface it names is still the root's
