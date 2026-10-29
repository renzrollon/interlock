# Spec Delta

## MODIFIED Requirements

### Requirement: Dimension selection SHALL be a recorded rule, and an agent-added dimension SHALL be recorded

The CLI MUST select the strict depth's always-on dimensions, as the limits surface publishes them (`language`, `architecture`, `qa`, `technical-lead` and `regression`), for every review, MUST add `devops` when the observed changed paths include deploy, continuous-integration, configuration or infrastructure files, and MUST add `security` when they include authentication, input-handling or data-exposure files, by the same path classification the run uses for risk. It MUST add `domain` when an observed changed path is linked by a reliable edge of the run's graph to a living spec, or when the change's own delta specs modify a capability that has a living spec, or when a changed path the graph does not hold is cited by a living spec, by the rule the domain-review capability states, and MUST NOT add it otherwise. When no graph is available the CLI MUST record `domain` as skipped with the reason unless the change's own capabilities select it; when a graph is available and selects nothing, it MUST record why `domain` was not selected. The step MUST record the selected dimensions, a reason for each optional one, each skipped dimension with its reason, and the reason `domain` was not selected when it was not. Findings written under a dimension the CLI did not select MUST be accepted and the addition recorded on the manifest; the review briefing MUST NOT invite the reviewer to add `domain` itself.

#### Scenario: Happy path — a deploy change adds devops

- **GIVEN** a run whose observed changed paths include a CI workflow file
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists the published always-on dimensions and `devops`, with a reason naming the workflow file

#### Scenario: Happy path — a change that touches a specified file adds domain

- **GIVEN** a run whose graph links `lib/risk.mjs` to a living spec by a reliable edge, and whose observed changed paths include `lib/risk.mjs`
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` includes `domain`, after the always-on dimensions, with a reason naming the capability and the file

#### Scenario: Failure — an unrelated path does not add security

- **GIVEN** a run whose only changed path is a documentation file no living spec is linked to, and whose change has no delta spec for an existing capability
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists exactly the published always-on dimensions
- **AND** no dimension is recorded as skipped, because a graph was available and it linked nothing, and the step records why `domain` was not selected

#### Scenario: Edge case — the reviewer adds a dimension

- **GIVEN** a review whose findings file contains a `security` dimension the CLI did not select
- **WHEN** `run reviewed` adjudicates
- **THEN** the security findings are adjudicated like any other
- **AND** the manifest records that `security` was agent-added

#### Scenario: Edge case — no graph is a recorded skip, not a silent absence

- **GIVEN** a run with no graph available and a change whose delta specs only add a new capability
- **WHEN** the `review` step is emitted
- **THEN** `dimensions` lists exactly the published always-on dimensions
- **AND** the step records `domain` as skipped with the reason that no graph exists
