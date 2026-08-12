---
name: mr
description: Generate a merge-request or pull-request summary from the change artifacts and diff, then create or update it on whichever platform the remote points at — GitLab via glab, GitHub via gh. Optional comment-only add-ons post the manual test plan or a teaching walkthrough. Use when opening an MR/PR, refreshing its description, or attaching a test plan.
license: MIT
compatibility: Requires git, plus glab (GitLab) or gh (GitHub) authenticated. Optional openspec CLI for change context.
argument-hint: "[change-name] [--create] [--test-plan] [--explain]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(glab *) Bash(gh *) Bash(openspec *) Bash(specflow *) Bash(specflow-graph *) Read Write Grep Glob
metadata:
  type: generation
  autonomy_level: L2
  outputs:
    - openspec/changes/<change>/mr-summary.md
---

Turn a finished change into a merge request a reviewer can actually review.

Almost all of this skill is platform-agnostic — the summary, the risk assessment, the test plan. Only the last step differs between GitLab and GitHub, so **detect the platform, do not ask about it.**

| Flag | Effect |
|------|--------|
| `--create` | Create the MR/PR instead of updating an existing one |
| `--test-plan` | Also post the full manual test plan **as a comment** |
| `--explain` | Also post a per-file teaching walkthrough **as a comment** |

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

Resolve the OpenSpec change with `specflow changes` and the branch name. If several are plausible, ask which one — a wrong change here produces a confidently wrong description.

---

## 3. Gather

```bash
git diff --stat <base>...HEAD
git diff --name-status <base>...HEAD
git log --oneline <base>...HEAD
```

Read `proposal.md` (the why), `design.md` (the how), `tasks.md` (what was done), and `specs/**/*.md`. Use `specflow-graph consumers <symbol>` to check blast radius when the graph exists.

---

## 4. Compose the description

```markdown
## Summary
2–4 bullets: what changed and why. Lead with the why.

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

Be honest in the risk assessment. An inflated confidence level is worse than no assessment, because it is the section a reviewer uses to decide how hard to look.

---

## 5. Write the local artifact

Write `openspec/changes/<change-name>/mr-summary.md` with the branch name, commit message, MR title (≤70 chars), and the full description. This survives the session; the platform copy can be regenerated from it.

---

## 6. Publish

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

---

## 7. Optional comments

**`--test-plan`** — reuse `openspec/changes/<change>/manual-test-plan.md` when it is fresh relative to HEAD; otherwise run `/specflow:manual-test-plan` first. Post it as a comment (`glab mr note -m` / `gh pr comment -b`). Split across comments if it exceeds the platform's size limit.

**`--explain`** — run `/specflow:explain-code` in commit teach-in mode and post the walkthrough as a comment.

Both are **comment-only, always.** Neither ever enters the description — a reviewer opening the MR should see the summary, not a 200-line test script.
