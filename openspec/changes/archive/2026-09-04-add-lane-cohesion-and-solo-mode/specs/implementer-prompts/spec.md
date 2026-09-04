## MODIFIED Requirements

### Requirement: Assembled implementer prompt is deterministic

Given a change name and a lane — an ordered, non-empty list of tasks each carrying `id`, `description` and `tier` — the system MUST assemble a single implementer prompt that includes every task's identity in execution order, the documented context ladder for the lane's tier, the implement-only / no-commit / schema-only rules, graph-then-grep locate rules, and the tier 1–2 stop-on-green instruction when the lane's tier is 1 or 2. The lane's tier MUST be the highest tier among its tasks. A multi-task lane MUST instruct the agent to complete its tasks in the given order, to report an outcome for every task, and to stop at the first task it cannot complete rather than skipping ahead. The multi-task heading MUST state only what is true of every multi-task lane — that the tasks are one lane run by this agent alone and that no other agent touches the files they claim while it works — and MUST NOT claim the tasks share files. A lane assembled with the solo flag MUST be briefed as the whole change: the heading names the change and the task count, states that this agent owns every listed task including the test tasks, and the context ladder stated is the full-read ladder regardless of the hardest task's tier. A lane of exactly one task MUST assemble to the same text the single-task form produced before lanes existed, so that existing snapshots do not change. The same inputs MUST produce the same prompt text.

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
- **AND** its heading does not claim the three tasks edit the same files

#### Scenario: Edge case — a mixed-tier lane assembles at its highest tier

- **GIVEN** a lane holding a tier 1 task followed by a tier 4 task
- **WHEN** the assembler renders it
- **THEN** the prompt states the tier 4 context ladder for the whole lane
- **AND** it does not include the tier 1–2 stop-on-green instruction, because the lane's tier is 4

#### Scenario: Edge case — a solo lane of low-tier tasks is briefed at the full-read ladder

- **GIVEN** a lane of tier-2 tasks assembled with the solo flag on change `add-widget`
- **WHEN** the assembler renders it
- **THEN** the heading names `add-widget` and the task count and states that this agent owns the whole change including its test tasks
- **AND** the prompt states the full-read context ladder and omits the tier 1–2 stop-on-green instruction
- **AND** the same lane assembled without the solo flag renders the ordinary multi-task prompt at tier 2
