## Purpose

Makes the CLI the single author of a ship run: every step, every agent briefing and every continuation is emitted by `interlock run`, so a host driver is an interpreter that holds no loop policy and no prompt text of its own.

## ADDED Requirements

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
