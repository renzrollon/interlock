## Purpose

Shows an `/interlock:spec` run while it runs: a status line naming the change and the last thing the CLI printed, and a pane with the artifact ladder, the ledger, validate, gate and readiness results by field, the explore fan-out and the writes, drawn by the same hooks module as the ship meter from what crossed the Bash tool and the Write tool, and deciding nothing.

## ADDED Requirements

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

While a spec run is live, a Bash call whose command, or one of its segments between unquoted `&&`, `||`, `;` or line breaks, begins with one of the flow's keyed lines SHALL be let through and its result read: `openspec new change`; `openspec status … --json` for the artifact ladder (`artifacts[].id`, `status`, `requires`, `outputPath` and `applyRequires`, never `isComplete` or `isPlanningComplete`); `interlock drift --json` (`unarchived`, `stale.broken`, `stale.aging` by count); `interlock ledger … --json` (`blocking`, `needsHuman`, `invalidCount`, `missing`, `unparseable`); `interlock validate … --json` (`ready`, `problems`, or `error` with `candidates`); `interlock gate … --json` (`passed`, `counts`, `malformed`, `metrics.written`, `metrics.reason`); `interlock autonomy record` and `interlock autonomy clean` (the command tokens only; no level, no count and no text of the result); `interlock ready … --json` (`ready`, `blockers` by count); `interlock notify checkpoint`. The stage on the status line SHALL be composed from those fields in the CLI's words, for example `status 2/4 done · next: design`, `ledger blocking (needs_human 2 · invalid 0)`, `ledger missing`, `validate READY`, `validate NOT READY (problems 2)`, `gate BLOCKED (blocker 1 · warning 3)`, `gate PASS (metrics not written)`, `autonomy record`, `ready false (blockers 2)`, `checkpoint`. Segments SHALL be applied in the command's order. A keyed line that reads no result text (`openspec new change`, `interlock autonomy`, `interlock notify checkpoint`) SHALL be applied from any segment by its own argv. A keyed line whose result is read SHALL be read only when it is the one such line in the command, and two or more in one command SHALL each be shown as unparsed with the reason `compound command`. A result that does not parse as JSON, or that lacks the fields the line names, SHALL be shown as that line with `(unparsed)` and its first line of text on the pane, never as a verdict, and SHALL leave one debug-log line. An artifact table whose every artifact is `done` SHALL read `status 4/4 done` and never `complete`. Every other Bash call SHALL be passed through at the first line, its result unread. The module SHALL compare no count against any threshold and SHALL show no `quiet <n> min`.

#### Scenario: Happy path — the ladder advances in the CLI's words

- **GIVEN** a live spec run named `add-the-thing`
- **WHEN** `openspec status --change "add-the-thing" --json` resolves with `proposal` and `specs` done, `design` ready and `tasks` blocked, then `interlock ledger "add-the-thing" --json` resolves with `blocking: true`, `needsHuman: 2`, `invalidCount: 0`, then `interlock validate "add-the-thing" --json` resolves with `ready: true` and no problems, then `interlock gate --findings … --metrics add-the-thing --json` resolves with `passed: false` and counts `blocker 1`, `warning 3`, `suggestion 0`
- **THEN** the status line reads, in turn, `interlock spec: add-the-thing · status 2/4 done · next: design`, `… · ledger blocking (needs_human 2 · invalid 0)`, `… · validate READY`, `… · gate BLOCKED (blocker 1 · warning 3)`
- **AND** the pane's artifact table carries four rows with OpenSpec's own status words, and its ledger, validate and gate lines carry the same fields

#### Scenario: Failure — a text-only gate line is shown as unparsed, never as a verdict

- **GIVEN** a live spec run and a consumer repository on the previous skill text, whose ledger line is `interlock ledger "add-the-thing"` with no `--json`
- **WHEN** that call resolves with `DECISIONS BLOCKING — 3 row(s): 1 needs_human, 2 agent_resolved, 0 invalid`
- **THEN** the status line reads `interlock spec: add-the-thing · ledger (unparsed)`, the pane's ledger line reads `ledger: not read (output not JSON)` with that first line of text beside it, and no `blocking`, `clear`, `pass` or `blocked` word is composed from it
- **AND** one debug-log line names the command and the reason, and the pane's gate line still reads `gate: not run yet`

#### Scenario: Edge case — an all-done ladder, a write with no status call, and an autonomy line

- **GIVEN** a live spec run named `add-the-thing`
- **WHEN** `openspec status --change "add-the-thing" --json` resolves with every artifact `done` and `isComplete: true`
- **THEN** the status line reads `interlock spec: add-the-thing · status 4/4 done` and neither it nor the pane contains the word `complete`
- **AND** when a Write to `openspec/changes/add-the-thing/tasks.md` crosses with no status call after it, the table still shows the statuses the last status call printed and the writes section counts the write
- **AND** when `interlock autonomy record review-artifacts --blockers 1` resolves with `review-artifacts: L1 (0/3 clean)`, the status line reads `… · autonomy record` and no level, count or `clean` word from that text appears anywhere
- **AND** when the one command `openspec new change "add-the-thing" && openspec status --change "add-the-thing" --json` resolves, the table is the status call's, and when `interlock autonomy clean review-artifacts explore spec; interlock notify checkpoint "add-the-thing"` resolves, the run stops at its checkpoint

### Requirement: The pane SHALL draw the run on both surfaces by field, count writes and spawns without reading them as validity, and name the record it is not

`/interlock-spec` SHALL open the pane at any width. At the spec skill's load the module SHALL open it unasked, and when the engine declines to seat it one toast SHALL say the meter is available by command, with nothing else drawn. The pane SHALL use only elements that draw on the terminal and the Desktop: the change (or `unknown until named`) and the schema the last status named; the artifact table exactly as the last `openspec status … --json` printed it, `id · status · outputPath`, with `applyRequires` named, or `status: not run yet`; the explore line, `<n> investigators spawned` from the `agent.spawn` events whose `subagentType` is `Explore` during the run (or that the host reported none), and the brief's path from the last Write under `.claude/handoff/explore-*.md` or `no brief written yet`; the drift counts; the ledger, validate, gate and readiness lines by field or `not run yet`; the autonomy command last run or `not run yet`; a writes section listing each artifact file under `openspec/changes/<name>/` written through the Write or Edit tool with a count and the last time, the findings file's path from the last Write under `.claude/metrics/review-artifacts-<name>-*.json`, with no status word beside any of them; `last activity <ISO>` from the engine's clock, or `last activity unknown`; and one line reading `the artifacts on disk, the findings file and the gate's exit are the record`. A write whose result the engine marked errored SHALL not be counted. When no spec run is live the pane SHALL say so. The module SHALL never close the pane itself.

#### Scenario: Happy path — the pane mounts on both surfaces with the table, the counts and the writes

- **GIVEN** a live spec run named `add-the-thing` after three `Explore` spawns, a Write to `.claude/handoff/explore-add-the-thing-20261006-120000.md`, one status call, two Writes to `openspec/changes/add-the-thing/proposal.md` and a Write to `.claude/metrics/review-artifacts-add-the-thing-20261006-121500.json`
- **WHEN** the pane is mounted on `terminal` and then on `desktop`
- **THEN** on each surface the artifact rows, the explore line (`3 investigators spawned`, the brief's path), the writes line for `proposal.md` (`written 2×` with its last time), the findings path and the `last activity` line are found by key
- **AND** no row carries a tick, a colour, a threshold or the word `complete`

#### Scenario: Failure — the engine declines the unasked open, and a denied write is not counted

- **GIVEN** a terminal narrower than the engine's floor for an unasked pane
- **WHEN** the spec skill is loaded and the module opens the pane
- **THEN** the open resolves unplaced and exactly one toast says `/interlock-spec opens the spec meter`, and no pane is drawn until the command is typed
- **AND** when a later Write to `openspec/changes/add-the-thing/tasks.md` resolves with `isError: true`, the writes section does not count it

#### Scenario: Edge case — no run, and a run that has not named its change

- **GIVEN** a session in which the spec skill was not loaded
- **WHEN** `/interlock-spec` is typed
- **THEN** the pane reads that no spec run is live in this session and nothing else
- **AND** in a live run before any name crossed, the pane's header reads `change: unknown until named`, every result line reads `not run yet`, and a Write under `openspec/changes/<some-name>/` does not name the change

### Requirement: The spec run SHALL end at the checkpoint, at an accepted ship launch and at the session boundary, and the module SHALL own one status line

When `interlock notify checkpoint` crosses the module, whatever its result, the run SHALL stop at its checkpoint: the status line SHALL read `interlock spec: <change> · checkpoint` and stay, the pane SHALL keep its last results and add the time the checkpoint crossed, and a later keyed line SHALL change nothing and be named once on the debug log. When a Workflow tool call that the launch rule recognises as a ship launch returns a result the launch rule recognises as accepted, the spec run SHALL end before the ship run becomes live, so the ship meter's status line replaces the spec meter's with no second writer; the readiness result that crossed before the launch SHALL stay on the pane until the boundary. At a classic session-start event whose source is `clear`, `resume` or `fork` the spec run SHALL reset in the same hook and on the same event as the ship run, the status line cleared and the pane redrawn to its no-run text; a source of `startup` or `compact` SHALL leave it as it is. The module SHALL compose its one status line in one place: the ship position while a ship run is live, otherwise the spec line while a spec run is live or stopped at its checkpoint, otherwise nothing.

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

#### Scenario: Edge case — a clear mid-spec, a compaction, and a second spec load on the same change

- **GIVEN** a live spec run with a status line set and a table drawn
- **WHEN** a classic session-start event with source `clear` crosses the module
- **THEN** the status line is cleared, the pane reads that no spec run is live, and a later `openspec status … --json` sets no status line and is named once on the debug log
- **AND** a `compact` source leaves the line, the table and the counts unchanged
- **AND** when the spec skill is loaded again in the same session for a change that already has results, the record starts over with `change: unknown until named`, the earlier results are not kept, and one debug-log line says a new spec run replaced the previous one

### Requirement: The spec meter SHALL observe only, from the pinned lines, and the guarantee SHALL be pinned statically

Every hook the spec meter adds or extends SHALL resolve to the engine's own behaviour: `next(e)`, a drawing, or an empty command reply. It SHALL return no deny, no substitute result and no rewritten prompt or Skill call, and SHALL call no model, prompt submission, session message, process, network, file read, file write or permission check: nothing on disk is needed, because it draws only what crossed the Bash tool and the Write tool. The lines it keys on SHALL be the lines the skill suite pins by token for `spec/machine-readable-gate-lines`, and a `node --test` case SHALL read the three skill files' fenced command lines and assert that every pinned keyed line is one the pure text module classifies, so the meter and the pins cannot drift apart silently. The text rules (the skill key and the prompt's first word, the line classifier and the segment split, the change-name reader, the field reader, the stage and status texts, the write classifier) SHALL live in a pure module under `lib/` that imports no `node:` module, reached by the hooks module's import walk. The static pins SHALL record no new hooked event and nothing new among the allowed calls, SHALL assert that neither the prompt hook nor the Skill hook builds a text or a result of its own, keep the one `deny` the launch rule's, keep every forbidden token, keep the session-state keys as declared, and assert that neither the hooks module nor the pure module spells `isComplete`, `isPlanningComplete` or the word `complete`. `claude plugin validate --strict` SHALL list the Skill tool hook, the spec pane and its command on the `hooks:` line and no new method on `calls:`.

#### Scenario: Happy path — the recorded hooks and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` and `node --test test/spine/mod-pins.test.mjs` run
- **THEN** the `hooks:` line adds `tool.call{tool=Skill}`, `ui.render{component=Pane, requestId=interlock-spec}` and `command.run{command=interlock-spec}` to the lines the preceding changes recorded, and the `calls:` line adds no method
- **AND** the pins pass with `HOOKED_EVENTS` unchanged, `ALLOWED_CALLS` unchanged, one `deny`, and `['interlock.ledger']` as the only state key

#### Scenario: Failure — a forbidden token, a verdict word or an unpinned line fails a pin

- **GIVEN** the module with `$.fs.read`, `$.process.run` or `.catch(` added for the spec meter, or `isComplete` spelled in `lib/spec-meter.mjs`, or a second `deny` or a `{ text }` of its own in the prompt or Skill hook
- **WHEN** `node --test test/spine/mod-pins.test.mjs` and `node --test test/spine/spec-meter.test.mjs` run
- **THEN** a pin fails naming the token or the word
- **AND** a fenced keyed line added to `skills/spec/SKILL.md` and pinned by the skill suite that the classifier does not recognise fails the skill-lines pin naming the line

#### Scenario: Edge case — a hook that throws is skipped and the flow continues

- **GIVEN** a Bash result that makes the field reader throw, or a Skill call whose `skill` is not a string, or a Write whose `file_path` is missing
- **WHEN** the engine runs the chain
- **THEN** the tool call, the skill load and the write resolve as the engine alone would have resolved them
- **AND** the module's later hooks keep working and the run record is as it was before the throw
