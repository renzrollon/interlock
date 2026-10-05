# hooks/agent-recorder Specification

## Purpose
The recorder's subagent and permission branches: what a ship run learns about each agent it spawned and each permission event that interrupted it, written by hooks that report and never decide, from host events the run itself cannot see.

## Requirements

### Requirement: The subagent and permission branches SHALL act only for a live ship run and SHALL exit before any filesystem write otherwise

On the host's subagent-start, subagent-stop, permission-denied and permission-request events, the recorder SHALL write only when a fresh stage marker exists whose process is running and the run manifest in the working root carries a run identifier; for the two subagent events it SHALL additionally require the event's agent type to be exactly `workflow-subagent`, the type the host reports for every agent a workflow script spawns whatever agent type the script named, so an internal agent reporting the session's own agent name, a plugin agent type, or an empty type writes nothing. In every other case, in every session and repository where the plugin is installed, the branch SHALL create no file and no directory. No branch SHALL start a subprocess, run version control, or read or write the run trajectory.

#### Scenario: Happy path — a worker stopping during a live run is recorded

- **GIVEN** a live stage marker for change `add-foo` whose process is running and a manifest recording run id `r-1`
- **WHEN** the recorder receives a subagent-stop event with agent type `workflow-subagent`
- **THEN** one file is written under the run's agent-usage directory
- **AND** the hook spawned no process and the trajectory under `.claude/ship/runs/` is untouched

#### Scenario: Failure — no live run

- **GIVEN** a root with no stage marker, or a marker whose process is no longer running, or a manifest without a run identifier
- **WHEN** the recorder receives any of the four events
- **THEN** no file and no directory is created
- **AND** the hook exits 0 and prints nothing on stdout

#### Scenario: Edge case — an internal agent or an empty agent type

- **GIVEN** a live marker and a manifest with a run identifier
- **WHEN** the recorder receives a subagent-stop event whose agent type is empty, or is any name other than `workflow-subagent`, `interlock:worker` included
- **THEN** nothing is written
- **AND** the hook exits 0

### Requirement: Subagent stop SHALL record the agent's summed usage, served models and briefing key from its transcript, and an unparseable transcript SHALL be unrecorded rather than zero

On a subagent-stop event that passes the gate, the recorder SHALL read the transcript the event names and write one file for that agent identifier carrying: the agent identifier and type; the stop time; the sum over the transcript's assistant turns of input tokens, output tokens, cache-read tokens and cache-creation tokens, a turn being one assistant message however many lines the host wrote for it and its figures the last of those lines', the last kept split by lifetime tier when the transcript reports the split and recorded as a total with the split unknown when it reports only a total; the distinct models that served the agent, the host's synthetic placeholder excluded; the number of turns summed; and the briefing sha256 found last in the user turns that precede the agent's first assistant turn, or none when they carry none. A figure any contributing turn omits SHALL be recorded as absent for the agent, never as zero. A transcript that cannot be read or parses to no assistant turn SHALL be recorded with absent usage and the reason, never with zeros. The agent identifier SHALL name the file only when it is a safe path segment.

#### Scenario: Happy path — a briefed worker's transcript is summed

- **GIVEN** a transcript with three assistant turns each carrying input, output, cache-read and tier-split cache-creation figures, one of them written as three lines that repeat its usage, served by one model, whose first user turn contains the bootstrap text with `Expected sha256: <hex>`
- **WHEN** the recorder handles the subagent-stop event for that agent
- **THEN** the agent's file carries the three figures summed once per turn, both cache-creation tiers summed separately, one served model, three turns and that sha256

#### Scenario: Failure — an unreadable or empty transcript is unrecorded

- **GIVEN** a transcript path that does not exist, or a file with no assistant turn
- **WHEN** the recorder handles the event
- **THEN** the agent's file carries absent usage and a reason naming the problem
- **AND** no figure is recorded as zero, and the hook exits 0

#### Scenario: Edge case — a total-only cache figure, an omitted field, and a torn line

- **GIVEN** a transcript whose turns carry a cache-creation total but no tier split, where one turn omits the cache-read figure, and whose final line is torn
- **WHEN** the recorder handles the event
- **THEN** cache creation is recorded as a total with the tier split unknown
- **AND** the cache-read figure is recorded as absent for the agent, the torn line is counted as skipped, and the other figures are summed

#### Scenario: Edge case — a ping has no briefing key

- **GIVEN** a transcript of a relay ping whose user turns carry no sha256, and a transcript whose first user turn relays the user's request and whose second carries the bootstrap text indented
- **WHEN** the recorder handles the event
- **THEN** the ping's file carries no briefing key and its usage is still summed
- **AND** the second file carries the sha256 from the indented bootstrap text

### Requirement: Subagent start SHALL be recorded once per agent, and permission events SHALL be recorded one file per event

On a subagent-start event that passes the gate, the recorder SHALL write the agent's file with its start time only when no file exists for that agent identifier, so the start, resume and teammate-message firings of the same agent leave one record. On a permission-denied or permission-request event that passes the gate, the recorder SHALL write one new file per event carrying the event kind, the time, the agent identifier when the event carries one, the tool name and the reason the host gave, each bounded, and never the tool input.

#### Scenario: Happy path — a start then a stop leave one file

- **GIVEN** a live run
- **WHEN** the recorder handles a subagent-start event for agent `a-1` and then a subagent-stop event for `a-1`
- **THEN** exactly one file exists for `a-1`, carrying both the start time and the summed usage

#### Scenario: Failure — a second start for the same agent changes nothing

- **GIVEN** a file already recorded for agent `a-1` with its usage
- **WHEN** the recorder handles another subagent-start event for `a-1`
- **THEN** the file is unchanged

#### Scenario: Edge case — two permission events in one run

- **GIVEN** a live run
- **WHEN** the recorder handles a permission-denied event naming tool `Bash` and then a permission-request event naming tool `Edit`
- **THEN** two distinct permission files exist, one per event, each naming its kind and tool and neither carrying a tool input

### Requirement: The four branches SHALL never block and SHALL be registered and tested as processes, and the sidecar SHALL be outcome-class

Each branch SHALL exit 0 on every path — a valid event, malformed input, a transcript it cannot read and an unexpected throw — SHALL print no decision, and SHALL never keep a subagent running by returning a blocking decision or a non-zero exit. The plugin manifest SHALL register the recorder on the subagent-start and subagent-stop events with the anchored matcher for workflow agents and on the permission-denied and permission-request events, a test SHALL spawn the recorder as a child process for each of the four events, and a dropped registration SHALL fail that test. A file that cannot be written SHALL be reported on the hook's error stream and SHALL NOT change the exit code: the sidecar is a pointer to records the close derives, in the outcome class beside the interrupted-run note, and the guards page SHALL say so.

#### Scenario: Happy path — valid events exit 0 with nothing on stdout

- **GIVEN** a live run
- **WHEN** the recorder is spawned with each of the four events on stdin in turn
- **THEN** every run exits 0 and prints nothing on stdout

#### Scenario: Failure — a forced crash or an unwritable directory still exits 0

- **GIVEN** a hook body made to throw, or an agent-usage path that cannot be created
- **WHEN** the recorder runs
- **THEN** it exits 0, prints nothing on stdout, and names the error on its error stream

#### Scenario: Edge case — the registration pin

- **GIVEN** the plugin manifest as shipped
- **WHEN** a test reads its hook registrations
- **THEN** the subagent-start and subagent-stop entries name the recorder with a matcher that admits exactly `workflow-subagent`
- **AND** the permission-denied and permission-request entries name the recorder, and removing any of the four fails the test
