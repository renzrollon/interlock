## Context

See `proposal.md`. Constraints:

- `workflows/ship.js` still cannot `import()`, touch `fs`, or run a shell. Policy stays in `interlock`; the script only spawns agents and branches on structured results.
- `lib/waves.mjs` is pure. Collision scheduling and checkpoint skipping belong there, not in prompt text.
- `lib/verify.mjs` is pure. Docs-only skip and inter-wave default kinds belong in `planVerification`, not in the agent deciding "this looks like docs".
- `add-ship-run-inspectability` is half-applied and also edits `workflows/ship.js`. This change lands its prompt edits on the current `ship.js`; inspectability tasks 3.5 / 4.1 / 6.3 must rebase after. `add-wave-handoff-and-prompt-snapshots` extends `record-batch` validation — land this batch/checkpoint work first.
- Giving the workflow runtime filesystem access is out of scope. Bookkeeping still needs *a* ping; the goal is fewer boots, not zero.

## Goals / Non-Goals

**Goals:**

- Same-file tasks serialize as batches of one wave, not as N waves × N verifies.
- Inter-wave verify is capped and skipped for docs-only waves.
- Wave-loop agent count for a collision-heavy change drops roughly in line with the measured diagnosis (verifies 11 → ~3, record pings 12 → ~3).
- Cheap pings use haiku when a one-time probe says it is reachable.

**Non-Goals:**

- Running two agents on the same file concurrently.
- Implementing tasks in the orchestrator context.
- Finishing the inspectability or handoff-packet changes.
- Deleting `.bak.*` skill dirs from the plugin repo (they live on the operator machine).

## Decisions

### 1. Collision-aware chunker, not overflow groups

Replace `resolvePathCollisions`'s "evict to `overflow` group" with a greedy packer inside each classified group: hardest-first, then fill a batch until `maxParallel` or a claimed-path clash, then start the next batch. First claimant of a path keeps the earlier batch; later ids wait. `regrouped` is replaced by `serialized`: `{ id, path, conflictsWith, group }` — same group, later batch.

**Why not keep overflow groups and "just skip verify"?** Skipped or not, extra groups still serialize the *plan* the classifier sees and still multiply `record-batch` until Stage 2's accumulate-then-record lands. Batch lanes fix the encoding.

### 2. `LIMITS.interWaveVerifications = 3`

A positive integer cap, printed by `interlock limits`. State grows `verificationsUsed`. `recordBatchResult` on the last batch of a wave with a following wave:

1. Docs-only (every claimed path matches the docs regex; any missing `paths` means *not* docs-only) → skip, reason `docs-only-wave`.
2. `verificationsUsed >= LIMITS.interWaveVerifications` → skip, reason `verify-cap-reached`.
3. Else `phase = 'verify'` and increment `verificationsUsed` when the checkpoint is *entered* (so a skipped check does not consume the cap; a started check does, including ones that later fail and retry).

Fix attempts on an in-progress checkpoint do not consume extra cap slots.

Docs regex matches `lib/risk.mjs`'s `DOC_PATH` (documentation, not tests). Test files still checkpoint.

### 3. `remainingBatches` + one record ping per checkpoint

`nextStep` adds `remainingBatches: wave.batches.slice(batchIndex)`. The script runs those batches sequentially (parallel *inside* a batch), accumulates `{ id, ok, error }`, and on the last remaining batch *or* the first batch with a failure, spawns one `record-batch-*` ping that writes `batch-0.json`… and runs `wave-state record-batch --write-state` once per file. Last stdout is the next step.

Wave-entry `wave-state next` (and a `--write-state` that lands on `batchIndex` 0) appends one `agent-spawn` per task in `remainingBatches` so inspectability still reconstructs the implementers ship.js actually launches. Mid-wave `record-batch --write-state` does not duplicate those events.

`createRunState` / `adoptWave` MUST keep collision batches. Re-splitting to fit a lower `maxParallel` is allowed; merging two tasks that claim the same path because the runtime cap is higher than the plan's is not.

A failure still records immediately so `LIMITS.taskFailureHalt` can halt before later batches spawn. Policy does not move into the script.

### 4. Fuse verify into that ping

If the last `record-batch` stdout is `action: "verify"`, the same agent runs `interlock verify plan --context inter-wave --changed <wave paths> --budget-ms`, executes only emitted steps, judges, `record-verify --write-state`. The `inter-wave-verify-*` spawn remains only as a fallback when `next` is already `verify` (retry / resume).

### 5. Haiku probe is one field on validate

Validate already runs `printenv CLAUDE_CODE_SUBAGENT_MODEL`. Extend it: if that override is set, pings follow it (existing banner). Else check `CLAUDE_CODE_USE_BEDROCK` / `AWS_BEDROCK` — Bedrock → `haikuAvailable: false` (the original hard-fail). Otherwise `haikuAvailable: true` and `cheap()` passes `model: "haiku"`. When unsure, false — inherit session model rather than halt the loop.

### 6. Verify plan `--changed` / `--context`

`planVerification` gains `changed` (array of paths) and `context`. New skip reason `docs-only-changes`. Inter-wave context forces `e2e: false` unless `--e2e`, and `coverage: false` unless the caller explicitly wants it (`--no-coverage` is already the inter-wave default if we set `coverage: false` in CLI when context is inter-wave). CLI wires `--changed` (already variadic) and `--context` on `verify plan`.

## Risks / Trade-offs

- **[Delayed halt if we ran all remaining batches before recording] →** Do not. Record as soon as a batch has a failure; only the all-green path accumulates to the wave end.
- **[Classifier still over-groups] →** Prompt cannot be a cap. The chunker is the backstop when the classifier *does* put colliding tasks in one group; over-grouping into extra groups still costs waves. `formatPlan` warns so a human (or a later replan) can see it.
- **[Haiku probe is wrong] →** False negatives waste Sonnet on pings (status quo). False positives halt the loop on Bedrock — we bias to false.
- **[Cap 3 is tight for a 10-section change] →** That is the product decision this change is making. Raise the cap in `lib/limits.mjs` the same way other caps move.

## Migration Plan

- Pure planner/state changes: old `state.json` without `verificationsUsed` should treat missing as 0 when rehydrated… **Do not resume old in-flight runs across this bump.** `createRunState` always writes the new field. No migration of classified.json.
- Operator machine: delete `.bak.*` skill directories and `~/.claude/workflows/wave-apply.js`; point `gsd-wave-apply` at lean `/interlock:ship`. Not shipped in the plugin.

## Open Questions

None. Cap `3` is pinned by tests the same way `taskFailureHalt` is.
