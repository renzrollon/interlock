## 1. Reproduce the defect before touching it

- [x] 1.1 Make claim-versus-verdict divergence expressible in the ship harness, then assert against it. In `test/helpers/ship-harness.mjs`, extend `stepResult()` to carry recorded per-task outcomes so a stubbed `record-batch` can contradict the lane result it was given (design.md — Decision 7); in `test/workflows.test.mjs`, add a run whose agent claims two successes that the CLI records as failed, asserting the tick list omits both ids and the per-wave tally reports two failures. Both assertions MUST fail today — that is the point of the task. The harness change and the test are one unit: the test cannot exist without the capability.
- [x] 1.2 Add a failing test in `test/spine/cli.test.mjs` that `wave-state record-batch --write-state --json` reports the outcomes it just recorded — one entry per task in that batch, carrying id, outcome and a reason for anything not succeeded — alongside every field the step already emits. Assert the pre-existing fields are unchanged in the same test, so an additive field cannot quietly become a breaking one.

## 2. Give the verdict a way to travel

- [x] 2.1 Add a pure function to `lib/waves.mjs` that takes the state before recording and the state after and returns that batch's per-task outcomes, derived from the tails of `completed` and `failures` plus the ids that appear in neither (design.md — Decision 2). Do not change `recordBatchResult`'s signature and do not persist the result on the state — a resumed run must not carry a stale batch's outcomes. Cover it in `test/spine/waves.test.mjs` against hand-written before/after states, including a batch that failed a task for an invalid handoff and a lane whose tail was never attempted.
- [x] 2.2 In `bin/interlock`, attach that array to the step emitted by the `record-batch` branch of `wave-state`, for both the `--write-state` and plain paths. Keep the reason a short adjudication string — never a handoff body, suite log or diff, since this payload is copied through an agent on one of the two hosts. Leave `nextStep` itself untouched.

## 3. Make every reader of the invariant use it

- [x] 3.1 In `bin/interlock-ship-acp`, take the tick id list and the `summary.waves` tally from the recorded outcomes accumulated across the batch loop rather than from the agent's `ok` field, push a banner naming any task whose claim the run overrode and why (design.md — Decision 5), and fall back to the claim **with a banner saying so** when the field is absent or malformed (design.md — Decision 6). One checkbox: these are four edits to one file on one code path, and splitting them would leave the file half-converted between waves.
- [x] 3.2 In `workflows/ship.js`, do the same through its ping: instruct the agent to copy each `record-batch` command's recorded array verbatim and concatenate them in command order — explicitly forbidding merging, dropping or reconciling entries — add the field to the step schema, then build the tick list and the tally from it with the same override banner and the same loud fallback. Today the ping copies only the last command's stdout, so a catch-up loop of three batches would report one batch as the whole wave; the accumulated field is what fixes that.

## 4. Verify end to end

- [x] 4.1 Run the full unit suite and confirm green, including the two tests from section 1 that must now pass for the right reason — not because the assertion was relaxed.
- [x] 4.2 Reproduce the original defect against the real driver and confirm it is gone: run `bin/interlock-ship-acp` over a scratch fixture change with an agent that returns handoffs whose `status` is outside the accepted set, and confirm the run leaves every rejected task's box unchecked, reports those tasks as failures in both the printed tallies and the receipt, names the overridden claims in a banner, and lists them in `leftoverTaskIds`. Record the actual output in this task's annotation — a live run that was not performed must say so rather than borrow a unit test's evidence.

  **Live run performed** (2026-08-24), `bin/interlock-ship-acp add-greeting-formatter --apply-only` over a
  scratch fixture repo of five tasks, driven by a scripted ACP agent returning `"status": "done"` on every
  handoff. Run `3222653e-c7e6-4c58-bed5-cf07baf359cc`. Printed:

  ```
  SHIP HALTED — 5 task failures accumulated across waves; more than 2 halts the run
    leftover tasks (boxes still unchecked): 1.1, 1.2, 1.3, 1.4, 1.5
    wave 1 (run-batch): 0 ok, 5 failed
  CLAIM OVERRIDDEN: 1.1, 1.2, 1.3, 1.4, 1.5 — the implementing agent reported otherwise and the
  run acted on what it recorded (1.1: failed — invalid handoff: status must be one of
  ok|blocked|partial, got "done"; …)
  ```

  `grep -c '^- \[x\]' tasks.md` → `0` of 5 (before this change the same run ticked all five). Receipt:
  `waves: [{wave:"1", ok:0, failed:5, notAttempted:0}]`, `leftoverTaskIds: [1.1…1.5]`, `halted: true`,
  and the `CLAIM OVERRIDDEN` line in `degradations`. State: `completed []`, `failures 1.1,1.2,1.3,1.4,1.5`.
- [x] 4.3 Run the same fixture with well-formed handoffs and confirm the happy path is unchanged: every box ticked, no override banner, no leftovers, and a receipt whose tallies match the printed summary.

  **Live run performed** (2026-08-24), same fixture and driver, agent switched to valid `status: "ok"`
  packets. Run `3e836028-58a2-4b47-9d72-83849bd49f0b`. Printed `SHIP COMPLETE — add-greeting-formatter` /
  `wave 1 (run-batch): 5 ok, 0 failed`; tasks.md `5` of 5 ticked; receipt
  `waves: [{wave:"1", ok:5, failed:0, notAttempted:0}]`, `leftoverTaskIds: []`, `halted: false`, and
  `degradations` holding only the two standing ACP-host banners — no override, no claim-derived fallback.
- [x] 4.4 Confirm `interlock run-log check` still reports both runs reconstructable, and that the override banner reached the receipt's degradation list rather than only the terminal.

  `interlock run-log check --run-id 3222653e-…` → `RECONSTRUCTABLE — 14 event(s)`;
  `--run-id 3e836028-…` → `RECONSTRUCTABLE — 14 event(s)`. The override banner is in the halted run's
  receipt `degradations` (quoted under 4.2), so it is in the corpus rather than only on the terminal.
