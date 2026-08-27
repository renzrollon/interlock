## Why

The wave planner has exactly one dial for matching agent capability to task difficulty: the model clamp in `lib/waves.mjs` (`laneModel`, line 219), which chooses among `haiku`/`sonnet`/`opus`. That is a coarse lever — three notches, and the clamp exists mostly to stop the classifier over-assigning `opus`. The workflow runtime already exposes a finer one, `opts.effort` (`low`→`max`), and the repository uses it **nowhere**: `grep -rn "effort" workflows lib` returns no routing, only prose. So a tier-1 rename and a tier-5 architecture task, when both land on `sonnet`, run at the same reasoning effort — the run pays `sonnet`-at-default for the rename and gets `sonnet`-at-default for the architecture. Effort is the axis that separates them without touching the model clamp, and since w16 `xhigh` is the recommended default for coding work — a default the ship run currently never reaches.

## What Changes

- Add `laneEffort(lane)` to `lib/waves.mjs` as a **sibling of `laneModel`**: same connected-lane input, same "capable of everything in it" rule (the lane's hardest task's effort, never the first task's). The planner emits `effort` on every lane it lists, beside the existing `model`.
- Assign effort **after classification**, exactly like the model clamp — the classifier cannot escalate its own effort — and **report every assignment** the way `laneModel` clamps are already reported (an `effort` entry per lane; the plan's warning surface names the tier→effort decision).
- Mirror the function into `workflows/ship.js` (a second `laneEffort` beside the existing mirrored `laneModel` at line 212). The workflow runtime rejects module loading, so the copy must stay behavior-identical to the `lib/waves.mjs` source — the same constraint already documented for `laneModel`.
- Pass `effort: laneEffort(lane)` into the implementer spawn at `workflows/ship.js:1404` (the `agent(…, { label, model, …workerExtra, schema })` call).
- Route the **adversarial review skeptics** and the **inter-wave verify** steps at `xhigh` effort — the two steps whose whole job is catching what an implementer missed.
- Publish the tier→effort defaults through `lib/limits.mjs` (read by `interlock limits`), so the mapping is read, never restated — "a cap written down twice is a cap that drifts."

## Capabilities

### New Capabilities
- `effort-routing`: how a lane's reasoning effort is derived from its tier after classification, reported, mirrored across the planner/runtime boundary, and applied at dispatch — plus the fixed `xhigh` effort of the verify and skeptic steps.

### Modified Capabilities
<!-- None. laneEffort is additive: the plan gains an `effort` field per lane and a new report entry; no existing wave/lane requirement changes behavior. -->

## Impact

- **Code**: `lib/waves.mjs` (new `laneEffort`, effort on emitted lanes, effort report entries), `workflows/ship.js` (mirrored `laneEffort`, spawn opt at line 1404, verify/skeptic step effort), `lib/limits.mjs` (effort-by-tier defaults + `interlock limits` surface).
- **Behavior**: cost/quality curve shifts — mechanical lanes cheaper, hard lanes and the two adversarial steps deeper — with the model clamp untouched.
- **Dependencies**: none. Uses the existing workflow-runtime `opts.effort`. No new library.
- **Compatibility**: a runtime that ignores an unknown `effort` key degrades to today's behavior; additive plan field.
