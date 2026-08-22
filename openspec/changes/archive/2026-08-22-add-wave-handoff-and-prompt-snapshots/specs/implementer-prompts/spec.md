## Purpose

Treats the assembled implementer prompt as a frozen contract so silent tier-ladder or stop-rule drift is caught by the same test stack that already pins `interlock limits`.

## ADDED Requirements

### Requirement: Assembled implementer prompt is deterministic

Given a change name and a task (`id`, `description`, `tier`), the system MUST assemble a single implementer prompt that includes the task identity, the documented context ladder for that tier, the implement-only / no-commit / schema-only rules, graph-then-grep locate rules, and the tier 1–2 stop-on-green instruction when the tier is 1 or 2. The same inputs MUST produce the same prompt text.

#### Scenario: Tier 1 omits artifact reads and stops on green

- **WHEN** the assembler is asked for tier 1 task `1.1` on change `add-widget`
- **THEN** the prompt names task `1.1`, states that tier 1 reads the task description alone, includes the stop-after-typecheck/lint rule, and does not instruct the agent to read `design.md` or `specs/` in full

#### Scenario: Tier 4 reads design and specs in full

- **WHEN** the assembler is asked for a tier 4 task on change `add-widget`
- **THEN** the prompt states that tier 4+ reads `design.md` and the specs in full for that change, and does not include the tier 1–2 stop-on-green instruction

### Requirement: Prompt snapshots fail on silent drift

The test suite MUST snapshot the assembled implementer prompt text for each of tiers 1–4 (and tier 5 if its text differs) against fixtures in the repo. A change to the assembled text MUST fail `npm test` until the fixture is updated deliberately. Snapshots MUST run in the existing Node test runner with no network, no API key, and no ACP or headless host.

#### Scenario: Cap-style pin catches a reworded ladder

- **WHEN** someone edits the tier-ladder sentences in the assembler without updating the snapshot fixture
- **THEN** `npm test` fails on the implementer-prompt snapshot assertion

#### Scenario: No ACP harness required

- **WHEN** CI runs `npm test`
- **THEN** the prompt snapshot tests pass without starting Claude Code, dsh, or any Agent Client Protocol session
