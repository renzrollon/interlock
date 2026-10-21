# ship/run-program Specification

## Purpose

Makes the CLI the single author of a ship run: every step, every agent briefing and every continuation is emitted by `interlock run`, so a host driver is an interpreter that holds no loop policy and no prompt text of its own.

## Requirements

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
- **THEN** the spawn's `title` is `tasks 1.1+2 · Add the relaunch guard`, a deterministic function of the lane, and the host displays the agent under it
- **AND** a one-task lane `1.1` is titled `task 1.1 · …`
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

### Requirement: A briefing SHALL be a file whose first line carries its hash, and a host delivering it by reference SHALL fail closed a result that does not acknowledge that hash

For every spawn, the CLI MUST write the assembled briefing to a file whose first line names the spawn label and the SHA-256 of the briefing text, and MUST place the path, the hash and the text on the spawn. A host that cannot pass the text through its transport MAY deliver the briefing by reference with a fixed bootstrap that names the path and requires the agent to report the hash as `briefing`. Such a host MUST read the reported value after trimming it, lowercasing it and removing a leading `sha256=`, and MUST accept it when it equals the spawn's hash, or when it is at least 16 hexadecimal characters long and its first 16 characters equal the first 16 of the spawn's hash. An accepted result MUST be recorded with `briefing` set to the spawn's full hash, and an acceptance that was not an exact match MUST raise the banner `BRIEFING ACK INEXACT: <label> reported <n> characters whose first 16 match the briefing's sha256 — accepted`. The host MUST treat a result whose `briefing` is absent, shorter than 16 hexadecimal characters, or different within its first 16 as a failed spawn with reason `briefing not acknowledged`. A result that is absent altogether — the runtime returned no result because it stopped the agent, the API failed or a usage limit ended it — MUST be recorded as a failed spawn with the banner `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed`, and MUST NOT be reported as `briefing not acknowledged`. A host that passes the text inline MUST ignore `briefing`.

#### Scenario: Happy path — a Workflow-runtime worker acknowledges its briefing

- **GIVEN** a spawn whose briefing file's first line carries hash `H`
- **WHEN** the Workflow-runtime interpreter spawns the worker with the bootstrap and the worker reports `briefing: "H"`
- **THEN** the result is accepted and recorded as the lane's result
- **AND** no `BRIEFING ACK INEXACT` banner is raised

#### Scenario: Edge case — a worker that dropped a character is accepted and named

- **GIVEN** the same spawn, and a worker that finished its tasks and reported `H` with its last character missing
- **WHEN** the interpreter checks the result
- **THEN** the result is accepted, recorded with `briefing` equal to `H`, and its tasks are recorded on their own outcomes
- **AND** the close carries `BRIEFING ACK INEXACT: <label> reported 63 characters whose first 16 match the briefing's sha256 — accepted`

#### Scenario: Failure — the worker never read the briefing

- **GIVEN** the same spawn
- **WHEN** the worker's result omits `briefing`, reports a value whose first 16 characters differ from `H`'s, or reports only the first 15 characters of `H`
- **THEN** the interpreter records a failed spawn with reason `briefing not acknowledged`
- **AND** the lane's tasks are recorded as failed, not as ok on the strength of the rest of the result

#### Scenario: Failure — the runtime returned no result

- **GIVEN** the same spawn
- **WHEN** the runtime's agent call resolves to no result at all
- **THEN** the interpreter records a failed spawn and carries `AGENT RETURNED NO RESULT: <label>` to the close
- **AND** the summary does not say `BRIEFING NOT ACKNOWLEDGED` for that spawn

#### Scenario: Edge case — an inline host is not penalised for omitting the field

- **GIVEN** the ACP driver, which sends the briefing text inline
- **WHEN** an agent's result carries no `briefing` field
- **THEN** the result is judged on its schema alone
- **AND** no `briefing not acknowledged` failure is recorded

### Requirement: A host driver SHALL carry no briefing text and no loop policy

Neither host driver MAY contain the text of any agent briefing, the tier ladder, the classifier's grouping rules, the handoff schema, a model or effort table, a lane-dispatch rule, a merge rule, a remediation budget or a verify judgement. A test MUST enumerate a published list of policy tokens and fail naming the driver and the token when one appears. Host plumbing — the copy-stdout instruction for a mechanical ping, the by-reference bootstrap, the runaway backstop — MUST be enumerated as allowed and pinned by fixture.

#### Scenario: Happy path — both drivers pass the no-policy sweep

- **GIVEN** the Workflow script and the ACP driver after this change
- **WHEN** the no-policy test runs over both files
- **THEN** no listed token is found in either
- **AND** the test reports how many tokens it swept

#### Scenario: Failure — a driver restates the tier ladder

- **GIVEN** a driver into which the sentence defining tier 4 has been pasted
- **WHEN** the no-policy test runs
- **THEN** it fails naming that driver and the tier-ladder token

#### Scenario: Edge case — the sweep has no allowance to skip

- **GIVEN** the Workflow script and the ACP driver, after the strict tail became a CLI-emitted program
- **WHEN** the no-policy test runs
- **THEN** it reads each driver whole rather than up to a named seam marker
- **AND** no driver contains a tail seam, a `host-tail` step, or any review, remediation or handoff token

### Requirement: Recording a batch SHALL fold isolated lanes, record the batch and tick completed tasks in one CLI call

`interlock run record-batch` MUST, in order: fold the worktrees of lanes whose every task reported ok when the run is isolated, using the merge base the batch step captured; adjudicate the reported results against what the run observed; record the batch into the run state; tick every task recorded ok; surface any early-stopped lane, tick failure, claim-derived tally or override on the returned step; and return the next step. A lane with any failed task MUST be neither folded nor ticked.

#### Scenario: Happy path — a clean isolated batch is folded, recorded and ticked

- **GIVEN** an isolated run whose batch of two lanes both reported every task ok
- **WHEN** the driver calls `run record-batch` with the results
- **THEN** both lane worktrees are folded into the shared tree, both lanes' tasks are recorded ok and ticked in `tasks.md`
- **AND** the returned step is the state machine's next action

#### Scenario: Failure — a tick cannot be written

- **GIVEN** a task recorded ok whose checkbox cannot be marked because `tasks.md` is unwritable
- **WHEN** `run record-batch` runs
- **THEN** the returned step carries the `TASK TICK FAILED` banner naming the id
- **AND** the run continues rather than halting on a bookkeeping failure

#### Scenario: Edge case — a lane stopped early is neither folded nor ticked, and its worktree is named

- **GIVEN** an isolated batch in which one lane's second task failed and its third was not attempted
- **WHEN** `run record-batch` runs
- **THEN** that lane's worktree is left in place and named on the step, its first task is ticked only if recorded ok, and its third task is counted as not attempted rather than failed
- **AND** the other lanes in the batch are folded and ticked as normal

### Requirement: The run SHALL be bounded by a published step cap enforced in the CLI

The number of `interlock run` calls a run may make MUST be a cap stated once in the limits definition, printed by `interlock limits`, read by the CLI and never restated as a literal in a driver. When the cap is exceeded the CLI MUST return a `halt` step whose reason names the cap.

#### Scenario: Happy path — an ordinary run stays under the cap

- **GIVEN** a change that plans to three waves
- **WHEN** the run executes to completion
- **THEN** the manifest's step counter is below the cap
- **AND** no cap-related banner or halt appears

#### Scenario: Failure — the cap is exceeded

- **GIVEN** a run whose manifest step counter has reached the cap
- **WHEN** the driver calls any `interlock run` subcommand
- **THEN** the CLI returns a `halt` step whose reason names `maxRunSteps` and the value
- **AND** the driver closes the run through `run close` as for any halt

#### Scenario: Edge case — a driver restates the cap

- **GIVEN** a driver containing a literal loop bound equal to the cap
- **WHEN** the cap-authority check runs
- **THEN** it fails naming the driver and the cap it duplicates

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed

`interlock run close` MUST build the run receipt from the run state, the results file and the manifest, append the outcome record, record the closing trajectory event, run the reconstructability check, and return the exit code, the summary text and the banner list. Both drivers MUST print that summary verbatim. Host-only banners MUST be accepted on the call so the summary's degradation block stays complete. The close MUST accept a `--notify` flag requesting the terminal push, and both drivers MUST pass it from the same place they pass their host-observed inputs, so the push is one implementation the CLI owns and two hosts request rather than two implementations; the driver-parity test MUST fail when one driver passes it and the other does not.

#### Scenario: Happy path — a clean lean run closes with the shared summary

- **GIVEN** a run whose commit spawn reported a sha
- **WHEN** the driver calls `run close` with the commit result
- **THEN** the returned step has exit code `0` and a summary naming the commit, the waves and the "No degradation banners" line
- **AND** the Workflow script and the ACP driver print the same summary text for the same run state

#### Scenario: Failure — a halt closes with the reason and exit code 1

- **GIVEN** a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason>`
- **THEN** the trajectory gains a `run-halt` event carrying the reason, the outcome corpus gains one line, and the returned exit code is `1`

#### Scenario: Edge case — a host banner is carried into the summary

- **GIVEN** the ACP driver hands `run close` a host banner about model routing
- **WHEN** the summary is built
- **THEN** the banner appears in the degradation block
- **AND** the "No degradation banners" line is not printed

#### Scenario: Happy path — both drivers request the push through the close

- **GIVEN** the Workflow script and the runner after this change
- **WHEN** each assembles the arguments for `run close`
- **THEN** both include `--notify`
- **AND** neither contains a network call, a topic, or any notification text of its own

#### Scenario: Failure — one driver stops requesting the push

- **GIVEN** a driver from which `--notify` has been removed
- **WHEN** the driver-parity test runs
- **THEN** it fails naming that driver and the missing flag

### Requirement: The run program SHALL emit the review, remediation and handoff steps with criteria and policy inlined

When the run manifest carries a review flag, the waves' completion MUST be followed by a `review` step whose briefing names the selected dimensions with each dimension's written criteria and the repository's review policy prose inlined, then by one `remediate` step per fixing round and one for the verdict, each inlining the round's plan and the same criteria for every dimension to be re-reviewed. When the manifest carries a handoff or conformance flag, final verification MUST be followed by a `handoff` step whose briefing states whether a manual test plan is needed and lists the conformance scenarios to answer. A dimension whose criteria cannot be read MUST be named in the briefing and MUST place `REVIEW RUBRIC UNAVAILABLE: <dimension>` on the step. Without any tail flag the emitted program MUST be identical to the lean program.

#### Scenario: Happy path — a strict run emits the tail in order

- **GIVEN** a manifest with `strict: true` and a wave state that has reached `done`
- **WHEN** the driver follows each step's continuation
- **THEN** the steps are `review`, one or more `remediate`, `verify-final`, `handoff`, `commit`, `close`, in that order
- **AND** the review briefing contains the criteria text of every selected dimension and the policy prose

#### Scenario: Failure — a dimension's criteria file is missing

- **GIVEN** the `qa` criteria file cannot be read
- **WHEN** the `review` step is emitted
- **THEN** the briefing says the `qa` reviewer works from the dimension name alone
- **AND** the step carries `REVIEW RUBRIC UNAVAILABLE: qa`

#### Scenario: Edge case — handoff without review

- **GIVEN** a manifest with `handoff: true` and `review: false`
- **WHEN** the waves complete and final verification passes
- **THEN** no `review` or `remediate` step is emitted
- **AND** a `handoff` step is emitted before `commit`

### Requirement: Review adjudication and the remediation budget SHALL be computed by the CLI from files the agents wrote

The review agent MUST write findings and verdicts to files and report counts only. `interlock run reviewed` MUST adjudicate those files with the same survival, evidence and band rules as `interlock review`, using the run's observed changed paths, MUST record metrics, and MUST plan round one. `interlock run remediated --round N` MUST re-adjudicate, record fixed and deferred counts, and obtain the next round, the verdict or the halt from the published remediation cap. No agent MUST be asked to run review or remediation commands, and no driver MUST carry or copy the round budget.

#### Scenario: Happy path — one fixing round clears the blockers

- **GIVEN** a first adjudication with two surviving blockers and a cap of two fixing rounds
- **WHEN** the round-one fixer's rewritten findings and verdicts adjudicate to zero blockers
- **THEN** `run remediated --round 1` emits the verdict step
- **AND** the manifest records one fixing round used

#### Scenario: Failure — blockers survive the verdict

- **GIVEN** a blocker that survives every fixing round and the verdict
- **WHEN** `run remediated` runs for the verdict round
- **THEN** it emits a `halt` step whose reason names the surviving blocker count
- **AND** no commit step is ever emitted for the run

#### Scenario: Edge case — the cap is raised by one

- **GIVEN** the remediation cap raised from two to three in the limits definition
- **WHEN** a run with persistent blockers executes
- **THEN** three fixing rounds run before the verdict
- **AND** no driver or briefing changed to make that happen

### Requirement: Dimension selection SHALL be a recorded rule, and an agent-added dimension SHALL be recorded

The CLI MUST select `language`, `architecture`, `qa` and `technical-lead` for every review, MUST add `devops` when the observed changed paths include deploy, continuous-integration, configuration or infrastructure files, and MUST add `security` when they include authentication, input-handling or data-exposure files, by the same path classification the run uses for risk. It MUST add `domain` when an observed changed path is linked by a reliable edge of the run's graph to a living spec, or when the change's own delta specs modify a capability that has a living spec, by the rule the domain-review capability states, and MUST NOT add it otherwise. When no graph is available the CLI MUST record `domain` as skipped with the reason unless the change's own capabilities select it; when a graph is available and selects nothing, it MUST record why `domain` was not selected. The step MUST record the selected dimensions, a reason for each optional one, each skipped dimension with its reason, and the reason `domain` was not selected when it was not. Findings written under a dimension the CLI did not select MUST be accepted and the addition recorded on the manifest; the review briefing MUST NOT invite the reviewer to add `domain` itself.

#### Scenario: Happy path — a deploy change adds devops

- **GIVEN** a run whose observed changed paths include a CI workflow file
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists the four always-on dimensions and `devops`, with a reason naming the workflow file

#### Scenario: Happy path — a change that touches a specified file adds domain

- **GIVEN** a run whose graph links `lib/risk.mjs` to a living spec by a reliable edge, and whose observed changed paths include `lib/risk.mjs`
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` includes `domain`, after the always-on four, with a reason naming the capability and the file

#### Scenario: Failure — an unrelated path does not add security

- **GIVEN** a run whose only changed path is a documentation file no living spec is linked to, and whose change has no delta spec for an existing capability
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists exactly the four always-on dimensions
- **AND** no dimension is recorded as skipped, because a graph was available and it linked nothing, and the step records why `domain` was not selected

#### Scenario: Edge case — the reviewer adds a dimension

- **GIVEN** a review whose findings file contains a `security` dimension the CLI did not select
- **WHEN** `run reviewed` adjudicates
- **THEN** the security findings are adjudicated like any other
- **AND** the manifest records that `security` was agent-added

#### Scenario: Edge case — no graph is a recorded skip, not a silent absence

- **GIVEN** a run with no graph available and a change whose delta specs only add a new capability
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists exactly the four always-on dimensions
- **AND** the step records `domain` as skipped with the reason that no graph exists

### Requirement: The autonomy record of a strict run SHALL be written by the closing step from the adjudicated count

When the manifest is strict, `interlock run close` MUST record the review-code outcome with the surviving-blocker count from the last adjudication the CLI performed. The commit briefing MUST NOT ask the agent to record it. A non-strict run MUST write no autonomy record.

#### Scenario: Happy path — a clean strict run records zero blockers

- **GIVEN** a strict run whose final adjudication left zero blockers
- **WHEN** `run close` runs
- **THEN** the autonomy ledger gains one review-code record with zero blockers
- **AND** the commit briefing for that run contains no autonomy instruction

#### Scenario: Failure — a halted strict run still records what was adjudicated

- **GIVEN** a strict run halted at the verdict with one surviving blocker
- **WHEN** `run close --halt` runs
- **THEN** the autonomy ledger gains one review-code record with one blocker

#### Scenario: Edge case — a lean run records nothing

- **GIVEN** a run with no tail flag
- **WHEN** `run close` runs
- **THEN** the autonomy ledger is unchanged

### Requirement: The run program SHALL read the Workflow host's environment and version at start and decide the routing banners and the ping model

`interlock run start --host workflow` MUST read `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and the Bedrock variables from its own environment, MUST learn the host version from the host's own version command, and MUST decide from them. On a host at or above the version from which the plain variable sets only the default subagent model, a set `CLAUDE_CODE_SUBAGENT_MODEL` MUST raise no `MODEL ROUTING OVERRIDDEN` banner, the control-plane ping model MUST stay `haiku`, and an advisory note MUST say the variable sets only the default on this host. On an older host, or when the version cannot be read, the run MUST raise `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=<value> — every agent runs on that model, so the per-tier assignment in the plan is not in effect`, MUST carry no ping model, and MUST say when the version was unknown. A set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on a host at or above the version that introduced it, or whose version is unknown, MUST raise `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model`, MUST carry no ping model, and MUST record the host's observed model-selection kind as `forced`. With a Bedrock variable set the ping model MUST be absent and a note MUST say the pings inherit the session model. Both version floors MUST be named constants in the module that reads them. The teams variable MUST raise no run banner. The start step MUST carry the decided ping model as a field, the Workflow driver MUST set its control-plane ping model from that field alone, and the driver MUST NOT read any of these variables itself.

#### Scenario: Happy path — a current host keeps haiku pings and raises no banner

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL=opus` in the CLI's environment, no Bedrock variable, and a host whose version command reports `2.1.288`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step and the manifest carry no `MODEL ROUTING OVERRIDDEN` banner
- **AND** the step's ping model is `haiku`
- **AND** the manifest carries a note saying `CLAUDE_CODE_SUBAGENT_MODEL=opus` sets only the default subagent model on this host

#### Scenario: Failure — an older host is bannered and the pings carry no model

- **GIVEN** the same variable and a host whose version command reports `2.1.250`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step and the manifest carry `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=opus`
- **AND** the step's ping model is absent

#### Scenario: Failure — FORCE is bannered by name and the model-selection kind is refined

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and a host whose version command reports `2.1.288`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step carries `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model`
- **AND** the manifest's host records model selection `forced`
- **AND** the step's ping model is absent

#### Scenario: Edge case — an unreadable version falls back to today's reading and says so

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL=opus` and a host whose version command fails
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step carries `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=opus` with `(host version unknown)`
- **AND** the run is not halted

#### Scenario: Edge case — a Bedrock variable withholds the ping model and says so

- **GIVEN** `CLAUDE_CODE_USE_BEDROCK=1`, no subagent-model variable, and a current host
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step's ping model is absent
- **AND** the manifest carries a note that control-plane pings run on the session model
- **AND** no `MODEL ROUTING OVERRIDDEN` banner is raised

#### Scenario: Edge case — the driver forwards the field and holds no probe of its own

- **GIVEN** the Workflow driver's source and the start step it receives
- **WHEN** the driver sets its control-plane ping model
- **THEN** it reads the step's field and contains no instruction to print the subagent-model or Bedrock variables
- **AND** the relay whitelist carries the field

### Requirement: The runtime's concurrency SHALL be observed and bannered, never resized

`interlock run start --host workflow` MUST record on the manifest the concurrency the runtime will honour as the CLI can observe it: the environment override when `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` holds an integer in the vendor's range, otherwise the vendor default together with the machine's CPU count and the fact that the runtime may run fewer on a small machine. When a plan is adopted and its widest batch holds more lanes than an observed environment override, the run MUST raise `WAVE WIDER THAN RUNTIME SLOTS` naming the widest batch's lane count, the override and how many lanes queue, and MUST NOT resize the plan. A value outside the vendor's range or not an integer MUST be recorded as invalid and otherwise ignored. `interlock limits` MUST print the observed value beside the vendor default in its text and its JSON.

#### Scenario: Happy path — an override wider than every batch is recorded and silent

- **GIVEN** `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=4` and a plan whose widest batch has two lanes
- **WHEN** the run starts and adopts the plan
- **THEN** the manifest records an observed concurrency of 4 from the environment
- **AND** no `WAVE WIDER THAN RUNTIME SLOTS` banner is raised

#### Scenario: Failure — a batch wider than the override is bannered and not resized

- **GIVEN** `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=2` and a plan whose widest batch has three lanes
- **WHEN** the plan is adopted
- **THEN** the step and the manifest carry `WAVE WIDER THAN RUNTIME SLOTS` naming 3 lanes, the override of 2 and 1 lane queuing
- **AND** the run state's batches are the plan's, unchanged

#### Scenario: Edge case — no override records the vendor default with the CPU count

- **GIVEN** the variable unset on an 8-CPU machine
- **WHEN** the run starts
- **THEN** the manifest records the vendor default as the source with CPU count 8
- **AND** `interlock limits` prints the vendor default beside the words that it may be reduced on this 8-CPU machine
- **AND** no banner is raised for any batch width

#### Scenario: Edge case — an invalid override is recorded invalid and ignored

- **GIVEN** `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=lots`
- **WHEN** the run starts
- **THEN** the manifest records the value as invalid with its raw text
- **AND** the run proceeds as if the variable were unset

### Requirement: Run start SHALL speak every unspoken interrupted-run note once

`interlock run start` MUST read every interrupted-run note in the root, whatever change it names, and for each note not yet spoken MUST carry `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>` on the start step and the manifest, then MUST mark that note spoken. A note already spoken MUST raise nothing. A note that cannot be read MUST become a manifest note naming the file and the reason. Neither an unreadable note nor one that cannot be marked spoken MAY change the exit code or halt the run.

#### Scenario: Happy path — one unspoken note is spoken and marked

- **GIVEN** an unspoken note for run `r-1` of change `add-foo` at stage `remediation`
- **WHEN** `interlock run start` runs for any change
- **THEN** the start step and the manifest carry `PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage remediation — no resume card was written; interlock run-log show r-1`
- **AND** the note is marked spoken

#### Scenario: Failure — an unreadable note is named and the run proceeds

- **GIVEN** a note file that is not valid JSON
- **WHEN** `interlock run start` runs
- **THEN** the manifest carries a note naming the file as unreadable with its reason
- **AND** the start step is the ordinary first step, not a halt

#### Scenario: Edge case — a spoken note is silent and two unspoken notes are two banners

- **GIVEN** one note already marked spoken and two unspoken notes for two different runs
- **WHEN** `interlock run start` runs
- **THEN** exactly two `PREVIOUS RUN INTERRUPTED` banners are carried, one per unspoken note
- **AND** the spoken note raises nothing

### Requirement: Run start SHALL locate the test profile and the graph through the state home, banner each outcome, and leave no driver probing them

At `run start` the run program SHALL locate the test profile in the working root first and in the state home second, record the path it found and its source on the manifest, and raise exactly one of: the read-through banner `TEST PROFILE FROM MAIN CHECKOUT: <path>`, the existing no-profile line, or nothing. It SHALL locate the graph the same way and raise exactly one of: `GRAPH FROM MAIN CHECKOUT: <path>` with the sentence that it may be stale for this worktree and that a lane without a graph falls back to grep, the existing graph-unavailable line, or nothing. Every later reader of the profile in that run SHALL read the recorded path. No host driver SHALL probe either file or raise either line: the Workflow driver's environment ping SHALL ask only for the effort override and SHALL create the working directory, and the no-policy sweep SHALL fail on a driver that names either banner.

#### Scenario: Happy path — a main checkout with both files raises nothing

- **GIVEN** a working root that holds a test profile and a built graph
- **WHEN** `run start` runs
- **THEN** the manifest records both paths with source `root`
- **AND** the start step carries neither a read-through banner nor a missing-input line

#### Scenario: Failure — neither the root nor the home has them

- **GIVEN** a linked worktree and a main checkout holding neither file
- **WHEN** `run start` runs
- **THEN** the start step carries the no-profile line and the graph-unavailable line
- **AND** the Workflow driver's source names neither line, which the sweep asserts

#### Scenario: Edge case — the root lacks them and the home has them

- **GIVEN** a linked worktree holding neither file and a main checkout holding both
- **WHEN** `run start` runs and a later verify step reads the profile
- **THEN** the start step carries `TEST PROFILE FROM MAIN CHECKOUT` and `GRAPH FROM MAIN CHECKOUT`
- **AND** the verify step builds its plan from the recorded path, and no file is written into the main checkout

### Requirement: Every run subcommand SHALL use the state home its manifest recorded, and a subcommand that finds no manifest SHALL name the home's manifest when one exists there

`run start` SHALL resolve the state home once, record it on the manifest with the surface, and every later `run` subcommand SHALL read corpora from and append corpora to that recorded home without resolving again; a manifest without a recorded home SHALL use the working root. When a `run` subcommand finds no manifest in the working root and the resolved home differs from the root and holds a manifest, the halt SHALL name both paths and say a session that moved into a worktree after run start continues the run from the home.

#### Scenario: Happy path — one home for the whole run

- **GIVEN** a run started in a linked worktree whose manifest recorded state home `/r`
- **WHEN** every later subcommand of the run executes, including the close
- **THEN** each appends to `/r/.claude/ship/runs/<runId>.jsonl` and none runs the resolver again

#### Scenario: Failure — a manifest without a recorded home

- **GIVEN** a manifest written before the home was recorded
- **WHEN** a later subcommand appends to the trajectory
- **THEN** the append goes under the working root

#### Scenario: Edge case — a subcommand run from a worktree whose manifest is in the home

- **GIVEN** a manifest at `/r/.claude/ship/run.json` and a `run record-batch` invoked from a linked worktree of `/r` holding no manifest
- **WHEN** the command runs
- **THEN** it halts naming both manifest paths and the sentence about a session that moved

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

### Requirement: The closing step SHALL assess merge confidence once, from what this run observed

When a run closes without a halt, `interlock run close` MUST assess merge confidence one time, before it builds the receipt, from an input gathered as the merge-confidence command gathers it. The input MUST take the run's start commit as the base; the paths of the commit the run made as the changed paths, or the working tree's changed paths when the run made no commit; the review record this run adjudicated; the final verification verdict this run acted on; the handoff's recorded counts; coverage figures computed against the start commit when that verdict shows the coverage command ran; and a run record holding whether the trajectory is complete, the stage markers not published, the handoff reports rejected, the permission prompts and auto-mode denials observed, and the tasks left unticked. It MUST supply no pipeline input, so the pipeline signal reads unobserved.

The final verification verdict, or the reasons the CLI skipped final verification, MUST be recorded with the run's identifier when it is judged, so the close reads the verdict the run acted on. A review record or a verification record left in the working directory by an earlier run MUST NOT be read: the close MUST take the review record only when this run adjudicated a review, and the verification record only when it carries this run's identifier, and MUST treat either as absent otherwise.

A close that carries a halt reason MUST NOT assess. A run that recorded no start commit MUST read every signal that needs a base as unobserved, naming the missing start commit. A run that made no commit, because it was told not to or because its commit step reported failure, MUST read the diff-shape and spec-coverage signals as unobserved with that reason.

#### Scenario: Happy path — a strict run is assessed from its own facts

- **GIVEN** a strict run that reviewed with no surviving finding, passed final verification, confirmed every scenario and living requirement, committed, and left no task unticked
- **WHEN** the driver calls `run close` with the commit result
- **THEN** the assessment's verdict is `HUMAN` and its driving list names `ci.pipeline`, with the reason that no pipeline input was given
- **AND** the review, verification, conformance and run-integrity signals read what the run observed

#### Scenario: Failure — a halted run is not assessed

- **GIVEN** a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason>`
- **THEN** no merge-confidence assessment is made
- **AND** the exit code is `1`, as it was before

#### Scenario: Failure — an earlier run's review is not this run's

- **GIVEN** a working directory that still holds the review record and the verification record of an earlier strict run, and a lean run that verified, committed and never reviewed
- **WHEN** the lean run closes
- **THEN** its assessment reads the `review.ran` signal amber with the reason that no review ran, and reads nothing from the earlier review record
- **AND** its verification signals read the verdict this run recorded, not the earlier one

#### Scenario: Edge case — a lean run reads HUMAN and says why

- **GIVEN** a lean run that verified, committed and never reviewed, in a working directory with no earlier record
- **WHEN** the run closes
- **THEN** the assessment's verdict is `HUMAN`
- **AND** its driving list names `review.ran`, with the reason that no review ran

#### Scenario: Edge case — no start commit, and a run that made no commit

- **GIVEN** one completed run whose manifest recorded no start commit, another that ran with the no-commit option, and a third whose commit step reported failure
- **WHEN** each closes
- **THEN** the first reads the diff-shape, human-paths and spec-coverage signals unobserved, each naming the missing start commit
- **AND** the second and third read the diff-shape and spec-coverage signals unobserved with the reason that the run made no commit, and read their other signals over the working tree's changed paths

### Requirement: The closing step SHALL record the assessment in the receipt, the outcome record and an evidence file, and SHALL NOT change its exit code for it

The close MUST record the assessment in three places: a `mergeConfidence` block on the receipt holding the verdict, the score, the worst band, the signal counts, the identifiers of the driving signals and the flags, and no reason or evidence text; the merge verdict in the outcome record's observed group; and an evidence file in the working root, beside the run's review record, holding a schema identifier, the change, the run identifier, the base, the head commit, whether the run committed, the inputs only the run observed, and the assessment. The evidence file is per-run working state and MUST NOT be written to the state home.

When the close did not assess, the receipt's block MUST be absent, never a zero score or a default verdict, no evidence file MUST be written, and the outcome record's verdict MUST be absent.

The verdict MUST NOT change the close's exit code. An assessment that cannot be made MUST leave the block absent and place `MERGE CONFIDENCE NOT ASSESSED: <reason>` in the degradation block. An evidence file that cannot be written MUST place `MERGE CONFIDENCE NOT WRITTEN: <reason>` there. A fact the gather could not read MUST place `MERGE EVIDENCE UNAVAILABLE: <what> — <reason>` there. None of the three MUST change the exit code. When a trajectory write or the reconstructability check fails after the receipt was built, the evidence file and the summary MUST carry an assessment whose run record says the trajectory is incomplete, and the exit code MUST be the one that failure already produces.

#### Scenario: Happy path — a completed run leaves its verdict in three places

- **GIVEN** a strict run that completed and committed, with an assessment of `HUMAN`
- **WHEN** the run closes
- **THEN** the receipt carries a `mergeConfidence` block with that verdict, the score, the counts, the driving signal identifiers and the flags, and no reason text
- **AND** the evidence file exists in the working root, names the change, the run and the commit, and records that the run committed
- **AND** the outcome record's observed group carries the same verdict, and the exit code is `0`

#### Scenario: Failure — a halted run records no verdict

- **GIVEN** a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason>`
- **THEN** the receipt's `mergeConfidence` is recorded as absent, not as a score of zero
- **AND** no evidence file is written by this close, and the outcome record's merge verdict is absent

#### Scenario: Failure — an assessment that cannot be made is spoken and changes no exit code

- **GIVEN** a run that completed and committed, and a gather that fails outright while the close is assessing
- **WHEN** the run closes
- **THEN** the degradation block carries `MERGE CONFIDENCE NOT ASSESSED:` with the reason
- **AND** the receipt's block is absent, no evidence file is written, and the exit code is `0`

#### Scenario: Edge case — a fact the gather could not read, and a run that made no commit

- **GIVEN** one completed run whose gather could not read the diff against the start commit, and another that made no commit
- **WHEN** each closes
- **THEN** the first's degradation block carries `MERGE EVIDENCE UNAVAILABLE:` naming the diff, and its assessment is still recorded with those signals unobserved
- **AND** the second's evidence file records that the run did not commit

#### Scenario: Edge case — a trajectory write fails after the receipt was built

- **GIVEN** a completed run whose terminal trajectory event cannot be appended
- **WHEN** the run closes
- **THEN** the evidence file's run record says the trajectory is incomplete, and its assessment reads the run-integrity signal amber
- **AND** the summary carries that assessment
- **AND** the exit code is `1`, from the failed write

### Requirement: The run's review record SHALL say which selected dimensions ran with their rubric

Every review record a run writes MUST carry a dimension record holding the dimensions the CLI selected, the selected dimensions whose criteria could not be read, whether the review step reported that it completed, the dimensions that ran, and the dimensions recorded as skipped with the reason for each. A dimension MUST be recorded as having run only when the review step reported that it completed and that dimension's criteria were delivered; a dimension a reviewer added beyond the CLI's selection MUST be recorded as having run and MUST NOT be recorded as selected. When the review step did not report that it completed, no dimension MUST be recorded as having run. The record MUST be written again, unchanged in meaning, by every later adjudication of the same run, so the last review record a run leaves still carries it.

The CLI does not watch one dimension run inside the review worker; "ran" in this record means dispatched with its criteria in a review the worker reported complete, and the documentation MUST say so.

#### Scenario: Happy path — a completed review records every selected dimension as run

- **GIVEN** a review step that selected four dimensions, read the criteria of all four, and whose worker reported that it completed
- **WHEN** the run adjudicates the review
- **THEN** the review record lists the four as selected and as run, none as unavailable, and the review as completed
- **AND** a merge-confidence assessment over that record reads the `review.ran` signal green with no flag

#### Scenario: Failure — unreadable criteria, and a review that did not complete

- **GIVEN** one review whose `qa` criteria file could not be read, and another whose worker returned no usable result
- **WHEN** each is adjudicated
- **THEN** the first record names `qa` as unavailable and does not list it as run
- **AND** the second record says the review did not complete and lists no dimension as run
- **AND** a merge-confidence assessment over either reads the `review.ran` signal amber

#### Scenario: Edge case — a skipped domain review and an agent-added dimension

- **GIVEN** a review for which the `domain` dimension was skipped for want of a graph, and whose worker reported one dimension it added with its reason
- **WHEN** the review is adjudicated
- **THEN** the record names `domain` as skipped with the reason
- **AND** the added dimension is listed as run and is not listed as selected

#### Scenario: Edge case — a remediation round keeps the record

- **GIVEN** a run whose first adjudication wrote the dimension record, followed by one fixing round
- **WHEN** the round is adjudicated and the review record is rewritten
- **THEN** the rewritten record carries the same selected, run, unavailable and skipped dimensions

### Requirement: A step SHALL carry its sequence number, a relayed input SHALL name the step it answers, and an unreadable relay SHALL be recovered before the run halts

Every step a `run` subcommand emits against a run manifest MUST carry `seq`, an integer one greater than the `seq` of the last step emitted in the same root. The count MUST continue across runs in that root rather than restart, so a file written for an earlier run never names a step of a later one. The relay to the Workflow host MUST carry `seq`, and the Workflow driver MAY read it. `run close` MUST write the step it prints to `.claude/ship/last-close.json`, and MUST still leave `.claude/ship/last-step.json` as the last non-close step left it.

An input a driver hands a `run` subcommand through `--results`, `--host-banners` or `--host-observed` MAY be an envelope: a JSON object whose only keys are `answers`, an integer, and `value`, the payload. The subcommand MUST read `value` as the input. It MUST refuse an envelope whose `answers` is not the `seq` of the last step emitted — for `run close`, one that names no step of the current run — by exiting non-zero with a reason on stderr that names the file, the step it answers and the current step, before it changes the run manifest, the run state, the trajectory, the task list or any record file. An input that is not an envelope MUST be read as before.

Once the Workflow driver has read a step, every write it asks a relay to make MUST be an envelope answering that step's `seq`. The relay prompt MUST tell the relay to make every write before it runs the command, to run the command once, and to copy a non-zero exit's output without running the command again. When a relay's copy does not parse as a step, the driver MUST read the CLI's own record — `last-close.json` for a `run close`, `last-step.json` otherwise — through a relay that runs a read-only command, and then:

- continue from that record when its `seq` is one greater than the last step the driver read, or for `run close` any greater;
- relay the original call once more, with the same writes, when that record's `seq` equals the last step the driver read, because the call never took effect;
- otherwise stop through the close, with a reason that quotes up to the first 200 characters the relay copied and names the record file.

A relay of `run start`, which has no earlier step to compare against, MUST be relayed once more when its copy does not parse.

#### Scenario: Happy path — every step is numbered and the relay carries the number

- **GIVEN** a root whose last emitted step was `seq` 11, from a run that has closed
- **WHEN** `interlock run start --json` starts a new run and `interlock run classified --json` follows
- **THEN** the two steps carry `seq` 12 and 13, and the relayed steps carry them too
- **AND** `run close --json` writes its step, with its own `seq`, to `.claude/ship/last-close.json` and leaves `.claude/ship/last-step.json` holding step 13's bytes

#### Scenario: Failure — a relay that runs the command before its write cannot record the stale file

- **GIVEN** a run whose last step is a `run-batch` at `seq` 7, and a `.claude/ship/results.json` still holding the envelope the previous batch's record answered, `answers: 5`
- **WHEN** the relay runs `interlock run record-batch --results .claude/ship/results.json --json` before writing the new envelope
- **THEN** the command exits non-zero, saying the file answers step 5 and the run is at step 7, and the run state, the task list and the trajectory are unchanged
- **AND** the relay writes the envelope answering step 7, runs the command again, and the batch is recorded from that envelope

#### Scenario: Failure — a relay that reruns a call that took effect is refused, and the run continues

- **GIVEN** a relay whose `run record-batch` call took effect and emitted step 8, and which then ran the same command again and copied the refusal as its result
- **WHEN** the driver finds the copy does not parse
- **THEN** it reads `.claude/ship/last-step.json` through a read-only relay, finds `seq` 8 one greater than step 7, and continues from that step
- **AND** the batch is recorded once, and no halt names the relay

#### Scenario: Edge case — a relay whose call never took effect is relayed again once

- **GIVEN** a relay whose results file did not parse, so the CLI refused it and emitted nothing, and which copied an empty result
- **WHEN** the driver reads `.claude/ship/last-step.json` and finds the `seq` of the step it last read
- **THEN** it relays the same call once more with the same writes, and continues from the step that relay copies

#### Scenario: Failure — a record that cannot be read either halts with what the relay copied

- **GIVEN** a relay whose copy does not parse, and a read-only relay whose copy of `last-step.json` does not parse either
- **WHEN** the driver stops the run
- **THEN** the halt reason names the relay's label and subcommand, says how many characters it copied, quotes up to their first 200, and names `.claude/ship/last-step.json`
- **AND** a `RELAY UNREADABLE` banner carries the same text to the close

#### Scenario: Edge case — a host that writes bare inputs is unaffected

- **GIVEN** the runner host, which writes `results.json` as a bare JSON array
- **WHEN** it calls `interlock run record-batch --results .claude/ship/results.json --json`
- **THEN** the batch is recorded exactly as before, with no check against `seq`
