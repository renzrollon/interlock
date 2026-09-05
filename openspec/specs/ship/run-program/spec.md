# ship/run-program Specification

## Purpose

Makes the CLI the single author of a ship run: every step, every agent briefing and every continuation is emitted by `interlock run`, so a host driver is an interpreter that holds no loop policy and no prompt text of its own.

## Requirements

### Requirement: The CLI SHALL emit every step of the lean run as a versioned record that names its own continuation

`interlock run` MUST return, for every call, a step record carrying a schema identifier, an `action`, the list of agents to spawn — each with a stable label, a model slug, an effort, an agent type, a tools allowlist, a result schema and a briefing — and a `then` continuation naming the exact `interlock` argv to call once those agents return, or `null` when the run is finished. The set of actions MUST cover the whole lean run: classification, batches, inter-wave verification, replanning, final verification, commit and close. A driver MUST NOT branch on any flag, mode, count or verdict; every such branch MUST be taken inside the CLI from the run manifest and the run state.

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

### Requirement: A briefing SHALL be a file whose first line carries its hash, and a host delivering it by reference SHALL fail closed a result that does not acknowledge that hash

For every spawn, the CLI MUST write the assembled briefing to a file whose first line names the spawn label and the SHA-256 of the briefing text, and MUST place the path, the hash and the text on the spawn. A host that cannot pass the text through its transport MAY deliver the briefing by reference with a fixed bootstrap that names the path and requires the agent to report the hash as `briefing`; such a host MUST treat a result whose `briefing` is absent or differs from the spawn's hash as a failed spawn with reason `briefing not acknowledged`. A host that passes the text inline MUST ignore `briefing`.

#### Scenario: Happy path — a Workflow-runtime worker acknowledges its briefing

- **GIVEN** a spawn whose briefing file's first line carries hash `H`
- **WHEN** the Workflow-runtime interpreter spawns the worker with the bootstrap and the worker reports `briefing: "H"`
- **THEN** the result is accepted and recorded as the lane's result

#### Scenario: Failure — the worker never read the briefing

- **GIVEN** the same spawn
- **WHEN** the worker's result omits `briefing` or reports a different hash
- **THEN** the interpreter records a failed spawn with reason `briefing not acknowledged`
- **AND** the lane's tasks are recorded as failed, not as ok on the strength of the rest of the result

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

`interlock run close` MUST build the run receipt from the run state, the results file and the manifest, append the outcome record, record the closing trajectory event, run the reconstructability check, and return the exit code, the summary text and the banner list. Both drivers MUST print that summary verbatim. Host-only banners MUST be accepted on the call so the summary's degradation block stays complete.

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
