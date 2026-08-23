# ship/spawn-prefix Specification

## Purpose

Stops every `/interlock:ship` worker from inheriting Claude Code's full tool catalog and Skill listing. A spawn names a plugin agent and passes a tools allowlist so the prefix is the task, not the host.

## Requirements

### Requirement: Every workflow spawn names a plugin agent and a tools allowlist

Every `agent()` call in `workflows/ship.js` MUST pass both `type` and `tools`. `type` MUST be `interlock:ping` or `interlock:worker`. `tools` MUST be a non-empty allowlist that MUST NOT contain `Skill`, `Agent`, or any `mcp__*` name. Omitting `tools` is forbidden: that is how the parent catalog is inherited. The plugin MUST ship `agents/ping.md` and `agents/worker.md` whose frontmatter `tools` match those allowlists and whose `disallowedTools` includes `Skill`, `Agent`, and `mcp__*`.

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

`cheap()` pings (record-batch, next-retry, fused verify, replan) MUST use the ping allowlist. They MAY write JSON files and run `interlock` via Bash. They MUST NOT be given `Edit` or `Grep`. Judgement steps (plan-waves, implementers, verify, review, commit, handoff) MUST use the worker allowlist.

#### Scenario: Happy path — cheap() cannot override to the full catalog

- **GIVEN** haiku is reachable and `pingExtra.model` is set to `haiku`
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
