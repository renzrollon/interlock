# hooks/launch-guard Specification

## Purpose

Denies a second `/interlock:ship` launch in one session when no human prompt has arrived since the previous launch, so the one recorded twenty-agent relaunch mistake is bounded by the host and not only by the skill's prose.

## Requirements

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

The plugin manifest SHALL register the settings form of the guard under `PreToolUse` and `PostToolUse` with a matcher naming the Workflow tool, and under `UserPromptSubmit` and `UserPromptExpansion`. A test SHALL spawn that guard as a child process with each event on stdin, built from payloads captured from the host and pinned as fixtures, and SHALL assert all four registrations; a dropped registration or a renamed payload field SHALL fail that test. The in-process form SHALL be tested through the engine's own plugin test kit, with every case of the settings form's deny and allow table repeated against the hooks module, and SHALL not be registered in the manifest's `hooks`. The skill's sentence and its existing token pin SHALL be unchanged by either form, and both forms SHALL quote it through the one rule module.

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
- **AND** both forms' deny reasons quote that sentence through the same constant

#### Scenario: Happy path — the in-process form repeats the table under the kit

- **GIVEN** the hooks module and the plugin test kit
- **WHEN** `claude plugin test .` runs
- **THEN** the first launch, the second without a prompt, the second after a human prompt, the wake between, the resume, the non-ship script, the refused launch and the throwing hook are each exercised
- **AND** `hooks/hooks.json` is the only place the module is named

### Requirement: The launch rule SHALL live in one Node-free module that both forms of the guard read

What identifies a ship launch, what counts as an accepted launch, what counts as a human prompt, the skill sentence the deny quotes, the deny's words and the decision over a record of launches and the last human prompt SHALL be defined once, in a module that imports nothing from `node:` and can therefore be imported by the hooks module as well as by the settings hook. The file-ledger module SHALL keep only the file transport and SHALL re-export the rule unchanged, so one function decides in both forms and one string is pinned for both.

#### Scenario: Happy path — one rule, two transports

- **GIVEN** the rule module and the file-ledger module
- **WHEN** the rule test imports a decision function from each
- **THEN** they are the same function
- **AND** the rule module's source names no `node:` import

#### Scenario: Failure — a Node import in the rule fails the test

- **GIVEN** the rule module with `import { readFileSync } from 'node:fs'` added
- **WHEN** the rule test runs
- **THEN** it fails naming the import
- **AND** the hooks module pin fails for the same reason, because it walks the module's imports

#### Scenario: Edge case — a plain record and a read ledger decide alike

- **GIVEN** a record `{ launches: [one launch at T], lastHumanPromptAt: null }` built in memory, and the same facts read from a ledger file
- **WHEN** the decision runs over each with the same clock and the same published age
- **THEN** both deny with the same reason text
- **AND** both allow once the launch is older than the published age

### Requirement: An in-process guard SHALL deny a second ship launch from the engine's own prompt origin

On a host that loads the plugin's hooks module, a Workflow tool call that is a ship launch — its script path ends in `workflows/ship.js`, its name is the plugin's ship command, or it resumes a run this session recorded by run id or persisted script path — SHALL be denied before it runs when the session recorded a launch newer than its last human prompt, including every launch when no human prompt was recorded. A human prompt SHALL be a submission whose origin the engine stamped as the person's own Enter, the Remote Control bridge, or the SDK host's turn; a background task's notification, a scheduled trigger, a peer session, a channel, a coordinator, an observer and a plugin's own submission SHALL never count. The deny SHALL carry the same words the settings form prints, and the engine SHALL hand them to the model as the tool's error text. An allowed launch whose result says it launched SHALL be recorded with its time, run id, workflow name and persisted script path. No prompt SHALL be rewritten or dropped by the guard.

#### Scenario: Happy path — a second launch with no prompt between is denied

- **GIVEN** a session in which one ship launch was recorded and no human prompt since
- **WHEN** the session issues another Workflow call whose `name` is `interlock:ship`
- **THEN** the hook returns a deny whose reason contains `Leftover`, `not authorization` and `new message`
- **AND** the call never reaches the engine and no workflow starts

#### Scenario: Failure — a human prompt between two launches allows the second

- **GIVEN** a session in which one ship launch was recorded
- **WHEN** a prompt with origin `composer`, `bridge` or `sdk` is submitted and a ship launch follows
- **THEN** the launch is allowed and recorded
- **AND** the prompt's text reached the model unchanged

#### Scenario: Edge case — the completion wake, a schedule and a resume do not re-arm a launch

- **GIVEN** a session in which one ship launch was recorded with its run id and persisted script path
- **WHEN** a prompt with origin `task-notification`, `scheduled-trigger` or `peer` is submitted, then a Workflow call carrying `resumeFromRunId` equal to that run id, or `scriptPath` equal to that persisted path
- **THEN** the call is denied as a second launch
- **AND** the wake was passed on to the session with one debug-log line and nothing consumed

### Requirement: The in-process ledger SHALL be session state declared in the plugin's type contract

The in-process guard SHALL keep the last human prompt time and the list of recorded launches in the host's per-session state under the plugin's name, declared in a type contract the manifest names, so that `claude plugin validate` lists every key the module reads and writes and refuses an undeclared one. The state SHALL survive a reload of the module, SHALL be reset by `/clear`, `/resume` and `/branch`, and SHALL never be read from or written to the machine-wide store. A launch older than the published ledger age SHALL read as absent, exactly as it does in the file form.

#### Scenario: Happy path — the contract lists the two keys and validate agrees

- **GIVEN** the plugin's type contract and manifest
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** its `state reads:` and `state writes:` lines name the two keys under the plugin's name and no other
- **AND** the manifest's `types` path is the contract file

#### Scenario: Failure — an undeclared key is refused

- **GIVEN** the module writing a state key the contract does not declare
- **WHEN** `claude plugin validate . --strict` runs
- **THEN** it fails naming the key
- **AND** the pin test fails before any session loads the module

#### Scenario: Edge case — a cleared session, and an aged launch

- **GIVEN** a session that recorded a ship launch and no prompt since
- **WHEN** `/clear` runs and a ship launch follows, or the published age passes and a ship launch follows
- **THEN** each launch is allowed
- **AND** the machine-wide store was never consulted

### Requirement: Which form of the guard is active SHALL be stated, and the in-process deny SHALL preempt the settings form

The settings-hook form SHALL remain the only enforcement on a host below the mods floor or where user mods are stopped, and its behaviour there SHALL be unchanged. On a host that loads the hooks module the in-process guard SHALL run first: its deny SHALL end the call before the settings hook sees it, and its allow SHALL fall through to the settings hook. A hook that throws SHALL be skipped so the launch proceeds to the settings hook's own decision. The guards documentation SHALL name both forms, where each is active, the one way their readings differ (a prompt from a peer or a schedule counts to the settings form and not to the in-process form), and that retiring the settings registrations waits on the plugin's version floor.

#### Scenario: Happy path — the mod's deny is the only deny

- **GIVEN** a host that loads the module and a session with a recorded launch and no prompt since
- **WHEN** a ship launch is attempted
- **THEN** the in-process guard denies and the settings hook's process never starts
- **AND** the model receives one deny reason, not two

#### Scenario: Failure — a throwing hook lets the launch through to the settings form

- **GIVEN** a host that loads the module, with the state read made to throw
- **WHEN** a ship launch is attempted
- **THEN** the in-process hook is skipped and the launch proceeds to the settings hook
- **AND** the settings hook decides from its own file ledger as it does today

#### Scenario: Edge case — a host below the floor

- **GIVEN** a `claude` below the mods floor
- **WHEN** a second ship launch without a prompt is attempted
- **THEN** the settings form denies with the same words
- **AND** `interlock doctor`'s `mods` row says the hooks module does not load there
