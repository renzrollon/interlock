## MODIFIED Requirements

### Requirement: Every workflow spawn names a plugin agent and a tools allowlist

Every `agent()` call in `workflows/ship.js` MUST pass both `type` and `tools`. `type` MUST be `interlock:ping` or `interlock:worker`. `tools` MUST be a non-empty allowlist that MUST NOT contain `Skill`, `Agent`, or any `mcp__*` name. Omitting `tools` is forbidden: that is how the parent catalog is inherited. The plugin MUST ship `agents/ping.md` and `agents/worker.md` whose frontmatter `tools` match those allowlists and whose `disallowedTools` includes `Skill`, `Agent`, and `mcp__*`.

This requirement states Claude Code's mechanism. The obligation it encodes — a spawn's prefix is the task, not the host's full catalog — is mandatory on every host; the mechanism that discharges it is the host's own, and is specified per host below.

#### Scenario: Happy path — ping and worker are distinct slim prefixes

- **GIVEN** `workflows/ship.js` as shipped
- **WHEN** an operator inspects every `agent()` call
- **THEN** `cheap()` / `pingExtra` sets `type` to `interlock:ping` and `tools` to Bash, Read, Write
- **AND** `step()` defaults and the implementer `pipeline()` set `type` to `interlock:worker` and `tools` to Read, Write, Edit, Grep, Glob, Bash
- **AND** neither allowlist contains Skill or Agent

#### Scenario: Failure — a spawn without tools inherits the parent catalog

- **GIVEN** an `agent()` call that passes `label`, `model`, and `schema` but omits `tools`
- **WHEN** the workflow runtime spawns that agent
- **THEN** that call is a spec violation
- **AND** `npm test` fails on the ship.js structural assertion that every `agent()` includes `type` and `tools`

#### Scenario: Edge case — plugin agent files stay the source of the allowlist

- **GIVEN** `agents/ping.md` and `agents/worker.md` in the plugin root
- **WHEN** `npm test` runs
- **THEN** each file's frontmatter `tools` matches the corresponding ship.js allowlist
- **AND** `disallowedTools` on both files includes `mcp__*`
- **AND** neither file lists Skill or Agent under `tools`

### Requirement: Mechanical pings do not receive Edit or Grep

`cheap()` pings (record-batch, next-retry, fused verify, replan) MUST use the ping allowlist. They MAY write JSON files and run `interlock` via Bash. They MUST NOT be given `Edit` or `Grep`. Judgement steps (plan-waves, implementers, verify, review, commit, handoff) MUST use the worker allowlist. A ping MUST be dispatched on the cheapest model class the host resolves, never on the deepest.

#### Scenario: Happy path — cheap() cannot override to the full catalog

- **GIVEN** the cheapest model class is reachable and `pingExtra.model` is set to that class
- **WHEN** `cheap()` spawns a record-batch ping
- **THEN** the spawn still carries `type: interlock:ping` and the ping tools
- **AND** mutating `pingExtra.model` does not drop `type` or `tools`

#### Scenario: Failure — a ping that lists Edit is rejected

- **GIVEN** `PING_TOOLS` in `workflows/ship.js`
- **WHEN** the list includes `Edit`
- **THEN** `npm test` fails

#### Scenario: Edge case — validate uses the worker default and still excludes Skill

- **GIVEN** the validate step uses `step()` rather than `cheap()`
- **WHEN** it spawns
- **THEN** it receives the worker allowlist (Read, Write, Edit, Grep, Glob, Bash)
- **AND** that allowlist still excludes Skill, Agent, and MCP

## ADDED Requirements

### Requirement: Every host SHALL constrain a spawn's tool surface by its own mechanism

A spawn on any host SHALL run with a tool surface narrower than the host's full default, SHALL be unable to invoke a skill, and SHALL be unable to spawn a further agent. Where a host has no plugin-agent concept, it SHALL discharge this through the mechanisms it does have — its sandbox mode, its writable-path set, and refusing to load the operator's ambient configuration — and the mechanism in force SHALL be recorded on the run so it is auditable after the fact. Recording the requested `type` and `tools` without constraining anything SHALL NOT satisfy this requirement.

#### Scenario: Happy path — the Codex host records the constraint actually in force

- **GIVEN** a Codex-hosted spawn for a mechanical ping
- **WHEN** the spawn is made and the run's record inspected
- **THEN** the record names the sandbox mode and the writable paths that applied
- **AND** it does not report a Claude Code plugin agent id as the constraint

#### Scenario: Failure — a host that only records the fields is non-compliant

- **GIVEN** a host implementation that stores `type` and `tools` and passes neither to the agent nor constrains it otherwise
- **WHEN** that host is reviewed or tested against this requirement
- **THEN** it is non-compliant
- **AND** the presence of the recorded fields is not accepted as evidence of a slim prefix

#### Scenario: Edge case — a ping and a worker differ on every host

- **GIVEN** a mechanical ping and an implementer lane spawned on the same host
- **WHEN** the two constraints in force are compared
- **THEN** the ping's surface is no wider than the worker's
- **AND** on a host that cannot express two distinct surfaces, both are constrained to the narrower one rather than both to the wider
