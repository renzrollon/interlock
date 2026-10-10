## 1. Failing tests first

TDD shape: the core is a pure resolver plus a run-start snapshot, and both have a pass/fail core a test can pin before the code exists. No existing test is edited. Every current fixture lacks `inter_wave_verify_budget_ms`, so every current assertion on `LIMITS.interWaveVerifyBudgetMs` must keep holding through §2.

- [x] 1.1 Add the failing tests listed below, each file in its own voice. **Verify:** each new test fails against the current code for the stated reason (missing export, missing field or missing banner), and every pre-existing test in the four files still passes. (spec: verify — all requirements in the delta)
  - **`test/spine/verify.test.mjs`**, a new block `// --- the per-repository verify budget ---` after the existing budget block. Use the file's `profile(over)` helper.
    - `resolveVerifyBudget` returns:
      - `{ budgetMs: LIMITS.interWaveVerifyBudgetMs, source: 'limits', requestedMs: null }` for `null`, and for `profile()`, which has `unit.timeout_ms: 120000` (design D2).
      - `source: 'profile'` with `budgetMs` 360000 for `profile({ inter_wave_verify_budget_ms: 360000 })`.
      - `source: 'profile-clamped'` with `budgetMs === LIMITS.interWaveVerifyBudgetCeilingMs` and `requestedMs` equal to the asked value, for a value of `LIMITS.interWaveVerifyBudgetCeilingMs + 1`.
      - `source: 'profile'` with the value itself, for a value of exactly the ceiling.
    - `planVerification(profile({ inter_wave_verify_budget_ms: 360000 }), { context: 'inter-wave', elapsedMs: 120000 })` plans a unit step, with `budgetMs` 360000 and `budgetSource` `'profile'`.
    - The same profile with `budgetMs: 1000, elapsedMs: 1000` skips unit with `SKIP_REASONS.BUDGET_EXCEEDED`.
    - `planVerification` throws a message matching `/inter_wave_verify_budget_ms/` for each of `'5m'`, `0`, `-1` and `1.5`.
  - **`test/spine/run.test.mjs`**, beside `the inter-wave verify budget is measured across the round trip and then bounds the next check`. Reuse `verifiableRepo`, `completeBatch`, `manifestOf`, `file` and `run`.
    - (a) With a profile setting `inter_wave_verify_budget_ms: 300000`: the manifest after `run start` has `verifyBudgetMs` 300000 and `verifyBudgetSource` `'profile'`, and the start step's banners contain `VERIFY BUDGET FROM PROFILE`.
    - (b) Rewrite the profile to `1800000` after start, backdate `verifyStartedAt` by `LIMITS.interWaveVerifyBudgetMs * 2` as the existing test does, and the next checkpoint still plans `unit`. This proves 300000 bounds it, not 60000 or 1800000. Read `.claude/ship/vplan-inter-wave.json` and assert `budgetMs === 300000`.
    - (c) A profile above the ceiling raises `VERIFY BUDGET CLAMPED` and records the ceiling.
    - (d) A manifest with `verifyBudgetMs` deleted plans against `LIMITS.interWaveVerifyBudgetMs`.
  - **`test/spine/cli.test.mjs`**, beside the existing `verify plan` tests.
    - `verify plan --profile <file with inter_wave_verify_budget_ms: 300000> --context inter-wave --elapsed-ms 120000 --json` returns `budgetMs` 300000 and a unit step.
    - `limits` output names `inter-wave verify budget ceiling (profile)`.
    - `limits --json` carries `interWaveVerifyBudgetCeilingMs`.
  - **`test/skills.test.mjs`**: `skills/fix-tests/SKILL.md` names `inter_wave_verify_budget_ms`, with a prohibition match `/(?:never|do not|must not)[^.]{0,80}inter_wave_verify_budget_ms|inter_wave_verify_budget_ms[^.]{0,80}(?:never|not)/i`. Add a comment naming the `--metrics` precedent from `.claude/CLAUDE.md`.

## 2. The resolver, the snapshot and the ceiling (make §1 green)

- [x] 2.1 In `lib/limits.mjs`, add `interWaveVerifyBudgetCeilingMs: 1_800_000` after `interWaveVerifyBudgetMs`, with a doc comment that gives design D3's reason and says the field is the most a test profile may ask for. In `formatLimits`, add the row `['inter-wave verify budget ceiling (profile)', `${LIMITS.interWaveVerifyBudgetCeilingMs / 1000}s`]` directly after the `inter-wave verify budget` row, and leave that row's label unchanged. **Verify:** `node --test test/spine/limits.test.mjs test/spine/cli.test.mjs` passes, including the cap-authority checks: the new cap's reader lands in 2.2, in the same section. (spec: verify — The inter-wave verify budget MAY be set per repository in the test profile)
- [x] 2.2 In `lib/verify.mjs`:
  - Extend `validateProfile` with the `inter_wave_verify_budget_ms` check (design D7).
  - Export `resolveVerifyBudget(profile)` (design D4), with a doc comment saying why `unit.timeout_ms` is not used (D2).
  - In `planVerification`, default `budgetMs` through the resolver, and return `budgetSource` (the resolver's source, or `'caller'` when `opts.budgetMs` was passed) on every return path, the docs-only early return included.
  - Update the JSDoc `@returns` and the `budgetMs?` comment.

  **Verify:** `node --test test/spine/verify.test.mjs` passes. (spec: verify — Inter-wave plan is scoped by changed paths and budget; The inter-wave verify budget MAY be set per repository in the test profile)
- [x] 2.3 In `lib/run.mjs` (depends on 2.2):
  - In `run start`, right after `manifest.testProfileSource` is set, read the located profile and call `resolveVerifyBudget`. A missing, unreadable or invalid profile resolves to the constant here (design D5): the error surfaces at the first checkpoint, as today. Record `manifest.verifyBudgetMs` and `manifest.verifyBudgetSource`, and push the D6 banners.
  - Add both fields to the manifest initializer next to `verifyStartedAt` / `verifyElapsedMs`, with a comment.
  - In `verifyStep`, set `opts.budgetMs` from the manifest with the constant as fallback (D5).

  Do not touch `run judge`'s timing fold or `lib/waves.mjs`. **Verify:** `node --test test/spine/run.test.mjs` passes. (spec: verify — A ship run SHALL fix its inter-wave verify budget at run start)
- [x] 2.4 In `skills/fix-tests/SKILL.md`, next to "Preserve every key you did not resolve yourself", add one sentence: `inter_wave_verify_budget_ms` is a person's setting that bounds ship's inter-wave checks, and the skill never writes, raises or removes it. **Verify:** `node --test test/skills.test.mjs` passes. (spec: verify — The inter-wave verify budget MAY be set per repository in the test profile)

## 3. Docs, changelog and final verification (needs §2)

- [x] 3.1 Update the docs and the changelog:
  - **`shared/TEST-PROFILE.md`:** add `inter_wave_verify_budget_ms` to the schema example as an absent-by-default field. Add a table row saying:
    - it is optional, per repository, and set by a person;
    - it replaces the default inter-wave verify budget for the whole run;
    - it is clamped to the ceiling `interlock limits` prints;
    - it is fixed when a run starts;
    - a sensible value is a few full inter-wave checks' worth of the repository's measured typecheck + unit + lint time, read from a real run.

    Restate no number from `LIMITS`.
  - **`docs/07-cli-and-configuration.md`:** add a short subsection with the same content, plus the two banners.
  - **`docs/04-when-it-stops.md`:** a `### ` section for each new banner, `VERIFY BUDGET FROM PROFILE` and `VERIFY BUDGET CLAMPED`, as `test/workflows.test.mjs` requires of every banner `lib/run.mjs` raises.
  - **`CHANGELOG.md`**, under `[Unreleased]` → `### Added`: one entry that names issue #10, the field, the ceiling, the run-start snapshot, and that repositories without the field are unchanged.

  **Verify:** `grep -rn "60s\|60_000" shared docs/07-cli-and-configuration.md` gains no new match. (spec: verify — The inter-wave verify budget MAY be set per repository in the test profile)
- [x] 3.2 Final verification. Run `npm test`, `npm run validate` and `openspec validate set-the-inter-wave-verify-budget-per-repo --strict`, and paste the tail of each into a closing note at the end of this file. If a test fails, fix the code from §2. Do not edit, weaken, skip or delete a test. (spec: verify — all requirements in the delta)

## Closing note — verification, 2026-10-10

Red first: with only §1 in place, the 9 new tests failed for the stated reasons and every pre-existing test in the four files passed. The fourth `run.test.mjs` case (a manifest with no recorded budget) passed from the start, as it pins today's default.

`npm test`, Linux (WSL Ubuntu 24.04):

```
Node 22   # tests 2767   # pass 2763   # fail 0
Node 18   # tests 2767   # pass 2763   # fail 0
Node 20   # tests 2767   # pass 2762   # fail 1   (host-adapters "a second signal during the close starts no second close")
```

The Node 20 failure is the timing-sensitive signal test that fails intermittently under full-suite load on `main` too. Run alone on Node 20, `test/spine/host-adapters.test.mjs` passes, `# pass 82 # fail 0`.

`npm run validate`:

```
✔ Validation passed
```

`openspec validate set-the-inter-wave-verify-budget-per-repo --strict`:

```
Change 'set-the-inter-wave-verify-budget-per-repo' is valid
```

`interlock limits`:

```
  inter-wave verify budget                            60s
  inter-wave verify budget ceiling (profile)          1800s
```
