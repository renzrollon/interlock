## MODIFIED Requirements

### Requirement: The CLI SHALL emit every step of the lean run as a versioned record that names its own continuation

`interlock run` MUST return, for every call, a step record carrying a schema identifier, an `action`, the list of agents to spawn — each with a stable label, a model slug, an effort, an agent type, a tools allowlist, a result schema and a briefing — and a `then` continuation naming the exact `interlock` argv to call once those agents return, or `null` when the run is finished. The set of actions MUST cover the whole lean run: classification, batches, inter-wave verification, replanning, final verification, commit and close. A step on which the CLI raised one or more degradation banners MUST carry them as a `banners` array of strings, the same texts the close summary later prints, so a second reader of the step stream displays what the CLI named and recognises nothing by wording. A driver MUST NOT branch on any flag, mode, count or verdict; every such branch MUST be taken inside the CLI from the run manifest and the run state.

#### Scenario: Happy path — a batch step carries one spawn per lane and its continuation

- **GIVEN** a run whose state machine is at a `run-batch` with two lanes
- **WHEN** the driver calls `interlock run next`
- **THEN** the step carries exactly two spawns, each with the lane's label, the planner's model and effort, the worker agent type and tools, the lane's result schema and a briefing path and hash
- **AND** `then.argv` names `run record-batch`

#### Scenario: Failure — a continuation names a subcommand the CLI does not dispatch

- **GIVEN** a step whose `then.argv` names `run frobnicate`
- **WHEN** the step-shape test enumerates every continuation the run program can emit against the CLI's own dispatch table
- **THEN** the test fails naming `run frobnicate`
- **AND** the failure is a test failure before any run, not a halt during one

#### Scenario: Edge case — `--apply-only` turns the waves' `done` into close, not a verify spawn

- **GIVEN** a run manifest carrying `applyOnly: true` and a wave state that has reached `done`
- **WHEN** the driver calls `interlock run next`
- **THEN** the step's action is `close` with no spawns
- **AND** the driver did not consult the flag to get there

#### Scenario: Happy path — a step that raised a banner carries it as a field

- **GIVEN** a run started in a root with no graph
- **WHEN** `interlock run start` emits its step
- **THEN** the step's `banners` array contains the `GRAPH UNAVAILABLE` text the close summary will print
- **AND** a step that raised nothing carries no `banners` entry or an empty array, never a prose-only banner

## ADDED Requirements

### Requirement: The close's JSON output SHALL carry its banners and its summary as fields

`interlock run close --json` MUST print a record carrying the terminal action, the exit code, the summary text both hosts print, and a `banners` array holding every degradation banner the summary lists, in the summary's order. A reader of that record MUST be able to display every banner without parsing the summary's prose, and the summary text MUST be the same bytes the non-JSON form prints.

#### Scenario: Happy path — a close with two banners

- **GIVEN** a run that raised `GRAPH UNAVAILABLE` and `CACHE ACCOUNTING PARTIAL`
- **WHEN** `interlock run close --json` runs
- **THEN** the record's `banners` holds both texts in the order the summary prints them
- **AND** the record's `summary` equals the text `interlock run close` prints without `--json`

#### Scenario: Failure — a halt still carries its banners

- **GIVEN** a run closed with `--halt <reason>` after raising one banner
- **WHEN** `interlock run close --halt … --json` runs
- **THEN** the record's action is `halt`, its exit code is `1`, and `banners` holds the one text
- **AND** the summary carries the `resume card:` row when a card was written

#### Scenario: Edge case — a clean run carries an empty list

- **GIVEN** a run that raised no banner
- **WHEN** `interlock run close --json` runs
- **THEN** `banners` is an empty array, present and not absent
- **AND** the summary lists no degradation
