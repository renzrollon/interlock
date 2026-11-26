# artifact-gate-depth Specification

## Purpose

Gives the artifact gate two depths: the inline lean read the session performs on its own artifacts, and a strict read by one independent reviewer routed by role, so an unanchored read is a flag the person chooses rather than an improvised spawn.

## Requirements

### Requirement: The artifact gate SHALL run at the depth the CLI answers, inline when lean and through one routed reviewer when strict

`/interlock:review-artifacts <change> [--strict | --lean] [--caller spec] [--lens <a,b>]` SHALL read its depth from one `interlock routing artifact-reviewer --json` call. The call SHALL add `--depth strict` under `--strict`, `--depth lean` under `--lean`, and `--caller spec` when `/interlock:spec` passed it. The skill SHALL print `GATE DEPTH: <depth>` from the answer. Lean: the session reviews the artifacts itself and spawns nothing. Strict: it spawns one independent reviewer, with the answer's `model` and `effort`, in place of its own read. The skill SHALL name no model, effort or default depth. Given both `--strict` and `--lean`, the skill SHALL run strict and SHALL print that it ignored `--lean`. `/interlock:spec` SHALL pass `--caller spec` on its gate line every time, and SHALL pass `--strict`, `--lean` and `--lens <a,b>` through when it was given them.

#### Scenario: Happy path — the default depth is the inline read

- **GIVEN** `/interlock:review-artifacts <change>` with no `--strict`, no `--lean` and no `--caller`
- **WHEN** the skill runs
- **THEN** it runs `interlock routing artifact-reviewer --json` once, prints `GATE DEPTH:` with the depth that call answered, reviews the artifacts in the session, and spawns no agent

#### Scenario: Happy path — strict spawns one reviewer in place of the inline read

- **GIVEN** `/interlock:review-artifacts <change> --strict`
- **WHEN** the skill runs
- **THEN** it runs `interlock routing artifact-reviewer --depth strict --json` once, prints `GATE DEPTH: strict`, and makes exactly one Agent call carrying that answer's `model` and `effort`
- **AND** the session performs no review of its own beside the reviewer's

#### Scenario: Failure — routing fails and the strict read still happens

- **GIVEN** `--strict` and an `interlock routing artifact-reviewer --depth strict --json` that exits non-zero
- **WHEN** the skill reaches its depth section
- **THEN** it prints `ROUTING UNAVAILABLE:` followed by the command's first output line, prints `GATE DEPTH: strict`, and spawns the reviewer at the session defaults
- **AND** the gate proceeds

#### Scenario: Edge case — the spec skill passes the flag through

- **GIVEN** `/interlock:spec <intent> --strict`
- **WHEN** the spec skill reaches its gate step
- **THEN** its gate line is `/interlock:review-artifacts <name> --caller spec --strict`
- **AND** under `--lean` the line is `/interlock:review-artifacts <name> --caller spec --lean`, and with neither flag the line carries `--caller spec` and no depth flag

#### Scenario: Happy path — spec's own gate reads independently by default

- **GIVEN** `/interlock:spec <intent>` with no depth flag, and a published caller depth of `strict` for `artifact-reviewer` called by `spec`
- **WHEN** the gate runs
- **THEN** its routing line is `interlock routing artifact-reviewer --caller spec --json`, it prints `GATE DEPTH: strict`, and it makes exactly one Agent call naming `interlock:reviewer`

#### Scenario: Edge case — `--lean` returns spec's gate to the inline read

- **GIVEN** `/interlock:spec <intent> --lean`
- **WHEN** the gate runs
- **THEN** its routing line carries `--depth lean`, it prints `GATE DEPTH: lean`, and it spawns no agent

#### Scenario: Edge case — both depth flags given

- **GIVEN** `/interlock:review-artifacts <change> --strict --lean`, or `/interlock:spec <intent> --strict --lean`, whose gate line then carries both
- **WHEN** the gate reaches its depth section
- **THEN** it prints that it ignored `--lean`, runs `interlock routing artifact-reviewer` with `--depth strict` and without `--depth lean`, prints `GATE DEPTH: strict`, and makes one Agent call

#### Scenario: Edge case — spec passes a lens list through

- **GIVEN** `/interlock:spec <intent> --lens web-ui`
- **WHEN** the spec skill reaches its gate step
- **THEN** its gate line is `/interlock:review-artifacts <name> --caller spec --lens web-ui`, and the gate's brief line carries `--lens web-ui`

### Requirement: The skill, not the reviewer, SHALL write the findings file and run the gate line at both depths

At either depth the session SHALL write `.claude/metrics/review-artifacts-<change>-<timestamp>.json` from the findings as returned, repairing no finding. It SHALL then run `interlock gate --findings <that file> --metrics <change> --stage artifacts --depth <depth> --reviewer <reader> --lenses <names> --json` itself. The emit contract, the gate's verdict, the metrics record and the autonomy record are therefore the same at both depths. `<depth>` SHALL be the depth `GATE DEPTH:` printed, and the flag SHALL be left out when no depth line was printed. `<reader>` SHALL be `agent` when the strict reviewer's findings are the input and `session` otherwise. `<names>` SHALL be the lenses the brief's `REVIEW LENSES:` line names, comma-separated, or `none`. After `ARTIFACT BRIEF UNAVAILABLE` it SHALL be `none`, because the inline read reads no lens file. A gate line whose output carries no `passed` field has given no verdict. When that output carries `unknownFlag`, an older CLI refused a flag it does not know (it exits 2 and prints `error` and `unknownFlag`). The skill SHALL then print `GATE UNAVAILABLE: <the output's error>`, run the same line once more without `--stage`, `--depth`, `--reviewer` and `--lenses`, and read that run's verdict. Any other output without `passed`, and a rerun without `passed`, SHALL be printed as `GATE UNAVAILABLE: <first line of the output>`. The skill SHALL then run no further gate line and SHALL stop as it does on a blocker, reporting that the gate gave no verdict. The spec skill SHALL then write no `interlock autonomy` line, because the output holds no `autonomyOutcome.blockers` to read.

#### Scenario: Happy path — strict findings reach the same gate line

- **GIVEN** a strict reviewer that returns two warnings and one blocker
- **WHEN** the skill continues
- **THEN** the session writes the findings file with those three findings, runs the gate line with `--metrics`, `--stage artifacts`, `--depth strict` and `--reviewer agent`, and the gate blocks on the blocker

#### Scenario: Failure — a malformed finding is the gate's to report

- **GIVEN** a strict reviewer that returns a finding with no `file`
- **WHEN** the skill writes the file as returned and runs the gate
- **THEN** the gate reports that finding under `malformed` and the skill neither fills the field nor drops the finding

#### Scenario: Edge case — the spec meter counts the spawn and reads the write

- **GIVEN** a live spec run whose gate runs strict
- **WHEN** the Agent call and the session's Write of the findings file cross
- **THEN** the spec pane counts one spawn and shows the findings file among the writes, and the routing line passes through unread

#### Scenario: Edge case — a strict depth read inline is recorded as a session read

- **GIVEN** a strict gate that printed `STRICT REVIEWER UNAVAILABLE:` or `STRICT REVIEW UNREAD:` and read the artifacts in the session
- **WHEN** the skill runs the gate line
- **THEN** the line carries `--depth strict --reviewer session`, so the record shows that the depth asked for and the reader who read differ

#### Scenario: Failure — an older CLI refuses a recording flag

- **GIVEN** an `interlock` on PATH whose `gate` refuses `--stage` by name, exiting 2 with `{ "error": "unknown flag --stage for interlock gate …", "unknownFlag": "--stage" }` and no `passed`
- **WHEN** the skill runs its gate line
- **THEN** it prints `GATE UNAVAILABLE:` followed by that `error`, runs the line once more without the four recording flags, and reads `passed`, `blockers` and `autonomyOutcome.blockers` from the second run
- **AND** it never reads the refusal's exit status as a blocked gate

#### Scenario: Failure — the gate cannot read its findings file

- **GIVEN** a gate line whose findings file cannot be read, so `interlock gate` exits 1 with nothing on standard output
- **WHEN** the skill reads the output
- **THEN** it prints `GATE UNAVAILABLE:` followed by the output's first line, runs no second gate line, and reports that the gate gave no verdict
- **AND** the spec skill writes no `interlock autonomy` line and stops at the checkpoint, saying the gate gave no verdict

### Requirement: Both depths SHALL read the brief the CLI prints, and the strict reviewer SHALL be handed it verbatim

At either depth the skill SHALL run `interlock review brief --artifacts <change>` once, with `--lens` and `--since` when it was given them, and print the brief's opening block verbatim. Lean: the session performs the review the brief describes. Strict: the one Agent call's prompt is the printed brief, verbatim, and the skill adds nothing to it. A reply holding no JSON object with a `findings` array SHALL be printed as `STRICT REVIEW UNREAD:` and read inline instead.

#### Scenario: Happy path — both depths read the printed brief

- **GIVEN** a lean gate and a strict gate of the same change
- **WHEN** each reaches its review
- **THEN** each runs `interlock review brief --artifacts <change>` once and prints the brief's opening block, every line before its first blank line, verbatim
- **AND** the strict gate's Agent call carries the printed brief as its whole prompt, and the lean session reviews against that same text

#### Scenario: Edge case — the lean read ends in the skill's own write

- **GIVEN** a lean gate whose brief's run rules say the reader writes no file
- **WHEN** the session finishes its read
- **THEN** it composes the reply object those rules name and writes the findings file from it in the skill's emit step, as the requirement that the skill writes the findings file at both depths says, and the rules bind only the read

#### Scenario: Failure — the reviewer's reply is not the emit shape

- **GIVEN** a strict reviewer whose reply holds no JSON object with a `findings` array
- **WHEN** the skill reads the reply
- **THEN** it prints `STRICT REVIEW UNREAD:` followed by the reply's first line, reviews the artifacts in the session against the printed brief, and the gate still runs once

#### Scenario: Edge case — a clean strict read

- **GIVEN** a strict reviewer whose reply is `{ "dimension": "artifacts", "findings": [] }`
- **WHEN** the skill reads it
- **THEN** the findings file it writes holds that empty list, the gate passes, and the spec skill's autonomy line is the clean one

#### Scenario: Edge case — the skill adds no rubric of its own

- **GIVEN** the shipped `skills/review-artifacts/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** the skill holds no Reviewer 1, Reviewer 2 or Invariant check section of its own, and its strict prompt is named as the printed brief alone

### Requirement: When the brief cannot be printed the gate SHALL still run once, inline, on the bundled base rubric

When `interlock review brief --artifacts` exits non-zero, the skill SHALL print `ARTIFACT BRIEF UNAVAILABLE: <first line of its output>`. It SHALL spawn no reviewer at either depth, SHALL read the bundled base rubric (and, under `--since`, the bundled re-gate rules) and the artifacts in the session, and SHALL run the gate line with `--reviewer session --lenses none`. An older CLI or a broken install therefore degrades aloud, and the gate still runs once.

#### Scenario: Failure — an older CLI has no artifact brief

- **GIVEN** an `interlock` on PATH whose `review brief` refuses `--artifacts`
- **WHEN** the gate reaches its brief line
- **THEN** it prints `ARTIFACT BRIEF UNAVAILABLE:` followed by the command's first output line, makes no Agent call, reads the bundled base rubric in the session, and its gate line carries `--reviewer session --lenses none`

#### Scenario: Edge case — the fallback at the strict depth

- **GIVEN** a gate whose routing answered `strict` and whose brief line exits non-zero
- **WHEN** the gate continues
- **THEN** it has printed `GATE DEPTH: strict`, it makes no Agent call, and its gate line carries `--depth strict --reviewer session`
