---
name: review-code
description: Adversarially verified multi-dimensional review of a code diff. Runs independent reviewers across language, architecture, QA, technical-lead and regression, the review depth deciding which of them always run, plus devops, security, domain and blast radius (who outside the diff observes the change, from the codebase graph) only when the diff calls for them, then makes two skeptics try to refute every blocker and warning before it reaches you. With --pr it reviews a colleague's pull request read-only, from a worktree of its pinned head, and posts one comment only when asked to. Use after implementing a change, before opening a PR, to review a colleague's pull request, or when a diff is high-stakes enough that false positives would waste real time.
license: MIT
compatibility: Requires git. Optional openspec CLI for spec cross-referencing.
argument-hint: "[change-name] [--dimensions a,b,c] [--base <ref>] [--out <file>] [--carry <file>] [--strict] [--pr <ref> [--post] [--run-code]]"
allowed-tools: Bash(git *) Bash(interlock *) Bash(interlock-graph *) Bash(openspec *) Bash(gh auth status) Bash(gh pr view *) Bash(gh pr comment *) Bash(glab auth status) Bash(glab mr view *) Bash(glab mr note create *) Bash(glab ci get *) Agent Read Write Grep Glob
metadata:
  type: review
---

Review a diff from several expert angles at once, then **attack your own findings** before reporting them.

The second half is the point. An unverified review reports everything it notices, so the reader learns to skim it. A review where every blocker survived two skeptics is a review worth reading line by line.

**Session suggestion.** Unless another Interlock skill invoked this one, run `interlock suggest review-code` once, now, and print every line it returns verbatim. If it exits non-zero, print `SESSION SUGGESTION UNAVAILABLE: <first line of its output>` and continue. It is advice and never a gate: do not change the model or the effort yourself, and do not wait for the person to.

---

## 1. Scope the diff

Under `--pr`, §6 takes this section's place and none of §1's commands runs: read §6 now, not the rest of this section.

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

**Repository policy.** If the repo has a root `REVIEW.md`, its prose reaches every reviewer inside the prompt `interlock review brief` prints (§2), quoted as advice that does not override the rubric or the evidence gate; this skill adds none of it by hand. Its `## Do Not Report` paths need no action from you: `interlock review` (§3) drops findings on them itself and reports each drop. With `--base`, the path lists are read from the base ref, not from your working copy, so a change cannot edit the exclusions it is judged under. Its `## Always Human Review` paths are not a review input at all — the merge verdict reads them. A copyable [`REVIEW.template.md`](./REVIEW.template.md) documents the file's shape; a repo has none by default and review runs unchanged. `interlock review-policy --base <base> --json` prints the parsed file when you want to see it.

**The graph must hold the diff.** Before fanning out, check that the codebase graph covers the changed files, and update it when it does not:

```bash
git diff --name-only <base>...HEAD | interlock-graph covers --changed - --update
```

On exit 3 there is no graph: run no `blast-radius` reviewer, print the `BLAST RADIUS SKIPPED` line (§2), and build nothing. When it still exits 1 after its own update, print `GRAPH STALE: <the files it lists>`, run blast radius on the graph it has, and record `blast-radius` under `degraded` in the dimension record (§3) with those files as its reason. The retry is the CLI's; do not run the update again.

---

## 2. Fan out the dimensions

**Domain context.** Before fanning out, ask which living requirements the diff is judged against:

```bash
interlock domain-context <change> --changed <the changed files> --base <base> --json
```

The `domain` reviewer's prompt carries that text itself (below). If `partial` is set, run the reviewer and print a `DOMAIN REVIEW PARTIAL: <reason>` line; when `omitted` is non-empty, record `domain` under `degraded` in the dimension record (§3) with that reason, because the cap, not the reviewer, left those requirements out. If `skipped` is set, run no `domain` reviewer and print the `DOMAIN REVIEW SKIPPED: <reason>` line in your report. If nothing was selected and nothing skipped, run no `domain` reviewer and say `DOMAIN NOT SELECTED` with its reason. A `domain` reviewer given no requirement text is a reviewer making things up. When the output carries `CHANGE READ FROM ARCHIVE:`, print that line.

**Routing.** Before the first spawn, run `interlock routing --json` once — add `--depth strict` under `--strict` — and make no per-role routing call. Read from that one answer: `roles.review-dimension` is the `model` and `effort` of every dimension reviewer, `roles.review-skeptic` is the `model` and `effort` of every skeptic (§3), `review.dimensions` is the depth's always-on dimension set, and `review.skeptics` is how the skeptics are spawned. Pass the role's `model` and `effort` on every Agent call of that role; a `null` means omit that parameter, and the host's default applies. Print every line of `banners` verbatim before the fan-out. When the command exits non-zero, print `ROUTING UNAVAILABLE: <first line of its output>` and fall back to the strict shape at the session defaults: the strict depth's always-on dimensions, two skeptics per blocker and warning (§3), and no `model` or `effort` on any call. Routing is a cost hint, never a gate; a failed lookup does not stop the review and does not choose a cheaper one. Name no model and no effort level anywhere in this skill; the CLI publishes them.

**The depth line.** Once the set is chosen — the always-on dimensions from the routing answer, plus every row of the table below whose trigger the diff met, or the names in `--dimensions` — and before the first dimension spawn, print one line: `REVIEW DEPTH: <depth> (<n> dimensions: <a> always-on + <t> triggered)`. `<depth>` is the answer's `depth`, `<a>` the length of `review.dimensions`, `<t>` the triggered dimensions that will run, and `<n>` their sum. Under `--dimensions` print `REVIEW DEPTH: <depth> (<n> dimensions: --dimensions)` with `<n>` the names it lists. After `ROUTING UNAVAILABLE` print the same line with `strict` as the depth. Count the dimensions that will run: a skipped `blast-radius` or `domain` is not counted.

Spawn one agent per dimension, in parallel. The always-on set is the depth's `review.dimensions` from the routing answer; the other rows keep their own triggers at either depth. Each dimension's prompt is printed by the CLI: run, for each dimension,

```bash
interlock review brief --dimension <name> --base <base> --change <change> --changed <the changed files>
```

and spawn the agent as `interlock:reviewer`, with the printed prompt as its whole prompt. Add nothing to it and leave nothing out: it holds the bundled rubric, the scope with the changed line ranges, the repository's review policy and review context as quoted data, the domain text for `domain`, the run-and-measure and proof rules, and the shape to return. A skill's `allowed-tools` do not reach an agent it spawns, so the agent type is the first bound: the plugin's definition of `interlock:reviewer` bounds its tools, and it holds no tool that edits a file, spawns an agent or invokes a skill. Routing chooses the model and the effort, never the type: after `ROUTING UNAVAILABLE` the call still names `interlock:reviewer`. The shell can still write, so the printed prompt's write-nothing line stays the second bound.

**A reviewer that cannot be spawned fails the review.** When the Agent tool reports `interlock:reviewer` as an unknown type, or a dimension or skeptic spawn is refused or declined, print `REVIEW FAILED: reviewer type unavailable — <the tool's message, or the refusal>`. Spawn no other type in its place, review nothing yourself, and run no draft, proof or promote line: the review recorded nothing, and no finding is reported as verified. Name both remedies: a session started before the plugin was updated does not have the type, and a new session does; `interlock doctor` names an install whose `agents/` lacks the file.

| Dimension | Brief | Run when |
|---|---|---|
| language | `${CLAUDE_SKILL_DIR}/dimensions/language.md` | in `review.dimensions` |
| architecture | `${CLAUDE_SKILL_DIR}/dimensions/architecture.md` | in `review.dimensions` |
| qa | `${CLAUDE_SKILL_DIR}/dimensions/qa.md` | in `review.dimensions` |
| technical-lead | `${CLAUDE_SKILL_DIR}/dimensions/technical-lead.md` | in `review.dimensions` |
| regression | `${CLAUDE_SKILL_DIR}/dimensions/regression.md` | in `review.dimensions` |
| devops | `${CLAUDE_SKILL_DIR}/dimensions/devops.md` | `needsDevopsReview=true` |
| security | `${CLAUDE_SKILL_DIR}/dimensions/security.md` | any auth, input-handling, or data-exposure surface in the diff |
| domain | `${CLAUDE_SKILL_DIR}/dimensions/domain.md` | `interlock domain-context` selected a capability (§2, above) |
| blast-radius | `${CLAUDE_SKILL_DIR}/dimensions/blast-radius.md` | `.claude/graph/graph.json` exists |

**Blast radius needs the graph.** When `interlock-graph covers` (§1) exits 3, there is no graph: run no `blast-radius` reviewer and print `BLAST RADIUS SKIPPED: no graph at .claude/graph/graph.json — run /interlock:graph`. The other dimensions still run, and the skip is written to the dimension record under `skipped` with its reason (§3), so it reaches the verdict as a flag and not only as a line in this session.

`--dimensions a,b,c` overrides the selection. **The names above are the rubric filenames, and they are the only names.** A name that resolves to no brief file is an error: say which name did not resolve, list the nine, and stop. Do not silently run the dimensions that did match — a caller who asked for four dimensions and got three, with no message, has been told the review covered something it did not. A `blast-radius` named in `--dimensions` without a graph is not silently run and not silently dropped either: it is reported with the `BLAST RADIUS SKIPPED` line above and recorded under `skipped`, and the review names every dimension it did run.

(This used to bite: the fourth always-on dimension was called `delivery` here and in `README.md` while its brief file was `technical-lead.md`, so `--dimensions delivery` matched nothing at all and said nothing about it.)

A dimension whose brief the CLI cannot print (`interlock review brief` exits 1) is **not** dispatched with an empty rubric either. Report it as unavailable — a reviewer given a dimension name and no criteria produces findings that two skeptics then spend their budget verifying.

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
      "specGap": true } ],
  "coverage": {
    "checked": [ { "what": "what was examined", "at": "path/to/file.ts:40-58" } ],
    "unread": [ { "input": "what was not read", "reason": "why", "paths": ["path/to/file.ts"] } ] } }
```

`severity`, `file`, `title` and `description` are required; `requirement` is optional and only the `domain` dimension uses it — a `domain` blocker carries one, copied from the requirement text it was given. `specGap` is an optional boolean that only the `domain` and `technical-lead` dimensions set, and only when the root cause is a requirement no spec stated; absent means false. `coverage` is what proves the review looked: an answer without it is recorded unproven. On an `unread` entry, `paths` is optional: it names the changed files the entry is about, as the scope lists them, and the CLI classes them. A finding with no file is allowed — it lands in the unscoped group — but it is rarely a good finding.

This is the complete emit shape. Do not read `lib/findings.mjs` to rediscover it.

Under `--pr` the `interlock` lines of this section and the next are run as §6 spells them, with `--target`. Under `--pr` only, a finding gains the optional boolean `preExisting`, which the dimension prompt explains and the comment confirms; send it only when the prompt asks.

---

## 3. Adversarial verification

**Every blocker and warning gets two independent skeptics.** Suggestions pass through unverified — they are cheap to ignore and not worth the tokens.

Run both skeptics per finding, in parallel.

How the skeptics are spawned follows `review.skeptics` from the routing answer, and the CLI prints one prompt per agent for it:

```bash
interlock review brief --skeptics --findings <f> [--depth strict] --json
```

`[--depth strict]` is a placeholder: write `--depth strict` there under `--strict`, and nothing otherwise. Spawn one skeptic agent per entry of `prompts`, each as `interlock:reviewer` with that entry's `prompt` as its whole prompt, and collect one verdict per id in its `findingIds` into the verdicts file. Add nothing to a prompt. The plugin's definition of that type bounds the skeptic's tools: it holds no tool that edits a file, spawns an agent or invokes a skill. Routing chooses the model and the effort, never the type: after `ROUTING UNAVAILABLE` the call still names `interlock:reviewer`. A skeptic that cannot be spawned prints the `REVIEW FAILED: reviewer type unavailable` line of §2 and ends the review the same way.

When it is `per-review`, the CLI prints two prompts for the whole review: each skeptic is given every blocker and warning, grouped by file, returns one verdict per finding, and is told that overlapping findings are one issue, judged once. Every finding still carries two verdicts, one from each agent.

When it is `per-finding`, the CLI prints two prompts per blocker and warning, each telling the skeptic to run it or read it before voting when the finding claims something observable, and to put what was seen in `evidence`.

**An uncited refutation does not dismiss anything.** The CLI checks two things, and both are mechanical: a refutation's `evidence` carries a `path:line` or `path:start-end` token, **and** that path is one of the files in the diff (or, for a `blast-radius` or `regression` finding, the finding's own file). Pass the diff with `--changed` so the second half can run. Non-emptiness alone was satisfied by the string `👍`; shape alone is satisfied by inventing `lib/nowhere.ts:1`. `interlock review` reports how many refutations were refused for citing nothing; a run where that number is high means the skeptics are asserting rather than reading.

Before the review line, write the dimension record beside the findings file (with the Write tool; created directories are fine). It says what this review selected, ran, found unavailable, skipped and ran on a degraded input, and `interlock review` records it so the merge verdict can see a dimension that did not run:

```json
{ "selected": ["language", "technical-lead", "regression", "blast-radius"],
  "ran": ["language", "technical-lead", "regression"],
  "unavailable": [],
  "skipped": [{ "name": "blast-radius", "reason": "no graph at .claude/graph/graph.json" }],
  "degraded": [],
  "depth": "<the routing answer's depth>" }
```

`selected`, `ran` and `unavailable` are arrays of dimension names (`unavailable` is a dimension whose brief could not be printed, §2); `skipped` is an array of `{ name, reason }`, both strings, and is `[]` when nothing was skipped. `degraded` is an array of `{ name, reason }` naming `domain` when `domain-context` reported `omitted`, or `blast-radius` when `interlock-graph covers` still reported files (§1); `interlock review` refuses any other name. `depth` is the depth that ran, copied from the routing answer (`strict` after a `ROUTING UNAVAILABLE` fallback); `interlock review` records it and refuses any other value. A `domain` skip goes here too, with the reason it printed. Write the record whether or not `--out` was given: without it the review reads as one that recorded nothing about its dimensions. With `--out <file>`, put it beside that file, and for the loop's `review-r<n>.json` name it `dimensions-r<n>.json`; otherwise put it next to the findings file as `dimensions.json`. A record that is not valid makes `interlock review` exit 1 naming the file and the fault, and prints and writes nothing.

**Record a draft, prove it, and re-run what it cannot prove.** The first pass is written as a draft: every flag of the final write but `--metrics`, `--draft`, and `--out <draft>`, where `<draft>` is `<out>.draft.json` beside the caller's `--out`, or `.claude/ship/review/review.draft.json` when no `--out` was given:

```bash
interlock review --findings <f> --verdicts <f> --changed <the changed files> --base <base> --dimensions <dimension record> --head <sha> [--carry <file>] --draft --out <draft> --json
```

Then ask the CLI whether the draft proves what it covered:

```bash
interlock review proof --review <draft>
```

While it exits 1, its first line reads `re-run: <dimensions>`. Print that line before you spawn anything. Then get each named dimension's re-run prompt from the draft:

```bash
interlock review brief --dimension <name> --base <base> --change <change> --changed <the changed files> --rerun-of <draft>
```

and re-run that dimension with it, spawning the agent as `interlock:reviewer` with that prompt as its whole prompt, as on the first pass: the plugin's definition of that type bounds its tools, so it holds no tool that edits a file, spawns an agent or invokes a skill, and routing chooses the model and the effort, never the type. A re-run that cannot be spawned prints the `REVIEW FAILED: reviewer type unavailable` line of §2 and ends the review the same way. Put the re-run answers alone through the skeptics with

```bash
interlock review brief --skeptics --findings <re-run answers> --rerun-of <draft> [--depth strict] --json
```

and write the next draft from the last one:

```bash
interlock review --rerun-of <draft> --findings <re-run answers> --verdicts <re-run verdicts> --changed <the changed files> --base <base> --dimensions <dimension record> --head <sha> [--carry <file>] --draft --out <next draft> --json
```

then run the proof line on the next draft. When a brief line exits 1, print `RE-RUN REFUSED: <its standard-error line>` and spawn nothing for that dimension. When no dimension the `re-run:` line named got a prompt, there is no re-run answer to write, so the proof line would print the same `re-run:` line again: do not run the proof line again, and promote the last draft. The CLI merges the re-run into the draft and keeps every first-pass finding, verdict, skip and degraded entry; compose no findings or verdicts file yourself, and count nothing: the cap is the CLI's. When the proof line exits 0 — its first line is `proven`, `PROOF CAP REACHED: <dimensions>` or `PROOF LEFT UNREAD: <dimensions>`, the last two of which you print — promote the last draft. When it exits 2, the CLI cannot answer for the draft: it is not an adjudicated review, it carries no proof, or its proof does not hold and names no dimension to re-run (a `no diff given` draft, for one). Print `PROOF UNANSWERED: <its standard-error line>` aloud, re-run nothing and do not run the proof line again: there is nothing to loop on. Promote the last draft all the same, so the record carries the proof as the CLI computed it and every reader of a proof that does not hold prints `REVIEW NOT PROVEN`; never report the review as proven or clean after an exit 2. When the promote line refuses the draft as well, print its error and stop: the review recorded nothing. The promote line is the review line, and the only one that carries `--metrics`:

```bash
interlock review --rerun-of <last draft> --changed <the changed files> --base <base> --metrics <change> --dimensions <dimension record> --json
```

When `--out <file>` was given, the same line also carries `--head <sha> --out <file>` (`<sha>` is `git rev-parse HEAD`), so the verdict is written to that file bound to the commit it reviewed:

```bash
interlock review --rerun-of <last draft> --changed <the changed files> --base <base> --metrics <change> --dimensions <dimension record> --head <sha> --out <file> [--carry <file>] --json
```

`[--carry <file>]` is a placeholder: write `--carry <file>` there, with the file this skill was given, when it was given `--carry`, and write nothing otherwise. A `LEDGER REJECTED:` line on standard error names a dimension whose ledger was malformed. `recorded unproven` means the proof line names it for a re-run. `the first ledger was kept` means a re-run appended onto a dimension that was not unproven: the first ledger stays, and the proof line names that dimension only for a gap that remains.

`--metrics <change>` is not optional either. It writes the four counts this review produced to `.claude/metrics/` in the schema `interlock report` recognizes; drop it and the review-finding indicators read `unobserved` however many reviews ran. It is bookkeeping only and cannot change the verdict or the exit status.

Voting a finding *real* needs no evidence: that direction already resolves toward a human reading it, which is the cheap error. Only the dismissing direction is gated, because a dismissed finding is invisible — nobody can catch the mistake.

Under `--pr` the review, proof and promote lines are the ones §6 spells, and `--metrics <change>` is passed only when the person named a change.

**Survival rule:** a finding survives when at least half the valid verdicts say `isReal`. A survivor takes the `refinedSeverity` of the first skeptic that judged it real — so a blocker can be demoted to a warning by verification, which is a feature. A finding that does not survive is dismissed and never reported.

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

Under `--pr` the two recording lines above are not run: no autonomy line and no note line. The gate line still runs, for the counts and the quality band.

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

Under `--pr`, report the gate's counts as above, then print the comment §6 renders. A pull request is a colleague's: the comment carries no gate word.

---

## 6. Pull request review (--pr)

`--pr <ref>` reviews a colleague's open pull request, read-only, from a detached worktree of its pinned head. `<ref>` is a number, a URL or a branch the platform's CLI accepts. **This section takes §1's place under `--pr`: none of §1's commands runs**, because each one reads or writes the person's own tree. §2 to §5 are followed for what to spawn, what to collect and what to report, and their `interlock` lines are run as the block below spells them.

`--base` and `--carry` do not combine with `--pr`: the target gives the base, and a carried record is the settle loop's. `--pr` with either is an error. Say which flag, and stop before any command. `--out <file>` still names the record's file.

`--post` and `--run-code` are the person's flags, and the skill never adds either itself. `--post` sends the comment this review renders, as one comment, after the review; without it nothing is sent. `--run-code` lets reviewers run the pull request's own code; without it the prompts tell them to read and run none of it. Neither changes what is reviewed or how it is judged.

**What the path never does.** It writes to the platform nothing but the one comment, under `--post`. It never pushes, commits, edits the pull request or its labels, marks it ready, approves it, requests changes, resolves a thread or merges. It never switches, stashes, resets or cleans the person's own tree, and never touches the person's own graph. The section holds none of those commands, a test fails the file if one appears, and the prompts carry a write-nothing line.

### The steps

1. Detect the platform from `origin`, and check that its CLI is signed in with `gh auth status` or `glab auth status`, as the `settle` skill does. A CLI that is missing or not signed in prints `PULL REQUEST NOT REVIEWED:` with its message and stops.

2. Pin the pull request. The platform's own document goes to `interlock review target`, which writes the target file and prints it. Add `--run-code` inside the brackets only when the person passed it.

```bash
# GitHub — not exercised: field names confirmed against one real document, nothing posted
gh pr view <ref> --json number,url,state,isDraft,isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid | interlock review target --github - [--run-code] --json
```

```bash
# GitLab — not exercised: field names read from the platform's documentation
glab mr view <ref> --output json | interlock review target --gitlab - [--run-code] --json
```

   A non-zero exit prints `PULL REQUEST NOT REVIEWED:` with the reason and stops. A fork and a pull request that is not open are refused there. When the platform's CLI itself failed, `interlock review target` says it printed no document: give the platform CLI's message as the reason. From here `<target>` is the printed `file`, `<dir>` its `dir`, `<worktree>` its `worktree`, and `<record>` is `<dir>/review.json` or the `--out` file. Type no commit and no ref: each comes from the target.

3. Run `commands.fetch`, then `commands.worktreeAdd`, each as the target prints it under `lines`: `lines.fetch`, then `lines.worktreeAdd`. Each `lines.<name>` is that command's argv as one line, every word that needs it already quoted for the shell, and the same holds for `lines.changed` and `lines.worktreeRemove` below: run the printed line itself, never one assembled from the argv, and type no ref and no path into it. A failed fetch prints `PULL REQUEST NOT REVIEWED:` with git's message and stops; nothing exists to remove yet. A failed add prints `REVIEW WORKTREE NOT CREATED:`. When a sandbox refused the write, run that same command once outside it. When the path is already a worktree from an interrupted run, run `lines.worktreeRemove` and then the add again, one time. A second failure stops.

4. Read the checks. The line the command prints names the commit the checks are for; the check summary is printed only when that commit is the target's `head.sha`. When it is another commit, the pull request moved after it was pinned: print `CHECKS NOT READ:` naming both commits in place of the summary. A refusal prints `CHECKS NOT READ:` with its reason. In every case the review goes on, on the pinned head.

```bash
# GitHub — not exercised
gh pr view <number> --json headRefOid,statusCheckRollup | interlock pipeline --github - --out <dir>/pipeline.json
```

```bash
# GitLab — not exercised
glab mr view <iid> --output json | interlock pipeline --gitlab-pr - --out <dir>/pipeline.json
glab ci get --merge-request <iid> --output json | interlock pipeline --gitlab - --pending <dir>/pipeline.json --out <dir>/pipeline.json
```

   The second GitLab line runs only when the first printed `pending`, as the `settle` skill's pipeline input does. The skill runs no test, build or lint itself, with or without `--run-code`.

5. Run `commands.changed` as its printed `lines.changed`, writing the changed files to `<dir>/changed.txt`:

```bash
<lines.changed> > <dir>/changed.txt
```

   When the file holds no path, print `PULL REQUEST NOT REVIEWED: no changed files` and stop; the person's own diff is never read. Every line below that takes the changed files reads them from that file on standard input, as `--changed - < <dir>/changed.txt`, and never as names typed after the flag: a file name is the pull request's text, and typed into a line it is a word a shell reads. Run `interlock surface --changed - --json < <dir>/changed.txt` on them. When the person named a change, read its OpenSpec artifacts under `<worktree>`, where the pull request's copy is, never from the person's own tree.

6. When `.claude/graph/graph.json` exists in the person's own tree, build one inside the worktree and check it covers the files. The graph was just built, so the covers line takes no update flag, and nothing under the person's own `.claude/graph/` is written. Without a person's graph, or after a failed build or a failed covers line, run no `blast-radius` reviewer, print the `BLAST RADIUS SKIPPED` line of §2 and record the skip. Write `<worktree>` on these two lines single-quoted, as the printed lines quote a path.

```bash
interlock-graph build <worktree>
interlock-graph covers --changed - --root <worktree> < <dir>/changed.txt
```

7. Ask for the domain context with the first line of the block below. Routing is read in the person's own tree, unchanged. `REVIEW_CONTEXT.md` is read from the directory the command runs in, never from the worktree.

8. Follow §2 and §3 for what to spawn and what to collect, running their `interlock` lines as this block spells them. Every scratch file goes under `<dir>`. Spawn every reviewer and skeptic as `interlock:reviewer`; a spawn that fails prints the `REVIEW FAILED: reviewer type unavailable` line of §2.

```bash
interlock domain-context [<change>] --changed - --target <target> --json < <dir>/changed.txt
interlock review brief --dimension <name> --target <target> [--change <change>] --changed - < <dir>/changed.txt
interlock review brief --skeptics --findings <f> --target <target> [--depth strict] --json
interlock review --target <target> --findings <f> --verdicts <f> --changed - --dimensions <dimension record> --draft --out <draft> --json < <dir>/changed.txt
interlock review proof --review <draft>
interlock review brief --dimension <name> --target <target> [--change <change>] --changed - --rerun-of <draft> < <dir>/changed.txt
interlock review brief --skeptics --findings <re-run answers> --rerun-of <draft> --target <target> [--depth strict] --json
interlock review --rerun-of <draft> --target <target> --findings <re-run answers> --verdicts <re-run verdicts> --changed - --dimensions <dimension record> --draft --out <next draft> --json < <dir>/changed.txt
interlock review --rerun-of <last draft> --target <target> --changed - [--metrics <change>] --dimensions <dimension record> --out <record> --json < <dir>/changed.txt
interlock gate --findings <survivors.json> --json
interlock review comment --review <record> --target <target> --out <dir>/comment.md
```

   The bracketed parts are placeholders: write `--metrics <change>` only when the person named a change, and otherwise print `REVIEW METRICS NOT RECORDED: no change named`. The proof and gate lines carry no `--target`, and no line carries a base, a head or a carry flag: the target gives the root, the base and the head. The CLI checks that the worktree is at the pinned head.

9. Run the gate line, for the report's counts and the quality band. The autonomy line and the note line of §4 are not run: a blocker on a colleague's change must not reset this repository's own ladder or write into its notes.

10. Render the comment with the last line of the block above, and print it. When it fails, print `COMMENT NOT RENDERED:` with its reason, post nothing, and go to step 12. A comment that reads `REVIEW NOT PROVEN:` names a claim only a run could measure; `--run-code` is the remedy, and the skill does not add it.

11. Under `--post`, post the file with one command. Without `--post`, print `NOT POSTED:` and send nothing.

```bash
# GitHub — not exercised
gh pr comment <number> --body-file <dir>/comment.md
```

```bash
# GitLab — not exercised: read from the help text of one glab version, has posted nothing
glab mr note create <iid> --resolvable=false < <dir>/comment.md
```

   The GitLab note is posted from the comment file on standard input, never as an argument, and with `--resolvable=false` so it holds no merge back. A post that exits non-zero prints `POST FAILED:` with the platform CLI's message and the path of `<dir>/comment.md`. It is never run again and never sent another way: the skill cannot tell whether the platform took the comment, and a second attempt could post it twice. The person posts the file by hand or runs the review again.

12. Run `commands.worktreeRemove` as its printed `lines.worktreeRemove`. A failure prints `REVIEW WORKTREE LEFT:` with the path. The worktree is removed after any stop once it exists, including a stop on `REVIEW FAILED:`, a refused promote line and a failed post.

### What takes §1's place

| §1, on the author's path | Under `--pr` |
|---|---|
| Listing the person's own changes | Not run. The change is the one the person named, or none. |
| The author's own diff of the working tree | `commands.changed`, which diffs the pinned base against the worktree's head (step 5). |
| Stopping when that diff is empty | Stops when `commands.changed` prints no file, with `PULL REQUEST NOT REVIEWED: no changed files`. |
| `interlock surface --changed <files> --json` | The same command, reading the files of step 5 from `<dir>/changed.txt` with `--changed -`. |
| Reading the change's OpenSpec artifacts | Read under `<worktree>`. |
| Updating the graph with the author's diff | Step 6: a graph built inside the worktree and read with `--root <worktree>`. The person's own graph is never updated. |

The paragraphs of §1 that describe a flag, or what the CLI does with `REVIEW.md`, run no command and stay true.
