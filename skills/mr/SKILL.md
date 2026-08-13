---
name: mr
description: Generate a merge-request or pull-request summary from the change artifacts and diff, then create or update it on whichever platform the remote points at — GitLab via glab, GitHub via gh. Optional comment-only add-ons post the manual test plan or a teaching walkthrough. Use when opening an MR/PR, refreshing its description, or attaching a test plan.
license: MIT
compatibility: Requires git, plus glab (GitLab) or gh (GitHub) authenticated. Optional openspec CLI for change context.
argument-hint: "[change-name] [--create] [--test-plan] [--explain]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(glab *) Bash(gh *) Bash(openspec *) Bash(interlock *) Bash(interlock-graph *) Read Write Grep Glob
metadata:
  type: generation
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

Resolve the OpenSpec change with `interlock changes` and the branch name. If several are plausible, ask which one — a wrong change here produces a confidently wrong description.

---

## 3. Gather

```bash
git diff --stat <base>...HEAD
git diff --name-status <base>...HEAD
git log --oneline <base>...HEAD
```

Read `proposal.md` (the why), `design.md` (the how), `tasks.md` (what was done), and `specs/**/*.md`. Use `interlock-graph consumers <symbol>` to check blast radius when the graph exists.

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

**`--test-plan`** — reuse `openspec/changes/<change>/manual-test-plan.md` when it is fresh relative to HEAD; otherwise run `/interlock:manual-test-plan` first. Post it as a comment (`glab mr note -m` / `gh pr comment -b`). Split across comments if it exceeds the platform's size limit.

**`--explain`** — run `/interlock:explain-code` in commit teach-in mode and post the walkthrough as a comment.

Both are **comment-only, always.** Neither ever enters the description — a reviewer opening the MR should see the summary, not a 200-line test script.

---

## 8. Close the loop: say what still needs archiving

This is the last point the change is in your hands, so it is where the spec lifecycle gets a mention.

Pass the changed-file list you already resolved in §2:

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

Then close with the one line that matters for *this* change: once the MR merges, run `openspec archive <this-change>`. Interlock does not archive for you, and nothing downstream will notice if nobody does.

If `drift` reports nothing, say nothing. A clean lifecycle does not need a paragraph.
