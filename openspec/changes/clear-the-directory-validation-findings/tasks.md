# Tasks

Bug fix, repro-first: section 1 lands the failing tests, section 2 makes them green, and later tasks touch only the root causes named here. An assertion that pins a meaning the delta specs change is updated in the task that changes that meaning (2.3, 2.4, 2.5), never in a remediation stage, and the update names the assertion and the requirement it now pins.

## 1. Failing tests first

- [x] 1.1 `test/spine/mod-pins.test.mjs`, plus a new fixture `test/fixtures/mod-events.json`: add `plainCapabilityUse(source)` in the `renamedHookReach` style.
  - Masking: blank strings, template text (not the code inside `${…}`), regex literals and comments to spaces, keeping offsets and newlines. Use the regex-versus-division rule in design.md.
  - Collect the names of column-zero function declarations (`function`, `async function`, `export function`).
  - Accept a `$` token in any of these places, and refuse every other `$` token:
    - **A plain call:** `$` immediately followed by `.noun.method(`, with nothing between the parts: no `?.`, `[`, `!` or `)`. So `($.ui).log(` and `($).ui.log(` are refused. Parentheses around a whole call, as in `(await $.session.version()).version` at `hooks/mod.mjs:2763`, wrap no part and pass.
    - **A whole argument:** `$` preceded by `(` or `,` and followed by `,` or `)` (whitespace and newlines allowed), where the enclosing call's callee is a collected top-level name. `...$` is refused.
    - **A parameter:** `$` in the parameter list of a column-zero function declaration, or as the first parameter of the hook function in an `on(` registration. The hook may be arrow or `function`, async or not, generator or not: the module spells `async ($, e, next) =>`, `($, e, next) =>`, `async ($, e) =>` and `async function* ($, e, next)`.
  - Refuse any `const|let|var name = (async)? function|arrow` whose brace-balanced body holds a `$` token, unless the name is in a frozen `ALLOWED_CLOSURES` list: `hide` since v1.3.0, `flush` since v1.3.1, `guardLine` since v1.4.0. Each entry fails as stale when no binding of that name exists or its body holds no `$`.
  - Require each `on(` to be the first code on its line.
  - Add probe self-tests for every shape the ship-meter delta lists, and a test that runs the scanner over `hooks/mod.mjs`.
  - Add the events pin. The fixture holds two dated lists:
    - `reference`: the events the mods reference documents, with its URL (`https://code.claude.com/docs/en/plugins/mods/reference`), its "as of v2.1.290" stamp and the reading date 2026-11-09. Settings-hook events are the family `classic.`.
    - `directoryAccepted`: the ten events the module hooked at `release` d63cef6 other than `prompt.autocomplete`, with the scan named. The 1.15.1 scan flagged one hook only, at line 3065.
  - The events test takes the hooked set from the existing `on('…')` scan. It requires:
    - every hooked event in `reference`, where `classic.<Event>` matches the family;
    - every hooked event outside `directoryAccepted` in `MOD_EVENT_FLOORS`, read from `lib/host/claude-env.mjs` through a namespace import. A missing export then reads as an empty table, so the file still links in the red wave;
    - every floor at or below `MODS_LOAD_MIN_VERSION`;
    - every floors entry naming a hooked event;
    - every floored event, its version and the words `plugin directory` on one line of `docs/13-the-guards.md`.
  - Verify red: `node --test test/spine/mod-pins.test.mjs` fails naming `tell` and `send` and nothing else from the scanner, and naming `prompt.autocomplete` as an event the directory has not accepted with no floor. Every self-test passes. Before the fix, a prototype of this scanner named only `send`. With `send` inlined it named nothing, and with the allow-list emptied it named exactly `hide`, `flush` and `guardLine`.
- [x] 1.2 `test/spine/package.test.mjs`: add `packageCommandProblems(entries)` over `shippedTexts()`, beside `networkProblems`.
  - Where commands are read: only where a text spells code. That means a backtick span in Markdown or in a comment, a line of a fenced block, or a `'…'`, `"…"` or template literal in a module or `cli/` file. Look for a package-manager or launcher word (`npm|npx|pnpm|yarn|bunx|bun|uvx|pipx|uv|corepack`) at a word boundary. Its command runs to the end of the span, line or literal, or to the first `)`, `;`, `|` or `&&`.
  - A manager word followed by a word that is none of that manager's commands or aliases is prose. So are `npm users`, `npm release` and `npm = whichSync(`.
  - A launcher word with no package token after it inside the same span is bare, and not a command.
  - Long verbs only. For npm, reject the aliases `i`, `in`, `ins`, `it`, `add`, `x`, `t`, `un`, `up`, `rm`.
  - No option matching `/^-[A-Za-z]/`.
  - Value options (`--location`, `--tag`, `--package`, `--prefix`, `--workspace`, `--omit`, `--include`, `--python`, `--with`, `--spec`) are joined to their value with `=`.
  - Launches, and installs that name a package, are pinned `name@x.y.z`, `@scope/name@x.y.z` or `name==x.y.z`. Reject `@latest`, `@next`, ranges and missing versions. An install with no package argument, such as `npm install --package-lock-only`, names nothing to pin. A frozen `ALLOWED_DYNAMIC_PINS` holds the two templates: `${OPENSPEC_PIN.package}@${OPENSPEC_PIN.version}` and `${CLI_PACKAGE}@${version}`.
  - Package-source settings are refused anywhere, not only where commands are read: `--registry`, `--index-url`, `--extra-index-url`, `--proxy`, `registry=`, `npm_config_`, `npm config set`, `publishConfig`, `.npmrc`, `bunfig.toml`, `uv.toml`, `pip.conf`, `.yarnrc`. `registry.npmjs.org` may appear only in `lib/openspec-pin.mjs`.
  - Install-line pins:
    - the OpenSpec install quotes in `README.md` and `docs/01-first-hour.md` equal `OPENSPEC_INSTALL`;
    - `README.md`'s CLI install line is `npm install --location=global ${pkg.name}@${pkg.version}`. This is built in the test from `package.json`, so nothing it imports is missing in the red wave.
  - Self-tests for every scenario the npm-package delta lists, including these shipped look-alikes that must pass:
    - the regex `/^npm (ERR!|error)/` at `lib/openspec-cli.mjs:223`;
    - the tool pattern `Bash(npm test:*)` at `lib/doctor.mjs:8`;
    - the plain comment at `lib/doctor.mjs:865`;
    - the bare `npx` at `lib/openspec-cli.mjs:17`, `lib/host/registry.mjs:227` and `lib/host/acp.mjs:123`;
    - the devops rubric's rule text at `skills/review-code/dimensions/devops.md:11`.
  - Add a test asserting the shipped set reports nothing.
  - Add `directoryPolicyProblems(files, manifests, inventory)` for the six codes:
    - `LOCAL_CODE_HOOK_COMMAND`: hooks of every type in `.claude-plugin/plugin.json` and in hooks files' `hooks`;
    - `LOCAL_CODE_MOD`: `modules` entries;
    - `LOCAL_CODE_NOT_READ`: hooks files that name a module;
    - `LOCAL_CODE_WORKFLOW`: `workflows/*.js` and the `workflows` key;
    - `LOCAL_CODE_TOOL_GRANT`: `allowed-tools`, `allowedTools` or agent `tools` beyond plain Read, Grep, Glob and LS, where a `${…}` path, a path starting `//` or `\\`, or a URL counts as beyond;
    - `LOCAL_CODE_FILE_TYPE`: files outside md/txt/json/yaml/yml/png/jpg/jpeg/gif/webp/ico, files starting with `#!`, files that are not UTF-8 or hold a NUL byte, and package-manager configuration files such as `pnpm-workspace.yaml`. A UTF-8 `LICENSE`, `README` or `.gitignore` with no `#!` is allowed.
  - Hold them against a frozen `DIRECTORY_INVENTORY`, which declares:
    - counts for hooks, hooks modules, hooks files naming a module, and workflow scripts;
    - the places that may hold files outside the allowed types: `cli/`, `hooks/`, `lib/`, `workflows/`, `skills/spec/scripts/` and `types/`. `LICENSE` is not a place: it is allowed as plain text;
    - the skill and agent paths that grant beyond the four tools.
  - The detector names every undeclared file or grant by code and path, every declared place or grant path that holds nothing as stale, and every count that differs with expected and actual. Self-tests include an empty inventory over a prose-only fixture set.
  - Verify red: `node --test test/spine/package.test.mjs` fails, naming `lib/openspec-cli.mjs`, `lib/doctor.mjs`, `lib/run.mjs`, `cli/interlock`, `lib/test-paths.mjs`, `lib/host/acp.mjs`, `shared/TEST-PROFILE.md`, both of `README.md`'s install lines, and the three skills that quote the install line. The README CLI-line pin also fails. A prototype of these rules named exactly those files and nothing else.
  - The OpenSpec-quote pin passes today, because the quotes equal today's constant, and must keep passing. The inventory test passes on today's declared inventory, and every self-test passes.

## 2. Make §1 green

- [x] 2.1 `hooks/mod.mjs:630-673`:
  - First save `claude plugin validate . --json` to `$TMPDIR/validate-before.json`.
  - Then make it `async function tell($, fields)`. Remove `const send = async () => {`, its closing brace and `void send()`, and dedent the body as the function's tail.
  - Reword the doc comment's "never awaited" sentence to say the callers do not await it.
  - Verify: the `plainCapabilityUse` test passes over the module. The `ONE_CALL_SITES` and `ALLOWED_CALLS` tests are unchanged and green. A fresh `claude plugin validate . --json` lists the same module calls as the saved one, `$.ui.notify (via tell)` among them.
- [x] 2.2 Record the event floor and the docs line:
  - `lib/host/claude-env.mjs`: export `MOD_EVENT_FLOORS`, frozen, with `prompt.autocomplete` at `2.1.292`, beside `MODS_LOAD_MIN_VERSION`. Add a comment naming the 2026-11-07 probe.
  - `docs/13-the-guards.md`: add one line under the module's hooks. It says `prompt.autocomplete` loads from Claude Code 2.1.292, and that this is the version to give the plugin directory's maintainers, whose event list predates it. The event name, the version and the words `plugin directory` go on that same line, which the pin anchors on.
  - Verify: the events pin in `test/spine/mod-pins.test.mjs` passes.
- [x] 2.3 Pin the OpenSpec install command:
  - `lib/openspec-cli.mjs:51`: `OPENSPEC_INSTALL` renders `npm install --location=global <package>@<version>` from `OPENSPEC_PIN.package` and `OPENSPEC_PIN.version`, both of which the pin object already carries.
  - The five verbatim quotes follow: `skills/spec/SKILL.md:44`, `skills/bootstrap/SKILL.md:35`, `skills/dispatch/SKILL.md:69`, `README.md:44` and `docs/01-first-hour.md:24`.
  - Update the pins that quote the old string, each naming the openspec-cli requirement it now pins: `test/spine/openspec-cli.test.mjs:96,388`, and the comment at `test/skills.test.mjs:606`. Lines 604 and 651 import the constant and keep passing.
  - Verify: `node --test test/spine/openspec-cli.test.mjs test/skills.test.mjs test/spine/doctor.test.mjs` is green. `packageCommandProblems` no longer names these files, and the OpenSpec-quote pin still passes.
- [x] 2.4 One CLI install command:
  - `lib/doctor.mjs`: export `cliInstallCommand(version)`, rendering `npm install --location=global ${CLI_PACKAGE}@${version}`, and use it at lines 769, 770 and 788.
  - `lib/run.mjs:2899` imports and uses it.
  - Reword the comment at `lib/doctor.mjs:1688` to name the suite command `vitest run`, with no launcher.
  - Update `test/spine/doctor.test.mjs:2060,2268` and `test/spine/run.test.mjs:9364` to the new string, naming the npm-package requirement they now pin.
  - Verify: both test files are green, and `packageCommandProblems` no longer names `lib/doctor.mjs` or `lib/run.mjs`.
- [x] 2.5 The remaining spellings:
  - `cli/interlock:1285`: the usage example reads `--typecheck-command "tsc --noEmit"`.
  - `README.md:187`: `npm install --location=global @renzrollon/interlock@<version>` with the `package.json` version, which the README CLI-line pin from 1.2 holds. A version bump now edits this line too, and `npm test` names it when one does not.
  - Comment rewords with no launcher: `lib/test-paths.mjs:35` (`playwright test e2e/`), `shared/TEST-PROFILE.md:69` (the Playwright browser install step named in words), `lib/host/acp.mjs:70` (`some-acp-agent --flag "with space"`).
  - Verify: `node --test test/spine/package.test.mjs` is fully green, including the shipped-set test and both README pins.

## 3. Docs and the changelog

- [x] 3.1 Docs and the changelog:
  - `docs/07-cli-and-configuration.md`: add a section `## The plugin directory's scan` after "No network call: the push was removed". It covers:
    - the three validation findings and their fixes;
    - the loop: `npm run scan-pack`, push the scan branch, portal Validate;
    - the six policy refusals, and that `DIRECTORY_INVENTORY` in the package test is where the shipped local-code counts are declared.
  - Long form for every CLI install or launch under `docs/*.md` (not `docs/notes/`): `docs/07-cli-and-configuration.md:14` and `:20`, with the `-p` sentence at `:18` reworded to `--package=`, `docs/15-merge-confidence.md:397`, and `docs/16-upgrading.md:47`. Each names the version as `@<version>` with the words "the plugin's version", as `docs/16` already does (design D16).
  - `CHANGELOG.md` under `## [Unreleased]`, in the file's voice:
    - `tell`'s shape;
    - the events floor and the docs line;
    - the install-command spelling. This is user-visible: the doctor and provision print a pinned long-form command;
    - the two new package pins and the inventory;
    - that a version bump also edits `README.md`'s CLI install line.
  - Verify: `grep -rnE 'npm i -g|npm install -g|npx -p |@latest' docs/*.md README.md skills shared lib cli` reports nothing but the devops rubric's rule text.

## 4. Final verification

- [x] 4.1 Run `npm test > "$TMPDIR/interlock-test.log" 2>&1` (never under the repo) and confirm it is all green. Confirm `npm run validate` exits 0. Nothing is pushed, and no scan branch is written: `npm run scan-pack` is the owner's step after the run.

## After the run, by hand (owner)

- Run `npm run scan-pack`, push the scan branch and run the portal's Validate.
  - Expected: `MOD_CAPABILITY_USE_NOT_PLAIN` and `LAUNCHER_REGISTRY_REDIRECT` are gone. `MOD_HOOKS_UNKNOWN_EVENT` stays until the directory's event list holds `prompt.autocomplete`. The six `LOCAL_CODE_*` refusals remain (D14).
  - If finding 1 persists: hoist `sendTell($, said)` to module scope (and rename `ONE_CALL_SITES`' entry), then delete `ALLOWED_CLOSURES` and rewrite `hide`, `flush` and `guardLine`.
  - If finding 3 persists: drop `resolved` from the lockfile (`--omit-lockfile-registry-resolved` at `scripts/pin-openspec.mjs:213`, `checkPin` at 122-124, `test/spine/openspec-pin.test.mjs:46,91,125,145`).
- Once that Validate shows `MOD_HOOKS_UNKNOWN_EVENT` as the only validation finding left, send the directory's maintainers one message (D15). It says that Claude Code 2.1.292 is the version that added `prompt.autocomplete`, and asks how an organization becomes Verified.
