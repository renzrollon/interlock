## 1. The push goes

- [x] 1.1 Delete `lib/notify.mjs`, `lib/notify-defaults.mjs`, `hooks/notify-option.mjs`. In `.claude-plugin/plugin.json`, drop `userConfig` and the option hook's `SessionStart` entry (design D1).
- [x] 1.2 `cli/interlock`: drop the push import and USAGE lines. `notify checkpoint <change>` prints one local `checkpoint:` line and exits 0; `notify --title` prints the removed line and exits 0 (D2, D4). The `notify` boolean flag and `run close`'s `notify` input stay, commented "until 1.16.0" (D3).
- [x] 1.3 `lib/run.mjs` and `lib/receipt.mjs`: no push. `RETIRED_PUSH_ROW` is printed as a summary row on every close path when `--notify` was passed (D3).
- [x] 1.4 `lib/doctor.mjs`: no `notify` row. `lib/limits.mjs`: no `notifyTimeoutMs` and no `push timeout (ms)` row. `lib/cli-flags.mjs`: the retained flags are annotated.
- [x] 1.5 `workflows/ship.js` and `cli/interlock-run`: neither passes `--notify`.
- [x] 1.6 `skills/spec/SKILL.md`: the checkpoint line sends nothing, prints one `checkpoint:` line and exits 0.
- [x] 1.7 Comments in `hooks/preflight.mjs`, `lib/session-env.mjs`, `lib/advisor-tool.mjs`, `cli/interlock-ship-acp`. `lib/session-env.mjs` also drops its unsubstituted-option guard: no option is passed through it any more, and the option check (2.2 c) refuses `${user_config.` outside the manifest. `scripts/postinstall-smoke.mjs` and `scripts/cut-release-fixture.mjs` stop naming the push.
- [x] 1.8 `package.json`: `CHANGELOG.md` leaves `files` (D6), and a `scan-pack` script runs `scripts/plugin-scan-pack.mjs`, which builds the bundle onto a local `temp/plugin-scan` branch and never pushes.

## 2. Tests

- [x] 2.1 Delete the push's own tests. Each deletion and what replaces it:
  - `test/spine/notify.test.mjs` → package checks (a), (b), (e);
  - the notify-option cases in `test/hooks.test.mjs` → (b), (c);
  - the doctor `notify` row cases → "the doctor carries no notify row";
  - the relay cases in `test/spine/run.test.mjs` and `test/spine/cli.test.mjs` → the compatibility cases in 2.3;
  - the push timeout case in `test/spine/limits.test.mjs` → (e);
  - the push cases in `test/workflows.test.mjs` and `test/spine/postinstall-smoke.test.mjs` → (a) and the driver/README pins.
- [x] 2.2 `test/spine/package.test.mjs` (D7), each check with a self-test:
  - (a) no shipped code opens a network connection;
  - (b) one credential and option-variable pin with no changelog exception;
  - (c) a sensitive option only in a server's `env` or `headers`, and `${user_config.` only in the manifest;
  - (d) `CHANGELOG.md` does not ship;
  - (e) no push residue.
- [x] 2.3 Compatibility and driver cases:
  - `run close --notify` closes, says the push was removed, and sends nothing;
  - `notify checkpoint` and `notify --title`;
  - the retained flags parse;
  - neither driver passes `--notify`;
  - the README names the tools whose requests are theirs.
- [x] 2.4 Updated expectations: `test/hooks.test.mjs` (SessionStart runs only the preflight), `test/skills.test.mjs` (checkpoint tokens), `test/spine/cli-arguments.test.mjs`, `test/mod/spec-meter.test.ts` and `test/mod/settle-meter.test.ts` (result text).

## 3. Docs and changelog

- [x] 3.1 `README.md`: the network paragraph says Interlock makes no request of its own, names the tools that make their own, and points to Remote Control's push.
- [x] 3.2 `docs/04`, `docs/07`, `docs/08`, `docs/13`, `docs/assets/DESIGN-PROMPT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/*.yml`, and the site brief `site/DESIGN-PROMPT.md`.
  - Owed, not done here:
    - the exported `site/*.dc.html` pages still carry the push: the doctor's `notify` row (`FirstHour.dc.html`), the `PUSH FAILED` banner (`Why.dc.html`) and the push timeout (`Limits.dc.html`). Regenerate them from the brief, never by hand. `site/` does not ship, so the residue pin (2.2 e) cannot catch them. The `lib/notify.mjs` task titles in `Run.dc.html` are the recorded halted run (brief C.9) and stay;
    - `docs/assets/{doctor,halted,limits}.png` show the removed rows.
  - `.claude/memory/` is gitignored; its two push entries are marked retired locally.
- [x] 3.3 `CHANGELOG.md` `[Unreleased]`: a BREAKING `### Removed` entry and an `### Upgrading` note (D9).

## 4. Verify

- [x] 4.1 `npm test`, `npm run validate`, `claude plugin test`, and OpenSpec 1.15.0 `validate remove-the-push-notification --strict`. `claude plugin validate --profile directory --strict` (2.1.318) passes the released 1.14.0 bundle as well, so its subset does not include this hold, and it cannot stand in for 4.3.
- [x] 4.2 `npm pack --dry-run --json` lists no `CHANGELOG.md` and no push file, and `npm run scan-pack` builds the local branch.
- [ ] 4.3 Owner: push `temp/plugin-scan`, run the directory's Validate, and confirm **Uses a credential from the user's machine** is gone before a release.
