---
name: spec
description: Take a rough intent to a reviewed, implementation-ready OpenSpec change — explore first, generate proposal, design, tasks and delta specs via the OpenSpec CLI, then gate them through an artifact review. Stops at the human checkpoint, having written nothing but specs. Use when starting a new feature, refactor, or bug fix.
license: MIT
compatibility: Requires the openspec CLI. Node.js >= 18 for the bundled interlock and interlock-graph CLIs.
argument-hint: "[what you want to build] [--no-explore] [--brief <path>] [--continue] [--force-checkpoint]"
allowed-tools: Bash(openspec *) Bash(interlock *) Bash(interlock-graph *) Read Write Glob Grep AskUserQuestion
metadata:
  type: planning
  autonomy_level: L2
  outputs:
    - openspec/changes/<name>/proposal.md
    - openspec/changes/<name>/design.md
    - openspec/changes/<name>/tasks.md
    - openspec/changes/<name>/decisions.md
    - openspec/changes/<name>/specs/**
---

Turn an intent into a reviewed change that is ready to implement — and then **stop**.

This skill writes specifications. It does not write code. By default it does not run `/interlock:ship` either: the gap between this skill and that one is the deliberate human checkpoint, because a spec is the cheapest place to catch a wrong idea, so that is where a person looks. `--continue` is an opt-in that trades that read for speed on changes a machine can prove are narrow — see §7. Without the flag, nothing here bridges the gap.

**This skill composes stock OpenSpec rather than replacing it.** Artifact scaffolding, ordering, templates and validation all come from the `openspec` CLI, which is the stable contract. What this adds is the discipline around it: evidence gates, explore handoff, invariant sweeps, a decision ledger, and a review before anyone writes code.

| Flag | Effect |
|------|--------|
| `--no-explore` | Skip the explore phase (intent is already sharp, or a brief exists) |
| `--brief <path>` | Use this explore brief; skip brief matching |
| `--continue` | Advanced. After a clean artifact review, ask `interlock ready` whether the checkpoint may be skipped — and ship if it says yes (§7) |
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

No matching brief is fine — but if none exists and `--no-explore` was not passed, **run `/interlock:explore --autonomous` now** and use the brief it writes. A spec built on unexplored ground is the most expensive kind to get wrong.

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

- **Invariant sweep.** If the change touches a shared or derived value, `tasks.md` must include a task per consumer. Use `interlock-graph consumers <symbol>` for the structural pass, then grep for string-keyed readers. See `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`.
- **Pinned versions.** If the design names a dependency without a version, ask for it. **Do not gap-fill a version number** — a plausible-looking wrong pin is worse than an open question.
- **Genuine ambiguity.** Ask when it blocks a correct proposal. Otherwise take a reasonable default to keep momentum. Either way, write the row — see below.

### 3a. The decision ledger

Write `openspec/changes/<name>/decisions.md`. The format, the two classes, and what makes a row invalid are the contract in `${CLAUDE_PLUGIN_ROOT}/shared/DECISION-LEDGER.md` — read it and follow it; do not restate it here or invent a third class.

What this skill owes the ledger:

1. **Every ambiguity that surfaces mid-flight becomes a row, before it is acted on.** Never resolve an ambiguity silently in the design prose. A decision that exists only in chat does not exist.
2. **Carry forward what explore wrote.** Transcribe the rows from the brief's `Pending Clarifications` and `Assumptions Made` — ids, questions and classes as explore assigned them — as the first write to this file. Do not start a fresh ledger and do not renumber.
3. **`agent_resolved` is a claim, and it is audited.** It requires a written resolution *and* evidence a reader can follow, *and* the assumption must also appear in `design.md`, referenced by its id. A row that says `agent_resolved` with an empty resolution or empty evidence is treated as blocking, exactly like `needs_human`.
4. **When in doubt, `needs_human`.** A wrong `agent_resolved` ships an unreviewed product decision; a needless `needs_human` costs one question.

Check the file rather than trusting that you wrote it well:

```bash
interlock ledger "<name>"
```

It exits non-zero when the ledger blocks — a `needs_human` row remains, or a row is invalid. That is not a failure of this skill: an honest blocking ledger is the correct output for a change that hit a real product question. It is only a failure if the questions never got written down.

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

**Keep the blocker and warning counts.** §7 needs them, and it will not accept a review it cannot see.

---

## 6. Hand off to the human

This is where the default run ends. Close with:

- Change name and artifact paths
- What the change does, in two or three lines
- Assumptions made and any pending clarifications
- Task count, and the wave shape if it is obvious
- Anything the artifact review flagged below blocker severity

Then say plainly: **review the spec, and run `/interlock:ship` when it looks right.**

Do not run ship. Do not offer to "just start on the first task". The checkpoint is the point.

---

## 7. `--continue` — the continuity path

Only when the user passed `--continue`. Without it, the run ended at §6.

Continuity does not decide anything itself. It asks one machine one question — *may this change skip the human read?* — and obeys the answer. The judgement is `interlock ready`, which is code; this section is only the wiring.

**If `--force-checkpoint` was also passed, stop at §6 now.** Do not run readiness. The user opted back out, and the flag exists precisely so that changing your mind costs nothing.

### 7a. Ask

Write the artifact review result where the gate can read it — the counts from §5, not the review's findings file:

```bash
mkdir -p .claude/ready
printf '{"blockers": <n>, "warnings": <n>}\n' > .claude/ready/<name>-review.json
```

Then ask:

```bash
interlock ready "<name>" --review .claude/ready/<name>-review.json --paths <planned paths> --json
```

`--paths` is the repo-relative paths `tasks.md` and `design.md` say this change will touch. They need not exist yet — the classifier reads planned paths. Passing none makes the blast radius unclassifiable, which fails closed to `high` and stops continuity, so pass them.

### 7b. Branch on the exit code, never on the prose

**Exit 0** (`ready: true`) — invoke `/interlock:ship`, telling it this run arrived through continuity so the outcome corpus records it as `continue` rather than `checkpoint`:

```
/interlock:ship <change-name> mode=continue
```

Say what you are doing and why it was allowed: the risk class, and that continuity was requested. Then hand over; from that point nothing can ask the user anything.

The mode matters more than it looks. The corpus exists to compare continuity runs against checkpoint runs, and a continuity run filed as a checkpoint is worse than no record — it makes the comparison say the opposite of the truth.

**Exit 1** (`ready: false`) — **do not ship.** Present *only* what blocks:

- Every `needs_human` row from the ledger — id and question.
- Every entry in the readiness `blockers[]` — the message, and its evidence line.

Nothing else. **Do not dump the spec.** The user opted out of reading it; the point is to ask them the specific questions, not to hand back the reading they declined. Offer *"open the artifacts"* as a secondary action for anyone who wants it, and name the change directory so they can.

Title it plainly: **Continuity paused — N decisions need you.** `AskUserQuestion` is available here for the ledger rows; this is not a zero-touch skill, and this is the last place a question is possible.

### 7c. After the human answers

1. Write the resolutions into `openspec/changes/<name>/decisions.md` — edit each row in place per `${CLAUDE_PLUGIN_ROOT}/shared/DECISION-LEDGER.md`: flip the class, write the answer into `resolution`, cite the human in `evidence`. Never delete a row.
2. Update `design.md` where an answer changed a decision. A resolution the design contradicts is worse than an open question.
3. Re-run the §7a command.
4. Passes → ship. Still blocked → present the remaining rows the same way. If the second run blocks on something the human cannot answer in a sentence — an artifact is not implementable, the risk class is too high — stop and route to §6. Continuity is not a loop to grind against.

### The rules that make this safe enough

- **Fail closed. Any doubt stops.** `ready` exits non-zero when a check could not run, not only when one failed — an unread ledger, an absent review, a classifier that threw are all blockers. So branch on the **exit code**. Never on parsed prose, never on your own reading of the artifacts, and never on a partial pass because most checks were green.
- **`ship` cannot ask anything.** It is a dynamic workflow, and the workflow runtime accepts no mid-run user input at all. Every interrupt therefore happens *here*, before ship starts. There is no "we will confirm that during implementation".
- **Autonomy level does not imply continuity.** They answer different questions. Do not consult the ladder here, do not mention it as a reason, and do not offer `--continue` because a path is L3.
- **Never offer `--continue` yourself.** It is opt-in, and a suggestion from the tool is not an opt-in. If the user has not asked for it, §6 is the end of the run.
- **Continuity cannot catch a wrong idea.** Readiness proves the change is *implementable*, never that it is *right*. Only a person reading the spec can do that. Say so when a continuity run starts, rather than implying a green gate means a good change.
