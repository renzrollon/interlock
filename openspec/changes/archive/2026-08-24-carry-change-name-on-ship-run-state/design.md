## Context

See proposal.md — Why. The relevant current state:

`bin/interlock` resolves the change name once per invocation from a flag and threads it as a parameter:

```
bin/interlock:1336   const change = typeof flags.change === 'string' ? flags.change : undefined
                     ↓ passed to
logWaveMutation(root, { source, change, state })     → wave-action + cli-exit
logAgentSpawns(root, { runId, change, step, source }) → agent-spawn
verify judge append site                              → verify-judgement + cli-exit
                     ↓ absent →
appendRunLogEvent:  change: text(source.change, MAX_NAME) || 'unnamed'
```

`runId` takes a different route. It is generated inside `createRunState` and read off the frozen state at every append site (`runIdOf(state)`), with the code stating why: *"`runId` is created once, in createRunState, and travels on the frozen state — no new flag needed."* The change name was not given that treatment.

Two further constraints shape the fix:

- `plan.json` carries no change name (verified: its top-level keys are `maxParallel`, `totalTasks`, `implCount`, `testCount`, `waveCount`, `laneCount`, `maxTasksPerAgent`, `waves`, `testWave`, `clamped`, `serialized`, `lanes`, `folded`, `rejectedPaths`, `warnings`). So the name cannot be lifted from the plan; it must be supplied at `create`.
- `createRunState` returns `deepFreeze(cloneState(...))`. Adding a field is additive and safe, but every later mutation path (`mutable` → `cloneState` → `finalize`) must preserve it, which `cloneState` does structurally.

## Goals / Non-Goals

**Goals:**

- Conformance with the existing `ship-run` requirement, structurally rather than by caller discipline.
- One place where the name enters the run, and one place each append site reads it from.
- Backward compatibility with in-flight `state.json` files that predate the field.

**Non-Goals:**

- No change to event shapes, the event-type enum, or `TYPE_FIELDS`.
- No change to how `run-start` gets its name; it is script-authored and already correct.
- Not removing the `--change` flag. It is the entry point at `create` and the compatibility path elsewhere.
- Not making an absent name fatal. `appendRunLogEvent` keeps defaulting to `unnamed`.

## Decisions

**Decision 1: carry the name on the frozen state, sourced from `--change` at `create` only.**

`createRunState(plan, opts)` gains `opts.change`, stored as `state.change`. Append sites resolve the name as `state.change ?? flags.change`, mirroring `runIdOf`'s defensive read.

Alternatives considered:

- *Pass `--change` at all eleven ship.js call sites.* Rejected. This is the status quo mechanism and it has already failed twice in this codebase — zero of eleven sites in the default host, and two of six omitted in the host that otherwise remembers. A flag embedded in prompt text at eleven places is a flag a future prompt edit drops silently, because dropping it produces a working run with a mislabeled log. The failure is invisible at runtime, which is precisely why it persisted.
- *Derive the name from `openspec/changes/` by inspecting the directory.* Rejected. Ambiguous when more than one change exists, and it makes a logging concern depend on filesystem layout.
- *Put the name in `plan.json` at plan time.* Rejected as the primary mechanism — it would work, but the plan is a pure `planWaves` output with no other identity fields, and adding one would mean the planner's output hash changes for a reason unrelated to planning. It would also perturb `plan-fingerprint.json`.

**Decision 2: state is authoritative, flag is fallback — not the reverse.**

If both are present and disagree, the state wins. A state's name was fixed when the run was created; a flag is per-invocation and is the mechanism that has demonstrably drifted. Preferring the flag would let one mislabeled invocation relabel part of a run's trajectory, producing a log whose lines disagree about which change they belong to — worse than the current uniform `unnamed`, because it looks correct.

**Decision 3: keep `summarizeRunLog`'s fallback, demote it to defensive.**

`summarizeRunLog` currently reads the change from `run-start`, then `records[0]`. That is the only reason `listRunLogs({ change })` works at all today. It stays — a torn or partial log still needs it — but it stops being the mechanism the feature depends on. This is deliberately not cleaned up: removing the compensation in the same change that fixes the cause would leave no working path if the fix regresses.

**Decision 4: the invariant is the trajectory's change label; the unit of work is every reader of it.**

The name is a value read in more than one place, so the sweep is enumerated rather than assumed:

| Consumer | Reads | After this change |
|---|---|---|
| `logWaveMutation` | `change` param | `state.change ?? flag` |
| `logAgentSpawns` | `change` param | `state.change ?? flag` |
| `verify judge` append | `change` param | `state.change ?? flag` |
| `run-log append --event` | event JSON | unchanged (script-authored) |
| `summarizeRunLog` | records | unchanged (defensive fallback) |
| `listRunLogs({change})` | summary | unchanged, now correct at source |
| `formatRunLogList` | summary | unchanged |
| `checkRunLog` | — | does not read the name |

`emitRecordedState` forwards `change` into `logAgentSpawns` and needs the same treatment; it is a pass-through, not a fourth reader.

## Risks / Trade-offs

**A state with a stale name after a change is renamed mid-run** → The name is fixed at `create`. If a change directory is renamed while a run is in flight, the trajectory keeps the old name. Accepted: that is the correct record of what the run was started against, and the fingerprint hash in `plan-fingerprint.json` already pins the artifacts.

**Two mechanisms coexisting is more code than one** → Mitigated by making the precedence explicit and testing it. The alternative — dropping the flag — breaks in-flight states and both hosts in the same commit.

**Existing test fixtures assert `unnamed`** → 207 recorded fixture logs in `.claude/ship/runs/` are test output, all `unnamed`. Any test asserting that string as expected behavior is asserting the bug. Those assertions get updated; the fixtures themselves are regenerable output, not inputs.

**The fix is invisible in the default host until ship.js passes `--change` at `create`** → This is the one required caller edit. Without it, `state.change` is undefined and behavior is unchanged. The task order puts the failing test first so this cannot be mistaken for done.

## Migration Plan

Additive, no data migration. An in-flight `state.json` without `change` continues to work via the flag fallback, and produces `unnamed` when the flag is also absent — exactly today's behavior.

Rollback is a revert. Trajectory files written under the fix stay readable: the field is a value, not a schema change, and `RUN_LOG_SCHEMA` does not move.
