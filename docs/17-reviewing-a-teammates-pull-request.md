# 17 — Reviewing a teammate's pull request

`/interlock:review-code --pr <ref>` runs the same review engine on a colleague's open pull request: the same rubrics, skeptics, survival rule, proof and quality band. It differs in where the code is read from, what the prompts allow, and what is done with the result. The result is one comment, printed, and posted only when you ask.

---

## The flags

| Flag | What it does |
|---|---|
| `--pr <ref>` | Reviews the pull request, read-only, from a detached worktree of its pinned head. `<ref>` is whatever `gh pr view` or `glab mr view` accepts. |
| `--post` | Posts the rendered comment as one comment, after the review. Without it the skill prints `NOT POSTED:` and sends nothing. The skill never adds it for you. |
| `--run-code` | Lets reviewers run the pull request's own code: a single test file and the repository's own CLI. Without it the prompts tell them to read the code and run none of it. The skill never adds it for you. |

`--base` and `--carry` do not combine with `--pr`: the target file gives the base, and a carried record belongs to the settle loop. `--out <file>` still names the review record.

Fork pull requests are refused, and so are pull requests that are not open. A draft is reviewed. The command that pins the pull request, `interlock review target`, writes nothing for a refused one.

---

## What the path never does

On this path the skill writes to the platform nothing but the one comment, under `--post`. It never:

- pushes, or makes a commit;
- edits the pull request, its title, its description or its labels;
- marks it ready, approves it, or submits a review that asks to request changes;
- resolves a thread, or merges it;
- switches, stashes, resets or cleans your own tree, or writes to your own graph.

It writes no autonomy line and no compound note, so a blocker on a colleague's change does not reset this repository's ship ladder. The one record it writes is the review-metrics row, and only when you name a change: the skill then passes `--metrics <change>`, and the row lands in your own review-metrics corpus beside your own reviews. With no change named it records nothing and says `REVIEW METRICS NOT RECORDED: no change named`.

**What holds that list.** The skill's instructions, a test that fails the `--pr` section if it holds a write verb, and a write-nothing line in every reviewer prompt. Not a tool bound: the skill's `allowed-tools` belongs to the skill and not to the flag, so it still holds the shell and file writes the author's path needs, and the reviewer type keeps the shell. What a shell command may do beyond the three is for your own permission settings to decide. Likewise the read-and-run-nothing rule and the review root are lines in a prompt, not tool bounds.

The `allowed-tools` list gains only seven patterns: `gh auth status`, `gh pr view`, `gh pr comment`, `glab auth status`, `glab mr view`, `glab mr note create` and `glab ci get`.

---

## The comment and its weights

Three weights, in this order: `Important` (blockers first), `Pre-existing`, then the `Nit`s inside one collapsed block headed by their count. A blocker or a warning reads `Important`; a suggestion reads `Nit`. The stored severities do not change, and `--json` carries both. The comment has no gate word, verdict, score or label, and ends by saying it is not an approval.

**The Pre-existing rule has two halves.** The reviewer marks a finding `preExisting` only when the defect is on a line the diff did not change and would be there without this pull request, never for what the change breaks or leaves stale. Then `interlock review comment` confirms the mark: the finding needs a file inside the repository and a line the head holds, outside every changed range of that file and not beside lines the pull request removes, or a file outside the diff. A file the pull request deletes, or one git lists as changed with no lines the diff could read (a binary file, a rename with no edit), confirms nothing. The diff is pinned against your git configuration: an external diff driver or a configured prefix changes nothing. A mark it cannot confirm is refused and counted, and the finding reads by its severity. An unmarked finding never reads `Pre-existing`. When git cannot produce the diff, or the diff names a file git does not list as changed, nothing does, and standard error says `PRE-EXISTING NOT CHECKED:`.

**The comment names no path on your machine.** A reviewer reads the code at the worktree's absolute path; the comment names every file relative to the repository, whatever the reviewer wrote. It fits `maxReviewerCommentChars` (`interlock limits`): over it, the nits' bodies go first, then their rows, then the leading findings' bodies, and a `CUT:` line says what went. The record keeps every finding whole.

---

## Where things go

- The worktree: `.claude/worktrees/review-pr-<platform>-<number>-<first 12 of the head>` under your working directory. It is removed on every path the skill reaches once it exists. A session that ends before the skill's last step, a crash or a closed terminal, leaves it registered: `git worktree list` shows it, and `git worktree remove --force <path>` followed by `git worktree prune` clears it. A review of the same pull request at the same head finds it and removes it first.
- The session files (target, findings, verdicts, drafts, the record, the checks, `comment.md`): `.claude/ship/review-pr/<platform>-<number>-<first 12 of the head>/`. They are kept on every path, under the gitignored `.claude/ship/`.

A repository that does not ignore `.claude/worktrees/` lists that directory as untracked while a review runs. Add the line to `.gitignore`:

```
.claude/worktrees/
```

A sandbox that refuses the worktree write fails the add with `REVIEW WORKTREE NOT CREATED:`. Run that one `git worktree add` command outside the sandbox.

---

## When something goes wrong

- **`POST FAILED:`** The post command exited non-zero. The line carries the platform CLI's message and the path of `comment.md`. The skill does not run it again and sends the comment no other way, because it cannot tell whether the platform took it and a second attempt could post it twice. Post the file by hand (`gh pr comment <number> --body-file <path>`, or `glab mr note create <iid> --resolvable=false < <path>`), or run the review again.
- **`REVIEW NOT PROVEN:`** A review that ran no code reads this when a claim needed a run to measure: a measurement only a run could take is recorded as unread, and an unread entry means the proof does not hold. The comment names the gap. `--run-code` is the remedy.
- **`PULL REQUEST NOT REVIEWED:`** The platform CLI is missing or not signed in, the pull request is refused, the fetch failed, or it changes no file.
- **`CHECKS NOT READ:`** The platform's checks describe another commit than the pinned head, or could not be read. The review goes on.

Reading a second comment on the same head is not designed: a second run with `--post` posts a second comment.

---

## What was exercised

No platform line has run against a real pull request yet, so each sits in the skill under a `not exercised` comment. The GitHub field names were checked against one real document; the GitLab field names are written from the platform's documentation, and its post line from the help text of one glab version. The first real runs are yours, after this ships.
