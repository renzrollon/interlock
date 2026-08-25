## Purpose

Separates *how demanding a task is* from *which vendor's model runs it*, so the planner's tier ladder can dispatch on any host without a second copy of the routing rules appearing per host.

## ADDED Requirements

### Requirement: A plan SHALL carry a host-neutral model class, not a vendor model name

Every task and every lane in a wave plan SHALL carry a `model` value drawn from exactly one closed set of host-neutral classes: `cheap`, `standard`, `deep`. Plan validation SHALL reject any other value, including a vendor model name. No artifact the planner writes — plan, next step, run log, plan preview, prompt text — SHALL contain a vendor model name in the `model` position.

Rationale: the enum was previously `haiku|sonnet|opus`, which made a non-Anthropic host structurally incapable of producing a valid plan.

#### Scenario: Happy path — a validated plan carries only classes

- **GIVEN** a classified task list in which the classifier assigned tiers 1 through 5
- **WHEN** the wave plan is built and validated
- **THEN** every task's and every lane's `model` is one of `cheap`, `standard`, `deep`
- **AND** the plan preview's agent bill names those classes rather than a vendor model

#### Scenario: Failure — a vendor model name is rejected at validation

- **GIVEN** a classified task whose `model` is `sonnet`
- **WHEN** plan validation runs
- **THEN** validation fails naming that task id and the closed set of permitted classes
- **AND** the run does not proceed with the vendor name passed through untranslated

#### Scenario: Edge case — casing and surrounding whitespace resolve to one class

- **GIVEN** two classified tasks whose `model` values are `Deep` and ` deep `
- **WHEN** plan validation runs
- **THEN** both resolve to the single canonical class `deep`
- **AND** they are treated as the same class by the clamp, by lane dispatch, and by the plan preview, with no branch reading the raw string

### Requirement: The tier clamp SHALL operate on classes and remain unchanged in effect

The clamp that stops a classifier over-assigning the most expensive model SHALL be expressed in classes: a task below tier 5 SHALL NOT hold `deep`, and a clamped task SHALL fall back to `standard` unless it already held `cheap`, in which case it keeps `cheap`. Each clamp SHALL be recorded on the plan with the task id, the class it left, the class it joined, and its tier. The clamp's observable effect SHALL be identical to the behavior it replaces.

#### Scenario: Happy path — a tier-3 task asking for the deepest class is clamped

- **GIVEN** a classified tier-3 task whose `model` is `deep`
- **WHEN** the plan is built
- **THEN** that task's class becomes `standard`
- **AND** the plan records a clamp entry naming the task id, `deep`, `standard`, and tier 3

#### Scenario: Failure — a tier-5 task is not clamped

- **GIVEN** a classified tier-5 task whose `model` is `deep`
- **WHEN** the plan is built
- **THEN** the task keeps `deep`
- **AND** no clamp entry is recorded for it

#### Scenario: Edge case — a cheap task is never promoted by the clamp

- **GIVEN** a classified tier-2 task whose `model` is `cheap`
- **WHEN** the clamp runs
- **THEN** the task still holds `cheap`
- **AND** no clamp entry is recorded, rather than a no-op clamp from `cheap` to `cheap` being listed

### Requirement: Exactly one function per host SHALL resolve a class to that host's model

Each host SHALL resolve a model class to a concrete model — and, where the host supports a separate reasoning-effort dial, to a concrete effort — in exactly one place. A host SHALL NOT branch on the class anywhere else. Resolution SHALL be total: every class in the closed set SHALL resolve on every host, and an unresolvable class SHALL be a startup failure rather than a silent fallback discovered mid-run.

#### Scenario: Happy path — every class resolves on every host

- **GIVEN** each registered host adapter
- **WHEN** each of `cheap`, `standard` and `deep` is resolved through that host
- **THEN** every combination returns a concrete model the host can dispatch
- **AND** no combination returns an empty value, a class name, or another host's model

#### Scenario: Failure — a host missing a class fails at startup

- **GIVEN** a host adapter whose resolution table omits `deep`
- **WHEN** the driver starts
- **THEN** it halts naming the host and the unresolved class
- **AND** it does not start the wave loop intending to substitute a different class when it reaches a tier-5 lane

#### Scenario: Edge case — a host with no per-spawn model selector states so rather than implying routing

- **GIVEN** a host whose transport cannot select a model per spawn
- **WHEN** a run starts on that host
- **THEN** the run reports that class routing is not in effect on this host
- **AND** the run summary does not present a cost profile that was never applied

### Requirement: A host that supports a reasoning-effort dial SHALL map effort from the task tier, not from the class

On a host exposing reasoning effort independently of model selection, effort SHALL be derived from the task or lane tier, and two tiers that resolve to the same model SHALL be distinguishable by effort. The mapping SHALL be published by the same command that publishes the caps, so an operator can read what a given tier will cost before a run.

#### Scenario: Happy path — two tiers sharing a model differ in effort

- **GIVEN** a host on which tier 4 and tier 5 both resolve to the same concrete model
- **WHEN** a tier-4 lane and a tier-5 lane are dispatched
- **THEN** the tier-5 lane is dispatched at a strictly higher reasoning effort than the tier-4 lane
- **AND** both dispatches name the same concrete model

#### Scenario: Failure — an effort value outside the host's accepted set halts

- **GIVEN** a configured effort for some tier that the host's model does not accept
- **WHEN** the driver starts
- **THEN** it halts naming the tier, the effort, and the accepted set
- **AND** it does not dispatch the lane at the host's default effort while reporting the configured one

#### Scenario: Edge case — the published mapping and the dispatched effort cannot disagree

- **GIVEN** the effort mapping as published by the caps command
- **WHEN** a lane at each tier is dispatched and the effort actually sent is compared to the published value
- **THEN** every tier's dispatched effort equals its published effort
- **AND** a divergence is a test failure rather than a runtime warning
