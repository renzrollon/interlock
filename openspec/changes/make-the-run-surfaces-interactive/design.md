# Design

## Context

See `proposal.md` for why. The owner asked for the epic's release requirements in one change, not an epic of briefs (D26); it carries seven delta spec files, and `interlock validate` reports its width against the published cap. What shapes the approach:

- `hooks/mod.mjs` is one file that runs inside the engine with no Node. Everything it imports must be Node-free, and `test/spine/mod-pins.test.mjs` pins its calls (`ALLOWED_CALLS`, :35-58), its forbidden tokens (:87-105, a substring match, so today's `$.prompt` entry blocks `$.prompt.fill`), its hooked events (:73-84) and "two files at most" (:335-342).
- The engine was probed on 2.1.287, 2.1.295, 2.1.301 and 2.1.318 with scratch plugins (explore brief F1-F6). What was seen is cited below by finding; what was not seen is listed under Risks.
- The floor is a constant, `MODS_MIN_HOST_VERSION` in `lib/host/claude-env.mjs:41`. CI's floor leg installs that engine and runs `claude plugin validate . --strict` and `claude plugin test .` on it (`.github/workflows/ci.yml:28-90`), and that leg blocks merges.
- The halt card is one Markdown text read through `$.fs.read` and cut by `clampCard` (`hooks/mod.mjs:1714-1733`). `lib/resume-card.mjs` imports `node:fs`, so the module cannot import the card's writer, only read what it printed.
- The spec meter holds the change, each artifact's status and path, the ledger counts, the validate and gate fields and the findings path, and no ledger row text (`lib/spec-meter.mjs`).
- `cli/interlock` is 238,172 B against a size line of 245,760 B, so a new verb is a `lib/<name>-cli.mjs` behind a one-line `case`.

## Goals / Non-Goals

**Goals:**

- A person acts from a pane with one press and one Enter, and the module still decides nothing.
- Every drafted line is a line the pane printed. One reader finds those lines, for both panes.
- Every surface has a text twin that works in `-p`, cloud and `interlock-run`.
- The floor leg stays green and blocking.

**Non-Goals:**

- **A lane row that opens its agent's transcript** (D2). `$.ui.view({ agentId })` on a Workflow agent's id answers `{ deny: 'no agent under that id' }`, running or finished (F2), and ship lanes are Workflow agents. The halt card's `claude --resume … --fork-session` line gets a copy control instead.
- **A plugin monitor component** (D8). A monitor that prints nothing still sends one notice when it ends and the model takes a turn (F3), so "off" would cost every ship run a turn. `interlock run-log follow` ships as a verb a person, or a session's own monitor, can run.
- **The person-held destructive-git check** (D1). It is not observe-only and it halts unattended runs; the epic defers it (`docs/notes/2026-10-31-five-epics.md:582, :620`).
- `Input`, `Select` and tabs in the checkpoint card. Controls are label-only `Button`s; a note field would be state the module holds and nothing reads.
- `--since` values as suggestions (D11): a commit id needs `git`, which the preflight does not start for its lists, and the checkpoint card already drafts the findings-file form whole.
- Regenerating `site/`. Its floor mentions change when the site is next generated.

## Decisions

Ids are the ledger's (`decisions.md`). D3 and D6 are the owner's and are written here as proposals.

### The floor rises to 2.1.295, with one gate in the module (D3 proposed, D20)

On 2.1.287 a module that hooks `prompt.autocomplete` fails strict validate ("is not an event"), and a kit test that stubs a newer call fails to load (F6). On 2.1.295 a scratch plugin with exactly this change's set passed both: `prompt.autocomplete`, `$.ui.notify`, `$.ui.copy`, `$.prompt.read`, `$.prompt.fill`, a label-only `Button` and an `Svg`. So the proposal is `MODS_MIN_HOST_VERSION = '2.1.295'`.

- *Keep 2.1.287 and gate each surface at run time*: rejected. The kit tests of any new call still fail to load on the floor leg, and CI says never to make that leg advisory.
- *2.1.301*: rejected. Nothing in the set needs it.

If the owner answers D3 "keep the floor", this change cannot ship as written: every new call and the new hook go, and what remains is the checkpoint verb, `follow`, and the `--human-override` requirement.

D20, what a module loaded below the floor does: at `session.start` it compares `$.session.version()` with the constant (imported with `compareVersions` from `lib/host/claude-env.mjs`, which has no import of its own), sets `session.interactive = false`, and toasts one line naming both versions. Every pane, band, status line, notification and suggestion already branches on `session.interactive`, so one assignment turns them off. The launch guard does not branch on it for its deny, so it keeps working. An unreadable version leaves the module on, because guards fail open. Below 2.1.292 the engine refuses the whole module, and there the settings-hook form of the launch guard is the enforcement, as `hooks/launch-guard` already says.

### Drafting: read, then fill or copy, from one helper (D4, D22, D25)

`$.prompt.fill({ text })` replaces a typed draft without asking (F1). So a press calls one helper:

1. `$.prompt.read()`. Empty text: `$.prompt.fill({ text: line })`.
2. Text in the box, a read that rejects, or a fill that answers `isFilled: false`: `$.ui.copy({ text: line })` and a toast that says the line was copied.
3. A copy that answers `isCopied: false` or rejects: a toast that spells the line.

A `claude --resume … --fork-session` line skips step 1: it is a shell line for another terminal. The helper is the only place `$.prompt.read(`, `$.prompt.fill(` and `$.ui.copy(` are spelled, and the pin counts each. The module spells no `$.prompt.submit`, `$.command.run` or `$.tool.call`; a filled prompt the person submits carries `origin.kind: 'composer'`, which the launch guard counts as human (F1).

D22, where a control's line comes from: `lib/run-actions.mjs`.

- `printedCommands(text)` returns every command line the text printed, in print order, each one time: a fenced line or a code span that begins `interlock `, `/interlock:` or `claude --resume `. It is the test-local helper of `test/spine/resume-card.test.mjs:545-559`, widened to three prefixes. It returns a placeholder line whole.
- `offeredActions(text)` returns `[{ line, act }]` for the lines of `printedCommands` that hold no `<…>`; `act` is `copy` for a `claude --resume` line and `draft` otherwise. The label is `Draft: ` or `Copy: ` and the line.

Both panes get their controls from `offeredActions`, the handoff pane over the card's whole text before `clampCard` cuts it, the spec pane over each line of the checkpoint card. That is why the checkpoint card prints a bare `/interlock:spec` for a send-back: a placeholder would cost the control.

D25: a control drafts the line as printed and adds no `!`. An `interlock …` line submitted from the prompt box is a prompt, and the model runs it; whether a filled `!` line enters shell mode was not probed.

### The checkpoint card: one renderer, two callers, no file read in the module (D5, D7, D12, D14, D24)

`lib/checkpoint-card.mjs` exports `QUESTIONS`, `OUTCOMES` and `checkpointCard(fields)`, which returns keyed lines (`checkpoint-artifact-<id>`, `checkpoint-ledger`, `checkpoint-ledger-row-<id>`, `checkpoint-validate`, `checkpoint-gate`, `checkpoint-findings`, `checkpoint-outcome-<n>`). Fields: `change`, `artifacts: [{ id, path, status }]`, `ledger`, `ledgerRows`, `validate`, `gate`, `findings`. Any of them absent reads `not observed`.

- D12: the questions and the five outcome titles are `docs/02-the-checkpoint.md`'s (:23-26, :86-101), and a test reads that file and compares both ways.
- D5: the pane passes what the spec meter holds and reads no artifact. Letting `$.fs.read` read the artifacts would widen "two files at most" for a pane nobody can read a document in.
- D7: the pane shows the ledger line and the ledger's path; the CLI twin lists the `needs_human` rows. An answer to a row stays a hand edit, because the ledger contract has no third class.
- D24: `interlock checkpoint <change>` starts no process, so it cannot ask `openspec status`. It passes `present` or `missing` as each artifact's status, the ledger audit and validate result from the CLI's own modules, and the newest `.claude/metrics/review-artifacts-<change>-*.json` with the gate's reading of it. It writes nothing: it calls the gate's reader, never the `--metrics` path.
- D14: the verb only prints. The spec skill runs `interlock checkpoint "<change-name>"` right before `interlock notify checkpoint`. It is no keyed line of the spec meter, so `lib/spec-meter.mjs` is untouched and the line joins `UNREAD_BY_NAME` (`test/spine/spec-meter.test.mjs:775`).

Outcome commands: `/interlock:ship <change>`; for each send-back `/interlock:spec` and the record line; `interlock validate <change>`; `/interlock:review-artifacts <change> --since <findings file>` only when a findings file is known.

### The send-back record line (D6 proposed)

Proposed: each send-back outcome prints `interlock autonomy record spec --human-override`. In `lib/autonomy.mjs:105-144` that counts one override for `spec`, zeroes its clean count and moves it from `L3` to `L2`; it touches no other skill. That is a behaviour change for every adopter who presses it, so it is the owner's call. If the answer is no, the two outcomes print `/interlock:spec` alone and the `spec/autonomy-record` requirement still stands, because the flag exists and its CLI glue has no test.

### The wave diagram: above the board, from the board's rows (D9, D10, D13, D23)

- D9: on a surface other than `terminal` the meter pane draws one `Svg` above the board. The board stays on both surfaces: a living scenario requires it and the lane notes live there.
- D10: `drawPlanSvg(rows)` in `lib/draw-plan-svg.mjs` takes the rows of `drawPlanBoardRows` (`lib/draw-plan.mjs:409`) and returns `{ source, width, height, alt }` or `{ reason, alt }`. Wave rows give the groups; a lane row's `parts` give the box (label, model, state word) and its `after` ids give the edges, joined to the lanes that hold those task ids. No new export from a pinned module. `alt` is the rows' texts. The document sets its own background and ink, because an `Svg` was not shown to read the surface's theme, and shows state by word and stroke pattern.
- D23: every text is XML-escaped and the document names nothing outside itself. A lane title is task prose from `tasks.md`, and it reaches a Desktop surface.
- D13 (as amended by D15 and D16): the new cap `planSvgMaxChars` is 131,072, the engine's bound on an `Svg` `source`. Over it the renderer returns a reason and the pane says so; a cut document would be a broken one.
- The module joins the purity list at `test/spine/draw-plan.test.mjs:305`.

### Notification: one helper, words from held fields (D17)

`lib/run-tell.mjs` exports `tellOf({ kind, runId, change, reason, exitCode, statusText, stretch })`, which returns `{ key, text }`:

| kind | told when | text built from | key |
|---|---|---|---|
| `halt` | a halt step crosses (`hooks/mod.mjs:1554`) | change, `halted`, the step's reason | `halt:<runId>` |
| `close` | the close record crosses a run that did not halt (`:1621-1625`) | change, the record's exit code | `close:<runId>` |
| `quiet` | the quiet word first appears in a stretch (`:446-450`) | the status line's text | `quiet:<runId>:<stretch>` |
| `checkpoint` | a spec run stops at its checkpoint | the status line's text | `checkpoint:<change>` |

The module's one `tell($, kind)` helper is the only place `$.ui.notify(` is spelled. It skips a key it already told, calls `$.ui.notify(text, { title: 'Interlock' })`, and toasts the same text when the answer is not `isSent: true` or the call rejects (F4: tmux answered `isSent: false`, `no-channel`). Told keys live in module memory and are cleared with the run records at a session boundary; no session-state key is added.

### Suggestions: the plugin's own commands only, ahead of the engine's rows (D11, D16, D18)

`lib/prompt-rows.mjs` exports `ARGUMENT_COMMANDS` and `promptRows(event, report, cap)`. The table: a change name after `/interlock:ship`, `/interlock:review-artifacts`, `interlock validate`, `interlock ledger`, `interlock checkpoint`; a run id after `interlock run-log show`, `interlock run-log follow --run`, `interlock run-log query --run`. `promptRows` answers rows only when the draft's leading words are a table entry and `event.token` is that argument; rows are `{ text, label, description }` for the report's names that begin with the token, newest first, at most `LIMITS.promptSuggestRows` (8, a stated default). A test fails when the table names a verb the CLI inventory lacks or a skill the plugin does not ship.

- D18: the hook awaits `next(e)` and puts its rows ahead of the engine's. The probe answered rows without calling `next` (F5), so the shape of the engine's own answer is pinned by the kit test; if it is not a list of rows the module's rows stand alone and one debug-log line says so. The held report is read at a human prompt, so a session's first draft holds none: the hook then reads the preflight file one time for the session.
- D16: the report gains `openChanges` and `recentRuns`, each `{ names, omitted }` or `null`, under the unchanged `interlock.preflight/1` stamp (`buildPreflightReport` already normalises an absent field, `lib/preflight-file.mjs:94-108`). `hooks/preflight.mjs` builds them from directory listings: no file opened, no process. Dot-names are left out (`openspec/changes/.claude/` exists in this repository). The lists are cut at a third new cap, `preflightListNames` (40, the figure `resume card list rows (per list)` already uses), kept apart from the row cap so a prefix can still find a name beyond the first eight.

### `interlock run-log follow`: halt and complete, nothing else (D8, D15, D19)

`lib/run-follow.mjs` is a pure step: `followStep(records, { skipped, lastWriteMs, nowMs, maxAgeMs })` returns `{ done, exit, line }`. `lib/run-follow-cli.mjs` resolves the trajectory (the newest file by modification time, or `--run`), re-reads it every `LIMITS.meterTickMs`, and takes its clock and its wait as arguments so tests run without a real wait.

- Terminal events are `run-halt` and `run-complete`, the same two `checkRunLog` treats as a run's end (`lib/run-log.mjs:1287`); the close writes one or the other (`lib/run.mjs:5104`).
- D15: no quiet line. The trajectory records the CLI's steps, so a wave of implementers leaves it silent for longer than `meterQuietAfterMs` in an ordinary run. The meter can call a run quiet because it sees every tool call; this verb cannot, and its help says so. It gives up, aloud and with exit 1, once the file has not been written for `LIMITS.launchLedgerMaxAgeMs`.
- D19: exit 0 after a halt line as after a complete line. The verb reports; it is no gate. Exit 1 means it has nothing to report: no run, an unknown id, or the age bound.
- The halt line ends by saying it is a record and asks for no relaunch.

### The living text this change modifies (D21)

Three living requirements would be false after this change, so they are MODIFIED with every scenario title kept: `hooks/ship-meter` observe-only and halt-card, and `hooks/session-preflight` mods row. A fourth was not in the brief: `hooks/spec-meter`'s observe-only requirement pins `ALLOWED_CALLS` "unchanged" and "no method on `calls:`" (`openspec/specs/hooks/spec-meter/spec.md:212-232`), and the checkpoint card puts controls in the spec pane. It now points at the lists `hooks/ship-meter` records. Everything else is ADDED.

### Pins

- `ALLOWED_CALLS` gains `$.ui.notify`, `$.ui.copy`, `$.prompt.read`, `$.prompt.fill`. Not `$.ui.view`, which nothing calls.
- `FORBIDDEN_TOKENS` swaps `$.prompt` for `$.prompt.submit` and gains `$.command.run` and `$.tool.call`. `$.process`, `$.fs.write`, `$.store` and `$.model` stay.
- `HOOKED_EVENTS` gains `prompt.autocomplete`.
- A new pin counts one spelling each of `$.prompt.read(`, `$.prompt.fill(`, `$.ui.copy(` and `$.ui.notify(`.
- "Two files at most" keeps its two files; the new read moment is the same preflight file.
- No version number is spelled in `hooks/mod.mjs`.

## Risks / Trade-offs

- [No Desktop or VS Code session could be launched; the diagram's look in light and dark, and `Svg` in VS Code, are unseen] → The kit proves the element is drawn with its `alt`. A person looks before the tag (Migration Plan).
- [`$.ui.copy` was not checked against the system clipboard] → Same manual check. A refused copy toasts the line, so the person is never left with nothing.
- [Whether the plugin directory's scan reads a `prompt.autocomplete` hook, `$.ui.notify` or the clipboard call as a finding is unknown] → `npm run scan-pack` and the owner's Validate before the tag. The module still opens no connection and reads no credential.
- [Adopters on 2.1.287-2.1.294 lose the panes] → The doctor's `mods` row says so, the changelog carries an `### Upgrading` note, and the run itself is unchanged.
- [What a session below 2.1.292 shows for a module it refuses was seen only under `validate` and the kit] → Not relied on. The launch guard's settings-hook form covers that host either way.
- [Every kit test that stubs `session.version` below the floor goes inert under D20] → The stubs in `test/mod/meter.test.ts`, `relaunch.test.ts`, `session-start.test.ts` and `spec-meter.test.ts` move to the constant in the same task as the gate.
- [`hooks/mod.mjs` is one file, so every surface lands in one task] → That task is large by necessity. The pure modules land a section earlier with their tests, so the module task is wiring.
- [Each new allow-list entry sets a precedent] → The one-call-site pins are the containment.
- [A notification for a quiet run may tell a person about a lane that is only thinking] → It repeats the meter's own word, told at most one time per quiet stretch.

## Migration Plan

1. Land the change. `MODS_MIN_HOST_VERSION` moves in the same commit as the module, so CI's floor leg installs 2.1.295 from the constant; the workflow file spells no version and does not change.
2. Before the tag, a person: opens the meter pane on Desktop and in VS Code in light and dark and looks at the diagram; presses a `Copy:` control and pastes; runs `npm run scan-pack`; runs the directory's Validate.
3. `CHANGELOG.md` `[Unreleased]` carries `### Upgrading`: update Claude Code to 2.1.295 or later to keep the panes; nothing else changes below it.

Rollback is a revert of the commit. The preflight file is rewritten at each session start, an older module ignores the two new fields, and no corpus changes shape.

## Open Questions

- Should the `claude --resume` control later draft into a terminal pane instead of copying? Nothing here depends on it.
