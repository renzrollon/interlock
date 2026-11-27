# Proposal

## Why

The 2026-11-26 design critique (`.impeccable/critique/2026-11-26T02-54-33Z__*.md`) scored the README 25/40, the Pages site 24/40 and the terminal 25/40. Its first step, re-pinning stale facts to v1.21.0, is done. The rest share one failure: at the moments a person most needs the next action, the surface does not give it.

- **Terminal, after a halt.** A stuck stage marker blocks `git commit` with a sentence that names no way out. The halt summary's only instruction is addressed to the model.
- **Terminal, at the CLI.** Bare `interlock` prints 1,125 lines. A typo prints the same wall, with no suggestion.
- **README install.** It lists commands before requirements and leaves out the allowlist step an unattended run needs.
- **Site, Run tab.** Its centrepiece renders blank lines.
- **Site, navigation.** Its tabs switch content the reader cannot see.

Step 1's edits make this the right time: they are in the working tree and touch the same files.

## What Changes

**CLI help (distill)**
- Bare `interlock` and `interlock help` print a grouped index of every command, about 25 lines.
- `interlock help <cmd>` prints what `<cmd> --help` prints.
- `--help --all`, `-h --all` and `help --all` print the full text when no subcommand leads; `--help` alone keeps printing it, and `<cmd> ... --all --help` still prints that subcommand's usage.

**Unknown subcommand (distill)**
- `Unknown command: <x>` stays the first line, and the exit code stays 1.
- The full usage after that line is replaced by the closest command name, when one is near, and a pointer to `interlock help`.

**Change listing**
- `interlock changes`, and every command that picks the change when none is named, skips directories whose name starts with a dot. A stray `openspec/changes/.claude/` no longer turns a one-change repo into "multiple active changes".

**Commit denial (harden)**
- The `guard-commit` deny keeps its sentence, then names the marker's actual path, the validated change name, and — only when `.claude/ship/run.json` carries the current schema, matches that change, and the marker sits at that change's own path — the run id.
- It separates two audiences: first telling an agent inside an active run not to commit and not to close or halt the run (the commit step commits), then giving recovery instructions to a person whose run has already stopped (`interlock run close --halt "<reason>"` when a usable matching manifest exists, or removing the marker file by hand otherwise).

**Halted summary (harden)**
- On a halted close that read a usable manifest (rendered by `formatRunSummary`), before its unchanged closing line, the summary says "No commit is on record for this run." when none is recorded.
- It then lists the steps for a person to pick the run up (keeping `--ids` as a placeholder naming verified ids, never filled from leftover task ids).

**Unreachable-close fallback (harden)**
- Both drivers print one shared core sentence: the close was not recorded (preserving "no receipt was written", with no outcome or terminal trajectory event recorded), the stage marker may still block `git commit`, and `interlock run close --halt "<reason>"` from the directory the run started in clears it. `interlock-run` also prints the resolved run directory on a `cwd:` row.

**README install (onboard)**
- The order becomes what you need, the `/plugin` lines, `! interlock doctor` for the allowlist, a new session, then bootstrap.

**Site Run tab (polish)**
- The stepper terminal loses its blank lines.
- The state machine scrolls to keep the highlighted node in view.
- Optional states are drawn with a dashed outline and muted ink that read at 3:1 or more, not 30% opacity.

**Site navigation (layout)**
- A tab click, and a load with a tab hash, bring the panel into view.
- A halt-row click brings its node into view.
- On phones the selected tab stays centred in the strip.

**Final polish**
- Every page-only fix — including the existing `site/index.html` `onHash` patch — is listed under `site/README.md` "Local patches" and pinned by `test/site-patches.test.mjs`, so a regeneration that drops one fails the suite.
- The 14 `cramped-padding` design-hook findings are waived inline, each with its evidence.

## Capabilities

### New Capabilities
- `cli/change-resolution`: which directories under `openspec/changes/` count as changes, for listing and for picking the change when none is named.

### Modified Capabilities
- `cli/arguments`: the unknown-subcommand refusal keeps its first line and exit code but names the closest command instead of printing the full usage. Bare invocation and `interlock help` print an index. `help <cmd>` and no-subcommand `--help --all` / `help --all` are added.
- `hooks/tool-guards`: a commit denial separates the in-run agent instruction from the human recovery instruction, validates the marker's change, uses the actual marker path, and advises `interlock run close --halt` only when a usable matching manifest exists (otherwise naming the marker file to remove by hand).
- `ship/close-summary`: a halted summary from a usable manifest states the commit record and the pick-up steps (with `--ids` kept as a placeholder) before its closing line. The unreachable-close fallback states the close was not recorded, names the left-over marker and the close from the directory the run started in, and adds `cwd:` under `interlock-run`.

## Impact

- **Code:** `cli/interlock`, `lib/cli-flags.mjs`, `lib/help-cli.mjs` (new), `lib/artifacts.mjs`, `hooks/guard-commit.mjs`, `lib/ship-stage.mjs`, `lib/receipt.mjs`, `workflows/ship.js`, `cli/interlock-run`.
- **Docs:** `README.md`, `docs/04-when-it-stops.md`, `docs/07-cli-and-configuration.md`, `docs/13-the-guards.md`, `CHANGELOG.md`.
- **Site:** `site/DESIGN-PROMPT.md`, `DESIGN.md`, `site/README.md`, `site/Run.dc.html`, `site/site.css`, `site/index.html`, `site/FirstHour.dc.html` and `site/Limits.dc.html` (inline waivers only).
- **Tests:** `test/spine/suggest-command.test.mjs` (new), `test/spine/cli.test.mjs` (the bare-equals-help pin splits), `test/spine/artifacts.test.mjs`, `test/spine/ship-stage.test.mjs`, `test/hooks.test.mjs`, `test/spine/receipt.test.mjs`, `test/spine/run.test.mjs`, `test/spine/close-fallback.test.mjs` (new), and `test/site-patches.test.mjs` (new). `test/mod/meter.test.ts`'s mirrored deny sentence is updated.
- **Unchanged:** no exit code changes. `--help` with no subcommand still prints the full usage, and `<cmd> ... --all --help` still prints that subcommand's usage. The closing `Do not start another ship run unless the user asks.` line, the `resume card:` row, the resume card itself, the no-manifest / unusable-manifest / already-on-record close summaries, and `skills/dispatch/SKILL.md` are unchanged. No runtime dependency is added.
