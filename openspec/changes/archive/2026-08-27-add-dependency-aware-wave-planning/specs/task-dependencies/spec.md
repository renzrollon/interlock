## Purpose

Gives a classified task a precise, cross-file ordering signal — the earlier tasks whose output it needs — so the planner can serialize a real dependency without conscripting a whole numbered section as a barrier. The signal is optional, deterministic, and rejected fail-closed when malformed.

## ADDED Requirements

### Requirement: A classified task SHALL accept an optional dependency edge list

A classified task MAY carry a `dependsOn` field. When present it MUST be an array of strings, each naming the `id` of another task in the same plan. `dependsOn` is a sibling of the existing optional `paths` field: it declares ordering, not edited files. A task without `dependsOn`, or with an empty array, declares no dependency and MUST be treated exactly as a task that predates this field.

#### Scenario: Happy path — an edge is accepted and recorded

- **GIVEN** a plan whose task `2.2` carries `dependsOn: ["2.1"]` and task `2.1` exists
- **WHEN** `interlock waves` validates and plans the tasks
- **THEN** the plan is accepted and the edge from `2.2` to `2.1` constrains ordering

#### Scenario: Failure — a non-array or non-string dependsOn is rejected

- **GIVEN** a task whose `dependsOn` is a string, a number, or an array containing a non-string
- **WHEN** the planner validates the plan
- **THEN** validation fails naming the offending task id, and no plan is produced

#### Scenario: Edge case — an empty dependsOn is the same as none

- **GIVEN** two otherwise identical plans, one with `dependsOn: []` on every task and one with the field absent
- **WHEN** each is planned
- **THEN** both produce the same waves, batches, and lanes

### Requirement: Malformed dependency edges SHALL be rejected fail-closed

The planner MUST reject a plan whose dependency edges reference a task id that does not exist in the plan, or whose edges contain a cycle (a task that transitively depends on itself). Rejection MUST name the cause — the dangling id, or the ids on the cycle — and MUST NOT be silently repaired by dropping a reference, dropping an edge, or breaking a cycle. This mirrors how the planner already rejects an absolute or out-of-repo `paths` entry rather than normalizing it into scope.

#### Scenario: Failure — a dangling reference halts the plan

- **GIVEN** task `2.2` carries `dependsOn: ["9.9"]` and no task `9.9` exists in the plan
- **WHEN** the planner validates the plan
- **THEN** validation fails naming the unresolved id `9.9`
- **AND** no plan is produced and no edge is silently dropped

#### Scenario: Failure — a cycle halts the plan

- **GIVEN** task `1.1` depends on `1.2` and task `1.2` depends on `1.1`
- **WHEN** the planner validates the plan
- **THEN** validation fails naming the ids on the cycle
- **AND** the planner does not break the cycle to proceed

#### Scenario: Edge case — a self-edge is a cycle

- **GIVEN** task `1.1` carries `dependsOn: ["1.1"]`
- **WHEN** the planner validates the plan
- **THEN** validation fails, treating a task depending on itself as a cycle

### Requirement: An absent edge set SHALL leave planning byte-identical

When no task in a plan carries a non-empty `dependsOn`, the planner MUST produce the identical waves, batches, and lanes it produced before this capability existed. The dependency signal MUST be purely additive: it can only introduce ordering that the section-and-path model did not already impose, never remove ordering it did.

#### Scenario: Happy path — an edge-free plan is unchanged

- **GIVEN** a classified task list with no `dependsOn` anywhere
- **WHEN** the planner builds the plan
- **THEN** the wave count, batch boundaries, and lane membership match the pre-dependency planner exactly for the same input

#### Scenario: Edge case — planning is reproducible across repeated runs

- **GIVEN** the same classified task list, with dependency edges, planned twice
- **WHEN** the two plans are compared
- **THEN** they are byte-identical, because wave depth is a pure function of the input with a deterministic task-id tie-break
