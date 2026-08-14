---
name: ship
description: Launch the Interlock ship workflow — take a reviewed OpenSpec change from tasks to commit in one uninterrupted run (waves, review, remediate, verify, commit). Use when the user ran /interlock:ship, asked to ship a reviewed change, or spec --continue passed the readiness gate. Never invoke after spec unless they asked.
license: MIT
compatibility: Requires Claude Code v2.1.154+ with dynamic workflows enabled. Node.js >= 18 for the bundled interlock CLI.
argument-hint: "[<change-name>] [--apply-only] [--no-commit] [--skip-e2e] [--skip-coverage]"
disallowed-tools: AskUserQuestion
allowed-tools: Read
metadata:
  type: execution
---

This skill does not implement the ship loop. It launches `${CLAUDE_PLUGIN_ROOT}/workflows/ship.js` on the Workflow runtime. Implementing waves, review, remediation, verification, or a commit from this conversation is a bug.

The loop lives in that script on purpose: a skill is instructions a model can talk itself out of, and ship is sold as a run that asks nothing. Keep it that way.

## 1. Parse arguments

From `$ARGUMENTS` (or the Skill `args` payload) build an **object**. Prefer `{ change: "<name>" }`. A bare string or a one-element array is also a change name — the script accepts all three — but never omit the name when the user gave one. A nameless validate against several active changes is a halt, not a prompt.

| Input | `args` field |
|---|---|
| First non-flag token | `change` (omit if none — the script resolves the active change) |
| `mode=continue` / this run is spec `--continue` | `mode: "continue"` (omit otherwise; the script defaults to `checkpoint`) |
| `--apply-only` `--no-commit` `--skip-e2e` `--skip-coverage` | `flags: ["apply-only", ...]` |
| `--max-parallel N` | `maxParallel: N` |

## 2. Launch the workflow

If the **Workflow tool** is available, this skill invocation is your authorization. Call it **once**, then stop. Do not narrate the loop. Do not implement tasks. Do not commit yourself.

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/ship.js",
  args: { change: "<name or omit>", mode: "checkpoint" | "continue", flags: ["..."] }
})
```

When it returns, you are done. Print the summary. **Do not call Workflow again in this conversation.** Leftover `- [ ]` boxes after a run are a report, not authorization to call Workflow again — those are failed or unticked tasks, and a second ship is a full new 20+ agent run. Only a **new user message** that explicitly asks to ship leftover tasks (or `/interlock:ship` again) is a relaunch.

If a `/goal` is active, it is satisfied when the transcript contains `GOAL MET: interlock ship`. Leftover checkboxes do not continue the goal. Do not launch another Workflow to "finish the goal." Do not invoke `/goal` from this skill.

`mode` matters more than it looks. The outcome corpus compares continuity runs against checkpoint runs; a continuity run filed as a checkpoint makes that comparison say the opposite of the truth.

## 3. If the Workflow tool is not available

**Halt.** Do not fall back to implementing the change in this conversation.

`/interlock:ship` needs Claude Code **v2.1.154+** with Dynamic workflows enabled (`/config`). They are also off under `disableWorkflows`, org policy, `CLAUDE_CODE_DISABLE_WORKFLOWS`, or a Pro plan that has not turned the row on. Some IDE surfaces never expose the Workflow tool.

Tell the user that, and that everything else in Interlock still works — `spec`, the reviews, `commit`. Do not offer to "just start on the first task".
