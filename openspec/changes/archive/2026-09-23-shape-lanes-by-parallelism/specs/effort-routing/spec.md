## MODIFIED Requirements

### Requirement: A lane's effort is the effort of its hardest task's tier

The planner SHALL derive a lane's reasoning effort from the highest tier among the lane's tasks — never from the first task — mapping tier to effort through the table published in `lib/limits.mjs`. A lane is one agent, and that agent must be capable of the hardest thing in the lane; taking a lower tier's effort is the one direction of this trade that is not survivable. The default table is: tier 1 and tier 2 → `low`; tier 3 and tier 4 → the session default (unset, inherited); tier 5 → `xhigh`.

Effort MUST be derived from tier alone, independently of the model the lane dispatches on, which follows the lane's shape. A lane that runs on opus because it holds several tasks therefore keeps its tier's effort.

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

#### Scenario: Edge case — an opus multi-task lane of low-tier tasks keeps low effort

- **GIVEN** a chain lane of three tier-2 tasks
- **WHEN** the lane is dispatched
- **THEN** it dispatches on opus with `effort` `low`

#### Scenario: Edge case — a lane with no usable tier falls to the inherited default and is reported

- **GIVEN** a lane whose tasks carry no integer `tier` (missing or non-numeric)
- **WHEN** the planner derives the lane's effort
- **THEN** the lane's `effort` is the session default (unset/inherited), never guessed upward to `xhigh`
- **AND** the plan records that the lane's tier could not be read
