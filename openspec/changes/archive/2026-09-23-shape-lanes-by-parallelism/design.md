## Context

See proposal.md — Why. The explore brief behind this design is `.claude/handoff/explore-shape-lanes-by-parallelism-20260923-105550.md`. **D1**: the change lives in this repo. jumphour only produced the plan that exposed the problem.

The constraints that shape the how:

- **The planner is pure and replayed.** `lib/waves.mjs` has no fs, clock or agent access. Every run-state transition returns a new frozen state, and a resumed run is replayed through the same transitions (`lib/waves.mjs:65-83`). Fusion must therefore be a pure function of the planned batches plus the effective cap table.
- **Lanes are bare task arrays everywhere downstream.** They appear in `plan.json`, the run state, step records and every host. A property hung on an array does not survive `JSON.stringify` (`lib/waves.mjs:742-751`). A lane's *kind* exists only on the planner's build-time entries, so anything a dispatcher must know has to be derivable from the task array alone.
- **The lane model is read at dispatch.** `lib/run.mjs:790` calls `laneModel(lane)`, and the preview and `plan.lanes[].model` call the same function. `bin/interlock:958-970` hand-copies it as `laneModelOf` for the `agent-spawn` trajectory rows, and that is the only writer of implementer spawn rows.
- **Where serial batches come from.** `foldSingletonWaves` (`lib/waves.mjs:795-818`) appends a one-task wave's batches onto the previous wave, across layers and groups. The same shape comes from dependency layers and from over-cap component splits.
- **Handoffs cross waves only.** Later batches of one wave receive only the previous *wave's* packets (`lib/waves.mjs:2076-2099`).
- **Replan does not fold or clamp.** `makeWave` (`lib/waves.mjs:1778-1810`) re-lanes a revised group without folding and without clamping. `adoptWave` is split-only by contract (`lib/waves.mjs:1812-1873`).
- **A null result fails every task.** `laneOutcomes` fails every task of a lane whose agent returned nothing (`lib/run.mjs:1645-1647`). The run halts when accumulated failures exceed `LIMITS.taskFailureHalt` (2).
- **Plan reuse is gated first by `PLAN_FORMAT`.** It is `interlock.ship-plan/3` (`lib/plan-fingerprint.mjs:54`) and is checked before the hash.

No new library. Nothing to pin.

## Goals / Non-Goals

**Goals:**

- A batch boundary that buys no parallelism costs no agent. Every run of consecutive single-lane batches in a wave becomes one agent, and no two lanes that were planned to run concurrently are ever serialized.
- Lane model follows lane shape, derived in exactly one function that dispatch, preview, plan report and trajectory all read.
- Losing one agent costs one failure, whatever the length of its lane.
- Every fusion is visible in the plan and the preview, the same way every fold already is.

**Non-Goals:**

- Adding parallelism the section-and-path model does not already allow. Cohesion lanes are not unpacked (D7).
- Retuning the lane-cap table, the solo envelope or the effort table (D9, D16).
- Changing the classifier prompt or the implementer briefing (D14, D15).
- Fusing at run creation or at resume. A run in flight keeps the batch shape it was planned with.
- Wiring the planner's uniform lane-cap override to a CLI flag. That gap predates this change and is recorded under Risks.

## Decisions

### D2 / D3 — Lane model is a function of lane shape, computed in `laneModel`, imported everywhere

```js
export function laneModel(lane) {
  if (lane.length >= 2) return 'opus'
  const only = lane[0]
  return (only && only.model) || 'sonnet'
}
```

A lane of one task keeps the planner-clamped model on that task. That is haiku or sonnet, or opus for a tier-5 opus task or a solo promotion. A lane of two or more — collision, cohesion or chain — dispatches on opus. This is the maintainer's instruction, verbatim in intent (**D2**).

**D3** puts the rule in `laneModel` and nowhere else. Nothing rewrites `task.model`, and `bin/interlock` imports `laneModel` and `laneLabel` in place of its `laneModelOf`/`laneLabelOf` copies. The rule is derived from the array, so a reused, narrowed or replanned plan dispatches by the same rule with no extra bookkeeping. A lane narrowed to one task returns to that task's model.

*Alternative rejected:* promote `task.model` at plan time, as solo does. That restates a lane fact on every task, needs a second copy in `makeWave`, leaves an opus task behind when `narrowPlan` shrinks a lane to one, and breaks task-level model pins for no behavioural gain.

*Alternative rejected:* opus only for multi-task lanes holding a task above tier 2. That adds a second threshold and keeps small-task lanes on sonnet, contradicting "default opus". Small-task lanes still run cheaply because effort stays `low` (D9).

The solo promotion stays as it is: it records a planner decision and keeps a one-task solo lane on opus.

### D4 / D5 / D6 / D8 — Chain fusion: one pure step, inside one wave, bounded by the existing caps

A new pure helper, `fuseSerialBatches(batches, laneCaps)`, returns `{ batches, chains }`:

- It walks the batches in order.
- A batch holding exactly one lane is appended to the open chain when `open.length + lane.length <= capForTier(laneCaps, max(tier(open), tier(lane)))`. This is the same next-fit test cohesion uses at `lib/waves.mjs:660`. Otherwise the chain closes and the lane opens the next one.
- A batch holding two or more lanes closes any open chain and is emitted untouched.
- A chain drawn from one source batch is emitted as that original batch, same array identity. A chain drawn from two or more becomes `[[fusedTasks]]` and is recorded in `chains`.

Where it runs:

1. **`planWaves`, waves mode.** It runs on every implementation wave *after* `foldSingletonWaves`, because the staircase only exists after the fold, and on the test wave's batches after they are built. It runs *before* the lane, effort and warning reports, so they describe what will dispatch.
2. **`makeWave`**, on the batches it builds for a revised group, under `state.laneCaps` (see D10).

It never runs in `adoptWave` or `createRunState`: a plan's boundaries are the answer, and a run adopts them as they are.

**D4**: fusion never crosses a wave boundary. The helper only ever sees one wave's batches, so it cannot cross the red/non-red or implementation/test boundary either. A cross-wave fusion would erase an authored checkpoint and quietly turn a waves run into a partial solo run, which the preview exists to prevent (`lib/waves.mjs:61-63`). Solo already covers "one agent, whole change", with its own envelope and precedence (archived cohesion D6). A solo plan skips the helper entirely.

**D5**: the bound is the existing per-tier table, read through `effectiveLaneCaps`. There is no new cap, and a uniform override of 1 fuses nothing. The table already answers "how much work of this tier may one agent hold before an interruption loses too much" (replay loss; archived `2026-08-23-fold-serial-batches-into-lanes` design). A separate chain cap, or `SOLO.maxTasks`, would re-join the cap-sized halves of an over-cap collision component that `packLanes` placed in successive single-lane batches, defeating the table.

**D6**: a chain keeps batch order, then each constituent lane's own order. It is never re-sorted by task id. The id sort inside cohesion is safe only because one layer has no internal edges (`lib/waves.mjs:636-639`). A chain spans layers, so an id sort could put a dependent before its dependency.

**D8**: a batch joins a chain whatever made it single — a dependency layer, a folded singleton, an over-cap split, or width deferral (including `maxParallel` 1). The rule against folding a width-deferred lane (`lib/waves.mjs:695-699`) exists because folding it into *another lane of a parallel batch* "turns a throughput cap into a latency penalty". A single-lane batch has no parallel siblings, so the penalty cannot arise.

Tests that pin batch-level semantics and are not about fusion keep their intent by planning with a uniform override of 1, or with a fixture whose batches hold two lanes. No assertion is deleted.

### Reporting a chain

A chain is a fourth lane kind, `LANE_CHAIN = 'chain'`.

- **`plan.lanes`.** It lists every *dispatched* lane of two or more tasks, post-fusion, with its final kind. A chain entry also carries `fusedBatches`: the number of batches it replaced. `laneCount` and `projectedWaveLoopAgents` count dispatched lanes, so fusion shows up as a smaller bill.
- **Warnings.** The build-time warnings (collision, cohesion, folded singletons, serialized paths, dependency deferrals) are still emitted from the build-time entries, so a cohesion fold that later became part of a chain is still named. One more warning per chain names its ids in run order, the batches it replaced, its tier and cap, and that one opus agent runs it. The dependency-deferral warning now says a dependent runs "in a later batch, wave or lane position".
- **Preview.** `formatPlan` gains a `chain` line beside the existing `lane` lines. `formatBatches` already prints `laneModel` in each multi-task lane header, so a chain renders as `[opus/Tn]` above its per-task `[sonnet/Tn]` lines. The per-task lines keep showing each task's own clamped model; the header is what dispatches.

**D13**: the "effectively serial" warning is measured on the pre-fusion lane count — the post-fold count, exactly as today — so its firing is unchanged by this change. The comment at `lib/waves.mjs:1246-1248` states the intent: a chain the planner already folded "is not a shape the operator still has to fix".

### D7 — Cohesion is not unpacked to buy parallelism

The ceiling stays 3. In the only recorded runs (jumphour `dd5f75c7`, `2172bf72`), predicted paths matched 1 of 61 reported paths. Two of the five "path-disjoint" cohesion lanes actually shared a file: 3.3/3.5 on `.../oauth/callback/route.ts`, and 8.2/8.4 on `src/app/page.tsx`. `isolateWaves` defaults to false, so unpacking those lanes into parallel agents would have written each file concurrently. Cohesion's recorded reasons — spawn economy and one agent agreeing a convention (archived cohesion D1/D4) — still hold.

Under D2 a packed lane is now an opus work agent, which is what the maintainer asked for when work does not *efficiently* parallelize. Parallel single-task sonnet lanes remain wherever the planner already produces them: tier-4/5 components, and components that overflow a cohesion lane.

### D9 — Effort stays tier-derived

`laneEffort` is unchanged. An opus lane of tier-1/2 tasks runs at `low`, and tier-3/4 lanes inherit the session default. Effort and model were deliberately made independent dials (archived effort-routing D1), so moving the model does not move effort. That is also the cost lever for small-task lanes.

### D10 — Replan fuses and clamps

`makeWave` clones each revised task and applies `clampModel`, recording any clamp as a run-state warning, the same way `adoptWave` records a re-split. It then layers and packs as today and runs `fuseSerialBatches` under `state.laneCaps`. The clamp makes "a single-task lane runs its clamped model" hold on every path: the replan ping's tasks never passed the planner clamp (`lib/waves.mjs:2486-2559`). The fusion makes a replanned dependency chain one agent, as it would have been at plan time, rather than `[[A]],[[B]],[[C]]`.

### D11 — A lane that returns nothing costs one failure

In `laneOutcomes`, a multi-task lane whose result is absent returns `failed` for its first task, with the existing reason `agent returned no result`, and `not-attempted` for every later task. A single-task lane is unchanged.

A result that *omits* an outcome, or carries no per-task outcomes, still fails every task. That is the contract the briefing states to the agent ("A result that omits a task you were given fails every task in this lane"), and the agent can keep it. A lost agent is a different case: the Workflow host maps a briefing-hash mismatch to a null result, and runner hosts map a timeout or crash to one.

Nothing is ticked, so no unconfirmed task can ship as done. The not-attempted tail is re-dispatched by the next run's narrowed plan, and a lane with a failed task is still neither folded nor ticked (`openspec/specs/ship/run-program/spec.md:84`). Without this, a single briefing-ack miss — observed in jumphour `dd5f75c7` — on any chain of three or more tasks halts the run by itself.

### D12 — Plan format `/4`, no new fingerprint line

`PLAN_FORMAT` becomes `interlock.ship-plan/4`, and its doc comment says `/4` fuses serial single-lane batches into chain lanes. A stored `/3` plan is rejected with the format-version reason, not the misleading "artifacts have been edited". No canonical line is added, because no new cap exists (D5).

A run already in flight on a `/3` state is not re-planned. It keeps its unfused batches, and its multi-task lanes dispatch on opus from the next batch on, because `laneModel` is read at dispatch.

### D14 / D15 / D16 / D17 — What stays unchanged, and why

- **D14 — classifier prompt.** `lib/prompts/planner.mjs` is unchanged, and lane-shape routing is not described to the classifier. "Only tier 5 may be opus" stays true of the task `model` field it writes. A classifier told that multi-task lanes run on opus could under-tier work, or invent paths to collide, expecting opus to cover it. The planner withholds bounds from the classifier for the same reason (`lib/limits.mjs:387-392`).
- **D15 — implementer briefing.** The multi-task briefing already says "IN THIS ORDER", finish each task before the next, and stop at the first failure with a per-task outcome (`lib/prompts/implementer.mjs:78-108`). No briefing renders the model (`implementer.mjs:127` renders only the tier). The lane fixtures therefore stay byte-identical.
- **D16 — lane-cap table.** The table is not retuned. Its tier-5 entry of 8 was justified as "the only opus lane in waves mode", and that premise is now false, so the comment is rewritten. The values stay until a run corpus holds opus lanes; today it holds none (`interlock report --json` in both repositories).
- **D17 — hosts.** No opus-reachability probe is added. The Workflow and Claude CLI hosts pass `opus` through. The Codex and Qwen map-only hosts already banner every unrouted spawn (`bin/interlock-run:301-311`). `docs/07` gains the instruction to map `opus` as well as `sonnet`.

### Invariant sweep

The derived values are *a lane's model* and *a wave's batch shape*. Every reader is listed below with what this change does to it.

| Reader | Reads | Action |
|---|---|---|
| `lib/run.mjs:790` spawn | `laneModel(lane)` | none: the call is unchanged and the new body applies |
| `bin/interlock:958-1000` `logAgentSpawns` | own `laneModelOf` / `laneLabelOf` | **import `laneModel` / `laneLabel`** and delete the copies |
| `lib/waves.mjs` `formatBatches`, `formatPlan`, `plan.lanes[].model` | `laneModel` | none for the model; add the `chain` kind lines |
| `lib/waves.mjs` `projectedWaveLoopAgents`, `laneCount` | lane count | none: counts dispatched lanes, post-fusion |
| `lib/waves.mjs` serial warning | lane count | measured pre-fusion (D13) |
| `lib/waves.mjs` `makeWave` | batch shape, task model | fuse and clamp (D10) |
| `lib/waves.mjs` `adoptWave`, `createRunState` | batch shape | none: adopt as planned |
| `lib/plan-fingerprint.mjs` `narrowPlan`, `PLAN_FORMAT` | lane arrays | format bump only; a narrowed chain re-derives its model |
| `lib/run.mjs` `laneOutcomes` | lane length | no-result accounting (D11) |
| `lib/prompts/implementer.mjs` | lane tier, lane length | none (D15) |
| `lib/merge-lanes.mjs`, `bin/interlock` `runMergeLanes` | lane labels per batch | none: a chain is one lane with a unique label |
| `workflows/ship.js`, `bin/interlock-run`, `lib/host/*` | the spawn's `model` slug | none: they must not restate policy (`test/workflows.test.mjs:1349-1375, 3525-3560`) |
| receipt, outcomes, report, metrics | no model | none |
| `lib/limits.mjs` `LANE_CAPS` / `SOLO` comments; `docs/04, 06, 07, 10` | prose restating the old rules | rewrite |

## Risks / Trade-offs

- [Cost: multi-task lanes move from sonnet to opus, about 5x per token at list price (`lib/limits.mjs:287-298`)] → This is the maintainer's explicit choice. Tier-1/2 lanes stay at `low` effort, fusion removes agents (18 → 10 implementation agents on the jumphour plan), and the price shows up as per-wave output tokens in the receipt.
- [Replay loss grows with lane length: an interrupted chain re-runs from its first task on resume] → Bounded by the same per-tier cap that bounds every lane (D5), and accepted on the same terms as cohesion.
- [A long opus chain is more likely to hit the runner hosts' 30-minute per-spawn default] → D11 keeps a lost agent to one failure. The cap bounds chain length. `--timeout-ms` and `INTERLOCK_*_TIMEOUT_MS` already exist.
- [Map-only hosts without an `opus` mapping run multi-task lanes on the operator's default model] → Already bannered per spawn as `MODEL ROUTING UNAVAILABLE … no mapping for opus`; `docs/07` tells operators to map `opus`.
- [No operator-level switch to turn fusion off: the uniform override that reproduces one agent per task is reachable only through the `planWaves` API, not `interlock waves` or `run start` (`bin/interlock:1537-1552`)] → Predates this change and is out of scope. Rollback is a revert (see Migration Plan).
- [A chain may hold tasks from several folded groups under the wave's first group number; `revisableGroups` keys on `wave.group`] → Predates this change for folded singletons. Fusion adds no new replan entry point, because replan still happens only at a wave's first batch.
- [The evidence is one change, two halted runs, one host] → It licenses the direction, not tuning. That is why caps and effort are unchanged (D16, D9).
- [Tests that pass before the implementation exists pin nothing] → Some §1 tests are regression guards that already pass today, such as "a batch of parallel lanes is never fused". The reviewer should confirm that the fusion, model-rule, no-result and format tests fail against the current code.

## Migration Plan

1. Land the change. The first `ship` of any change with a stored `/3` plan re-plans once: one classifier pass, with the format-version reason printed.
2. A run in flight keeps its planned batches. Its multi-task lanes dispatch on opus from the next batch, because `laneModel` is read at dispatch.
3. Operators on Codex, Qwen or a non-Claude ACP agent add an `opus` entry to `INTERLOCK_MODEL_MAP`.
4. Rollback: revert the change. Plans written as `/4` are then rejected by the `/3` reader and re-planned, with no manual cleanup.
