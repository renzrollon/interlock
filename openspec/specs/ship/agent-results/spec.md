# ship/agent-results Specification

## Purpose
What a ship run records about each agent after it returned: the model that served it, what it cost, how the host ended it, and what was denied to it, joined to the spawn the run dispatched and spoken as banners the CLI decides on both hosts.

## Requirements

### Requirement: The close SHALL join recorded agent usage to dispatched spawns by briefing key and record wave cache figures only where every briefed spawn joined

The run SHALL record, for every spawn a step dispatched, its wave, label, kind, routed model and briefing sha256. At close, when the run's agent-usage directory exists, the close SHALL match each recorded agent whose briefing key equals a dispatched spawn's sha256 to that spawn. For each wave, when every dispatched spawn carrying a sha256 joined with recorded usage, the wave's cache-read and cache-creation figures SHALL be the sums over its agents, with cache creation kept per lifetime tier and a tier any agent recorded as unknown making that tier unknown for the wave; when any such spawn did not join, or joined with absent usage, the wave's cache figures SHALL be recorded as absent and the close SHALL banner `CACHE ACCOUNTING PARTIAL: <n> of <m> agents unrecorded` with both counts. Recorded agents that match no dispatched spawn SHALL be counted in a note and SHALL contribute to no wave. Output-token figures SHALL be unchanged by the join. When the directory does not exist the close SHALL say cache accounting was not reported exactly as before.

#### Scenario: Happy path — every lane of every wave joined

- **GIVEN** a Workflow-host run that dispatched two briefed lanes in wave 1 and one in wave 2, and an agent file for each carrying usage and the matching sha256
- **WHEN** the run closes
- **THEN** the receipt's spend rows carry cache-read and per-tier cache-creation figures for waves 1 and 2 and for the run
- **AND** the summary carries no `CACHE ACCOUNTING NOT REPORTED` and no `CACHE ACCOUNTING PARTIAL` line

#### Scenario: Failure — one lane did not join

- **GIVEN** the same run with no agent file for one of wave 1's lanes
- **WHEN** the run closes
- **THEN** wave 1's cache figures are recorded as absent and wave 2's are present
- **AND** the summary carries `CACHE ACCOUNTING PARTIAL: 1 of 3 agents unrecorded`

#### Scenario: Edge case — a ping's file and a total-only tier

- **GIVEN** an agent file with no briefing key, and a joined lane whose cache creation was recorded as a total with the tier split unknown
- **WHEN** the run closes
- **THEN** the note counts one recorded agent that matched no dispatched spawn
- **AND** that lane's wave records its cache-creation tiers as unknown and no figure as zero

#### Scenario: Edge case — no sidecar at all

- **GIVEN** a Workflow-host run with no agent-usage directory for its run id
- **WHEN** the run closes
- **THEN** the summary carries `CACHE ACCOUNTING NOT REPORTED` and no partial line

### Requirement: A complete join SHALL refine the observed cache-accounting capability to `hook`, and a partial one SHALL NOT

When every briefed spawn of every wave joined with recorded usage, the close SHALL set the manifest's observed cache-accounting capability to `hook`, a value only the close may set and no adapter may declare, and the receipt SHALL record it. A partial join SHALL leave the declared value in place. The receipt's host block SHALL carry `true`, `false` or `hook`, and a receipt written before this value existed SHALL read exactly as it did.

#### Scenario: Happy path — a complete join is recorded as hook-observed

- **GIVEN** a run whose every briefed spawn joined
- **WHEN** the run closes
- **THEN** the manifest and the receipt record cache accounting as `hook`

#### Scenario: Failure — a partial join keeps the declared value

- **GIVEN** a run with one unjoined spawn
- **WHEN** the run closes
- **THEN** the manifest's cache-accounting value is the host's declared `false`
- **AND** the receipt records `false` beside the partial banner

#### Scenario: Edge case — an old receipt and a declaring adapter

- **GIVEN** a receipt written before the `hook` value existed, and an adapter whose declaration is `true`
- **WHEN** the registry's values are checked and the old receipt is read
- **THEN** the old receipt's boolean reads unchanged
- **AND** no adapter declares `hook`, and a test fails if one does

### Requirement: A served model that is not the routed model SHALL be bannered, through one matcher that treats an alias and its full identifier as the same model

The run SHALL compare each spawn's routed model against the models observed for it through exactly one comparison and one verdict, used on the Workflow host at close and on the runner host at the record path, and nowhere else. The comparison SHALL treat a tier alias as matching any identifier that carries that tier, SHALL ignore a provider prefix and a trailing date stamp, and SHALL otherwise require the same identifier. The verdict SHALL read the strongest observation present. Turn-scoped models — the models of the agent's own assistant turns, read from its transcript on the Workflow host and from the lane session's transcript on the runner — SHALL raise the banner when any of them does not match, because a fallback that served one turn is still a model the plan did not choose. Session-scoped models alone — the runner envelope's per-model breakdown, which also lists the host's internal calls — SHALL raise it only when none of them matches, because a partial fallback cannot be told apart from an internal call there. The banner SHALL read `MODEL SUBSTITUTED: <label> routed <routed>, ran <ids>` listing every identifier of the scope it stood on, with the same words on both hosts, and the agent's record SHALL name that scope. A spawn with no routed model, or an agent with neither observation, SHALL raise nothing.

#### Scenario: Happy path — an alias served by its full identifier raises nothing

- **GIVEN** a lane routed `sonnet` and served by `claude-sonnet-5-5`, and a lane routed `haiku` and served by `bedrock.claude-haiku-4-5`
- **WHEN** the run records the lanes
- **THEN** no substitution banner is raised for either

#### Scenario: Happy path — a host-internal call in the session breakdown raises nothing

- **GIVEN** a runner lane routed `sonnet` whose transcript could not be read and whose session-scoped models are `bedrock.claude-sonnet-5` and `bedrock.claude-haiku-4-5`
- **WHEN** the run records the lane
- **THEN** no substitution banner is raised, because the routed model served the session
- **AND** the agent's record names the session scope and both identifiers

#### Scenario: Failure — a different model served the lane

- **GIVEN** a lane routed `sonnet` whose served models are `claude-opus-5-5`
- **WHEN** the run records the lane
- **THEN** the summary carries `MODEL SUBSTITUTED: <label> routed sonnet, ran claude-opus-5-5`
- **AND** the same text is produced whether the lane ran on the Workflow host or the runner

#### Scenario: Edge case — a fallback served one turn, a date-stamped identifier, and casing

- **GIVEN** a lane routed `claude-sonnet-5-5` served by `claude-sonnet-5-5-20261001` for most turns and `claude-sonnet-5` for one turn, and a lane routed `Sonnet` served by `CLAUDE-SONNET-5-5`
- **WHEN** the run records the lanes
- **THEN** the first lane raises the banner naming both turn-scoped identifiers, because `claude-sonnet-5` is not `claude-sonnet-5-5`
- **AND** the second lane raises nothing, because the comparison is case-insensitive

### Requirement: The runner's host records SHALL reach the CLI on their own channel and the CLI SHALL decide the lane banners

The runner SHALL forward the host's observation of each spawn to the CLI apart from the agents' own results, on every record path, and the CLI SHALL decide from it: `LANE STOPPED BY HOST: <label> <subtype>` when the host ended the lane with an error or a non-zero exit, naming the subtype or the exit code; `SCHEMA RESULT MISSING (claude): <label> — success without structured_output (anthropics/claude-code#82258)` when the host reported success with no structured result; `TOOLS DENIED IN LANE: <label> <n> (<tools>)` when the host recorded permission denials; and the model substitution banner above. The banners SHALL be carried to the close and printed on a halt as on a completion. A lane with no host record SHALL raise nothing and count nothing. The driver SHALL decide none of these.

#### Scenario: Happy path — a success envelope without a structured result is named without `--verbose`

- **GIVEN** `--host claude` and a lane whose envelope reports subtype `success`, exit 0 and no `structured_output`
- **WHEN** the batch is recorded
- **THEN** the lane is recorded as failed
- **AND** the close summary carries `SCHEMA RESULT MISSING (claude): <label> — success without structured_output (anthropics/claude-code#82258)` without the runner having been run with `--verbose`

#### Scenario: Failure — a non-zero exit with an error subtype

- **GIVEN** a lane whose process exited non-zero with an envelope of subtype `error_max_turns` on stdout
- **WHEN** the batch is recorded
- **THEN** the summary carries `LANE STOPPED BY HOST: <label> error_max_turns`

#### Scenario: Edge case — two denials, and a lane with no record

- **GIVEN** a lane whose envelope lists two permission denials naming `Bash` and `Edit`, and a lane on the Workflow host with no host record
- **WHEN** the batches are recorded
- **THEN** the first lane raises `TOOLS DENIED IN LANE: <label> 2 (Bash, Edit)`
- **AND** the second raises nothing and increments no count

### Requirement: Every observed agent SHALL be recorded as an `agent-result` trajectory event in the fatal class, and the receipt SHALL count what was observed

For each host record on the runner and each joined agent on the Workflow host, the CLI SHALL append one `agent-result` event carrying the label, the source of the observation, the host's subtype and error flag, its bounded errors, its permission denials, its session identifier, its turn count, the routed model, the turn-scoped and session-scoped models with the scope the verdict read, whether a substitution was found, whether the structured result was missing, the agent's own usage with cache tiers kept apart, and the host's cost estimate kept apart from any price table. A failed append SHALL halt the record path before any tick, or at close SHALL make the run unreconstructable and the exit code non-zero, exactly as the other trajectory appends do. The receipt SHALL carry counts of lanes stopped by the host, schema results missing, lanes with denials, substitutions, permission prompts and auto-mode denials, each absent when nothing was ever observed and a measured zero otherwise. The trajectory schema identifier SHALL NOT change, and a trajectory written before the event existed SHALL still list, check and render.

#### Scenario: Happy path — one event per lane on the runner

- **GIVEN** a runner run of three lanes whose host records arrived with each batch
- **WHEN** the run closes
- **THEN** the trajectory carries three `agent-result` events in the fatal class, each naming its lane's session identifier and served models
- **AND** the receipt's six counts are numbers, zero where nothing happened

#### Scenario: Failure — the append fails

- **GIVEN** a runs directory that becomes unwritable before a record path appends its `agent-result`
- **WHEN** the batch is recorded
- **THEN** the step halts naming the trajectory append and no task is ticked

#### Scenario: Edge case — an old trajectory and a run that observed nothing

- **GIVEN** a trajectory written before `agent-result` existed, and a Workflow run with no sidecar and no host record
- **WHEN** the first is listed, checked and shown, and the second closes
- **THEN** the old trajectory reads as before with no new problem reported
- **AND** the second run's receipt carries the six counts as absent, not zero

### Requirement: Permission events SHALL be counted and bannered as counts a reader interprets

At close the run SHALL count the permission files recorded for it and banner `PERMISSION PROMPTS DURING RUN: <n>` when any request was recorded and `AUTO MODE DENIED <n> TOOL CALLS (<tools>)` when any denial was recorded, naming the distinct tools, and SHALL record both counts in the receipt. Neither banner SHALL change the exit code or any verdict: a denial can be a host defect, and the count is what the reader interprets.

#### Scenario: Happy path — one prompt and two denials

- **GIVEN** a run whose sidecar holds one permission-request file and two permission-denied files naming `Bash` and `Bash`
- **WHEN** the run closes
- **THEN** the summary carries `PERMISSION PROMPTS DURING RUN: 1` and `AUTO MODE DENIED 2 TOOL CALLS (Bash)`
- **AND** the exit code is that of the run's outcome alone

#### Scenario: Failure — an unreadable permission file is counted as unreadable

- **GIVEN** a permission file that is not valid JSON
- **WHEN** the run closes
- **THEN** the close notes one unreadable sidecar file by name
- **AND** the other files are still counted

#### Scenario: Edge case — no permission event

- **GIVEN** a run whose sidecar holds agent files and no permission file
- **WHEN** the run closes
- **THEN** neither permission banner is printed and the receipt records both counts as zero
