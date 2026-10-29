---
name: review-artifacts
description: Review OpenSpec change artifacts before anyone writes code — architecture quality and design completeness, then spec completeness and testability. Catches a wrong idea at the cheapest possible moment. Use after generating proposal, design, tasks and delta specs, and before implementing.
license: MIT
compatibility: Requires the openspec CLI. Node.js >= 18 for the bundled interlock CLI.
argument-hint: "[change-name] [--strict] [--since <findings file>]"
allowed-tools: Bash(interlock *) Bash(openspec *) Bash(git diff *) Bash(git status *) Read Glob Grep Agent
metadata:
  type: review
  outputs:
    - .claude/metrics/review-artifacts-<change>-<timestamp>.json
---

Review the change artifacts before implementation. This is the highest-leverage gate in the whole flow: a blocker caught here costs a paragraph, the same blocker caught after ship costs a day.

Resolve the change:

```bash
interlock validate [change-name] --json
```

An output carrying `error` and `candidates` instead of `ready` means the name did not resolve; `problems` is the list the change must clear. If the name did not resolve, pick the change the user named. If they named none and several are active, review the most recently modified and **say which one you picked** — this skill runs inside automated chains where a question would stall the flow.

Read all of `proposal.md`, `specs/**/*.md`, `design.md`, `tasks.md`, and `decisions.md` when it exists. A `needs_human` row there is a question held for the person, not a finding; an `agent_resolved` row is a claim, and its resolution is checked against `design.md`.

Detect the stack from the artifacts and the dependency manifest, and skip framework-specific checks that do not apply. Do not ask a Go service about accessibility requirements.

## Depth

`--strict` asks for an independent read: one reviewer, who has not seen how the artifacts were written, reads them in place of the session. Without it the session reviews the artifacts itself and spawns nothing. This skill never names the default depth or a model or an effort level; the CLI publishes them. Do not add `--strict` because the change looks large.

Run the routing lookup once, before the review:

```bash
interlock routing artifact-reviewer --json
```

Under `--strict` run the same line with the depth:

```bash
interlock routing artifact-reviewer --depth strict --json
```

Print every line of `banners` verbatim, then print `GATE DEPTH: <depth>` from the answer's `depth`. When the command exits non-zero, print `ROUTING UNAVAILABLE: <first line of its output>` and continue: under `--strict` print `GATE DEPTH: strict` and spawn the reviewer at the session defaults (no `model` or `effort` on the call); without it the session performs the inline read and prints no depth line. Routing is a cost hint, never a gate; a failed lookup does not stop the review.

At a depth other than `strict`, perform the review below in the session (Reviewer 1, Reviewer 2 and the Invariant check) and go to **Emit structured findings**.

At `strict`, make exactly one Agent call, passing the answer's `model` and `effort` (a `null` means omit that parameter), and do no review of your own beside the reviewer's. The prompt is, verbatim:

- the Reviewer 1, Reviewer 2 and Invariant check sections below, as this file carries them, and the scoped re-gate section too when `--since` was passed;
- the artifact paths `interlock validate` resolved, and the stack note from your detection above;
- the emit shape from **Emit structured findings** below;
- the instruction that the reviewer may read files and run read-only checks, writes no file, and replies with one JSON object in the emit shape and nothing else.

Add no rubric of your own to that prompt: the two depths differ in who reads, not in what is asked.

Read the reply for a JSON object holding a `findings` array. When it holds none, print `STRICT REVIEW UNREAD: <first line of the reply>` and perform the inline read in the session instead, so the gate still runs once. Otherwise the reviewer's findings are the gate's input.

At both depths the session writes the findings file, from the findings as returned, and runs the gate line itself. Repair no finding and drop none: a malformed one is the gate's to report under `malformed`. The reviewer writes nothing. A skill's `allowed-tools` do not reach an agent it spawns, and this Agent call names no `subagent_type`, so the prompt's writes-no-file line is the bound.

---

## A scoped re-gate: `--since <findings file>`

Without `--since` the gate reads the whole change, once. With it, the gate judges the fix rather than the whole change again, so a re-gate costs a fraction of a review and converges:

1. **Re-check each earlier blocker** in the findings file against the revised artifacts. Report each under its own title as cleared, naming the passage that now answers it, or as still open.
2. **Read only what changed since that file was written.** For a tracked change, the hunks that differ from the commit the earlier gate read (the working tree against `HEAD` when nothing was committed since):

   ```bash
   git diff -- openspec/changes/<change>/
   ```

   For a file `git status --short -- openspec/changes/<change>/` lists as untracked, the whole file. Raise a new finding only in a changed hunk or an untracked file. An unchanged passage the earlier review did not flag is not reopened.
3. **Emit and gate as below**, with the still-open blockers and the new findings in one file. A cleared blocker is left out.

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
- **Same-file staircase.** Do consecutive checkboxes name the same production path — one per TDD beat, comment move or trap? That is one checkbox, not five. Report it as a warning naming the repeated path. It is not a ship halt: `planWaves` folds the resulting 1-task waves back together, so the cost is implementer count and lost parallelism, not checkpoints.
- Does each numbered section hold work that could share a wave? Independent files belong in one section; a new section is only an output-exists boundary.

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

**What a blocker is.** A blocker means that implementing the artifacts as written would fail its own verification or ship a defect: a task whose test cannot pass, a scenario the design contradicts, a consumer the invariant sweep missed. Everything else is a warning or a suggestion. An incomplete list of the existing test pins a change breaks is never a blocker when `tasks.md` states the bounded pin rule (the spec skill's "Where the tests go": a pin found later is updated in the task that changes its meaning, never during remediation, and reported with the requirement). Nobody can enumerate every pin before the code exists, so a finding that asks for a list nobody can write yet is a warning.

---

## Emit structured findings

Write `.claude/metrics/review-artifacts-<change>-<YYYYMMDD-HHMMSS>.json` in this shape:

```json
{ "dimension": "artifacts",
  "findings": [
    { "severity": "blocker|warning|suggestion",
      "file": "path/to/artifact.md", "line": 42,
      "title": "short claim",
      "description": "what is wrong and why",
      "suggestion": "how to fix it" }
  ] }
```

`severity`, `file`, `title` and `description` are required; `line` and `suggestion` are optional. Map BLOCKER→`blocker`, WARNING→`warning`, SUGGESTION→`suggestion`. Create `.claude/metrics/` if it does not exist. This is the complete emit contract — do not read `lib/findings.mjs` to rediscover it.

Then let the deterministic gate decide, rather than deciding in prose:

```bash
interlock gate --findings .claude/metrics/review-artifacts-<change>-<ts>.json --metrics <change> --json
```

The gate blocks if and only if at least one finding is a `blocker`. Its exit status is the verdict: non-zero means blocked. Do not re-derive the verdict in prose. In the JSON, `passed` is that same verdict; report the entries of `blockers` and `malformed`, read `metrics.written` and `metrics.reason` for whether the record landed, and hand `autonomyOutcome.blockers` on as the blocker count the spec skill passes to `interlock autonomy record`.

`--metrics <change>` is not optional decoration. It writes the four counts this gate produced — raised, dismissed, dropped by the quality band, surviving — to `.claude/metrics/` in the schema `interlock report` recognizes. Drop it and this review path becomes invisible to the report forever: the review-finding indicators read `unobserved` no matter how many gates ran. It is bookkeeping only and cannot change the verdict or the exit status.
