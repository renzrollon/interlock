## 1. Failing pins and cases first (red)

Every assertion this section changes is the old requirement written down; the deltas replace that requirement (design D3). Change them here, in the implementing stage, and nowhere later. Run each file after editing it and confirm the cases named RED fail before §2 starts.

- [x] 1.1 `test/spine/mod-pins.test.mjs`: after the renamed-parameter pin (`:187-210`) add the case `the classic session-start hook returns the forward call and nothing else`, per design D2. Take `hookBody(source, 'classic.SessionStart')`, read the three parameter names from the hook's own signature, drop `//` comment lines, and assert on tokens: (a) the body holds a single `return`; (b) that statement is the forward parameter called with the input parameter, with nothing after the closing parenthesis on its line; (c) the body holds none of `.then(`, `.finally(`, `await `, `const `, `let `; (d) the forward's name occurs one time in the body. Put the check in an exported function and add a second case that feeds it four rewritten bodies (a `.then(` continuation, a `.finally(` continuation, await into a variable then return it, `return {}`) and asserts each is named in the problems it returns. RED now: (b) and (c) on the shipped `.then(async started => …)`. (spec: hooks/ship-meter — the classic session-start hook requirement, all three scenarios)
- [x] 1.2 `test/mod/session-start.test.ts`, per design D3. Rename the case at `:124` to `the classic session-start event reads nothing and resolves as the engine alone would; the next prompt draws the band`: after `$.classic.SessionStart({ source: 'startup', cwd: '/repo' })` resolves to `CLASSIC_BENEATH`, assert `w.reads` equals `[]` and the band's rows equal `[]` on both surfaces; then `await prompt($)` and assert `w.reads` equals `[P.PREFLIGHT_PATH]` with the two row assertions the case has today. At `:266-268`, after the `clear` resolves to `CLASSIC_BENEATH`, assert the band's rows equal `[]` on both surfaces, then `await prompt($)` and keep the `interlock preflight OK (1 warning).` assertion. Leave `:222-233` and `:263-264` as written. RED now under `claude plugin test .`: the two empty-read and empty-band assertions. (spec: hooks/ship-meter — the session start's report requirement, the two edge cases)
- [x] 1.3 `test/hooks.test.mjs`. (i) Replace the case at `:589-625` with cases that spawn `hooks/notify-option.mjs` as the host would (`process.execPath`, the script, a kind, a value; `CLAUDE_ENV_FILE` in the environment), one per scenario of the new requirement: a topic is exported and a shell that sources the file reads it back (`sh -c '. "$1"; printf %s "$INTERLOCK_NTFY_TOPIC"'`); `topic'name` and a server survive the shell and the file defines nothing else; the literal `${user_config.ntfy_topic}`, an empty value and a value with a line break each leave the file unchanged with status `0` and empty standard output; `INTERLOCK_NTFY_TOPIC` already in the environment leaves the file unchanged; no `CLAUDE_ENV_FILE` writes nothing and exits `0`; an unknown kind writes nothing. (ii) Add a case that runs `hooks/preflight.mjs` with `CLAUDE_ENV_FILE` and both of the host's option variables set and asserts the file stays empty. (iii) In the registration list at `:1909-1923` add two rows `SessionStart - hooks/notify-option.mjs`. (iv) Add a case over the manifest's `SessionStart` entries: the preflight's command and arguments hold no `${user_config.`; each option entry's arguments hold one such reference and no second one; the two name `ntfy_topic` and `ntfy_url`; no entry under any other event holds one. (v) Assert the new script's source holds no `fetch(` and imports none of `node:http`, `node:https`, `node:net`. RED now: (i), (ii), (iii), (iv). (spec: ship/close-notification — the plugin-option requirement, all scenarios but the shipped-file one)
- [x] 1.4 `test/spine/notify.test.mjs`: drop the two option imports (`:13-14`) and rewrite the case at `:29-46` as `readNotifyConfig reads the two shell variables and ignores the host's option variables`: a source holding only `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC` gives `{ topic: null }`; a source with both gives the shell topic; an invalid shell topic names `INTERLOCK_NTFY_TOPIC` and an invalid shell server names `INTERLOCK_NTFY_URL`. RED now: the first two. (spec: ship/close-notification — the plugin-option requirement; design D6)
- [x] 1.5 `test/spine/doctor.test.mjs`: rewrite the case at `:815-835` as `the notify row ignores the host's option variable`: with `CLAUDE_PLUGIN_OPTION_NTFY_TOPIC: 'from-plugin'` and no shell topic the row is `skip`, its detail matches `INTERLOCK_NTFY_TOPIC` and `ntfy topic`, and `from-plugin` appears nowhere in the report. Move any other case that pins the old skip sentence to the tokens `INTERLOCK_NTFY_TOPIC`, `ntfy topic` and `unattended`. RED now: the rewritten case. (spec: hooks/session-preflight — the notify row requirement, all three scenarios; design D7)
- [x] 1.6 `test/spine/package.test.mjs`. (i) Rewrite the icon case at `:242-256` per design D8: `plugin.json` names `icon`, the value starts `./` and resolves to a file `files` covers, and that file is the square PNG inside the pixel bounds the case already records; drop the `icon` absence assertion and the "no shipped text names the file" loop. Add the two negative checks through a small helper that takes a manifest and a `files` list: a value without `./` and a PNG that is not square are each named. (ii) Add the limits case per design D9 over the shipped file set (the whitelist walked as the closure test walks it, plus `package.json`, `README.md`, `LICENSE`): every file whose extension is not one of `png jpg jpeg gif webp svg ttf otf woff woff2` is under 262,144 bytes and the set holds 512 files or fewer, with both numbers as constants in the case and the checklist's name in a comment beside them; on failure name each file with its size, or the count. Add a helper case that feeds the checker a 262,144-byte text entry, a 300,000-byte PNG entry and 513 entries and asserts the first and the count are named and the PNG is not. (iii) Add a case that walks the same set and fails naming any file that contains `CLAUDE_PLUGIN_OPTION_`. RED now: (i) on the absent key, (iii) on three files. (ii) passes when written and is a guard. (spec: distribution/npm-package — both new requirements; ship/close-notification — the shipped-file scenario)

## 2. The hook, the option path and the manifest (make §1 green)

No file in this section may spell the host's option-variable prefix, in code or in a comment: 1.6 (iii) reads every shipped file. Say "the host's option variables".

- [x] 2.1 `hooks/mod.mjs`, per design D1. Make the `classic.SessionStart` hook (`:2134-2140`) `endRunAtBoundary(meterSessionApi, meterSessionInput)` followed by `return meterSessionForward(meterSessionInput)`, keeping `async` and the three parameter names. Delete `readPreflightAfterStart` (`:912-914`). Rewrite the comment above the hook (`:2117-2133`): the boundary reset runs before the chain; the hook returns the forward call so the event's result, its first message included, is the chain's; the report is read at a person's prompt and by the two commands, never here, because the settings hook that writes it runs inside this chain. Bring the header paragraph on the session start (`:93-106`) in line. Change nothing else in the file: `readPreflight`, the `prompt.submit` hook and `endRunAtBoundary` stay as they are.
- [x] 2.2 `hooks/notify-option.mjs` (new, mode 644, run only as `node <path>`), per design D5. Arguments: a kind (`topic` or `url`) and a value. Print nothing to standard output and exit `0` on every path. Write nothing when the kind is unknown, when the value is empty after trimming, carries `\0`, `\r` or `\n`, or contains `${user_config.`, when `CLAUDE_ENV_FILE` is unset, or when the matching `INTERLOCK_NTFY_*` variable is already set in the environment; otherwise append one `export INTERLOCK_NTFY_TOPIC='…'` or `export INTERLOCK_NTFY_URL='…'` line, single-quoted as `shellQuote` in `hooks/preflight.mjs:287-289` does it, in one `appendFileSync`. A write that throws is one line on standard error. Imports `node:fs` only. The header comment says why the hook exists (an option reaches hooks only, and the command that pushes is not one), why there is one hook to an option (design D4's probe: the host does not run a hook whose arguments name an option with no saved value), and that it never judges the value's shape.
- [x] 2.3 `hooks/preflight.mjs`: remove `publishNotifyOptions`, `shellQuote`, `publishable`, the `try` that calls it (`:321-327`) and the `appendFileSync` import if nothing else uses it. Update the file's header where it describes the copy. The hook no longer reads or writes anything for the push.
- [x] 2.4 `.claude-plugin/plugin.json`: add the two exec-form entries to the `SessionStart` group after the preflight's, as written in design D4, leaving the preflight's entry byte for byte; add `"icon": "./assets/icon.png"` after `keywords`. Run `claude plugin validate . --strict` and confirm it still passes and its `hooks:` line is unchanged.
- [x] 2.5 `lib/notify.mjs`, per design D6: remove `NOTIFY_TOPIC_OPTION`, `NOTIFY_URL_OPTION` and their doc comment (`:42-48`); `readNotifyConfig` (`:88-101`) reads `NOTIFY_TOPIC_ENV`, then `NOTIFY_URL_ENV` or the default server, and names one of those two when a value is invalid. Fix the header's source list (`:8-12`) if it names the options.
- [x] 2.6 `lib/doctor.mjs` `checkNotify` (`:931-953`) and its doc comment (`:915-925`), per design D7: read `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` only; the `skip` detail is design D7's sentence; the `ok` detail is unchanged.

## 3. Docs and the changelog (needs §2)

- [x] 3.1 `README.md:119`, per design D10: the server comes from the plugin's `ntfy server` option or `INTERLOCK_NTFY_URL`; replace the "Session start copies a set option…" sentence with the per-option hook sentence; after "Interlock makes no other request." add the `/interlock:mr` sentence (`gh`, `glab`, `git fetch`, the person's own sign-in, those tools' requests). Keep `interlock notify`, `INTERLOCK_NTFY_TOPIC` and `INTERLOCK_NTFY_URL` in the paragraph: `test/workflows.test.mjs:1649-1654` pins them.
- [x] 3.2 `docs/07-cli-and-configuration.md:303`: say how a plugin option reaches the session now (a hook to an option, run only when that option is saved), that a variable already provided wins, and that `interlock doctor` at session start cannot see an option and says so.
- [x] 3.3 `docs/13-the-guards.md`: the count of settings hooks at `:5`; a table row for `hooks/notify-option.mjs` (`SessionStart`, twice, what it writes and when the host runs it); the preflight's row loses the option copy; the `classic.SessionStart` bullet at `:45` says the hook resets and passes the event on, and reads nothing; the paragraph at `:50` says the report is read at a person's prompt and by the two commands. Then grep `docs/` for `classic session-start`, `copies a set option` and `session start copies` and fix what the grep finds.
- [x] 3.4 `CHANGELOG.md` under `## [Unreleased]`, in the file's voice, without spelling the host's option-variable prefix: the session-start hook returns the forward call (**Breaking**: on a host that raises the classic event to a module the band follows the first prompt); a plugin option reaches the session through a hook of its own; the listing image is declared; the bundle is held to the directory's two file limits; and what was left alone on purpose (`bin/`, `types`, the key presence checks).

## 4. Final verification (needs §1 to §3)

- [x] 4.1 Run `npm test`, `claude plugin test .`, `claude plugin validate . --strict` and `openspec validate clear-the-plugin-directory-holds --strict`, and paste each command's tail into a closing note at the end of this file. `lib/notify.mjs` changed, so run `test/spine/cli.test.mjs` and `test/spine/run.test.mjs` outside the sandbox as well: inside it the six relay cases skip for want of a local port. Confirm with `git diff --stat` that no file outside this change's Impact list moved, and that `test/mod/meter.test.ts` and `test/mod/spec-meter.test.ts` are untouched.

## After the run, by hand (design D11; not tasks, and not part of a ship run)

Do both before a version is tagged. Neither can be done by an agent in a run: the first needs an option saved in the person's own settings, the second needs the developer portal.

1. **A saved option reaches the hook.** With a build of this tree loaded and the `ntfy topic` option saved, start a session and run `interlock doctor` from it: the `notify` row reads `ok` and names the server. Clear the option and start another session: the row reads `skip`, and the preflight still reports. If the saved value does not arrive, stop and do not tag; design D4 rests on it.
2. **The portal's Validate.** Pack the working tree with `npm pack`, replace the content of the `temp/plugin-scan` branch with the unpacked `package/` tree, push it, and run Validate against that branch in the portal's Source step. Record the report under the closing note. Point the tracked ref back at `release`. For any finding still reported, design D11's table says what it means and what to do.

## Closing note (task 4.1, 2026-10-13)

Run on the working tree of branch `plugin-fixes`, Node 26.8.1, Claude Code 2.1.296.

`npm test` (second run; see the note beneath):

```
ℹ tests 3664
ℹ suites 31
ℹ pass 3654
ℹ fail 0
ℹ cancelled 0
ℹ skipped 10
ℹ todo 0
ℹ duration_ms 151347.43025
```

The first run of `npm test` failed one case, `a signal before run start has answered still closes, truthfully, with no manifest` (`test/spine/host-adapters.test.mjs:1378`): the SIGTERM reached `interlock-run` after `run start` had already answered, so the close read `validate failed` and not `received SIGTERM`. The file is not in this diff. The case passed three times out of three run alone, and the second full run above passed. It is a timing race under full-suite load and is left as it is.

`claude plugin test .`:

```
 118 pass
 0 fail
Ran 118 tests across 4 files. [2.82s]
```

`claude plugin validate . --strict`:

```
  ❯ ./mod.mjs state writes: interlock.ledger
  ❯ ./mod.mjs state reads: interlock.ledger

✔ Validation passed
```

The validator's two `hooks:` lines are byte for byte what they were before task 2.4, and it prints no warning for `icon`.

`openspec validate clear-the-plugin-directory-holds --strict`:

```
Change 'clear-the-plugin-directory-holds' is valid
```

`node --test test/spine/cli.test.mjs test/spine/run.test.mjs`, outside the sandbox, so the relay cases bind their loopback port:

```
ℹ tests 458
ℹ pass 458
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

`git diff --stat` moved sixteen tracked files and added `hooks/notify-option.mjs`. Two are outside the proposal's Impact list:

- `test/spine/notify.test.mjs`, which task 1.4 names.
- `docs/04-when-it-stops.md`, two lines: the sentence task 3.3's grep found ("which session start copies in"), and the link to `docs/13`'s hook table, whose heading now counts seven hooks.

`test/mod/meter.test.ts` and `test/mod/spec-meter.test.ts` are untouched.

Left as found: `docs/assets/DESIGN-PROMPT.md:135` still quotes the doctor's old `notify` skip sentence. It is a verbatim block regenerated from code at a release, not edited by hand, and is not shipped.

Not done here, by design D11: the two by-hand steps above. Nothing in this run shows that a saved option reaches the hook as its argument, or that the directory clears a hold.
