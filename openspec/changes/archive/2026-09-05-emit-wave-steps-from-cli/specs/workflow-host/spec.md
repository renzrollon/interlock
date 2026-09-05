## MODIFIED Requirements

### Requirement: Hosts share a spawn and CLI boundary

A workflow host MUST provide: (1) spawn of a single labeled agent given prompt, model, and result schema; (2) parallel spawn up to the planner's batch width; (3) execution of the `interlock` CLI with the repo as cwd. A host MUST obtain every step of a run — including every agent briefing, its model, effort, agent type, tools and result schema, and the argv to call next — from `interlock run`, and MUST branch on that CLI's exit codes and step records alone. The host MUST NOT reimplement wave ordering, verify judgement, limits, the review gate, briefing assembly or loop control in host-specific code.

#### Scenario: Fake host drives a batch through the CLI

- **WHEN** a test host that cannot talk to a model is asked to record a two-task batch against a real `interlock wave-state` binary
- **THEN** the next step still comes from the CLI JSON, and the host has not computed halt reasons itself

#### Scenario: Host-specific verify judgement is forbidden

- **WHEN** a host implementation is reviewed or tested for policy duplication
- **THEN** red-unit / typecheck halt behaviour is only observed via `interlock verify judge` exit status, not via a second copy of those rules in the host

#### Scenario: Happy path — a fake host interprets a whole lean run from step records

- **GIVEN** a test host whose spawn returns canned results and whose CLI is the real binary
- **WHEN** it starts at `interlock run start` and follows each step's `then.argv` until the continuation is null
- **THEN** the run reaches `close` with a summary, and the host's own code contains no reference to any action name, flag or verdict

#### Scenario: Failure — a host that hardcodes the next command is caught

- **GIVEN** a host that calls `run record-batch` after a batch without reading the step's `then.argv`
- **WHEN** a step whose continuation is `run judge` is emitted
- **THEN** the host's call is rejected by the CLI as out of sequence with a reason naming the expected continuation
