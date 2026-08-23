## Context

See `proposal.md` for why. Constraints that shape the how:

- `lib/waves.mjs` is still pure. The fold and the sticky-batch rule live there, not in `ship.js` prompt text.
- `ship.js` already records one ping per wave (`remainingBatches`). Collapsing 1-task waves is what drops `record-batch` / `inter-wave-verify` boots; the loop does not need a new branch.
- `classified.json` `group` is the model's number. Downstream of `planWaves`, the canonical wave list is the *collapsed* `plan.waves`. A second transform in `createRunState` would be a second meaning of "wave".
- `adoptWave` today flattens a wave and re-runs the collision packer. That is idempotent for a single classified group. It is not idempotent after a disjoint-path singleton has been appended as a later batch: the packer would pull that task into batch 0. Sticky batches are load-bearing for D2.
- `test/spine/waves.test.mjs` `simplePlan` builds one implementation task per group in order to get N waves. After this change that fixture is 1 wave. Every test that needs N checkpoints is a reader of the old meaning of `group` (D1 sweep).

No new library. No version pin.

## Goals / Non-Goals

**Goals:**

- A staircase of 1-task implementation groups becomes one wave of sequential batches, so the wave loop pays one record ping and at most one verify for that chain.
- A folded later batch with a disjoint path cannot be co-scheduled with an earlier batch of the same wave when a run is created.
- `/interlock:spec` writes wave-shaped `tasks.md` (one checkbox per file-shaped slice; numbered section = wave), even when a consumer `config.yaml` is empty.
- Every reader of `plan.waves` / `waveCount` / projected agent counts consumes the collapsed list (D1).

**Non-Goals:**

- A `dependsOn` field on classified tasks (D4).
- Forking `.claude/skills/openspec-propose/SKILL.md` (D6).
- Merging two waves that each already have two or more tasks.
- Co-scheduling two writers of one file.
- Changing how the trailing test wave is packed (`chunk` by `maxParallel`).
- Making sequential same-wave batches exchange handoff packets (existing remaining-batches contract; the working tree is the channel).

## Decisions

### D1 — Canonical wave list is post-fold `plan.waves`

Normalize once, at the end of `planWaves`, after collision packing. `waveCount`, `formatPlan`, `projectedWaveLoopAgents`, `folded[]`, and the serial warning all read that list. `createRunState` adopts `plan.waves` as given; it does not fold again.

**Sweep.** Readers of "how many implementation waves exist":

| Reader | Canonical? after this change |
|---|---|
| `planWaves` return (`waves`, `waveCount`) | producer |
| `formatPlan` | yes — collapsed |
| `projectedWaveLoopAgents` | yes — collapsed |
| `createRunState` / `adoptWave` | yes — adopts plan batches (D3) |
| `nextStep` / `recordBatchResult` (verify between waves) | yes — run state from collapsed plan |
| `workflows/ship.js` remainingBatches / fused verify | yes — via `wave-state next` |
| `classified.json` `task.group` | raw — left as the model wrote it; never used as waveCount |
| `test/spine/waves.test.mjs` `simplePlan` and `waveCount` assertions | must switch to post-fold meaning; fixtures that need N checkpoints use groups of 2+ tasks |

A reader that still treats "one classified group = one wave" after a 1-task group is a defect.

**Why not fold in `createRunState` only?** `interlock waves --json` is what humans and `formatPlan` show. Folding only at runtime would leave the 15-wave preview in `plan.json`.

### D2 — Fold every 1-task impl wave onto the previous impl wave

`taskCount === 1` on an implementation wave, and there is a previous implementation wave → append its batches, record `{ id, from, to }`. Same-path and disjoint-path singletons both fold. Wide waves (`taskCount >= 2`) never fold into each other. The test wave is not an implementation wave.

**Alternatives.** Same-path-only fold is safe under today's flatten-and-repack `adoptWave`, but leaves `2.6` (`run_match.py` after `match_runner.py`) as its own checkpoint — the cost this change exists to remove. `dependsOn` is D4. Prompt-only grouping already failed (`fix-wave-boundary-cost` design: "Prompt cannot be a cap").

Folded sequential batches of one wave do not see each other's handoff packets. That matches path-collision batches today. The next agent reads the working tree.

### D3 — `adoptWave` splits wide batches and does not re-pack

Replace flatten-plus-`collisionAwareChunk` with: keep each planned batch; if `batch.length > maxParallel`, split that batch (stable order, chunks of `maxParallel`); never move a task into an earlier planned batch.

Collision isolation stays: `planWaves` already put same-path tasks in different planned batches. D3 must not undo D2 by merging a later disjoint-path batch into batch 0 when `maxParallel` allows it.

### D4 — No `dependsOn` in this change

Happens-after across files is still `group` (a later section). The fold turns a 1-task later group into a later *batch*, which is enough ordering without a new classified-task field the model can get wrong. Revisit only if a real case needs "wait" without a checkpoint and without being a singleton.

### D5 — Serial warning is post-fold; a collapsed staircase is not "serial waves"

Keep `waveCount > implCount * 0.5` on the collapsed list. Ten 1-task groups become one wave and MUST NOT warn. `formatPlan` lists `folded` entries so the over-split is still visible.

### D6 — Wave-aware tasks live in `/interlock:spec`, not a forked propose skill

Stock `/opsx:propose` (`.claude/skills/openspec-propose/SKILL.md`) is OpenSpec's generic artifact writer. It has no waves. Patching that skill in this repo does not ship with the Interlock plugin, and Interlock users run `/interlock:spec`. Do not edit it.

**Insertion point.** Add a new subsection **`### Task shape for ship`** under `## 3. Generate artifacts, CLI-driven` in `skills/spec/SKILL.md`, immediately after the existing **Gates while generating** bullets and before **3a. The decision ledger**. Spec already applies `openspec instructions` `rules`; this subsection is the Interlock-owned rule so a consumer with an empty `config.yaml` still gets it. The implementer copies this block (the suite greps the distinctive phrase):

```
### Task shape for ship

`tasks.md` is the wave plan. A numbered `## N.` section is one wave. Follow these three rules when writing it:

1. Default grouping is the numbered section (`1.x` share a wave, `2.x` share the next).
2. Sequential same-file work is one checkbox — not one checkbox per TDD beat, comment move, or trap on the same production path.
3. Start a new numbered section only when a later set of tasks needs the previous section's output to already exist. Independent files that do not need each other belong in the same section so they can share a batch.

These rules apply even when `openspec instructions tasks` injects no `rules.tasks`. Path collisions inside a section are the planner's problem (`paths`), not a reason to increment the section number.
```

Also ship:

1. **`openspec/config.yaml` `rules.tasks`** — the same three sentences, CLI-injected for this repo (stock propose *here* honors instructions without a skill fork).
2. **`skills/review-artifacts/SKILL.md`** task-quality and **`docs/02-the-checkpoint.md`** — same-file staircase is a warning, not a ship halt. The planner fold is the cap if review is skipped.

Classifier rule 3 in `workflows/ship.js` is reworded to "later numbered section", not "later task".

Ping cost does not depend on this layer (D2 is the cap). This layer is implementer count (one agent per file-shaped slice) and real parallelism (independent files in one section).

## Risks / Trade-offs

- **[Independent 1-task sections become sequential batches instead of parallel waves] →** They were never parallel: different groups already run in order. Authoring (D6) is what puts independent files in one section so they share a batch. The fold only removes checkpoints.
- **[Folded later batch lacks the previous batch's handoff] →** Accepted; same as today's collision batches. Implementers read the tree.
- **[State-machine tests lose inter-wave verify because `simplePlan([1,2])` becomes one wave] →** `simplePlan` grows two disjoint-path tasks per group so N listed groups stay N waves. That update is part of the D1 sweep, not optional cleanup.
- **[Classifier still over-groups multi-task waves] →** Out of scope (D4). The measured failure was 1-task waves.
- **[Review warning is skipped] →** Fold still runs. Authoring is feed quality, not the cap.

## Migration Plan

- Do not resume an in-flight ship `state.json` across this bump. `createRunState` writes the new batch layout from a new plan.
- No migration of `classified.json`. Old plans with `regrouped` are pre-`fix-wave-boundary-cost`; this change does not read that key.
- Operator docs: `docs/06-why-it-works.md` §5.2 names the fold next to `serialized`.

## Open Questions

None. D2 vs same-path-only and D6 (spec skill, not stock propose) are pinned.
