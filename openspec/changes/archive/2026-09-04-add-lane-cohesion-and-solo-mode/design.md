## Context

See proposal.md — Why. The constraints that shape the how:

- **The planner is pure and replayed.** `lib/waves.mjs` has no fs, clock or agent access, and a resumed run is replayed through the same transitions from cached agent results (`lib/waves.mjs:36-53`). Any new packing rule must be a pure function of the classified input plus caps read from `lib/limits.mjs`, and every transition must keep returning a new frozen state.
- **Lanes form only from path collisions today.** `buildLanes` (`lib/waves.mjs:430`) builds connected components over canonical paths and splits each at `LIMITS.maxTasksPerAgent`; `packLanes` never merges a width-deferred lane into another (`lib/waves.mjs:513`, design D3 of `fold-serial-batches-into-lanes`). That rule is also a requirement in `openspec/specs/lanes/spec.md`, so changing it is a spec delta, not a code tweak.
- **The lane cap is a single scalar with several readers.** `LIMITS.maxTasksPerAgent` is read by `planWaves`, `makeWave`, `createRunState` (carried on the run state for replans), `lib/plan-fingerprint.mjs` (`capsOf`, the canonical text, `formatFingerprint`) and `formatLimits`. The LIMITS invariant test requires every entry to be a positive integer, so a tier table cannot live inside `LIMITS`; the precedent is the separate `EFFORT` export. The cap-authority test (`test/spine/limits.test.mjs`) requires every printed cap to have a code reader named as `<GROUP>.<cap>`.
- **The model clamp is a classifier guard, not a planner rule.** `clampModel` allows opus only at tier 5 because classifiers over-assign it (`lib/waves.mjs:10-14`). `laneModel` reads the hardest task's `model` field, and `workflows/ship.js` and `bin/interlock-ship-acp` both dispatch on `laneModel`; the ACP host loads the dispatch helpers and the prompt assembler out of `ship.js` source between markers, so a change to those functions reaches both hosts.
- **The implementer prompt is pinned byte for byte.** Ten fixtures under `test/fixtures/prompts/` pin the single-task prompt and the multi-task lane prompt per tier. The `implementer-prompts` spec requires the single-task form to stay identical; the lane fixtures are a deliberate-update contract, not a spec requirement.
- **The runtime loads no modules**, so anything `ship.js` needs from the planner is mirrored and parity-tested (`laneModel`, `laneEffort`). Adding a mirrored function is a cost; passing a flag the run state already carries is not.
- **A stored plan is reused only on a fingerprint match** over the artifacts, the caps and a plan format version (`lib/plan-fingerprint.mjs`, `PLAN_FORMAT`). A plan shaped for a different reader is rejected by the version, not by the hash.
- **The classifier already reads every artifact in full** (`plan-waves`, `workflows/ship.js:1471`). It is the most expensive fixed step of a run. A second planning agent that read the same inputs would double that cost.

No new library. Nothing to pin.

## Goals / Non-Goals

**Goals:**

- Fewer, fatter implementer agents on low-tier work, with every fold reported and every guarantee the batch model gives (no two concurrent writers of one path, no reordering of dependent work, no silent task loss) preserved.
- A small change can be shipped by one opus agent inside the ship loop's verify-and-commit guarantees, decided inside a published envelope rather than by prose.
- A plan with no tier ≤ 3 siblings and no solo decision is byte-identical to today's plan.
- Every threshold this change introduces is stated once in `lib/limits.mjs`, printed by `interlock limits`, read by code, and covered by the cap-authority test.

**Non-Goals:**

- A separate planning agent. The classifier gains one output field; judgment stays where it already is.
- A classifier-supplied grouping hint (`cohort`). Eligibility is by tier only in this change; a hint is a follow-up if mechanical packing merges the wrong things.
- Co-scheduling two writers of one path, or folding a dependent task into the same batch as its dependency in waves mode.
- Changing how the merge fold, worktree isolation, handoff packets or the failure budget work. A solo plan is a one-lane plan to all of them.
- Tuning the envelope or the cap values from measurement. They are first guesses recorded in the ledger, retunable as data.

## Decisions

### D1 — Cohesion is mechanical and tier-gated; the classifier is not asked which tasks belong together

Inside one dependency layer, after collision components are formed, a component is **cohesion-eligible** when its hardest tier is at or below `LANE_CAPS.cohesionMaxTier` (default 3). Eligible components pack into shared lanes (D3); ineligible components (tier 4 and 5) stay collision-only lanes as today.

*Why tier and not a hint:* the ask is "no thin spawns for minor tasks", and tier is the planner's existing record of minor. A hint would be a second field the classifier can get wrong, and the model clamp exists because classifiers already get one such field wrong reliably. Tier 4 is excluded on purpose: cross-file pattern-following work is where a fresh context and per-task isolation still pay for themselves.

*Alternative rejected:* pack everything below `maxParallel` regardless of tier. That serializes judgment-heavy work to save a spawn, which is the wrong trade.

### D2 — The lane cap becomes a per-tier table in a separate export; the scalar is removed, not duplicated

`lib/limits.mjs` gains:

```js
export const LANE_CAPS = {
  byTier: { 1: 8, 2: 8, 3: 6, 4: 4, 5: 8 },
  cohesionMaxTier: 3
}
export const SOLO = { maxTasks: 20 }
```

`LIMITS.maxTasksPerAgent` is removed. A lane's cap is `LANE_CAPS.byTier[laneTier(lane)]`; an untiered lane (tier 0) uses the tier-1 cap. Tiers 4 keeps today's 4; tier 5 is raised to 8 because a tier-5 lane is the only opus lane in waves mode and the whole point of an opus worker is that it can hold more of one design in its head (ledger D2). The `opts.maxTasksPerAgent` override on `planWaves` stays and is applied as a uniform ceiling (`min(table cap, override)`), so an override of 1 still reproduces one agent per task exactly — cohesion cannot produce a lane longer than the override.

Both groups are separate exports for the same reason `EFFORT` is: the LIMITS invariant asserts positive integers. The cap-authority test gains a `LANE_CAPS` group (tokens `LANE_CAPS.byTier`, `LANE_CAPS.cohesionMaxTier`) and a `SOLO` group (`SOLO.maxTasks`), so each printed cap must have a code reader. `interlock limits` prints them and emits them as `laneCaps` and `solo` in JSON.

**Invariant sweep — every reader of the old scalar switches to the table:** `planWaves` (opts and output field), `buildLanes`, `makeWave`, `createRunState` (state field, D10), `lib/plan-fingerprint.mjs` (`capsOf`, the canonical `max-tasks-per-agent` line, `formatFingerprint`), `formatLimits`, and every test that names `maxTasksPerAgent`. A reader left on the scalar is a defect, and the removal (rather than a deprecated alias) is what makes the sweep enforceable: a stale reader fails at import.

### D3 — Packing is next-fit over hardest-first components, and lane order is task-id order

Within a layer, components are already ranked hardest-first then by id. Eligible components are walked in that order and appended to the open cohesion lane while `lane.length + component.length <= cap(max(laneTier(lane), laneTier(component)))`; otherwise the lane closes and a new one opens. Because the walk is hardest-first, the first component fixes a lane's tier and therefore its cap, so the cap can never shrink under a lane that already filled it. Tasks inside the finished lane are sorted by `byTaskId`, exactly as collision lanes are — two collision components merged by cohesion may interleave by id, which is authored order and runs in one agent, so no concurrency guarantee is spent.

Cohesion lanes then enter `packLanes` like any other lane: they are path-disjoint from every other lane in the layer by construction (their components were), so no batch ever co-schedules two claimants of one canonical path. A pathless task joins a cohesion lane by tier; it was unguarded before and is unguarded now, no worse.

*Why next-fit over first-fit:* first-fit packs marginally tighter but lets a later small component slip into an earlier lane whose tier it does not share, which makes "which agent got this task" harder to read off the plan. Next-fit is one open lane, one rule, one line in the preview.

### D4 — Cohesion never crosses a layer, a section, or the implementation/test boundary, and it applies to the test wave

A dependent task stays in its later layer, so the existing "edge-connected tasks are never co-scheduled" rule holds unchanged in waves mode. The trailing test wave is packed by cohesion per layer with the same gate: the deferral exists so a cross-cutting failure is diagnosed once against finished work, which is about *when* tests run, not how many agents run them. Sixteen tier-2 test tasks were sixteen spawns; that is the shape this change exists to end.

### D5 — A solo plan is one wave, one batch, one lane, in section-then-layer-then-id order, tests last

In solo mode `planWaves` emits one implementation wave (group = the lowest classified group), holding one batch of one lane: every implementation task ordered by (group ascending, dependency layer ascending, task id ascending), followed by every test task ordered by (layer, id). `testWave` is `null`. The order honours every section barrier and every `dependsOn` edge by sequence inside the agent rather than by batch boundary. `foldSingletonWaves`, `packLanes` and the collision report are bypassed (there is nothing to pack); the plan still runs `validate`, the clamp and the unusable-path report.

To the state machine a solo plan is a plan whose single wave has one batch; `nextStep` runs it, `recordBatchResult` adjudicates one `LANE_SCHEMA` result with per-task outcomes, and `done` follows. Inter-wave verify never fires (no following wave); the final unit verify and commit are unchanged. Under `--isolate-waves` it is one worktree and one fold.

### D6 — Mode precedence: flag, then classifier inside the envelope, then waves

`planWaves` takes `opts.mode` (`'solo' | 'waves' | null`) and reads `input.recommendedMode` (`'solo' | 'waves'`, optional) and `input.modeReason` (string, optional). The decision, in order:

1. `opts.mode` set → that mode, `modeSource: 'flag'`. A forced solo above the envelope is honoured and warned (`solo forced by flag: N tasks exceeds the published envelope of M`). A human flag is the one input allowed to exceed a cap, the same way `--max-parallel` may ask for anything under the runtime ceiling.
2. Else `recommendedMode === 'solo'` and `tasks.length <= SOLO.maxTasks` → solo, `modeSource: 'classifier'`, `modeReason` carried verbatim (bounded to the handoff character cap so a runaway reason cannot bloat the plan).
3. Else `recommendedMode === 'solo'` above the envelope → waves, `modeSource: 'default'`, warning naming the count and the bound (`classifier recommended solo for N tasks; the envelope is M, planned as waves`).
4. Else waves, `modeSource: 'default'`.

The envelope is one bound, task count, because the ask was explicitly "not a hard rule at 20": the classifier supplies the shape judgment, the envelope supplies the ceiling, and neither restates the other. `recommendedMode` absent or unrecognized is `waves` with no warning, so an old `classified.json` plans exactly as before.

The ship invocation gains `--solo` and `--waves` (`parseInvocation` → `laneMode`). Both at once is a parse-time halt naming the contradiction, not last-wins. `laneMode` threads to `interlock waves --mode`, `interlock plan reuse --mode` and `interlock plan fingerprint --mode`.

### D7 — A solo lane runs on opus by promotion in the planner, effort by the existing table, briefing at the full-read tier

After the clamp, solo mode rewrites every task's `model` to `opus` and records each rewrite in a `promoted` array shaped like `clamped` (`{ id, from, to, tier }`); a task already on opus is not listed. `laneModel` therefore returns opus with no change to `ship.js` or the ACP host, and the clamp's purpose (stop the *classifier* escalating) is untouched because the escalation is the planner's own decision.

Effort stays `laneEffort(lane)`: the hardest tier's entry in `EFFORT.byTier`, which for a typical small change is inherit. Solo does not force `xhigh`; that table is the one place effort policy lives.

The briefing tier is `max(laneTier, 4)` so a solo agent always reads `design.md` and the specs in full. This is a `solo` flag into `assembleImplementerPrompt` (D9), not a rewrite of task tiers: tier is the classifier's record and drives effort and the promotion report, and rewriting it would misreport both.

### D8 — Test tasks join the solo lane

They run last inside the same agent (D5). The `isTestTask` flag is preserved on each task so `interlock tasks tick` and the outcome record treat them as they do today. The cross-failure procedure the sequential apply skill describes is not copied into the prompt: the ship loop's final unit verify and `rootCauseIterations` already own repair, and a second repair loop inside the implementer would be a cap written twice.

### D9 — The multi-task heading is reworded once; a solo lane gets its own heading; single-task text is untouched

The lane heading currently says the tasks "edit the same files", which is false for a cohesion lane. It is reworded to a statement true for both: the tasks are one lane run by this agent alone, and no other agent touches the files they claim while it works. The five `implementer-lane-tier-*.txt` fixtures are regenerated as a deliberate act in the same task. The single-task prompt and its five fixtures do not change.

`assembleImplementerPrompt` gains `solo: boolean`. When set it renders a whole-change heading (the change name, the task count, the instruction that this agent owns the entire change including its tests, in the listed order) and applies the D7 briefing tier. Five new `implementer-solo-tier-*.txt` fixtures pin it. `wave-state next` echoes the run state's `mode`; `ship.js` passes `solo: next.mode === 'solo'`, and `bin/interlock-ship-acp` passes the same one field at its own assembler call. No new mirrored function.

### D10 — Run state carries `mode` and `laneCaps`; older states read as waves under the published caps

`createRunState` stores `mode` and the `laneCaps` table (replacing the scalar `maxTasksPerAgent` field) so `makeWave` lanes a replanned group under the caps the run started with and `wave-state next` can report the mode. A state written before this change has neither field; `requireState` treats absence as `mode: 'waves'` and `laneCaps: LANE_CAPS.byTier`, the same fallback shape the outcome-audit fields already use.

Replan in a solo run: there is one wave, and `revisableGroups` excludes executed groups, so once the lane has run there is nothing to revise and `replan` cannot be the next action. Before it runs, a replan revises the whole change as one group and is re-laned as a solo lane (mode is read from the state, not recomputed).

### D11 — Plan format `interlock.ship-plan/3`; the fingerprint covers mode, the cap table and the envelope

`PLAN_FORMAT` is bumped so every stored `/2` plan is rebuilt once (a `/2` plan has no cohesion lanes and no mode; reusing it would silently keep the old shape). The canonical text gains, after the existing cap lines: `mode <solo|waves|auto>` (`auto` when no flag was passed — the classifier's recommendation is an *output* of planning and is not hashed), `lane-caps 1:8 2:8 3:6 4:4 5:8`, `cohesion-max-tier 3`, `solo-max-tasks 20`. `capsOf` reads `LANE_CAPS` and `SOLO`; `formatFingerprint` prints them. `narrowPlan` spreads the plan, so a narrowed solo plan keeps `mode`, `promoted` and `modeSource`; narrowing a solo plan's single lane keeps it a single lane.

### D12 — Reporting is additive and every decision is spoken

The plan gains `mode`, `modeSource`, `modeReason`, `promoted`, and each entry in `lanes[]` gains `kind: 'collision' | 'cohesion' | 'solo'`. `formatPlan` prints `mode: solo (classifier: <reason>)` or `mode: waves (default)` on its first line, prints a `cohesion` line per cohesion lane beside the existing `lane` lines, prints `promoted` entries beside `clamped`, and the warnings named in D6. `projectedWaveLoopAgents` needs no change: it already bills lanes, not tasks.

## Risks / Trade-offs

- **A runtime per-agent turn ceiling could cut a solo lane short.** `workflows/ship.js` passes no turn budget and the workflow docs name none; if one exists, a 20-task lane returning `null` fails every task at once. → **Checked (task 1.4): the runtime exposes no per-agent budget.** `agent()` accepts `label`, `phase`, `schema`, `model`, `effort`, `isolation` and `agentType` — and nothing else. The only budget surface in the runtime is the workflow-level `budget` global (`{total, spent(), remaining()}`), which is the *turn's* token target from a user's "+500k" directive: one shared pool across the main loop and every workflow, readable but not allocatable, and `null` unless the user set a target. There is nothing to scale by lane length and nothing to pass at the spawn, so no allowance was added to `SOLO` and no reader was wired — a cap published here with no runtime option behind it would be a cap in prose. The consequence stands unmitigated and is accepted: a solo lane long enough to exhaust whatever implicit ceiling the runtime enforces returns `null`, which `ship.js` records as `ok: false` for every task in the lane at once, and the failure budget halts the run. `SOLO.maxTasks` (20) is the only bound, `--waves` is the lever, and if a long solo lane is ever observed dying whole, the envelope comes down rather than a budget going up.
- **Replay loss grows with lane length.** A lane is the unit an interruption discards; the old cap of 4 bounded that. → Accepted and stated: caps of 8 on tiers 1–2 and 5, and a solo lane the size of the change, trade replay granularity for spawn count. The override of 1 and `--waves` are the levers.
- **Serial latency.** Seven parallel agents finish in about one agent-duration; one agent doing seven tasks takes seven. → Intended. The envelope bounds it, the flag opts out, and the plan preview states the mode before anything runs.
- **Drift across task boundaries inside a fat lane** (task 3's work done under task 2's name) was accepted at 4 tasks; it is larger at 8 or 20. → Per-task outcomes, per-task packets with evidence locators, and stop-at-first-failure are unchanged; the evidence audit still cross-checks packets against observed paths.
- **The classifier over- or under-recommends solo.** → Bounded above by the envelope, overridable both ways by flag, and every refusal or forcing is a named warning.
- **Five lane fixtures change.** → Regenerated in one task with the heading change, the way every deliberate prompt edit has been landed; the single-task fixtures are the byte-identity contract and do not move.
- **Stored plans are rebuilt once** after the format bump. → One classifier pass per change, which every run paid before plan reuse existed.
- **Two hosts, one assembler.** The ACP host must pass `solo` too. → It loads the assembler from `ship.js` source; the one-field change is covered by `acp-host.test.mjs`.

## Migration Plan

1. Land `LANE_CAPS`, `SOLO`, the limits surface and the cap-authority groups with `cohesionMaxTier` honoured but no cohesion code yet — behaviour-identical, the sweep in D2 complete.
2. Land cohesion packing (D1, D3, D4) and its reporting. Waves-mode plans for tier ≥ 4 work are unchanged.
3. Land solo planning (D5–D8), the run-state fields (D10) and the fingerprint bump (D11).
4. Land the prompt changes and fixtures (D9), then the flags, skill table and docs.

Rollback: `--waves` disables solo for a run; `maxTasksPerAgent` override of 1 disables every fold; setting `cohesionMaxTier` to 0 disables cohesion while keeping the table. Deleting the stored fingerprint forces re-planning, as today.

## Open Questions

None that change the specs, the approach or the task breakdown. The cap values, the envelope and the solo model rule are ledger rows (D1, D2, D6, D7) — data in `lib/limits.mjs`, retunable without touching a spec.
