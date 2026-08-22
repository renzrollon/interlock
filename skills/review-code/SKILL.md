---
name: review-code
description: Adversarially verified multi-dimensional review of a code diff. Runs independent reviewers across language, architecture, QA, devops, security and technical-lead, then makes two skeptics try to refute every blocker and warning before it reaches you. Use after implementing a change, before opening an MR, or when a diff is high-stakes enough that false positives would waste real time.
license: MIT
compatibility: Requires git. Optional openspec CLI for spec cross-referencing.
argument-hint: "[change-name] [--dimensions a,b,c]"
allowed-tools: Bash(git *) Bash(interlock *) Bash(interlock-graph *) Bash(openspec *) Agent Read Grep Glob
metadata:
  type: review
---

Review a diff from several expert angles at once, then **attack your own findings** before reporting them.

The second half is the point. An unverified review reports everything it notices, so the reader learns to skim it. A review where every blocker survived two skeptics is a review worth reading line by line.

---

## 1. Scope the diff

Resolve the change and the file set:

```bash
interlock changes                        # active OpenSpec changes
git diff --name-only main...HEAD        # or the appropriate base
interlock surface --changed <files> --json
```

`interlock surface` tells you whether the devops dimension is warranted (`needsDevopsReview`). Use it — do not re-derive that judgement in prose.

If there are no changed files, stop and say so. A review of an empty diff is not a clean review.

Read the OpenSpec artifacts for the change before reviewing: `proposal.md`, `design.md`, `tasks.md`, `specs/**/*.md`. Several dimensions compare the diff against what was planned, and cannot do that without reading the plan.

---

## 2. Fan out the dimensions

Spawn one agent per dimension, in parallel. Each dimension's brief is a bundled file — load it and use it verbatim as the agent's instruction:

| Dimension | Brief | Run when |
|---|---|---|
| language | `${CLAUDE_SKILL_DIR}/dimensions/language.md` | always |
| architecture | `${CLAUDE_SKILL_DIR}/dimensions/architecture.md` | always |
| qa | `${CLAUDE_SKILL_DIR}/dimensions/qa.md` | always |
| technical-lead | `${CLAUDE_SKILL_DIR}/dimensions/technical-lead.md` | always |
| devops | `${CLAUDE_SKILL_DIR}/dimensions/devops.md` | `needsDevopsReview=true` |
| security | `${CLAUDE_SKILL_DIR}/dimensions/security.md` | any auth, input-handling, or data-exposure surface in the diff |

`--dimensions a,b,c` overrides the selection. **The names above are the rubric filenames, and they are the only names.** A name that resolves to no brief file is an error: say which name did not resolve, list the six, and stop. Do not silently run the dimensions that did match — a caller who asked for four dimensions and got three, with no message, has been told the review covered something it did not.

(This used to bite: the fourth always-on dimension was called `delivery` here and in `README.md` while its brief file was `technical-lead.md`, so `--dimensions delivery` matched nothing at all and said nothing about it.)

A dimension whose brief file cannot be read is **not** dispatched with an empty rubric either. Report it as unavailable — a reviewer given a dimension name and no criteria produces findings that two skeptics then spend their budget verifying.

Every dimension agent returns findings in this shape:

```json
{ "dimension": "security",
  "findings": [
    { "severity": "blocker|warning|suggestion",
      "file": "path/to/file.ts", "line": 42,
      "title": "short claim",
      "description": "what is wrong and why",
      "suggestion": "how to fix it" }
  ] }
```

`severity`, `file`, `title` and `description` are required. A finding with no file is allowed — it lands in the unscoped group — but it is rarely a good finding.

This is the complete emit shape. Do not read `lib/findings.mjs` to rediscover it.

---

## 3. Adversarial verification

**Every blocker and warning gets two independent skeptics.** Suggestions pass through unverified — they are cheap to ignore and not worth the tokens.

Run both skeptics per finding, in parallel.

**Skeptic 1 — refute it.**
> You are a skeptical code reviewer. Your job is to REFUTE this finding if you can.
> Read the actual file and its surrounding context. Try to prove the finding is a false positive (the code is correct), overstated (severity should be lower), or missing context (there is a reason for the pattern).
> Default to `isReal: true` when genuinely uncertain — do not dismiss real issues. But **do** dismiss findings that misread the code or ignore surrounding context.

**Skeptic 2 — second opinion.**
> You are an independent reviewer giving a second opinion. Read the actual file. Assess independently: is this real? Is the severity right? Is the suggested fix appropriate?

**Both must cite evidence to refute.** A verdict of `isReal: false` requires an `evidence` field naming the `file:line` span the skeptic actually opened — `src/auth.ts:41-58`. **An uncited refutation does not dismiss anything.** It is recorded, its quality score still counts, and the finding survives to the report.

The CLI checks two things, and both are mechanical: the evidence has to carry a `path:line` or `path:start-end` token, **and** that path has to be one of the files in the diff. Pass the diff with `--changed` so the second half can run:

```bash
interlock review --findings <f> --verdicts <f> --changed <the changed files> --json
```

Neither half is optional theatre. Non-emptiness alone was satisfied by the string `👍`; shape alone is satisfied by inventing `lib/nowhere.ts:1`. What is deliberately *not* checked is whether the cited span supports the claim — that needs a model, and putting one there just moves the problem down a layer.

Voting a finding *real* needs no evidence: that direction already resolves toward a human reading it, which is the cheap error. Only the dismissing direction is gated, because a dismissed finding is invisible — nobody can catch the mistake.

`interlock review` reports how many refutations were refused for citing nothing. A run where that number is high means the skeptics are asserting rather than reading.

Both score the finding on two integer axes, 0–5:

- `qualityScore` — how well-grounded, actionable and clearly explained. 0 = incomprehensible, 3 = usable, 5 = exemplary.
- `severityScore` — impact if real. 0 = cosmetic, 3 = user-visible bug, 5 = data loss or security breach.

Tell them to be honest and not inflate scores to justify keeping a weak finding.

**Survival rule:** a finding survives when at least half the valid verdicts say `isReal`. A survivor takes the `refinedSeverity` of the first skeptic that judged it real — so a blocker can be demoted to a warning by verification, which is a feature. A finding that does not survive is dismissed and never reported.

Skeptics must **read the file**. A verdict reached from the finding text alone is worthless; the whole mechanism depends on the skeptic having context the original reviewer lacked.

---

## 4. Decide the gate

Collect the survivors and hand them to the deterministic gate:

```bash
interlock gate --findings <survivors.json> --json
```

The gate applies the **quality band** before it counts anything: survivors the skeptics scored too low on `qualityScore` are dropped, and the gate reports how many as `droppedByQuality`. The floor lives in the CLI (`--min-quality` overrides it, `--no-tolerance` disables it) — never restate the number here, never re-derive the band in prose, and never pre-filter weak findings yourself before the gate sees them.

It returns `passed`, severity counts, the blocker list, the per-file remediation grouping, and `autonomyOutcome`. **Do not re-derive pass/fail in prose** — the gate blocks if and only if a surviving finding is a blocker, and that is a count, not a judgement.

Record the outcome:

```bash
interlock autonomy record review-code --blockers <n>   # or --blockers 0 when clean
```

A blocker here also resets `ship` via transitive blame — the gate blames whoever produced the bad code.

---

## 5. Report

Lead with the verdict, then the survivors, most severe first:

```
GATE BLOCKED — 2 blockers of 7 findings (4 dismissed by skeptics)

[blocker] app/api/export/route.ts:31 — Unauthenticated tenant data access
  security · quality 5 · severity 5
  <description>
  → <suggestion>
```

Always report **how many findings the skeptics dismissed**, and separately the gate's `droppedByQuality` count. Those numbers are the evidence the review is worth trusting; hiding them makes a verified review look identical to an unverified one.

Never report a dismissed finding "just in case". That defeats the entire mechanism.
