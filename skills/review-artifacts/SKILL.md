---
name: review-artifacts
description: Review OpenSpec change artifacts before anyone writes code — architecture quality and design completeness, then spec completeness and testability. Catches a wrong idea at the cheapest possible moment. Use after generating proposal, design, tasks and delta specs, and before implementing.
license: MIT
compatibility: Node.js >= 18 for the bundled interlock CLI.
argument-hint: "[change-name] [--strict] [--lean] [--caller spec] [--lens <a,b>] [--since <findings file>]"
allowed-tools: Bash(interlock *) Bash(interlock-graph *) Bash(git diff *) Bash(git status *) Read Glob Grep Agent
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

**Session suggestion.** Unless another Interlock skill invoked this one, run `interlock suggest review-artifacts` once, now, and print every line it returns verbatim. If it exits non-zero, print `SESSION SUGGESTION UNAVAILABLE: <first line of its output>` and continue. It is advice and never a gate: do not change the model or the effort yourself, and do not wait for the person to.

## Depth

`--strict` asks for an independent read: one reviewer, who has not seen how the artifacts were written, reads them in place of the session. `--lean` asks for the session's own read. `--caller spec` says the spec skill is the caller, and the CLI's caller table answers its depth. Without a flag the CLI's published default answers. This skill never names the default depth or a model or an effort level; the CLI publishes them. Do not add `--strict` because the change looks large. When both `--strict` and `--lean` are given, run strict and say that you ignored `--lean`.

Run the routing lookup once, before the review. Forward `--caller spec` when it was passed, add `--depth strict` under `--strict` and `--depth lean` under `--lean`:

```bash
interlock routing artifact-reviewer [--caller spec] [--depth <strict|lean>] --json
```

Print every line of `banners` verbatim, then print `GATE DEPTH: <depth>` from the answer's `depth`. When the command exits non-zero, print `ROUTING UNAVAILABLE: <first line of its output>` and continue: under `--strict` print `GATE DEPTH: strict` and spawn the reviewer at the session defaults (no `model` or `effort` on the call); otherwise the session performs the inline read and prints no depth line. Routing is a cost hint, never a gate; a failed lookup does not stop the review.

**The brief.** Print the review brief once, before the read:

```bash
interlock review brief --artifacts <change> [--lens <a,b>] [--since <findings file>]
```

Print the opening block, every line before the first blank line, verbatim, and name the lenses it reports for the gate line. The brief carries the rubric, the lenses, the repository's policy, the living requirements and the run rules; this skill adds no rubric of its own. When the command exits non-zero, print `ARTIFACT BRIEF UNAVAILABLE: <first line of its output>` and read inline: Read `${CLAUDE_SKILL_DIR}/rubric.md` (and `${CLAUDE_SKILL_DIR}/re-gate.md` under `--since`, whose git-scoping branch applies, since no `RE-GATE:` line printed) and review the artifacts `interlock validate` resolved against it. That read uses no lens, so the gate line says `--reviewer session --lenses none`.

At a depth other than `strict`, the session reads the brief, performs the review it describes, composes the reply object its run rules name, writes the findings file from that object and goes to **Emit structured findings**.

At `strict`, make exactly one Agent call, naming `interlock:reviewer` as its `subagent_type` and passing the answer's `model` and `effort` (a `null` means omit that parameter), and do no review of your own beside the reviewer's. Routing chooses the model and the effort, never the type: after `ROUTING UNAVAILABLE` the call still names `interlock:reviewer`. The prompt is the whole brief, relayed verbatim. Add nothing of your own to it: the two depths differ in who reads, not in what is asked. The reviewer may read files and run read-only checks, writes no file, and replies with one JSON object in the emit shape and nothing else.

Read the reply for a JSON object holding a `findings` array. When it holds none, print `STRICT REVIEW UNREAD: <first line of the reply>` and perform the inline read in the session against the printed brief instead, so the gate still runs once. Otherwise the reviewer's findings are the gate's input.

When the Agent tool reports `interlock:reviewer` as an unknown type, or the spawn is refused or declined, print `STRICT REVIEWER UNAVAILABLE: <the tool's message, or the refusal>`, make no second Agent call, spawn no other type, and perform the inline read in the session against the printed brief instead, so the gate still runs once.

At every depth the session writes the findings file, from the findings as returned, and runs the gate line itself. Repair no finding and drop none: a malformed one is the gate's to report under `malformed`. The reviewer writes nothing. A skill's `allowed-tools` do not reach an agent it spawns, so the `subagent_type` is the first bound: the plugin's definition of `interlock:reviewer` bounds the reviewer's tools, and it holds no tool that edits a file, spawns an agent or invokes a skill. The shell can still write, so the prompt's writes-no-file line is the second bound.

---

## A scoped re-gate: `--since <findings file>`

Without `--since` the gate reads the whole change, once. With it, the gate judges the fix rather than the whole change again, so a re-gate costs a fraction of a review and converges. A re-gate is the person's call, never this skill's: pass `--since` through to the brief, whose re-gate rules say what to re-check and what to read.

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
· SUGGESTION: [optional improvement, with file reference]

SUMMARY: N blockers, N warnings, N suggestions
Recommendation: [fix blockers | address warnings | proceed to /interlock:ship]
```

Be specific — name files and sections. Do not pad with generic praise. If the artifacts are genuinely good, say so briefly and recommend proceeding. What a blocker is lives in the rubric the brief carries; do not restate it.

---

## Emit structured findings

Write `.claude/metrics/review-artifacts-<change>-<YYYYMMDD-HHMMSS>.json` in this shape:

```json
{ "dimension": "artifacts",
  "findings": [
    { "severity": "blocker|warning|suggestion",
      "file": "path/to/artifact.md", "line": 42, "passage": "the quoted text",
      "title": "short claim",
      "description": "what is wrong and why",
      "suggestion": "how to fix it" }
  ] }
```

`severity`, `file`, `title` and `description` are required; `line`, `passage` and `suggestion` are optional, but a blocker carries a `line` (a positive integer) or a `passage` (the quoted text). A blocker with neither is reported under `malformed`, is not counted as a blocker, and the gate does not pass. Map BLOCKER→`blocker`, WARNING→`warning`, SUGGESTION→`suggestion`. A finding may carry the optional `check` tag the brief's emit shape names. Create `.claude/metrics/` if it does not exist. This is the complete emit contract — do not read `lib/findings.mjs` to rediscover it.

Then let the deterministic gate decide, rather than deciding in prose:

```bash
interlock gate --findings .claude/metrics/review-artifacts-<change>-<ts>.json --metrics <change> --stage artifacts --depth <depth> --reviewer <session|agent> --lenses <names|none> --json
```

Fill the recording flags in from what ran. Drop `--depth` when no `GATE DEPTH:` line was printed. `--reviewer agent` means the strict reviewer's findings are the input; every inline read, the fallbacks included, is `session`. `--lenses` is the list the brief's `REVIEW LENSES:` line names, or `none`.

The gate blocks if and only if at least one finding is a `blocker` or `malformed`. Its exit status is the verdict: non-zero means blocked. Do not re-derive the verdict in prose. In the JSON, `passed` is that same verdict; report the entries of `blockers` and `malformed`, read `metrics.written` and `metrics.reason` for whether the record landed, and hand `autonomyOutcome.blockers` on as the blocker count the spec skill passes to `interlock autonomy record`.

`--metrics <change>` is not optional decoration. It writes the four counts this gate produced — raised, dismissed, dropped by the quality band, surviving — to `.claude/metrics/` in the schema `interlock report` recognizes. Drop it and this review path becomes invisible to the report forever: the review-finding indicators read `unobserved` no matter how many gates ran. It is bookkeeping only and cannot change the verdict or the exit status.

When the output has no `passed`, the gate gave no verdict. Print `GATE UNAVAILABLE: <first line of the output>`. Rerun the line once without the four recording flags (`--stage`, `--depth`, `--reviewer`, `--lenses`) only when the output carries `unknownFlag`, an older `interlock` that refused them, and read the verdict from the rerun. Any other output with no `passed`, or a rerun with none, stops the gate: run no further gate line, report that the gate gave no verdict, and stop as on a blocker.
