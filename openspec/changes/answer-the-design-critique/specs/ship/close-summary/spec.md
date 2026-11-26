# Spec Delta

## ADDED Requirements

### Requirement: A halted summary from a usable manifest SHALL say when no commit is on record

When a halted close read a usable manifest (`formatRunSummary`) and recorded no commit, its summary SHALL print `No commit is on record for this run.` after `resume card:` (if any) and before `Do not start another ship run unless the user asks.`. A halt with a recorded commit SHALL print its `commit:` row instead; clean closes SHALL NOT carry it. No-manifest, `closeUnusableManifest` and `closeAlreadyOnRecord` summaries SHALL stay unchanged. Wording SHALL be pinned verbatim.

#### Scenario: Happy path — a halt with no commit says so

- **GIVEN** a run for `add-thing` closed from a usable manifest that halted with no commit recorded
- **WHEN** the summary is printed
- **THEN** it carries `No commit is on record for this run.` before the closing `Do not start another ship run unless the user asks.` line
- **AND** the first line, the exit code, the `LEAN SHIP` line and the degradation block are as before

#### Scenario: Failure — a halt after a recorded commit does not deny it

- **GIVEN** a halted run closed from a usable manifest whose summary records a commit
- **WHEN** the summary is printed
- **THEN** it carries the `commit:` row and does not carry `No commit is on record for this run.`

#### Scenario: Edge case — a clean close carries no such line

- **GIVEN** a run that completed without a halt
- **WHEN** the summary is printed
- **THEN** it does not carry `No commit is on record for this run.`

#### Scenario: Edge case — no-manifest, unusable-manifest and already-on-record closes are unchanged

- **GIVEN** a `run close --halt` with no manifest, with an unparseable or foreign-schema manifest (`closeUnusableManifest`), or against an already-closed run whose original close record is unavailable (`closeAlreadyOnRecord`)
- **WHEN** the close returns its summary
- **THEN** each summary remains unchanged and carries neither `No commit is on record for this run.` nor the pick-up steps added by `formatRunSummary`

### Requirement: A halted summary from a usable manifest SHALL list the steps to pick the run up

When a halted close read a usable manifest (`formatRunSummary`), its summary SHALL print person-addressed pick-up steps before its closing line: fix the halt reason; with leftovers, tick verified ones via `interlock tasks tick <change> --ids <verified-ids>` (a placeholder, NEVER filled from `leftoverIds`); then `/interlock:ship <change>` in a new session. Steps SHALL be pinned verbatim, keeping the closing line last and unchanged. Non-manifest closes SHALL stay unchanged.

#### Scenario: Happy path — a halt with leftovers

- **GIVEN** a run for `add-thing` closed from a usable manifest that halted with tasks `2.1` and `2.2` unticked
- **WHEN** the summary is printed
- **THEN** it names `interlock tasks tick add-thing --ids` with a placeholder naming verified ids and `/interlock:ship add-thing` before the closing `Do not start another ship run unless the user asks.` line
- **AND** the closing line is unchanged

#### Scenario: Failure — leftover task ids are never filled into the tick command

- **GIVEN** a run for `add-thing` closed from a usable manifest that halted with tasks `2.1` and `2.2` unticked
- **WHEN** the summary is printed
- **THEN** the `interlock tasks tick add-thing --ids` line contains neither `2.1` nor `2.2`
- **AND** `--ids` remains a placeholder naming verified ids

#### Scenario: Edge case — a halt with nothing left unticked

- **GIVEN** a run for `add-thing` closed from a usable manifest that halted with every task ticked
- **WHEN** the summary is printed
- **THEN** it names `/interlock:ship add-thing` and does not name `interlock tasks tick`

#### Scenario: Failure — a clean close lists no pick-up steps

- **GIVEN** a run that completed without a halt
- **WHEN** the summary is printed
- **THEN** it carries none of the pick-up steps

### Requirement: A close that could not be reached SHALL say the stage marker may still block a commit

When a driver cannot reach the close, its summary SHALL start `SHIP HALTED — <reason>`, state the close was not recorded (`no receipt was written`, never `nothing was recorded`), note the marker may block `git commit`, and advise `interlock run close --halt "<reason>"` from the directory the run started in (never `from the project root`). Both drivers SHALL share this sentence with no marker-path literal; `interlock-run` SHALL also print `cwd: <resolved root>`.

#### Scenario: Happy path — the relay that runs the close fails

- **GIVEN** a ship run on the Workflow host whose close call returns nothing
- **WHEN** the run stops
- **THEN** its summary starts `SHIP HALTED — <reason>`
- **AND** it says the close was not recorded (preserving `no receipt was written` and never saying `nothing was recorded`), that the stage marker may still block `git commit`, and names `interlock run close --halt` from the directory the run started in (never `from the project root`)

#### Scenario: Edge case — the runner host says the same and names the run directory

- **GIVEN** the same failure under `interlock-run` started in a run directory (including a linked worktree)
- **WHEN** the run stops
- **THEN** its summary carries the same core sentence as the Workflow host's
- **AND** it prints the resolved run directory on a `cwd:` row so a linked-worktree run points at that worktree rather than the main working tree
