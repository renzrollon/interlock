## Purpose

Makes the packet a fresh wave implementer is handed a schema-validated, size-bounded report from the previous wave — not a reconstruction from git and mutable wave-state.

## ADDED Requirements

### Requirement: Per-task handoff is a fixed schema

Every implementer result MUST include a handoff object with `schema`, `taskId`, `status` (`ok`, `blocked`, or `partial`), `summary`, `evidence` (array of strings), `next`, and `blocker` (string or null). `status=ok` MUST have a null `blocker`. `status=blocked` MUST have a non-empty `blocker`. `evidence` entries MUST be locators (`path` or `path:line` / `path:start-end`), not pasted file bodies. This packet is distinct from the opt-in `--handoff` artifacts (`manual-test-plan.md`, `code-explanation.md`, memory).

#### Scenario: Successful task reports ok with no blocker

- **WHEN** a task completes and returns `ok:true` with a handoff `{ status: "ok", blocker: null, summary, evidence, next }`
- **THEN** `interlock wave-state record-batch` accepts the task as succeeded and stores the packet on the run

#### Scenario: Blocked task requires a blocker string

- **WHEN** a task returns `status: "blocked"` with `blocker` missing or empty
- **THEN** `record-batch` treats that task as failed with an invalid-handoff reason, even if `ok` was true

### Requirement: Invalid or oversized packets fail closed

The total character count of `summary`, `next`, `blocker`, and joined `evidence` MUST NOT exceed the `maxHandoffChars` cap published by `interlock limits`. Missing handoff, unknown `status`, extra required-field types, or over-budget text MUST fail that task (`ok:false`) rather than passing prose through for the next wave to interpret. The cap MUST live in the limits CLI, not in workflow prompt text.

#### Scenario: Over-budget summary fails the task

- **WHEN** a task returns a valid-shaped handoff whose counted characters exceed `maxHandoffChars`
- **THEN** `record-batch` records the task as failed with an over-budget reason and does not store the packet as a wave handoff

#### Scenario: Limits names the cap

- **WHEN** an operator runs `interlock limits`
- **THEN** the output includes the per-task handoff character cap as an integer

### Requirement: Next wave is handed validated packets, not git inference

When the state machine asks for the next `run-batch` or `test-wave` after a prior implementation wave, the step payload MUST include the stored handoff packets from the **immediately previous wave only**. Each implementer prompt for that batch MUST include those packets as structured text and MUST NOT instruct the agent to reconstruct the previous wave from `git log` / `git status` as a substitute for the packet. Fresh-agent isolation is unchanged: one agent per task, no orchestrator-context implementation.

#### Scenario: Wave 2 sees wave 1 packets

- **WHEN** wave 1's tasks recorded valid handoffs and `wave-state next` asks to run wave 2
- **THEN** the step includes those handoff objects, and each wave 2 implementer prompt contains their `status`, `summary`, `evidence`, `next`, and `blocker` fields

#### Scenario: Wave 3 does not accumulate wave 1

- **WHEN** wave 3 starts after wave 2 completed
- **THEN** the injected packets are wave 2's only — wave 1's packets are not appended

#### Scenario: Remaining batches of a wave share the previous wave, not each other

- **WHEN** wave 2 has three path-serialized batches and `wave-state next` is at batch 0
- **THEN** `previousHandoffs` is wave 1's packets on that step, every remaining batch's implementer prompt receives those same packets, and batch 1 does not receive batch 0's handoff
