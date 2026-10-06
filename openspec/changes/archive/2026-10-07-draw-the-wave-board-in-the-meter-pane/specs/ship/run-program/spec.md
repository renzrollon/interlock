## MODIFIED Requirements

### Requirement: The CLI SHALL emit every step of the lean run as a versioned record that names its own continuation

`interlock run` MUST return, for every call, a step record carrying a schema identifier, an `action`, the list of agents to spawn — each with a stable label, a model slug, an effort, an agent type, a tools allowlist, a result schema and a briefing — and a `then` continuation naming the exact `interlock` argv to call once those agents return, or `null` when the run is finished. The set of actions MUST cover the whole lean run: classification, batches, inter-wave verification, replanning, final verification, commit and close. A step on which the CLI raised one or more degradation banners MUST carry them as a `banners` array of strings, the same texts the close summary later prints, so a second reader of the step stream displays what the CLI named and recognises nothing by wording. A driver MUST NOT branch on any flag, mode, count or verdict; every such branch MUST be taken inside the CLI from the run manifest and the run state.

The step stream is also the contract a second reader draws the run's structure from, and the relay to the Workflow host MUST carry exactly these fields for it beside the fields it carries today: `waveIndex`, `batchIndex` and `batchCount`, the integer positions a batch or verify step already carries; `skipped`, the boolean a verify step already carries; `recorded`, carried on the step `run record-batch` returns, holding the ids the batch recorded ok, failed and not attempted as three arrays of strings, the same ids the trajectory's record-batch mutation names; and `plan`, carried on the first step that dispatches an adopted plan and on the first step after a replan rewrote the waves, holding a summary of the run state's waves — per wave its position, group, kind, red marker and batches, per task only its id, tier, model and description as the lane title rule reads it, and the ordered-after edges in the form the plan's deferral records take — and on no other step. The summary MUST be built by one pure module both the CLI and a second reader can import, and MUST carry no task paths, no full description, no briefing and no carried wave state. The schema identifier MUST stay `interlock.run-step/1`: every field above is additive and absent where it does not apply, so a reader that ignores them reads today's step. Neither host driver MUST read any of them. The relay's whitelist MUST remain a whitelist, pinned by a test that names every field it carries, so a field added to the step later cannot grow the relay unnamed.

#### Scenario: Happy path — a batch step carries one spawn per lane and its continuation

- **GIVEN** a run whose state machine is at a `run-batch` with two lanes
- **WHEN** the driver calls `interlock run next`
- **THEN** the step carries exactly two spawns, each with the lane's label, the planner's model and effort, the worker agent type and tools, the lane's result schema and a briefing path and hash
- **AND** `then.argv` names `run record-batch`

#### Scenario: Happy path — a lane spawn is shown under a title and keyed by its label

- **GIVEN** a batch step with a lane `1.1+2` whose first task reads `Add the relaunch guard`
- **WHEN** the driver spawns it
- **THEN** the spawn's `title` is `1.1+2 · Add the relaunch guard`, a deterministic function of the lane, and the host displays the agent under it
- **AND** the briefing file, the worktree, the trajectory and `run record-batch` still name it `1.1+2`
- **AND** a spawn that is not a lane carries a `title` equal to its label

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

#### Scenario: Happy path — the relayed batch step places itself and the adoption step carries the plan

- **GIVEN** a run on the Workflow host whose adopted plan holds two implementation waves and a test wave, the first wave in two batches
- **WHEN** `run classified` emits the first step and the driver's relay copies its stdout
- **THEN** the relayed step carries `waveIndex: 0`, `batchIndex: 0`, `batchCount: 2` and a `plan` whose waves are three, each with its position, group, kind and batches of tasks reduced to id, tier, model and a cut description, and whose ordered-after edges match the plan's deferral records
- **AND** the relayed step still carries no `remainingBatches`, `previousHandoffs`, `changed`, `lanes`, `mergeBase` or spawn `prompt`
- **AND** the step `run record-batch` later returns carries `recorded` with the batch's ok, failed and not-attempted ids and no `plan`, and its schema identifier is `interlock.run-step/1`

#### Scenario: Failure — the summary that would grow the relay is refused by the pin

- **GIVEN** a plan summary into which a task's `paths` array or its full description has been placed
- **WHEN** the summary test runs over the fixture plan
- **THEN** it fails naming the field the summary must not carry
- **AND** a step emitted by `run next` mid-run that carries `plan` fails the step test, because the summary rides only on the adoption and replan steps

#### Scenario: Edge case — a replan re-emits the summary, and an old reader reads nothing new

- **GIVEN** a run whose replan step revised one group
- **WHEN** `run replan` emits the step after the revised waves were adopted
- **THEN** that step carries a `plan` built from the revised waves, and the next `run record-batch` step carries none
- **AND** the Workflow driver and the runner read `action`, `then`, `spawns`, `banners`, `change`, `wave`, `reason` and `pingModel` as before and name none of the six fields, which the no-policy sweep and the relay-read scan assert
