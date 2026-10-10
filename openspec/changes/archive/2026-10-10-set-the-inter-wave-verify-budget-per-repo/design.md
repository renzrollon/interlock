## Context

The inter-wave verify budget is enforced at two places. `planVerification` (`lib/verify.mjs:221`) compares `opts.elapsedMs` against `opts.budgetMs ?? LIMITS.interWaveVerifyBudgetMs`. `verifyStep` (`lib/run.mjs`, around `:1334-1350`) passes only `elapsedMs`, taken from `manifest.verifyElapsedMs`, which `run judge` accumulates from `interlock verify exec` timings. The budget is per run, not per checkpoint, and with `LIMITS.interWaveVerifications` = 3 a run can hold at most three checkpoints.

The profile is located once at `run start` (`locateInput`, `lib/run.mjs:2414`) and re-read by `readProfile(root, manifest)` at every checkpoint (`:1796`).

## Goals / Non-Goals

**Goals:** one repository can set its own inter-wave verify budget. The number is bounded by code, cannot change during a run, and is announced whenever it is not the default. Every repository without the setting behaves exactly as today.

**Non-goals:**
- Scoping a checkpoint to the touched test projects (issue #10, ask 2).
- Changing the slot cap.
- Budgeting the final verification.
- Measuring or suggesting a value.

## Decisions

### D1. An explicit profile field, not a derivation

The field is `inter_wave_verify_budget_ms`, a top-level integer in `profile.json`, named after the cap it overrides. It is top level because it bounds the whole inter-wave plan (typecheck, unit and lint), not one section.

*Alternative rejected:* environment variable `INTERLOCK_VERIFY_BUDGET_MS`. Anything in the run's process tree can set an environment variable. A committed file is reviewed in a diff.

### D2. `unit.timeout_ms` is not the budget

Issue #10's first ask was to derive the budget from `unit.timeout_ms`. That field is "a soft budget for one full suite run" (`shared/TEST-PROFILE.md:70`). `/interlock:fix-tests` writes it routinely, and the schema example sets `120000`. Deriving the budget from it would raise the budget for almost every repository that has a profile, including the fast ones the 60 s constant fits. It would also contradict the current contract: `test/spine/verify.test.mjs:465-466` plans against a profile with `timeout_ms: 120000` and pins `budgetMs === LIMITS.interWaveVerifyBudgetMs`. That test is a pin, and this change does not edit pins. An explicit field moves only the repositories that ask.

### D3. The ceiling

`LIMITS.interWaveVerifyBudgetCeilingMs = 1_800_000` (30 minutes). A profile value above it is clamped to the ceiling, not rejected. A typo of an extra zero should not turn a run into a profile error, and the clamp is announced (D6).

A value below the default is accepted. A repository may want a tighter budget, and a tighter budget only moves the run toward typecheck-only, which is already a spoken degradation.

The number is a judgement: 30 minutes is three checkpoints of a ten-minute suite. It is stated once in `LIMITS` and nowhere in prose. The maintainer may choose another value without changing anything else in the design.

### D4. One resolver

`resolveVerifyBudget(profile)` returns:

```js
{ budgetMs, source: 'limits' | 'profile' | 'profile-clamped', requestedMs: number | null }
```

- **No profile, or no field:** `{ budgetMs: LIMITS.interWaveVerifyBudgetMs, source: 'limits', requestedMs: null }`.
- **A field at or under the ceiling:** `source: 'profile'`.
- **A field above the ceiling:** `budgetMs` is the ceiling, `source: 'profile-clamped'`, and `requestedMs` holds the asked value.

`planVerification` uses `int(opts.budgetMs, null) ?? resolveVerifyBudget(profile).budgetMs`. An explicit `budgetMs`, which is how `--budget-ms` and the run snapshot arrive, still wins. A `--budget-ms` larger than the ceiling is not clamped: the flag is a caller's explicit instruction on a standalone plan, and the ship loop never passes it.

`planVerification` returns `budgetSource` beside `budgetMs`. The field is additive in the JSON.

### D5. Fixed at run start

`run start` calls `resolveVerifyBudget` on the profile it just located and writes `manifest.verifyBudgetMs` and `manifest.verifyBudgetSource`. `verifyStep` passes this:

```js
opts.budgetMs = numberOrUndefined(manifest.verifyBudgetMs) ?? LIMITS.interWaveVerifyBudgetMs
```

An agent that edits `profile.json` mid-run, whether by mistake or because it refreshed the profile the way `/interlock:fix-tests` does, cannot move the budget of the run that spawned it. A manifest written before this change has no field, so it reads the constant, exactly as today. A resumed run reads its own manifest, so it keeps its budget.

The profile is still re-read at each checkpoint for the commands. Only the budget is fixed.

A profile that is unreadable or malformed at `run start` produces no budget snapshot beyond the constant. Its error surfaces where it does today, from `planVerification` at the first checkpoint.

### D6. Banners

These banners go into `manifest.banners` at `run start`, so the close summary repeats them:

- source `profile`: `VERIFY BUDGET FROM PROFILE: <s>s (inter_wave_verify_budget_ms) — default <s>s`
- source `profile-clamped`: `VERIFY BUDGET CLAMPED: profile asks <s>s, ceiling is <s>s (interlock limits)`
- source `limits`: no banner, because the default is what `interlock limits` already prints.

### D7. Validation

`validateProfile` rejects a present `inter_wave_verify_budget_ms` that is not a positive integer, with `test profile "inter_wave_verify_budget_ms" must be a positive integer`. This is the same treatment as a non-integer `unit.timeout_ms`. A malformed setting is never read as "use the default", because that would undo the person's intent without saying so.

### D8. `interlock limits`

`formatLimits` adds the row `inter-wave verify budget ceiling (profile)` beside the existing `inter-wave verify budget` row, which keeps its label so nothing that reads the label breaks. `--json` exposes the field through `LIMITS` as it already does for every cap.

## Risks / Trade-offs

- **A person sets 30 minutes and every run gets slower.** That is the setting's intent, it is announced on every run, and the ceiling bounds it.
- **`.claude/testing/profile.json` may not be committed in some repositories.** The setting then lives in one checkout. That is the profile's existing posture (`shared/TEST-PROFILE.md`), and this change does not alter it.
- **The slot cap is still 3.** A repository whose suite is slow but whose waves are many still gets only three checkpoints. Issue #10 is about the budget. The cap is ordering cost, already documented, and unchanged.
