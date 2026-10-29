# hooks/spec-meter Specification

## Purpose

Shows an `/interlock:spec` run while it runs: a status line naming the change and the last thing the CLI printed, and a pane with the artifact ladder, the ledger, validate, gate and readiness results by field, the explore fan-out and the writes, drawn by the same hooks module as the ship meter from what crossed the Bash tool and the Write tool, and deciding nothing.

## Requirements

### Requirement: The spec meter SHALL go live only on the plugin's spec skill load in an interactive session, and SHALL take the change name from the CLI alone

The module SHALL start a spec run only when the plugin's spec skill is loaded in a session whose start reported it interactive: a prompt submitted whose first word is `/interlock:spec`, or a Skill tool call naming `interlock:spec` that the engine did not mark errored. The engine raises no skill-prompt event for a plugin skill (probed on Claude Code 2.1.291), so the load is read from these two events as they cross. An `openspec` or `interlock` command crossing the Bash tool SHALL never start one, so a stock OpenSpec flow in the same session draws nothing. The prompt and the Skill call SHALL be passed on exactly as they came, and of the prompt only its first word SHALL be read. At the start the status line and the pane SHALL read `change: unknown until named`; the change name SHALL be taken only from the CLI's own argv (`openspec new change "<name>"`, `--change "<name>"`, the explicit name on `interlock ledger|validate|ready|notify checkpoint "<name>"`, `--metrics <name>`) or from a `changeName` or `change` field in a result's JSON, never from a file path, a prompt or a tool input. The record SHALL keep results per change name; the status line and the pane SHALL follow the name the CLI named last and the pane SHALL list every other name seen in the run. A second spec skill load in the same session SHALL start the record over and say so once on the debug log. In a non-interactive session every hook this requirement adds SHALL return at its first line.

#### Scenario: Happy path — the skill load starts the run and the CLI names the change

- **GIVEN** an interactive session
- **WHEN** the prompt `/interlock:spec add the thing` is submitted
- **THEN** the status line reads `interlock spec: change: unknown until named`, the pane is opened unasked, and the prompt reaches the engine unchanged
- **AND** when a Bash call `openspec new change "add-the-thing"` resolves, the status line reads `interlock spec: add-the-thing · new change` and the pane's header names `add-the-thing`

#### Scenario: Failure — a non-interactive session draws nothing

- **GIVEN** `session.start` reporting `isInteractive: false`
- **WHEN** the prompt `/interlock:spec add the thing` is submitted, or a Skill call names `interlock:spec`, and the same `openspec` and `interlock` lines, writes and spawns follow
- **THEN** no status line is set, no pane is opened, no toast is shown and no record is kept
- **AND** every hook resolved to what the engine alone would have done

#### Scenario: Edge case — a stock OpenSpec flow, a standalone explore, and two active changes

- **GIVEN** an interactive session in which the spec skill was not loaded
- **WHEN** `openspec new change "other"`, `openspec status --change "other" --json` and a Write under `openspec/changes/other/` cross the module, or the plugin's explore skill alone is loaded and spawns three `Explore` agents
- **THEN** no status line is set and the pane reads that no spec run is live in this session
- **AND** in a live spec run where `openspec status --change "alpha" --json` and then `openspec status --change "beta" --json` cross, the status line follows `beta`, the pane draws `beta`'s table and lists `alpha` as another change named this run, and `alpha`'s results are kept under its own name

### Requirement: The status line and the pane SHALL repeat the CLI's own words from the lines it ran, and SHALL make no verdict of their own

While a spec run is live, a Bash call whose command, or one of its segments, begins with one of the flow's keyed lines SHALL be let through and its result read. Segments are split at unquoted `&&`, `||`, `;` or line breaks.

The keyed lines and the fields read from each:
- `openspec new change`
- `openspec status … --json`, for the artifact ladder: `artifacts[].id`, `status`, `requires`, `outputPath` and `applyRequires`; never `isComplete` or `isPlanningComplete`
- `interlock drift --json`: `unarchived`, `stale.broken`, `stale.aging`, by count
- `interlock note match … --json`: `rows` by count, `omitted` and `unreadable`; or `error` with `candidates` when the change did not resolve, read as the ledger and validate lines read it
- `interlock ledger … --json`: `blocking`, `needsHuman`, `invalidCount`, `missing`, `unparseable`
- `interlock validate … --json`: `ready` and `problems`, or `error` with `candidates`; and, when the record carries `width`, `width.wide` and `width.over`, never required
- `interlock gate … --json`: `passed`, `counts`, `malformed`, `metrics.written`, `metrics.reason`
- `interlock autonomy record` and `interlock autonomy clean`: the command tokens only; no level, no count and no text of the result
- `interlock ready … --json`: `ready`, and `blockers` by count
- `interlock notify checkpoint`

The stage on the status line SHALL be composed from those fields in the CLI's words, for example: `status 2/4 done · next: design`, `notes 2 matched (omitted 0)`, `ledger blocking (needs_human 2 · invalid 0)`, `ledger missing`, `validate READY`, `validate READY · WIDE (capabilities)`, `validate NOT READY (problems 2)`, `gate BLOCKED (blocker 1 · warning 3)`, `gate PASS (metrics not written)`, `autonomy record`, `ready false (blockers 2)`, `checkpoint`.

Reading rules:
- Segments SHALL be applied in the command's order.
- A keyed line that reads no result text (`openspec new change`, `interlock autonomy`, `interlock notify checkpoint`) SHALL be applied from any segment by its own argv.
- A keyed line whose result is read SHALL be read only when it is the one such line in the command. Two or more in one command SHALL each be shown as unparsed with the reason `compound command`.
- A result that does not parse as JSON, or that lacks the fields the line names, SHALL be shown as that line with `(unparsed)` and its first line of text on the pane, never as a verdict, and SHALL leave one debug-log line.
- An artifact table whose every artifact is `done` SHALL read `status 4/4 done` and never `complete`.
- Every other Bash call, including any `interlock advisor` line, SHALL be passed through at the first line, its result unread.
- The module SHALL compare no count against any threshold and SHALL show no `quiet <n> min`: `WIDE` is composed from the CLI's `width.wide` field alone, never from `width.capabilities` or `width.tasks` against a cap.

#### Scenario: Happy path — the ladder advances in the CLI's words

- **GIVEN** a live spec run named `add-the-thing`
- **WHEN** these resolve in turn:
  - `openspec status --change "add-the-thing" --json`, with `proposal` and `specs` done, `design` ready and `tasks` blocked
  - `interlock ledger "add-the-thing" --json`, with `blocking: true`, `needsHuman: 2`, `invalidCount: 0`
  - `interlock validate "add-the-thing" --json`, with `ready: true` and no problems
  - `interlock gate --findings … --metrics add-the-thing --json`, with `passed: false` and counts `blocker 1`, `warning 3`, `suggestion 0`
- **THEN** the status line reads, in turn, `interlock spec: add-the-thing · status 2/4 done · next: design`, `… · ledger blocking (needs_human 2 · invalid 0)`, `… · validate READY`, `… · gate BLOCKED (blocker 1 · warning 3)`
- **AND** the pane's artifact table carries four rows with OpenSpec's own status words, and its ledger, validate and gate lines carry the same fields
- **AND** when `interlock note match "add-the-thing" --json` resolves with two `rows`, `omitted: 0` and `unreadable: 1`, the status line reads `… · notes 2 matched (omitted 0)` and the pane's notes line reads `notes: 2 matched · omitted 0 · unreadable 1`
- **AND** when `interlock validate "add-the-thing" --json` resolves with `ready: true` and `width: { wide: true, over: ["capabilities"] }`, the status line reads `… · validate READY · WIDE (capabilities)` and the pane's validate line reads `validate: ready true · problems 0 · wide (capabilities)`; with `ready: true` and no `width` field it reads `… · validate READY` as before

#### Scenario: Failure — a text-only gate line is shown as unparsed, never as a verdict

- **GIVEN** a live spec run, and a consumer repository on the previous skill text whose ledger line is `interlock ledger "add-the-thing"` with no `--json`
- **WHEN** that call resolves with `DECISIONS BLOCKING — 3 row(s): 1 needs_human, 2 agent_resolved, 0 invalid`
- **THEN** the status line reads `interlock spec: add-the-thing · ledger (unparsed)`
- **AND** the pane's ledger line reads `ledger: not read (output not JSON)` with that first line of text beside it, and no `blocking`, `clear`, `pass` or `blocked` word is composed from it
- **AND** one debug-log line names the command and the reason, and the pane's gate line still reads `gate: not run yet`
- **AND** when `interlock note match "add-the-thing" --json` exits non-zero with `interlock: docs/notes/compound.md: header row missing`, the status line reads `… · notes (unparsed)` and the pane's notes line carries that first line of text
- **AND** when a consumer repository on the previous skill text runs `interlock advisor "add-the-thing" --brief --json`, the call passes through unread and neither surface changes

#### Scenario: Edge case — an all-done ladder, a write with no status call, and an autonomy line

- **GIVEN** a live spec run named `add-the-thing`
- **WHEN** `openspec status --change "add-the-thing" --json` resolves with every artifact `done` and `isComplete: true`
- **THEN** the status line reads `interlock spec: add-the-thing · status 4/4 done`, and neither it nor the pane contains the word `complete`
- **AND** when a Write to `openspec/changes/add-the-thing/tasks.md` crosses with no status call after it, the table still shows the statuses the last status call printed and the writes section counts the write
- **AND** when `interlock autonomy record review-artifacts --blockers 1` resolves with `review-artifacts: L1 (0/3 clean)`, the status line reads `… · autonomy record` and no level, count or `clean` word from that text appears anywhere
- **AND** when the one command `openspec new change "add-the-thing" && openspec status --change "add-the-thing" --json` resolves, the table is the status call's
- **AND** when `interlock autonomy clean review-artifacts explore spec; interlock notify checkpoint "add-the-thing"` resolves, the run stops at its checkpoint
- **AND** when `interlock note match "add-the-thin" --json` resolves with `error` and `candidates: ["add-the-thing"]`, the status line reads `… · notes: change not resolved (candidates 1)`, as the ledger and validate lines read the same result

### Requirement: The pane SHALL draw the run on both surfaces by field, count writes and spawns without reading them as validity, and name the record it is not

`/interlock-spec` SHALL open the pane at any width. At the spec skill's load the module SHALL open it unasked. When the engine declines to seat it, one toast SHALL say the meter is available by command, and nothing else is drawn.

The pane SHALL use only elements that draw on the terminal and the Desktop. It SHALL draw, in this order:
- the change (or `unknown until named`) and the schema the last status named
- the artifact table exactly as the last `openspec status … --json` printed it, `id · status · outputPath`, with `applyRequires` named, or `status: not run yet`
- the explore line: `<n> investigators spawned`, from the `agent.spawn` events whose `subagentType` is `Explore` during the run (or that the host reported none), and the brief's path from the last Write under `.claude/handoff/explore-*.md`, or `no brief written yet`
- the drift counts
- the notes line, `notes: <n> matched · omitted <k> · unreadable <u>`, or `not run yet`
- the ledger, validate, gate and readiness lines by field, or `not run yet`
- the autonomy command last run, or `not run yet`
- the advisor-consults line: `advisor consults seen: session <a> · subagents <b>`, where each count is the number of distinct entries named `advisor` in the `serverToolUses` of the `turn.step` events during the run, keyed by entry id. `<a>` counts events with no `agentId` and `<b>` counts events with one. The line is drawn from the run's first such entry onward; before it, the pane has no advisor-consults line
- a writes section listing:
  - each artifact file under `openspec/changes/<name>/` written through the Write or Edit tool, with a count and the last time
  - the findings file's path, from the last Write under `.claude/metrics/review-artifacts-<name>-*.json`
  - no status word beside any of them
- `last activity <ISO>` from the engine's clock, or `last activity unknown`
- one line reading `the artifacts on disk, the findings file and the gate's exit are the record`

Rules:
- A write whose result the engine marked errored SHALL not be counted.
- The advisor-consults count SHALL be drawn and never compared, and its word SHALL be `seen`. The meter does not read settings, so it cannot tell a tool that is off from an engine that never reports server tool uses. Neither SHALL draw a line that reads as a measured zero.
- When no spec run is live, the pane SHALL say so.
- The module SHALL never close the pane itself.
- No pane text SHALL contain the word `complete`.
- A row SHALL carry no colour of the meter's own: a tone SHALL only name what a word the CLI or the engine printed means — an artifact's status word, a field the CLI printed as `true` or `false`, `not run yet` — and SHALL leave the row's text unchanged.

#### Scenario: Happy path — the pane mounts on both surfaces with the table, the counts and the writes

- **GIVEN** a live spec run named `add-the-thing` after:
  - three `Explore` spawns
  - a Write to `.claude/handoff/explore-add-the-thing-20261006-120000.md`
  - one status call
  - two Writes to `openspec/changes/add-the-thing/proposal.md`
  - a Write to `.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json`
  - two `turn.step` events with no `agentId` and one with an `agentId`, whose `serverToolUses` each carry one entry named `advisor`, with distinct ids
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface these are found by key: the artifact rows, the explore line (`3 investigators spawned`, the brief's path), the writes line for `proposal.md` (`written 2×` with its last time), the findings path, the line `advisor consults seen: session 2 · subagents 1`, and the `last activity` line
- **AND** no row carries a tick, a threshold or the word `complete`, and a row's colour is only a tone naming a word the CLI printed

#### Scenario: Failure — the engine declines the unasked open, and a denied write is not counted

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the spec skill is loaded and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-spec opens the spec meter`, and no pane is drawn until the command is typed
- **AND** when a later Write to `openspec/changes/add-the-thing/tasks.md` resolves with `isError: true`, the writes section does not count it
- **AND** when a `turn.step` event repeats an advisor entry id already counted, the advisor-consults line does not change

#### Scenario: Edge case — no run, and a run that has not named its change

- **GIVEN** a session in which the spec skill was not loaded
- **WHEN** `/interlock-spec` is typed
- **THEN** the pane reads that no spec run is live in this session, and nothing else
- **AND** in a live run before any name crossed, the pane's header reads `change: unknown until named`, every result line reads `not run yet`, no advisor-consults line is drawn, and a Write under `openspec/changes/<some-name>/` does not name the change
- **AND** when every `turn.step` event in a live run lacks `serverToolUses`, or carries none named `advisor`, no advisor-consults line is drawn, no pane text contains `none seen`, and no other line changes

### Requirement: The spec pane SHALL be drawn as titled cards with toned words from fields beside unchanged row texts

Each spec pane line SHALL keep the text it reads today. Beside it, each line SHALL carry its section — `header`, `artifacts`, `explore`, `gates`, `writes` or `record` — and coloured spans whose concatenation is exactly the text. At or above the card floor (`wave board min width (columns)` from `interlock limits`), the module SHALL draw the lines as a header card and titled cards, using `borderStyle: 'single'` alone. Below the floor, or with no width reported, it SHALL draw the same lines flat with no border.

Tones:
- An artifact status word: `done` the ok colour, `ready` the current colour, `blocked` dim.
- A field the gate, ledger, validate or readiness line printed as `true` or `false`: the ok colour when the CLI's own field reads it ready, passed or not blocking; the alarm colour otherwise.
- `not run yet`, and the record line: dim.
- A result not read: the warn colour.
- The checkpoint and hand-over lines: the accent colour.

A card's title SHALL be drawn from the line's section and SHALL never be a keyed row. With no spec run live the pane SHALL draw its one no-run text and nothing else, and SHALL add no tick, glyph or word of its own.

#### Scenario: Happy path — a stopped run reads as cards with its gate coloured

- **GIVEN** a spec run at its checkpoint whose status shows four artifacts `done`, whose ledger line printed `blocking false`, whose validate line printed `ready true` and whose gate line printed `passed false`
- **WHEN** the pane is drawn at 120 columns on the terminal and on the desktop
- **THEN** the header card is followed by the cards titled `artifacts`, `explore`, `gates`, `writes` and `record`, each with a single border
- **AND** each `done` takes the ok colour, `blocking false` and `ready true` take the ok colour, `passed false` takes the alarm colour, the checkpoint line takes the accent colour, and every keyed row reads exactly the text it read before this change

#### Scenario: Edge case — a run before any line has crossed

- **GIVEN** a live spec run in which no keyed line has crossed yet
- **WHEN** the pane is drawn
- **THEN** every `not run yet` is dim, the `artifacts` card holds the `status: not run yet` row, and no card is titled for a section with no line
- **AND** the no-run pane, drawn in a session with no spec run, is one text and no card

#### Scenario: Failure — a narrow pane draws flat

- **GIVEN** a live spec run with its status read
- **WHEN** the pane is drawn at 40 columns
- **THEN** no Box has a border, no card title is drawn, and every keyed row still reads its text

### Requirement: The spec run SHALL end at the checkpoint, at an accepted ship launch and at the session boundary, and the module SHALL own one status line

When `interlock notify checkpoint` crosses the module, whatever its result, the run SHALL stop at its checkpoint: the status line SHALL read `interlock spec: <change> · checkpoint` and stay, the pane SHALL keep its last results and add the time the checkpoint crossed, and a later keyed line SHALL change nothing and be named once on the debug log. When a Workflow tool call that the launch rule recognises as a ship launch returns a result the launch rule recognises as accepted, the spec run SHALL end before the ship run becomes live, so the ship meter's status line replaces the spec meter's with no second writer; the readiness result that crossed before the launch SHALL stay on the pane until the boundary. At a classic session-start event whose source is `clear`, `resume` or `fork` the spec run SHALL reset in the same hook and on the same event as the ship run and the settle run, the status line cleared and the pane redrawn to its no-run text; a source of `startup` or `compact` SHALL leave it as it is. The module SHALL compose its one status line in one place, a live run ranking above a finished one: the ship position while a ship run is live, otherwise the spec line while a spec run is live, otherwise the settle line while a settle run is live, otherwise the spec line while a spec run is stopped at its checkpoint, otherwise the settle line while a settle run is done, otherwise nothing.

#### Scenario: Happy path — the checkpoint ends the run and the line says so

- **GIVEN** a live spec run named `add-the-thing` whose last stage was `gate PASS`
- **WHEN** `interlock notify checkpoint "add-the-thing"` resolves with `push: not configured — set INTERLOCK_NTFY_TOPIC`
- **THEN** the status line reads `interlock spec: add-the-thing · checkpoint` and is not cleared, and the pane reads `checkpoint reached <ISO>` with the gate line still `gate PASS`
- **AND** a later `openspec status --change "add-the-thing" --json` changes neither, and one debug-log line names a keyed line that crossed after the checkpoint

#### Scenario: Failure — a ship launch mid-spec hands the line over

- **GIVEN** a live spec run named `add-the-thing` on the continuity path, where `interlock ready "add-the-thing" --findings … --json` resolved with `ready: true`
- **WHEN** a Workflow call naming `workflows/ship.js` returns `status: 'async_launched'` with a run id
- **THEN** the spec run is no longer live, the status line reads the ship meter's `interlock: add-the-thing …` form and never both, and the spec pane reads `ready true` from before the launch with a line saying the run handed over to ship at `<ISO>`
- **AND** when the launch returns an error or a deny, the spec run stays live and its line stays

#### Scenario: Edge case — a clear mid-spec, a compaction, a second spec load on the same change, and a settle run beside it

- **GIVEN** a live spec run with a status line set and a table drawn
- **WHEN** a classic session-start event with source `clear` crosses the module
- **THEN** the status line is cleared, the pane reads that no spec run is live, and a later `openspec status … --json` sets no status line and is named once on the debug log
- **AND** a `compact` source leaves the line, the table and the counts unchanged
- **AND** when the spec skill is loaded again in the same session for a change that already has results, the record starts over with `change: unknown until named`, the earlier results are not kept, and one debug-log line says a new spec run replaced the previous one
- **AND** when a settle run is live in the same session, the status line reads the spec line while the spec run is live, and the settle line while the spec run is at its checkpoint, and never both

### Requirement: The spec meter SHALL observe only, from the pinned lines, and the guarantee SHALL be pinned statically

Every hook the spec meter adds or extends SHALL resolve to the engine's own behaviour: `next(e)`, a drawing, or an empty command reply. It SHALL return no deny, no substitute result, and no rewritten prompt or Skill call. It SHALL call no model, prompt submission, session message, process, network, file read, file write or permission check. Nothing on disk is needed, because it draws only what crossed the Bash tool and the Write tool, and the server tool uses the engine reports on `turn.step`.

The lines it keys on SHALL be the lines the skill suite pins by token for `spec/machine-readable-gate-lines`. A `node --test` case SHALL read the three skill files' fenced command lines and assert that every pinned keyed line is one the pure text module classifies, so the meter and the pins cannot drift apart silently.

The text rules SHALL live in a pure module under `lib/` that imports no `node:` module, reached by the hooks module's import walk. The text rules are: the skill key and the prompt's first word, the line classifier and the segment split, the change-name reader, the field reader, the stage and status texts, the write classifier, and the advisor-entry reader over `serverToolUses`.

The static pins SHALL:
- record no new hooked event and nothing new among the allowed calls
- assert that neither the prompt hook nor the Skill hook builds a text or a result of its own
- keep the one `deny` the launch rule's
- keep every forbidden token
- keep the session-state keys as declared
- assert that neither the hooks module nor the pure module spells `isComplete`, `isPlanningComplete`, the word `complete`, or `interlock:advisor`

`claude plugin validate --strict` SHALL list the Skill tool hook, the spec pane and its command on the `hooks:` line, and no new method on `calls:`.

#### Scenario: Happy path — the recorded hooks and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` and `node --test test/spine/mod-pins.test.mjs` run
- **THEN** the `hooks:` line adds `tool.call{tool=Skill}`, `ui.render{component=Pane, requestId=interlock-spec}` and `command.run{command=interlock-spec}` to the lines the preceding changes recorded, and the `calls:` line adds no method
- **AND** the pins pass with `HOOKED_EVENTS` unchanged, `ALLOWED_CALLS` unchanged, one `deny`, and `['interlock.ledger']` as the only state key

#### Scenario: Failure — a forbidden token, a verdict word or an unpinned line fails a pin

- **GIVEN** the module with any of these:
  - `$.fs.read`, `$.process.run` or `.catch(` added for the spec meter
  - `isComplete` or `interlock:advisor` spelled in `lib/spec-meter.mjs` or `hooks/mod.mjs`
  - a second `deny`, or a `{ text }` of its own in the prompt or Skill hook
- **WHEN** `node --test test/spine/mod-pins.test.mjs` and `node --test test/spine/spec-meter.test.mjs` run
- **THEN** a pin fails naming the token or the word
- **AND** a fenced keyed line added to `skills/spec/SKILL.md` and pinned by the skill suite that the classifier does not recognise fails the skill-lines pin naming the line

#### Scenario: Edge case — a hook that throws is skipped and the flow continues

- **GIVEN** a Bash result that makes the field reader throw, a Skill call whose `skill` is not a string, a Write whose `file_path` is missing, or a `turn.step` event whose `serverToolUses` is not an array
- **WHEN** the engine runs the chain
- **THEN** the tool call, the skill load, the write and the request resolve as the engine alone would have resolved them
- **AND** the module's later hooks keep working and the run record is as it was before the throw
