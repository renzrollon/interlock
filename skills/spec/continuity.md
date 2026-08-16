# `--continue` — the continuity path

Only when the user passed `--continue`. Without it, the spec run ended at the human checkpoint (SKILL.md §6).

Continuity does not decide anything itself. It asks one machine one question — *may this change skip the human read?* — and obeys the answer. The judgement is `interlock ready`, which is code; this file is only the wiring.

**If `--force-checkpoint` was also passed, stop at SKILL.md §6 now.** Do not run readiness. The user opted back out, and the flag exists precisely so that changing your mind costs nothing.

## Ask

Write the artifact review result where the gate can read it — the counts from the artifact review, not the review's findings file:

```bash
mkdir -p .claude/ready
printf '{"blockers": <n>, "warnings": <n>}\n' > .claude/ready/<name>-review.json
```

Then ask:

```bash
interlock ready "<name>" --review .claude/ready/<name>-review.json --paths <planned paths> --json
```

`--paths` is the repo-relative paths `tasks.md` and `design.md` say this change will touch. They need not exist yet — the classifier reads planned paths. Passing none makes the blast radius unclassifiable, which fails closed to `high` and stops continuity, so pass them.

## Branch on the exit code, never on the prose

**Exit 0** (`ready: true`) — invoke `/interlock:ship` (the trampoline skill). It launches the workflow; pass `mode: "continue"` so the outcome corpus is not misfiled as a checkpoint:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/ship.js",
  args: { change: "<change-name>", mode: "continue" }
})
```

If you invoke the skill instead, pass `mode=continue` in its arguments so the trampoline forwards `{ change, mode: "continue" }`.

Say what you are doing and why it was allowed: the risk class, and that continuity was requested. Then hand over; from that point nothing can ask the user anything. **Do not call Workflow again** after it returns. Leftover checkboxes are a report, not a second launch.

Ship is lean by default (waves → verify → commit). Continuity does **not** invent `--strict`. Pass `flags: ["strict"]` only when the user asked for the review/handoff tail.

The mode matters more than it looks. The corpus exists to compare continuity runs against checkpoint runs, and a continuity run filed as a checkpoint is worse than no record — it makes the comparison say the opposite of the truth.

**Exit 1** (`ready: false`) — **do not ship.** Present *only* what blocks:

- Every `needs_human` row from the ledger — id and question.
- Every entry in the readiness `blockers[]` — the message, and its evidence line.

Nothing else. **Do not dump the spec.** The user opted out of reading it; the point is to ask them the specific questions, not to hand back the reading they declined. Offer *"open the artifacts"* as a secondary action for anyone who wants it, and name the change directory so they can.

Title it plainly: **Continuity paused — N decisions need you.** `AskUserQuestion` is available here for the ledger rows; this is not a zero-touch skill, and this is the last place a question is possible.

## After the human answers

1. Write the resolutions into `openspec/changes/<name>/decisions.md` — edit each row in place per `${CLAUDE_PLUGIN_ROOT}/shared/DECISION-LEDGER.md`: flip the class, write the answer into `resolution`, cite the human in `evidence`. Never delete a row.
2. Update `design.md` where an answer changed a decision. A resolution the design contradicts is worse than an open question.
3. Re-run the Ask command.
4. Passes → ship. Still blocked → present the remaining rows the same way. If the second run blocks on something the human cannot answer in a sentence — an artifact is not implementable, the risk class is too high — stop and route to the default checkpoint. Continuity is not a loop to grind against.

## The rules that make this safe enough

- **Fail closed. Any doubt stops.** `ready` exits non-zero when a check could not run, not only when one failed — an unread ledger, an absent review, a classifier that threw are all blockers. So branch on the **exit code**. Never on parsed prose, never on your own reading of the artifacts, and never on a partial pass because most checks were green.
- **`ship` cannot ask anything.** It is a dynamic workflow, and the workflow runtime accepts no mid-run user input at all. Every interrupt therefore happens *here*, before ship starts. There is no "we will confirm that during implementation".
- **Autonomy level does not imply continuity.** They answer different questions. Do not consult the ladder here, do not mention it as a reason, and do not offer `--continue` because a path is L3.
- **Never offer `--continue` yourself.** It is opt-in, and a suggestion from the tool is not an opt-in. If the user has not asked for it, SKILL.md §6 is the end of the run.
- **Continuity cannot catch a wrong idea.** Readiness proves the change is *implementable*, never that it is *right*. Only a person reading the spec can do that. Say so when a continuity run starts, rather than implying a green gate means a good change.
