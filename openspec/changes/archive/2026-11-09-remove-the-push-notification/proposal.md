## Why

The plugin directory holds every Interlock version, 1.14.0 included, on **Uses a credential from the user's machine**: "Don't read a credential that is already set in the user's environment … and send it to a server, even in a README example." The ntfy topic is that credential: the manifest marks it `sensitive`, `lib/notify.mjs` calls it the only auth the public server has, and the README says to treat it as a secret. The CLI reads it from the environment and posts to `<server>/<topic>`. The hold's related-path remedy, a `${user_config.KEY}` value, trips the directory's hook-command rule, so no hook shape satisfies both. Its only remedy that clears the hold for certain: "remove every part that reads a credential".

## What Changes

- **BREAKING:** the ntfy push is removed: both plugin options, `hooks/notify-option.mjs`, `lib/notify.mjs`, `lib/notify-defaults.mjs`, the doctor `notify` row and the `push timeout (ms)` limit. Interlock makes no network request of its own.
- `interlock notify checkpoint <change>` stays as the spec skill's local checkpoint marker: one `checkpoint:` line, exit 0, nothing sent.
- Until 1.16.0, `interlock run close --notify` and `interlock notify --title` are accepted, do nothing, and say the push was removed, so an older driver on PATH still closes its run.
- Neither driver passes `--notify`.
- `CHANGELOG.md` no longer ships in the package or the plugin bundle.
- New package pins: no shipped code opens a network connection; no shipped file names a credential variable, a credential file or the host's option variables, with no changelog exception; a sensitive option may reach only a server's `env` or `headers`; no shipped file carries the push's residue.
- `npm run scan-pack` builds the bundle onto a local `temp/plugin-scan` branch for the directory's Validate.

## Capabilities

### Modified Capabilities

- `ship/close-notification`: retired, every requirement removed.
- `distribution/npm-package`: the credential pin loses its changelog exception and gains the option variables; new requirements for no network connection and for where a sensitive option may go; the hook-command rule moves here from `ship/close-notification`.
- `hooks/session-preflight`: the doctor's `notify` row is removed.
- `hooks/spec-meter`: the checkpoint line's result text changes.
- `ship/run-program`: the closing step accepts a retired push request and neither driver makes one.

## Impact

- Deleted: `lib/notify.mjs`, `lib/notify-defaults.mjs`, `hooks/notify-option.mjs`, `test/spine/notify.test.mjs`.
- Code: `.claude-plugin/plugin.json`, `package.json`, `cli/interlock`, `cli/interlock-run`, `workflows/ship.js`, `lib/run.mjs`, `lib/receipt.mjs`, `lib/doctor.mjs`, `lib/limits.mjs`, `lib/cli-flags.mjs`, `skills/spec/SKILL.md`, comments in `hooks/preflight.mjs`, `lib/session-env.mjs`, `lib/advisor-tool.mjs`, `cli/interlock-ship-acp`; `scripts/postinstall-smoke.mjs`, `scripts/cut-release-fixture.mjs`, new `scripts/plugin-scan-pack.mjs`.
- Tests: the push's own tests are deleted with the feature. Each deletion and its replacement are listed in `tasks.md`.
- Docs: `README.md`, `SECURITY.md`, `docs/04`, `docs/07`, `docs/08`, `docs/13`, `docs/assets/DESIGN-PROMPT.md`, `site/`, the issue templates, `CHANGELOG.md`.
- A person who saved a topic should retire it; the release is a minor bump. Whether the hold clears is decided only by the directory's Validate of a pack of this branch, which is the owner's step.
