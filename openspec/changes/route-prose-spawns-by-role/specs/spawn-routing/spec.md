## ADDED Requirements

### Requirement: The prose spawn roles and their routing SHALL be published, not restated

The model and effort a prose skill passes when it spawns a subagent SHALL come from one table, `SPAWN_ROUTING` in `lib/limits.mjs`, with one row per role — `explore-investigator`, `review-dimension`, `review-skeptic`, `settle-fixer`, `settle-conformance` — each a `{ model, effort }` pair. `model` SHALL be one of `haiku`, `sonnet`, `opus` or `null`; `effort` SHALL be one of `low`, `medium`, `high`, `xhigh`, `max` or `null`; `null` means the parameter is omitted and the host's default applies. The `review-skeptic` and `settle-fixer` rows SHALL carry `EFFORT.skeptic` itself, not a copy of its value. `interlock limits` SHALL print one row per role and `interlock limits --json` SHALL emit the table under `routing`. No skill file SHALL spell a model slug or an effort level as a spawn parameter.

Rationale: a model slug in prose is a threshold a model can re-argue and five files can drift apart; a table the CLI publishes changes once.

#### Scenario: Happy path — the table is printed and emitted

- **GIVEN** the installed CLI
- **WHEN** `interlock limits` runs
- **THEN** its output carries a `routing:` row for each of the five roles, printing `inherit` where the table holds `null`
- **AND** `interlock limits --json` carries the same five roles under `routing`, each with `model` and `effort`

#### Scenario: Failure — a skill that spells a model or a level fails its pin

- **GIVEN** a skill file among explore, review-code, settle and spec that contains `model: sonnet` or `effort: low` as a spawn parameter
- **WHEN** the skill pin test runs
- **THEN** it fails naming that skill file

#### Scenario: Edge case — a row outside the vocabulary is caught

- **GIVEN** a `SPAWN_ROUTING` row whose model is not `haiku`, `sonnet`, `opus` or `null`, or whose effort is not a known level or `null`
- **WHEN** the table invariant test runs
- **THEN** it fails naming the role and the field

### Requirement: `interlock routing <role>` SHALL resolve one role and speak any environment override

`interlock routing <role> [--json]` SHALL exit 0 and print the role's `model` and `effort`, with `banners` naming each environment override that makes them not in effect: `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<value> — every agent runs at that effort, so the effort this prints is not in effect` when that variable is set and non-blank, and `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=<value> — every agent runs on one model, so the model this prints is not in effect` when force is on. The JSON SHALL print a `null` model or effort as `null`; the text SHALL print it as `inherit`. The command SHALL run no subprocess and SHALL NOT unset, replace or work around either variable. A role the table does not hold SHALL exit non-zero with the known roles named on standard error and nothing on standard output. With no role it SHALL print the whole table.

#### Scenario: Happy path — a role resolves

- **GIVEN** an environment with neither override variable set
- **WHEN** `interlock routing explore-investigator --json` runs
- **THEN** it exits 0 with `role`, the table's `model` and `effort` for that role, an empty `banners` list and `overrides` whose entries are `null`

#### Scenario: Happy path — an inherited field prints as inherit

- **GIVEN** a role whose table row holds `null` for its model
- **WHEN** `interlock routing <role>` runs without `--json`
- **THEN** the line reads `model inherit`
- **AND** with `--json` the `model` field is `null`

#### Scenario: Failure — the effort override is bannered

- **GIVEN** `CLAUDE_CODE_EFFORT_LEVEL=high` in the environment
- **WHEN** `interlock routing review-skeptic --json` runs
- **THEN** it exits 0 with the table's effort still printed
- **AND** `banners` contains `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=high`
- **AND** `overrides.effortLevel` is `high`

#### Scenario: Failure — the model force override is bannered

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` in the environment
- **WHEN** `interlock routing review-dimension --json` runs
- **THEN** `banners` contains `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`
- **AND** the command has not changed the variable

#### Scenario: Failure — an unknown role is an error, never a default

- **WHEN** `interlock routing not-a-role --json` runs
- **THEN** it exits non-zero
- **AND** standard error names the five known roles
- **AND** standard output is empty

#### Scenario: Edge case — no role prints the table

- **WHEN** `interlock routing --json` runs
- **THEN** it exits 0 with every role resolved, each carrying the same fields a single-role call prints

### Requirement: Each prose spawn site SHALL read its role's routing before spawning and SHALL say when it could not

The five spawn sites — explore's investigators, review-code's dimension reviewers, review-code's skeptics, settle's fixer and settle's conformance worker — SHALL each instruct the skill to run `interlock routing <role> --json` once before the first spawn of that role, to pass its `model` and `effort` on every Agent call of that role with a `null` meaning the parameter is omitted, to print every line of `banners` verbatim, and, when the command exits non-zero, to print `ROUTING UNAVAILABLE: <first line>` and spawn at the session defaults. Routing SHALL never stop a skill. `skills/spec/SKILL.md` SHALL state that spec spawns nothing itself and that explore's investigators are routed by role. Explore's `allowed-tools` SHALL pre-approve `Bash(interlock *)`. `shared/TOOL-ECONOMY.md` SHALL carry the rule. Each site's instruction SHALL be pinned by token in `test/skills.test.mjs`.

#### Scenario: Happy path — explore routes its investigators

- **GIVEN** `/interlock:explore --autonomous` about to fan out three investigators
- **WHEN** the skill reaches its investigator rules
- **THEN** it runs `interlock routing explore-investigator --json` once
- **AND** each of the three Agent calls carries that `model` and that `effort`, omitting whichever is `null`

#### Scenario: Happy path — settle routes its fixer and its conformance worker under different roles

- **GIVEN** a settle review round with findings to fix and scenarios to confirm
- **WHEN** the skill spawns the fixer and later the conformance worker
- **THEN** the fixer carries the `settle-fixer` routing and the worker the `settle-conformance` routing
- **AND** the fixer paragraph still carries every token pinned before this change

#### Scenario: Failure — the routing command fails and the spawn still happens

- **GIVEN** `interlock routing review-dimension --json` exits non-zero
- **WHEN** review-code reaches its dimension fan-out
- **THEN** it prints `ROUTING UNAVAILABLE:` followed by the command's first output line
- **AND** it spawns every dimension reviewer at the session defaults
- **AND** the review proceeds

#### Scenario: Failure — an override is spoken at the spawn site

- **GIVEN** `interlock routing settle-fixer --json` returns one banner
- **WHEN** settle spawns the fixer
- **THEN** the banner line is printed verbatim before the spawn

#### Scenario: Edge case — a reworded site loses its instruction and the test says which

- **GIVEN** a spawn site whose routing sentence was removed or reworded past its tokens
- **WHEN** the skill pin test runs
- **THEN** it fails naming the skill and the missing token

### Requirement: The doctor SHALL report whether the host applies a per-call effort

`lib/host/claude-env.mjs` SHALL export `PER_CALL_EFFORT_MIN_VERSION`, the first Claude Code version that applies the Agent tool's per-call `effort` parameter, and `interlock doctor` SHALL print one line beside its subagent-model lines: that a per-call effort is applied on this host, or that it is ignored below the floor, or that the version could not be established. The line SHALL never change the doctor's exit status.

#### Scenario: Happy path — a host at or above the floor

- **GIVEN** a probed Claude Code version at or above `PER_CALL_EFFORT_MIN_VERSION`
- **WHEN** `interlock doctor` runs
- **THEN** its output says a per-call effort is applied on this host

#### Scenario: Failure — a host below the floor

- **GIVEN** a probed Claude Code version below `PER_CALL_EFFORT_MIN_VERSION`
- **WHEN** `interlock doctor` runs
- **THEN** its output says a per-call effort is ignored on this host and names the floor
- **AND** the doctor's exit status is what it would have been without the line

#### Scenario: Edge case — the version is unknown

- **GIVEN** the doctor could not probe the Claude Code version
- **WHEN** it prints the line
- **THEN** it says it could not establish whether a per-call effort is applied, rather than claiming either
