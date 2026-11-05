## 1. The push goes

- [ ] 1.1 Delete `lib/notify.mjs`, `lib/notify-defaults.mjs`, `hooks/notify-option.mjs`. In `.claude-plugin/plugin.json`, drop `userConfig` and the option hook's `SessionStart` entry (design D1).
- [ ] 1.2 `cli/interlock`: drop the push import and USAGE lines. `notify checkpoint <change>` prints one local `checkpoint:` line and exits 0; `notify --title` prints the removed line and exits 0 (D2, D4). The `notify` boolean flag and `run close`'s `notify` input stay, commented "until 1.16.0" (D3).
- [ ] 1.3 `lib/run.mjs` and `lib/receipt.mjs`: no push. `RETIRED_PUSH_ROW` is printed as a summary row on every close path when `--notify` was passed (D3).
- [ ] 1.4 `lib/doctor.mjs`: no `notify` row. `lib/limits.mjs`: no `notifyTimeoutMs` and no `push timeout (ms)` row. `lib/cli-flags.mjs`: the retained flags are annotated.
- [ ] 1.5 `workflows/ship.js` and `cli/interlock-run`: neither passes `--notify`.
- [ ] 1.6 `skills/spec/SKILL.md`: the checkpoint line sends nothing, prints one `checkpoint:` line and exits 0.
- [ ] 1.7 Comments in `hooks/preflight.mjs`, `lib/session-env.mjs`, `lib/advisor-tool.mjs`, `cli/interlock-ship-acp`. `scripts/postinstall-smoke.mjs` and `scripts/cut-release-fixture.mjs` stop naming the push.
- [ ] 1.8 `package.json`: `CHANGELOG.md` leaves `files` (D6), and a `scan-pack` script runs `scripts/plugin-scan-pack.mjs`, which builds the bundle onto a local `temp/plugin-scan` branch and never pushes.

## 2. Tests

- [ ] 2.1 Delete the push's own tests. Each deletion and what replaces it:
  - `test/spine/notify.test.mjs` → package checks (a), (b), (e);
  - the notify-option cases in `test/hooks.test.mjs` → (b), (c);
  - the doctor `notify` row cases → "the doctor carries no notify row";
  - the relay cases in `test/spine/run.test.mjs` and `test/spine/cli.test.mjs` → the compatibility cases in 2.3;
  - the push timeout case in `test/spine/limits.test.mjs` → (e);
  - the push cases in `test/workflows.test.mjs` and `test/spine/postinstall-smoke.test.mjs` → (a) and the driver/README pins.
- [ ] 2.2 `test/spine/package.test.mjs` (D7), each check with a self-test:
  - (a) no shipped code opens a network connection;
  - (b) one credential and option-variable pin with no changelog exception;
  - (c) a sensitive option only in a server's `env` or `headers`, and `${user_config.` only in the manifest;
  - (d) `CHANGELOG.md` does not ship;
  - (e) no push residue.
- [ ] 2.3 Compatibility and driver cases:
  - `run close --notify` closes, says the push was removed, and sends nothing;
  - `notify checkpoint` and `notify --title`;
  - the retained flags parse;
  - neither driver passes `--notify`;
  - the README names the tools whose requests are theirs.
- [ ] 2.4 Updated expectations: `test/hooks.test.mjs` (SessionStart runs only the preflight), `test/skills.test.mjs` (checkpoint tokens), `test/spine/cli-arguments.test.mjs`, `test/mod/spec-meter.test.ts` and `test/mod/settle-meter.test.ts` (result text).

## 3. Docs and changelog

- [ ] 3.1 `README.md`: the network paragraph says Interlock makes no request of its own, names the tools that make their own, and points to Remote Control's push.
- [ ] 3.2 `docs/04`, `docs/07`, `docs/08`, `docs/13`, `docs/assets/DESIGN-PROMPT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/*.yml`, `site/`, `.claude/memory/MEMORY.md`.
- [ ] 3.3 `CHANGELOG.md` `[Unreleased]`: a BREAKING `### Removed` entry and an `### Upgrading` note (D9).

## 4. Verify

- [ ] 4.1 `npm test`, `npm run validate`, `claude plugin test`, and OpenSpec 1.15.0 `validate remove-the-push-notification --strict`.
- [ ] 4.2 `npm pack --dry-run --json` lists no `CHANGELOG.md` and no push file, and `npm run scan-pack` builds the local branch.
- [ ] 4.3 Owner: push `temp/plugin-scan`, run the directory's Validate, and confirm **Uses a credential from the user's machine** is gone before a release.
