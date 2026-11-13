# session-advice Specification

## Purpose
Tells the person which session model and effort suits each skill, from one published table, and how the session they are in compares. It advises and never selects: no model is chosen, no effort is set and no setting is written.

## Requirements

### Requirement: The per-skill session suggestion SHALL be published in one table, not restated

`lib/limits.mjs` SHALL hold one table with a row for each advised skill: `explore`, `spec`, `review-artifacts`, `bootstrap`, `ship`, `settle`, `review-code` and `fix-tests`. A row SHALL hold a model, an effort, an optional ceiling and an optional best-results pair, and the table SHALL name the guidance it was read from. The model, the effort, a ceiling when the row has one, and both halves of a best-results pair when the row has one SHALL be drawn from one vocabulary: models `sonnet`, `opus` and `fable`, and efforts `low`, `medium`, `high`, `xhigh`, `max` in rising order. A ceiling SHALL NOT be below the row's effort. `interlock limits` SHALL print it and `--json` SHALL emit it. No file under `skills/` SHALL contain `sonnet`, `opus` or `fable`, or a line that begins with `/model` or `/effort`.

#### Scenario: Happy path — the table is printed and emitted

- **GIVEN** the published table
- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** the text carries one `session:` row for each of the eight skills, each with its model and effort, and a line naming the guidance the table was read from
- **AND** the JSON carries the table under `sessionAdvice`, with the same eight keys in the same order

#### Scenario: Failure — a row outside the vocabulary is caught

- **GIVEN** a table in which a row's model is not `sonnet`, `opus` or `fable`, or its effort or its ceiling is not one of `low`, `medium`, `high`, `xhigh`, `max`, or its ceiling is below its effort, or its best-results model or effort is outside that vocabulary
- **WHEN** the session-advice tests run
- **THEN** a test fails naming the skill and the field

#### Scenario: Failure — a skill that names a model or a switch command fails its pin

- **GIVEN** a file under `skills/` edited to hold `fable`, `opus` or `sonnet`, or a line that begins with `/model` or `/effort`
- **WHEN** the skill tests run
- **THEN** a test fails naming the file

#### Scenario: Edge case — a row for a skill the plugin does not ship is caught

- **GIVEN** a table with a row keyed by a name that is not a directory under `skills/`
- **WHEN** the session-advice tests run
- **THEN** a test fails naming the key

### Requirement: `interlock suggest` SHALL print a skill's row and SHALL never gate

`interlock suggest <skill> [--json]` SHALL print the skill's suggestion and exit 0 whatever the session runs at. With no skill it SHALL print every row and SHALL NOT report a fit, because there is no single row to compare. A name with no row SHALL exit 1 with a message on stderr that names the advised skills and SHALL print nothing on stdout. The verb SHALL read the table and the environment and SHALL write nothing.

#### Scenario: Happy path — one skill

- **GIVEN** the published row for `ship`
- **WHEN** `interlock suggest ship` runs
- **THEN** its first line names the skill, the row's model and the row's effort
- **AND** it exits 0

#### Scenario: Happy path — a row with a ceiling and a best-results pair

- **GIVEN** the published row for `spec`, which holds a ceiling and a best-results pair
- **WHEN** `interlock suggest spec --json` runs
- **THEN** the JSON carries `skill`, `model`, `effort`, `upTo`, `best`, `basis`, `observed`, `fit`, `banners` and `lines`
- **AND** the first entry of `lines` names the ceiling and the best-results pair after the model and effort
- **AND** `observed.model` is `null`

#### Scenario: Edge case — a plain row emits nulls for the optional fields

- **GIVEN** the `ship` row, which has no ceiling and no best-results pair
- **WHEN** `interlock suggest ship --json` runs
- **THEN** `upTo` and `best` are `null`
- **AND** `observed.model` is `null`

#### Scenario: Happy path — no skill prints every row

- **GIVEN** the published table and an environment with no effort override
- **WHEN** `interlock suggest` runs
- **THEN** it prints one line per advised skill, each equal to the first line `interlock suggest <that skill>` prints, and no line beginning `this session`, no line naming `/effort`, and no banner
- **AND** it exits 0

#### Scenario: Happy path — no skill emits the table and not a comparison

- **GIVEN** the published table and `CLAUDE_EFFORT=low`, with no effort override
- **WHEN** `interlock suggest --json` runs with no skill
- **THEN** the JSON carries `basis`, `skills`, `observed`, `banners` and `lines`, and does not carry `fit`
- **AND** `skills` has the eight keys in table order, each with `model`, `effort`, `upTo` and `best`, `upTo` `null` when that row has no ceiling and `best` `null` when it has no best-results pair
- **AND** `lines` holds one suggestion line per skill, `observed.effort` is `low`, `observed.model` is `null`, and `banners` is empty

#### Scenario: Edge case — the list form still banners an override

- **GIVEN** an environment with `CLAUDE_CODE_EFFORT_LEVEL=max`
- **WHEN** `interlock suggest` runs with no skill
- **THEN** the eight suggestion lines come first, with no line beginning `this session` and no line naming `/effort`, and the banner that names the variable and its value follows them

#### Scenario: Failure — a name with no row is an error, never a default

- **GIVEN** the names `graph`, which is a shipped skill with no row, and `not-a-skill`
- **WHEN** `interlock suggest graph` and `interlock suggest not-a-skill` run
- **THEN** each exits 1, prints nothing on stdout, and names the eight advised skills on stderr

#### Scenario: Edge case — a session far from the suggestion still exits 0

- **GIVEN** a session whose observed effort is above the row's
- **WHEN** `interlock suggest ship` runs
- **THEN** it exits 0 and no file under the repository or the user's settings is written

### Requirement: The verb SHALL compare the suggestion with the session's observed effort and SHALL say what it did not observe

For one named skill, the verb SHALL read the session's effort from the `CLAUDE_EFFORT` variable of its own environment, trim surrounding whitespace, and compare the result case-sensitively with the known levels. It SHALL report one of four fits: `below` the row's effort, `within` the row's effort and its ceiling, `above` the ceiling, or `unobserved`. A row with no ceiling has its effort as its ceiling. In the text, the session's model SHALL read `not observed`. In the JSON, `observed.model` SHALL be `null`. A value that is unset, blank, not a known level, or a known level in any other case SHALL read as unobserved, never as a default level. A known level with surrounding whitespace SHALL read as that level.

#### Scenario: Happy path — an effort inside the row's range

- **GIVEN** the `spec` row, whose effort is `high` with a ceiling of `xhigh`
- **WHEN** the verb runs with `CLAUDE_EFFORT=high`, and again with `CLAUDE_EFFORT=xhigh`
- **THEN** both report the fit `within`
- **AND** the second line of the text names the observed effort and says the model was not observed

#### Scenario: Failure — an effort above the row's ceiling

- **GIVEN** the `ship` row, whose effort is `medium` with no ceiling
- **WHEN** the verb runs with `CLAUDE_EFFORT=xhigh`
- **THEN** it reports the fit `above` and its text says the session runs above the suggestion

#### Scenario: Failure — an effort below the row's effort

- **GIVEN** the `spec` row
- **WHEN** the verb runs with `CLAUDE_EFFORT=low`
- **THEN** it reports the fit `below` and its text says the session runs below the suggestion

#### Scenario: Edge case — no effort was observed

- **GIVEN** an environment with `CLAUDE_EFFORT` unset, one with it blank, and one with `CLAUDE_EFFORT=turbo`
- **WHEN** the verb runs in each
- **THEN** each reports the fit `unobserved` and prints `effort not observed`
- **AND** none prints a level the environment did not hold

#### Scenario: Edge case — whitespace is trimmed and case is not folded

- **GIVEN** the `spec` row, whose effort is `high`
- **WHEN** the verb runs with `CLAUDE_EFFORT` set to ` high `, and again with `CLAUDE_EFFORT=High`
- **THEN** the first reports the fit `within` and the second reports `unobserved`

### Requirement: The verb SHALL say how to follow the suggestion and SHALL speak an environment override

When the fit is not `within`, the verb SHALL print the commands a person types to follow the row, `/effort <level>` and `/model <model>`, naming the best-results model too when the row holds a pair, and SHALL say that a model change belongs at a break in the work. When `CLAUDE_CODE_EFFORT_LEVEL` is set, the verb SHALL print a banner saying that `/effort` does not take effect while it is set. The verb SHALL change neither the environment nor any setting.

#### Scenario: Happy path — the follow line names both commands

- **GIVEN** the `ship` row and `CLAUDE_EFFORT=xhigh`
- **WHEN** `interlock suggest ship` runs
- **THEN** its last line names `/effort medium` and `/model opus`
- **AND** the line says a model change belongs at a break

#### Scenario: Happy path — a session inside the range gets no follow line

- **GIVEN** the `ship` row and `CLAUDE_EFFORT=medium`
- **WHEN** `interlock suggest ship` runs
- **THEN** it prints the suggestion line and the session line and no line naming `/effort`

#### Scenario: Edge case — an unobserved effort still gets a follow line

- **GIVEN** the `ship` row and an environment with `CLAUDE_EFFORT` unset
- **WHEN** `interlock suggest ship` runs
- **THEN** its last line names `/effort medium` and `/model opus`
- **AND** the line says a model change belongs at a break

#### Scenario: Edge case — a row with a best-results pair names both models

- **GIVEN** the `spec` row, which holds a best-results pair, and `CLAUDE_EFFORT=low`
- **WHEN** `interlock suggest spec` runs
- **THEN** its last line names `/effort high`, `/model opus` and `/model fable`
- **AND** it does not tell a session on either model to change model

#### Scenario: Failure — the effort override is bannered

- **GIVEN** an environment with `CLAUDE_CODE_EFFORT_LEVEL=max`
- **WHEN** `interlock suggest ship --json` runs, and `interlock suggest ship` runs in that same environment
- **THEN** `banners` holds one line that names the variable and its value and says `/effort` does not take effect while it is set
- **AND** the text run prints that line, and the variable is unchanged after both

#### Scenario: Edge case — a blank override raises nothing

- **GIVEN** an environment with `CLAUDE_CODE_EFFORT_LEVEL` set to an empty string
- **WHEN** `interlock suggest ship --json` runs
- **THEN** `banners` is empty

### Requirement: Each advised skill but ship SHALL print its suggestion when it starts and SHALL say when it could not

Each advised skill's `SKILL.md`, except `ship`'s, SHALL instruct the session to run `interlock suggest <that skill>` one time before the skill's own work and to print the answer verbatim. On a non-zero exit the skill SHALL print `SESSION SUGGESTION UNAVAILABLE:` with the first line of the output, and continue. The instruction SHALL be inline code in prose and SHALL NOT be a fenced line. `bootstrap` and `fix-tests` SHALL admit `Bash(interlock suggest *)`. A skill that another Interlock skill invoked SHALL print none. `ship` SHALL hold no such instruction: its suggestion is the checkpoint card's and dispatch's.

#### Scenario: Happy path — a skill prints its suggestion

- **GIVEN** a session that starts `/interlock:settle`
- **WHEN** the skill reaches its first step
- **THEN** the session has run `interlock suggest settle` and printed its lines as returned
- **AND** the skill named no model and no effort level of its own

#### Scenario: Failure — the verb is unavailable and the skill still runs

- **GIVEN** an `interlock` on PATH that answers `Unknown command` to `suggest`
- **WHEN** `/interlock:spec` starts
- **THEN** it prints `SESSION SUGGESTION UNAVAILABLE:` with the first line of that answer
- **AND** it continues to its next step

#### Scenario: Failure — a reworded skill loses its instruction and the test says which

- **GIVEN** an advised skill whose `SKILL.md` no longer holds `interlock suggest` with its own name, or no longer holds `SESSION SUGGESTION UNAVAILABLE`
- **WHEN** the skill tests run
- **THEN** a test fails naming that skill and the missing token

#### Scenario: Edge case — the table and the skills cannot drift apart

- **GIVEN** a table that gained a row for a skill whose `SKILL.md` holds no instruction, or a `SKILL.md` that holds the instruction for a skill with no row
- **WHEN** the skill tests run
- **THEN** a test fails naming the skill

#### Scenario: Edge case — the ship skill stays a launcher

- **GIVEN** `skills/ship/SKILL.md` edited to run `interlock suggest`
- **WHEN** the skill tests run
- **THEN** a test fails, because the ship skill launches a run that asks nothing and runs no command of its own
- **AND** the `ship` row still reaches the person on the checkpoint card and in dispatch's answer

#### Scenario: Edge case — the instruction is inline, and bootstrap and fix-tests admit the command

- **GIVEN** the seven advised skills other than `ship`
- **WHEN** the skill tests read those files
- **THEN** the suggestion instruction is not on a fenced line in any of the seven
- **AND** `bootstrap` and `fix-tests` admit `Bash(interlock suggest *)`

#### Scenario: Edge case — an invoked skill prints nothing of its own

- **GIVEN** `/interlock:spec` invoking `/interlock:explore` and then `/interlock:review-artifacts`
- **WHEN** the run reaches its checkpoint
- **THEN** one suggestion was printed, the one for `spec`

### Requirement: Dispatch SHALL print the suggestion for the skill it routes to

`skills/dispatch/SKILL.md` SHALL read the table one time in its pre-flight batch by running `interlock suggest` with no skill. When the skill it routes to has a line in that answer, dispatch SHALL print that line with the route. When the route has no line, dispatch SHALL print none. A failed read SHALL not stop the routing.

#### Scenario: Happy path — a route to an advised skill carries its line

- **GIVEN** a request dispatch routes to `/interlock:spec`
- **WHEN** dispatch answers
- **THEN** the answer carries the `spec` line of the table as the verb printed it

#### Scenario: Failure — the read failed and dispatch still routes

- **GIVEN** a pre-flight batch in which `interlock suggest` printed nothing
- **WHEN** dispatch answers
- **THEN** it names the route and prints `SESSION SUGGESTION UNAVAILABLE`

#### Scenario: Edge case — a route with no row prints no suggestion

- **GIVEN** a request dispatch routes to `/interlock:graph`
- **WHEN** dispatch answers
- **THEN** the answer carries no session suggestion
