---
name: spec
description: Take a rough intent to a reviewed, implementation-ready OpenSpec change — explore first, generate proposal, design, tasks and delta specs via the OpenSpec CLI, then gate them through an artifact review. Stops at the human checkpoint, having written nothing but specs. Use when starting a new feature, refactor, or bug fix.
license: MIT
compatibility: Requires the openspec CLI. Node.js >= 18 for the bundled specflow and specflow-graph CLIs.
argument-hint: "[what you want to build] [--no-explore] [--brief <path>]"
allowed-tools: Bash(openspec *) Bash(specflow *) Bash(specflow-graph *) Read Write Glob Grep
metadata:
  type: planning
  autonomy_level: L2
  outputs:
    - openspec/changes/<name>/proposal.md
    - openspec/changes/<name>/design.md
    - openspec/changes/<name>/tasks.md
    - openspec/changes/<name>/specs/**
---

Turn an intent into a reviewed change that is ready to implement — and then **stop**.

This skill writes specifications. It does not write code, and it does not run `/specflow:ship`. The gap between this skill and that one is the deliberate human checkpoint: a spec is the cheapest place to catch a wrong idea, so that is where a person looks.

**This skill composes stock OpenSpec rather than replacing it.** Artifact scaffolding, ordering, templates and validation all come from the `openspec` CLI, which is the stable contract. What this adds is the discipline around it: evidence gates, explore handoff, invariant sweeps, and a review before anyone writes code.

| Flag | Effect |
|------|--------|
| `--no-explore` | Skip the explore phase (intent is already sharp, or a brief exists) |
| `--brief <path>` | Use this explore brief; skip brief matching |

---

## 1. Establish intent

If the request is not clear enough to name a change, ask — open-ended, no preset options:

> "What change do you want to work on? Describe what you want to build or fix."

Derive a kebab-case name from the answer ("add user authentication" → `add-user-auth`). **Do not proceed without understanding what the user wants.**

### 1a. Classify: feature or bug fix

**bug-fix** when the request matches `fix`, `regression`, `broken`, `crash`, `500`, `error`, `hang`, `leak`, a stack trace, or an issue reference. **feature** otherwise.

**If bug-fix, gate the proposal on evidence.** Before creating any artifact, require both:

1. **Real log output or error message** — pasted, or a path to it.
2. **A reproduction** — a failing test path, or a command that triggers the bug.

Do not run `openspec new change` until both exist. If the user pushes back: *"A repro is required so the fix has a pass/fail signal — without it we're fixing a symptom."*

A bug-fix `tasks.md` must:
- Land the failing repro test as its **first** task.
- Constrain later tasks to the root cause only. No opportunistic renames, refactors or tidy-ups — those are a separate change.
- **"Root cause only" excludes unrelated cleanup. It does not exclude other readers of the same invariant.** If the root cause is a shared or transformed value — a normalized identity, a cache or dedup key, a canonicalized field — then every consumer still reading the raw form is part of this fix. Enumerate them per `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md` and give each a task. Fixing one call site and leaving its siblings on the raw form is exactly how the original bug survives its own fix.

### 1b. Load the explore brief

Prefer a durable handoff over re-deriving discovery from chat. See `${CLAUDE_PLUGIN_ROOT}/shared/EXPLORE-BRIEF.md`.

1. `--brief <path>` given → read that file, skip matching.
2. Otherwise: `ls -t .claude/handoff/explore-*.md 2>/dev/null | head -5`
3. Pick the newest brief whose `## Meta` topic, slug, or `suggested_change_name` overlaps the request (or the newest one if only a single recent brief exists and the topic is vague).
4. **Read the matched brief first.** Prefer its recommendations over re-exploring; reopen code only for gaps or contradictions.
5. From `## Pending Clarifications`, ask only what genuinely blocks a correct proposal. Skip anything already covered by `## Assumptions Made` that the user does not contest.
6. If `suggested_change_name` is set and the user gave no name, use it.

No matching brief is fine — but if none exists and `--no-explore` was not passed, **run `/specflow:explore --autonomous` now** and use the brief it writes. A spec built on unexplored ground is the most expensive kind to get wrong.

---

## 2. Create the change

```bash
openspec new change "<name>"
```

If a change with that name already exists, ask whether to continue it or start a new one.

---

## 3. Generate artifacts, CLI-driven

```bash
openspec status --change "<name>" --json
```

Parse `applyRequires` (artifacts needed before implementation), `artifacts` (each with status and dependencies), and the path context — `planningHome`, `changeRoot`, `artifactPaths`, `actionContext`. **Use those paths; never assume repo-relative locations.**

Then loop, in dependency order, over every artifact that is `ready`:

```bash
openspec instructions <artifact-id> --change "<name>" --json
```

The response carries `context` (project background), `rules` (artifact-specific constraints), `template` (the structure to fill), `instruction` (schema guidance), `resolvedOutputPath`, and `dependencies`.

- Read completed dependency artifacts before writing a new one.
- Write to `resolvedOutputPath`, using `template` as the structure.
- **`context` and `rules` constrain you; they are not content.** Never copy `<context>`, `<rules>` or `<project_context>` blocks into the artifact.
- Re-run `openspec status --change "<name>" --json` after each write; stop when every `applyRequires` artifact is `done`.

### Gates while generating

- **Invariant sweep.** If the change touches a shared or derived value, `tasks.md` must include a task per consumer. Use `specflow-graph consumers <symbol>` for the structural pass, then grep for string-keyed readers. See `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`.
- **Pinned versions.** If the design names a dependency without a version, ask for it. **Do not gap-fill a version number** — a plausible-looking wrong pin is worse than an open question.
- **Genuine ambiguity.** Ask. Otherwise make a reasonable decision and record it, to keep momentum.

---

## 4. Validate

```bash
openspec validate
specflow validate "<name>"
```

`openspec validate` checks schema conformance. `specflow validate` checks the flow's own preconditions — all three artifacts present and non-empty, `tasks.md` actually containing checkbox tasks — and exits non-zero when the change is not implementable. Fix anything it reports before continuing.

---

## 5. Gate: artifact review

Run `/specflow:review-artifacts` against the change.

- **Blockers → HALT.** Report them and stop. Do not proceed to ship, and do not "fix and continue" silently: a blocker at this gate means the spec was wrong, and the user should see that.
- **Clean → record it and stop at the checkpoint.**

```bash
# blockers found
specflow autonomy record review-artifacts --blockers <n>
# clean
specflow autonomy clean review-artifacts explore spec
```

A clean gate credits `explore` and `spec` too; a blocker resets them. That is what stops this skill earning autonomy by emitting shallow specs — the downstream gate blames whoever produced the bad artifact.

---

## 6. Hand off to the human

Close with:

- Change name and artifact paths
- What the change does, in two or three lines
- Assumptions made and any pending clarifications
- Task count, and the wave shape if it is obvious
- Anything the artifact review flagged below blocker severity

Then say plainly: **review the spec, and run `/specflow:ship` when it looks right.**

Do not run ship. Do not offer to "just start on the first task". The checkpoint is the point.
