## Purpose

Makes the CLI the single author of a ship run: every step, every agent briefing and every continuation is emitted by `interlock run`, so a host driver is an interpreter that holds no loop policy and no prompt text of its own.

## ADDED Requirements

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

#### Scenario: Edge case — the strict tail is still inline in the Workflow script during this change

- **GIVEN** the Workflow script's review, remediation and handoff sections behind the `host-tail` seam
- **WHEN** the no-policy test runs
- **THEN** those sections are recognised by an explicit, named allowance that the follow-on change removes
- **AND** the allowance names the seam so its removal is a one-line edit

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
