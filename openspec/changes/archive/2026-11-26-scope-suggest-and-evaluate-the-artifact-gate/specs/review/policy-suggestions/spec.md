# Spec Delta

## Purpose

Finds the evidence that a repository's `REVIEW.md` is due a new or retired line, from the review records the repository already keeps. The owner reads it and decides, and nothing here writes the policy file.

## ADDED Requirements

### Requirement: `interlock review-policy suggest` SHALL list candidate policy lines with their evidence, and SHALL write nothing

`interlock review-policy suggest [--all] [--summary] [--json]` SHALL print each candidate with the trigger that raised it and the evidence behind it. It SHALL also print the stale and the unquoted Artifact Checks, and one status line per evidence source. It SHALL write no file, and it SHALL exit 0 whatever it finds.

#### Scenario: Happy path — a candidate and its evidence

- **GIVEN** two compound-note rows for `lib/widget.mjs` from two different changes, inside the evidence window
- **WHEN** `interlock review-policy suggest --json` runs
- **THEN** `candidates` holds one entry with `trigger` `T1`, `subject` `lib/widget.mjs`, and both rows as its evidence
- **AND** no file in the repository is created or changed

#### Scenario: Edge case — an empty repository

- **GIVEN** a repository with no compound notes file, no metrics directory, no archived change and no `REVIEW.md`
- **WHEN** the command runs
- **THEN** it exits 0 with no candidate and no stale check, and each source's status line says what it found absent

### Requirement: Evidence SHALL count only since `REVIEW.md` last changed at HEAD, unless `--all` widens it

The evidence window SHALL open at the commit time of the newest commit at HEAD that changed `REVIEW.md`. Dated evidence SHALL count when its date falls on or after that day, and timestamped evidence when it is at or after that time. With `--all`, or when no commit at HEAD changed `REVIEW.md`, the window SHALL be open. The output SHALL name the window.

#### Scenario: Happy path — evidence older than the policy's last change is left out

- **GIVEN** `REVIEW.md` last changed at HEAD on 2026-11-25, and compound-note rows dated 2026-11-20 and 2026-11-26
- **WHEN** the command runs
- **THEN** only the 2026-11-26 row is read as evidence, and the output names the window's start and the commit
- **AND** with `--all`, both rows are read and the window is named as open

#### Scenario: Edge case — no commit to anchor the window

- **GIVEN** a repository whose HEAD names no commit, or whose history never touched `REVIEW.md`
- **WHEN** the command runs
- **THEN** the window is open, and the output says why

### Requirement: T1 SHALL be a file that escaped the spec in several changes

Compound-note rows SHALL be grouped by their canonical `file`. A group whose rows come from at least the published number of distinct changes SHALL be a `T1` candidate, with every row in the group as its evidence. Rows that cannot be parsed SHALL be counted on the notes status line.

#### Scenario: Failure — one change's escapes do not promote a file

- **GIVEN** three rows for `test/retired-names.test.mjs`, all from one change
- **WHEN** the command runs with a published threshold above one change
- **THEN** no `T1` candidate names that file

### Requirement: Review-metrics records SHALL be joined to findings files by the path the record names

The command SHALL read the review-metrics records whose `stage` is `artifacts`, and the findings file each names in `findings`, as the record of one artifact gate. A record that names no findings file, or names one that cannot be read, SHALL be left out and counted on the records status line, never joined by name or time.

#### Scenario: Edge case — an older record is counted, not guessed

- **GIVEN** a record with no `findings` field, and a findings file whose name holds the same change and a time close to the record's
- **WHEN** the command runs
- **THEN** the two are not joined, and the records status line counts one record that names no findings file

### Requirement: T2 SHALL be a passed gate that a different reader later blocked

A change SHALL be one `T2` candidate when it holds a qualifying pair: a gate that passed, and the next later gate of that change holding a blocker, whose recorded depth or reader differs from the passed gate's. Its evidence SHALL list every qualifying pair in gate order, each naming both findings files, both readers and the later gate's blocker titles. A pair where either reader is unrecorded SHALL not qualify.

#### Scenario: Happy path — a strict read overturns a lean pass

- **GIVEN** change `x`'s `lean`/`session` gate with no blocker, then its `strict`/`agent` gate with one blocker
- **WHEN** the command runs
- **THEN** one `T2` candidate names `x`, both findings files, both readers and the blocker's title

#### Scenario: Edge case — several overturns are one candidate

- **GIVEN** change `x` gated by `lean`/`session` with no blocker, then `strict`/`agent` with a blocker, then `lean`/`session` with no blocker, then `strict`/`agent` with a blocker
- **WHEN** the command runs
- **THEN** one `T2` candidate names `x`, with two pairs as its evidence in gate order

#### Scenario: Failure — a re-gate by the same reader is not an overturn

- **GIVEN** two gates of `x` by `lean`/`session`, the first passing and the second blocking
- **WHEN** the command runs
- **THEN** no `T2` candidate names `x`

### Requirement: T3 SHALL be a blocker class that recurs across changes

Blockers in the joined findings that carry a `check` tag SHALL be grouped by tag. A tag on blockers from at least the published number of distinct changes SHALL be a `T3` candidate, naming each change, findings file and blocker title.

#### Scenario: Happy path — one lens question blocks two changes

- **GIVEN** blockers tagged `agentic-harness.2` in the gates of two changes
- **WHEN** the command runs with the published threshold at two changes
- **THEN** one `T3` candidate names `agentic-harness.2` and both changes

### Requirement: T4 SHALL be an owner ruling in an archived change's ledger

A row of an archived change's `decisions.md` whose evidence cites a human decision SHALL be a `T4` candidate, with the change, the row id, the question and the resolution. The archive directory's date SHALL date the row.

#### Scenario: Happy path — an owner's answer surfaces once its change is archived

- **GIVEN** `openspec/changes/archive/2026-11-26-x/decisions.md` holding a row whose evidence reads `human decision 2026-11-26`
- **WHEN** the command runs inside the window
- **THEN** one `T4` candidate names `x`, the row id, the question and the resolution

### Requirement: An Artifact Check that raised nothing over the published number of gates SHALL be listed as stale

Each `## Artifact Checks` item `REVIEW.md` holds at HEAD SHALL be read as `review-md.<n>`. Only items within `maxArtifactChecks`, the cap the brief quotes to, SHALL be judged, and the rest SHALL be listed under `unquoted`, never `stale`. When the window holds at least the published number of joined gates and none of their findings, at any severity, carries that tag, the item SHALL be listed under `stale`. With fewer gates, the output SHALL say stale was not judged and why.

#### Scenario: Happy path — a silent check is stale

- **GIVEN** two Artifact Checks at HEAD, and at least the published number of joined gates in the window, where only `review-md.1` was ever raised
- **WHEN** the command runs
- **THEN** `stale` names `review-md.2` with its text and the number of gates read

#### Scenario: Edge case — a check no brief quoted is not stale

- **GIVEN** more Artifact Checks at HEAD than `maxArtifactChecks`, and at least the published number of joined gates in the window
- **WHEN** the command runs
- **THEN** the checks past the cap are listed under `unquoted`, none of them is under `stale`, and the summary count leaves them out

#### Scenario: Edge case — too few gates to judge

- **GIVEN** fewer joined gates in the window than the published number
- **WHEN** the command runs
- **THEN** `stale` is empty, and the checks status line says stale was not judged, with the count of gates read

### Requirement: The suggestion thresholds SHALL be published by the limits surface

The distinct-change count for `T1` and `T3`, and the gate count for `stale`, SHALL be read from `interlock limits`. No skill or document SHALL restate their values.

#### Scenario: Happy path — the thresholds are published

- **WHEN** `interlock limits --json` runs
- **THEN** it carries both values, and the command reads them from there

### Requirement: `--summary` SHALL print one line when there is something to suggest, and nothing otherwise

With `--summary`, the command SHALL print exactly `REVIEW.md candidates: <n> — interlock review-policy suggest`, where `<n>` counts the candidates and the stale checks together. When `<n>` is 0 it SHALL print nothing, and in both cases it SHALL exit 0.

#### Scenario: Happy path — one line

- **GIVEN** two candidates and one stale check
- **WHEN** `interlock review-policy suggest --summary` runs
- **THEN** standard output is the one line `REVIEW.md candidates: 3 — interlock review-policy suggest`

#### Scenario: Edge case — nothing to suggest

- **GIVEN** no candidate and no stale check
- **WHEN** the command runs with `--summary`
- **THEN** standard output is empty and the exit code is 0

### Requirement: The spec skill's hand-off and the settle skill's close SHALL print the summary line

The spec skill's hand-off and the settle skill's closing report SHALL each run `interlock review-policy suggest --summary` once and print its output verbatim. A non-zero exit SHALL print `REVIEW POLICY SUGGEST UNAVAILABLE: <first line of its output>` and continue, because the line is advice and never a gate. Both lines SHALL be pinned by token.

#### Scenario: Happy path — the hand-off carries the line

- **WHEN** the shipped `skills/spec/SKILL.md` and `skills/settle/SKILL.md` are read
- **THEN** each carries a fenced `interlock review-policy suggest --summary` line and the token `REVIEW POLICY SUGGEST UNAVAILABLE:`, and a test pins both

#### Scenario: Failure — an older CLI refuses the flag

- **GIVEN** an `interlock` on PATH whose `review-policy` does not know `--summary`, and so exits non-zero
- **WHEN** either skill reaches the line
- **THEN** it prints `REVIEW POLICY SUGGEST UNAVAILABLE:` with the refusal's first line, and goes on to the rest of its hand-off

#### Scenario: Edge case — the meters stay as they were

- **GIVEN** the spec meter's and the settle meter's skill-lines pins
- **WHEN** the two new fenced lines are added
- **THEN** both pins pass, and a settle pass whose summary line follows its drift line keeps the end time the drift line set
