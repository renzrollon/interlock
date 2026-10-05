## Purpose

Denies a second `/interlock:ship` launch in one session when no human prompt has arrived since the previous launch, so the one recorded twenty-agent relaunch mistake is bounded by the host and not only by the skill's prose.

## ADDED Requirements

### Requirement: A second ship launch without a human prompt since the last SHALL be denied

A `PreToolUse` guard on the Workflow tool SHALL deny a ship launch — a call whose script path ends in `workflows/ship.js`, whose name is the plugin's ship command, or that resumes a ship run the session's ledger recorded (by its run id or its persisted script path) — when the session's launch ledger records a launch later than the last recorded human prompt, including every launch when no human prompt has been recorded at all. The deny SHALL use the host's `PreToolUse` deny shape, and its reason SHALL quote the skill's sentence that leftover boxes are a report and not authorization to call Workflow again, and SHALL name the remedy: a new message asking to ship the leftovers, or `/interlock:ship` typed again. A launch after a recorded human prompt SHALL be allowed, and the first launch in a session SHALL be allowed.

#### Scenario: Happy path — a second launch with no prompt between is denied

- **GIVEN** a session whose ledger records one ship launch and no human prompt after it
- **WHEN** the session issues another ship launch
- **THEN** the guard returns a deny whose reason contains `Leftover`, `not authorization` and `new message`
- **AND** no workflow starts

#### Scenario: Failure — a launch after a human prompt is allowed

- **GIVEN** a session whose ledger records one ship launch and a human prompt recorded after it
- **WHEN** the session issues another ship launch
- **THEN** the guard allows the call and emits no decision

#### Scenario: Edge case — the resume the completion wake suggests is a launch

- **GIVEN** a session whose ledger records one ship launch with its run id and persisted script path, and no human prompt after it
- **WHEN** the session issues a Workflow call carrying that persisted `scriptPath` and `resumeFromRunId` set to that run id
- **THEN** the guard denies it as a second launch

#### Scenario: Edge case — the first launch, a single launch inside one prompt, and a non-ship workflow

- **GIVEN** a session with no ledger, or `/interlock:spec --continue` launching ship once inside one human prompt, or a Workflow call whose script is not the ship script
- **WHEN** the guard evaluates the call
- **THEN** it allows each of them
- **AND** records a launch only for the ship launches

### Requirement: The launch ledger SHALL be per session, created only by an accepted launch, and bounded by a published age

The ledger SHALL live at a path derived from the session identifier under `.claude/ship/launch-ledger/`, and the identifier SHALL be admitted as a filename only when it is a safe id. Only a `PostToolUse` event for a ship launch the runtime accepted SHALL create the ledger or record a launch; a response that reports an error SHALL record nothing. A prompt event SHALL record the time of a human prompt only when a ledger for its session already exists, and SHALL create no file or directory otherwise. A prompt whose text is a background task's completion notification is not a human prompt and SHALL record nothing. The ledger's lifetime SHALL be a cap stated once in the limits module and printed by `interlock limits`: a ledger whose newest launch is older than the cap SHALL read as absent, and a write SHALL remove sibling ledgers older than the cap.

#### Scenario: Happy path — an accepted launch creates the ledger

- **GIVEN** a session with no ledger
- **WHEN** a `PostToolUse` event reports an accepted ship launch for that session
- **THEN** a ledger file named by the session exists and records the launch's time and the identity the response carried

#### Scenario: Failure — a refused launch is not recorded

- **GIVEN** a session with no ledger
- **WHEN** a `PostToolUse` event reports a ship launch whose response is an error
- **THEN** no ledger is created
- **AND** the next ship launch in that session is allowed

#### Scenario: Edge case — a prompt without a ledger writes nothing

- **GIVEN** a session with no ledger, in a repository with no `.claude/ship/` directory
- **WHEN** a `UserPromptSubmit` event arrives for that session
- **THEN** no file and no directory is created

#### Scenario: Edge case — the completion wake is not a human prompt

- **GIVEN** a session whose ledger records one ship launch and no human prompt after it
- **WHEN** a `UserPromptSubmit` event arrives whose prompt begins with `<task-notification>`
- **THEN** the ledger's last human prompt is unchanged
- **AND** the next ship launch in that session is denied

#### Scenario: Edge case — a ledger past the published age reads as absent and is swept

- **GIVEN** a ledger whose newest launch is older than the cap `interlock limits` prints as the launch ledger's maximum age
- **WHEN** a ship launch is evaluated and a write occurs
- **THEN** the launch is allowed as if no ledger existed
- **AND** the stale file is removed by the write

### Requirement: Every unknown SHALL allow, and only the launch branch may deny

The guard SHALL allow when the event carries no session identifier or an unsafe one, when the ledger is missing, unreadable or malformed, when the tool input is not recognised as a ship launch, when the tool is not the Workflow tool, and when the guard itself throws, writing a diagnostic to its error stream on the crash path. The `PostToolUse` and prompt branches SHALL print no decision on any path. A host that never fired a prompt event for a session SHALL be read as a session with no human prompt recorded, never as an error.

#### Scenario: Happy path — a missing session identifier allows

- **GIVEN** a ship launch event with no `session_id`
- **WHEN** the guard evaluates it
- **THEN** it allows and records nothing

#### Scenario: Failure — a malformed ledger allows with a note

- **GIVEN** a ledger file for the session that is not valid JSON
- **WHEN** a ship launch is evaluated
- **THEN** the guard allows, writes a note to its error stream, and exits 0

#### Scenario: Edge case — a crash allows, and a different session is unaffected

- **GIVEN** a guard body made to throw, or a ledger recording a launch for session `A`
- **WHEN** the guard evaluates a launch in session `A` while throwing, or a launch in session `B`
- **THEN** both calls are allowed
- **AND** the crash path names the error on the error stream

### Requirement: The guard SHALL be registered on four events and tested as a process

The plugin manifest SHALL register the guard's command under `PreToolUse` and `PostToolUse` with a matcher naming the Workflow tool, and under `UserPromptSubmit` and `UserPromptExpansion`. A test SHALL spawn the guard as a child process with each event on stdin, built from payloads captured from the host and pinned as fixtures, and SHALL assert all four registrations; a dropped registration or a renamed payload field SHALL fail that test. The skill's sentence and its existing token pin SHALL be unchanged by this guard.

#### Scenario: Happy path — all four registrations name the guard

- **GIVEN** the plugin manifest
- **WHEN** the registration test reads it
- **THEN** `PreToolUse` and `PostToolUse` each carry a `Workflow` matcher whose command names the guard script
- **AND** `UserPromptSubmit` and `UserPromptExpansion` each carry a command naming the guard script

#### Scenario: Failure — a dropped registration fails the test

- **GIVEN** a manifest from which the `PostToolUse` registration has been removed
- **WHEN** the registration test runs
- **THEN** it fails naming the missing event

#### Scenario: Edge case — the prose is untouched

- **GIVEN** `skills/ship/SKILL.md` and `test/skills.test.mjs` after this change
- **WHEN** the skill tests run
- **THEN** the sentence forbidding a second Workflow call and its token pin are unchanged
- **AND** the guard's deny reason quotes that sentence
