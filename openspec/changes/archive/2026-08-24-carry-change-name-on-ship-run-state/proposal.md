## Why

The `ship-run` specification already requires every trajectory line to carry a change name: *"Each trajectory line MUST be a JSON object with a schema identifier, timestamp, run id, **change name**, monotonic sequence number, and a `type` of …"*. The implementation does not deliver it. Across the 1162 recorded events in this repo's `.claude/ship/runs/`, **every single line reads `"change": "unnamed"`**, and in a live run captured from `planet-wars-simulation` only the one script-authored `run-start` event carried the real name (`add-sandboxed-match-execution`) while all fourteen subsequent events read `unnamed`.

This is a conformance bug, not a missing feature. It blocks every cross-run analysis that has to group trajectories by the change they shipped, and it is load-bearing now because a run-scoring effort is being built directly on this corpus.

## What Changes

- `createRunState` accepts and stores the change name on the frozen run state, alongside `runId`, so it travels with the state exactly as `runId` already does.
- `logWaveMutation` and `logAgentSpawns` read the change name from the state as the authority, falling back to the `--change` flag only when the state does not carry one (states written before this change).
- `wave-state create` passes its existing `--change` flag into `createRunState`.
- Ship hosts pass `--change` at the `create` call only. Every later `wave-state` invocation stops needing the flag.
- The defensive fallback in `summarizeRunLog` (read the change from `run-start`, then from `records[0]`) is retained but stops being load-bearing.

No event shape changes. No new event type. `appendRunLogEvent` keeps defaulting an absent name to `unnamed`, because a state that genuinely has no name must still produce a readable line.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ship-run`: the requirement that each trajectory line carries a change name gains scenarios that pin *where the name comes from*. Today the requirement is satisfiable only by a caller remembering a flag at every call site, which is why it is not satisfied. The change name becomes state-carried, so conformance is structural rather than a matter of caller discipline.

## Impact

**Root cause.** The change name is a per-invocation CLI flag (`bin/interlock:1336`, `const change = typeof flags.change === 'string' ? flags.change : undefined`) that each caller must remember. It is threaded to `logWaveMutation` and `logAgentSpawns` as a parameter, and when absent, `appendRunLogEvent` defaults it to `unnamed`.

The two hosts disagree, and both are partly wrong:

| Host | `wave-state` invocations | Pass `--change` |
|---|---|---|
| `workflows/ship.js` (default host) | 11 | **0** |
| `bin/interlock-ship-acp` | 6 | 4 (omits the two bare `next` calls) |

A flag that must be repeated at eleven prompt-embedded call sites is a flag that will be dropped. It already was, in both hosts.

**Affected code.**

- `lib/waves.mjs` — `createRunState` gains a `change` field on the frozen state.
- `bin/interlock` — `wave-state create` forwards `--change` into `createRunState`; `logWaveMutation`, `logAgentSpawns`, and the `verify judge` append site read the state first.
- `workflows/ship.js` — `--change` added to the two `wave-state create` invocations; the other nine need no edit.
- `bin/interlock-ship-acp` — `--change` retained at `create`; the redundant per-call flags may be left in place harmlessly.

**Consumers of the trajectory change name** (the invariant sweep — every reader of this value):

- `summarizeRunLog` → `change` field of a run summary
- `listRunLogs({ change })` → the change filter, which today works only via the `run-start` fallback
- `formatRunLogList` → the `change=` column
- `checkRunLog` → unaffected (does not read the name)

**Not affected.** `.claude/learning/outcomes.jsonl` already records the change name correctly; it is written from a script-authored record, not from a CLI flag.

**Compatibility.** A `state.json` written before this change has no `change` key. The flag fallback keeps those states working, and a state with neither continues to produce `unnamed` rather than failing the run — losing a trajectory label must never lose the run.
