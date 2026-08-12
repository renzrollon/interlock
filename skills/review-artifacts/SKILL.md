---
name: review-artifacts
description: Review OpenSpec change artifacts before anyone writes code — architecture quality and design completeness, then spec completeness and testability. Catches a wrong idea at the cheapest possible moment. Use after generating proposal, design, tasks and delta specs, and before implementing.
license: MIT
compatibility: Requires the openspec CLI. Node.js >= 18 for the bundled interlock CLI.
argument-hint: "[change-name]"
allowed-tools: Bash(interlock *) Bash(openspec *) Read Glob Grep
metadata:
  type: review
  autonomy_level: L2
  outputs:
    - .claude/metrics/review-artifacts-<change>-<timestamp>.json
---

Review the change artifacts before implementation. This is the highest-leverage gate in the whole flow: a blocker caught here costs a paragraph, the same blocker caught after ship costs a day.

Resolve the change:

```bash
interlock validate [change-name] --json
```

If it reports ambiguity, pick the change the user named. If they named none and several are active, review the most recently modified and **say which one you picked** — this skill runs inside automated chains where a question would stall the flow.

Read all of `proposal.md`, `specs/**/*.md`, `design.md`, `tasks.md`.

Detect the stack from the artifacts and the dependency manifest, and skip framework-specific checks that do not apply. Do not ask a Go service about accessibility requirements.

---

## Reviewer 1 — Architecture

**Architecture quality**
- Are layer boundaries placed correctly in `design.md` for this stack?
- Does the structure follow the patterns already in this project?
- Are state and ownership decisions appropriate?
- Is the data flow clear — reads, writes, mutations, side effects?

**Design completeness**
- Does `design.md` specify an error-handling strategy?
- When UI is in scope, are accessibility requirements present?
- Is the approach consistent with the project's own architecture docs (`CLAUDE.md`, `AGENTS.md`, `docs/`)?

**Pattern fitness**
- Does the proposed structure introduce complexity it does not need?
- Is there a simpler alternative that reaches the same outcome?

---

## Reviewer 2 — QA

**Spec completeness**
- Does every requirement in `specs/` have concrete Given/When/Then scenarios?
- Are edge cases covered — empty, error, loading, boundary values, permission denied?
- Which scenarios would a real user hit that the spec does not mention?

**Testability**
- Can every scenario become an automated test?
- Are acceptance criteria specific enough to verify? "Should work properly" is not a criterion.

**Task quality**
- Does `tasks.md` pair a test task with every feature task?
- Is the ordering right — do dependencies precede dependents?
- Is each task small enough for one focused session?

**Delta spec quality**
- Are ADDED / MODIFIED / REMOVED sections used correctly?
- Do the deltas describe **behavior**, not implementation?

---

## Invariant check

If the change transforms a shared or derived value — normalizing an identity, deriving a cache or dedup key, canonicalizing a field — then `tasks.md` must contain a task for **every consumer** of that value, not just the one the change is about.

A change that updates one call site and leaves its siblings reading the raw form is a **blocker at this gate**, because it is far cheaper to add the tasks now than to discover the surviving bug after review. See `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`.

---

## Output

```
── ARCHITECTURE ────────────────────────────────
✓ [passed — brief]
⚠ WARNING: [specific issue, with file reference]
✗ BLOCKER: [critical issue]

── QA ──────────────────────────────────────────
✓ [passed — brief]
⚠ WARNING: [specific issue, with file reference]
✗ BLOCKER: [critical issue]

SUMMARY: N blockers, N warnings, N suggestions
Recommendation: [fix blockers | address warnings | proceed to /interlock:ship]
```

Be specific — name files and sections. Do not pad with generic praise. If the artifacts are genuinely good, say so briefly and recommend proceeding.

---

## Emit structured findings

Write `.claude/metrics/review-artifacts-<change>-<YYYYMMDD-HHMMSS>.json` with `dimension: "artifacts"` and a `findings` array matching the schema in `${CLAUDE_PLUGIN_ROOT}/lib/findings.mjs`. Map BLOCKER→`blocker`, WARNING→`warning`, SUGGESTION→`suggestion`. Create `.claude/metrics/` if it does not exist.

Then let the deterministic gate decide, rather than deciding in prose:

```bash
interlock gate --findings .claude/metrics/review-artifacts-<change>-<ts>.json
```

Its exit status is the gate verdict: non-zero means blocked.
