## 1. Classifier prompt and plan preview (Stage 1)

- [x] 1.1 Rewrite the `plan-waves` prompt in `workflows/ship.js`: default `group` to the numbered `tasks.md` section; a shared file is not a reason for a new group (put it in `paths`); only increment group when a later task needs an earlier output to exist
- [x] 1.2 `formatPlan` prints projected wave-loop agent count (implementers + record pings + inter-wave verifies) and `planWaves` warns when `waveCount > implCount * 0.5` with at least two impl tasks
- [x] 1.3 Tests: `formatPlan` / warnings for an effectively serial plan; `test/workflows.test.mjs` asserts the classifier prompt contains the three grouping rules

## 2. Cheap pings (Stage 1)

- [x] 2.1 Validate reports `haikuAvailable`; `cheap()` passes `model: "haiku"` when that is true and `CLAUDE_CODE_SUBAGENT_MODEL` is unset
- [x] 2.2 Fuse: when `record-batch --write-state` stdout is `action: "verify"`, that same ping runs `interlock verify plan --context inter-wave --changed …`, the emitted steps, judge, and `record-verify --write-state`. Keep a `verify` branch only as fallback
- [x] 2.3 Tests: `test/workflows.test.mjs` asserts the record-batch prompt contains the fused verify-plan invocation and that `cheap` can pass a haiku model

## 3. Collision-aware batches (Stage 2)

- [x] 3.1 Replace overflow-group `resolvePathCollisions` with a per-group collision-aware chunker in `lib/waves.mjs`; keep colliding tasks in their classified group; emit `serialized` instead of `regrouped`
- [x] 3.2 `nextStep` includes `remainingBatches` (from current `batchIndex` through end of wave); `tasks` remains the current batch
- [x] 3.3 Tests in `test/spine/waves.test.mjs`: same-file tasks → one wave, multiple batches; three-way collision → three batches; disjoint paths share a batch; omitted paths never serialize

## 4. Checkpoint policy (Stage 2)

- [x] 4.1 Add `LIMITS.interWaveVerifications` (3); print it from `interlock limits`; add `verificationsUsed` on run state
- [x] 4.2 `recordBatchResult` skips verify for docs-only waves (`DOC_PATH`-compatible) and when the cap is spent; record skip reason; missing `paths` is not docs-only
- [x] 4.3 Tests: docs-only skip; cap skip; source wave still verifies under the cap; `limits.test.mjs` pins the integer

## 5. Structural verify plan (Stage 2)

- [x] 5.1 `planVerification` accepts `changed` and `context`; new skip reason for docs-only; `--context inter-wave` omits e2e/coverage by default
- [x] 5.2 Wire `--changed` and `--context` on `interlock verify plan` in `bin/interlock`
- [x] 5.3 Tests in `test/spine/verify.test.mjs` and `test/spine/cli.test.mjs` for docs-only `--changed`, inter-wave kinds, and budget collapse

## 6. Record once per checkpoint (Stage 2)

- [x] 6.1 `workflows/ship.js` runs `remainingBatches` sequentially, accumulates results, and on last-or-failed batch spawns one ping that calls `record-batch --write-state` once per accumulated file, then fuses verify if needed
- [x] 6.2 Tests: `test/workflows.test.mjs` asserts remainingBatches consumption and a single record-batch label pattern per accumulated checkpoint (no per-batch spawn requirement in the script comments)

## 7. Entry-point hygiene (operator machine)

- [x] 7.1 Delete `~/.claude/skills/*.bak.*` and `~/.cursor/skills/*.bak.*` skill directories
- [x] 7.2 Remove stale `~/.claude/workflows/wave-apply.js`
- [x] 7.3 Rewrite `~/.claude/skills/gsd-wave-apply/SKILL.md` (and the Cursor copy if present) to launch lean `/interlock:ship` / `workflows/ship.js` with no `--strict` inference
