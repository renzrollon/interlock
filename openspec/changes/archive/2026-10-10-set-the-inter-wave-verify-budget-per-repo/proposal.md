## Why

Issue #10. `LIMITS.interWaveVerifyBudgetMs` (`lib/limits.mjs:91`) is one constant, 60 s, for every repository, and it is a **per-run** budget: `lib/run.mjs` accumulates every inter-wave checkpoint's measured time on `manifest.verifyElapsedMs` (`run judge`, around `:3131-3165`) and `planVerification` drops to typecheck-only once `elapsedMs >= budgetMs` (`lib/verify.mjs:221-222`, `:278-279`). In a compiled-language repository the first checkpoint spends it alone: in the reported .NET solution `dotnet build` takes 25-55 s and the unit suite about two minutes. Run `wf_ac5c7e4e-c74` printed `VERIFICATION SKIPPED: reason=verify-budget-exceeded`, then `verify-cap-reached`, then `VERIFY CAP EXHAUSTED: 6 inter-wave checkpoint(s) were skipped` (`lib/receipt.mjs:294`). Nothing checked the change after wave 4. A seam defect between two parallel waves and two broken count-pinning tests reached the end of the run undetected.

The budget is right to exist: it keeps verification from outweighing the work it guards. What is wrong is that the one number cannot fit a 10-second `node --test` suite and a two-minute `dotnet test` solution at once. Raising the constant would loosen it for every repository whose suite is fast. An environment variable would hand the number to anything that can set one mid-run, the model included, which is what the cap-authority rule exists to prevent (`openspec/specs/ship/cap-authority/spec.md`).

`.claude/testing/profile.json` is already the per-repository record of how the tests run (`shared/TEST-PROFILE.md`), and the run already locates it at `run start` (`lib/run.mjs:2414-2418`). That is where a per-repository budget belongs. The ceiling a profile may ask for still lives in `lib/limits.mjs`, so the bound remains code.

## What Changes

- **A per-repository budget in the test profile.** `profile.json` gains an optional top-level integer `inter_wave_verify_budget_ms`. When present, it replaces `LIMITS.interWaveVerifyBudgetMs` as the inter-wave verify budget for runs in that repository. When absent, nothing changes: the default stays the 60 s constant, including for a profile that carries `unit.timeout_ms` (design D2 says why `timeout_ms` is not used).
- **A ceiling in the CLI.** New `LIMITS.interWaveVerifyBudgetCeilingMs` (30 minutes). A profile value above it is clamped to it, and a banner names both numbers. `interlock limits` prints the ceiling beside the default.
- **One resolver.** `resolveVerifyBudget(profile)` in `lib/verify.mjs` returns `{ budgetMs, source, requestedMs }`. `planVerification` uses it when no `budgetMs` is passed, so `interlock verify plan --profile <file>` and the ship loop agree. `--budget-ms` still wins over both.
- **Fixed at run start.** `run start` resolves the budget once and records `verifyBudgetMs` and `verifyBudgetSource` on the manifest. Every checkpoint reads the manifest, never the profile, so editing `profile.json` mid-run, by an agent or a person, does not move the budget of a run in flight. A manifest written before the field existed keeps the constant.
- **Spoken.** `run start` prints `VERIFY BUDGET FROM PROFILE: <n>s (inter_wave_verify_budget_ms)` when the profile set it, and `VERIFY BUDGET CLAMPED: …` when it was clamped. The existing budget-exceeded skip detail already names the budget it compared against, so the close summary shows which budget was spent.
- **Validated like the other profile fields.** A non-integer, zero or negative value is rejected by `validateProfile` with the field named, as `unit.timeout_ms` already is (`lib/verify.mjs:158-159`). It is never silently replaced by the default.
- **`/interlock:fix-tests` never writes it.** The skill already preserves keys it did not resolve (`skills/fix-tests/SKILL.md:111`). It gains an explicit line that `inter_wave_verify_budget_ms` is set by a person and is never written or changed by the skill, pinned in `test/skills.test.mjs`.
- **Docs and changelog.** `shared/TEST-PROFILE.md` documents the field and how to choose a value. `docs/07-cli-and-configuration.md` gets a short section. `CHANGELOG.md` gets an Unreleased entry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verify`: the inter-wave budget becomes a value resolved from the test profile, bounded by a CLI ceiling and fixed for the life of a run. The "Inter-wave plan is scoped by changed paths and budget" requirement now names the resolved default instead of a single constant. Four requirements are added: the per-repository budget, its validation, the profile skill not writing it, and the run-start snapshot.

`ship/cap-authority` is read and untouched. The new ceiling is stated once in `LIMITS`, printed by `interlock limits`, and read by the resolver, which satisfies "every advertised cap SHALL be enforced by code" without a new rule.

## Impact

- **Changed:** `lib/limits.mjs` (the ceiling and its `formatLimits` row), `lib/verify.mjs` (`resolveVerifyBudget`, the `planVerification` default, `validateProfile`), `lib/run.mjs` (`run start` snapshot and banners, `verifyStep` passes the snapshot), `skills/fix-tests/SKILL.md` (one line), `shared/TEST-PROFILE.md`, `docs/04-when-it-stops.md` (a section per new banner), `docs/07-cli-and-configuration.md`, `CHANGELOG.md`.
- **Tests added:** `test/spine/verify.test.mjs` (resolver, default, clamp, validation, `--budget-ms` precedence), `test/spine/run.test.mjs` (snapshot at start, a mid-run profile edit has no effect, banners), `test/spine/cli.test.mjs` (`verify plan` with a profile budget, `limits` prints the ceiling), `test/skills.test.mjs` (the fix-tests pin). No existing test is edited. Every current fixture lacks the new field, so every current assertion on `LIMITS.interWaveVerifyBudgetMs` keeps holding.
- **Untouched:** `LIMITS.interWaveVerifications` and the slot accounting in `lib/waves.mjs`, the timing fold in `run judge`, `bin/interlock` flag parsing (`--budget-ms` and `--elapsed-ms` keep their meaning), the final verification (not budgeted). No dependency.
- **Not done here (named follow-ups):** scoping an inter-wave checkpoint to the test projects a wave touched (issue #10, ask 2) needs a map from changed source files to test files or test projects. For .NET, the `<ProjectReference>` edges the graph now indexes could supply it. That is a separate change. A suggested value measured by `interlock verify exec` is also left for later, because the number must stay a person's decision.
