## MODIFIED Requirements

### Requirement: A session that ends during a live ship run SHALL leave an interrupted-run note

On the host's session-end event, when a fresh stage marker exists for a change and the run manifest for that change records the same session identifier as the event, the recorder SHALL write exactly one note under the `.claude/ship/interrupted/` directory of the state home the manifest records, or of the working root when the manifest records none, named by the run identifier, carrying the run identifier, the change, the session identifier, the host's end reason as given, the stage the marker held and the time, and SHALL record it as not yet spoken. The recorder SHALL read the state home from the manifest and SHALL NOT run version control to find it. With no marker, a marker whose process is no longer running, a manifest that names another session or none, or a manifest without a run identifier, the recorder SHALL create no file and no directory. The note is a pointer to records written elsewhere: the recorder MUST NOT write to the run trajectory, and a failed write MUST be reported on the hook's own error stream and MUST NOT change the hook's exit code.

#### Scenario: Happy path — a mid-run session end writes one note

- **GIVEN** a live stage marker for change `add-foo` at stage `implement` whose process is running, and a run manifest for `add-foo` recording run id `r-1` and session `sess-9`
- **WHEN** the recorder receives a session-end event for session `sess-9`
- **THEN** `.claude/ship/interrupted/r-1.json` exists and carries run id `r-1`, change `add-foo`, session `sess-9`, the event's reason, stage `implement` and a timestamp
- **AND** the note is marked not yet spoken

#### Scenario: Happy path — a linked-worktree run's note lands in the state home

- **GIVEN** the same marker and a manifest that additionally records state home `/r`, in a working root `/r/.claude/worktrees/w1`
- **WHEN** the recorder receives the session-end event for `sess-9`
- **THEN** the note is written at `/r/.claude/ship/interrupted/r-1.json` and not under the worktree
- **AND** the hook spawned no version-control process

#### Scenario: Failure — the session does not own the run

- **GIVEN** the same marker and a manifest recording session `sess-9`
- **WHEN** the recorder receives a session-end event for session `sess-other`
- **THEN** no note is written and `.claude/ship/interrupted/` is not created
- **AND** the hook exits 0

#### Scenario: Edge case — no live marker, no run identifier, or an orphaned marker

- **GIVEN** a root with no stage marker, or a marker whose process is no longer running, or a manifest without a run identifier
- **WHEN** the recorder receives a session-end event
- **THEN** no file and no directory is created
- **AND** the hook exits 0

#### Scenario: Edge case — the note cannot be written

- **GIVEN** a live marker and a matching manifest, and a `.claude/ship/interrupted/` path that cannot be created
- **WHEN** the recorder receives a session-end event
- **THEN** the hook writes the failure to its error stream
- **AND** exits 0, and the run trajectory is untouched

### Requirement: The recorder SHALL never block, and SHALL be registered and tested as a process

The recorder SHALL exit 0 on every path — a valid event, malformed input, an event name it has no branch for, and an unexpected throw inside the hook — and SHALL never print a decision of any kind. One recorder file SHALL hold every reporting branch the plugin registers, dispatching on the event name: the session-end branch, the subagent-start and subagent-stop branches, and the permission-denied and permission-request branches. The plugin manifest SHALL register the recorder on the session-end event, on the subagent-start and subagent-stop events with the anchored matcher for workflow agents, and on the permission-denied and permission-request events; a test SHALL spawn it as a child process for each registered event the way the host would, and a dropped registration SHALL fail that test.

#### Scenario: Happy path — a valid event exits 0 with nothing on stdout

- **GIVEN** a live marker and a matching manifest
- **WHEN** the recorder is spawned with a session-end event on stdin
- **THEN** it exits 0 and prints no decision

#### Scenario: Failure — malformed input or an internal throw still exits 0

- **GIVEN** stdin that is not JSON, or a hook body made to throw
- **WHEN** the recorder runs
- **THEN** it exits 0, prints no decision, and names the error on its error stream

#### Scenario: Edge case — an event with no branch, and the registration pin

- **GIVEN** an event whose name the recorder has no branch for
- **WHEN** the recorder runs
- **THEN** it exits 0 and creates nothing
- **AND** a test that the plugin manifest names this hook on the session-end, subagent-start, subagent-stop, permission-denied and permission-request events fails if any registration is dropped

#### Scenario: Edge case — one file, five branches

- **GIVEN** the plugin's hooks directory as shipped
- **WHEN** a test reads the recorder's source and the manifest's registrations
- **THEN** exactly one recorder file is registered on all five events
- **AND** the file contains no call that returns a decision
