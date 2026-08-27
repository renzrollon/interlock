## Purpose

Gives the wave planner a second, finer capability dial beside the model clamp: the reasoning effort each lane's agent runs at, derived deterministically from the lane's tier after classification, reported like every other planner decision, and mirrored across the planner/runtime boundary so a resumed run routes identically.

## ADDED Requirements

### Requirement: A lane's effort is the effort of its hardest task's tier

The planner SHALL derive a lane's reasoning effort from the highest tier among the lane's tasks — never from the first task — mapping tier to effort through the table published in `lib/limits.mjs`. A lane is one agent, and that agent must be capable of the hardest thing in the lane; taking a lower tier's effort is the one direction of this trade that is not survivable. The default table is: tier 1 and tier 2 → `low`; tier 3 and tier 4 → the session default (unset, inherited); tier 5 → `xhigh`.

Rationale: mirrors `laneModel`'s existing "capable of everything in it" rule so effort and model are derived by the same principle.

#### Scenario: Happy path — a mechanical lane routes at low effort

- **GIVEN** a lane whose tasks are all tier 1 or tier 2
- **WHEN** `interlock waves` plans it
- **THEN** the lane's emitted `effort` is `low`

#### Scenario: Failure — a mixed lane takes the hardest task's effort, not the first task's

- **GIVEN** a lane whose first task is tier 1 and whose last task is tier 5
- **WHEN** the planner derives the lane's effort
- **THEN** the emitted `effort` is `xhigh`
- **AND** it is NOT `low`, even though tier 1 was the lane's first task

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

### Requirement: The planner and the runtime derive identical effort for the same lane

Because the workflow runtime rejects module loading, `laneEffort` exists twice — the source in `lib/waves.mjs` and a mirror in `workflows/ship.js`. The two SHALL derive the same effort for the same lane, so a resumed run routes a cached lane exactly as the first pass did.

Rationale: a mirrored function that drifts silently re-routes work on replay; parity is the property that keeps resume honest, the same constraint already stated for the mirrored `laneModel`.

#### Scenario: Happy path — both copies agree on a normal lane

- **GIVEN** a lane of tier-5 tasks
- **WHEN** effort is derived by `lib/waves.mjs` and by the `workflows/ship.js` mirror
- **THEN** both return `xhigh`

#### Scenario: Failure — a divergence between the two copies is a defect the suite catches

- **GIVEN** a table of representative lanes spanning tiers 1 through 5 and an untiered lane
- **WHEN** each lane's effort is computed by both copies
- **THEN** every lane's two results are equal
- **AND** any inequality fails the test that guards the mirror

#### Scenario: Edge case — an unresolvable tier resolves identically on both sides

- **GIVEN** a lane whose tasks carry no usable tier
- **WHEN** both copies derive its effort
- **THEN** both return the same inherited-default value

### Requirement: Dispatch applies the lane's effort, and the verify and skeptic steps run at xhigh

The implementer spawn SHALL pass the lane's derived effort to the agent, and the inter-wave verify step and the adversarial review skeptics SHALL run at `xhigh` regardless of any lane tier — they are the steps whose purpose is catching what an implementer missed. A runtime that does not understand the `effort` key SHALL degrade to prior behavior without error.

Rationale: routing that never reaches dispatch changes nothing; and the two adversarial steps are exactly where deeper reasoning pays, so their effort is fixed rather than derived.

#### Scenario: Happy path — an implementer is spawned with its lane's effort

- **GIVEN** a tier-1 lane dispatched by the ship run
- **WHEN** the implementer agent is spawned
- **THEN** the spawn options carry `effort: "low"` alongside the lane's `model` and label

#### Scenario: Failure — the verify and skeptic steps do not inherit the session default

- **GIVEN** an inter-wave verify step and a review skeptic step
- **WHEN** each is spawned
- **THEN** both carry `effort: "xhigh"`
- **AND** neither is left at the session default

#### Scenario: Edge case — a runtime ignoring the effort key still runs

- **GIVEN** a workflow runtime build that does not recognize `opts.effort`
- **WHEN** an implementer is spawned with an `effort` option
- **THEN** the run proceeds with prior behavior
- **AND** no error is raised for the unknown key

### Requirement: The effort-by-tier defaults are published, not restated

The tier→effort mapping and the fixed verify/skeptic effort SHALL live in `lib/limits.mjs` and be surfaced by `interlock limits`, so the mapping is read at one source rather than re-stated in prose or duplicated in code that can drift.

Rationale: "a cap written down twice is a cap that drifts" — the same reason the wave caps already live in `lib/limits.mjs`.

#### Scenario: Happy path — interlock limits surfaces the effort mapping

- **GIVEN** an operator runs `interlock limits`
- **WHEN** they read the output
- **THEN** it shows the tier→effort defaults and the fixed verify/skeptic effort

#### Scenario: Failure — no code path hardcodes a tier→effort threshold beside the published one

- **GIVEN** the effort-routing code in `lib/waves.mjs` and `workflows/ship.js`
- **WHEN** an operator searches for the tier→effort numbers
- **THEN** the mapping is read from the published `lib/limits.mjs` source
- **AND** the same threshold is not independently written a second time

#### Scenario: Edge case — changing a default in limits re-routes without other edits

- **GIVEN** the tier-3 default is changed in `lib/limits.mjs` from inherited to `high`
- **WHEN** a tier-3 lane is next planned
- **THEN** its emitted effort is `high`
- **AND** no edit to the routing functions was required to effect the change
