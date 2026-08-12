---
name: ship
description: Take a reviewed OpenSpec change from tasks to commit in one uninterrupted run — implement tasks in dependency-ordered waves with parallel subagents, review the diff adversarially, remediate findings, verify the test suite, emit the manual test plan, write the code explanation, capture learnings, and commit. Asks the user nothing. Use after the spec has been reviewed and approved.
license: MIT
compatibility: Requires git and the openspec CLI. Node.js >= 18 for the bundled specflow CLI.
argument-hint: "[change-name] [--apply-only] [--no-commit] [--skip-e2e]"
disable-model-invocation: true
disallowed-tools: AskUserQuestion
allowed-tools: Bash(specflow *) Bash(specflow-graph *) Bash(openspec *) Bash(git *) Read Write Edit Glob Grep
metadata:
  type: execution
  autonomy_level: L3
  outputs:
    - source files per tasks.md
    - openspec/changes/<change>/manual-test-plan.md
    - openspec/changes/<change>/code-explanation.md
    - .claude/memory/**
    - one commit
---

Take a change from "tasks written" to "committed" in a single run: wave-based parallel execution with context isolation, then review, remediation, verification, handoff artifacts, and a commit.

**This chain asks the user nothing.** `AskUserQuestion` is removed from the tool pool for the duration — the zero-touch contract is enforced by the harness, not by your good intentions. If a step would need a decision, apply the documented default and report it. The only things that stop the run are the three hard halts in the Failure policy.

**You orchestrate; you do not implement.** Context isolation is the entire point. Implementation tasks run in subagents, always. If the Agent tool is unavailable, stop and say so — never fall back to inline apply.

| Flag | Effect |
|------|--------|
| `--apply-only` | Stop after the waves |
| `--no-commit` | Run everything, stop before committing |
| `--skip-e2e` | Do not run e2e even if configured |
| `--skip-coverage` | Skip the advisory diff-coverage report |
| `--max-parallel <n>` | Override the per-batch agent cap (default 8) |

---

## 1. Load and validate

```bash
specflow validate [change-name] --json
```

Resolves the change (or reports ambiguity), confirms `proposal.md`, `design.md` and `tasks.md` exist and are non-empty, and confirms `tasks.md` has real checkbox tasks. **Exit non-zero means stop** — a change that is not implementable is not a run to attempt.

Read all of `proposal.md`, `design.md`, `tasks.md`, and `specs/**/*.md`. This is the artifact leash and it is not subject to bounded retrieval: you are about to implement against these, so read them in full.

---

## 2. Classify every incomplete task

For each unchecked task, assign a tier, a model, and a context budget:

| Task shape | Tier | Model | Context |
|---|---|---|---|
| Trivial edit, one file | 1 | haiku | ~200 tokens |
| Single-concern add/modify in one area | 2 | sonnet | ~1K |
| New logic or component, one domain | 3 | sonnet | ~3K |
| Cross-file / multi-domain following existing patterns | 4 | sonnet | ~6K |
| Novel architecture, inventing a new pattern | 5 | opus (gated) | ~10K+ |

Heuristics: "replace" / "rename" / "update reference" → tier 1–2. "add" / "create" / "implement" in one domain → tier 3. Multiple domains, handoffs, "throughout", "all references" → tier 4. A mechanical refactor across many files is **tier 4, sonnet** — breadth is not depth.

**Opus gate.** Assign `opus` only at tier 5 **and** when the task introduces a genuinely new architectural pattern, requires inventing non-obvious design across modules with unclear boundaries, or is a cross-cutting redesign where the right abstraction is ambiguous. Never for multi-file edits, keyword matches on "pattern"/"architecture"/"refactor", test tasks, or "when unsure". When unsure → sonnet.

Also assign each task a `group` (wave number — tasks in a group must be independent) and `isTestTask`.

Emit the classification as JSON and hand it to the planner:

```bash
specflow waves --classified <classified.json> --max-parallel 8
```

**The planner is authoritative.** It clamps over-eager opus assignments, orders the waves, defers test tasks to a trailing wave, and splits any wave wider than the cap into batches. Do not re-derive any of that in prose, and do not override its output. Render its plan as a record of what is about to happen, then start — there is no prompt.

---

## 3. Execute the waves

For each wave, in order; within a wave, for each batch:

- Spawn **one subagent per implementation task**, all of a batch's agents in a single turn.
- Wait for the batch, then the wave, before starting the next.
- Never implement a non-test task in the main context.

Each subagent gets, per its tier:

```
CONTEXT:
- The task description from tasks.md
- The relevant section of design.md         (tier >= 2)
- The relevant spec file                     (tier >= 3)
- Full design + specs                        (tier >= 4)

INSTRUCTIONS:
- Implement ONLY this task.
- Do not modify files outside its scope.
- Run typecheck and lint on what you changed.
- Report: files changed, what you did, anything that blocked you.
```

Wrap user-supplied strings per `${CLAUDE_PLUGIN_ROOT}/shared/CONTEXT-HYGIENE.md` before they enter a subagent prompt.

### Inter-wave verification

After each wave, before the next: run the project's fast checks — typecheck first, then tests for the modified files, then lint if it is quick. Adapt to the stack (`tsc --noEmit`, `mypy` + `pytest -x`, `go build ./... && go test ./...`, `cargo check`).

On failure: fix this wave's issues with one targeted change and re-run only the failing step. **Cap two attempts.** After that, log the unresolved errors — halt if they block the next wave, otherwise continue with a warning. Skip verification entirely when no commands are detectable, when the failures are pre-existing, or when verification exceeds ~60s (then typecheck only).

### Replan between waves

A wave's results may invalidate later waves. You may revise **only** groups that have not executed yet. Cap two replans per run.

### Test wave

Test tasks run last, as a single trailing wave, so a cross-cutting failure is diagnosed once against finished code rather than repeatedly against half-built state.

Update `tasks.md` checkboxes for completed tasks as you go. That happens in the main context, not in subagents.

---

## 4. Review the diff

Run `/specflow:review-code` against the change. It fans out the dimensions and puts two skeptics on every blocker and warning.

---

## 5. Remediate

Feed the surviving findings to the gate to get the per-file grouping:

```bash
specflow gate --findings <survivors.json> --json
```

Triage, then fan out **one fixer agent per file** using `byFile` — those groups are disjoint, so they are safe to run in parallel. Apply the `unscoped` group last, sequentially, in the main context.

**Cap two remediation rounds.** Re-review after each. A finding you deliberately choose not to fix must be recorded with its reason — deferred, not silently dropped.

---

## 6. Verify

Read `.claude/testing/profile.json` per `${CLAUDE_PLUGIN_ROOT}/shared/TEST-PROFILE.md`. Where the discovery ladder would ask a question, leave the field `null` and note it. **Never interview** — that is `/specflow:fix-tests`'s job, not yours.

Run the unit suite. On failure, repair by **root cause** — never by weakening a test, loosening an assertion, or narrowing the suite. A suite that went green by shrinking is not green. Cap five root-cause iterations across the whole run.

**A red unit suite is a hard halt.** Do not commit.

Diff coverage is advisory: run it when configured, report it, and let it block nothing. Use `specflow validate` semantics for which files are even coverable — test files, config, docs and generated output are not.

---

## 7. Handoff artifacts

```bash
specflow surface --changed <files> --json
```

If `needsManualTestPlan` is true, run `/specflow:manual-test-plan` and write `openspec/changes/<change>/manual-test-plan.md`. If it is false, skip it and say why — do not write a test plan for a backend-only change.

If an e2e suite is configured and `--skip-e2e` was not passed, run it. **Report e2e failures; never repair them.** A red e2e goes to the human and does not block the commit — e2e failures are frequently environmental, and auto-fixing them is how real regressions get papered over.

---

## 8. Explain

Run `/specflow:explain-code` in commit teach-in mode. Write `openspec/changes/<change>/code-explanation.md`.

---

## 9. Capture learnings

When a fix during self-correction, the test wave, or remediation matches a recurring pattern, write it to the memory corpus — one small file per entry under `.claude/memory/<category>/`, indexed in `.claude/memory/MEMORY.md`:

| Pattern | Category |
|---|---|
| Import path breaks after a file move | `failure-modes/` |
| Interface mismatch between modules | `coupling/` |
| Env var required for a feature or test to run | `failure-modes/` |
| Test requires a specific fixture order | `failure-modes/` |
| Two files that always change together | `coupling/` |

Max three entries per run. This is silent — no narration.

---

## 10. Commit

Run `/specflow:commit --yes`. One feature-level commit. **Never `git add -A`, never amend, never push.**

Then record the outcome:

```bash
specflow autonomy record review-code --blockers <n>
```

---

## Failure policy — the only three hard halts

1. **Unresolved blockers after two remediation rounds.**
2. **The unit suite is still red.**
3. **More than two task failures accumulated across waves.**

On a halt: report what completed, what failed, and what the human needs to decide. Do not commit. Do not ask a question — there is no one listening, and the tool is not available to you.

Everything else applies a documented default and continues, with the decision reported in the final summary.

Follow `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md`.
