## MODIFIED Requirements

### Requirement: A reusable plan SHALL carry a fingerprint of the inputs it was derived from

A persisted execution plan MUST be accompanied by a fingerprint computed from the change's planning inputs:

- the content of `proposal.md`, `design.md`, `tasks.md`, and every delta spec;
- the change name and the parallelism cap;
- the per-tier lane-cap table, the cohesion tier ceiling and the solo envelope;
- the mode override in force when the plan was built, recorded as `auto` when no override was passed.

The plan MUST be reused only when a fingerprint recomputed from the current inputs equals the stored one.

The fingerprint MUST also record the plan format version, so a plan written in one plan shape is not reused by a reader that expects another. A plan written before cohesion lanes and mode existed, or before chain lanes existed, MUST be rebuilt rather than reused. A narrowed plan MUST keep its mode and its promotion report.

#### Scenario: Happy path — unchanged inputs reuse the plan

- **GIVEN** a plan and fingerprint exist for change `add-widget` and none of its artifacts, caps or mode override have changed since
- **WHEN** `ship` starts for `add-widget`
- **THEN** the recomputed fingerprint matches the stored one and the classifier step is not run
- **AND** the run proceeds directly to executing the stored plan

#### Scenario: Failure — an edited artifact invalidates the plan

- **GIVEN** a plan and fingerprint exist for `add-widget`
- **WHEN** `design.md` is edited and `ship` starts for `add-widget`
- **THEN** the recomputed fingerprint does not match and the classifier step runs
- **AND** a fresh plan and fingerprint replace the stored pair

#### Scenario: Failure — a mode override invalidates a plan built without one

- **GIVEN** a plan and fingerprint exist for `add-widget` built with no mode override
- **WHEN** `ship` starts for `add-widget` with the solo override
- **THEN** the recomputed fingerprint does not match and the classifier step runs
- **AND** the fresh plan is solo and the stored pair is replaced

#### Scenario: Edge case — a plan whose format version differs

- **GIVEN** a stored plan whose recorded format version is not the version this run understands
- **WHEN** `ship` starts
- **THEN** the plan is not reused, regardless of whether the input fingerprint matches
- **AND** the classifier step runs

#### Scenario: Edge case — a plan built before chain lanes existed is rebuilt

- **GIVEN** a stored plan and fingerprint written in the plan format that preceded chain lanes, with artifacts, caps and mode override otherwise unchanged
- **WHEN** `ship` starts
- **THEN** the plan is not reused, and the reuse decision names the format version change as its reason rather than an artifact edit
- **AND** the classifier step runs and the fresh plan carries chain lanes wherever serial single-lane batches occur

#### Scenario: Edge case — a narrowed solo plan stays solo

- **GIVEN** a stored solo plan whose first three tasks are already ticked
- **WHEN** the plan is reused and narrowed
- **THEN** the narrowed plan still holds one lane, its mode is still solo, and its promotion report still lists the remaining promoted tasks
