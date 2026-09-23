## MODIFIED Requirements

### Requirement: An absent edge set SHALL leave planning byte-identical

When no task in a plan carries a non-empty `dependsOn`, the planner MUST produce exactly the waves, batches and lanes that the section-and-path model alone produces for that input. That model is sections, path collisions, cohesion, the singleton fold and chain fusion. No ordering in such a plan may be attributable to dependency edges.

The dependency signal MUST be purely additive: it can only introduce ordering that the section-and-path model did not already impose, never remove ordering it did. The comparison is against the current planner run without edges, not against a planner from before later lane kinds existed.

#### Scenario: Happy path — an edge-free plan is unchanged

- **GIVEN** a classified task list with no `dependsOn` anywhere
- **WHEN** the planner builds the plan
- **THEN** the wave count, batch boundaries and lane membership equal those of the same task list with every `dependsOn` field removed
- **AND** the plan reports no dependency deferral

#### Scenario: Edge case — planning is reproducible across repeated runs

- **GIVEN** the same classified task list, with dependency edges, planned twice
- **WHEN** the two plans are compared
- **THEN** they are byte-identical, because wave depth is a pure function of the input with a deterministic task-id tie-break
