## 1. The reads go, with their tests

- [x] 1.1 `lib/doctor.mjs`: delete `checkClaudeBare` and its constants and `diagnose` push; delete `detectAuthMode` and the `auth mode` clause, and say the defaults depend on a mode the report does not inspect; delete `EVAL_CREDENTIAL_VARS` and the `evals-credential` row, leaving one `evals-harness` row whose fix names the one variable
- [x] 1.2 `test/spine/doctor.test.mjs`: drop the `claude-bare` block and import; the eval tests expect one row and assert no credential name or value reaches either surface; the `prompt-cache` test asserts no auth mode, no credential name, and the spoken degradation
- [x] 1.3 `lib/host/codex.mjs` + `cli/interlock-run`: delete `CODEX_KEY_ENVS`, `onChatGptPlan`, `chatGptPlan` and the runner's banner block; add `probeLoginStatus`, `loginBanners`, `CHATGPT_PLAN_BANNER`, `LOGIN_NOT_INSPECTED_BANNER`, and `host.banners` from one probe at creation
- [x] 1.4 `test/fixtures/hosts/fake-codex.mjs`: answer `login status` on stderr per `--fixture-login=chatgpt|api-key|none|garbage|fails|hangs`, defaulting to `chatgpt`
- [x] 1.5 `test/spine/host-adapters.test.mjs`: the probe classifies every fixture mode, a missing binary and a bounded hang; the host's banners follow the probe and ignore key variables
- [x] 1.6 `test/workflows.test.mjs`: the docs carry both adapter banners; a Codex run on a ChatGPT login, an API-key login and an unreadable status each print what they should
- [x] 1.7 `test/spine/package.test.mjs`: no shipped file but the changelog names a credential variable or file
- [x] 1.8 `README.md`: the network paragraph names no credential variable

## 2. Docs and changelog

- [x] 2.1 `docs/04-when-it-stops.md` (both codex banners), `docs/07-cli-and-configuration.md` (no `claude-bare`; the banner's source), `docs/assets/DESIGN-PROMPT.md` (two trailing skip rows)
- [x] 2.2 `CHANGELOG.md`: a `### Removed` entry under `[Unreleased]` that spells no variable name

## 3. Verification

- [x] 3.1 the touched test files, `npm test`, `npm run validate`, `openspec validate remove-every-credential-read --strict`, `interlock doctor` shows no `claude-bare`, `evals-credential` or `auth mode`, and no shipped file but the changelog spells a credential name
