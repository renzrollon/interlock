## Purpose

Lets a small change be shipped by one capable agent that holds the whole change, inside the ship loop's verification and commit guarantees, decided within a published envelope rather than by prose or by a model re-arguing a threshold.

## ADDED Requirements

### Requirement: A solo plan SHALL be one lane holding every task in section, layer and id order, with test tasks last

When a change is planned in solo mode, the plan MUST contain exactly one implementation wave with exactly one batch holding exactly one lane. That lane MUST hold every implementation task ordered by section group ascending, then dependency layer ascending, then task id ascending, followed by every test task ordered by dependency layer then task id. The plan's test wave MUST be absent. Every section barrier and every `dependsOn` edge MUST be honoured by the order of tasks inside the lane. Tasks MUST NOT be dropped, duplicated or reordered against those keys.

#### Scenario: Happy path — a twelve-task change becomes one ordered lane

- **GIVEN** a classified change with nine implementation tasks across sections 1 and 2, one `dependsOn` edge inside section 1, and three test tasks
- **WHEN** the planner plans it in solo mode
- **THEN** the plan has one wave, one batch and one lane of twelve tasks
- **AND** every section-1 task precedes every section-2 task, the dependent task follows the task it depends on, and the three test tasks are the last three
- **AND** `testWave` is null

#### Scenario: Failure — an edge cannot be honoured by id order alone

- **GIVEN** section 1 holds tasks `1.2` and `1.5`, and `1.2` declares `dependsOn: ["1.5"]`
- **WHEN** the planner plans it in solo mode
- **THEN** `1.5` precedes `1.2` in the lane, because layer order takes precedence over id order
- **AND** the plan reports the edge in its ordering report exactly as it would in waves mode

#### Scenario: Edge case — a change holding only test tasks

- **GIVEN** a classified change whose every task is a test task
- **WHEN** the planner plans it in solo mode
- **THEN** the plan still holds one lane containing every test task in layer-then-id order
- **AND** the existing warning that no implementation tasks were classified is emitted

### Requirement: The mode SHALL be decided by flag, then by the classifier inside the published envelope, then default to waves

The planner MUST accept an explicit mode override. When present it MUST win: a forced solo whose task count exceeds the published envelope MUST still be planned solo and MUST be reported with a warning naming the count and the envelope. When no override is present, a classifier recommendation of solo MUST be honoured only when the task count is at or below the envelope; a recommendation above the envelope MUST be refused with a warning naming the count and the bound, and the plan MUST be waves. When no override and no recommendation are present, or the recommendation is unrecognized, the plan MUST be waves with no warning. The plan MUST record the mode and its source as one of `flag`, `classifier` or `default`. Two contradictory overrides on one invocation MUST be rejected before planning rather than resolved by order.

#### Scenario: Happy path — a classifier recommendation inside the envelope is honoured

- **GIVEN** a classified change of fourteen tasks whose classification carries `recommendedMode: "solo"` and a reason, and the published envelope is larger than fourteen
- **WHEN** the planner plans it with no override
- **THEN** the plan's mode is solo and its source is `classifier`
- **AND** the reason is carried on the plan verbatim

#### Scenario: Failure — a recommendation above the envelope is refused and named

- **GIVEN** a classified change whose task count exceeds the published envelope and whose classification carries `recommendedMode: "solo"`
- **WHEN** the planner plans it with no override
- **THEN** the plan's mode is waves and its source is `default`
- **AND** a warning names the task count and the envelope bound

#### Scenario: Edge case — a flag forces solo above the envelope, and contradictory flags fail closed

- **GIVEN** the same over-envelope change
- **WHEN** the ship invocation passes the solo override
- **THEN** the plan's mode is solo, its source is `flag`, and a warning states the envelope was exceeded by explicit request
- **AND** an invocation passing both the solo and the waves override is rejected with a message naming both flags before any plan is built

### Requirement: A solo lane SHALL be dispatched on opus at the hardest task's effort with the full-read briefing

In solo mode the planner MUST set every task's model to opus after the classifier clamp has been applied, and MUST record each promotion (task id, model before, model after, tier) on the plan; a task already on opus MUST NOT be listed. The lane's effort MUST remain the effort published for its hardest task's tier. The implementer briefing for a solo lane MUST state the full-read context ladder (design and specs in full) regardless of the hardest task's tier, and MUST NOT alter any task's recorded tier to achieve that.

#### Scenario: Happy path — sonnet and haiku tasks are promoted and listed

- **GIVEN** a solo change whose tasks were classified tier 1 haiku, tier 2 sonnet and tier 3 sonnet
- **WHEN** the planner plans it
- **THEN** every task in the lane carries model opus
- **AND** the plan's promotion report lists all three with their previous models
- **AND** the lane's effort is the published effort for tier 3

#### Scenario: Failure — the clamp is not bypassed by the classifier

- **GIVEN** a classified change with a tier-3 task the classifier assigned opus, and no solo decision
- **WHEN** the planner plans it in waves mode
- **THEN** that task is clamped to sonnet and reported as clamped, exactly as today
- **AND** no promotion report is emitted

#### Scenario: Edge case — a tier-5 task already on opus is not double-reported

- **GIVEN** a solo change containing one tier-5 task the classifier assigned opus
- **WHEN** the planner plans it
- **THEN** the promotion report omits that task
- **AND** the lane's effort is the published tier-5 effort

### Requirement: The classifier prompt SHALL ask for a mode recommendation without restating the envelope

The `plan-waves` prompt MUST tell the classifier to emit a top-level `recommendedMode` of `solo` or `waves` and a one-line `modeReason` beside the per-task classification, and MUST describe solo as one agent implementing the whole change in order with no parallel isolation. The prompt MUST NOT state the envelope's numeric bound; it MUST say the planner enforces the published envelope. A classification that omits `recommendedMode` MUST remain valid and MUST plan as waves.

#### Scenario: Happy path — the assembled prompt carries the mode instruction

- **GIVEN** an operator captures the assembled `plan-waves` prompt
- **WHEN** they search it
- **THEN** it instructs the classifier to emit `recommendedMode` and `modeReason` at the top level of the classification

#### Scenario: Failure — the prompt does not restate the bound

- **GIVEN** the same assembled prompt and the envelope published by `interlock limits`
- **WHEN** the prompt is searched for the envelope's numeric value
- **THEN** the value does not appear as a solo bound in the prompt text

#### Scenario: Edge case — a classification without a recommendation still plans

- **GIVEN** a `classified.json` written before the mode field existed
- **WHEN** it is planned with no override
- **THEN** the plan is waves with source `default` and no mode warning

### Requirement: The solo envelope and the lane-cap table SHALL be published caps with code readers

The solo envelope and the per-tier lane-cap table MUST be stated once in the limits module, printed by `interlock limits` in both its text and JSON forms, and read by the planning code path. A printed cap with no code reader MUST fail the cap-authority check.

#### Scenario: Happy path — limits prints the envelope and the table

- **WHEN** an operator runs `interlock limits`
- **THEN** the output names the solo task envelope, the per-tier lane caps and the cohesion tier ceiling as integers

#### Scenario: Failure — an unread cap fails the authority check

- **GIVEN** a cap added to the solo or lane-cap group with no reader in the planning code
- **WHEN** the cap-authority test runs
- **THEN** it fails naming that cap

#### Scenario: Edge case — the JSON surface carries the groups separately

- **WHEN** an operator runs `interlock limits --json`
- **THEN** the lane caps and the solo envelope appear as their own top-level groups, not as entries of the iteration-count limits
