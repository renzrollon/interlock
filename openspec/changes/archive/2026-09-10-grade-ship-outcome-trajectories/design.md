## Context

See `proposal.md` — Why. Constraints that shape the approach:

- Outcome grading already lives in `evals/ship/graders.mjs`. Loop-arm reconstructability is `interlock run-log check`; control-arm ticks / trajectory / receipt are `n/a`. History copies named criterion `{id, status, exitCode}` under schema `interlock.ship-outcome-eval/1` (`lib/eval-history.mjs`). `MAX_CRITERIA` is 16; six criteria exist today.
- Event types the writer accepts: `RUN_LOG_TYPES` in `lib/run-log.mjs` (`run-start`, `wave-action`, `cli-exit`, `agent-spawn`, `verify-judgement`, `run-halt`, `run-complete`, `run-receipt`). `checkRunLog` already requires contiguous `seq`, `run-start`, a close (`run-halt` or `run-complete`), and a `cli-exit` per `wave-action`/`verify-judgement`. It deliberately does **not** require `run-receipt` (a halt before close has none). `wave-action.action` is copied as text, not enum-validated — an invented value can land in the JSONL.
- Run-program actions: `ACTIONS` in `lib/run.mjs`. `makeStep` throws on an unknown value. Wave-state `nextStep` emits a subset (`run-batch`, `test-wave`, `verify`, `replan`, `done`, `halt`); `logWaveMutation` in `bin/interlock` writes that as `wave-action.action`.
- Unit halt statuses the CLI already records on `verify-judgement.unitStatus`: `red`, `error`, `weakened` halt; `green` and `red-pre-existing` do not (`lib/verify.mjs` `judgeUnitResult`).
- Zero runtime dependencies. The walker is stdlib. Do not add agentevals / Harbor / Braintrust / LangSmith. Do not invent lint or build. Do not restate numeric thresholds. Do not wire results into `ready`, `gate`, or the ship loop. Trajectory append remains `fatal: true` on the ship path; this eval only *reads* the scratch copy.
- `evals/ship/sample/clean-run.json` already plants a reconstructable completed loop via `appendRunLogEvent`. Process tests follow that pattern.

## Goals / Non-Goals

**Goals:**

- A pure walker over run-log *records* that the outcome runner can call after a loop arm, returning three named criteria with the same `pass` / `fail` / `unobserved` / `n/a` statuses the disk graders use.
- Allowed type and action sets imported from the modules that own them, so a new `ACTIONS` entry cannot silently fail the eval, and a typo type cannot silently pass.
- Offline proof with planted JSONL, including the failing directions (missing `verify-judgement` on `run-complete`, `action: "report"`, unit-red then `run-complete`).

**Non-Goals:**

- Changing `checkRunLog`, `interlock run-log check`, or any in-run gate.
- Strict stage *order* match, golden chat-message trajectories, or implementer `tool_order`.
- New plugin-eval cases, new ship fixtures, host matrix, `--strict` tail, guard-fire evals, judged graders.
- Schema bump of `interlock.ship-outcome-eval/1` (new ids are more objects in the existing criteria array).
- Editing `lib/run.mjs` or the loop.

## Decisions

### D1 — Sibling `evals/ship/trajectory.mjs`, composed by `gradeArm`

The walker is its own module. `graders.mjs` already mixes CLI invocation with criterion shaping; dumping set-membership on top of that file hides the process/disk split the spec just drew.

`gradeArm` for `arm === 'loop'` appends the three process criteria after `gradeTrajectory` (reconstructability). For `arm === 'control'` it records them `n/a` in the same loop that already marks ticks / trajectory / receipt.

*Alternative considered:* a fourth CLI subcommand (`interlock run-log process`). Rejected: that would put an eval-only check on the product PATH and invite folding it into the in-run reconstructability gate later. *Alternative:* inline the walker in `graders.mjs`. Rejected: the unit tests need to feed records without a scratch root.

### D2 — Import `RUN_LOG_TYPES` and `ACTIONS`; do not copy the lists

`trajectory.mjs` imports `RUN_LOG_TYPES` from `lib/run-log.mjs` and `ACTIONS` from `lib/run.mjs`. Unknown `type` = not in `RUN_LOG_TYPES`. Unknown `action` = a present `action` field whose string is not in `ACTIONS` (null/empty counts as unknown: the writer always has a step action).

*Alternative considered:* duplicate the arrays in the eval. Rejected — they would drift the first time `ACTIONS` gained a tail step. *Alternative:* LangChain AgentEvals over OpenAI tool-call lists. Rejected — wrong object, forbidden dependency.

### D3 — Presence, not order; complete vs halt required-type sets

A `run-complete` close requires these *additional* types (not re-checked by `checkRunLog`): `wave-action`, `cli-exit`, `verify-judgement`, `run-receipt`. A `run-halt` close does not fail solely for missing `verify-judgement` or `run-receipt`. Any unknown `type` fails required-types on either close. `agent-spawn` is not required (classify-time halt has a run id only after `adoptPlan`; requiring spawn would fail honest early stops).

No sort of `wave-action.action` sequence is asserted. Stage sequence of the *loop* is honoured as “these event types exist”; implementer tool order is out of scope.

### D4 — Halt-on-unit-red reads CLI-recorded `unitStatus`, never re-runs the suite

Halting unit statuses: `red`, `error`, `weakened` — the values `judgeUnitResult` already writes onto `verify-judgement`. If any such event exists, the log must contain `run-halt` and must not contain `run-complete`. If none exists, the criterion passes (nothing to honour). A missing `verify-judgement` on `run-complete` is a required-types failure, not this one.

The grader wrapper loads records through `interlock run-log show --run-id <id> --root <scratch> --json` so the reader is the same CLI the reconstructability check uses. The walker itself is a pure function of `records[]` so planted tests need no spawn.

*Alternative considered:* treat `halt: true` alone. Rejected — a non-unit halt (state-machine halt) is not “unit was red”, and this criterion would then duplicate “the run halted”. *Alternative:* re-invoke `interlock verify unit` for this criterion. Rejected — that is the disk unit grader; process must not re-judge redness.

### D5 — Three stable criterion ids, not one blob; keep `SHARED_CRITERIA` unchanged

```
trajectory-required-event-types
trajectory-known-actions
trajectory-halt-on-unit-red
```

Existing `trajectory-reconstructable` stays. History writer already copies any `{id, status, exitCode}` up to 16 entries; three more fit. `SHARED_CRITERIA` (unit green, not weakened, commit) is the arm-difference set and MUST NOT gain process ids — that would count control-arm `n/a` into a comparison the spec forbids.

`command` on process criteria: name the check and the `run-log show` invocation that supplied the records (or `null` when the walker was fed planted records). `exitCode` is `null` unless the show/query itself failed, in which case all three process criteria are `unobserved`.

### D6 — Do not extend `checkRunLog`

Reconstructability is an in-run fatal gate (`CLAUDE.md`: trajectory append `fatal: true`; a run nobody can reconstruct defeats the file). Process eval is an observer. Mixing them would make an invented `action` halt a consumer ship, which this change is forbidden to do.

### D7 — Planted JSONL, laid down through `appendRunLogEvent`

Extend `evals/ship/sample/` (or add `evals/ship/sample/process-*.json` siblings) with hand-built event lists: clean complete (the existing sample already qualifies), complete minus `verify-judgement`, `action: "report"`, unit-red + `run-complete`, unit-red + `run-halt`, halt-before-verify. Tests call the walker on records produced by the real writer so the shape cannot drift.

No live `interlock-ship-acp`. No network.

### D8 — README and host limits

`evals/ship/README.md` gains a process row in the criteria table and a sentence that the walker grades JSONL events, not chat. Existing token pins (`model routing`, `not in effect`, `launch behaviour`, `not under test`, `apparatus`, `default`) stay. Add pins for the new criterion ids (tokens, not sentences). After archive, update the Purpose paragraph of `openspec/specs/evals/outcome-run/spec.md` by hand — a delta Purpose is ignored for an existing capability.

## Risks / Trade-offs

- **A reconstructable log with `action: "report"` still ships in production** → that is D6: the eval observes; the in-run gate stays reconstructability. The control-plane-action *transcript* case already covers ping invention on the briefing; this grader covers the JSONL if one ever lands.
- **`ACTIONS` includes tail steps (`review`, `verdict`, …) that default ACP runs never emit** → allowing them is correct: an unexpected-but-legal tail action is not an invented `report`. Presence checks do not require those types.
- **`run-complete` without `run-receipt` fails process but not reconstructability** → intended; `checkRunLog` documents receipt as optional so a halt-before-close remains reconstructable. A *completed* ship without a receipt is the process miss.
- **History rows before this change have six criteria, after have nine** → readers already iterate `criteria[]` by id. No schema bump. Older rows simply lack the new ids; report code that assumes a fixed list already has to tolerate `n/a` and absence.
- **Importing `lib/run.mjs` from the eval pulls the run program** → `ACTIONS` is a frozen array at module top; Node loads the module. If that ever becomes costly, re-export `ACTIONS` from a tiny module — out of scope until measured.

## Migration Plan

Additive. Default rollback is reverting `evals/ship/trajectory.mjs`, the grader/README edits, sample fixtures, and tests. No corpus rewrite. Existing `ship-outcomes.jsonl` lines (none committed today) remain valid `/1` rows. Nothing in CI triggers or `package.json` changes.

## Open Questions

None. Required-type sets, halt statuses, and “do not extend `checkRunLog`” are decided above; leaving them open would change the spec or the task breakdown.
