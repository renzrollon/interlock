# plan-reuse Specification

## Purpose

Stops the most expensive fixed step of a run — the classifier reading every change artifact in full — from being re-paid on every `ship` invocation for a change whose plan already exists. A plan is reusable only when it provably describes the same work, and every way of failing to prove that ends in re-planning rather than in trusting a plan of unknown provenance.

## Requirements

### Requirement: A reusable plan SHALL carry a fingerprint of the inputs it was derived from

A persisted execution plan MUST be accompanied by a fingerprint computed from the change's planning inputs: the content of `proposal.md`, `design.md`, `tasks.md`, and every delta spec, together with the change name, the parallelism cap, and the lane-length cap in force when the plan was built. The plan MUST be reused only when a fingerprint recomputed from the current inputs equals the stored one. The fingerprint MUST also record the plan format version, so a plan written by a different plan shape is not reused against a reader that expects another.

#### Scenario: Happy path — unchanged inputs reuse the plan

- **GIVEN** a plan and fingerprint exist for change `add-widget` and none of its artifacts have changed since
- **WHEN** `ship` starts for `add-widget`
- **THEN** the recomputed fingerprint matches the stored one and the classifier step is not run
- **AND** the run proceeds directly to executing the stored plan

#### Scenario: Failure — an edited artifact invalidates the plan

- **GIVEN** a plan and fingerprint exist for `add-widget`
- **WHEN** `design.md` is edited and `ship` starts for `add-widget`
- **THEN** the recomputed fingerprint does not match and the classifier step runs
- **AND** a fresh plan and fingerprint replace the stored pair

#### Scenario: Edge case — a plan whose format version differs

- **GIVEN** a stored plan whose recorded format version is not the version this run understands
- **WHEN** `ship` starts
- **THEN** the plan is not reused, regardless of whether the input fingerprint matches
- **AND** the classifier step runs

### Requirement: Completion state SHALL NOT invalidate a plan, but task identity and text SHALL

Marking tasks complete is the normal progress of a run and MUST NOT invalidate the plan covering the tasks that remain. The fingerprint over `tasks.md` MUST therefore be computed with checkbox markers normalized, so that a checked and an unchecked box of otherwise identical text produce the same value. Adding a task, removing a task, reordering tasks, or editing a task's text MUST invalidate the plan, because each changes what the plan is a plan for.

#### Scenario: Happy path — ticking tasks between runs still matches

- **GIVEN** a plan built when all 10 tasks were unchecked
- **WHEN** 4 tasks are marked complete and `ship` is started again with no other edit
- **THEN** the fingerprint still matches and the plan is reused

#### Scenario: Failure — a new checkbox invalidates the plan

- **GIVEN** a plan built for 10 tasks
- **WHEN** an eleventh task is added to `tasks.md` and `ship` starts
- **THEN** the fingerprint does not match and the classifier runs
- **AND** the new task is covered by the resulting plan

#### Scenario: Edge case — a task keeps its id but changes its text

- **GIVEN** a plan built for a task `1.2` described as "add the flag"
- **WHEN** `1.2` is reworded to "add the flag and migrate callers" and `ship` starts
- **THEN** the fingerprint does not match and the classifier runs

### Requirement: A reused plan SHALL be narrowed to work that is still incomplete

Reuse MUST NOT re-execute completed work. Before a reused plan is turned into run state, every task already marked complete MUST be removed from it. Removal MUST preserve the relative order of the tasks that remain, and a lane or wave left holding no tasks MUST be dropped rather than dispatched empty. When every task in a reused plan is already complete, the run MUST treat the change as having no remaining work rather than dispatching an empty run.

#### Scenario: Happy path — completed tasks are dropped and order is preserved

- **GIVEN** a reusable plan whose lane holds tasks `1.1`, `1.3` and `1.4`, and `1.1` is already complete
- **WHEN** run state is created from that plan
- **THEN** the lane holds `1.3` then `1.4`, in that order
- **AND** `1.1` is not dispatched again

#### Scenario: Failure — an empty lane is not dispatched

- **GIVEN** a reusable plan with a lane whose every task is already complete
- **WHEN** run state is created from that plan
- **THEN** that lane is absent from the run state
- **AND** no agent is dispatched for it

#### Scenario: Edge case — every task in the plan is already complete

- **GIVEN** a reusable plan whose tasks are all marked complete
- **WHEN** `ship` starts
- **THEN** the run reports that there is no remaining work rather than creating a run with zero batches

### Requirement: Any failure to establish reuse SHALL fall back to planning, and the run SHALL say which path it took

Reuse is an optimization, never a correctness dependency. A missing plan, a missing or unreadable fingerprint, an unparseable plan, a mismatched fingerprint, or any error raised while checking MUST result in the classifier running, which is the behaviour that exists today. No condition may cause a plan to be reused when a match was not affirmatively established. The run summary MUST state whether the plan was reused or rebuilt and, when it was rebuilt, the reason — absence of a prior plan is itself a reason and MUST be reported rather than passed over in silence.

#### Scenario: Happy path — a reused plan is reported as reused

- **GIVEN** a stored plan whose fingerprint matches
- **WHEN** the run completes
- **THEN** the summary states that the execution plan was reused and names the change it was built for

#### Scenario: Failure — an unreadable plan re-plans rather than halting

- **GIVEN** a stored plan file that cannot be parsed
- **WHEN** `ship` starts
- **THEN** the classifier runs and the run proceeds normally
- **AND** the summary states that the plan was rebuilt because the stored plan could not be read

#### Scenario: Edge case — a first run with no prior plan

- **GIVEN** a change that has never been shipped, so no plan exists
- **WHEN** `ship` starts
- **THEN** the classifier runs
- **AND** the summary states that no prior plan was available, rather than omitting the plan-reuse line entirely
