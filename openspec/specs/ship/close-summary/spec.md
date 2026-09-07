# ship/close-summary Specification

## Purpose
Defines what the terminal ship summary carries beyond its degradation block so a reader who was not watching can find the run afterwards and knows the one chore the run cannot do for them: the run id and the directory the close ran in, and a reminder to archive a completed change after it merges.

## Requirements

### Requirement: The summary SHALL name the run and where it closed

Every terminal summary SHALL carry a `run: <runId>` row, a `project: <slug>` row and a `cwd: <absolute path>` row. `<runId>` is the trajectory's run id; when the run halted before a plan was adopted and therefore has no run id, the row SHALL read `run: none — the run halted before a plan was adopted` rather than printing an empty value. `<slug>` is the directory name the host uses under `~/.claude/projects` for the directory the close ran in: the absolute path with every character outside ASCII letters and digits replaced by `-`. The documentation SHALL state that the slug is derived from the directory the close ran in, which is the host's project directory only when the session was started there.

#### Scenario: Happy path — a clean run names itself

- **GIVEN** a run with run id `7c2f…` closing in `/Users/x/IdeaProjects/specflow`
- **WHEN** the summary is printed
- **THEN** it carries `run: 7c2f…`, `project: -Users-x-IdeaProjects-specflow` and `cwd: /Users/x/IdeaProjects/specflow`
- **AND** both hosts print the same three rows for the same run state

#### Scenario: Edge case — a halt before any plan was adopted

- **GIVEN** a run that halted at validation, so the manifest carries no run id
- **WHEN** the summary is printed
- **THEN** the run row reads `run: none — the run halted before a plan was adopted`
- **AND** the project and cwd rows are still printed

#### Scenario: Edge case — the slug rule over dots, spaces and underscores

- **GIVEN** the close ran in `/Users/x/Application Support/repo/.claude/worktrees/w_1`
- **WHEN** the slug is derived
- **THEN** it is `-Users-x-Application-Support-repo--claude-worktrees-w-1`
- **AND** the derivation is a pure function of the path with no filesystem access

### Requirement: A clean completion SHALL remind the reader to archive after merge

When the run completes without a halt and every task of the change is ticked, the summary SHALL carry the line `ARCHIVE PENDING — <change>: after merge, run openspec archive <change>`. When other changes under the planning directory are also complete and unarchived, the summary SHALL add one line `also unarchived: <n> completed change(s) — run interlock drift`. The reminder SHALL NOT be printed on a halt, and SHALL NOT be printed when tasks are left unticked, because in both cases the change is not complete. The reminder SHALL NOT archive anything and SHALL NOT change the exit code: the decision to archive belongs to whoever merges.

#### Scenario: Happy path — one clean change

- **GIVEN** a run for `add-thing` that committed with every task ticked, and no other unarchived change
- **WHEN** the summary is printed
- **THEN** it carries `ARCHIVE PENDING — add-thing: after merge, run openspec archive add-thing`
- **AND** it carries no `also unarchived:` line
- **AND** the exit code is `0`

#### Scenario: Happy path — the ground was already stale

- **GIVEN** the same run, and two other changes whose tasks are all ticked still under the planning directory
- **WHEN** the summary is printed
- **THEN** it carries the `ARCHIVE PENDING — add-thing` line and `also unarchived: 2 completed change(s) — run interlock drift`

#### Scenario: Failure — a halted run is not reminded

- **GIVEN** a run halted by the failure budget
- **WHEN** the summary is printed
- **THEN** it carries no `ARCHIVE PENDING` line
- **AND** its first line is still `SHIP HALTED — <reason>`

#### Scenario: Edge case — leftovers

- **GIVEN** a run that completed with two tasks still unticked
- **WHEN** the summary is printed
- **THEN** its first line is `SHIP COMPLETE WITH LEFTOVERS — <change>` and it carries no `ARCHIVE PENDING` line

### Requirement: The new rows SHALL leave the existing contract lines untouched

Adding the identity rows and the archive reminder SHALL NOT change the summary's first line, its exit code, the `LEAN SHIP` line, or the degradation block. None of the new lines SHALL contain the substrings `LEAN SHIP` or `No degradation banners`, and the wording of each new line SHALL be pinned verbatim by a test so that a reword is a failing build rather than a silent change.

#### Scenario: Happy path — a lean run still reads as lean

- **GIVEN** a clean lean run
- **WHEN** the summary is printed with the new rows
- **THEN** the `LEAN SHIP:` line and the "No degradation banners" line are present exactly as before
- **AND** the first line is `SHIP COMPLETE — <change>`

#### Scenario: Failure — a reworded reminder

- **GIVEN** the archive reminder's wording is changed
- **WHEN** the verbatim-string test runs
- **THEN** it fails naming the line
