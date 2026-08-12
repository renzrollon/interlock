---
name: commit
description: Create a single feature-level commit after a change is implemented. Reads the OpenSpec change artifacts to write a verb-phrase conventional-commit message with an outcome summary and optional issue reference. Commit only — never runs tests, typecheck, lint or build, and never pushes.
license: MIT
compatibility: Requires git. Optional openspec CLI for change context.
argument-hint: "[ISSUE-REF] [--yes]"
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(openspec *) Bash(interlock *) Read Glob
metadata:
  type: execution
  autonomy_level: L2
---

Write one good commit for a completed change.

**Commit only.** This skill never runs tests, typecheck, lint, or a build — not in any mode, `--yes` included. Something else already verified; if nothing did, that is a gap in the caller, not work for this skill to absorb.

`--yes` runs non-interactively: no confirmation prompt. It is **not** permission to push or amend.

---

## 1. Resolve the change and the issue reference

Resolve the change by trying, in order:

1. An explicit change name argument
2. The current branch name (`feat/<name>`, `fix/<name>`)
3. The most recently modified `openspec/changes/*/` directory

Ask only when the session is interactive **and** all three fail. Under `--yes`, never ask — report which rungs were tried and stop with a one-line message.

Extract an issue reference from the branch when one was not passed:
`feat/RD-65-task-page` → `RD-65` · `fix/PROJ-123-login-bug` → `PROJ-123`

If the branch looks like a feature branch but no reference was found:
> ⚠️ No issue reference found. Branch `<name>` looks like a feature branch — pass one as `/interlock:commit <REF>` to avoid rewriting the message later.

Interactive: wait for the user to confirm or supply one. Under `--yes`: emit that single line, **proceed without a ref**, and surface it again in the final report. On `main`, `develop`, or any branch without a `feat/`/`fix/` prefix, proceed silently — the reference is genuinely optional there.

---

## 2. Gather context

```bash
openspec status --change "<name>" --json
git status --short
git diff --stat
```

Read `proposal.md` for the one-line intent, `design.md` for scope, and the checked items in `tasks.md` for what was actually done. Inspect the diff to confirm the message matches reality rather than matching the plan.

---

## 3. Compose the message

```
<type>(<scope>): <verb phrase, imperative, lowercase>

Summary of changes:
- <outcome, not task completion>
- <outcome>

Refs: <ISSUE-REF>
```

- **Scope** is the issue reference when one exists (`feat(RD-65): …`), otherwise the primary module or feature area (`feat(tasks): …`).
- **Summary bullets describe outcomes**, not "completed task 2.3".
- **`Refs:` line** appears only when a reference exists. Omit the line entirely otherwise — never write `Refs: none`.

| | |
|---|---|
| Good | `feat(RD-65): add task list page with filtering and status badges` |
| Good | `fix(PROJ-123): resolve token refresh race condition` |
| Good | `feat(tasks): add task list page with filtering` |
| Bad | `feat(tasks): Task List Page` — not a verb phrase |
| Bad | `feat(tasks): added the new task list page` — past tense, wordy |

---

## 4. Preview and commit

Show the full message. Interactive: ask "Commit with this message?" and allow edits. Under `--yes`: print it and commit.

Stage by naming **every path explicitly**, then commit.

---

## Guardrails

- **Never `git add -A` or `git add .`.** Name every path. Leave unrelated dirty files unstaged.
- **Never push.** `--yes` is not that permission.
- **Never amend** unless the user explicitly asks and the amend conditions hold. `--yes` is not that permission.
- **Never run tests, typecheck, lint, or build** — in any mode.
- **Never re-implement or quick-fix failing code here.** If the tree looks broken: interactive, warn and ask whether to commit anyway; under `--yes`, commit and report the observation. Never start a verify/fix loop either way.

---

## 5. Report

Commit hash and subject, files committed, anything left unstaged, and the warning from step 1 if it fired. Suggest the next step: `/interlock:mr` to open or update the merge request.
