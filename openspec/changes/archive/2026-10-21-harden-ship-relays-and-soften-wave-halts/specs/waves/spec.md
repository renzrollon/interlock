## ADDED Requirements

### Requirement: Unresolved inter-wave checks SHALL warn, be carried forward, and never halt the run

A failed inter-wave check MUST buy the wave the published number of targeted fix attempts, as before. When those are spent and the check still fails, the run MUST record the wave's unresolved errors, raise a warning naming the wave, how many errors remain and how many attempts were spent, and advance to the next wave. It MUST NOT halt, whether or not the verdict reported that the errors block the next wave; that verdict MUST still be recorded beside the unresolved errors. Every batch of the wave that follows MUST be handed those errors, at most ten of them and each cut to 300 characters, and the implementer briefing for that batch MUST carry them under a section saying which checks were still failing after which wave, so the agent knows what it is building on. A briefing for a batch that follows no unresolved wave MUST carry no such section and MUST read exactly as before. An inter-wave check whose verification agent reported no result for a planned check — it was stopped, or its copy was lost — MUST be recorded as a skipped verification whose reason names the unreported checks, with its banner, and the run MUST advance. The final verification is not an inter-wave check: a red or unverified final suite MUST still stop the run before it commits.

#### Scenario: Happy path — red after both fix attempts, the run moves on

- **GIVEN** a run at wave 2's checkpoint whose typecheck still fails after both published fix attempts, and whose verdict reported the errors block wave 3
- **WHEN** the third failed result is recorded
- **THEN** the next step is wave 3's first batch, not a halt
- **AND** the run's unresolved errors name wave 2, its errors and that the verdict reported them as blocking, and a warning names wave 2 and the error count
- **AND** the step carries an `INTER-WAVE CHECKS UNRESOLVED` banner naming wave 2, the error count and the attempts spent

#### Scenario: Happy path — the next wave is told what is still failing

- **GIVEN** the same run
- **WHEN** wave 3's first batch is dispatched
- **THEN** each of its implementer briefings carries a section naming the checks still failing after wave 2 and lists wave 2's errors
- **AND** a briefing in a run with no unresolved wave carries no such section

#### Scenario: Edge case — many long errors are bounded

- **GIVEN** a wave left with fourteen unresolved errors, one of them 2,000 characters long
- **WHEN** the next wave's batch is dispatched
- **THEN** its briefings list ten errors, and none is longer than 300 characters

#### Scenario: Edge case — a checkpoint nobody reported on is skipped, not a stop

- **GIVEN** a run at wave 1's checkpoint whose plan holds a unit check, and a verification agent that returned no result
- **WHEN** `interlock run judge --context inter-wave` reads the empty report
- **THEN** the next step is wave 2's first batch
- **AND** the run's skipped verifications name wave 1 with a reason saying no result was reported for `unit`, and the step carries `VERIFICATION SKIPPED` with that reason

#### Scenario: Failure — the final suite still refuses to commit

- **GIVEN** a run whose waves all finished, one of them with unresolved inter-wave errors
- **WHEN** the final verification reports a red unit suite
- **THEN** the run halts before the commit, as before

### Requirement: A task that depends on a task that did not complete SHALL be skipped, not dispatched

When a batch is recorded, every task the run has not dispatched yet — in the remaining batches of the current wave and in every later wave — whose `dependsOn` names a task that was dispatched and did not complete (recorded as failed, or left not attempted after its lane stopped) or a task already skipped this way, directly or through a chain of such tasks, MUST be removed from the run before the next step is chosen. Each removed task MUST be recorded with its wave and the tasks it depended on that blocked it. A lane, batch or later wave left with no task MUST be removed with it. A skipped task MUST NOT be dispatched, MUST NOT be ticked, and MUST NOT count toward the task-failure halt, and the step that recorded the batch MUST carry a `DEPENDENTS SKIPPED` banner naming each newly skipped task and what it needed. Only `dependsOn` edges are read: a later numbered section is not a dependency of the earlier one. A task already dispatched beside the failed one is not affected.

#### Scenario: Happy path — a direct and a transitive dependent are skipped

- **GIVEN** a run whose wave 2 records task 2.1 as failed, whose wave 3 holds 3.1 depending on 2.1, 3.2 depending on 3.1, and 3.3 depending on nothing
- **WHEN** wave 2's batch is recorded
- **THEN** wave 3 holds only 3.3, and 3.1 and 3.2 are recorded as skipped, 3.1 needing 2.1 and 3.2 needing 3.1
- **AND** the step carries `DEPENDENTS SKIPPED` naming 3.1 and 3.2, and the run's task-failure count is one

#### Scenario: Edge case — a wave emptied by skipping is removed

- **GIVEN** a run whose wave 3 holds only tasks that depend on a task wave 2 failed
- **WHEN** wave 2's last batch is recorded
- **THEN** wave 3 is gone from the run, and the next step is the wave after it, or the run's end when there is none
- **AND** no checkpoint is spent on a wave that ran nothing

#### Scenario: Edge case — the remaining batches of the current wave are pruned too

- **GIVEN** a wave of two batches whose first records 1.1 as failed, and whose second holds 1.4, which depends on 1.1, and 1.5, which does not
- **WHEN** the first batch is recorded
- **THEN** the second batch dispatches 1.5 alone, and 1.4 is recorded as skipped

#### Scenario: Edge case — a task its lane never reached blocks its dependents too

- **GIVEN** a lane holding 1.1 and 1.2 that stopped when 1.1 failed, and a later task 2.1 that depends on 1.2
- **WHEN** the batch is recorded
- **THEN** 2.1 is recorded as skipped needing 1.2, and the run's task-failure count is one

#### Scenario: Failure — three real failures still halt

- **GIVEN** a run with two recorded task failures and four skipped dependents
- **WHEN** a third task is recorded as failed
- **THEN** the run halts on the task-failure cap, and the skipped tasks are not counted in its failures
