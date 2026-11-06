# Proposal

## Why

At a halt or a checkpoint a person still copies commands out of a markdown wall, the wave plan's parallelism is a text board on every surface, nothing tells a person in another window that a run stopped, and a send-back at the checkpoint is recorded nowhere: `interlock autonomy record --human-override` exists and no shipped text names it. The engine calls that close those gaps landed between Claude Code 2.1.292 and 2.1.295, and the panes have been cards since 2026-10-28, so what is left is the action gap.

This is Epic 4 of `docs/notes/2026-10-31-five-epics.md`, as one change. The module still decides nothing. It draws, drafts and tells, and the person's Enter is the act.

## What Changes

- **Halt card controls.** `/interlock-handoff` gains one control per command line a card printed. A press drafts that exact line into the prompt box when the box is empty, and copies it and says so when the box holds a draft. The per-lane `claude --resume … --fork-session` line is copy only. A line that holds a placeholder gets no control. Nothing is submitted.
- **Checkpoint card.** When a spec run reaches its checkpoint, `/interlock-spec` draws a card: each artifact with its path and the question `docs/02-the-checkpoint.md` asks of it, the ledger and validate lines the CLI printed, and the five outcomes of that document, each with a control that drafts its command. The same card prints in any session through the new `interlock checkpoint <change>`, which the spec skill runs at the checkpoint.
- **The person's outcome is recorded where today nothing is.** The two send-back outcomes print `interlock autonomy record spec --human-override`; the flag gains a requirement and a test of its CLI glue.
- **Wave diagram.** Where the surface draws SVG (Desktop, VS Code) the meter pane draws the plan as a diagram above the board, from the board's own rows. The board stays on both surfaces and is the diagram's text alternative.
- **Suggestions.** While a person types one of the plugin's commands that takes a change name or a run id, the prompt offers open change names and recent run ids as rows, ahead of the engine's own. The SessionStart preflight report gains the two lists, built from directory listings alone.
- **Native notification.** A halt, a close, a checkpoint and a run gone quiet are each told through the engine's notification, one time per change of state, with a toast in the same words when the engine sends none. The words come from fields the module already holds.
- **`interlock run-log follow`.** A new verb that waits on the newest run's trajectory, prints one line when the run halts or completes, and then exits. It is the notification's twin for `-p`, cloud and `interlock-run` runs. It prints no quiet line: the trajectory records the CLI's steps, so silence between two steps is a lane at work, and the verb says so in its help.
- **BREAKING: the mods floor rises from Claude Code 2.1.287 to 2.1.295.** A module that hooks `prompt.autocomplete` is refused by an older engine, and the kit tests of the new calls do not load there, so CI's floor leg could not stay green on 2.1.287. Below the floor the panes are off and the doctor's `mods` row says so; the run itself is unchanged. Owner decision D3.
- **Pins.** `test/spine/mod-pins.test.mjs` gains `$.ui.notify`, `$.ui.copy`, `$.prompt.read` and `$.prompt.fill`; the blanket `$.prompt` ban narrows to `$.prompt.submit`, and `$.command.run` and `$.tool.call` join the forbidden tokens; `prompt.autocomplete` joins the hooked events; the read, the fill, the copy and the notification get one call site each.

Not in this change, each with its evidence in `design.md`: a lane row that opens its agent's transcript (the engine refuses a Workflow agent's id), a plugin monitor component (it cannot be off without costing every ship run a model turn), and the person-held destructive-git check (not observe-only; deferred by the epic itself).

## Capabilities

### New Capabilities
- `spec/checkpoint-card`: the card a person reads at the spec checkpoint — its artifacts, questions, observed lines and outcomes — rendered by one pure module, printed by `interlock checkpoint <change>`, and run by the spec skill.
- `ship/run-follow`: `interlock run-log follow`, the lines it prints for a halt and a completed run, when it exits, the bounds it reads, and what it cannot see.

### Modified Capabilities
- `hooks/ship-meter`: the observe-only allow-list widens by four calls and one event; the halt card pane gains drafting controls; new requirements for the drafting rule, the wave diagram, the native notification, the prompt suggestions and the floor gate.
- `hooks/spec-meter`: the spec pane draws the checkpoint card at the checkpoint, from the fields the meter already holds; its observe-only requirement names the card's controls as the one thing a press may do.
- `hooks/session-preflight`: the report gains the open-change and recent-run lists; the doctor's `mods` row scenarios move to the new floor.
- `ship/diagrams`: the plan also renders as an SVG document, pure and bounded by a published cap.
- `spec/autonomy-record`: `interlock autonomy record <skill> --human-override` is specified.

## Impact

- **Module:** `hooks/mod.mjs` (halt card pane, spec pane, wave section, session start, one new hook). New Node-free modules it imports: `lib/run-actions.mjs`, `lib/run-tell.mjs`, `lib/draw-plan-svg.mjs`, `lib/checkpoint-card.mjs`, `lib/prompt-rows.mjs`.
- **CLI:** `interlock checkpoint <change>` and `interlock run-log follow`, each a `lib/<name>-cli.mjs` behind a one-line `case` (`cli/interlock` is 7.5 kB from its size line). `lib/run-follow.mjs` is the pure reader. Both verbs join `lib/cli-flags.mjs`, `scripts/postinstall-smoke.mjs`, the CLI inventory tests and `docs/07-cli-and-configuration.md`.
- **Hook:** `hooks/preflight.mjs` and `lib/preflight-file.mjs` write two optional lists under the unchanged `interlock.preflight/1` stamp.
- **Limits:** three new published caps (the SVG character bound, the suggestion row count and the length of the preflight report's two lists); `follow` reuses two existing ones.
- **Floor:** `lib/host/claude-env.mjs` `MODS_MIN_HOST_VERSION`, which CI's floor leg and the doctor read. README, `docs/04`, `docs/07` and `docs/13` name the floor in prose.
- **Skill:** `skills/spec/SKILL.md` gains one fenced line, pinned by token in `test/skills.test.mjs` and listed as unread in `test/spine/spec-meter.test.mjs`.
- **Tests:** `test/spine/` for the pins, the six new modules, the limits and the inventories; `test/mod/interactive.test.ts` (new) and the existing `test/mod/*.test.ts` version stubs.
- **Release:** `CHANGELOG.md` `[Unreleased]` with an `### Upgrading` note for the floor; `npm run scan-pack` and the owner's directory Validate before the tag, because whether the directory scan reads the new hook or calls as a finding is unknown.
- **No new dependency, no network call, no file write from the module, no manifest key.**
