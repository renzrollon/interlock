# Spec Delta

## MODIFIED Requirements

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
