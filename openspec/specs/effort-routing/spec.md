# effort-routing Specification

## Purpose

Gives the wave planner a second, finer capability dial beside the model clamp: the reasoning effort each lane's agent runs at, derived deterministically from the lane's tier after classification, reported like every other planner decision, and derived once by the run program and forwarded by each driver unchanged, so a resumed run routes identically.

## Requirements

### Requirement: A lane's effort is the effort of its hardest task's tier

The planner SHALL derive a lane's reasoning effort from the highest tier among the lane's tasks — never from the first task — mapping tier to effort through the table published in `lib/limits.mjs`. A lane is one agent, and that agent must be capable of the hardest thing in the lane; taking a lower tier's effort is the one direction of this trade that is not survivable. The default table is: tier 1 and tier 2 → `low`; tier 3 and tier 4 → the session default (unset, inherited); tier 5 → `xhigh`.

Effort MUST be derived from tier alone, independently of the model the lane dispatches on, which follows the lane's shape and the published opus floor. A multi-task lane that runs on sonnet because its hardest tier is below that floor therefore keeps its tier's effort; a multi-task lane that runs on opus because the hardest tier clears the floor does the same.

Rationale: effort and model are two independent dials. Deriving effort from tier rather than from the model means a change to model routing never silently moves effort.

#### Scenario: Happy path — a mechanical lane routes at low effort

- **GIVEN** a lane whose tasks are all tier 1 or tier 2
- **WHEN** `interlock waves` plans it
- **THEN** the lane's emitted `effort` is `low`

#### Scenario: Failure — a mixed lane takes the hardest task's effort, not the first task's

- **GIVEN** a lane whose first task is tier 1 and whose last task is tier 5
- **WHEN** the planner derives the lane's effort
- **THEN** the emitted `effort` is `xhigh`
- **AND** it is NOT `low`, even though tier 1 was the lane's first task

#### Scenario: Edge case — a multi-task lane of low-tier tasks keeps low effort

- **GIVEN** a chain lane of three tier-2 tasks
- **WHEN** the lane is dispatched
- **THEN** it dispatches on sonnet with `effort` `low`

#### Scenario: Edge case — a lane with no usable tier falls to the inherited default and is reported

- **GIVEN** a lane whose tasks carry no integer `tier` (missing or non-numeric)
- **WHEN** the planner derives the lane's effort
- **THEN** the lane's `effort` is the session default (unset/inherited), never guessed upward to `xhigh`
- **AND** the plan records that the lane's tier could not be read

### Requirement: Effort is assigned after classification and every assignment is reported

The planner SHALL assign effort only after the classifier has produced tiers, so a task cannot escalate its own effort, and SHALL emit an effort assignment on every lane it lists — beside the existing `model` — plus a report entry naming the lane, its tier, and the effort chosen. An effort value a task tries to declare for itself SHALL be ignored in favor of the tier-derived value.

Rationale: identical to the model-clamp discipline — assigned after classification, and every decision reported so the mapping is auditable rather than invisible.

#### Scenario: Happy path — the plan carries effort and a report entry per lane

- **GIVEN** a classified task list producing three lanes across the waves
- **WHEN** `interlock waves` emits the plan
- **THEN** each listed lane carries an `effort` field beside its `model`
- **AND** the plan's report includes one effort entry per lane naming its tier and chosen effort

#### Scenario: Failure — a task-declared effort does not override the tier-derived effort

- **GIVEN** a tier-1 task that also carries a self-declared `effort` of `xhigh`
- **WHEN** the planner derives its lane's effort
- **THEN** the lane's effort is `low` (from tier 1)
- **AND** the self-declared `xhigh` is not honored

#### Scenario: Edge case — a verification-only or docs-only wave still reports its effort decision

- **GIVEN** a wave that spawns no implementer (verification-only span) or one whose lanes claim only documentation paths
- **WHEN** the planner emits the plan
- **THEN** no effort assignment is fabricated for an absent implementer
- **AND** any lane that IS listed still carries an `effort` and a matching report entry

### Requirement: Dispatch applies the lane's effort, and the verify and skeptic steps run at their published effort

The implementer spawn SHALL carry the lane's derived effort. Every verify spawn — the inter-wave check, including each of its fix-attempt retries, and the final check — SHALL carry the verify effort published in `lib/limits.mjs`. Every remediation spawn SHALL carry the published skeptic effort, regardless of any lane tier. Every review spawn SHALL carry the model and effort the published spawn table gives the `review-dimension` role at the strict depth, and every skeptic spawn the model and effort it gives the `review-skeptic` role, resolved through the routing module, a `null` meaning the parameter is omitted; the step's `REVIEW WAVE` banner SHALL name what was resolved. They are the steps whose purpose is catching what an implementer missed.

The run program MUST read each of these from the published tables and MUST NOT write an effort level or a model slug at a spawn site. A verify spawn's model is not set by this requirement and stays the session model.

This SHALL hold on both drivers. A runtime or host that does not apply the `effort` it was passed SHALL still run the spawn without error.

Rationale: routing that never reaches dispatch changes nothing; and the adversarial steps are exactly where deeper reasoning pays, so their effort is fixed rather than derived. A verify step left at the host's default runs at a different depth on every host, because the hosts and the models do not default alike. The reviewers and skeptics read the same table rows settle's strict review reads, so one table edit moves both.

#### Scenario: Happy path — an implementer is spawned with its lane's effort

- **GIVEN** a tier-1 lane dispatched by the ship run
- **WHEN** the implementer agent is spawned
- **THEN** the spawn options carry `effort: "low"` alongside the lane's `model` and label

#### Scenario: Failure — the verify and skeptic steps do not inherit the session default

- **GIVEN** an inter-wave verify step, a final verify step, a review step, a skeptics step and a remediation step
- **WHEN** each is emitted by the run program
- **THEN** both verify spawns carry the published verify effort
- **AND** the skeptic spawns and the remediation spawn carry the published skeptic effort, which the `review-skeptic` row holds by reference
- **AND** the review spawns carry the `review-dimension` row's strict override, and when that override holds `null` the step's `REVIEW WAVE` banner prints `inherit` for it, so a reviewer at the session default is a published value and never a silence

#### Scenario: Failure — a verify spawn emitted without an effort fails the suite

- **GIVEN** a run program whose verify spawn carries no effort
- **WHEN** the test that reaches a verify step compares the spawn's effort with the published verify effort
- **THEN** the test fails naming the verify spawn
- **AND** the failure is a test failure before any run, not a verify agent quietly running at a host default

#### Scenario: Edge case — an inter-wave retry carries the same effort as the first attempt

- **GIVEN** an inter-wave verify whose first attempt reported a red unit suite
- **WHEN** the run program emits the retry
- **THEN** the retry's spawn carries the published verify effort

#### Scenario: Edge case — a runtime ignoring the effort key still runs

- **GIVEN** a workflow runtime build that does not recognize `opts.effort`
- **WHEN** an implementer is spawned with an `effort` option
- **THEN** the run proceeds with prior behavior
- **AND** no error is raised for the unknown key

#### Scenario: Edge case — one table edit moves ship's reviewers

- **GIVEN** the `review-dimension` row's strict override changed in `lib/limits.mjs` from `null` to a level
- **WHEN** a strict run next emits its review step
- **THEN** every review spawn carries that level
- **AND** no edit to the run program was required

### Requirement: The effort-by-tier defaults are published, not restated

The tier→effort mapping and the fixed verify/skeptic effort SHALL live in `lib/limits.mjs` and be surfaced by `interlock limits`, so the mapping is read at one source rather than re-stated in prose or duplicated in code that can drift.

Every effort the limits surface prints SHALL be read by the code path it governs. A published effort that nothing reads SHALL fail the cap-authority check, on the same terms as every other published cap. `interlock limits` SHALL label the verify effort as governing both verify checks.

Rationale: "a cap written down twice is a cap that drifts" — the same reason the wave caps already live in `lib/limits.mjs`. A value that is printed and never read is the same failure from the other side: `interlock limits` printed a verify effort while the verify step ran at the host's default.

#### Scenario: Happy path — interlock limits surfaces the effort mapping

- **GIVEN** an operator runs `interlock limits`
- **WHEN** they read the output
- **THEN** it shows the tier→effort defaults and the fixed verify/skeptic effort
- **AND** the verify row names both the inter-wave and the final check

#### Scenario: Failure — no code path hardcodes a tier→effort threshold beside the published one

- **GIVEN** the run program, the wave planner and both drivers
- **WHEN** the suite sweeps each of them for an effort level written beside an `effort` key
- **THEN** none is found, because every effort is read from the published `lib/limits.mjs` source
- **AND** a level written a second time in any of the four fails the sweep naming the file

#### Scenario: Failure — a published effort with no reader fails the suite

- **GIVEN** an effort that appears in the printed limits output and is read by no code path
- **WHEN** the cap-authority check runs
- **THEN** the check fails and names the unread effort

#### Scenario: Edge case — changing a default in limits re-routes without other edits

- **GIVEN** the tier-3 default is changed in `lib/limits.mjs` from inherited to `high`
- **WHEN** a tier-3 lane is next planned
- **THEN** its emitted effort is `high`
- **AND** no edit to the routing functions was required to effect the change

### Requirement: A driver SHALL forward the step's effort and SHALL NOT derive one

The run program is the only place an effort is derived. Each driver — the Workflow script and the runner — SHALL pass a spawn's `effort` to its host exactly as the step carries it when the step named one, and SHALL pass no effort key when the step's effort is null. Neither driver MAY contain an effort table, a tier→effort rule or an effort level.

No other party may name one either. The plugin's own agent definitions SHALL NOT declare an effort, because an effort on an agent definition outranks the one a spawn is given.

Parity between the drivers is therefore a property of forwarding: for the same step, the effort each driver hands its host equals the effort on the step's spawn record.

Rationale: a driver that re-derives effort is a second source that can drift, and a driver that drops it is a host that silently runs at its own default. Forwarding is the only behavior under which the published table means the same thing on every host.

#### Scenario: Happy path — a tier-1 lane's effort reaches the host on both drivers

- **GIVEN** a step whose lane spawn carries `effort: "low"`
- **WHEN** the Workflow script spawns it, and the runner spawns the same step
- **THEN** each host receives `low` as the spawn's effort

#### Scenario: Happy path — a verify step's effort reaches the host on both drivers

- **GIVEN** a verify step whose spawn carries the published verify effort
- **WHEN** each driver spawns it
- **THEN** each host receives that same level
- **AND** neither driver's source names the level

#### Scenario: Failure — a driver that names an effort level is caught

- **GIVEN** a driver into which an effort level or a tier→effort rule has been pasted
- **WHEN** the suite sweeps both drivers
- **THEN** it fails naming that driver

#### Scenario: Failure — an agent definition that declares its own effort is caught

- **GIVEN** a plugin agent definition to which an effort has been added
- **WHEN** the test over the plugin's agent definitions runs
- **THEN** it fails naming that definition

#### Scenario: Edge case — a null effort passes no key

- **GIVEN** a step whose spawn carries a null effort
- **WHEN** either driver spawns it
- **THEN** the request it hands the host carries no effort key, rather than a key with an empty value
- **AND** the agent runs at the host's default

### Requirement: Control-plane and prose spawns SHALL inherit the host's effort

The replan ping, the wave planner, the handoff spawn and the commit spawn SHALL be emitted with no effort, so each runs at the host's default. Inheritance at these four is deliberate: they run a CLI, order work or write prose, and none is an adversarial check.

Every spawn the run program can emit SHALL be either one that reads a published effort — implementer, verify, review, skeptic, remediation — or one of these four. A published effort that the table holds as `null` is a published inheritance, not a membership of the inheriting set: the review kind reads its row whatever the row holds. Giving any of the four an effort is an effort-routing decision that MUST be made as a new entry in the published table, never as a level at the spawn site.

Rationale: an unnamed default reads as a hole, and a hole gets "fixed". Naming the inheriting spawns makes inheritance the requirement.

#### Scenario: Happy path — the four inheriting spawns carry no effort

- **GIVEN** a run that emits a replan ping, a wave-planner spawn, a handoff spawn and a commit spawn
- **WHEN** each step is emitted
- **THEN** each of those spawns carries a null effort

#### Scenario: Failure — an effort set on an inheriting spawn is caught

- **GIVEN** a run program in which the commit spawn has been given an effort
- **WHEN** the test that enumerates the inheriting spawns runs
- **THEN** it fails naming the commit spawn

#### Scenario: Edge case — a new spawn kind must be placed in one set or the other

- **GIVEN** a run program that gains a spawn kind belonging to neither the published-effort set nor the inheriting set
- **WHEN** the test that enumerates spawn kinds runs
- **THEN** it fails naming the new kind
- **AND** the kind cannot ship at an unstated default

### Requirement: An environment override of effort SHALL be bannered

`CLAUDE_CODE_EFFORT_LEVEL` outranks both a session's effort flag and any per-agent effort, so while it is set none of the plan's effort assignments is in effect on a Claude-backed host. The Workflow driver SHALL detect it through its environment probe. The runner SHALL detect it in its own environment when the command its host runs is Claude: the Claude binary directly, or an ACP command whose own name is the Claude binary (`claude`, `claude-code`) or a known ACP adapter that wraps it (`claude-agent-acp`, `claude-code-acp`). Each SHALL raise `EFFORT ROUTING OVERRIDDEN` naming the variable and its value, and the banner SHALL be carried into the run's summary.

A launcher whose own name is `npx` SHALL NOT be treated as Claude. The command name does not say what it launches, and the page that documents the banner SHALL say that a run through one prints neither this banner nor `SUBSCRIPTION PATH`.

Neither driver MAY unset, replace or work around the variable: it is the operator's environment. A driver that cannot establish whether the variable is set SHALL treat it as unset and continue.

Rationale: a summary that reports effort routing as applied while an exported variable replaced every level is the silence the banner block exists to remove. It is the effort twin of `MODEL ROUTING OVERRIDDEN`.

#### Scenario: Happy path — a set variable is bannered on the Workflow host

- **GIVEN** a Workflow run whose environment probe reports `CLAUDE_CODE_EFFORT_LEVEL` as `high`
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=high`

#### Scenario: Happy path — a set variable is bannered on the runner's Claude host

- **GIVEN** `interlock-run <change> --host claude` with `CLAUDE_CODE_EFFORT_LEVEL=medium` in the environment
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=medium`

#### Scenario: Failure — an unset variable raises nothing

- **GIVEN** a run on either driver with `CLAUDE_CODE_EFFORT_LEVEL` unset
- **WHEN** the run closes
- **THEN** the summary does not contain `EFFORT ROUTING OVERRIDDEN`

#### Scenario: Edge case — the variable means nothing to a host that is not Claude

- **GIVEN** `interlock-run <change> --host codex` with `CLAUDE_CODE_EFFORT_LEVEL=high` in the environment
- **WHEN** the run closes
- **THEN** the summary does not contain `EFFORT ROUTING OVERRIDDEN`

#### Scenario: Edge case — a probe that reports nothing does not stop the run

- **GIVEN** a Workflow run whose environment probe returns no answer at all
- **WHEN** the run proceeds
- **THEN** no override banner is raised
- **AND** the run is not halted for the missing answer

#### Scenario: Happy path — a known ACP wrapper is treated as Claude

- **GIVEN** `interlock-run <change> --host acp` whose ACP command is `claude-agent-acp`, with `CLAUDE_CODE_EFFORT_LEVEL=high` in the environment
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING OVERRIDDEN: CLAUDE_CODE_EFFORT_LEVEL=high`
- **AND** the summary contains `SUBSCRIPTION PATH: programmatic`

#### Scenario: Edge case — a launcher is not treated as Claude

- **GIVEN** `interlock-run <change> --host acp` whose ACP command is `npx claude-agent-acp`, with `CLAUDE_CODE_EFFORT_LEVEL` set
- **WHEN** the run closes
- **THEN** the summary does not contain `EFFORT ROUTING OVERRIDDEN`
- **AND** the summary does not contain `SUBSCRIPTION PATH`

#### Scenario: Edge case — the launcher limit is documented

- **GIVEN** the page that documents `EFFORT ROUTING OVERRIDDEN`
- **WHEN** a reader looks for when the runner prints it
- **THEN** the page names `claude-agent-acp` and `claude-code-acp` as recognised
- **AND** the page says a command whose own name is `npx` is not recognised
