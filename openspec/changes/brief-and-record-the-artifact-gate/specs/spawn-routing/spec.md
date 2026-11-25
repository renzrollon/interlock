# Spec Delta

## MODIFIED Requirements

### Requirement: `interlock routing <role>` SHALL resolve one role at a depth and speak any environment override

`interlock routing <role> [--depth lean|strict] [--caller <skill>] [--json]` SHALL exit 0 and print the role's `model` and `effort` at the depth, the row's `strict` override applied when the depth is `strict`, and the depth it used printed as `depth`. The depth SHALL be resolved in this order: `--depth` when given; otherwise the depth the published caller-depth table, `CALLER_DEPTH`, gives that role for the `--caller` skill; otherwise the published default depth. The answer SHALL carry `caller`, the skill named by `--caller` or `null`. `banners` SHALL name each environment override that makes the printed values not in effect: `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=<value> — every agent runs at that effort, so the effort this prints is not in effect` when that variable is set and non-blank, and `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=<value> — every agent runs on one model, so the model this prints is not in effect` when force is on. The JSON SHALL print a `null` model or effort as `null`; the text SHALL print it as `inherit`. The command SHALL run no subprocess and SHALL NOT unset, replace or work around either variable. A role the table does not hold SHALL exit non-zero with the known roles named on standard error and nothing on standard output. A depth the depth table does not hold SHALL exit non-zero naming `lean` and `strict` the same way. A `--caller` that `CALLER_DEPTH` names for no role SHALL exit non-zero naming the known callers the same way, and so SHALL `--caller` given with no role. With no role the command SHALL print the whole table at the depth. Its JSON SHALL carry `depth`, every role under `roles`, and `review`, the depth's always-on dimensions and skeptic shape as the depth table publishes them, so one call tells a review pass what it runs and on what. `interlock limits` SHALL print one row per caller depth, and `interlock limits --json` SHALL emit the table under `callerDepth`.

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
- **AND** standard error names the six known roles
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

#### Scenario: Happy path — a caller's published depth applies when no depth is given

- **GIVEN** a published `CALLER_DEPTH` that gives `artifact-reviewer` the depth `strict` when the caller is `spec`
- **WHEN** `interlock routing artifact-reviewer --caller spec --json` runs
- **THEN** it exits 0 with `depth` `strict`, `caller` `spec`, and the `model` and `effort` that `--depth strict` prints for that role
- **AND** `interlock routing artifact-reviewer --caller spec --depth lean --json` prints `depth` `lean`, because `--depth` wins
- **AND** `interlock routing review-dimension --caller spec --json` prints the published default depth, because the table gives that role nothing for `spec`

#### Scenario: Failure — an unknown caller is an error, never a default

- **WHEN** `interlock routing artifact-reviewer --caller ship --json` runs
- **THEN** it exits non-zero, standard error names `spec` as the known caller, and standard output is empty
- **AND** `interlock routing --caller spec --json`, which names no role, exits non-zero the same way

#### Scenario: Edge case — the caller depths are published

- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** the text carries one row for `artifact-reviewer` called by `spec`, and the JSON carries the same table under `callerDepth`

### Requirement: Each prose spawn site SHALL read its role's routing before spawning and SHALL say when it could not

The six spawn sites SHALL each instruct the skill to read its routing once before the first spawn of that role. The sites are explore's investigators, review-code's dimension reviewers, review-code's skeptics, settle's fixer, settle's conformance worker and the artifact gate's strict reviewer. They read it as follows:

- explore and settle through `interlock routing <role> --json`;
- review-artifacts through `interlock routing artifact-reviewer --json`, adding `--depth strict` under `--strict`, `--depth lean` under `--lean`, and `--caller spec` when the spec skill passed it;
- review-code through one `interlock routing --json` call, with `--depth strict` under `--strict`, whose answer carries both of its roles under `roles` and the depth's review shape under `review`.

Each site SHALL pass the role's `model` and `effort` on every Agent call of that role, with a `null` meaning the parameter is omitted, and SHALL print every line of `banners` verbatim. When the command exits non-zero, the site SHALL print `ROUTING UNAVAILABLE: <first line>` and spawn at the session defaults; for review-code that means the strict depth's dimension set and per-finding skeptics, the review the skill ran before routing existed. Routing SHALL never stop a skill. `skills/spec/SKILL.md` SHALL state that spec spawns nothing itself, that the workers on its path are explore's investigators and the artifact gate's reviewer, and that each is routed by role. Explore's `allowed-tools` SHALL pre-approve `Bash(interlock *)`. `shared/TOOL-ECONOMY.md` SHALL carry the rule. Each site's instruction SHALL be pinned by token in `test/skills.test.mjs`.

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

#### Scenario: Happy path — the artifact gate routes its strict reviewer

- **GIVEN** `/interlock:review-artifacts <change> --strict`
- **WHEN** the skill reaches its depth section
- **THEN** it runs `interlock routing artifact-reviewer --depth strict --json` once and prints `GATE DEPTH: strict`
- **AND** its one Agent call carries that answer's `model` and `effort`, omitting whichever is `null`, and every line of `banners` is printed verbatim before the spawn
- **AND** without `--strict` and without `--caller spec` the same skill runs `interlock routing artifact-reviewer --json`, prints `GATE DEPTH:` with the depth it answered, and spawns no agent when that depth is not `strict`

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

#### Scenario: Happy path — spec's gate passes its caller to the routing line

- **GIVEN** `/interlock:review-artifacts <change> --caller spec`, as the spec skill's gate line runs it
- **WHEN** the skill reaches its depth section
- **THEN** it runs `interlock routing artifact-reviewer --caller spec --json` once, and with `--lean` also given it runs `interlock routing artifact-reviewer --caller spec --depth lean --json`
- **AND** `skills/spec/SKILL.md` names the artifact gate's reviewer beside explore's investigators as a worker routed by role
