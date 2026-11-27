# What changed in Interlock since 1.18.0

*For junior engineers and people new to Interlock. This page covers **1.19.0** (2026-11-19), **1.20.0** (2026-11-25) and **1.21.0** (2026-11-26). [`CHANGELOG.md`](../../CHANGELOG.md) has the full list. This page explains what the changes mean for your daily work: your workflow, your token bill, and the quality of what comes out.*

---

## The short version

| If you… | What changed | What to do |
|---|---|---|
| write specs with `/interlock:spec` | By default, a second reader now reviews your artifacts, and it uses your repo's own review rules | Nothing. To save tokens on a small change, pass `--lean` |
| ship with `/interlock:ship` | Test-first runs no longer pay for checks that are red on purpose. A red **build** now stops the final gate | Check `build.command` in `.claude/testing/profile.json` |
| settle your PR with `/interlock:settle` | The PR description gains "Must Not Change" and "How to Roll Back" sections. A validation comment shows what actually ran. Each confirmation must cite a `path:line` | Keep the CLI at the same version as the plugin |
| review a teammate's PR | New: `/interlock:review-code --pr <ref>`. It is read-only and posts only with `--post` | Try it on your next review |
| read the merge verdict | Size now counts source lines only. Lint and build now count. An old `MERGE` reads `HUMAN` until the head is verified again | Re-run settle on open PRs |

---

## A two-minute refresher

Skip this if you already know the loop.

```
/interlock:spec  →  checkpoint (you read the spec)  →  /interlock:ship  →  /interlock:settle  →  merge
```

- **`/interlock:spec`** turns an idea into an OpenSpec change: proposal, design, tasks and delta specs. It then runs the **artifact gate**, a review of those documents that happens before any code exists.
- **`/interlock:ship`** builds the tasks in **waves** of parallel agents. It runs the tests between waves (**inter-wave checks**) and once at the end (the **final gate**), then commits.
- **`/interlock:settle`** reviews the PR, fixes what the review finds, verifies the result, writes the PR description and computes the **merge verdict**.
- **The merge verdict** is one of `MERGE`, `HUMAN` or `BLOCK`. It takes the worst band across a set of **signals**, for example `review.blockers`, `verify.suite`, `diff.shape` (size) and `conformance.*`. A signal that nobody could observe counts against you, not for you.
- **Reviewers and skeptics.** `/interlock:review-code` runs one reviewer per **dimension** (language, QA, regression and so on). Then **skeptics** try to refute every blocker and warning before you see it.
- **Numbers live in the CLI.** Caps, bands and thresholds are code. Read them with `interlock limits`. This page does not restate them, on purpose.

---

## What changes in your workflow

### 1. Writing a spec (1.21.0)

**Before:** the session that wrote your artifacts also reviewed them, using a generic web-app checklist built into the skill's text. Your repo's `REVIEW.md` never reached that gate.

**Now:**

- **An independent reader reviews by default.** `/interlock:spec` asks the CLI what depth its gate should run at (`--caller spec`), and the answer is `strict`. One `interlock:reviewer` subagent reads the artifacts in place of the session that wrote them. Pass `--lean` to get the old behaviour back for one run: the session reads the artifacts itself and spawns nothing. A standalone `/interlock:review-artifacts` keeps its own default.
- **The CLI writes the brief, and the brief carries your project's context.** `interlock review brief --artifacts <change>` prints the rubric, the **lenses** (`agentic-harness` and `web-ui`; choose them with `--lens <a,b>`), your repo's `REVIEW.md`, the living requirements and the compound notes.
- **A blocker must point at something.** Each blocker must cite a `line` or a `passage`, or it is reported under `malformed`. That means you can check every blocker yourself.
- **A re-gate reads only what changed.** The gate saves a snapshot of the change next to its findings. A `--since` re-gate prints a `Changed since` block, and a new finding may be raised only inside a changed hunk. Before this release, re-gating an uncommitted change read the whole change, because `git diff` shows nothing for untracked files. If no snapshot exists, the brief says so and scopes the re-gate by git instead.
- **Wording warnings.** `interlock validate --json` now flags requirement wording that a reader could not test. The skill prints each one as a warning, and a warning never stops the run.
- **A `REVIEW.md` suggestion line.** At the end of `spec` and `settle` you'll see a one-line summary from `interlock review-policy suggest`. It lists rules your `REVIEW.md` might gain, based on the evidence: spec problems that kept slipping through, gates that passed and were later overturned by another reader, and archived human decisions. It also lists checks that never caught anything. It writes nothing; the repo owner decides what goes into `REVIEW.md`. If the command fails, you see `REVIEW POLICY SUGGEST UNAVAILABLE:` instead of silence.
- A gate that produced no verdict prints `GATE UNAVAILABLE:`.

**What this means for you:** expect blockers you would not have received before. Most of them will be about your project's own rules and about code that consumes what you are changing. That is the gate doing its job early, when fixing a mistake means editing a paragraph rather than rewriting code.

> **Rule that still applies:** the gate runs **once** per spec run. If it blocks, fix the cited lines. Re-gate with `--since` only when the change's owner asks for it. A fresh reader of a large change always finds something more, so re-gating the whole change again and again never converges.

### 2. Shipping (1.19.0 and 1.20.0)

- **Test-first runs stop retrying checks that are red by design (1.19.0).** A test-first plan's `tasks.md` starts with a section of failing tests, and later sections make them pass. `/interlock:spec --tdd` forces this shape. The implementation often spans several waves, so every check before the last implementation wave was red by construction, and each one still got the full fix budget. Interlock now skips those checks, records why, and spends no verification slot on them.
  - *Trade-off:* a real regression in an early implementation wave shows up at the last check or the final gate, not at its own wave.
- **The first inter-wave check runs on a cheaper model (1.19.0).**

  | Step | Model | Effort |
  |---|---|---|
  | First inter-wave check | Sonnet | `medium` |
  | Fix attempt after a red check | your session model | `xhigh` |
  | Final check (the commit gate) | your session model | `high` |

  `interlock limits` prints these values, so you never need to remember them.
- **⚠️ Breaking: a red build halts the final gate (1.20.0).** There is a new `build` check kind, set by `build.command` and `build.timeout_ms` in `.claude/testing/profile.json`. It runs at the final gate only; between waves it appears as skipped with the reason `final-gate-only`. `/interlock:fix-tests` now fills `build.command` from your `package.json`'s `scripts.build` when it profiles a project. If your build is slow, set `build.timeout_ms`. To opt out, remove the key.
- **⚠️ Breaking: a lint result must carry an exit code (1.20.0).** A lint result without an `exitCode` is refused. A red lint now lowers the merge verdict to amber. Before, it printed one warning line that nothing read.

### 3. Settling your PR (1.20.0)

- **A fuller PR description.** The first line under `## Summary` names the OpenSpec change. There are two new sections:
  - `## Must Not Change`: what the change leaves alone, and how that was checked.
  - `## How to Roll Back`: three labelled lines, `Undo:`, `Not undone by a revert:` and `Order:`.

  `## Prerequisites to Production` now splits into `Before merging:` and `Before deploying:`. Then `interlock settle description-check` reads the description the platform holds and reports any section that is missing, empty or a bare `None`. Settle republishes an incomplete description once and never stops the loop over it.
- **A validation comment beside the findings.** `/interlock:settle --review` posts `## Validation — <sha>`. It lists the commands the pass ran, with the exit codes and durations the CLI itself observed (through `interlock verify exec --record`, so the model never types them), the platform's checks, each confirmation with its citation, what none of these checks would catch, and the changed screens that still need a visual check. It holds no verdict and no score.
- **⚠️ Breaking for verdicts: a confirmation must cite where it holds.** The conformance worker must give a `path:line` at the head, inside the repo and outside the specs, for each requirement it confirms. A worker's say-so alone now reads amber. Look for `CONFIRMATION NOT CITED:` lines.
- **Every verification step gets its own time allowance.** A step that hits its timeout counts as a failed step. The allowance is a floor, so a slow suite that passes is never cut off early.

### 4. Reviewing code (1.20.0)

- **Review a teammate's PR, read-only.** `/interlock:review-code --pr <ref>` runs the same engine (rubrics, skeptics, proof of coverage) on a colleague's open PR, from a detached worktree of its pinned head. It prints one comment, weighted `Important`, `Pre-existing` and `Nit`, and posts it only when you pass `--post`. Pass `--run-code` to let the reviewers run the PR's own code. On this path the skill never pushes, approves, edits labels or the description, or touches your own working tree, and it refuses fork PRs. See [docs/17](../17-reviewing-a-teammates-pull-request.md).
  - *Caveat:* no platform command on this path has run against a real PR yet, and the GitLab commands are marked as not exercised.
- **Reviewers are now limited by an agent type.** The review loop's readers run as `interlock:reviewer`, which can use only `Read`, `Grep`, `Glob` and `Bash`. Before, they inherited every tool the session had. On one recorded PR, a confirmation worker spawned seven agents of its own, and nobody saw their token bill. If the type is missing (the plugin is older than the skill), the review stops and says so (`REVIEW FAILED: reviewer type unavailable`). It never falls back to an unlimited agent.
- **Tools own the small checks.** Each reviewer's prompt now says that formatting, lint rules and type errors belong to your project's tools. A real defect that such an error causes or hides is still a finding.
- **Unread docs no longer cost the verdict like unread code.** A reviewer can now attach the file paths to an `unread` entry. When every one of them is prose, meaning outside `openspec/` and `.claude/`, not `REVIEW.md` itself, and not under `## Counts as Source`, `review.ran` raises the flag `prose-unread` instead of reading amber.
- **Safer path handling.** A file name containing a control character is quoted in every prompt, so it cannot inject a line. Your personal git diff settings (an external diff tool, `noprefix` and similar) no longer break the review's scope. Paths with spaces or non-ASCII characters are read by their real names.

### 5. Reading the merge verdict (1.20.0)

- **Size counts source lines only.** `diff.shape` puts each changed file in one class: source, test or prose (documentation plus the whole `openspec/` tree). The line and file caps apply to source alone.
  - *Why:* the size signal was amber on all 19 recorded assessments. On the last eight merged PRs, 72–98% of the changed lines were tests, OpenSpec artifacts and docs. A signal that never changes tells you nothing. With the split, four of those eight PRs clear the caps; one did before.
  - *Your lever:* list paths that are really source, such as a prompt directory or `requirements.txt`, under `## Counts as Source` in `REVIEW.md`. This repo lists `skills/`, `agents/` and `shared/`.
  - *Caveat:* this loosens a gate. A docs-only PR reads green on size at any length.
- **The suite signal reads four results**: type check, unit tests, lint and build. When a tool is absent, it raises the flags `no-lint` and `no-build`.
- **An old `MERGE` reads `HUMAN` until the head is verified again.** A verdict recorded on 1.19.0 or earlier has no build result, so `verify.suite` reads unobserved. If a CI job re-reads stored verdicts, upgrade the CLI and the plugin together.

---

## Effect on token usage

Some of these changes spend fewer tokens, and one deliberately spends more. **Nobody has measured the net effect yet.** Here is where each change pushes.

### Where you spend fewer tokens

| Change | Why it saves | Evidence |
|---|---|---|
| Skipping red-by-design inter-wave checks (1.19.0) | No verify agent, no full suite run and no fix attempts against tests for code that doesn't exist yet | In one recorded run, three waves produced nine red checks with identical failures, plus six `xhigh` Opus fix attempts that edited no file. All eight fix attempts recorded across 39 runs faced code not yet built, and none edited a file |
| First inter-wave check on Sonnet `medium` (1.19.0) | A cheaper model for a step that mostly runs one command and reports | 24 of the 26 readable first checks only ran the suite and reported |
| The `interlock:reviewer` agent type (1.20.0) | A reader can no longer spawn agents, invoke skills or call MCP servers, so no hidden extra spend | The confirmation worker that spawned seven unreported agents |
| Re-gates scoped by snapshot (1.21.0) | A `--since` re-gate reads the changed hunks, not the whole change | Before, re-gating an uncommitted change read all of it |
| Tools own the small checks (1.20.0) | Fewer findings about formatting or lint, so less for the skeptics to refute | Expected, not measured |
| The description brief points to sources instead of quoting them (1.20.0) | `settle description-brief` names where each section's source sits and doesn't repeat it | A design choice, not measured |

### Where you spend more tokens

| Change | Cost | How to control it |
|---|---|---|
| Strict artifact gate by default in `/interlock:spec` (1.21.0) | One reviewer subagent per spec run, reading roughly 10–15K tokens of brief plus your artifacts. **It inherits your session's model and effort**, so a spec run on a heavy model pays for a heavy reader too | Pass `--lean` for that run |
| Project context in the artifact brief (1.21.0) | Every artifact gate's prompt is larger: `REVIEW.md` checks, living requirements, compound notes and lenses | The caps in `interlock limits` bound each part |
| Teammate PR review (1.20.0) | A full review run. This is new usage, and you choose when to run it | Runs only when you start it |
| Build at the final gate (1.20.0) | Mostly wall-clock time. It costs tokens only when a red build needs fixing | `build.timeout_ms`, or remove the key |
| Three new eval cases (1.21.0) | Metered trials, but only when someone starts the full eval job by hand with a credential | Doesn't affect normal use |

The validation comment and the description checks are rendered by the CLI, which is plain code with no model involved. They add platform calls, not tokens. The one exception is a single republish when the first description came out incomplete.

### Keeping your own costs down

- **Leave `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_EFFORT_LEVEL` unset.** Either one, when set, overrides the per-step routing for every agent. That undoes the cheaper first check, among other savings. The run prints a banner when this happens.
- **Ask before you start.** `interlock suggest <skill>`, for example `interlock suggest spec`, prints the session model and effort that suit a skill, and tells you whether your current session is above or below that.
- **Use `--lean` for small, low-risk specs.** Keep the strict default for anything that touches shared code or something a user can see.
- **Don't re-gate unless the owner asks.**
- **Measure instead of guessing.** `interlock report` (or `/interlock:report`) now splits the review indicators by stage and by reader, so you can see what the strict gate costs and catches in your own repo.

---

## Effect on code quality

### What gets better, and why we think so

- **Someone other than the author catches spec problems.** The project's records cover 65 artifact gates with 54 blockers between them. 18 of those blockers were harness hazards the old checklist never named. 9 were consumers or living requirements that sit in project context the gate couldn't see. And 3 gates that passed were later overturned by a different reader. The strict default and the project-aware brief target exactly these gaps.
- **Findings and confirmations you can check.** An artifact blocker must cite a line or a passage, and a conformance confirmation must cite a `path:line`. A claim without a citation no longer counts as green.
- **A change that doesn't build can't be shipped.** Before 1.20.0 there was no build check at all. A broken build was caught only if CI happened to run one.
- **Lint now counts.** A red lint lowers the verdict instead of printing a line nobody read.
- **Reviewers spend their attention on real defects**, not on style a linter already decides.
- **PRs are easier to review and to undo.** "Must Not Change" tells the reviewer what to protect. "How to Roll Back" says how to undo the change and what a revert won't undo. The validation comment shows the real commands and exit codes, not the model's summary of them.
- **A merge verdict that tells you something.** The size signal used to read amber 19 times out of 19. Now it reflects how much source a person actually has to read.

### Trade-offs, and what isn't proven yet

- A test-first run reports a regression from an early implementation wave later than before.
- Sonnet at `medium` hasn't been measured on the first verify check, and that check's verdict rests on what the agent reports. The final check still runs on your session model.
- The size signal is looser now: a docs-only PR reads green on size at any length.
- `prose-unread` has had no measured effect so far. It won't change any verdict until reviewers stop declaring other kinds of unread input.
- The wording lint has caught no confirmed real problem in this repo yet. It is expected to help most in other repos that use Interlock.
- `--pr` hasn't yet posted to a real PR on either platform.
- **Stricter rules mean more amber at first:** confirmations without citations, lint without exit codes, old verdicts reading `HUMAN`. These mean the bar went up, not that your code got worse.

---

## Upgrade checklist

1. **Keep the plugin and the CLI on the same version.**
   ```bash
   ! interlock --version
   ! interlock doctor        # the cli-version row says which CLI is on PATH
   npm install --location=global @renzrollon/interlock@1.21.0
   ```
   An older CLI rejects the new flags settle uses (`verify exec --record`, `conformance-brief --out`) and exits with code 2. The skill then says the CLI is older than the skill and stops. It never records that exit as a failed suite.
2. **Check `.claude/testing/profile.json` for `build.command`.** Keep it (recommended), set `build.timeout_ms` if your build is slow, or remove the key to keep the old final gate.
3. **Include `exitCode` for lint** if you hand-write `results.json` or run a custom verify step.
4. **Re-verify open PRs** whose verdict was recorded on 1.19.0 or earlier, with `/interlock:settle --review`.
5. **List source paths that look like prose** (prompt directories, `requirements.txt`) under `## Counts as Source` in `REVIEW.md`.
6. **Expect one extra reviewer spawn** for each `/interlock:spec` run.

---

## Common questions

**"My PR said `MERGE` last week. Now it says `HUMAN`. Did I break something?"**
Probably not. A verdict recorded before 1.20.0 has no build result, so `verify.suite` reads unobserved. Run settle on the head again.

**"Ship halted at the final gate on the build."**
It's a real failure: the change doesn't build. Fix it. If the build passes but takes longer than your shell tool's default timeout, set `build.timeout_ms`.

**"Conformance went amber, but the worker said everything was confirmed."**
The worker's own counts are kept under `claimed`. Only rows whose citation resolves to a real file and line at the head count as confirmed. Look for `CONFIRMATION NOT CITED:` lines.

**"The spec gate found blockers it never found before."**
A separate reader now reviews the spec, and it sees your repo's `REVIEW.md`, living requirements and compound notes. Every blocker cites a line, so check the line, then fix it or push back.

**"What is the `REVIEW POLICY SUGGEST` line?"**
Advice for the repo owner. Nothing is written. Read it, and raise anything that looks right with whoever owns `REVIEW.md`.

**"Can I use Interlock to review a teammate's PR without touching it?"**
Yes: `/interlock:review-code --pr <ref>`. Without `--post`, it prints `NOT POSTED:` and sends nothing.

---

## Read more

- [`CHANGELOG.md`](../../CHANGELOG.md): the 1.19.0, 1.20.0 and 1.21.0 entries, including each release's **Upgrading** notes
- [16 — Upgrading](../16-upgrading.md)
- [17 — Reviewing a teammate's pull request](../17-reviewing-a-teammates-pull-request.md)
- [15 — Merge confidence](../15-merge-confidence.md): every signal and flag
- [12 — Repository review policy](../12-repository-review-policy.md): `REVIEW.md` and `## Counts as Source`
- [10 — The agentic workflow: ship and spec](../10-agentic-workflow-ship-and-spec.md)
- [04 — When it stops](../04-when-it-stops.md): what each halt means and how to get past it
