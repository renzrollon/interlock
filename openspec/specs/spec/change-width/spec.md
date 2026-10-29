# spec/change-width Specification

## Purpose

Measures how wide a change is from its own artifacts, against caps the CLI publishes, so the decision to split a change into an epic of briefs reads a number the CLI computed rather than a judgment made in prose.

## Requirements

### Requirement: The change inspection SHALL measure a change's width from its artifacts and report it on the validate line

`interlock validate <change> --json` SHALL carry `width`: `capabilities` (`spec.md` files under the change's `specs/`, at any depth), `tasks` (the checkbox count `ready` is judged by), `caps` (the two published caps by name), `wide` (either count exceeds its cap) and `over` (the caps exceeded). When `wide`, the text form SHALL add a `CHANGE WIDE:` line naming each exceeded count, its cap and the capabilities. `ready` and the exit code SHALL NOT depend on width.

#### Scenario: Happy path — a change within both caps

- **GIVEN** a change with two delta spec files and eight checkbox tasks, both within the published caps
- **WHEN** `interlock validate <change> --json` runs
- **THEN** `width` is `{ capabilities: 2, tasks: 8, caps: { maxChangeCapabilities, maxChangeTasks }, wide: false, over: [] }` with the caps' published values, and the text form prints no `CHANGE WIDE:` line

#### Scenario: Failure — a change over the capability cap is wide and still ready

- **GIVEN** a change whose three artifacts are present and whose twelve delta spec files exceed `maxChangeCapabilities`
- **WHEN** `interlock validate <change>` runs, with and without `--json`
- **THEN** `ready` is `true` and the command exits `0`
- **AND** `width.wide` is `true`, `width.over` is `["capabilities"]`, and the text form prints `CHANGE WIDE: 12 capabilities (max <cap>)` followed by the capability paths, each as its directory under `specs/`

#### Scenario: Edge case — no specs and no tasks measure zero

- **GIVEN** a change directory with a `proposal.md` and `design.md`, no `specs/` directory and no `tasks.md`
- **WHEN** `interlock validate <change> --json` runs
- **THEN** `width` is `{ capabilities: 0, tasks: 0, …, wide: false, over: [] }`, and `ready` is `false` for the reasons `problems` already names, not for width

### Requirement: The two width caps SHALL be published by the limits surface and read by the inspection alone

`maxChangeCapabilities` and `maxChangeTasks` SHALL be positive integers in the iteration-count limits, printed by `interlock limits` as `change width: max capabilities (delta specs)` and `change width: max tasks`, emitted under `limits` by `interlock limits --json`, and read by the change inspection, so the cap-authority sweep finds their reader. No skill, prompt or document SHALL restate a value.

#### Scenario: Happy path — the caps are printed and emitted

- **GIVEN** the installed CLI
- **WHEN** `interlock limits` and `interlock limits --json` run
- **THEN** the text carries both `change width:` rows and the JSON carries `limits.maxChangeCapabilities` and `limits.maxChangeTasks`, each a positive integer

#### Scenario: Failure — a cap with no reader fails the suite

- **GIVEN** an edit that removes the inspection's read of `maxChangeTasks`
- **WHEN** the limits suite runs
- **THEN** the cap-authority sweep fails naming `LIMITS.maxChangeTasks` as printed but unread

#### Scenario: Edge case — the skill names no value

- **GIVEN** the shipped spec skill
- **WHEN** the skill suite runs
- **THEN** `skills/spec/SKILL.md` carries no number beside `capabilities` or `tasks` as a width, and its width sentence reads the field from the validate line

### Requirement: The spec skill SHALL read the width from its validate line, run no gate on a wide change, and propose the split at the checkpoint

`/interlock:spec` §4 SHALL read `width.wide` from the validate output it already parses. When true, the skill SHALL print the command's `CHANGE WIDE:` line verbatim, run no `/interlock:review-artifacts`, write no autonomy line, and stop at the checkpoint with a proposed epic of briefs, each naming the delta spec capabilities it takes. When the field is absent it SHALL print `CHANGE WIDTH: not reported by this CLI` and continue to the gate.

#### Scenario: Happy path — a change within the caps gates as today

- **GIVEN** a validate output with `ready: true` and `width.wide: false`
- **WHEN** the spec skill continues
- **THEN** it runs the artifact gate once and records its autonomy line, as before this change

#### Scenario: Failure — a wide change stops before the gate

- **GIVEN** a validate output with `ready: true`, `width.wide: true` and `width.over: ["capabilities"]`
- **WHEN** the spec skill continues
- **THEN** it prints the `CHANGE WIDE:` line, runs no `/interlock:review-artifacts`, writes no `interlock autonomy` line, and its checkpoint report proposes briefs that together cover every delta spec capability
- **AND** `--continue` stops at the checkpoint, because no findings file exists

#### Scenario: Edge case — an older CLI reports no width

- **GIVEN** a validate output with `ready: true` and no `width` field
- **WHEN** the spec skill continues
- **THEN** it prints `CHANGE WIDTH: not reported by this CLI` and runs the artifact gate
