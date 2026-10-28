# Spec Delta

## MODIFIED Requirements

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
