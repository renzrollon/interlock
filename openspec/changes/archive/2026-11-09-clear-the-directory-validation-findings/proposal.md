# Proposal

## Why

The Claude Code plugin directory's scan of interlock 1.15.1 (`release` at d63cef6, report in `claude-submissions.png`) returned three validation findings: the hooks module uses `$` in a shape the directory's reader cannot follow (`MOD_CAPABILITY_USE_NOT_PLAIN` at `hooks/mod.mjs` 563, 1101 and 1919, the three `tell($, …)` call sites), it registers a hook on `prompt.autocomplete`, an event newer than the directory's list (`MOD_HOOKS_UNKNOWN_EVENT` at 3065), and a shipped package-manager command could not be parsed, which the directory treats as a possible registry redirect (`LAUNCHER_REGISTRY_REDIRECT` on `cli/interlock`). Code clears the first and the third. The second clears when the directory's event list holds the event, which its own remedy says to ask for. No test pins any of the three shapes, so each could return in the next release unseen. The same report refuses the version on six policy grounds that only a Verified organization clears; those are not shapes code can fix, but the shipped set's local-code inventory should be asserted rather than rediscovered at every scan.

## What Changes

- `hooks/mod.mjs`: `tell` becomes an `async function` with its stored `send` closure inlined, so every use of `$` in the module is a plain `$.noun.method(…)` call or `$` passed whole to a function declared at the top of the file. Behaviour is unchanged; its callers never await it.
- `test/spine/mod-pins.test.mjs`: a zero-dependency static scanner refuses any `$` use the directory's finding describes, including a named closure binding that reads `$`, with a frozen, evidenced allow-list for the three older closures the directory has accepted since 1.3; and a pin that every hooked event is in a dated fixture of the mods reference's event list, and that every one the directory's 1.15.1 scan did not accept is in a `MOD_EVENT_FLOORS` table whose floors are at or below `MODS_LOAD_MIN_VERSION`.
- `prompt.autocomplete` stays. Its floor (2.1.292) is recorded in `MOD_EVENT_FLOORS` and in `docs/13` as the version to give the directory's maintainers, which is the remedy the finding itself names; the owner sends that one message after the portal's Validate (D15).
- Every package-manager command a shipped text spells is written long-form with an exact pin: `OPENSPEC_INSTALL` becomes `npm install --location=global <package>@<pinned version>` and the three skills, the README and the first-hour guide that quote it follow; the doctor and the run program print one `cliInstallCommand(version)` instead of `npm i -g …`; the README's own install line carries the package version, held to `package.json` by a pin; the `--typecheck-command` usage example names `tsc --noEmit` with no launcher; comment-only launcher mentions are reworded.
- `test/spine/package.test.mjs`: a `packageCommandProblems` detector over every shipped text (long verbs, long options, `=`-joined values, exact pins, no package-source setting), and a `directoryPolicyProblems` detector that names the six policy codes over the shipped set and asserts the declared inventory, so the refusals are replicated by a test and any drift in them is caught.
- Docs and the changelog record the findings, the fixes and the by-hand step that follows: pack the scan branch with `npm run scan-pack` and run the portal's Validate, which is the only oracle for these codes. Install lines in the docs that do not ship are spelled long-form too.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hooks/ship-meter`: two added requirements — the hooks module SHALL use the capability object only in plain shapes and the rule SHALL be pinned statically; every hooked event SHALL be documented or carry a recorded engine floor that is reported to the directory.
- `openspec-cli`: the provisioning-failure and doctor requirements name the long-form, exactly pinned install command in place of `npm install -g @fission-ai/openspec@latest`.
- `distribution/npm-package`: two added requirements — every package-manager command a shipped text spells SHALL be readable and pinned; the bundle's local-code inventory SHALL be declared and asserted against the directory's policy codes.

## Impact

- Code: `hooks/mod.mjs` (one function), `lib/host/claude-env.mjs` (one export), `lib/openspec-cli.mjs`, `lib/doctor.mjs`, `lib/run.mjs`, `cli/interlock` (usage text), comments in `lib/test-paths.mjs` and `lib/host/acp.mjs`.
- Prose: `skills/spec/SKILL.md`, `skills/bootstrap/SKILL.md`, `skills/dispatch/SKILL.md`, `README.md`, `shared/TEST-PROFILE.md`, `docs/01`, `docs/07`, `docs/13`, `docs/15`, `docs/16`, `CHANGELOG.md`.
- Tests: `test/spine/mod-pins.test.mjs`, `test/spine/package.test.mjs`, a dated events fixture `test/fixtures/mod-events.json`, and the pins that quote the old strings: `test/spine/openspec-cli.test.mjs` 96 and 388, `test/spine/doctor.test.mjs` 2060 and 2268, `test/spine/run.test.mjs` 9364, and the comment at `test/skills.test.mjs` 606.
- No dependency, no new executable, no behaviour change in the meter or the CLI beyond the printed strings.
- Out of scope: a prose-only directory edition that the six policy refusals would accept (declined for now, D14), and sending the report of 2.1.292 to the directory's maintainers, which is the owner's outward step after the run (D15).
