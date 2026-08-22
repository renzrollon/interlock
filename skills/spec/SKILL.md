---
name: spec
description: Take a rough intent to a reviewed, implementation-ready OpenSpec change — explore first, generate proposal, design, tasks and delta specs via the OpenSpec CLI, then gate them through an artifact review. Stops at the human checkpoint, having written nothing but specs. Use when starting a new feature, refactor, or bug fix.
license: MIT
compatibility: Requires the openspec CLI. Node.js >= 18 for the bundled interlock and interlock-graph CLIs.
argument-hint: "[what you want to build] [--no-explore] [--brief <path>] [--continue] [--force-checkpoint]"
allowed-tools: Bash(openspec *) Bash(interlock *) Bash(interlock-graph *) Read Write Glob Grep AskUserQuestion
metadata:
  type: planning
  outputs:
    - openspec/changes/<name>/proposal.md
    - openspec/changes/<name>/design.md
    - openspec/changes/<name>/tasks.md
    - openspec/changes/<name>/decisions.md
    - openspec/changes/<name>/specs/**
---

Turn an intent into a reviewed change that is ready to implement — and then **stop**.

This skill writes specifications. It does not write code. By default it does not run `/interlock:ship` either: the gap between this skill and that one is the deliberate human checkpoint, because a spec is the cheapest place to catch a wrong idea, so that is where a person looks. `--continue` is an opt-in that trades that read for speed on changes a machine can prove are narrow — if passed, Read `${CLAUDE_SKILL_DIR}/continuity.md`. Without the flag, nothing here bridges the gap.

**This skill composes stock OpenSpec rather than replacing it.** Artifact scaffolding, ordering, templates and validation all come from the `openspec` CLI, which is the stable contract. What this adds is the discipline around it: evidence gates, explore handoff, invariant sweeps, a decision ledger, and a review before anyone writes code.

| Flag | Effect |
|------|--------|
| `--no-explore` | Skip the explore phase (intent is already sharp, or a brief exists) |
| `--brief <path>` | Use this explore brief; skip brief matching |
| `--continue` | Advanced. After a clean artifact review, Read `${CLAUDE_SKILL_DIR}/continuity.md` — ask `interlock ready` whether the checkpoint may be skipped, and ship if it says yes |
| `--continue --force-checkpoint` | Opt back out mid-flight. Always stops at the checkpoint, whatever readiness would have said |

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

No matching brief is fine — but if none exists and `--no-explore` was not passed, **run `/interlock:explore --autonomous` now** and require a decision-oriented brief: conclusions, a recommended direction, options with a winner, assumptions, pending clarifications, and only cited `file:line` spans. Do not ask for an inventory of every file touched. Use the brief it writes. A spec built on unexplored ground is the most expensive kind to get wrong.

### 1c. Check the ground is current

```bash
interlock drift --json
```

**Never blocks, never branches.** It exits 0 whatever it finds; read it and move on.

Two findings matter before exploring, because both mean `openspec/specs/` describes something other than the code you are about to spec against:

- **`unarchived`** — changes that finished but were never archived, so the living specs never received their deltas. Name them and the command (`openspec archive <name>`).
- **`stale.broken`** — a living spec cites a file that no longer exists. Evidence, not inference, and worth one line even when it looks unrelated: a spec pointing at a deleted file is the clearest sign the area you are about to spec has already moved.

Then continue. Do not stop, do not ask, and do not archive on the user's behalf: archiving rewrites the living specs, which is a decision that belongs to whoever merged the change.

`stale.aging` is inferred from dates and rarely worth interrupting a spec run for — mention it only if it names a spec directly relevant to this change. Orphan detection needs a diff, which this skill does not have; ignore that field here.

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
openspec instructions <artifact-id> --change "<name>" --json | python3 -c '
import json,sys
d=json.load(sys.stdin)
keep=("instruction","template","resolvedOutputPath","context","rules")
print(json.dumps({k:d[k] for k in keep if d.get(k)}, separators=(",",":")))
'
```

Filter each ready artifact independently; do not dump the full instructions response or prefetch every artifact. The compact response carries `instruction` (schema guidance), `template` (the structure to fill), `resolvedOutputPath`, and non-empty `context` / `rules`.

- Read completed dependency artifacts before writing a new one.
- Write to `resolvedOutputPath`, using `template` as the structure.
- **`context` and `rules` constrain you; they are not content.** Never copy `<context>`, `<rules>` or `<project_context>` blocks into the artifact.
- Re-run `openspec status --change "<name>" --json` after each write; stop when every `applyRequires` artifact is `done`.

### Gates while generating

- **Invariant sweep.** If the change touches a shared or derived value, `tasks.md` must include a task per consumer. Use `interlock-graph consumers <symbol>` for the structural pass, then grep for string-keyed readers. See `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`.
- **Pinned versions.** If the design names a dependency without a version, ask for it. **Do not gap-fill a version number** — a plausible-looking wrong pin is worse than an open question.
- **Genuine ambiguity.** Ask when it blocks a correct proposal. Otherwise take a reasonable default to keep momentum. Either way, write the row — see below.

### 3a. The decision ledger

Write `openspec/changes/<name>/decisions.md`. The format, the two classes, and what makes a row invalid are the contract in `${CLAUDE_PLUGIN_ROOT}/shared/DECISION-LEDGER.md` — read it and follow it; do not restate it here or invent a third class.

What this skill owes the ledger:

1. **Every ambiguity that surfaces mid-flight becomes a row, before it is acted on.** Never resolve an ambiguity silently in the design prose. A decision that exists only in chat does not exist.
2. **Carry forward what explore wrote.** Transcribe the rows from the brief's `Pending Clarifications` and `Assumptions Made` — ids, questions and classes as explore assigned them — as the first write to this file. Do not start a fresh ledger and do not renumber.
3. **`agent_resolved` is a claim, and `interlock ledger` audits all three parts of it.** It requires a written resolution, evidence a reader can follow, *and* the row's id appearing in `design.md`. Each is checked: an empty resolution, an empty evidence cell, a hedge that asserts nothing (`obvious`, `standard practice`, `see above` — the whole cell, not a word inside a real citation), or an id `design.md` never mentions all make the row invalid, and an invalid row blocks exactly like `needs_human`. A missing `design.md` makes every reference unresolvable rather than resolving all of them.
4. **When in doubt, `needs_human`.** A wrong `agent_resolved` ships an unreviewed product decision; a needless `needs_human` costs one question.

Check the file rather than trusting that you wrote it well:

```bash
interlock ledger "<name>"
```

It exits non-zero when the ledger blocks — a `needs_human` row remains, a row is invalid, or **the ledger is missing entirely**. An absent `decisions.md` is a failure of the audit, not an empty result: "no rows" reads as "nothing needs a human", which is the one conclusion a file that was never written cannot support. The output distinguishes *missing* from *present and empty* from *unparseable*.

A blocking ledger with rows in it is not a failure of this skill: an honest blocking ledger is the correct output for a change that hit a real product question. It is only a failure if the questions never got written down.

---

## 4. Validate

```bash
openspec validate
interlock validate "<name>"
```

`openspec validate` checks schema conformance. `interlock validate` checks the flow's own preconditions — all three artifacts present and non-empty, `tasks.md` actually containing checkbox tasks — and exits non-zero when the change is not implementable. Fix anything it reports before continuing.

---

## 5. Gate: artifact review

Run `/interlock:review-artifacts` against the change.

- **Blockers → HALT.** Report them and stop. Do not proceed to ship, and do not "fix and continue" silently: a blocker at this gate means the spec was wrong, and the user should see that.
- **Clean → record it and stop at the checkpoint.**

```bash
# blockers found
interlock autonomy record review-artifacts --blockers <n>
# clean
interlock autonomy clean review-artifacts explore spec
```

A clean gate credits `explore` and `spec` too; a blocker resets them. That is what stops this skill earning autonomy by emitting shallow specs — the downstream gate blames whoever produced the bad artifact.

**Keep the blocker and warning counts.** Continuity needs them, and it will not accept a review it cannot see.

---

## 6. Hand off to the human

This is where the default run ends. Close with:

- Change name and artifact paths
- What the change does, in two or three lines
- Assumptions made and any pending clarifications
- Task count, and the wave shape if it is obvious
- Anything the artifact review flagged below blocker severity

Then say plainly: **review the spec, and run `/interlock:ship` when it looks right.**

If the user passed `--continue`, Read `${CLAUDE_SKILL_DIR}/continuity.md` and follow it. Do not print a spec `GOAL MET` line on that path — if readiness launches ship, `finish()` prints `GOAL MET: interlock ship`.

Without `--continue`, the run ended here. Print this greppable line so a session `/goal` can stop instead of wandering into implementation:

`GOAL MET: interlock spec stopped at the checkpoint.`

Do not run ship. Do not offer to "just start on the first task". The checkpoint is the point. Do not call `/goal` from this skill — a `/goal` does not skip the checkpoint and does not start ship. Continuity's only opt-in skip is `--continue` plus `interlock ready`.
