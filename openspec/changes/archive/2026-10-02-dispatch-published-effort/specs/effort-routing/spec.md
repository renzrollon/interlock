## RENAMED Requirements

- FROM: `### Requirement: Dispatch applies the lane's effort, and the verify and skeptic steps run at xhigh`
- TO: `### Requirement: Dispatch applies the lane's effort, and the verify and skeptic steps run at their published effort`

## MODIFIED Requirements

### Requirement: Dispatch applies the lane's effort, and the verify and skeptic steps run at their published effort

The implementer spawn SHALL carry the lane's derived effort. Every verify spawn — the inter-wave check, including each of its fix-attempt retries, and the final check — SHALL carry the verify effort published in `lib/limits.mjs`, and every review and remediation spawn SHALL carry the published skeptic effort, regardless of any lane tier. They are the steps whose purpose is catching what an implementer missed.

The run program MUST read each of these from the published table and MUST NOT write an effort level at a spawn site. A verify spawn's model is not set by this requirement and stays the session model.

This SHALL hold on both drivers. A runtime or host that does not apply the `effort` it was passed SHALL still run the spawn without error.

Rationale: routing that never reaches dispatch changes nothing; and the adversarial steps are exactly where deeper reasoning pays, so their effort is fixed rather than derived. A verify step left at the host's default runs at a different depth on every host, because the hosts and the models do not default alike.

#### Scenario: Happy path — an implementer is spawned with its lane's effort

- **GIVEN** a tier-1 lane dispatched by the ship run
- **WHEN** the implementer agent is spawned
- **THEN** the spawn options carry `effort: "low"` alongside the lane's `model` and label

#### Scenario: Failure — the verify and skeptic steps do not inherit the session default

- **GIVEN** an inter-wave verify step, a final verify step, a review step and a remediation step
- **WHEN** each is emitted by the run program
- **THEN** both verify spawns carry the published verify effort
- **AND** the review and remediation spawns carry the published skeptic effort
- **AND** none of them is emitted with no effort

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

## REMOVED Requirements

### Requirement: The planner and the runtime derive identical effort for the same lane

**Reason**: The mirror it protects no longer exists. `laneEffort` was duplicated in `workflows/ship.js` because the workflow runtime rejects module loading; the run program now derives the effort once and puts it on the spawn, and the driver forwards that field. A parity requirement aimed at a second copy either fails or pins a fiction, and the suite already pins the copy's absence.

**Migration**: Replaced by "A driver SHALL forward the step's effort and SHALL NOT derive one". Resume honesty, the property the mirror guarded, now follows from there being a single derivation: a resumed run reads the same step record the first pass did.

## ADDED Requirements

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

Every spawn the run program can emit SHALL be either one that reads a published effort — implementer, verify, review, remediation — or one of these four. Giving any of the four an effort is an effort-routing decision that MUST be made as a new entry in the published table, never as a level at the spawn site.

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

`CLAUDE_CODE_EFFORT_LEVEL` outranks both a session's effort flag and any per-agent effort, so while it is set none of the plan's effort assignments is in effect on a Claude-backed host. The Workflow driver SHALL detect it through its environment probe. The runner SHALL detect it in its own environment when the command its host runs is the Claude binary, directly or as the configured ACP command. Each SHALL raise `EFFORT ROUTING OVERRIDDEN` naming the variable and its value, and the banner SHALL be carried into the run's summary.

The runner recognises the Claude binary by its command name. An ACP wrapper around Claude under another name is not recognised, so a run through one raises no override banner even though the variable applies there. That limit SHALL be stated where the banner is documented.

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

#### Scenario: Edge case — the unrecognised-wrapper limit is documented

- **GIVEN** the page that documents `EFFORT ROUTING OVERRIDDEN`
- **WHEN** a reader looks for when the runner prints it
- **THEN** the page says an ACP wrapper around Claude is not recognised and prints no override banner
