# Spec Delta

## Purpose

Gives the artifact gate two depths: the inline lean read the session performs on its own artifacts, and a strict read by one independent reviewer routed by role, so an unanchored read is a flag the person chooses rather than an improvised spawn.

## ADDED Requirements

### Requirement: The artifact gate SHALL run at the depth the CLI answers, inline when lean and through one routed reviewer when strict

`/interlock:review-artifacts <change> [--strict]` SHALL read its depth from one `interlock routing artifact-reviewer --json` call (`--depth strict` under `--strict`) and print `GATE DEPTH: <depth>` from the answer. Lean: the session reviews the artifacts itself and spawns nothing. Strict: it spawns one independent reviewer, with the answer's `model` and `effort`, in place of its own read. The skill SHALL name no model, effort or default depth.

#### Scenario: Happy path — the default depth is the inline read

- **GIVEN** `/interlock:review-artifacts <change>` with no `--strict`
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
- **THEN** its gate line is `/interlock:review-artifacts <name> --strict`, and without the flag the line carries no depth

### Requirement: The strict reviewer SHALL be handed the skill's own review brief, SHALL write nothing, and SHALL answer with findings JSON

The strict reviewer's prompt SHALL be this skill's Reviewer 1, Reviewer 2 and Invariant check sections verbatim, the resolved artifact paths, the stack note, and the emit shape, and SHALL say that the reviewer may read and run read-only checks, writes no file, and replies with one JSON object in the emit shape and nothing else. The skill SHALL add no rubric of its own to the prompt.

#### Scenario: Happy path — the brief is the skill's sections

- **GIVEN** a strict gate
- **WHEN** the Agent call is made
- **THEN** its prompt contains the Reviewer 1, Reviewer 2 and Invariant check texts as the shipped skill carries them, the artifact paths the validate line resolved, and the emit shape with `dimension`, `findings`, `severity`, `file`, `title` and `description`
- **AND** it says the reviewer writes no file and replies with the JSON object alone

#### Scenario: Failure — the reviewer's reply is not the emit shape

- **GIVEN** a strict reviewer whose reply holds no JSON object with a `findings` array
- **WHEN** the skill reads the reply
- **THEN** it prints `STRICT REVIEW UNREAD:` followed by the reply's first line, reviews the artifacts in the session as the lean depth does, and the gate still runs once

#### Scenario: Edge case — a clean strict read

- **GIVEN** a strict reviewer whose reply is `{ "dimension": "artifacts", "findings": [] }`
- **WHEN** the skill reads it
- **THEN** the findings file it writes holds that empty list, the gate passes, and the spec skill's autonomy line is the clean one

### Requirement: The skill, not the reviewer, SHALL write the findings file and run the gate line at both depths

At either depth the session SHALL write `.claude/metrics/review-artifacts-<change>-<timestamp>.json` from the findings as returned, repairing no finding, and SHALL run `interlock gate --findings <that file> --metrics <change> --json` itself, so the emit contract, the gate's verdict, the metrics record and the autonomy record are the same at both depths.

#### Scenario: Happy path — strict findings reach the same gate line

- **GIVEN** a strict reviewer that returns two warnings and one blocker
- **WHEN** the skill continues
- **THEN** the session writes the findings file with those three findings, runs the gate line with `--metrics`, and the gate blocks on the blocker

#### Scenario: Failure — a malformed finding is the gate's to report

- **GIVEN** a strict reviewer that returns a finding with no `file`
- **WHEN** the skill writes the file as returned and runs the gate
- **THEN** the gate reports that finding under `malformed` and the skill neither fills the field nor drops the finding

#### Scenario: Edge case — the spec meter counts the spawn and reads the write

- **GIVEN** a live spec run whose gate runs strict
- **WHEN** the Agent call and the session's Write of the findings file cross
- **THEN** the spec pane counts one spawn and shows the findings file among the writes, and the routing line passes through unread
