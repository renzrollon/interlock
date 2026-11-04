# Proposal

## Why

The plugin directory holds every Interlock version on `MCP_FORWARDS_CREDENTIAL_ENV` ("Uses a credential from the user's machine", attributed to `.claude-plugin/plugin.json`). The published rule is "Don't read a credential that is already set in the user's environment … and send it to a server", and the hold's own text names three remedies: pass a `${user_config.KEY}` value when the read and the send are related, leave unrelated reads for a reviewer to confirm, or remove every part that reads a credential. 1.6.0 took the first route for the ntfy topic (`2026-10-19-clear-the-plugin-directory-holds`) and kept the unrelated reads as a Non-Goal (its `design.md`, "Removing the presence checks of …"), leaving them for a reviewer. The hold survived that release and no reviewer has cleared it, so this change takes the third remedy: nothing the plugin ships reads a credential.

What still reads one at HEAD, all by presence and never by value: the doctor's `claude-bare` row (a key variable and a settings helper), the `auth mode` clause of its `prompt-cache` row, its `evals-credential` row, and the codex adapter's `CHATGPT PLAN PATH` banner (two key variables). The one network send, `lib/notify.mjs` to ntfy, stays.

## What Changes

- `interlock doctor` drops the `claude-bare` row entirely; its only content was the credential question.
- The `prompt-cache` row stops naming an authentication mode. It says the documented defaults depend on the host build and the authentication mode, which the report does not inspect, so the degradation is spoken.
- The `evals-credential` row goes; `evals-harness` stays as the one eval row.
- `interlock-run --host codex` decides `CHATGPT PLAN PATH (codex)` from one `codex login status` run when the host is created, carried through `host.banners`, instead of from two environment variables. A status that cannot be read or recognised prints `CODEX LOGIN NOT INSPECTED (codex)`.
- The README's network paragraph names no credential variable.
- A package test fails on any shipped file but `CHANGELOG.md` that spells a credential variable or file, so the reads cannot come back unnoticed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hooks/session-preflight`: the `prompt-cache` row reads no credential; the bare-headless credential row is removed.
- `evals/prerequisites`: one enablement row; the credential row and its presence-only requirement are removed.
- `run-host-adapters`: the Codex billing banner comes from `codex login status`, with a spoken not-inspected fallback.
- `distribution/npm-package`: no shipped file but the changelog names a credential variable or file.

## Impact

- Code: `lib/doctor.mjs`, `lib/host/codex.mjs`, `cli/interlock-run`.
- Tests: `test/spine/doctor.test.mjs`, `test/spine/host-adapters.test.mjs`, `test/workflows.test.mjs`, `test/spine/package.test.mjs`, `test/fixtures/hosts/fake-codex.mjs`.
- Docs: `README.md`, `docs/04-when-it-stops.md`, `docs/07-cli-and-configuration.md`, `docs/assets/DESIGN-PROMPT.md`, `CHANGELOG.md`.
- Operators lose the `--bare` advice row and the auth-mode clause. A Codex run now spawns `codex login status` once, bounded by a timeout.
- No dependency, no version bump. Whether the hold clears is decided only by the directory's Validate against a pushed branch, which is outside this change.
