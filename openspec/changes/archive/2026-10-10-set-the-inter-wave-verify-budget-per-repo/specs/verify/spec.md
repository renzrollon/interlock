## MODIFIED Requirements

### Requirement: Inter-wave plan is scoped by changed paths and budget

`interlock verify plan` MUST accept `--changed <files...>`, `--context <inter-wave|final>`, and `--budget-ms <n>` (budget already exists; it MUST remain). When `--context inter-wave`, the plan MUST NOT include e2e or coverage steps unless the caller also passed `--e2e` / did not pass `--no-coverage` *and* those flags are explicitly documented as overriding — default inter-wave is typecheck, unit, lint only. When `--changed` names at least one path and every path is documentation, the plan MUST emit no runnable steps and MUST skip every kind with a machine-readable docs-only reason. When elapsed time is at or past the budget, only typecheck remains, as today. When `--budget-ms` is absent, the budget MUST be the one the test profile resolves to (see "The inter-wave verify budget MAY be set per repository in the test profile"), which is the published default when the profile does not set one.

#### Scenario: Docs-only --changed skips the inter-wave plan

- **WHEN** `interlock verify plan --no-profile --context inter-wave --changed docs/foo.md README.md --json`
- **THEN** `steps` is empty and every skip carries the docs-only reason

#### Scenario: Inter-wave default omits e2e and coverage

- **WHEN** `interlock verify plan --profile <file> --context inter-wave --typecheck-command "tsc --noEmit" --json` with no `--e2e`
- **THEN** the plan has no e2e step and no coverage step

#### Scenario: Budget still collapses to typecheck

- **WHEN** `interlock verify plan` is given `--elapsed-ms` at or above `--budget-ms` (or the resolved default budget) and a typecheck command
- **THEN** the only remaining step is typecheck, and unit/lint skips use the existing budget-exceeded reason

#### Scenario: --budget-ms wins over the profile

- **GIVEN** a profile whose `inter_wave_verify_budget_ms` is 300000
- **WHEN** `interlock verify plan --profile <file> --budget-ms 1000 --elapsed-ms 1000 --json`
- **THEN** `budgetMs` is 1000 and unit is skipped with the budget-exceeded reason

## ADDED Requirements

### Requirement: The inter-wave verify budget MAY be set per repository in the test profile

The test profile MAY carry a top-level integer `inter_wave_verify_budget_ms`. When present, it SHALL replace the published default inter-wave verify budget for plans made against that profile. When absent, the budget SHALL be the published default, whatever other timing fields the profile carries, `unit.timeout_ms` included. A value above the published ceiling SHALL be clamped to it. The ceiling SHALL be stated once in the limits definition and printed by `interlock limits`.

#### Scenario: Happy path — a slow suite's repository sets its own budget

- **GIVEN** a profile whose `inter_wave_verify_budget_ms` is 360000 and which is under the ceiling
- **WHEN** an inter-wave plan is made with 120000 ms already spent
- **THEN** the plan's budget is 360000 ms, the unit step is planned, and the budget source is `profile`

#### Scenario: A profile without the field keeps the default

- **GIVEN** a profile with `unit.timeout_ms` of 120000 and no `inter_wave_verify_budget_ms`
- **WHEN** an inter-wave plan is made
- **THEN** the plan's budget equals the published default and the budget source is `limits`

#### Scenario: A value above the ceiling is clamped and said

- **GIVEN** a profile whose `inter_wave_verify_budget_ms` exceeds the published ceiling
- **WHEN** the budget is resolved
- **THEN** the budget equals the ceiling, the source is `profile-clamped`, and the requested value is reported beside it

### Requirement: A malformed per-repository budget SHALL be a profile error

A present `inter_wave_verify_budget_ms` that is not a positive integer SHALL be rejected by profile validation with a message naming the field. It SHALL NOT be read as the published default.

#### Scenario: Failure — a malformed value is a profile error

- **GIVEN** a profile whose `inter_wave_verify_budget_ms` is `"5m"`, `0`, or `-1`
- **WHEN** the profile is validated
- **THEN** validation fails with a message naming `inter_wave_verify_budget_ms`
- **AND** no plan is made against the published default in its place

### Requirement: The profile skill SHALL NOT write the per-repository budget

The skill that maintains the test profile SHALL name `inter_wave_verify_budget_ms` as a person's setting and SHALL NOT write, raise or remove it.

#### Scenario: The profile skill never writes the field

- **GIVEN** the shipped profile-maintenance skill
- **WHEN** the skill suite reads it
- **THEN** it names `inter_wave_verify_budget_ms` as a field the skill must not write or change

### Requirement: A ship run SHALL fix its inter-wave verify budget at run start

`run start` SHALL resolve the inter-wave verify budget from the test profile it located and record the budget and its source on the run manifest. Every inter-wave checkpoint of that run SHALL compare against the recorded budget, not against a fresh read of the profile. A manifest that carries no recorded budget SHALL use the published default. When the source is not the published default, `run start` SHALL raise a banner naming the budget and its source, and the run's close SHALL repeat it.

#### Scenario: Happy path — the profile budget is announced and recorded

- **GIVEN** a repository whose profile sets `inter_wave_verify_budget_ms` to 300000
- **WHEN** `interlock run start` runs
- **THEN** the manifest records a budget of 300000 with source `profile`
- **AND** a `VERIFY BUDGET FROM PROFILE` banner is raised

#### Scenario: Failure — a mid-run profile edit does not move the budget

- **GIVEN** a run started with a profile budget of 300000
- **WHEN** the profile's `inter_wave_verify_budget_ms` is changed to 1800000 before the next checkpoint
- **THEN** that checkpoint's plan still compares against 300000

#### Scenario: Edge case — a manifest from before the field existed

- **GIVEN** a run manifest with no recorded budget
- **WHEN** an inter-wave checkpoint is planned
- **THEN** it compares against the published default, as before this change
