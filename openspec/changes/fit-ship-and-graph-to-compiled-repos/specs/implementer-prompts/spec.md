## MODIFIED Requirements

### Requirement: Assembled implementer prompt is deterministic

Given a change name and a lane — an ordered, non-empty list of tasks each carrying `id`, `description` and `tier` — the system MUST assemble a single implementer prompt that includes every task's identity in execution order, the documented context ladder for the lane's tier, the implement-only / no-commit / schema-only rules, graph-then-grep locate rules, and the tier 1–2 stop-on-green instruction when the lane's tier is 1 or 2. The lane's tier MUST be the highest tier among its tasks. A multi-task lane MUST instruct the agent to complete its tasks in the given order, to report an outcome for every task, and to stop at the first task it cannot complete rather than skipping ahead. The multi-task heading MUST state only what is true of every multi-task lane — that the tasks are one lane run by this agent alone and that no other agent touches the files they claim while it works — and MUST NOT claim the tasks share files. A lane assembled with the solo flag MUST be briefed as the whole change: the heading names the change and the task count, states that this agent owns every listed task including the test tasks, and the context ladder stated is the full-read ladder regardless of the hardest task's tier. A lane of exactly one task MUST assemble to the same text as the single-task form, byte for byte, so that a lane of one is never a differently-worded run. The same inputs MUST produce the same prompt text.

#### Scenario: Tier 1 omits artifact reads and stops on green

- **WHEN** the assembler is asked for a lane holding only tier 1 task `1.1` on change `add-widget`
- **THEN** the prompt names task `1.1`, states that tier 1 reads the task description alone, includes the stop-after-typecheck/lint rule, and does not instruct the agent to read `design.md` or `specs/` in full

#### Scenario: Tier 4 reads design and specs in full

- **WHEN** the assembler is asked for a lane holding a single tier 4 task on change `add-widget`
- **THEN** the prompt states that tier 4+ reads `design.md` and the specs in full for that change, and does not include the tier 1–2 stop-on-green instruction

#### Scenario: Happy path — a single-task lane is byte-identical to the pre-lane prompt

- **GIVEN** a lane holding exactly one task
- **WHEN** the assembler renders it
- **THEN** the assembled text matches the stored single-task snapshot exactly
- **AND** that snapshot is the text the single-task form assembles to, differing from the pre-lane wording only where a sentence every form shares was deliberately corrected

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

### Requirement: Prompt snapshots fail on silent drift

The test suite MUST snapshot the assembled implementer prompt text for each of tiers 1–4 (and tier 5 if its text differs) against fixtures in the repo, for a single-task lane and for a multi-task lane. A change to the assembled text MUST fail `npm test` until the fixture is updated deliberately. The single-task fixtures MUST change only by a deliberate edit to text that every form of the prompt shares, made to the single-task and multi-task fixtures together; they MUST NOT change as a side effect of an edit to how a lane is assembled, so that a regression reintroducing per-task divergence is caught. Snapshots MUST run in the existing Node test runner with no network, no API key, and no ACP or headless host.

A fixture is a pin on drift, not on the wording forever. A sentence the prompt states that has stopped being true is corrected in the assembler and in every fixture that carries it, in one change that says so.

#### Scenario: Cap-style pin catches a reworded ladder

- **WHEN** someone edits the tier-ladder sentences in the assembler without updating the snapshot fixture
- **THEN** `npm test` fails on the implementer-prompt snapshot assertion

#### Scenario: No ACP harness required

- **WHEN** CI runs `npm test`
- **THEN** the prompt snapshot tests pass without starting Claude Code, dsh, or any Agent Client Protocol session

#### Scenario: Failure — a change to the single-task form is caught

- **WHEN** someone edits the assembler so that a one-task lane no longer produces the single-task text
- **THEN** `npm test` fails against the single-task fixture

#### Scenario: Edge case — a multi-task lane has its own fixture

- **GIVEN** a lane holding more than one task
- **WHEN** its assembled text changes without the fixture being updated
- **THEN** `npm test` fails on the multi-task lane snapshot, separately from the single-task assertion

## ADDED Requirements

### Requirement: The briefing SHALL say truthfully what a rejected packet does

The implementer prompt MUST tell the agent that a handoff packet over the published character cap is rejected whole and is never truncated, and that the task which filed it is then recorded as having filed no usable report. It MUST NOT tell the agent that such a packet fails its task. It MUST cite the cap as what `interlock limits` publishes and MUST NOT state the cap as a number.

A briefing is the whole of what a fresh agent knows about the run it is in. A sentence in it that describes a consequence the run no longer applies is an instruction nobody can check, read by every implementer in every run.

#### Scenario: Happy path — the briefing states the consequence the run applies

- **WHEN** the assembler renders a single-task lane, a multi-task lane and a solo lane
- **THEN** each prompt says an over-cap packet is rejected whole, is never truncated, and leaves the task recorded as having filed no usable report

#### Scenario: Failure — the retired consequence is not stated

- **WHEN** the assembler renders any lane
- **THEN** the prompt does not say that a packet over the cap fails the task

#### Scenario: Edge case — the cap is cited, never restated

- **WHEN** the assembler renders any lane
- **THEN** the prompt names `interlock limits` as where the cap is published
- **AND** the prompt does not contain the cap's value as a number
