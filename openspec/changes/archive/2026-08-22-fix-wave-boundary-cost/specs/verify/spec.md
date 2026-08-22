## Purpose

Makes inter-wave verification planning structural: the CLI emits the command list from `--changed`, `--context`, and `--budget-ms` so a model cannot decide to run a three-minute full suite between two one-file batches.

## ADDED Requirements

### Requirement: Inter-wave plan is scoped by changed paths and budget

`interlock verify plan` MUST accept `--changed <files...>`, `--context <inter-wave|final>`, and `--budget-ms <n>` (budget already exists; it MUST remain). When `--context inter-wave`, the plan MUST NOT include e2e or coverage steps unless the caller also passed `--e2e` / did not pass `--no-coverage` *and* those flags are explicitly documented as overriding — default inter-wave is typecheck, unit, lint only. When `--changed` names at least one path and every path is documentation, the plan MUST emit no runnable steps and MUST skip every kind with a machine-readable docs-only reason. When elapsed time is at or past the budget, only typecheck remains, as today.

#### Scenario: Docs-only --changed skips the inter-wave plan

- **WHEN** `interlock verify plan --no-profile --context inter-wave --changed docs/foo.md README.md --json`
- **THEN** `steps` is empty and every skip carries the docs-only reason

#### Scenario: Inter-wave default omits e2e and coverage

- **WHEN** `interlock verify plan --profile <file> --context inter-wave --typecheck-command "tsc --noEmit" --json` with no `--e2e`
- **THEN** the plan has no e2e step and no coverage step

#### Scenario: Budget still collapses to typecheck

- **WHEN** `interlock verify plan` is given `--elapsed-ms` at or above `--budget-ms` (or the default budget) and a typecheck command
- **THEN** the only remaining step is typecheck, and unit/lint skips use the existing budget-exceeded reason

### Requirement: Ship inter-wave pings consume the structural plan

The ship wave loop MUST tell the verify (or fused record+verify) ping to call `interlock verify plan --context inter-wave --changed <paths from the completed wave> --budget-ms` (or the published default) and to run only the emitted steps. It MUST NOT instruct the agent to invent extra suites or to ignore a docs-only skip.

#### Scenario: Fused ping still uses verify plan

- **WHEN** a `record-batch` ping's `--write-state` stdout is `action: verify`
- **THEN** that same agent runs `interlock verify plan` with `--context inter-wave` before running checks, rather than spawning a new `inter-wave-verify-*` agent as a prerequisite
