# Delta for waves

## ADDED Requirements

### Requirement: An inter-wave check SHALL wait for the implementation a failing-test wave is owed

When a run is test-first and an implementation wave that is neither a failing-test wave nor documentation-only still follows the completed wave, the run MUST skip that wave's check, record the skip under its own non-empty reason, spend no checkpoint and no fix attempt, and advance. Which waves still follow MUST be read from the waves the run holds when the wave ends. The run MUST NOT return to a check skipped this way.

#### Scenario: Happy path — implementation split across waves is checked after its last wave

- **GIVEN** a test-first plan with a failing-test wave, three implementation waves and a trailing test wave
- **WHEN** each implementation wave finishes
- **THEN** the first two advance with no `verify` step and each records the owed-implementation reason
- **AND** the third gets an ordinary check

#### Scenario: Failure — a check still red after the implementation buys its fix attempts

- **GIVEN** the same plan at the check after its last implementation wave
- **WHEN** that check reports a red suite
- **THEN** the run issues the published number of fix attempts
- **AND** a suite still red after them is recorded as unresolved, as for any other wave

#### Scenario: Edge case — the wait spends no checkpoint, so the cap cannot take the last check

- **GIVEN** a test-first plan with more implementation waves than the published checkpoint cap
- **WHEN** the run reaches the check after its last implementation wave
- **THEN** that check runs
- **AND** no skip carries the cap's reason

#### Scenario: Edge case — a waiting check is not an unresolved failure

- **GIVEN** a wave whose check was skipped because implementation is owed
- **WHEN** the next wave's implementers are briefed and the run closes
- **THEN** their briefing has no still-failing section and the run's unresolved errors are unchanged
- **AND** the close names the skip with a `VERIFICATION SKIPPED` banner carrying its reason

#### Scenario: Edge case — a later wave removed from the run no longer counts as owed

- **GIVEN** a test-first plan whose remaining implementation wave was already dropped by a replan or emptied by skipped dependents
- **WHEN** the wave before it then finishes and a following wave exists
- **THEN** that wave gets an ordinary check

#### Scenario: Edge case — owed implementation removed after the wait re-opens no check

- **GIVEN** a wave whose check was skipped because one implementation wave was owed
- **WHEN** a replan at the start of the next wave drops that owed wave
- **THEN** the run continues with the waves that remain and issues no `verify` step for the passed wave
- **AND** the skip stays recorded under the owed-implementation reason, and the final verification gates the commit

#### Scenario: Edge case — a documentation-only wave is not implementation

- **GIVEN** a test-first plan whose only later wave before the trailing test wave claims documentation paths alone
- **WHEN** the implementation wave before it finishes
- **THEN** that wave gets an ordinary check

#### Scenario: Edge case — a plan with no failing-test wave is unchanged

- **GIVEN** a plan with several implementation waves and no failing-test wave
- **WHEN** each wave finishes with a following wave
- **THEN** each is eligible for an ordinary check, subject to the documentation and cap skips

#### Scenario: Edge case — the plan preview agrees with the run

- **GIVEN** a test-first plan whose implementation spans several waves, fresh or narrowed for a re-run
- **WHEN** `formatPlan` prints it
- **THEN** the projected inter-wave verifies exclude the failing-test wave and every waiting check
- **AND** each waiting wave's line says its check waits
- **AND** the planner's warning names the check after the last implementation wave, or the final verification when no such check exists, as the gate

### Requirement: A run SHALL know it is test-first from its plan

A run is test-first when the plan it was created from names a failing-test section, whether that section's wave runs in this run or was already complete when a stored plan was reused. The run state MUST record that section when it is created, and only for such a plan. A state that predates the record MUST be read from the waves it holds.

#### Scenario: Happy path — a re-run from a reused plan waits as the first run does

- **GIVEN** a test-first plan whose failing-test wave and first implementation wave are complete, reused by a later run and narrowed to the two implementation waves and the trailing test wave that remain
- **WHEN** each remaining implementation wave finishes
- **THEN** the first advances with no `verify` step and records the owed-implementation reason
- **AND** the second gets an ordinary check

#### Scenario: Failure — an ordinary plan is not read as test-first

- **GIVEN** a plan that names no failing-test section
- **WHEN** its run state is created and its waves finish
- **THEN** the state carries no failing-test section
- **AND** no skip carries the owed-implementation reason

#### Scenario: Edge case — a state that predates the recorded section reads its waves

- **GIVEN** a run state that records no failing-test section and still holds its finished failing-test wave
- **WHEN** an implementation wave finishes with another implementation wave after it
- **THEN** it advances with no `verify` step and records the owed-implementation reason

## MODIFIED Requirements

### Requirement: Inter-wave verification is capped and skippable

Finishing a wave MUST NOT unconditionally enter the verify phase. The run MUST skip the checkpoint when every claimed path in the completed wave is documentation (`*.md`/`*.mdx`/`*.txt`/`*.rst`/`*.adoc`, or under `doc/`/`docs/`/`openspec/`/`.claude/`), when the completed wave is a failing-test wave that leads a test-first plan, when the check is waiting for implementation that wave is owed, or when the run has already consumed `LIMITS.interWaveVerifications` checkpoints. A skipped checkpoint MUST be recorded with a non-empty reason and MUST advance to the next wave. A wave whose tasks omit `paths`, or that claims any non-docs path, MUST still be eligible for a checkpoint if the cap has not been spent, unless it is that failing-test wave or its check is waiting for owed implementation. Verification MUST still never run after the final wave.

#### Scenario: Docs-only wave skips verify

- **WHEN** wave 1's tasks only claim `docs/foo.md` and `README.md`, and wave 2 follows
- **THEN** `record-batch` of wave 1's last batch advances to wave 2's first batch without a `verify` step, and the skip reason is recorded

#### Scenario: Cap stops further checkpoints

- **WHEN** a run has already completed `LIMITS.interWaveVerifications` inter-wave checks and another impl wave finishes with a following wave
- **THEN** the next step is the following wave's batch, not `verify`, and the skip is recorded

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-run inter-wave verification cap as a positive integer

#### Scenario: Failing-test wave skips its own check

- **GIVEN** a test-first plan whose leading wave writes the failing tests
- **WHEN** that wave's last batch is recorded
- **THEN** the next step is the following wave's first batch, not `verify`
- **AND** the skip is recorded under the failing-test reason and spends no checkpoint
