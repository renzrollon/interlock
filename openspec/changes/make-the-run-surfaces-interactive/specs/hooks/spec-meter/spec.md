# Spec Delta

## MODIFIED Requirements

### Requirement: The spec meter SHALL observe only, from the pinned lines, and the guarantee SHALL be pinned statically

Every hook the spec meter adds or extends SHALL resolve to the engine's own behaviour: `next(e)`, a drawing, or an empty command reply. It SHALL return no deny, no substitute result, and no rewritten prompt or Skill call. It SHALL call no model, prompt submission, session message, process, network, file read, file write or permission check. Nothing on disk is needed, because it draws only what crossed the Bash tool and the Write tool, and the server tool uses the engine reports on `turn.step`. The controls of the checkpoint card are the one thing in the spec pane a press acts through: a press SHALL draft its line as the drafting requirement of `hooks/ship-meter` defines, through the module's one read, one fill and one copy, and SHALL do nothing else. At the checkpoint the module also asks for one notification, as the notification requirement of `hooks/ship-meter` defines; the spec meter's hooks ask for nothing beyond it.

The lines it keys on SHALL be the lines the skill suite pins by token for `spec/machine-readable-gate-lines`. A `node --test` case SHALL read the three skill files' fenced command lines and assert that every pinned keyed line is one the pure text module classifies, so the meter and the pins cannot drift apart silently.

The text rules SHALL live in a pure module under `lib/` that imports no `node:` module, reached by the hooks module's import walk. The text rules are: the skill key and the prompt's first word, the line classifier and the segment split, the change-name reader, the field reader, the stage and status texts, the write classifier, and the advisor-entry reader over `serverToolUses`.

The static pins SHALL:
- record no hooked event and no allowed call beyond the lists `hooks/ship-meter` records
- assert that neither the prompt hook nor the Skill hook builds a text or a result of its own
- keep the one `deny` the launch rule's
- keep every forbidden token
- keep the session-state keys as declared
- assert that neither the hooks module nor the pure module spells `isComplete`, `isPlanningComplete`, the word `complete`, or `interlock:advisor`

`claude plugin validate --strict` SHALL list the Skill tool hook, the spec pane and its command on the `hooks:` line, and no method on `calls:` beyond the ones `hooks/ship-meter` records.

#### Scenario: Happy path — the recorded hooks and nothing more

- **GIVEN** the module as shipped
- **WHEN** `claude plugin validate . --strict` and `node --test test/spine/mod-pins.test.mjs` run
- **THEN** the `hooks:` line carries `tool.call{tool=Skill}`, `ui.render{component=Pane, requestId=interlock-spec}` and `command.run{command=interlock-spec}` beside the lines the other requirements record, and the `calls:` line names no method beyond the ones `hooks/ship-meter` records
- **AND** the pins pass with `HOOKED_EVENTS` and `ALLOWED_CALLS` as `hooks/ship-meter` records them, one `deny`, and `['interlock.ledger']` as the only state key

#### Scenario: Failure — a forbidden token, a verdict word or an unpinned line fails a pin

- **GIVEN** the module with any of these:
  - `$.fs.read`, `$.process.run` or `.catch(` added for the spec meter
  - `isComplete` or `interlock:advisor` spelled in `lib/spec-meter.mjs` or `hooks/mod.mjs`
  - a second `deny`, or a `{ text }` of its own in the prompt or Skill hook
  - a checkpoint-card control that fills, copies or reads the prompt box outside the module's one drafting helper
- **WHEN** `node --test test/spine/mod-pins.test.mjs` and `node --test test/spine/spec-meter.test.mjs` run
- **THEN** a pin fails naming the token or the word
- **AND** a fenced keyed line added to `skills/spec/SKILL.md` and pinned by the skill suite that the classifier does not recognise fails the skill-lines pin naming the line

#### Scenario: Edge case — a hook that throws is skipped and the flow continues

- **GIVEN** a Bash result that makes the field reader throw, a Skill call whose `skill` is not a string, a Write whose `file_path` is missing, or a `turn.step` event whose `serverToolUses` is not an array
- **WHEN** the engine runs the chain
- **THEN** the tool call, the skill load, the write and the request resolve as the engine alone would have resolved them
- **AND** the module's later hooks keep working and the run record is as it was before the throw

## ADDED Requirements

### Requirement: At the checkpoint the spec pane SHALL draw the checkpoint card from the fields the meter holds, and SHALL read no artifact

While a spec run is stopped at its checkpoint, `/interlock-spec` SHALL draw, after its own cards, the card `lib/checkpoint-card.mjs` renders from the meter's fields: each artifact's path, status and question, the ledger, validate and gate lines as observed, the findings path, and the five outcomes. Each printed command SHALL have a control that drafts it as `hooks/ship-meter` requires. A field no line reported SHALL read `not observed`. The module SHALL read no file for the card.

#### Scenario: Happy path — a clean checkpoint offers the ship command

- **GIVEN** a spec run for `add-the-thing` stopped at its checkpoint, whose status named four artifacts `done` with their paths, whose ledger line printed `blocking false`, whose validate line printed `ready true` and whose gate line printed `passed true`
- **WHEN** the pane is drawn on `terminal` and on `desktop`
- **THEN** after the meter's own cards the checkpoint card lists each artifact's path with its question, the three observed lines, and the five outcomes in the checkpoint document's order
- **AND** the outcome that it looks right carries the control `Draft: /interlock:ship add-the-thing`, and pressing it with an empty prompt box fills exactly that line

#### Scenario: Failure — a line that never crossed reads not observed, and blockers offer the re-gate

- **GIVEN** a spec run stopped at its checkpoint in which no `interlock ledger` line crossed, whose gate line printed `passed false`, and whose findings file was written at `.claude/metrics/review-artifacts-add-the-thing-20261106-101500.json`
- **WHEN** the pane is drawn
- **THEN** the card's ledger line reads `not observed`, and the outcome for reported blockers carries the control `Draft: /interlock:review-artifacts add-the-thing --since .claude/metrics/review-artifacts-add-the-thing-20261106-101500.json`
- **AND** in a run where no findings file was observed, that outcome carries no control and says the findings file was not observed

#### Scenario: Edge case — no card before the checkpoint, after a hand-over, or with no run

- **GIVEN** a live spec run that has not reached its checkpoint
- **WHEN** the pane is drawn
- **THEN** no checkpoint card and no control is drawn
- **AND** a run that handed over to ship, and a session with no spec run, draw none
- **AND** below the card floor the card's lines are drawn flat with their controls, as the pane's other lines are
