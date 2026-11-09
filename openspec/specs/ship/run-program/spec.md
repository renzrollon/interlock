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

### Requirement: The run program SHALL emit the review, remediation and handoff steps with criteria and policy inlined

When the run manifest carries a review flag, the waves' completion MUST be followed by a `review` step carrying one spawn per selected dimension, labelled `review-<dimension>`, whose briefing is that dimension's own: its written criteria, the repository's review policy prose, the run's changed files with their changed line ranges, the run's stage line and its unvalidated-reports block, and the one answer file it writes. The step MUST continue to `interlock run found`, which emits a `skeptics` step when there is something to judge, then one `remediate` step per fixing round and one for the verdict, each inlining the round's plan and the same criteria for every dimension to be re-reviewed. When the manifest carries a handoff or conformance flag, final verification MUST be followed by a `handoff` step whose briefing states whether a manual test plan is needed and lists the conformance scenarios to answer. A dimension whose criteria cannot be read MUST still be dispatched, its briefing saying it works from the dimension name alone, and MUST place `REVIEW RUBRIC UNAVAILABLE: <dimension>` on the step. Without any tail flag the emitted program MUST be identical to the lean program.

#### Scenario: Happy path — a strict run emits the tail in order

- **GIVEN** a manifest with `strict: true` and a wave state that has reached `done`
- **WHEN** the driver follows each step's continuation
- **THEN** the steps are `review`, `skeptics` when a blocker or warning was raised, one or more `remediate`, `verify-final`, `handoff`, `commit`, `close`, in that order
- **AND** the review step carries one spawn per selected dimension, each briefing containing that dimension's criteria text and the policy prose and no other dimension's

#### Scenario: Failure — a dimension's criteria file is missing

- **GIVEN** the `qa` criteria file cannot be read
- **WHEN** the `review` step is emitted
- **THEN** the `review-qa` spawn is still emitted and its briefing says the reviewer works from the dimension name alone
- **AND** the step carries `REVIEW RUBRIC UNAVAILABLE: qa`

#### Scenario: Edge case — the changed line ranges a reviewer is given

- **GIVEN** a run that pinned its start commit, whose observed changed paths hold one tracked file with two changed hunks and one untracked file
- **WHEN** the `review` step is emitted
- **THEN** every reviewer's briefing lists the tracked file with the two hunks' line ranges from the diff against the start commit, and the untracked file as one whole-file range
- **AND** a run that pinned no start commit lists the observed paths with no ranges under the branch word, and the step carries `REVIEW BASE NOT PINNED` as today

#### Scenario: Failure — the diff against the start commit cannot be read

- **GIVEN** a run that pinned its start commit, where `git diff` against that commit fails
- **WHEN** the `review` step is emitted
- **THEN** every reviewer's briefing lists the observed changed paths with no line ranges, and the step carries `REVIEW RANGES UNREAD: git diff against <sha> failed (<reason>)`
- **AND** the step still carries one reviewer spawn per selected dimension and continues to `interlock run found`

#### Scenario: Edge case — handoff without review

- **GIVEN** a manifest with `handoff: true` and `review: false`
- **WHEN** the waves complete and final verification passes
- **THEN** no `review`, `skeptics` or `remediate` step is emitted
- **AND** a `handoff` step is emitted before `commit`

### Requirement: Review adjudication and the remediation budget SHALL be computed by the CLI from files the agents wrote

Each reviewer MUST write its ledger to its own answer file and report only that it finished; each skeptic MUST write its verdicts to its own file and report the same. `interlock run found` MUST fold the answers into the findings work file, and `interlock run reviewed` MUST fold the verdicts into the verdicts work file and adjudicate both with the same survival, evidence and band rules as `interlock review`, using the run's observed changed paths, MUST record metrics, and MUST plan round one. `interlock run remediated --round N` MUST re-adjudicate the two work files the round's worker rewrote, record fixed and deferred counts, and obtain the next round, the verdict or the halt from the published remediation cap. No agent MUST be asked to run review or remediation commands, and no driver MUST carry or copy the round budget or the skeptic cap.

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

### Requirement: A run subcommand SHALL refuse a run that has already closed

Every `run` subcommand other than `run start` and `run close` SHALL halt when the run manifest records a halt or a completed close. The halt SHALL name the run id, say whether the run halted (with its reason) or closed, and say that `interlock run start` begins a new run. Such a refusal SHALL NOT append to the trajectory, SHALL NOT rewrite the last-step record, and SHALL NOT write any state, plan or briefing file.

#### Scenario: Failure — stepping a halted run

- **GIVEN** a manifest for run `R` that a close recorded as halted with reason `task-failures`
- **WHEN** `interlock run next --json` runs
- **THEN** it halts naming `R`, `halted` and `task-failures`, and the trajectory of `R` is byte-identical afterwards

#### Scenario: Happy path — a new run after a halt

- **GIVEN** the same halted manifest
- **WHEN** `interlock run start --change c --json` runs
- **THEN** a new run starts as before

### Requirement: A run manifest the CLI cannot read SHALL be named for what it is

When a `run` subcommand finds a manifest whose schema tag is not one this CLI reads, it SHALL halt naming:

- the file;
- the tag the file carries and the tag this CLI reads;
- the CLI's version;
- the remedy: close the run with the CLI that started it, or begin a new run.

It SHALL NOT say the subcommand was reached without `run start`. A manifest that exists and cannot be parsed SHALL be named as unreadable, not as absent. `run close` against a foreign manifest SHALL say the same, SHALL leave the manifest and any stage marker unchanged, and SHALL name the stage marker that still blocks a commit.

#### Scenario: Failure — a manifest from a newer CLI

- **GIVEN** `.claude/ship/run.json` carrying schema `interlock.run/2`
- **WHEN** `interlock run next --json` runs
- **THEN** the halt names `interlock.run/2`, `interlock.run/1` and the CLI's version
- **AND** the reason does not say `reached without interlock run start`

#### Scenario: Edge case — closing a foreign run

- **GIVEN** the same manifest and a stage marker for its change
- **WHEN** `interlock run close --halt x --json` runs
- **THEN** the close names the foreign tag and the stage marker's path, and both files are unchanged

### Requirement: Run start SHALL remove a classification left by an earlier run and say so

When the default classification file exists at `run start`, the start SHALL remove it and raise `STALE CLASSIFICATION REMOVED`, naming the file and when it was written. A classify step whose planner then writes nothing SHALL halt with the existing reason naming the unreadable classification.

#### Scenario: Failure — a planner that returns nothing over a leftover file

- **GIVEN** a `.claude/ship/classified.json` left by an earlier run
- **WHEN** a new run starts and its planner writes no classification
- **THEN** the start step carries `STALE CLASSIFICATION REMOVED`
- **AND** the classification step halts naming `.claude/ship/classified.json`, and no batch is dispatched from the old file

### Requirement: Run start SHALL name a rebuilt plan on the start step

When a stored plan existed and was not reused, `run start` SHALL raise `PLAN REBUILT (<status>): <reason>`. The banner SHALL say that tasks the earlier run finished but did not tick will be dispatched again. A first run with no stored plan and a reused plan SHALL raise no such banner. The closing summary's plan line SHALL be unchanged.

#### Scenario: Failure — a plan from an older format

- **GIVEN** a stored plan whose fingerprint records an earlier plan format
- **WHEN** `interlock run start --json` runs
- **THEN** the start step carries `PLAN REBUILT (plan-format-changed)`

#### Scenario: Edge case — a first run

- **GIVEN** no stored plan
- **WHEN** a run starts
- **THEN** the start step carries no `PLAN REBUILT` banner

### Requirement: The test profile SHALL be validated before a run starts and before a batch is recorded

`run start` SHALL halt, naming the profile's path and its first problem, when the test profile is present and invalid. `run record-batch` SHALL apply the same check before it changes the run state, the task list or the trajectory. A profile that became invalid mid-run SHALL therefore halt naming the profile, with nothing recorded for that batch.

#### Scenario: Failure — a profile edited mid-run

- **GIVEN** a running run whose test profile is edited so that its unit timeout is a string
- **WHEN** `interlock run record-batch --results r.json --json` runs
- **THEN** the step halts naming the profile and the timeout field
- **AND** no task is ticked, the run state is unchanged, and the next call is the close

### Requirement: A manifest field an earlier release did not write SHALL be defaulted out loud

When a `run` subcommand reads a manifest that lacks its inter-wave verify budget or its state home, it SHALL use the default it uses today. It SHALL raise `MANIFEST FIELD DEFAULTED` naming the field and the default, once per run per field.

#### Scenario: Failure — a manifest written before the verify budget existed

- **GIVEN** a running run whose manifest has no verify budget
- **WHEN** the next `run` subcommand reads it
- **THEN** the step carries `MANIFEST FIELD DEFAULTED` naming the verify budget and the default used
- **AND** later subcommands of the same run do not raise it again

### Requirement: Every run SHALL record the CLI and plugin that produced it, and SHALL banner a mismatch

The run manifest SHALL record the CLI's version and path, and the plugin's version and root when a plugin root was given. Every step SHALL carry the CLI's version, and the relay to the Workflow host SHALL carry it too. `run start` SHALL accept a plugin root. When the CLI's version differs from that plugin's version, it SHALL raise `CLI VERSION SKEW` naming both versions and paths.

The Workflow skill SHALL pass the plugin root to the driver, and the driver SHALL forward it to `run start`. When the start step carries no CLI version, the driver SHALL raise `CLI VERSION UNKNOWN` to the close. When `run start` cannot be read after its retry, the driver's halt reason SHALL suggest checking the CLI's version.

#### Scenario: Failure — the PATH CLI is a release behind the plugin

- **GIVEN** a plugin at `1.9.0` and a CLI at `1.8.0` that reports its version
- **WHEN** `/interlock:ship` starts a run
- **THEN** the start step carries `CLI VERSION SKEW` naming `1.8.0` and `1.9.0`
- **AND** the manifest records both

#### Scenario: Edge case — a CLI that predates version reporting

- **GIVEN** an `interlock` on PATH that emits steps without a CLI version
- **WHEN** the driver reads the start step
- **THEN** the close carries `CLI VERSION UNKNOWN`

### Requirement: `interlock run found` SHALL fold the reviewers' answers and emit the skeptics step

After the review step, `interlock run found` MUST read each selected dimension's answer file by its expected name, record per dimension whether it ran, write the readable ledgers to the findings work file, and emit a `skeptics` step with one spawn per prompt the published skeptic assembler builds at the strict shape over the surviving blockers and warnings, each spawn writing its own verdict file. With nothing to judge it MUST write an empty verdict list and adjudicate at once.

#### Scenario: Happy path — every reviewer answered and two findings are judged

- **GIVEN** a strict run whose review step dispatched five dimensions, each of which wrote `.claude/ship/review/dimensions/<dimension>.json` holding `{ dimension, findings, coverage }`, two findings being a blocker and a warning
- **WHEN** the driver calls `interlock run found`
- **THEN** the findings work file holds the five ledgers, the manifest records all five dimensions as run and the review as completed
- **AND** the step's action is `skeptics` with four spawns of kind `skeptic`, labelled `skeptic-<id>-refute` and `skeptic-<id>-second-opinion` for each of the two findings, each briefing naming `.claude/ship/review/skeptics/<label>.json` as the only file it writes besides the `review` stage marker its stage line asks for, and `then.argv` names `run reviewed`

#### Scenario: Failure — one reviewer wrote nothing

- **GIVEN** the same run, whose `qa` reviewer wrote no answer file
- **WHEN** `interlock run found` runs
- **THEN** the step carries `REVIEW INCOMPLETE: qa — no answer file`, the manifest records `qa` as not run and the review as not completed, and the four other ledgers are folded
- **AND** the skeptics step is still emitted over the findings that were written, and the run does not halt

#### Scenario: Failure — an empty answer file, and a reviewer that said why

- **GIVEN** the same run, whose `qa` answer file holds only whitespace, and whose `language` reviewer wrote no file and returned `{ ok: false, detail: "ran out of context" }`
- **WHEN** `interlock run found` runs
- **THEN** the step carries `REVIEW INCOMPLETE: qa — .claude/ship/review/dimensions/qa.json is empty` and `REVIEW INCOMPLETE: language — no answer file; the reviewer reported: ran out of context`, and both are recorded as not run

#### Scenario: Failure — an answer under another dimension's name is not adjudicated

- **GIVEN** a `security` answer file whose `dimension` field reads `architecture`
- **WHEN** `interlock run found` runs
- **THEN** the step carries `REVIEW ANSWER MISMATCHED: security wrote architecture`, `security` is recorded as not run, and the file's findings are not folded
- **AND** a `dimension` value that is not a string is printed as its JSON, and any value is cut to one line of at most 80 characters, so a reviewer cannot put arbitrary text into a relayed banner

#### Scenario: Edge case — nothing to judge

- **GIVEN** a run whose reviewers raised only suggestions, or nothing
- **WHEN** `interlock run found` runs
- **THEN** no `skeptics` step is emitted, the verdicts work file holds an empty list, and the step returned is the adjudication's continuation, a `remediate` step or final verification, as `run reviewed` would return it

#### Scenario: Edge case — a finding the review policy excludes is never briefed

- **GIVEN** a blocker whose file matches a Do-Not-Report path of the repository's review policy
- **WHEN** `interlock run found` builds the skeptics step
- **THEN** no skeptic is briefed on it, and the adjudication later counts it under `droppedByPolicy` as it does today

### Requirement: The skeptics step SHALL be bounded by a published cap, blockers first

The spawns of a `skeptics` step MUST be bounded by `maxSkepticSpawns`, a cap stated once in the limits definition, printed by `interlock limits` and read only by the CLI. The CLI MUST give two spawns per finding, blockers before warnings in finding order, and when the rest does not fit, one per-review pair reserved inside the cap, raising `SKEPTIC CAP REACHED`. Each review and skeptics step MUST carry a `REVIEW WAVE` banner naming its reviewer and skeptic counts with their routing.

#### Scenario: Happy path — under the cap every finding gets its own pair

- **GIVEN** a cap of 16 and a review with three blockers and two warnings
- **WHEN** `interlock run found` builds the skeptics step
- **THEN** it carries ten spawns, two per finding, and no `SKEPTIC CAP REACHED` banner

#### Scenario: Failure — over the cap the remainder shares one pair

- **GIVEN** a cap of 16 and a review with four blockers and seven warnings
- **WHEN** `interlock run found` builds the skeptics step
- **THEN** it carries sixteen spawns: a pair for each of the four blockers and the first three warnings, and one `skeptic-review-refute` and `skeptic-review-second-opinion` pair briefed on the remaining four warnings
- **AND** the step carries `SKEPTIC CAP REACHED: 7 of 11 findings judged per finding, 4 judged per review`

#### Scenario: Edge case — the cap is published and read by the CLI alone

- **GIVEN** the installed CLI
- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** the text carries a row for the skeptic spawn cap and the JSON carries `maxSkepticSpawns` under `limits`
- **AND** the cap-authority check finds its reader in the CLI and no literal of it in a driver or a skill

#### Scenario: Happy path — the review step and the skeptics step say what they spend

- **GIVEN** a strict run selecting six dimensions whose review raises two blockers
- **WHEN** the review step and then the skeptics step are emitted
- **THEN** the review step carries `REVIEW WAVE: 6 reviewers (<model>/<effort>), 0 skeptics (<model>/<effort>)`, because `run found` has not counted them yet
- **AND** the skeptics step carries `REVIEW WAVE: 6 reviewers (<model>/<effort>), 4 skeptics (<model>/<effort>)`, with `inherit` printed on either where the routing holds `null`

### Requirement: A review or skeptics step wider than the run's --max-parallel SHALL say so

A review or skeptics step whose spawns outnumber the `--max-parallel` the run was started with MUST carry `REVIEW WIDER THAN MAX PARALLEL`, naming the step, its spawn count and the flag's value, because no driver chunks a step and a runner host starts every spawn of it at once. The step's spawns MUST be the same with or without the flag.

#### Scenario: Failure — a step wider than the operator's --max-parallel is said

- **GIVEN** a strict run started with `--max-parallel 2` that selects six dimensions and whose review raises two blockers
- **WHEN** the review step and then the skeptics step are emitted
- **THEN** the review step carries `REVIEW WIDER THAN MAX PARALLEL: the review step spawns 6 agents and --max-parallel is 2` and the skeptics step the same line for its four spawns
- **AND** a run started without `--max-parallel`, or with one at least as wide as the step, carries no such line, and neither step's spawns change

### Requirement: `interlock run reviewed` SHALL fold the skeptics' verdicts and set aside an unanswered pair

`interlock run reviewed` MUST read each verdict file the skeptics step named, by its expected name, concatenate the readable ones into the verdicts work file, and adjudicate as it does today. A verdict file that is absent, unparseable or not a list MUST set aside both verdicts of its pair and raise `SKEPTIC VERDICTS MISSING: <labels>`, so the finding survives unjudged. Without a `run found` record for the run it MUST halt naming the step it needed.

#### Scenario: Happy path — every skeptic answered

- **GIVEN** a skeptics step of four spawns, each of which wrote its verdict file holding a list of verdicts
- **WHEN** the driver calls `interlock run reviewed`
- **THEN** the verdicts work file holds the four lists concatenated, and the adjudication, the dimension record, the proof, the review record, the metrics and the first remediation plan are written as they are today

#### Scenario: Failure — one skeptic wrote nothing

- **GIVEN** the same step, whose `skeptic-<id>-refute` spawn wrote no file
- **WHEN** `interlock run reviewed` runs
- **THEN** the step carries `SKEPTIC VERDICTS MISSING: skeptic-<id>-refute`, both verdicts of that finding's pair are set aside, and the finding survives with no verdict
- **AND** a merge-confidence assessment over the run flags the finding's vote count below the published floor, and the finding is never dismissed by the one verdict that did arrive

#### Scenario: Failure — a verdict file that is not a list

- **GIVEN** a verdict file holding an object with no list in it
- **WHEN** `interlock run reviewed` runs
- **THEN** the pair is set aside and named in the banner exactly as an absent file would be

#### Scenario: Failure — the review step predates the fold

- **GIVEN** a run manifest that carries no `run found` record
- **WHEN** `interlock run reviewed` runs
- **THEN** it halts with a reason naming `run found`, and reads no verdicts work file left by an earlier run

### Requirement: Dimension selection SHALL be a recorded rule

The CLI MUST select the strict depth's always-on dimensions as the limits surface publishes them, add `devops` for deploy, CI, configuration or infrastructure paths and `security` for authentication, input-handling or data-exposure paths by the run's risk path classification, and add `domain` only by the domain-review capability's rule. The step MUST record the selection, a reason per optional dimension, each skip with its reason, and why `domain` was not selected.

#### Scenario: Happy path — a deploy change adds devops

- **GIVEN** a run whose observed changed paths include a CI workflow file
- **WHEN** the `review` step is emitted
- **THEN** the selection lists the published always-on dimensions and `devops`, with a reason naming the workflow file, and the step carries one reviewer spawn per listed dimension

#### Scenario: Happy path — a change that touches a specified file adds domain

- **GIVEN** a run whose graph links `lib/risk.mjs` to a living spec by a reliable edge, and whose observed changed paths include `lib/risk.mjs`
- **WHEN** the `review` step is emitted
- **THEN** the selection includes `domain`, after the always-on dimensions, with a reason naming the capability and the file

#### Scenario: Failure — an unrelated path does not add security

- **GIVEN** a run whose only changed path is a documentation file no living spec is linked to, and whose change has no delta spec for an existing capability
- **WHEN** the `review` step is emitted
- **THEN** the selection lists exactly the published always-on dimensions
- **AND** no dimension is recorded as skipped, because a graph was available and it linked nothing, and the step records why `domain` was not selected

#### Scenario: Edge case — no graph is a recorded skip, not a silent absence

- **GIVEN** a run with no graph available and a change whose delta specs only add a new capability
- **WHEN** the `review` step is emitted
- **THEN** the selection lists exactly the published always-on dimensions
- **AND** the step records `domain` as skipped with the reason that no graph exists

### Requirement: The run's review record SHALL say per dimension whether it ran

Every review record a run writes MUST carry a dimension record holding the dimensions the CLI selected, those whose criteria could not be read, those that ran, those skipped with a reason, and whether the review completed. A dimension MUST be recorded as run only when `run found` read its own answer file under its own name; the review completed when every dispatched dimension ran. Every later adjudication of the run MUST write the record again, unchanged in meaning.

#### Scenario: Happy path — a completed review records every selected dimension as run

- **GIVEN** a review step that selected four dimensions, read the criteria of all four, and whose four reviewers each wrote their answer
- **WHEN** the run adjudicates the review
- **THEN** the review record lists the four as selected and as run, none as unavailable, and the review as completed
- **AND** a merge-confidence assessment over that record reads the `review.ran` signal green with no flag

#### Scenario: Failure — unreadable criteria, and a reviewer that did not answer

- **GIVEN** one review whose `qa` criteria file could not be read, whose `qa` reviewer was dispatched with its name alone and answered, and another review whose `regression` reviewer wrote nothing
- **WHEN** each is adjudicated
- **THEN** the first record names `qa` as unavailable and as run, and the review as completed
- **AND** the second record lists `regression` as not run and the review as not completed, and names the other dimensions as run
- **AND** a merge-confidence assessment over the second reads the `review.ran` signal amber

#### Scenario: Edge case — a skipped domain review

- **GIVEN** a review for which the `domain` dimension was skipped for want of a graph
- **WHEN** the review is adjudicated
- **THEN** the record names `domain` as skipped with the reason, and lists it neither as selected nor as run

#### Scenario: Edge case — a remediation round keeps the record

- **GIVEN** a run whose first adjudication wrote the dimension record, followed by one fixing round
- **WHEN** the round is adjudicated and the review record is rewritten
- **THEN** the rewritten record carries the same selected, run, unavailable and skipped dimensions

### Requirement: The closing step SHALL produce the summary and exit code both hosts print, from what the run observed, and SHALL accept a retired push request without acting on it

`interlock run close` MUST build the receipt from the run state, the results file and the manifest, append the outcome record, record the closing trajectory event, run the reconstructability check, and return the exit code, the summary and the banner list, which both drivers print verbatim. It MUST accept host-only banners. Neither driver MAY pass `--notify`. Until 1.16.0 the close MUST accept `--notify` and do nothing but add one summary row saying the push was removed.

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

#### Scenario: Happy path — neither driver requests a push

- **GIVEN** the Workflow script and the runner
- **WHEN** each assembles the arguments for `run close`
- **THEN** neither includes `--notify`
- **AND** neither contains a network call, a topic, or any notification text of its own

#### Scenario: Edge case — an older driver's push request closes the run and is spoken

- **GIVEN** a run ready to close, and a call to `run close --notify`
- **WHEN** the close returns
- **THEN** the exit code and banner list are those of the same close without `--notify`, and "No degradation banners" is still printed for a clean run
- **AND** the summary carries one row saying the push was removed, and no request is made

#### Scenario: Failure — a driver passes the retired flag again

- **GIVEN** a driver that passes `--notify` to `run close`
- **WHEN** the driver-parity test runs
- **THEN** it fails naming that driver and the flag
