---
name: mr
description: Generate a merge-request or pull-request summary from the change artifacts and diff, then create or update it on whichever platform the remote points at — GitLab via glab, GitHub via gh — and, with --review, review its diff, fix the findings in rounds that commit and push, reply, confirm and verify the pushed head before assessing it, with the CLI's merge-confidence verdict in the description and as labels. Optional comment-only add-ons post the manual test plan or a teaching walkthrough. Use when opening an MR/PR, refreshing its description, re-assessing it after new commits, or attaching a test plan.
license: MIT
compatibility: Requires git, plus glab (GitLab) or gh (GitHub) authenticated. Optional openspec CLI for change context.
argument-hint: "[change-name] [--create] [--review] [--test-plan] [--explain] [--confidence-comment] [--gate-check <name>]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(glab *) Bash(gh *) Bash(openspec *) Bash(interlock *) Bash(interlock-graph *) Bash(rm -rf .claude/ship/mr) Bash(rm -f .claude/ship/mr/coverage.json) Bash(cp .claude/testing/profile.json .claude/ship/mr/profile-r*.json) Bash(cmp -s .claude/testing/profile.json .claude/ship/mr/profile-r*.json) Bash(cp .claude/ship/mr/profile-r*.json .claude/testing/profile.json) Bash(rm -f .claude/testing/profile.json) Bash(test -s .claude/ship/mr/verify.json.tmp) Bash(mv .claude/ship/mr/verify.json.tmp .claude/ship/mr/verify.json) Bash(rm -f .claude/ship/mr/verify.json.tmp) Agent Read Write Grep Glob
metadata:
  type: generation
  outputs:
    - openspec/changes/<change>/mr-summary.md
---

Turn a finished change into a merge request a reviewer can actually review.

Almost all of this skill is platform-agnostic — the summary, the narrative, the test plan. Reading the checks and publishing differ between GitLab and GitHub, so **detect the platform, do not ask about it.**

The merge-confidence verdict in the description, and the labels beside it, are **what the CLI computed, for the commit the platform holds.** You run the commands, paste the block they print and apply the labels they name. You never state a confidence of your own, never re-derive a band or a score, and never write a label name: this file carries none.

**This skill never merges and never approves a merge request**, never requests changes on one and never resolves a review thread. What a label means for merging is the platform's policy, and the skill's part ends at the label. `MERGE` is a statement about the local signals the command read, not about the platform's branch rules: required checks, required approvals, code owners, a draft state, unresolved review threads and a merge queue can each still hold the merge request, and the verdict reads none of them.

| Flag | Effect |
|------|--------|
| `--create` | Push the branch, then create the MR/PR instead of updating an existing one (§4). With `--review` it is created as a draft |
| `--review` | Once the merge request exists, run the review loop (§5): review its diff, post the findings, fix them in rounds that commit and push, reply, confirm the scenarios, verify the head and wait for the checks, then assess with that evidence |
| `--test-plan` | Also post the full manual test plan **as a comment** |
| `--explain` | Also post a per-file teaching walkthrough **as a comment** |
| `--confidence-comment` | Also post the merge-confidence block **as a comment**, so each assessment leaves one entry in the timeline naming its commit |
| `--gate-check <name>` | Leave the check of that exact name out of the pipeline input. Repeatable. For the check whose own result waits on the verdict; see §6 |

---

## 1. Detect the platform

```bash
git remote get-url origin
```

| Remote host contains | Platform | CLI | Check |
|---|---|---|---|
| `gitlab` | GitLab | `glab` | `glab auth status` |
| `github` | GitHub | `gh` | `gh auth status` |

Self-hosted instances often carry neither string — fall back to whichever CLI is installed and authenticated, and say which one you chose. If both or neither resolve, ask once; this is a genuinely ambiguous fact about the user's setup, not a default you can pick.

---

## 2. Resolve the MR/PR and the change

```bash
# GitLab
glab mr view 2>/dev/null
# GitHub
gh pr view 2>/dev/null
```

No open MR/PR and no `--create` → stop: *"No open merge request for this branch, and nothing was pushed: re-run with `--create` to push the branch and create one."* Without `--create` this skill never pushes a branch that has no merge request.

Resolve the OpenSpec change with `interlock changes` and the branch name. If several are plausible, ask which one — a wrong change here produces a confidently wrong description.

Note the merge request's number (GitHub) or iid (GitLab) and its **target branch as the platform reports it** (`gh pr view --json number,baseRefName`; `target_branch` in `glab mr view --output json`). Both are needed below. Never guess the target branch from a local branch name.

---

## 3. Gather

```bash
git diff --stat <base>...HEAD
git diff --name-status <base>...HEAD
git log --oneline <base>...HEAD
```

Read `proposal.md` (the why), `design.md` (the how), `tasks.md` (what was done), and `specs/**/*.md`. Use `interlock-graph consumers <symbol>` to check blast radius when the graph exists.

Then fetch the target branch, so the verdict is judged against what the platform will merge into:

```bash
git fetch origin <target branch>
```

---

## 4. Push and create (`--create`)

Only with `--create`, and only when §2 found no merge request for the branch. A merge request cannot be created from a branch the platform does not have, so push first:

```bash
# the branch has no upstream yet (git rev-parse --abbrev-ref @{upstream} fails)
git push -u origin HEAD
# the branch has an upstream and the local head is ahead of it
git push
```

A push that fails stops the skill: report the platform's message and create nothing.

Then create the merge request with its title and the description composed so far from §3, leaving out `## Merge confidence`: there is no verdict yet, and §9 replaces the description once there is. **With `--create --review` it is created as a draft**, because code owners are not requested on a draft: they are asked once, when the loop marks it ready after its last push (§5), for the head they will read. A merge request created without `--review` is created ready, as before.

The description travels in a quoted heredoc, so nothing in it is expanded or read as an argument by the shell:

```bash
# GitHub — with --create --review: a draft
gh pr create --draft --title "<title>" --body-file - <<'EOF'
<description so far>
EOF
# GitHub — with --create alone: a merge request created without --review is created ready
gh pr create --title "<title>" --body-file - <<'EOF'
<description so far>
EOF
```

```bash
# GitLab — not exercised: written from glab's documentation; the GitHub lines are the ones this repository runs
# with --create --review: a draft
glab mr create --draft --title "<title>" --description "$(cat <<'EOF'
<description so far>
EOF
)"
# with --create alone: created ready
glab mr create --title "<title>" --description "$(cat <<'EOF'
<description so far>
EOF
)"
```

Then read the new merge request's number or iid and target branch as §2 does.

---

## 5. The review loop (`--review`)

Only with `--review`, and only once the merge request exists (§2 found it, or §4 created it). Without `--review` the skill runs nothing in this section: it assesses as before, and passes no file from `.claude/ship/mr/` to the assessment.

**The GitHub lines of this section are not exercised end to end** until task 8.5 of `close-the-merge-request-loop` records a run of the whole loop on a live pull request: each command is tested on its own, the loop as a whole is not. The GitLab lines carry their own `not exercised` markers.

The loop produces its evidence in a fixed order, and each step depends on the one before: a review of the merge request's diff, the findings comment, fix rounds that each commit, push, re-review the pushed head and reply, the ready mark, the confirmation, the verification, the platform's checks, and only then the assessment. Everything it writes lives under `.claude/ship/mr/`.

**Stopping early.** Some steps below stop the loop early: the working tree is not clean, the platform does not hold the local head, a round fails, the fixer commits, a push fails. Each prints its own line. Then nothing more is committed or pushed, and the rest of §5 is skipped except the draft check of §5d: no ready mark, no confirmation, no verification, no wait for the checks. Go on to the assessment (§6), and pass it only the records this pass wrote.

**The working tree is clean.** Every step below that stages, reverts, commits or pushes assumes the only changes in the tree are the fixer's, so the loop starts only from a clean tree:

```bash
git status --porcelain=v1 -z --untracked-files=all | interlock mr tree-check --change <change> --status -
```

Exit 0 prints `clean`, or `clean (tolerated: …)` naming the files this skill itself writes into the tree. **Exit 1 means the loop does not start.** Print `WORKING TREE NOT CLEAN: <paths> — the review loop did not start; nothing was committed or pushed`, naming the paths it listed (or the refusal it printed on standard error), and stop the loop early. **When `git status` itself printed an error, the tree was not read**: the check reads empty input as clean, so treat it as not clean, and print `WORKING TREE NOT CLEAN` with git's message in place of the paths, as for exit 1. The assessment still runs, and is passed nothing from `.claude/ship/mr/`: whatever is there an earlier pass wrote. Never stash, commit, restore or delete the person's changes to make the tree clean.

A pass that starts clears that directory, so no round of an earlier pass outlives this one:

```bash
rm -rf .claude/ship/mr
```

**The platform holds the head.** The review, every round and the verdict describe the local head, so the platform has to hold it before anything is reviewed:

```bash
gh pr view <n> --json headRefOid --jq .headRefOid
git rev-parse HEAD
```

```bash
# GitLab — not exercised: `sha` in this document is the merge request's head commit
glab mr view <iid> --output json
```

When the two differ, print `HEAD NOT ON THE PLATFORM: local <local sha>, platform <platform sha>`, naming both, and stop the loop early. With `--create`, §4 already pushed the branch; without it, pushing is the person's call, and nothing in §5 pushes before a round has committed.

Below, `<sha>` is the head the step describes, `git rev-parse HEAD` at that step: after each push it is the commit the platform holds. `<n>` and `<iid>` are the merge request's number and iid from §2, and `<target branch>` its target as the platform reports it.

### 5a. Review the merge request's diff

```text
/interlock:review-code <change> --base origin/<target branch> --out .claude/ship/mr/review-r0.json
```

The review record lands in that file, bound to the head it reviewed.

### 5b. Post the findings

The comment is what the command rendered, never one you write. A review with no surviving finding still renders a comment saying it ran on `<sha>`, and it is posted all the same:

```bash
# GitHub
interlock mr comment --review .claude/ship/mr/review-r0.json --head <sha> --round 0 | gh pr comment <n> --body-file -
```

```bash
# GitLab — not exercised
glab mr note <iid> --message "$(interlock mr comment --review .claude/ship/mr/review-r0.json --head <sha> --round 0)"
```

When `interlock mr comment` exits non-zero it rendered nothing, and nothing is posted: print `ROUND FAILED: <reason>` with the reason from standard error, and stop the loop early.

### 5c. Fix, round by round

For round `r = 1, 2, …`, run the steps below in order. A round either runs to its end, ends the loop, or stops it early; it never skips a step to carry on.

**The tree is still clean.** A stray file the review left behind would be swept into this round's commit, so check again before the round does anything:

```bash
git status --porcelain=v1 -z --untracked-files=all | interlock mr tree-check --change <change> --status -
```

Exit 1, or a `git status` that printed an error (the tree was not read): print `WORKING TREE NOT CLEAN: <paths> — round <r> did not start; nothing was committed or pushed`, with git's message in place of the paths when it failed, and stop the loop early.

**Snapshot the test profile.** `.claude/testing/profile.json` is gitignored, so HEAD cannot restore it if the fixer changes it. When it exists (Glob for it), copy it:

```bash
cp .claude/testing/profile.json .claude/ship/mr/profile-r<r>.json
```

**Ask for the round's briefing**, with the snapshot as its profile; with no snapshot, leave `--profile` out:

```bash
interlock mr remediate-brief --review .claude/ship/mr/review-r<r-1>.json --round <r> --change <change> --head <sha> --pr <n> --profile .claude/ship/mr/profile-r<r>.json
```

**The loop runs while this exits 0, and ends only on the CLI's stop rule:** exit 1 with standard error beginning `interlock: STOP: ` (nothing left to fix, the round cap reached, a verdict that halts the rounds). Report the reason after `STOP:`; the loop ends, and goes on to §5d. Any other non-zero exit is a failure, never a stop: print `ROUND FAILED: <reason>` and stop the loop early. The cap is the CLI's: never count rounds against a number of your own.

**Record the head** before the fixer runs:

```bash
git rev-parse HEAD
```

**Spawn ONE `general-purpose` subagent with the printed briefing as its whole prompt.** It fixes the listed findings, writes `.claude/ship/mr/remediate-r<r>.json`, and does not commit. It runs with no ship guards: there is no stage marker, so the hook that refuses test edits does not fire, and the revert below is the only protection the tests have. Do not fix anything yourself, and do not review the fixer's work: the fresh review below does.

**The head did not move.** Read it again:

```bash
git rev-parse HEAD
```

When it is no longer the head you recorded, the fixer committed: print `FIXER COMMITTED: <before>..<after> — round stopped, nothing pushed`, and stop the loop early. Leave its commit where it is: do not reset, amend or push it.

**The fixer answered.** Check its result against the findings it was briefed:

```bash
interlock mr fixer-result --result .claude/ship/mr/remediate-r<r>.json --review .claude/ship/mr/review-r<r-1>.json --round <r> --head <sha>
```

Exit 1 (the result is missing, unparseable or `ok: false`, or its ids do not partition the findings it was briefed) fails the round: print `ROUND FAILED: <reason>`, commit nothing, and stop the loop early. The fixer's edits are left in the working tree, unstaged and unreverted: say so, and name them.

**The test profile is unchanged.** When there was a snapshot, compare the profile with it:

```bash
cmp -s .claude/testing/profile.json .claude/ship/mr/profile-r<r>.json
```

A non-zero exit means the fixer changed or removed the profile. When there was no snapshot and the fixer created one (Glob for it), it changed too. Either way put it back, running only the one line below for the case that holds, and print `TEST PROFILE CHANGED — restored`.

When there was a snapshot, restore it:

```bash
cp .claude/ship/mr/profile-r<r>.json .claude/testing/profile.json
```

When there was no snapshot, remove the profile the fixer created:

```bash
rm -f .claude/testing/profile.json
```

**Stage the round.** The tree was clean when the round started, so everything the fixer left is the round's; only the files the tree check tolerates are left out:

```bash
git add -A -- . ':(exclude)openspec/changes/<change>/mr-summary.md' ':(exclude)docs/notes/compound.md'
```

Then classify every staged path, with the snapshot as the profile (with no snapshot, leave `--profile` out):

```bash
git diff --cached --name-only -z | interlock mr test-paths --changed - --profile .claude/ship/mr/profile-r<r>.json --json
```

**Only when it lists something under `protected`**, revert those paths from HEAD, in the index and the working tree; this also removes a protected file the fixer created. With nothing listed there is no path to restore, and `git restore` exits 128 on an empty list.

```bash
git diff --cached --name-only -z | interlock mr test-paths --changed - --profile .claude/ship/mr/profile-r<r>.json --protected-only --nul | git --literal-pathspecs restore --staged --worktree --source=HEAD --pathspec-from-file=- --pathspec-file-nul
```

The paths pass from one command to the next NUL-terminated and are read literally, so none is retyped and none is read as a pattern. Then print `REMEDIATION TOUCHED TESTS: <files> — reverted`, naming them, and run the classify line again. If it still lists anything under `protected`, the revert did not hold: print `TESTS STILL STAGED: <files>`, commit nothing, and stop the loop early; the round's changes are left staged. When `profile` is null, nothing is protected: print `TEST PATHS UNKNOWN: <reason>` with the reason it gave, and revert nothing.

Then check whether anything is left to commit:

```bash
git diff --cached --quiet
```

**Exit 0 means the round changed nothing it can keep.** Commit nothing and push nothing: pushing nothing is not a round. Render the reply table from the round's own review on both sides, so every finding reads `open`, post it, and end the loop:

```bash
interlock mr replies --before .claude/ship/mr/review-r<r-1>.json --after .claude/ship/mr/review-r<r-1>.json --head <sha> | gh pr comment <n> --body-file -
```

Otherwise commit the round, naming the merge request and the round, and push it:

```bash
git commit -m "fix(review): answer the PR #<n> review round <r>" -m "Refs: #<n>"
git push
```

A push changes the merge request on the platform, and the skill says so once, beside the first round's push: a new commit dismisses the stale approvals a ruleset marks, and takes the merge request out of auto-merge or a merge train. The loop's verdict restores neither, and this skill does not re-request a review.

**A push that fails ends the loop**, and stops it early: report the platform's message. The commit stays local, the merge request is not marked ready, and the assessment will say the pipeline describes another commit.

Review the pushed head, independently of the fixer:

```text
/interlock:review-code <change> --base origin/<target branch> --out .claude/ship/mr/review-r<r>.json
```

Post what each finding of the round before became, `fixed`, `open` or `new`, as the command rendered it:

```bash
interlock mr replies --before .claude/ship/mr/review-r<r-1>.json --after .claude/ship/mr/review-r<r>.json --head <sha> | gh pr comment <n> --body-file -
```

```bash
# GitLab — not exercised: GitLab has no reply-to-comment primitive here, so each table is a new note
glab mr note <iid> --message "$(interlock mr replies --before .claude/ship/mr/review-r<r-1>.json --after .claude/ship/mr/review-r<r>.json --head <sha>)"
```

When `interlock mr replies` exits non-zero it rendered nothing, and nothing is posted: print `ROUND FAILED: <reason>` and stop the loop early. Otherwise the next round, from `review-r<r>.json`.

### 5d. Mark it ready

Read whether the merge request is a draft. This runs on every pass with `--review`: a re-run on a merge request an earlier pass created as a draft, and a loop that stopped early, included.

```bash
gh pr view <n> --json isDraft --jq .isDraft
```

When it is a draft that this pass created (§4) and the loop ended without stopping early, mark it ready now, after the last push, whatever the verdict will be. Ready says the loop is finished; the verdict and the labels say the rest.

```bash
gh pr ready <n>
```

```bash
# GitLab — not exercised
glab mr update <iid> --ready
```

When it is a draft and the loop stopped early, leave it a draft, and say in the report that it is still a draft and why: the loop did not start, the head was not on the platform, a round failed, the fixer committed, a push failed. Code owners are asked when it is marked ready, so it is marked ready only for a head the loop finished.

When it is a draft this pass did not create (a re-run after an interrupted pass, or a draft the person opened), leave it a draft as well, and say that it is still a draft because this pass did not create it, so marking it ready is the person's call (`gh pr ready <n>`). Never leave a draft unmentioned.

### 5e. Confirm the scenarios

`<files>` is the changed-file list of §3, read again now against `origin/<target branch>`, because the rounds may have added to it.

```bash
interlock mr conformance-brief <change> --changed <files> --base origin/<target branch> --head <sha>
```

Spawn one worker with the printed briefing as its whole prompt. It answers into `.claude/ship/mr/handoff.json`, with the head beside the counts. When it exits 0 with nothing on standard output and `nothing to confirm` on standard error, there is nothing to confirm: spawn no worker and write no handoff. Exit 1 names a change it could not resolve: report it, and write no handoff.

### 5f. Verify the head

Plan the final verification, run each planned step exactly as the plan gives it, then judge the results for this head:

```bash
interlock verify plan --profile .claude/testing/profile.json --context final --changed <files> --json > .claude/ship/mr/plan.json
interlock verify exec --kind <kind> --command "<command>"
interlock verify judge --plan .claude/ship/mr/plan.json --results .claude/ship/mr/results.json --context final --head <sha> --json > .claude/ship/mr/verify.json.tmp
test -s .claude/ship/mr/verify.json.tmp && mv .claude/ship/mr/verify.json.tmp .claude/ship/mr/verify.json || rm -f .claude/ship/mr/verify.json.tmp
```

With no profile, plan with `--no-profile` in place of `--profile`. Run `interlock verify exec` once per step the plan lists, each with the Bash tool's timeout set to the profile's `unit.timeout_ms` (or the tool's own maximum, when that is lower); with no profile, leave the tool's default. Write one `{ kind, exitCode }` entry per step, with the counts you can read, to `.claude/ship/mr/results.json`. A step the tool killed at its timeout is recorded as failed, with a non-zero `exitCode`, and the report names the step and the timeout as the reason.

The judge writes to a temporary file, and the `test -s` line moves it into place only when it holds something. An exit 1 from `verify judge` with a verdict on standard output is a halting verdict, not a failed command: the file is kept, and the assessment reads it. An exit with nothing on standard output leaves an empty file, which the same line removes, so an empty verification record never lands.

When the plan ran a coverage step, compute the coverage figures for this head:

```bash
interlock verify coverage --base origin/<target branch> --json > .claude/ship/mr/coverage.json || rm -f .claude/ship/mr/coverage.json
```

A non-zero exit printed nothing: report its reason. When the plan skipped coverage, write no coverage file; the skip in the verdict is what the coverage signal reads.

### 5g. Wait for the platform's checks

```bash
gh pr checks <n> --watch
```

Run it with the Bash tool's `run_in_background`: the wait can outlast the tool's timeout, and you are told when it exits.

```bash
# GitLab — not exercised: poll the merge request's head pipeline until its status is neither running nor pending
glab ci get --merge-request <iid> --output json
```

Not `glab ci status --live`: it follows the branch pipeline, and GitLab's merge check reads the merge request's. The exit status of the wait reports the checks, so a non-zero exit is not an error. When it ends with checks still running or queued, print `CHECKS STILL PENDING` and say so in the report. Whatever it reports, read the pipeline input again from the platform's own document, for the pushed head, exactly as §6a gives it, and only then assess.

---

## 6. Assess merge confidence

The assessment reads the merge request's own checks and head commit, so the merge request has to exist. With `--create` it was created in §4, and publishing it in §9 is an update.

**The assessment reads nothing from the merge request's title, description or comments.** It is handed the change, the base, the platform's checks, the run's evidence file when there is one, and, with `--review`, the records the loop (§5) wrote for the pushed head.

### 6a. The pipeline input

Pipe the platform's own document into `interlock pipeline`. Do not write the pipeline file by hand, and do not type a check's state or a commit: the command reads both from the document.

**GitHub.** First ask which checks are required:

```bash
gh pr checks <n> --required --json name
```

The exit status of `gh pr checks` reports the checks, so a non-zero exit is not an error: with no required check it prints nothing and exits non-zero. Pass each name it printed as its own `--required` flag:

```bash
gh pr view <n> --json headRefOid,statusCheckRollup | interlock pipeline --github - --required "<name>" --out .claude/ship/pipeline.json
```

**GitLab.** Two steps, and the head commit travels between them in the file:

```bash
glab mr view <iid> --output json | interlock pipeline --gitlab-mr - --out .claude/ship/pipeline.json
```

When that printed `pending <sha>: head pipeline <id>`, the merge request has a head pipeline, and the second step reads it:

```bash
glab ci get --merge-request <iid> --output json | interlock pipeline --gitlab - --mr .claude/ship/pipeline.json --out .claude/ship/pipeline.json
```

When the first step printed `pipeline <sha>: 0 check(s)` instead, there is no pipeline and no second step.

**`--gate-check <name>`** becomes `--exclude "<name>"` on the `--github` or `--gitlab` line, one `--exclude` per name. Exclude only a check the person named with `--gate-check`. A failing check nobody named stays in the input, and the verdict reflects it.

A non-zero exit of `interlock pipeline` stops the assessment: it printed nothing, and it removed any earlier file at the output path, so there is no pipeline input to pass. Report the reason from standard error, write no `## Merge confidence` section and apply no label. The rest of the description is still published, and §9b still takes off the labels an earlier assessment left.

### 6b. The verdict

```bash
interlock merge-confidence <change> --base origin/<target branch> --pipeline .claude/ship/pipeline.json --run .claude/ship/merge-confidence.json --review .claude/ship/mr/review-r<last>.json --verify .claude/ship/mr/verify.json --handoff .claude/ship/mr/handoff.json --coverage .claude/ship/mr/coverage.json --json
```

- Pass `--run .claude/ship/merge-confidence.json` only when that file exists (Glob for it). It is the evidence a ship run's close wrote. The command decides whether it may be used, and says why on standard error when it takes nothing from it, or when it carries the run record to a later commit and drops the rest: report that reason.
- Pass `--review`, `--verify` and `--handoff` only with `--review`, and only for files this pass of the loop wrote. `<last>` is the round of the last re-review (§5c), the highest-numbered `review-r<r>.json` in `.claude/ship/mr/`: the record whose head is the pushed head. It is `review-r0.json` only when no round pushed a fix. Pass `--handoff` only when §5e wrote the file.
- Pass `--coverage .claude/ship/mr/coverage.json` under the same condition as `--run`: only when that file exists (Glob for it), which is only when the loop's verification ran a coverage step (§5f).
- The command refuses a review, verification or handoff record that describes another commit, and says so on standard error: report that reason.
- Without `--review`, pass nothing from `.claude/ship/mr/`. Never pass a review, verification, handoff or coverage file left in the working directory by any other means.
- When no change resolves, the command says so and the signals that need one read amber. Report that. Do not guess a change.

Read the JSON by key:

| Key | What it is |
|-----|------------|
| `verdict` | **The field that decides**: `MERGE`, `HUMAN` or `BLOCK` |
| `score` | The score, bounded by the worst band |
| `driving` | Every signal that stands between the change and `MERGE`, each with its reason and whether a fix, a person or more evidence would lift it |
| `flags` | What lowers the score without holding the verdict |
| `labels` | The two labels to apply (`labels.verdict`, `labels.score`) and how to recognise their predecessors (`labels.verdictNames`, `labels.scorePrefix`) |
| `head` | The commit that was assessed, as `head.sha` |

**Exit 1 with a verdict on standard output is the verdict `BLOCK`, not a failed command.** Carry on: a blocking verdict is published like any other. Exit 1 with nothing on standard output is a failed command (an input it could not read): that stops the assessment, as above.

When the `ci.pipeline` signal says the pipeline input describes another commit, the local head is not the commit the platform holds. Tell the reader to push, then run this step again from §6a: a verdict is a claim about one commit, and the platform's checks are for the one it has.

### 6c. The block

The same inputs, with `--markdown` in place of `--json`:

```bash
interlock merge-confidence <change> --base origin/<target branch> --pipeline .claude/ship/pipeline.json --run .claude/ship/merge-confidence.json --review .claude/ship/mr/review-r<last>.json --verify .claude/ship/mr/verify.json --handoff .claude/ship/mr/handoff.json --coverage .claude/ship/mr/coverage.json --markdown
```

It prints one block, beginning with its own `## Merge confidence` heading. That block goes into the description **as printed**: no line changed, reordered, summarised or dropped. It names the commit and the base it was computed for.

---

## 7. Compose the description

```markdown
## Summary
2–4 bullets: what changed and why. Lead with the why.

<the block from §6c, as printed. It begins with its own "## Merge confidence" heading. Leave this section out entirely when the assessment stopped.>

## Changes
Grouped by capability, using spec names as headers where possible:
- **<capability>**: <one-line user-visible change>
  - <files or modules touched>

## High Risk Changes
Production risks, each with a mitigation or rollback note. Write `None` if there are none.

## Prerequisites to Production
Env vars, migrations, feature flags, config. Write `None` if there are none.

## Testing
- Unit: <N added / N updated> — `<command>` passing
- Verified locally: <one line on what was exercised>
- Not covered: <gap, or "none">
```

**`## Testing` answers "was this verified?", not "how do I test it by hand?"** Three to five bullets, readable without scrolling.

**Never embed the manual test plan in the description.** It goes in a comment, via `--test-plan`. When you post one in this run, add a single closing line to `## Testing`:

```
Manual UI test plan: see MR comment.
```

Omit that line when `--test-plan` was not passed.

**`## High Risk Changes` is narrative under the CLI's verdict.** How hard a reviewer should look is stated by `## Merge confidence`, which the CLI computed. This section says in words what could go wrong in production and how it would be undone. It states no verdict, no score and no band of its own, and it never softens or contradicts the block above it.

---

## 8. Write the local artifact

Write `openspec/changes/<change-name>/mr-summary.md` with the branch name, commit message, MR title (≤70 chars), and the full description. This survives the session; the platform copy can be regenerated from it.

---

## 9. Publish

### 9a. The description

The merge request exists by now: §2 found it, or §4 created it. Publishing is an update.

```bash
# GitLab
glab mr update <id> --description "$(cat <<'EOF'
<description>
EOF
)"

# GitHub
gh pr edit <id> --body "$(cat <<'EOF'
<description>
EOF
)"
```

Updating **replaces the description entirely.** If the existing description contains anything hand-written by a human, say so and confirm before overwriting it.

### 9b. The labels

When the assessment stopped in §6 there is no verdict to apply, and this step still runs: go to **The assessment stopped** below, because there may be a label to take off.

A label is a claim about one commit, and the platform keeps a label when new commits arrive. So read the platform's head **again**, now, and compare it with `head.sha` from §6b:

```bash
# GitHub — the head commit and the labels the pull request carries
gh pr view <n> --json headRefOid,labels
# GitLab — `sha` is the head commit, `labels` what the merge request carries
glab mr view <iid> --output json
```

From the labels the merge request carries, pick the predecessors: every one that is in `labels.verdictNames` or starts with `labels.scorePrefix`.

**The head is still `head.sha`.** Remove the predecessors, then add the two labels the command printed, in two calls. Do both even when the verdict and score are unchanged, so the platform records the new assessment.

```bash
# GitHub — make sure both labels exist, with the colour and description the command printed
gh label create "<labels.verdict.name>" --color "<labels.verdict.color>" --description "<labels.verdict.description>" --force
gh label create "<labels.score.name>" --color "<labels.score.color>" --description "<labels.score.description>" --force
gh pr edit <n> --remove-label "<predecessor>,<predecessor>"
gh pr edit <n> --add-label "<labels.verdict.name>,<labels.score.name>"

# GitLab — a label is created the first time it is applied
glab mr update <iid> --unlabel "<predecessor>,<predecessor>"
glab mr update <iid> --label "<labels.verdict.name>,<labels.score.name>"
```

Leave the removal out when the merge request carries no predecessor.

**The head moved, or `head` is null.** Remove the predecessors and add nothing. Say that the verdict describes a commit that is no longer the head, name both commits, and tell the reader to run the skill again.

**The assessment stopped.** A label an earlier assessment left would go on claiming a verdict that nobody computed for this commit, so it comes off. There is no `labels` from §6b to recognise it by. Ask the command for the names alone. This reads no input and assesses nothing, so it answers when the assessment could not:

```bash
interlock merge-confidence --label-names --json
```

It prints `labels.verdictNames` and `labels.scorePrefix`. Read the labels the merge request carries with the platform read above, pick the predecessors the same way, remove them and add nothing. Say that the merge request carries no verdict label because the assessment stopped, and give the reason from §6.

**A label that cannot be created, applied or removed is reported**, with the platform's own message and the label's name. Never pass over it, and never say a label was applied or removed that was not.

### 9c. The confidence comment

Only with `--confidence-comment`. Post the block from §6c as a comment, unedited:

```bash
# GitHub — straight from the command, so nothing is retyped
interlock merge-confidence <change> --base origin/<target branch> --pipeline .claude/ship/pipeline.json --run .claude/ship/merge-confidence.json --review .claude/ship/mr/review-r<last>.json --verify .claude/ship/mr/verify.json --handoff .claude/ship/mr/handoff.json --coverage .claude/ship/mr/coverage.json --markdown | gh pr comment <n> --body-file -
# GitLab — not exercised
glab mr note <iid> -m "<the block, as printed>"
```

Without the flag, post no such comment.

---

## 10. Optional comments

**`--test-plan`** — reuse `openspec/changes/<change>/manual-test-plan.md` when it is fresh relative to HEAD; otherwise run `/interlock:manual-test-plan` first. Post it as a comment (`gh pr comment -b`; on GitLab `glab mr note -m`, not exercised). Split across comments if it exceeds the platform's size limit.

**`--explain`** — run `/interlock:explain-code` in commit teach-in mode and post the walkthrough as a comment.

Both are **comment-only, always.** Neither ever enters the description — a reviewer opening the MR should see the summary, not a 200-line test script.

---

## 11. Close the loop: say what still needs archiving

This is the last point the change is in your hands, so it is where the spec lifecycle gets a mention.

Pass the changed-file list you already resolved in §3:

```bash
interlock drift --changed <files> --json
```

**Never blocks.** It exits 0 whatever it finds — do not branch on the exit code here, and do not refuse to publish because of it.

Four findings, in descending order of how much they deserve the reader's attention. Report only what is non-empty:

- **`unarchived`** — earlier changes finished their tasks but were never archived, so their delta specs never reached `openspec/specs/` and the living specs no longer describe what shipped. Name them and give the command:
  ```bash
  openspec archive <change-name>
  ```
- **`stale.broken`** — a spec cites a file that no longer exists. This is **evidence**, not inference: the file was there when the graph was built. Report it as a real finding. If `stale.graphBuiltAt` is old, say so too — a rename against a stale graph looks identical to a deletion.
- **`orphans.orphans`** — changed source files no spec describes. **Always report `orphans.coverage` alongside the count.** "2 files have no spec" is alarming; "2 of 6, in a repo where 34% of source files have one" is informative, and on a repo still being specced the second is the honest framing.
- **`stale.aging`** — living specs older than files they cite. Weakest of the four: it compares dates on **inferred** edges, and a file can be refactored without the spec becoming wrong. Mention it only if it names a spec relevant to this change.

Then close with the one line that matters for *this* change: once the MR merges, run `openspec archive <this-change>`. Archive **after** the merge, not before: a change archived first can no longer be resolved, and the verdict then has no change to assess. Interlock does not archive for you, and nothing downstream will notice if nobody does.

If `drift` reports nothing, say nothing. A clean lifecycle does not need a paragraph.
