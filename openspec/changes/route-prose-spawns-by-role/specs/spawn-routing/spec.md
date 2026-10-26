## ADDED Requirements

### Requirement: The prose spawn roles and their routing SHALL be published, not restated

The model and effort a prose skill passes when it spawns a subagent SHALL come from one table, `SPAWN_ROUTING` in `lib/limits.mjs`, with one row per role — `explore-investigator`, `review-dimension`, `review-skeptic`, `settle-fixer`, `settle-conformance` — each a `{ model, effort }` pair, and a row MAY carry a `strict` override, itself a `{ model, effort }` pair that applies when the review depth is `strict`; the `review-dimension` row SHALL carry one. `model` SHALL be one of `haiku`, `sonnet`, `opus` or `null`; `effort` SHALL be one of `low`, `medium`, `high`, `xhigh`, `max` or `null`; `null` means the parameter is omitted and the host's default applies; an override's fields SHALL obey the same vocabulary. The `review-skeptic` and `settle-fixer` rows SHALL carry `EFFORT.skeptic` itself, not a copy of its value. `interlock limits` SHALL print one row per role and one per override, and `interlock limits --json` SHALL emit the table under `routing`. No skill file SHALL spell a model slug or an effort level as a spawn parameter.

Rationale: a model slug in prose is a threshold a model can re-argue and five files can drift apart; a table the CLI publishes changes once.

#### Scenario: Happy path — the table is printed and emitted

- **GIVEN** the installed CLI
- **WHEN** `interlock limits` runs
- **THEN** its output carries a `routing:` row for each of the five roles and one for the `review-dimension` strict override, printing `inherit` where the table holds `null`
- **AND** `interlock limits --json` carries the same five roles under `routing`, each with `model` and `effort`, and the `strict` override on `review-dimension`

#### Scenario: Failure — a skill that spells a model or a level fails its pin

- **GIVEN** a skill file among explore, review-code, settle and spec that contains `model: sonnet` or `effort: low` as a spawn parameter
- **WHEN** the skill pin test runs
- **THEN** it fails naming that skill file

#### Scenario: Edge case — a row outside the vocabulary is caught

- **GIVEN** a `SPAWN_ROUTING` row, or a row's `strict` override, whose model is not `haiku`, `sonnet`, `opus` or `null`, or whose effort is not a known level or `null`
- **WHEN** the table invariant test runs
- **THEN** it fails naming the role and the field

### Requirement: `interlock routing <role>` SHALL resolve one role at a depth and speak any environment override

`interlock routing <role> [--depth lean|strict] [--json]` SHALL exit 0 and print the role's `model` and `effort` at the depth, the row's `strict` override applied when the depth is `strict`, the published default depth applied when `--depth` is absent, and the depth it used printed as `depth`, with `banners` naming each environment override that makes them not in effect: `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<value> — every agent runs at that effort, so the effort this prints is not in effect` when that variable is set and non-blank, and `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=<value> — every agent runs on one model, so the model this prints is not in effect` when force is on. The JSON SHALL print a `null` model or effort as `null`; the text SHALL print it as `inherit`. The command SHALL run no subprocess and SHALL NOT unset, replace or work around either variable. A role the table does not hold SHALL exit non-zero with the known roles named on standard error and nothing on standard output, and a depth the depth table does not hold SHALL exit non-zero naming `lean` and `strict` the same way. With no role it SHALL print the whole table at the depth, and its JSON SHALL carry `depth`, every role under `roles`, and `review` — the depth's always-on dimensions and skeptic shape as the depth table publishes them — so one call tells a review pass what it runs and on what.

#### Scenario: Happy path — a role resolves

- **GIVEN** an environment with neither override variable set
- **WHEN** `interlock routing explore-investigator --json` runs
- **THEN** it exits 0 with `role`, `depth` equal to the published default, the table's `model` and `effort` for that role, an empty `banners` list and `overrides` whose entries are `null`

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

#### Scenario: Happy path — the strict override applies at the strict depth only

- **GIVEN** an environment with neither override variable set
- **WHEN** `interlock routing review-dimension --depth strict --json` and `interlock routing review-dimension --json` run
- **THEN** the first prints `depth` `strict` with the override's `model` and `effort`
- **AND** the second prints the row's own `model` and `effort` at the default depth, and `interlock routing review-skeptic --depth strict --json` prints the same `model` and `effort` as it does without `--depth`

#### Scenario: Failure — an unknown depth is an error, never a default

- **WHEN** `interlock routing review-dimension --depth deep --json` runs
- **THEN** it exits non-zero
- **AND** standard error names `lean` and `strict`
- **AND** standard output is empty

#### Scenario: Edge case — no role prints the table and the depth's review shape

- **WHEN** `interlock routing --json` runs
- **THEN** it exits 0 with `depth` equal to the published default, every role resolved under `roles`, each carrying the `model` and `effort` a single-role call prints, and `review` carrying `dimensions` and `skeptics` equal to that depth's published row
- **AND** with `--depth strict` the same call prints the strict depth's `review` and the override on `roles.review-dimension`

### Requirement: Each prose spawn site SHALL read its role's routing before spawning and SHALL say when it could not

The five spawn sites — explore's investigators, review-code's dimension reviewers, review-code's skeptics, settle's fixer and settle's conformance worker — SHALL each instruct the skill to read its routing once before the first spawn of that role: explore and settle through `interlock routing <role> --json`, review-code through one `interlock routing --json` call, with `--depth strict` under `--strict`, whose answer carries both of its roles under `roles` and the depth's review shape under `review`. Each site SHALL pass the role's `model` and `effort` on every Agent call of that role with a `null` meaning the parameter is omitted, SHALL print every line of `banners` verbatim, and, when the command exits non-zero, SHALL print `ROUTING UNAVAILABLE: <first line>` and spawn at the session defaults — for review-code, the strict depth's dimension set and per-finding skeptics, the review the skill ran before routing existed. Routing SHALL never stop a skill. `skills/spec/SKILL.md` SHALL state that spec spawns nothing itself and that explore's investigators are routed by role. Explore's `allowed-tools` SHALL pre-approve `Bash(interlock *)`. `shared/TOOL-ECONOMY.md` SHALL carry the rule. Each site's instruction SHALL be pinned by token in `test/skills.test.mjs`.

#### Scenario: Happy path — explore routes its investigators

- **GIVEN** `/interlock:explore --autonomous` about to fan out three investigators
- **WHEN** the skill reaches its investigator rules
- **THEN** it runs `interlock routing explore-investigator --json` once
- **AND** each of the three Agent calls carries that `model` and that `effort`, omitting whichever is `null`

#### Scenario: Happy path — review-code reads one answer for both roles and the depth

- **GIVEN** `/interlock:review-code <change>` without `--strict`
- **WHEN** the skill reaches the paragraph before its fan-out
- **THEN** it runs `interlock routing --json` once and no per-role routing call
- **AND** its dimension reviewers carry `roles.review-dimension`, its skeptics `roles.review-skeptic`, and its always-on set and skeptic shape are `review.dimensions` and `review.skeptics` from the same answer

#### Scenario: Happy path — settle routes its fixer and its conformance worker under different roles

- **GIVEN** a settle review round with findings to fix and scenarios to confirm
- **WHEN** the skill spawns the fixer and later the conformance worker
- **THEN** the fixer carries the `settle-fixer` routing and the worker the `settle-conformance` routing
- **AND** the fixer paragraph still carries every token pinned before this change

#### Scenario: Failure — the routing command fails and the spawn still happens

- **GIVEN** `interlock routing --json` exits non-zero
- **WHEN** review-code reaches its dimension fan-out
- **THEN** it prints `ROUTING UNAVAILABLE:` followed by the command's first output line
- **AND** it spawns the strict depth's always-on dimensions and the conditional ones its triggers select, every reviewer at the session defaults, and two skeptics per blocker and warning
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
