---
name: mr
description: Generate a merge-request or pull-request summary from the change artifacts and diff, then create or update it on whichever platform the remote points at — GitLab via glab, GitHub via gh — with the CLI's merge-confidence verdict in the description and as labels. Optional comment-only add-ons post the manual test plan or a teaching walkthrough. Use when opening an MR/PR, refreshing its description, re-assessing it after new commits, or attaching a test plan.
license: MIT
compatibility: Requires git, plus glab (GitLab) or gh (GitHub) authenticated. Optional openspec CLI for change context.
argument-hint: "[change-name] [--create] [--test-plan] [--explain] [--confidence-comment] [--gate-check <name>]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(glab *) Bash(gh *) Bash(openspec *) Bash(interlock *) Bash(interlock-graph *) Read Write Grep Glob
metadata:
  type: generation
  outputs:
    - openspec/changes/<change>/mr-summary.md
---

Turn a finished change into a merge request a reviewer can actually review.

Almost all of this skill is platform-agnostic — the summary, the narrative, the test plan. Reading the checks and publishing differ between GitLab and GitHub, so **detect the platform, do not ask about it.**

The merge-confidence verdict in the description, and the labels beside it, are **what the CLI computed, for the commit the platform holds.** You run the commands, paste the block they print and apply the labels they name. You never state a confidence of your own, never re-derive a band or a score, and never write a label name: this file carries none.

**This skill never merges, approves or requests changes on a merge request.** What a label means for merging is the platform's policy. The skill's part ends at the label.

| Flag | Effect |
|------|--------|
| `--create` | Create the MR/PR instead of updating an existing one |
| `--test-plan` | Also post the full manual test plan **as a comment** |
| `--explain` | Also post a per-file teaching walkthrough **as a comment** |
| `--confidence-comment` | Also post the merge-confidence block **as a comment**, so each assessment leaves one entry in the timeline naming its commit |
| `--gate-check <name>` | Leave the check of that exact name out of the pipeline input. Repeatable. For the check whose own result waits on the verdict; see §4 |

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

No open MR/PR and no `--create` → stop: *"No open merge request for this branch. Push the branch and re-run with `--create`."*

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

## 4. Assess merge confidence

The assessment reads the merge request's own checks and head commit, so the merge request has to exist. With `--create`, create it first (§7, with the description composed so far), then come back here and publish again as an update.

**The assessment reads nothing from the merge request's title, description or comments.** It is handed four things: the change, the base, the platform's checks, and the run's evidence file when there is one.

### 4a. The pipeline input

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

A non-zero exit of `interlock pipeline` stops the assessment: it printed nothing, and it removed any earlier file at the output path, so there is no pipeline input to pass. Report the reason from standard error, write no `## Merge confidence` section and apply no label. The rest of the description is still published.

### 4b. The verdict

```bash
interlock merge-confidence <change> --base origin/<target branch> --pipeline .claude/ship/pipeline.json --run .claude/ship/merge-confidence.json --json
```

- Pass `--run .claude/ship/merge-confidence.json` only when that file exists (Glob for it). It is the evidence a ship run's close wrote. The command decides whether it may be used, and says why on standard error when it takes nothing from it: report that reason. Pass no other review or verification file.
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

When the `ci.pipeline` signal says the pipeline input describes another commit, the local head is not the commit the platform holds. Tell the reader to push, then run this step again from §4a: a verdict is a claim about one commit, and the platform's checks are for the one it has.

### 4c. The block

The same inputs, with `--markdown` in place of `--json`:

```bash
interlock merge-confidence <change> --base origin/<target branch> --pipeline .claude/ship/pipeline.json --run .claude/ship/merge-confidence.json --markdown
```

It prints one block, beginning with its own `## Merge confidence` heading. That block goes into the description **as printed**: no line changed, reordered, summarised or dropped. It names the commit and the base it was computed for.

---

## 5. Compose the description

```markdown
## Summary
2–4 bullets: what changed and why. Lead with the why.

<the block from §4c, as printed. It begins with its own "## Merge confidence" heading. Leave this section out entirely when the assessment stopped.>

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

## 6. Write the local artifact

Write `openspec/changes/<change-name>/mr-summary.md` with the branch name, commit message, MR title (≤70 chars), and the full description. This survives the session; the platform copy can be regenerated from it.

---

## 7. Publish

### 7a. The description

```bash
# GitLab — update
glab mr update <id> --description "$(cat <<'EOF'
<description>
EOF
)"
# GitLab — create
glab mr create --title "<title>" --description "..." 

# GitHub — update
gh pr edit <id> --body "$(cat <<'EOF'
<description>
EOF
)"
# GitHub — create
gh pr create --title "<title>" --body "..."
```

Updating **replaces the description entirely.** If the existing description contains anything hand-written by a human, say so and confirm before overwriting it.

### 7b. The labels

Skip this step when the assessment stopped in §4.

A label is a claim about one commit, and the platform keeps a label when new commits arrive. So read the platform's head **again**, now, and compare it with `head.sha` from §4b:

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

**A label that cannot be created or applied is reported**, with the platform's own message and the label's name. Never pass over it, and never say a label was applied that was not.

### 7c. The confidence comment

Only with `--confidence-comment`. Post the block from §4c as a comment, unedited:

```bash
# GitHub — straight from the command, so nothing is retyped
interlock merge-confidence <change> --base origin/<target branch> --pipeline .claude/ship/pipeline.json --run .claude/ship/merge-confidence.json --markdown | gh pr comment <n> --body-file -
# GitLab
glab mr note <iid> -m "<the block, as printed>"
```

Without the flag, post no such comment.

---

## 8. Optional comments

**`--test-plan`** — reuse `openspec/changes/<change>/manual-test-plan.md` when it is fresh relative to HEAD; otherwise run `/interlock:manual-test-plan` first. Post it as a comment (`glab mr note -m` / `gh pr comment -b`). Split across comments if it exceeds the platform's size limit.

**`--explain`** — run `/interlock:explain-code` in commit teach-in mode and post the walkthrough as a comment.

Both are **comment-only, always.** Neither ever enters the description — a reviewer opening the MR should see the summary, not a 200-line test script.

---

## 9. Close the loop: say what still needs archiving

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
