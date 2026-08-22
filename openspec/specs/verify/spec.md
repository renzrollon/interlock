# verify Specification

## Purpose

Keeps verification policy in the CLI while stopping verify agents from pasting oversized suite logs into context — they get a disk locator and a bounded preview instead.

## Requirements

### Requirement: Oversized verify output is spilled

When a planned verification step's combined stdout and stderr exceeds the spill threshold, the system MUST write the full bytes to a stable on-disk locator under the ship work directory and MUST NOT require the verify agent to return that full text in its structured result. The result for that step MUST include the locator, byte length, a truncated preview, and a content hash. Output at or below the threshold MAY be returned inline and MUST still be persisted when a run id is active so the trajectory can point at it.

#### Scenario: Large unit stdout becomes a locator

- **WHEN** a unit step emits more than the spill threshold of runner output
- **THEN** the verify result for that kind carries a repo-relative locator under `.claude/ship/`, a preview shorter than the full output, `truncated=true`, and a hash of the full bytes, and the full output is readable at the locator

#### Scenario: Small typecheck output stays inline

- **WHEN** a typecheck step emits fewer bytes than the spill threshold
- **THEN** the verify result MAY include the output inline, and a persisted copy still exists when the run has a run id

### Requirement: Agents receive preview plus locator, not the suite log

A verify agent (inter-wave or final) MUST report `exitCode`, counts, and failure signatures or clusters as today. It MUST NOT paste spilled output into `cliStdout`, `detail`, `failures`, or any other result field. `failures` MUST remain short lines or objects suitable for clustering. The preview MUST be a head-and-tail slice with an explicit omission marker so the model can see the start of the failure and the summary line without loading the middle.

#### Scenario: Judge still works from counts and clusters

- **WHEN** `interlock verify judge` is given a plan plus results whose unit step has spilled stdout and a `failures` array of short lines
- **THEN** the verdict is identical to judging the same counts and failures without the full log present in the result object

#### Scenario: Pasting spilled bytes into the result is rejected

- **WHEN** a verify result field that is not the preview contains more characters than the preview budget
- **THEN** the CLI rejects that result as oversized rather than passing it through as a judgement input

### Requirement: Spill obeys existing token-economy rules

Spill MUST reuse Interlock's locate-before-read discipline: the locator is the way to find the log; a later Read of the file MUST use offset/limit rather than loading the whole suite. Spill MUST NOT introduce a Cordis-style plugin host, a generic tool-result bus, or a second orchestrator. Threshold and preview budgets MUST live in `interlock limits` so they cannot be restated in `workflows/ship.js` prose.

#### Scenario: Limits print spill caps

- **WHEN** an operator runs `interlock limits`
- **THEN** the output names the spill threshold and the preview character budget as integers, alongside the existing ship caps

#### Scenario: Shared tool-economy doc describes verify spill

- **WHEN** an agent follows `shared/TOOL-ECONOMY.md` during verification
- **THEN** that document tells it to treat spilled suite output as a locator plus preview and not to Read the spilled file in full

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