# Spec Delta

## ADDED Requirements

### Requirement: A commit denial SHALL name the change, the run and the way out

After naming the guard and stage, a `git commit` denial SHALL name the marker path `readStage` read, `marker.change` only if it passes `isChangeName`, and `runId` only when `.claude/ship/run.json` has the current schema, names that change, and the marker sits at that change's own path. Only then SHALL it advise `interlock run close --halt "<reason>"`; otherwise it SHALL name the marker path to remove by hand, and no run id or close command. It SHALL NOT quote the denied command.

#### Scenario: Happy path — usable matching manifest advises close and clears the marker

- **GIVEN** a stage marker at `implement` for change `add-thing` at `.claude/ship/add-thing/stage.json`, and a current-schema run manifest for change `add-thing` with run `r1`
- **WHEN** an agent runs `git commit -m "wip"` via Bash
- **THEN** the guard denies it with a reason that starts `guard-commit: `
- **AND** the reason names `add-thing`, `r1`, `.claude/ship/add-thing/stage.json` and `interlock run close --halt "<reason>"`
- **AND** running that advised `interlock run close --halt` command clears the marker so a subsequent `git commit` check is allowed

#### Scenario: Failure — no usable manifest (absent, unparseable or foreign schema) names the marker to remove by hand

- **GIVEN** a stage marker at `implement` for change `add-thing` at `.claude/ship/add-thing/stage.json`, and `.claude/ship/run.json` is absent, unparseable JSON, or carries a foreign schema tag
- **WHEN** an agent runs `git commit`
- **THEN** the guard denies it without crashing, naming `add-thing` and `.claude/ship/add-thing/stage.json` as the file to remove by hand
- **AND** the reason names no run id and does not advise `interlock run close --halt`

#### Scenario: Failure — manifest belongs to another change

- **GIVEN** a stage marker at `implement` for change `add-thing` at `.claude/ship/add-thing/stage.json`, and a current-schema run manifest whose `change` is `other-change` with run `r-other`
- **WHEN** an agent runs `git commit`
- **THEN** the guard denies it naming `add-thing` and `.claude/ship/add-thing/stage.json` as the file to remove by hand
- **AND** the reason names neither `r-other` nor `other-change` and does not advise `interlock run close --halt`

#### Scenario: Edge case — marker with missing or invalid change field

- **GIVEN** a stage marker at `.claude/ship/add-thing/stage.json` whose `change` field is absent or fails `isChangeName`
- **WHEN** an agent runs `git commit`
- **THEN** the guard denies it using the actual marker path `.claude/ship/add-thing/stage.json` (never `.claude/ship/undefined/stage.json`) as the file to remove by hand
- **AND** the reason does not quote the unvalidated `change` value, names no run id, and does not advise `interlock run close --halt`

#### Scenario: Edge case — marker stored outside its own change's directory

- **GIVEN** a stage marker at `.claude/ship/old-name/stage.json` whose `change` is `add-thing`, and a current-schema run manifest for change `add-thing`
- **WHEN** an agent runs `git commit`
- **THEN** the guard denies it naming `.claude/ship/old-name/stage.json` as the file to remove by hand
- **AND** the reason names no run id and does not advise `interlock run close --halt`, because that close clears only `.claude/ship/add-thing/stage.json`

#### Scenario: Edge case — two different commit commands get the same reason

- **GIVEN** one stage marker and one run manifest
- **WHEN** an agent runs `git commit -m "a"` and then `git -C . commit -m "b"`
- **THEN** both denials carry the same reason text

### Requirement: A commit denial SHALL quote only a plain marker path and SHALL say where to run the close

A `git commit` denial SHALL quote the marker path only when it is `.claude/ship/<name>/stage.json` with `<name>` a plain change name; otherwise it SHALL name a stage marker under `.claude/ship/`. When it advises `interlock run close --halt "<reason>"`, it SHALL say to run it from the directory the run started in.

#### Scenario: Happy path — the advised close names where to run it

- **GIVEN** a stage marker at `implement` for `add-thing` and a usable matching run manifest
- **WHEN** an agent runs `git commit`
- **THEN** the denial advises `interlock run close --halt "<reason>"` from the directory the run started in

#### Scenario: Edge case — a marker directory name that is not plain is never quoted

- **GIVEN** a live stage marker for change `add-thing` stored under a `.claude/ship/` directory whose name holds a newline and free text
- **WHEN** an agent runs `git commit`
- **THEN** the guard denies it, naming the marker only as a stage marker under `.claude/ship/` to remove by hand
- **AND** no part of that directory name appears in the reason

### Requirement: A commit denial SHALL separate in-run agent instructions from human recovery

A `git commit` denial SHALL address two audiences in order: first, an agent inside an active run — stating not to commit and not to close or halt the run because the run's commit step commits; second, a person whose run has already stopped — giving the applicable marker-clearing recovery step.

#### Scenario: Happy path — in-run agent instruction precedes human recovery with a usable manifest

- **GIVEN** a stage marker at `implement` for `add-thing` and a usable matching run manifest
- **WHEN** an agent runs `git commit -m "wip"` via Bash
- **THEN** the denial first instructs an agent inside an active run not to commit and not to close or halt the run
- **AND** only after that addresses a person whose run has already stopped with `interlock run close --halt "<reason>"`

#### Scenario: Edge case — audience separation holds when no usable manifest exists

- **GIVEN** a stage marker at `implement` for `add-thing` and no usable matching manifest
- **WHEN** an agent runs `git commit`
- **THEN** the denial still carries the in-run agent instruction first
- **AND** then instructs a person whose run has already stopped to remove `.claude/ship/add-thing/stage.json` by hand
