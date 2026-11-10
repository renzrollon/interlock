# Spec Delta

## MODIFIED Requirements

### Requirement: A lane's effort is the effort of its hardest task's tier

The planner SHALL derive a lane's reasoning effort from the highest tier among the lane's tasks — never from the first task — mapping tier to effort through the table published in `lib/limits.mjs`. A lane is one agent, and that agent must be capable of the hardest thing in the lane; taking a lower tier's effort is the one direction of this trade that is not survivable. The default table is: tier 1 and tier 2 → `low`; tier 3 → `medium`; tier 4 and tier 5 → `high`. No tier inherits the session default in the default table; a tier the table holds as `null` inherits it, and a lane with no usable tier inherits it by fallback.

Effort MUST be derived from tier alone, independently of the model the lane dispatches on, which follows the lane's shape and the published opus floor. A multi-task lane that runs on sonnet because its hardest tier is below that floor therefore keeps its tier's effort; a multi-task lane that runs on opus because the hardest tier clears the floor does the same. A tiered lane's effort MUST NOT follow the effort of the session that launched the run.

Rationale: effort and model are two independent dials. Deriving effort from tier rather than from the model means a change to model routing never silently moves effort. A tier left to inherit runs at a different depth in every session, so the largest group of spawns in a run was priced by whatever the session happened to be left at.

#### Scenario: Happy path — a mechanical lane routes at low effort

- **GIVEN** a lane whose tasks are all tier 1 or tier 2
- **WHEN** `interlock waves` plans it
- **THEN** the lane's emitted `effort` is `low`

#### Scenario: Happy path — a tier-3 lane and a tier-4 lane carry a published level

- **GIVEN** one lane whose hardest task is tier 3 and another whose hardest task is tier 4
- **WHEN** `interlock waves` plans them
- **THEN** the tier-3 lane's emitted `effort` is `medium` and the tier-4 lane's is `high`
- **AND** the plan's effort report shows neither as inherited

#### Scenario: Failure — a mixed lane takes the hardest task's effort, not the first task's

- **GIVEN** a lane whose first task is tier 1 and whose last task is tier 5
- **WHEN** the planner derives the lane's effort
- **THEN** the emitted `effort` is the tier-5 effort, `high`
- **AND** it is NOT `low`, even though tier 1 was the lane's first task

#### Scenario: Failure — the session's effort does not move a tiered lane

- **GIVEN** the same classified task list planned in a session at `low` and in a session at `max`
- **WHEN** `interlock waves` plans it in each
- **THEN** every tiered lane carries a level, the same one in both plans
- **AND** no tiered lane carries a `null` effort for the session to fill

#### Scenario: Edge case — a multi-task lane of low-tier tasks keeps low effort

- **GIVEN** a chain lane of three tier-2 tasks
- **WHEN** the lane is dispatched
- **THEN** it dispatches on sonnet with `effort` `low`

#### Scenario: Edge case — a lane with no usable tier falls to the inherited default and is reported

- **GIVEN** a lane whose tasks carry no integer `tier` (missing or non-numeric)
- **WHEN** the planner derives the lane's effort
- **THEN** the lane's `effort` is the session default (unset/inherited), never guessed upward to a level
- **AND** the plan records that the lane's tier could not be read

### Requirement: The effort-by-tier defaults are published, not restated

The tier→effort mapping, the verify effort, the verify retry effort and the skeptic effort SHALL live in `lib/limits.mjs` and be surfaced by `interlock limits`, so the mapping is read at one source rather than re-stated in prose or duplicated in code that can drift.

Every effort the limits surface prints SHALL be read by the code path it governs. A published effort that nothing reads SHALL fail the cap-authority check, on the same terms as every other published cap. `interlock limits` SHALL label the verify effort as governing both verify checks, and SHALL print the verify retry effort in its own row, labelled as governing an inter-wave fix attempt. `interlock limits --json` SHALL carry both.

Rationale: "a cap written down twice is a cap that drifts" — the same reason the wave caps already live in `lib/limits.mjs`. A value that is printed and never read is the same failure from the other side: `interlock limits` printed a verify effort while the verify step ran at the host's default.

#### Scenario: Happy path — interlock limits surfaces the effort mapping

- **GIVEN** an operator runs `interlock limits`
- **WHEN** they read the output
- **THEN** it shows the tier→effort defaults, the verify effort, the verify retry effort and the skeptic effort
- **AND** the verify row names both the inter-wave and the final check, and the retry row names the inter-wave fix attempt

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

- **GIVEN** the tier-3 default is changed in `lib/limits.mjs` from `medium` to `high`
- **WHEN** a tier-3 lane is next planned
- **THEN** its emitted effort is `high`
- **AND** no edit to the routing functions was required to effect the change

#### Scenario: Edge case — a plan stored under another effort table is rebuilt, naming the table

- **GIVEN** a stored plan and fingerprint built under one tier→effort table, or before the table was part of the fingerprint
- **WHEN** the table in `lib/limits.mjs` differs from the one the plan was built under and the next run checks plan reuse
- **THEN** the plan is rebuilt, not reused, so its lane report cannot name an effort the spawn does not carry
- **AND** the reuse reason names `effortByTier` and does not say the artifacts were edited

## REMOVED Requirements

### Requirement: Dispatch applies the lane's effort, and the verify and skeptic steps run at their published effort

**Reason**: Its scenario "Edge case — an inter-wave retry carries the same effort as the first attempt" requires what this change ends: a fix attempt now runs one published step above the first attempt. A MODIFIED block cannot drop a living scenario, so the requirement is replaced whole. Everything else it required is carried, scenario for scenario, by the two requirements added below: one for the lane, review, skeptic and remediation spawns, one for the verify spawns.

**Migration**: None for operators. A run started after the change routes its verify fix attempts at the published retry effort; a run resumed across the change derives the effort from the step's own attempt counter, as it derives everything else.

## ADDED Requirements

### Requirement: Dispatch SHALL carry the lane's effort, and the review, skeptic and remediation spawns their published efforts

The implementer spawn SHALL carry the lane's derived effort. Every remediation spawn SHALL carry the published skeptic effort, whose default is `high`. Every review and skeptic spawn SHALL carry what the published spawn table gives its role, `review-dimension` at the strict depth or `review-skeptic`, resolved through the routing module; a `null` omits the parameter, and the `REVIEW WAVE` banner SHALL name what was resolved. The run program MUST NOT write a level or a model slug at a spawn site.

#### Scenario: Happy path — an implementer is spawned with its lane's effort

- **GIVEN** a tier-1 lane dispatched by the ship run
- **WHEN** the implementer agent is spawned
- **THEN** the spawn options carry `effort: "low"` alongside the lane's `model` and label

#### Scenario: Failure — the skeptic and remediation steps do not inherit the session default

- **GIVEN** a review step, a skeptics step and a remediation step
- **WHEN** each is emitted by the run program
- **THEN** the skeptic spawns and the remediation spawn carry the published skeptic effort, which the `review-skeptic` row holds by reference
- **AND** the review spawns carry the `review-dimension` row's strict override, and when that override holds `null` the step's `REVIEW WAVE` banner prints `inherit` for it, so a reviewer at the session default is a published value and never a silence

#### Scenario: Failure — one edit to the skeptic effort moves all three of its readers

- **GIVEN** the published skeptic effort changed in `lib/limits.mjs`
- **WHEN** a strict run emits its skeptics step and a remediation step, and `interlock routing settle-fixer` runs
- **THEN** the skeptic spawns, the remediation spawn and the settle fixer's row all carry the new level
- **AND** no other file was edited

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

### Requirement: A verify spawn SHALL carry the verify effort on a first attempt and the retry effort on a fix attempt

A verify spawn's first attempt, which is the inter-wave check's initial attempt or the final check, SHALL carry the verify effort published in `lib/limits.mjs`. Each inter-wave fix attempt SHALL carry the published verify retry effort. The defaults are `high` and `xhigh`. Which of the two a spawn carries MUST be derived from the step's own attempt counter. A verify spawn's model stays the session model. A host that does not apply the effort it was passed SHALL still run the spawn.

#### Scenario: Happy path — both first attempts carry the verify effort

- **GIVEN** an inter-wave verify step on its initial attempt and a final verify step
- **WHEN** each is emitted by the run program, on either driver
- **THEN** both spawns carry the published verify effort
- **AND** neither carries the session's effort or the retry effort

#### Scenario: Failure — a verify spawn emitted without an effort fails the suite

- **GIVEN** a run program whose verify spawn carries no effort
- **WHEN** the test that reaches a verify step compares the spawn's effort with the published verify effort
- **THEN** the test fails naming the verify spawn
- **AND** the failure is a test failure before any run, not a verify agent quietly running at a host default

#### Scenario: Edge case — an inter-wave fix attempt carries the retry effort, and the first attempt does not

- **GIVEN** an inter-wave verify whose first attempt reported a red unit suite
- **WHEN** the run program emits the first attempt and then the fix attempt
- **THEN** the first attempt's spawn carried the published verify effort
- **AND** the fix attempt's spawn carries the published verify retry effort, as does every later fix attempt of that wave

#### Scenario: Edge case — the final check carries the verify effort

- **GIVEN** a run that reaches its final check, which has no attempt counter
- **WHEN** the run program emits it
- **THEN** its spawn carries the published verify effort, never the retry effort

#### Scenario: Edge case — a fix attempt resumed after a halt routes as it did before

- **GIVEN** a run halted while a wave's second verify attempt was owed
- **WHEN** the run is resumed and emits that attempt
- **THEN** its spawn carries the published verify retry effort
- **AND** the effort was derived from the step's attempt counter, not from anything the resumed process remembered
