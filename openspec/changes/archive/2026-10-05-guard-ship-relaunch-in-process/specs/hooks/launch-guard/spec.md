## ADDED Requirements

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

## MODIFIED Requirements

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
