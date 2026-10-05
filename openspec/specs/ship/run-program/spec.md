# ship/run-program Specification

## Purpose

Makes the CLI the single author of a ship run: every step, every agent briefing and every continuation is emitted by `interlock run`, so a host driver is an interpreter that holds no loop policy and no prompt text of its own.

## Requirements

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

### Requirement: A briefing SHALL be a file whose first line carries its hash, and a host delivering it by reference SHALL fail closed a result that does not acknowledge that hash

For every spawn, the CLI MUST write the assembled briefing to a file whose first line names the spawn label and the SHA-256 of the briefing text, and MUST place the path, the hash and the text on the spawn. A host that cannot pass the text through its transport MAY deliver the briefing by reference with a fixed bootstrap that names the path and requires the agent to report the hash as `briefing`; such a host MUST treat a result whose `briefing` is absent or differs from the spawn's hash as a failed spawn with reason `briefing not acknowledged`. A result that is absent altogether — the runtime returned no result because it stopped the agent, the API failed or a usage limit ended it — MUST be recorded as a failed spawn with the banner `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed`, and MUST NOT be reported as `briefing not acknowledged`. A host that passes the text inline MUST ignore `briefing`.

#### Scenario: Happy path — a Workflow-runtime worker acknowledges its briefing

- **GIVEN** a spawn whose briefing file's first line carries hash `H`
- **WHEN** the Workflow-runtime interpreter spawns the worker with the bootstrap and the worker reports `briefing: "H"`
- **THEN** the result is accepted and recorded as the lane's result

#### Scenario: Failure — the worker never read the briefing

- **GIVEN** the same spawn
- **WHEN** the worker's result omits `briefing` or reports a different hash
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

The CLI MUST select `language`, `architecture`, `qa` and `technical-lead` for every review, MUST add `devops` when the observed changed paths include deploy, continuous-integration, configuration or infrastructure files, and MUST add `security` when they include authentication, input-handling or data-exposure files, by the same path classification the run uses for risk. The step MUST record the selected dimensions and a reason for each optional one. Findings written under a dimension the CLI did not select MUST be accepted and the addition recorded on the manifest.

#### Scenario: Happy path — a deploy change adds devops

- **GIVEN** a run whose observed changed paths include a CI workflow file
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists the four always-on dimensions and `devops`, with a reason naming the workflow file

#### Scenario: Failure — an unrelated path does not add security

- **GIVEN** a run whose only changed path is a documentation file
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists exactly the four always-on dimensions

#### Scenario: Edge case — the reviewer adds a dimension

- **GIVEN** a review whose findings file contains a `security` dimension the CLI did not select
- **WHEN** `run reviewed` adjudicates
- **THEN** the security findings are adjudicated like any other
- **AND** the manifest records that `security` was agent-added

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
