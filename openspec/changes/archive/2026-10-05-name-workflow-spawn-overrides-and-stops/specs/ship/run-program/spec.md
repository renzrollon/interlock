## ADDED Requirements

### Requirement: The run program SHALL read the Workflow host's environment and version at start and decide the routing banners and the ping model

`interlock run start --host workflow` MUST read `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and the Bedrock variables from its own environment, MUST learn the host version from the host's own version command, and MUST decide from them. On a host at or above the version from which the plain variable sets only the default subagent model, a set `CLAUDE_CODE_SUBAGENT_MODEL` MUST raise no `MODEL ROUTING OVERRIDDEN` banner, the control-plane ping model MUST stay `haiku`, and an advisory note MUST say the variable sets only the default on this host. On an older host, or when the version cannot be read, the run MUST raise `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=<value> — every agent runs on that model, so the per-tier assignment in the plan is not in effect`, MUST carry no ping model, and MUST say when the version was unknown. A set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` on a host at or above the version that introduced it, or whose version is unknown, MUST raise `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model`, MUST carry no ping model, and MUST record the host's observed model-selection kind as `forced`. With a Bedrock variable set the ping model MUST be absent and a note MUST say the pings inherit the session model. Both version floors MUST be named constants in the module that reads them. The teams variable MUST raise no run banner. The start step MUST carry the decided ping model as a field, the Workflow driver MUST set its control-plane ping model from that field alone, and the driver MUST NOT read any of these variables itself.

#### Scenario: Happy path — a current host keeps haiku pings and raises no banner

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL=opus` in the CLI's environment, no Bedrock variable, and a host whose version command reports `2.1.288`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step and the manifest carry no `MODEL ROUTING OVERRIDDEN` banner
- **AND** the step's ping model is `haiku`
- **AND** the manifest carries a note saying `CLAUDE_CODE_SUBAGENT_MODEL=opus` sets only the default subagent model on this host

#### Scenario: Failure — an older host is bannered and the pings carry no model

- **GIVEN** the same variable and a host whose version command reports `2.1.250`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step and the manifest carry `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=opus`
- **AND** the step's ping model is absent

#### Scenario: Failure — FORCE is bannered by name and the model-selection kind is refined

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and a host whose version command reports `2.1.288`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step carries `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 — every agent runs on one model`
- **AND** the manifest's host records model selection `forced`
- **AND** the step's ping model is absent

#### Scenario: Edge case — an unreadable version falls back to today's reading and says so

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL=opus` and a host whose version command fails
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step carries `MODEL ROUTING OVERRIDDEN: CLAUDE_CODE_SUBAGENT_MODEL=opus` with `(host version unknown)`
- **AND** the run is not halted

#### Scenario: Edge case — a Bedrock variable withholds the ping model and says so

- **GIVEN** `CLAUDE_CODE_USE_BEDROCK=1`, no subagent-model variable, and a current host
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step's ping model is absent
- **AND** the manifest carries a note that control-plane pings run on the session model
- **AND** no `MODEL ROUTING OVERRIDDEN` banner is raised

#### Scenario: Edge case — the driver forwards the field and holds no probe of its own

- **GIVEN** the Workflow driver's source and the start step it receives
- **WHEN** the driver sets its control-plane ping model
- **THEN** it reads the step's field and contains no instruction to print the subagent-model or Bedrock variables
- **AND** the relay whitelist carries the field

### Requirement: The runtime's concurrency SHALL be observed and bannered, never resized

`interlock run start --host workflow` MUST record on the manifest the concurrency the runtime will honour as the CLI can observe it: the environment override when `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` holds an integer in the vendor's range, otherwise the vendor default together with the machine's CPU count and the fact that the runtime may run fewer on a small machine. When a plan is adopted and its widest batch holds more lanes than an observed environment override, the run MUST raise `WAVE WIDER THAN RUNTIME SLOTS` naming the widest batch's lane count, the override and how many lanes queue, and MUST NOT resize the plan. A value outside the vendor's range or not an integer MUST be recorded as invalid and otherwise ignored. `interlock limits` MUST print the observed value beside the vendor default in its text and its JSON.

#### Scenario: Happy path — an override wider than every batch is recorded and silent

- **GIVEN** `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=4` and a plan whose widest batch has two lanes
- **WHEN** the run starts and adopts the plan
- **THEN** the manifest records an observed concurrency of 4 from the environment
- **AND** no `WAVE WIDER THAN RUNTIME SLOTS` banner is raised

#### Scenario: Failure — a batch wider than the override is bannered and not resized

- **GIVEN** `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=2` and a plan whose widest batch has three lanes
- **WHEN** the plan is adopted
- **THEN** the step and the manifest carry `WAVE WIDER THAN RUNTIME SLOTS` naming 3 lanes, the override of 2 and 1 lane queuing
- **AND** the run state's batches are the plan's, unchanged

#### Scenario: Edge case — no override records the vendor default with the CPU count

- **GIVEN** the variable unset on an 8-CPU machine
- **WHEN** the run starts
- **THEN** the manifest records the vendor default as the source with CPU count 8
- **AND** `interlock limits` prints the vendor default beside the words that it may be reduced on this 8-CPU machine
- **AND** no banner is raised for any batch width

#### Scenario: Edge case — an invalid override is recorded invalid and ignored

- **GIVEN** `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=lots`
- **WHEN** the run starts
- **THEN** the manifest records the value as invalid with its raw text
- **AND** the run proceeds as if the variable were unset

### Requirement: Run start SHALL speak every unspoken interrupted-run note once

`interlock run start` MUST read every interrupted-run note in the root, whatever change it names, and for each note not yet spoken MUST carry `PREVIOUS RUN INTERRUPTED: <change> run <id> ended at stage <stage> — no resume card was written; interlock run-log show <id>` on the start step and the manifest, then MUST mark that note spoken. A note already spoken MUST raise nothing. A note that cannot be read MUST become a manifest note naming the file and the reason. Neither an unreadable note nor one that cannot be marked spoken MAY change the exit code or halt the run.

#### Scenario: Happy path — one unspoken note is spoken and marked

- **GIVEN** an unspoken note for run `r-1` of change `add-foo` at stage `remediation`
- **WHEN** `interlock run start` runs for any change
- **THEN** the start step and the manifest carry `PREVIOUS RUN INTERRUPTED: add-foo run r-1 ended at stage remediation — no resume card was written; interlock run-log show r-1`
- **AND** the note is marked spoken

#### Scenario: Failure — an unreadable note is named and the run proceeds

- **GIVEN** a note file that is not valid JSON
- **WHEN** `interlock run start` runs
- **THEN** the manifest carries a note naming the file as unreadable with its reason
- **AND** the start step is the ordinary first step, not a halt

#### Scenario: Edge case — a spoken note is silent and two unspoken notes are two banners

- **GIVEN** one note already marked spoken and two unspoken notes for two different runs
- **WHEN** `interlock run start` runs
- **THEN** exactly two `PREVIOUS RUN INTERRUPTED` banners are carried, one per unspoken note
- **AND** the spoken note raises nothing

## MODIFIED Requirements

### Requirement: A briefing SHALL be a file whose first line carries its hash, and a host delivering it by reference SHALL fail closed a result that does not acknowledge that hash

For every spawn, the CLI MUST write the assembled briefing to a file whose first line names the spawn label and the SHA-256 of the briefing text, and MUST place the path, the hash and the text on the spawn. A host that cannot pass the text through its transport MAY deliver the briefing by reference with a fixed bootstrap that names the path and requires the agent to report the hash as `briefing`; such a host MUST treat a result whose `briefing` is absent or differs from the spawn's hash as a failed spawn with reason `briefing not acknowledged`. A result that is absent altogether — the runtime returned no result because it stopped the agent, the API failed or a usage limit ended it — MUST be recorded as a failed spawn with the banner `AGENT RETURNED NO RESULT: <label> — the runtime stopped it, the API failed, or a usage limit ended it; the step is recorded as failed`, and MUST NOT be reported as `briefing not acknowledged`. A host that passes the text inline MUST ignore `briefing`.

#### Scenario: Happy path — a Workflow-runtime worker acknowledges its briefing

- **GIVEN** a spawn whose briefing file's first line carries hash `H`
- **WHEN** the Workflow-runtime interpreter spawns the worker with the bootstrap and the worker reports `briefing: "H"`
- **THEN** the result is accepted and recorded as the lane's result

#### Scenario: Failure — the worker never read the briefing

- **GIVEN** the same spawn
- **WHEN** the worker's result omits `briefing` or reports a different hash
- **THEN** the interpreter records a failed spawn with reason `briefing not acknowledged`
- **AND** the lane's tasks are recorded as failed, not as ok on the strength of the rest of the result

#### Scenario: Failure — the runtime returned no result

- **GIVEN** the same spawn
- **WHEN** the runtime's agent call resolves to no result at all
- **THEN** the interpreter records a failed spawn and carries `AGENT RETURNED NO RESULT: <label>` to the close
- **AND** the summary does not say `BRIEFING NOT ACKNOWLEDGED` for that spawn

#### Scenario: Edge case — an inline host is not penalised for omitting the field

- **GIVEN** the ACP driver, which sends the briefing text inline
- **WHEN** an agent's result carries no `briefing` field
- **THEN** the result is judged on its schema alone
- **AND** no `briefing not acknowledged` failure is recorded
