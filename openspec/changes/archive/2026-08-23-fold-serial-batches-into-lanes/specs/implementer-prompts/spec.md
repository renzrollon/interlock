## MODIFIED Requirements

### Requirement: Assembled implementer prompt is deterministic

Given a change name and a lane — an ordered, non-empty list of tasks each carrying `id`, `description` and `tier` — the system MUST assemble a single implementer prompt that includes every task's identity in execution order, the documented context ladder for the lane's tier, the implement-only / no-commit / schema-only rules, graph-then-grep locate rules, and the tier 1–2 stop-on-green instruction when the lane's tier is 1 or 2. The lane's tier MUST be the highest tier among its tasks. A multi-task lane MUST instruct the agent to complete its tasks in the given order, to report an outcome for every task, and to stop at the first task it cannot complete rather than skipping ahead. A lane of exactly one task MUST assemble to the same text the single-task form produced before lanes existed, so that existing snapshots do not change. The same inputs MUST produce the same prompt text.

#### Scenario: Tier 1 omits artifact reads and stops on green

- **WHEN** the assembler is asked for a lane holding only tier 1 task `1.1` on change `add-widget`
- **THEN** the prompt names task `1.1`, states that tier 1 reads the task description alone, includes the stop-after-typecheck/lint rule, and does not instruct the agent to read `design.md` or `specs/` in full

#### Scenario: Tier 4 reads design and specs in full

- **WHEN** the assembler is asked for a lane holding a single tier 4 task on change `add-widget`
- **THEN** the prompt states that tier 4+ reads `design.md` and the specs in full for that change, and does not include the tier 1–2 stop-on-green instruction

#### Scenario: Happy path — a single-task lane is byte-identical to the pre-lane prompt

- **GIVEN** a lane holding exactly one task
- **WHEN** the assembler renders it
- **THEN** the assembled text matches the stored pre-lane single-task snapshot exactly

#### Scenario: Failure — a multi-task lane names every task and its order

- **WHEN** the assembler is asked for a lane holding tier 4 tasks `2.1`, `2.2` and `2.3` on change `add-widget`
- **THEN** the prompt names all three tasks in that order
- **AND** it instructs the agent to stop at the first task it cannot complete and to report the remaining tasks as not attempted

#### Scenario: Edge case — a mixed-tier lane assembles at its highest tier

- **GIVEN** a lane holding a tier 1 task followed by a tier 4 task
- **WHEN** the assembler renders it
- **THEN** the prompt states the tier 4 context ladder for the whole lane
- **AND** it does not include the tier 1–2 stop-on-green instruction, because the lane's tier is 4

### Requirement: Prompt snapshots fail on silent drift

The test suite MUST snapshot the assembled implementer prompt text for each of tiers 1–4 (and tier 5 if its text differs) against fixtures in the repo, for a single-task lane and for a multi-task lane. A change to the assembled text MUST fail `npm test` until the fixture is updated deliberately. The single-task fixtures MUST be the ones that existed before lanes, unmodified, so that a regression reintroducing per-task divergence is caught. Snapshots MUST run in the existing Node test runner with no network, no API key, and no ACP or headless host.

#### Scenario: Cap-style pin catches a reworded ladder

- **WHEN** someone edits the tier-ladder sentences in the assembler without updating the snapshot fixture
- **THEN** `npm test` fails on the implementer-prompt snapshot assertion

#### Scenario: No ACP harness required

- **WHEN** CI runs `npm test`
- **THEN** the prompt snapshot tests pass without starting Claude Code, dsh, or any Agent Client Protocol session

#### Scenario: Failure — a change to the single-task form is caught

- **WHEN** someone edits the assembler so that a one-task lane no longer produces the original single-task text
- **THEN** `npm test` fails against the unmodified pre-lane single-task fixture

#### Scenario: Edge case — a multi-task lane has its own fixture

- **GIVEN** a lane holding more than one task
- **WHEN** its assembled text changes without the fixture being updated
- **THEN** `npm test` fails on the multi-task lane snapshot, separately from the single-task assertion
