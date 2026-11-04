# Design

## Context

The scanner pairs a **read** of the installer's credential with a **send** off the machine. The send is `lib/notify.mjs` (the plugin's one `fetch`, to ntfy), whose topic already arrives through `${user_config.ntfy_topic}`. The reads left are unrelated to that send and are all presence-only: `lib/doctor.mjs` (`checkClaudeBare`, `detectAuthMode`, `EVAL_CREDENTIAL_VARS`) and `lib/host/codex.mjs` (`CODEX_KEY_ENVS`, `onChatGptPlan`, read by `cli/interlock-run`). No `.mcp.json` or `mcpServers` exists; the finding's "MCP" prefix is the rule family.

## Goals / Non-Goals

**Goals:**

- No shipped file reads, names or opens a credential.
- Every row or banner that loses its input either goes or says what it no longer inspects.
- A test pins the outcome.

**Non-Goals:**

- The ntfy send, and whole-environment inheritance by child processes (vendor CLIs, `npm ci`, the doctor's own probes). Both are documented in the README's network paragraph.
- History: `CHANGELOG.md` lines that spell what an old version read stay, and the pin exempts that file.
- `evals/ship/*`, which reads a key by value but is not in `files` and does not ship.
- The receipt's billing field, which is static per host (`lib/host/registry.mjs`).

## Decisions

- **D1 — delete the `claude-bare` row.** Its only content was whether a key or a settings helper existed. A row with the question removed would be noise. Accepted trade: an operator no longer gets the `--bare` advice; a lane with nothing to authenticate with fails at spawn and is bannered through `spawn-failed`.
- **D2 — the `prompt-cache` row names no authentication mode.** `detectAuthMode` goes. The detail says the documented defaults depend on the host build and the authentication mode, *which this report does not inspect*, so the loss is spoken, never silent. The living requirement's two auth-mode scenarios are dropped, so the delta is REMOVED plus ADDED under a new title: OpenSpec 1.8.0 and later refuse a MODIFIED block that drops a living scenario.
- **D3 — one eval row.** `evals-credential` and `EVAL_CREDENTIAL_VARS` go; `evals-harness` stays and its fix no longer presupposes two prerequisites. Beyond the hold, one environment row could not be right for both harnesses: `claude plugin eval` runs on the session login and needs no variable, while `evals/ship/run.mjs` needs a key, so the row said `skip` on a logged-in maintainer's machine. Every living title says "rows", "both" or "neither", so the capability is REMOVED (four) plus ADDED (three) under new titles.
- **D4 — the Codex billing path comes from the CLI.** `createCodexHost` runs `codex login status` once (precedent: `probeHelpFlags` in `lib/host/claude-cli.mjs`, synchronous `spawnSync`, never throws) and attaches `host.banners` as the claude adapter already does; `cli/interlock-run` already carries `host.banners` to the close. The CLI's words are classified and never quoted (an API-key login prints a masked key), and the exit code is not read (`Not logged in` exits non-zero and is still an answer):
  - `/not logged in/i` → `none`, no banner (the spawn fails on its own);
  - `/logged in using chatgpt/i` → `chatgpt`, the plan banner;
  - any other `/logged in using/i` → `api-key`, no banner;
  - anything else, a spawn error or the timeout → `unknown`, `CODEX LOGIN NOT INSPECTED (codex)`.

  codex-cli 0.145.0 writes its status line to **stderr**, so both streams are read; a stdout-only probe would land every real run on `unknown`. Vendor strings: `Logged in using ChatGPT`, `Logged in using an API key - …`, `Logged in using access token`, `Logged in using personal access token`, `Logged in using Amazon Bedrock API key`, `Not logged in`. Rejected: dropping the banner, a silent loss of a disclosure the spec requires. The probe is also more accurate than the variables were, since `codex login --with-api-key` sets no variable. Bound: 10 s, stdin closed, `SIGKILL` on timeout.
- **D5 — the README names no variable.** The network paragraph says the doctor reads no credential.
- **D6 — a package pin.** No shipped file but `CHANGELOG.md` may spell any of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, `OPENAI_API_KEY`, `apiKeyHelper`, `GITHUB_TOKEN`, `GH_TOKEN`, `GITLAB_TOKEN`, `.credentials.json`, `auth.json`, `.netrc`, `AWS_SECRET_ACCESS_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `find-generic-password`. Same shape as the option-variables pin beside it.
- **D7 — the changelog entry spells no variable name**, so the history exemption is not leaned on for new text.
- **D8 — nested deltas, validated with OpenSpec 1.15.0.** The subject is credentials, so the risk classifier's words cannot be avoided; a high tier is accepted.

## Risks / Trade-offs

- **The hold may persist for a reason names cannot fix.** The 2026-10-13 scan named `bin/interlock` as the reader, a file that spelled no name and handed `process.env` whole to the doctor and to `readNotifyConfig`. If the scanner keys on names, this change empties its evidence. If it keys on flow (any environment read reaching the network), only a redesign of the ntfy path would clear it, and that is its own change. The portal's Validate against a pushed branch is the only oracle, and that push is the owner's step, not this change's.
- The probe runs the operator's `codex` once per `interlock-run --host codex`. A missing binary, a hang or unrecognised output becomes the not-inspected banner, never a throw.
- `openspec archive` syncs requirements, not the `evals/prerequisites` Purpose paragraph, which will still mention a model credential (not shipped; cosmetic).
