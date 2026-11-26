# spec/artifact-re-gate Specification

## Purpose
Lets a `--since` re-gate of an artifact review judge only what changed since the earlier gate. The gate keeps a copy of the artifacts it judged, and the brief compares the change against that copy, whether or not the change was ever committed.

## Requirements

### Requirement: An artifact gate SHALL keep a snapshot of the artifacts it judged, beside its findings file

When `interlock gate` is given `--stage artifacts`, `--metrics <change>` and a `--findings` file path, it SHALL write a snapshot of that change's artifact files to `snapshots/<findings file name>` in the findings file's directory: each file's change-relative path, its text and its SHA-256. The gate's JSON SHALL carry `snapshot` with `written`, `path` and `reason`.

#### Scenario: Happy path — the gate keeps what it judged

- **GIVEN** a change `x` holding `proposal.md`, `design.md`, `tasks.md`, `decisions.md` and `specs/a/spec.md`
- **WHEN** `interlock gate --findings .claude/metrics/review-artifacts-x-20261125-120000.json --metrics x --stage artifacts --json` runs
- **THEN** `.claude/metrics/snapshots/review-artifacts-x-20261125-120000.json` holds those five files, each with its path, text and SHA-256, and names the change `x` and the findings file
- **AND** the output carries `snapshot.written` `true` and `snapshot.path` naming that file

#### Scenario: Edge case — no snapshot without an artifact stage or a findings path

- **WHEN** the gate runs without `--stage artifacts`, without `--metrics`, or with `--findings -`
- **THEN** no snapshot is written and the output carries no `snapshot` field, as a code-review gate line's output does today

#### Scenario: Edge case — a change that does not resolve

- **GIVEN** `--metrics y`, where no change `y` exists, and `--stage artifacts`
- **WHEN** the gate runs
- **THEN** `snapshot.written` is `false` and `snapshot.reason` names the change it could not resolve

### Requirement: A snapshot that cannot be written SHALL be reported and SHALL move no verdict

A failed snapshot write SHALL print one warning on standard error naming the reason, and set `snapshot.written` to `false` with that reason. `passed`, every other output field and the exit code SHALL be what the gate gives with no snapshot.

#### Scenario: Failure — the snapshot directory cannot be written

- **GIVEN** a gate line that would write a snapshot, where `snapshots/` cannot be created
- **WHEN** the gate runs over findings holding one blocker
- **THEN** standard error carries one warning naming the snapshot and the reason
- **AND** the output's `passed` is `false`, `snapshot.written` is `false`, and the exit code is the blocked gate's

### Requirement: The readers of the metrics directory SHALL not read a snapshot as a record or a findings file

A snapshot SHALL live where the report digest, the checkpoint card and the spec meter do not read it.

#### Scenario: Edge case — the report and the checkpoint ignore snapshots

- **GIVEN** a metrics directory holding one review-metrics record, one findings file and its snapshot
- **WHEN** `interlock report` and `interlock checkpoint x` run
- **THEN** the report's record count and its unrecognized count are what they are with the snapshot removed
- **AND** the checkpoint card names the findings file, not the snapshot

### Requirement: Under `--since` the brief SHALL print what changed since the earlier gate's snapshot

When the snapshot beside the `--since` findings file can be read and names the same change, `interlock review brief --artifacts <change> --since <file>` SHALL print a `Changed since <file>` data block, framed as every data block is, as the first data block, after every selected lens. The block holds each changed file's hunks, each naming the current file's range of its changed lines with its context outside it, names each added or removed file, and lists the unchanged files by name.

#### Scenario: Edge case — the block keeps the brief's part order

- **GIVEN** a readable snapshot of change `x`, an edit since it, and one selected lens
- **WHEN** the brief runs with `--since` that findings file
- **THEN** the `Changed since` block follows the bundled re-gate rules and the lens, and precedes the `REVIEW.md` prose and every other quoted data block
- **AND** the run rules and the emit shape follow the `Changed since` block

#### Scenario: Happy path — one edited section

- **GIVEN** a snapshot of change `x` and a later edit that rewrites lines 40–44 of `design.md`, with every other file unchanged
- **WHEN** the brief runs with `--since` that findings file
- **THEN** the `Changed since` block holds one hunk for `design.md` naming lines 40–44 of the current file as its changed lines, with the removed and added lines marked
- **AND** the hunk's context lines are printed, marked unchanged, and lie outside the named range
- **AND** it lists `proposal.md`, `tasks.md`, `decisions.md` and `specs/a/spec.md` as unchanged

#### Scenario: Edge case — a removal only

- **GIVEN** a snapshot of `x`, after which lines 10–12 of `design.md` are deleted and nothing is added
- **WHEN** the brief runs with `--since`
- **THEN** the block holds one hunk naming the snapshot's lines 10–12 as removed, and naming the current line it follows as `after line 9`

#### Scenario: Edge case — a file added and a file removed

- **GIVEN** a snapshot of `x`, after which `specs/b/spec.md` is added and `decisions.md` is deleted
- **WHEN** the brief runs with `--since`
- **THEN** the block names `specs/b/spec.md` as added, with its whole text as one hunk, and names `decisions.md` as removed

#### Scenario: Edge case — nothing changed

- **GIVEN** a snapshot identical to the change
- **WHEN** the brief runs with `--since`
- **THEN** the opening block says nothing changed since that gate, and the block lists every file as unchanged

### Requirement: The `RE-GATE:` line SHALL state the rework share against the snapshot

With a readable snapshot, the opening block's `RE-GATE: since <file>` line SHALL state the rework share as a whole percentage: the larger of lines added and lines removed, over the larger of the snapshot's and the change's line totals. It SHALL also give the added and removed counts and how many files changed.

#### Scenario: Happy path — the share is stated

- **GIVEN** a snapshot of 400 lines and a change of 410 lines, with 20 lines added and 10 removed
- **WHEN** the brief runs with `--since`
- **THEN** the `RE-GATE:` line states `5%`, `20` added, `10` removed and one changed file

### Requirement: A rework share over the published bound SHALL be said, and SHALL not widen the re-gate

When the rework share is over the bound `interlock limits` publishes for a re-gate, the opening block SHALL add a `RE-GATE REWORK:` line naming the share and the bound, and saying that a full gate is the owner's call. The brief SHALL still carry only the scoped re-gate rules and the changed hunks, and nothing SHALL start a full gate.

#### Scenario: Happy path — a large rework is named, not acted on

- **GIVEN** a change whose rework share against its snapshot is over the published bound
- **WHEN** the brief runs with `--since`
- **THEN** the opening block holds a `RE-GATE REWORK:` line naming the share and the bound
- **AND** the brief still carries the re-gate rules and the `Changed since` block, and no instruction to read the whole change

#### Scenario: Edge case — the bound lives in the limits surface

- **WHEN** `interlock limits --json` runs
- **THEN** it carries the re-gate rework bound, and no skill, rubric or lens file restates its value

### Requirement: With no usable snapshot the re-gate SHALL fall back to git scoping, and SHALL say so

When no snapshot exists beside the `--since` file, or it cannot be parsed, has another schema, or names another change, the `RE-GATE:` line SHALL say which of these happened and that the re-gate rules' git scoping applies. The brief SHALL print no `Changed since` block, and SHALL not exit non-zero on this account.

#### Scenario: Failure — a findings file from before snapshots existed

- **GIVEN** a `--since` findings file with no snapshot beside it
- **WHEN** the brief runs
- **THEN** the `RE-GATE:` line says there is no snapshot and that git scoping applies, and the brief exits 0 with the re-gate rules in it

#### Scenario: Failure — a snapshot of another change

- **GIVEN** a snapshot beside the `--since` file that names change `y`, while the brief is for `x`
- **WHEN** the brief runs
- **THEN** the `RE-GATE:` line names the mismatch, git scoping applies, and no hunk from `y` is printed

### Requirement: The bundled re-gate rules SHALL scope new findings to the printed hunks first and to git only as the fallback

The re-gate rules SHALL tell the reader to raise a new finding only in a hunk the `Changed since` block lists when the brief carries one. They SHALL tell it to use the git scoping only when the `RE-GATE:` line says no snapshot could be used. Re-checking each earlier blocker SHALL stay the first step.

#### Scenario: Happy path — the rules name both scopes

- **WHEN** the shipped `skills/review-artifacts/re-gate.md` is read
- **THEN** it carries `Re-check each earlier blocker`, `Changed since`, `changed hunk`, `RE-GATE:` and the `git diff -- openspec/changes/<change>/` fallback, and a test pins those tokens
