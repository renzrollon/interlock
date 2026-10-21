## Why

`fix-wave-boundary-cost` stopped encoding a same-file clash as a new group, but the classifier still mints a new `group` for every sequential TDD slice. A measured plan turned 22 implementation tasks into 15 waves, most of them a single task on `match_runner.py`. Each of those waves still buys a `record-batch` ping and, until the cap, an `inter-wave-verify` ping — the expensive shape that change already diagnosed. Prompt-only grouping is not a cap; this change makes the planner collapse that staircase and stops `tasks.md` from being written as one checkbox per beat of the same file.

## What Changes

- **Planner cap.** After groups become waves, every 1-task implementation wave is folded onto the previous implementation wave as later batches. Order is kept; the extra checkpoints are not. The fold is reported (`folded[]`, warnings). Test tasks stay in the trailing test wave.
- **Planned batches are sticky.** `wave-state create` may split a batch that exceeds `maxParallel`. It MUST NOT flatten a wave and re-pack tasks, because that would let a folded disjoint-path task join an earlier batch and run too soon.
- **Task authoring in `/interlock:spec`.** `skills/spec/SKILL.md` gains a `Task shape for ship` subsection: a numbered section is one wave; sequential same-file work is one checkbox; a new section is only an output-exists boundary. The same three sentences go in `openspec/config.yaml` `rules.tasks` so `openspec instructions tasks` injects them. Artifact review and the checkpoint page catch the old fine-grained shape. Stock `/opsx:propose` is not edited.
- **Classifier prompt.** Rule 3 is narrowed: "needs earlier output" means a later *section*, not the next slice of the same file. Defense in depth; the fold is the cap.
- **Serial-plan warning.** Computed after the fold. A staircase of 1-task groups that the planner collapsed MUST NOT still warn as "effectively serial waves"; `formatPlan` reports the fold instead.

No **BREAKING** CLI flags. Existing `classified.json` `group` numbers stay as the model wrote them; only `plan.waves` changes.

## Capabilities

### New Capabilities

- `spec/task-granularity`: How `tasks.md` is shaped so ship can batch. Numbered sections are waves. Sequential same-file work is one checkbox. Independent work shares a section so it can share a batch.

### Modified Capabilities

- `waves`: 1-task implementation waves fold onto the previous implementation wave as later batches; `createRunState` does not merge planned batches; plan preview and the serial warning use the collapsed wave list; the classifier prompt no longer treats sequential same-file slices as a reason to increment `group`.

## Impact

- `lib/waves.mjs` — fold pass, `folded[]`, split-only `adoptWave`; `formatPlan` / `projectedWaveLoopAgents` read the collapsed plan.
- `test/spine/waves.test.mjs` — every fixture that needs N checkpoints must use groups of 2+ tasks (`simplePlan` today builds 1-task groups on purpose).
- `workflows/ship.js` — classifier grouping rule 3 wording. Loop unchanged: it already records one ping per wave via `remainingBatches`.
- Authoring surfaces: `skills/spec/SKILL.md` (`Task shape for ship`), `openspec/config.yaml` `rules.tasks`, `skills/review-artifacts/SKILL.md`, `docs/02-the-checkpoint.md`, `docs/06-why-it-works.md`.
- Out of scope: editing `.claude/skills/openspec-propose/SKILL.md` (stock OpenSpec; wave shape is Interlock's); a `dependsOn` field; merging two multi-task waves; co-scheduling two writers of one file; changing the test-wave packer; bootstrap seeding `rules.tasks` into consumer repos.
