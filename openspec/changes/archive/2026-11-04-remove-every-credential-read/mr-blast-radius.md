## 💥 Blast radius review — business logic changes (PR #32)

> **Scope of this comment:** this is a separate, specific **blast radius** review. It does **not** cover the change's own plumbing: the new `probeLoginStatus` / `loginBanners` helpers as code, the banner constants' wording, the `fake-codex.mjs` login modes, the docs, CHANGELOG and OpenSpec artifacts. It looks only at the **existing behaviour** this PR changes to stop reading credentials, and at which existing features those changes can affect. The general code review, regression and performance findings are in the earlier comment.

Scope: `f5e3696...75ce095`. Static analysis only. Nothing was run, and no DB was touched.

⚠️ **Important:** no test runs a real `codex`. Every probe test goes through `test/fixtures/hosts/fake-codex.mjs`, which answers `Logged in using ChatGPT` by default, so older codex tests now pass with the plan banner present. The one live test (`INTERLOCK_LIVE_HOSTS=codex`) checks the `exec` argv, not `login status`, and is skipped by default. The vendor strings and the stderr channel come from design D4 (codex-cli 0.145.0). **An operator's first `interlock-run --host codex` is the first real run.**

**Sub-repos: no impact.**
- npm `@renzrollon/interlock` / the marketplace `release` branch: the removed exports (`CODEX_KEY_ENVS`, `onChatGptPlan`, `EVAL_CREDENTIAL_VARS`, `checkClaudeBare`) live under `lib/`. The package's `bin` map exposes only `cli/`, so no published entry point imports them.
- Record schemas `interlock.<kind>/<n>`: unchanged. Banners are free text in the run manifest, the trajectory and `host-banners.json`, and nothing parses them by text (`lib/run.mjs`, `lib/receipt.mjs:325` and `workflows/ship.js` pass them through).

### 🔴 High

(none)

### 🟡 Medium

| # | Change | Affected | Data / concurrency | Tests |
|---|---|---|---|---|
| B1 | `createCodexHost` → `loginBanners(probeLoginStatus(…))` (`lib/host/codex.mjs:206-219`; trigger at `:97-102`). Before: `CHATGPT PLAN PATH (codex)` fired in `cli/interlock-run` when neither key variable was set. After: it fires only when `codex login status` (stdout+stderr) says `Logged in using ChatGPT`. A new `CODEX LOGIN NOT INSPECTED (codex)` banner fires on a spawn error, a timeout or unrecognised text. Any other `Logged in using …` raises nothing. | **Every `interlock-run --host codex` run:** the summary banners, the receipt's degradation lines, the run manifest and the trajectory. 1 production caller (`cli/interlock-run:290`, once per run). **This is the only path to the billing-path disclosure that the run-host-adapters spec requires.** | No persisted state. Banner counts can now differ between machines for the same run. Misclassification is silent in two cases: (a) `access token` / `personal access token` logins are classed `api-key`; (b) a stored ChatGPT login with `CODEX_API_KEY` exported may be bannered as plan when the env key is in use. Both are listed under ❓ in the earlier comment. The old trigger got `codex login --with-api-key` wrong the other way. | `host-adapters` (probe: chatgpt / api-key / none / garbage / fails / missing binary / 300 ms hang), `workflows` (3 runner scenarios + docs-verbatim). Real processes, but the fixture only. |

### 🟢 Low – Medium

| # | Change | Note |
|---|---|---|
| B2 | `createCodexHost` (`lib/host/codex.mjs:206-219`) now spawns a process at creation | Before, the factory was pure. Now it runs one synchronous `spawnSync`, bounded at 10 s and killed with SIGKILL (I measured that the bound holds with a grandchild holding the pipes). It runs before `interlock-run` writes anything, and Ctrl-C is deferred until it returns. An `INTERLOCK_CODEX_COMMAND` wrapper gets `login status` appended after its fixed args and runs one extra time per run. A wrapper that does not forward the subcommand lands on the not-inspected banner. Test-suite cost is about 15 fixture spawns at 50–100 ms each. |
| B3 | `diagnose()` drops the `claude-bare` row; `evalPrerequisiteChecks` returns 0–1 rows, not 0–2 (`lib/doctor.mjs:1639-1658`, `:1765-1770`) | Both rows were only ever `ok`/`skip`. `hooks/preflight.mjs` acts only on `fail` rows and `counts.warn`, and the preflight pane prints rows generically. `postinstall-smoke.mjs` and `canary.yml` read other ids. The operator-visible loss: a session with the flag but no key no longer sees the "an eval run has nothing to call" row, and nobody is warned that a future bare `-p` default would strand OAuth-only `--host claude` lanes. Both are accepted in D1/D3; such a lane fails at spawn and is bannered `spawn-failed`. Inside the installed bundle the eval rows never appeared anyway, because `evals/` is not shipped. |
| B4 | New pin `no shipped file but the changelog names a credential variable or file` (`test/spine/package.test.mjs:463-491`) | From now on it constrains every shipped file in `cli lib workflows skills hooks types agents shared assets`, plus README, LICENSE and the plugin manifest. A future skill or README line cannot tell a user to set `GH_TOKEN` or `ANTHROPIC_API_KEY` by name, and `lib/` cannot scrub one from a child env by name, as `evals/ship/agent/tools.mjs:142` does. Moving any of `evals/ship/*` into `lib/` would trip it. `docs/`, `evals/`, `.github/` and `scripts/` are not covered. |
| B5 | `checkPromptCache` detail (`lib/doctor.mjs:1430-1434`) | The `auth mode: …` clause is gone, and the closing sentence says the mode is not inspected. The status logic and the fix are unchanged. No test, skill or script parses the detail. |
| B6 | Removed exports `CODEX_KEY_ENVS`, `onChatGptPlan`, `host.chatGptPlan`, `EVAL_CREDENTIAL_VARS`, `checkClaudeBare` | 0 readers at HEAD in shipped or repo code. The banner moved from the runner's own push to the generic `host.banners` loop (`cli/interlock-run:381`), so it now prints after the effort and advisor banners instead of before. Nothing depends on that order. |

### ↩️ Rollback

A revert is safe for data. The doctor writes only the per-session preflight report, which is regenerated at every SessionStart and rendered generically, so reports from either version read fine under the other. Run manifests and trajectories store banners as free text that no reader parses, so runs bannered by the new code stay readable by the old code. **One exception:** the revert has to take `test/workflows.test.mjs`, `fake-codex.mjs` and the `docs/04` banner rows with it, because the docs-verbatim test imports `CHATGPT_PLAN_BANNER` and `LOGIN_NOT_INSPECTED_BANNER` from `lib/host/codex.mjs`. A partial revert fails `npm test`.

### ✅ Manual checks for UAT

1. **ChatGPT login (B1):** with a real `codex` logged in through ChatGPT, run `interlock-run <change> --host codex`. Expect the summary to contain `CHATGPT PLAN PATH (codex): codex login status reports a ChatGPT login` and no `CODEX LOGIN NOT INSPECTED`.
2. **API-key login, no env (B1):** after `codex login --with-api-key` with no key variable exported, run the same command. Expect neither banner. (The old code printed the plan banner here.)
3. **Env key over a stored ChatGPT login (B1):** keep the ChatGPT login, export `CODEX_API_KEY`, and run a one-lane change. Expect the plan banner. On the OpenAI usage page, record whether the lane actually billed the API key. If it did, the banner is a false positive.
4. **Access-token login (B1):** run `codex login status 2>&1` under an access-token login. Expect the `Logged in using access token` wording from D4. Record whether that login is plan-backed: today it raises no banner.
5. **Logged out (B1):** run `codex logout`, then the runner. Expect no billing banner, and a `spawn-failed` banner on the first lane carrying codex's stderr tail.
6. **Wrapper and hang (B2):** set `INTERLOCK_CODEX_COMMAND` to a script that sleeps 60 s on any argv. Expect `interlock-run` to start after about 10 s with `CODEX LOGIN NOT INSPECTED (codex)`. Press Ctrl-C during the pause: the close runs once the probe returns.
7. **Doctor rows (B3, B5):** run `node cli/interlock doctor --json | jq '[.checks[].id]'` in a repo checkout, with `ANTHROPIC_API_KEY=sk-test` exported. Expect no `claude-bare` or `evals-credential`, `prompt-cache` present with no `auth mode:` clause, and neither `sk-test` nor the variable name anywhere in the output. With `CLAUDE_CODE_WALNUT_SPIRE=1`, expect `evals-harness` `ok` and the exit code unchanged.
8. **Pin (B4):** on a scratch branch, add `GH_TOKEN` to a `skills/*/SKILL.md` and run `node --test test/spine/package.test.mjs`. Expect it to fail naming that file. The same line in `docs/` does not fail.
