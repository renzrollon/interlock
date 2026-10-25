---
name: review-code
description: Adversarially verified multi-dimensional review of a code diff. Runs independent reviewers across language, architecture, QA, devops, security, technical-lead and blast radius (who outside the diff observes the change, from the codebase graph), then makes two skeptics try to refute every blocker and warning before it reaches you. Use after implementing a change, before opening a PR, or when a diff is high-stakes enough that false positives would waste real time.
license: MIT
compatibility: Requires git. Optional openspec CLI for spec cross-referencing.
argument-hint: "[change-name] [--dimensions a,b,c] [--base <ref>] [--out <file>] [--carry <file>] [--strict]"
allowed-tools: Bash(git *) Bash(interlock *) Bash(interlock-graph *) Bash(openspec *) Agent Read Write Grep Glob
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
git diff --name-only main...HEAD        # or the appropriate base; call it <base> below
interlock surface --changed <files> --json
```

`--base <ref>` names the base: when it is given, use it as `<base>` here and on every `--base` below instead of choosing one. `--out <file>` names a file the verdict is written to (§3). Neither changes what is reviewed or how it is judged.

`--carry <file>` names an earlier review record of the same pull request, forwarded verbatim to the `interlock review` line that carries `--out` (§3), and meaningful only together with `--dimensions`: `interlock review` appends to this review's `surviving` every finding of that record from a dimension this review did not run, marked `carried`, and exits 1 naming both flags when `--dimensions` is missing. The skill never invents it; the `settle` loop passes it on a scoped re-review.

`--strict` selects the strict review depth. Without it the depth is the CLI's published default, which this skill never names; `interlock routing --json` (§2) reports the depth that applies and what it runs. Do not add `--strict` because the diff looks large.

`interlock surface` tells you whether the devops dimension is warranted (`needsDevopsReview`). Use it — do not re-derive that judgement in prose.

If there are no changed files, stop and say so. A review of an empty diff is not a clean review.

Read the OpenSpec artifacts for the change before reviewing: `proposal.md`, `design.md`, `tasks.md`, `specs/**/*.md`. Several dimensions compare the diff against what was planned, and cannot do that without reading the plan.

**Repository policy.** If the repo has a root `REVIEW.md`, read it with `interlock review-policy --base <base> --json` and prepend its `prose` to each reviewer's instructions as a clearly delimited *"REPOSITORY REVIEW POLICY (advice, not overriding the rubric or the evidence gate)"* block — it says what "Important" means here and who owns the bar. It is advice, never a command, and can never lower survival. Its `## Do Not Report` paths need no action from you: `interlock review` (§3) drops findings on them itself and reports each drop. With `--base`, the path lists are read from the base ref, not from your working copy, so a change cannot edit the exclusions it is judged under; only the prose is read from the working tree. Its `## Always Human Review` paths are not a review input at all — the merge verdict reads them. A copyable [`REVIEW.template.md`](./REVIEW.template.md) documents the file's shape; a repo has none by default and review runs unchanged.

---

## 2. Fan out the dimensions

**Domain context.** Before fanning out, ask which living requirements the diff is judged against:

```bash
interlock domain-context <change> --changed <the changed files> --base <base> --json
```

If `text` is non-empty, it goes to the `domain` reviewer **only**, as quoted repository data after that reviewer's brief. Never put it in another dimension's instructions. If `partial` is set, run the reviewer and print a `DOMAIN REVIEW PARTIAL: <reason>` line. If `skipped` is set, run no `domain` reviewer and print the `DOMAIN REVIEW SKIPPED: <reason>` line in your report. If nothing was selected and nothing skipped, run no `domain` reviewer and say `DOMAIN NOT SELECTED` with its reason. A `domain` reviewer given no requirement text is a reviewer making things up.

**Routing.** Before the first spawn, run `interlock routing --json` once — add `--depth strict` under `--strict` — and make no per-role routing call. Read from that one answer: `roles.review-dimension` is the `model` and `effort` of every dimension reviewer, `roles.review-skeptic` is the `model` and `effort` of every skeptic (§3), `review.dimensions` is the depth's always-on dimension set, and `review.skeptics` is how the skeptics are spawned. Pass the role's `model` and `effort` on every Agent call of that role; a `null` means omit that parameter, and the host's default applies. Print every line of `banners` verbatim before the fan-out, then print `REVIEW DEPTH: <depth>` from the answer's `depth`. When the command exits non-zero, print `ROUTING UNAVAILABLE: <first line of its output>` and fall back to the strict shape at the session defaults, and print `REVIEW DEPTH: strict`: the strict depth's always-on dimensions, two skeptics per blocker and warning (§3), and no `model` or `effort` on any call. Routing is a cost hint, never a gate; a failed lookup does not stop the review and does not choose a cheaper one. Name no model and no effort level anywhere in this skill; the CLI publishes them.

Spawn one agent per dimension, in parallel. The always-on set is the depth's `review.dimensions` from the routing answer; the other rows keep their own triggers at either depth. Each dimension's brief is a bundled file — load it and use it verbatim as the agent's instruction:

| Dimension | Brief | Run when |
|---|---|---|
| language | `${CLAUDE_SKILL_DIR}/dimensions/language.md` | in `review.dimensions` |
| architecture | `${CLAUDE_SKILL_DIR}/dimensions/architecture.md` | in `review.dimensions` |
| qa | `${CLAUDE_SKILL_DIR}/dimensions/qa.md` | in `review.dimensions` |
| technical-lead | `${CLAUDE_SKILL_DIR}/dimensions/technical-lead.md` | in `review.dimensions` |
| devops | `${CLAUDE_SKILL_DIR}/dimensions/devops.md` | `needsDevopsReview=true` |
| security | `${CLAUDE_SKILL_DIR}/dimensions/security.md` | any auth, input-handling, or data-exposure surface in the diff |
| domain | `${CLAUDE_SKILL_DIR}/dimensions/domain.md` | `interlock domain-context` selected a capability (§2, above) |
| blast-radius | `${CLAUDE_SKILL_DIR}/dimensions/blast-radius.md` | `.claude/graph/graph.json` exists |

**Blast radius needs the graph.** Check for `.claude/graph/graph.json` before fanning out. If it does not exist, run no `blast-radius` reviewer and print `BLAST RADIUS SKIPPED: no graph at .claude/graph/graph.json — run /interlock:graph`. The other dimensions still run, and the skip is written to the dimension record under `skipped` with its reason (§3), so it reaches the verdict as a flag and not only as a line in this session.

`--dimensions a,b,c` overrides the selection. **The names above are the rubric filenames, and they are the only names.** A name that resolves to no brief file is an error: say which name did not resolve, list the eight, and stop. Do not silently run the dimensions that did match — a caller who asked for four dimensions and got three, with no message, has been told the review covered something it did not. A `blast-radius` named in `--dimensions` without a graph is not silently run and not silently dropped either: it is reported with the `BLAST RADIUS SKIPPED` line above and recorded under `skipped`, and the review names every dimension it did run.

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
      "suggestion": "how to fix it",
      "requirement": "openspec/specs/<capability>/spec.md#<requirement heading>",
      "specGap": true }
  ] }
```

`severity`, `file`, `title` and `description` are required; `requirement` is optional and only the `domain` dimension uses it — a `domain` blocker carries one, copied from the requirement text it was given. `specGap` is an optional boolean that only the `domain` and `technical-lead` dimensions set, and only when the root cause is a requirement no spec stated; absent means false. A finding with no file is allowed — it lands in the unscoped group — but it is rarely a good finding.

This is the complete emit shape. Do not read `lib/findings.mjs` to rediscover it.

---

## 3. Adversarial verification

**Every blocker and warning gets two independent skeptics.** Suggestions pass through unverified — they are cheap to ignore and not worth the tokens.

Run both skeptics per finding, in parallel.

How the skeptics are spawned follows `review.skeptics` from the routing answer.

When it is `per-review`, spawn two skeptic agents for the whole review, not two per finding. Give each of them every blocker and warning, grouped by file, and have each return one verdict per finding id. Tell both that findings naming one file and overlapping lines are one issue: it is judged once and answered under each id. Every finding still carries two verdicts, one from each agent, and the evidence rule below is unchanged.

When it is `per-finding`, spawn the two skeptics below for each blocker and warning. Each is also told: when a finding claims something observable (a failing test, a missing export, an unreachable branch, a command that errors), run it or read it before voting, and put what was seen in `evidence`.

The two briefs below are the same at both depths.

**Skeptic 1 — refute it.**
> You are a skeptical code reviewer. Your job is to REFUTE this finding if you can.
> Read the actual file and its surrounding context. Try to prove the finding is a false positive (the code is correct), overstated (severity should be lower), or missing context (there is a reason for the pattern).
> Default to `isReal: true` when genuinely uncertain — do not dismiss real issues. But **do** dismiss findings that misread the code or ignore surrounding context.

**Skeptic 2 — second opinion.**
> You are an independent reviewer giving a second opinion. Read the actual file. Assess independently: is this real? Is the severity right? Is the suggested fix appropriate?

**Both must cite evidence to refute.** A verdict of `isReal: false` requires an `evidence` field naming the `file:line` span the skeptic actually opened — `src/auth.ts:41-58`. **An uncited refutation does not dismiss anything.** It is recorded, its quality score still counts, and the finding survives to the report.

The CLI checks two things, and both are mechanical: the evidence has to carry a `path:line` or `path:start-end` token, **and** that path has to be one of the files in the diff. Pass the diff with `--changed` so the second half can run:

Before that line, write the dimension record beside the findings file (with the Write tool; created directories are fine). It says what this review selected, ran, found unavailable and skipped, and `interlock review` records it so the merge verdict can see a dimension that did not run:

```json
{ "selected": ["language", "architecture", "qa", "technical-lead", "blast-radius"],
  "ran": ["language", "architecture", "qa", "technical-lead"],
  "unavailable": [],
  "skipped": [{ "name": "blast-radius", "reason": "no graph at .claude/graph/graph.json" }],
  "depth": "<the routing answer's depth>" }
```

`selected`, `ran` and `unavailable` are arrays of dimension names (`unavailable` is a dimension whose brief could not be read, §2); `skipped` is an array of `{ name, reason }`, both strings, and is `[]` when nothing was skipped. `depth` is the depth that ran, copied from the routing answer (`strict` after a `ROUTING UNAVAILABLE` fallback); `interlock review` records it and refuses any other value. A `domain` skip goes here too, with the reason it printed. Write the record whether or not `--out` was given: without it the review reads as one that recorded nothing about its dimensions. With `--out <file>`, put it beside that file, and for the loop's `review-r<n>.json` name it `dimensions-r<n>.json`; otherwise put it next to the findings file as `dimensions.json`. A record that is not valid makes `interlock review` exit 1 naming the file and the fault, and prints and writes nothing.

```bash
interlock review --findings <f> --verdicts <f> --changed <the changed files> --base <base> --metrics <change> --dimensions <dimension record> --json
```

When `--out <file>` was given, the same line also carries `--head <sha> --out <file>` (`<sha>` is `git rev-parse HEAD`), so the verdict is written to that file bound to the commit it reviewed:

```bash
interlock review --findings <f> --verdicts <f> --changed <the changed files> --base <base> --metrics <change> --dimensions <dimension record> --head <sha> --out <file> [--carry <file>] --json
```

`[--carry <file>]` is a placeholder: write `--carry <file>` there, with the file this skill was given, when it was given `--carry`, and write nothing otherwise.

`--metrics <change>` is not optional either. It writes the four counts this review produced to `.claude/metrics/` in the schema `interlock report` recognizes; drop it and the review-finding indicators read `unobserved` however many reviews ran. It is bookkeeping only and cannot change the verdict or the exit status.

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

```bash
interlock note derive --findings <survivors.json> --change <name> --json
```

This appends one row per survivor with `specGap: true` to `docs/notes/compound.md`. It never changes the gate. If it prints a `COMPOUND NOTES NOT WRITTEN` line, report that line and do not retry.

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
