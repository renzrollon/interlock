# run-host-adapters Specification

## Purpose

Lets the runner drive any vendor coding CLI through a declared adapter, so each model runs on its own vendor's harness while Interlock's isolation, routing, banners and receipt stay the same on every host.

## Requirements

### Requirement: The runner SHALL select a host adapter by id and record its declared capabilities in the run manifest

`interlock-run` MUST accept `--host <id>` (or the `INTERLOCK_RUN_HOST` environment variable) naming an adapter from the registry, MUST refuse an unknown id and the Workflow host id with a non-zero exit before any step runs, and MUST pass the adapter's declared capabilities to `interlock run start`, which MUST store them on the manifest. Every adapter MUST declare schema enforcement, model selection kind, worktree ownership, hook availability, usage reporting and billing path.

#### Scenario: Happy path — a Codex run records its capabilities

- **GIVEN** `interlock-run <change> --host codex`
- **WHEN** the run starts
- **THEN** the manifest records `host.id = codex` with `schemaEnforced: true`, `modelSelect: map-only`, `worktree: driver`, `hooks: false`
- **AND** every later step is emitted according to those capabilities

#### Scenario: Failure — an unknown host id

- **GIVEN** `interlock-run <change> --host gemini`
- **WHEN** the runner starts
- **THEN** it exits non-zero naming the known ids
- **AND** no manifest, briefing or trajectory event is written

#### Scenario: Edge case — the Workflow host id is refused

- **GIVEN** `interlock-run <change> --host workflow`
- **WHEN** the runner starts
- **THEN** it exits non-zero saying the Workflow runtime is reached through `/interlock:ship`, not the runner

### Requirement: Every runner host SHALL get driver-owned worktree isolation under `--isolate-waves`

For an isolated batch, the run program MUST emit a merge base and one worktree path per lane; the runner MUST create each worktree from that base, spawn the lane with the worktree as its working directory, and hand the results to `run record-batch`, which MUST fold ok lanes, halt on a real collision naming the path and the lanes, and leave a failed lane's worktree in place and named. The runner MUST remove folded worktrees.

#### Scenario: Happy path — two disjoint lanes fold on the Qwen host

- **GIVEN** `interlock-run <change> --host qwen --isolate-waves` and a batch of two lanes that write different files
- **WHEN** the batch completes
- **THEN** both lanes ran in separate worktrees created from the batch's merge base, both folded into the shared tree, and both worktrees were removed

#### Scenario: Failure — a real collision halts

- **GIVEN** an isolated batch in which two lanes wrote the same file despite disjoint predictions
- **WHEN** `run record-batch` folds
- **THEN** the run halts naming the path and both lane labels
- **AND** both worktrees remain on disk and are named in the summary

#### Scenario: Edge case — an ACP agent's session runs in the worktree

- **GIVEN** `interlock-run <change> --host acp --isolate-waves`
- **WHEN** a lane is spawned
- **THEN** the ACP session is created with the lane's worktree as its cwd
- **AND** the agent's writes land in the worktree, not the shared tree

### Requirement: Model routing per host SHALL come from a published map, and an unroutable spawn SHALL be bannered per host

The runner MUST read `INTERLOCK_MODEL_MAP` once at startup and exit non-zero on a malformed value. For each spawn carrying a slug, the adapter MUST apply the mapped model, or the slug itself where the host accepts it, or negotiate it where the host advertises models, and MUST emit a routing event stating whether the model was applied and why not. The runner MUST print `MODEL ROUTING UNAVAILABLE (<host>)` naming every unrouted spawn and its reason, and MUST print nothing about routing failure when every spawn was routed.

#### Scenario: Happy path — Claude passes slugs through unmapped

- **GIVEN** `--host claude` and no `INTERLOCK_MODEL_MAP`
- **WHEN** a tier-1 lane is spawned
- **THEN** the adapter passes `--model haiku`
- **AND** the summary prints no routing banner

#### Scenario: Failure — Codex with no mapping

- **GIVEN** `--host codex` and no `INTERLOCK_MODEL_MAP` entry for `codex`
- **WHEN** a lane is spawned
- **THEN** the adapter passes no model flag
- **AND** the summary prints `MODEL ROUTING UNAVAILABLE (codex)` naming the lane and the reason `no mapping for sonnet`

#### Scenario: Edge case — a malformed map

- **GIVEN** `INTERLOCK_MODEL_MAP` set to a non-JSON string
- **WHEN** the runner starts
- **THEN** it exits non-zero naming the variable
- **AND** no step runs

### Requirement: The runner SHALL name the billing path it runs on

Every runner summary MUST print `RUNNER HOST: <id> (experimental)`. A run whose adapter drives the Claude binary, directly or through ACP, MUST print a `SUBSCRIPTION PATH: programmatic` banner pointing at the documentation; a Codex run with no API key in the environment MUST print a `CHATGPT PLAN PATH` banner; a host without hooks MUST print `HOOKS NOT IN FORCE (<host>)`. The receipt MUST record the host id, its billing path and its hook availability.

#### Scenario: Happy path — a Claude run names its path

- **GIVEN** `--host claude`
- **WHEN** the run closes
- **THEN** the summary contains `RUNNER HOST: claude (experimental)` and the `SUBSCRIPTION PATH: programmatic` banner
- **AND** the receipt records `host.billing = claude-subscription-programmatic`

#### Scenario: Failure — a Codex run without credentials guidance

- **GIVEN** `--host codex` with neither `CODEX_API_KEY` nor `OPENAI_API_KEY` set
- **WHEN** the run closes
- **THEN** the summary contains the `CHATGPT PLAN PATH` banner and `HOOKS NOT IN FORCE (codex)`

#### Scenario: Edge case — ACP over a non-Claude agent

- **GIVEN** `--host acp` with `INTERLOCK_ACP_COMMAND` naming a non-Claude agent
- **WHEN** the run closes
- **THEN** no `SUBSCRIPTION PATH` banner is printed
- **AND** `RUNNER HOST: acp (experimental)` is

### Requirement: Usage SHALL be recorded when the host reports it and unknown otherwise

An adapter whose CLI reports token usage MUST attach it to the spawn's result, the runner MUST pass it with the results, and `run close` MUST record per-wave and per-run output tokens in the receipt; any wave with a spawn lacking usage MUST be recorded as `unknown`, never as zero.

#### Scenario: Happy path — Claude usage reaches the receipt

- **GIVEN** `--host claude` and an envelope carrying usage on every spawn
- **WHEN** the run closes
- **THEN** the receipt records numeric output tokens per wave and per run

#### Scenario: Failure — one spawn lacked usage

- **GIVEN** a wave in which one spawn's envelope carried no usage
- **WHEN** the run closes
- **THEN** that wave's output tokens are recorded as `unknown`
- **AND** the run total is recorded as `unknown`

#### Scenario: Edge case — a host that never reports usage

- **GIVEN** `--host qwen` with an envelope carrying no usage
- **WHEN** the run closes
- **THEN** every wave and the run are recorded as `unknown` and the summary says usage was not reported by the host

### Requirement: Cache accounting SHALL be a separately declared host capability

Reporting cache tokens is not implied by reporting token usage: a host may expose a cumulative spend scalar while exposing no cache decomposition at all. Each host adapter SHALL therefore declare cache accounting as its own capability, separate from the usage capability it already declares, and the declaration SHALL be recorded in the run manifest alongside the host's other declared capabilities.

The run program SHALL branch on the declared capability rather than on the host's id or name, so that a host gaining or losing cache accounting changes one declaration and nothing else. A run on a host that does not declare it SHALL be bannered — a host that could not be bannered is a run that degraded silently.

#### Scenario: Happy path — a host that reports cache fields declares the capability and records figures

- **GIVEN** an adapter whose vendor CLI returns a usage envelope carrying cache-read and cache-creation fields
- **WHEN** a run starts on that host
- **THEN** the manifest records cache accounting among that host's declared capabilities
- **AND** the run's recorded cache figures are present

#### Scenario: Failure — a host without the capability is bannered, not silently empty

- **GIVEN** an adapter whose runtime exposes only a cumulative spend scalar
- **WHEN** a run executes on that host
- **THEN** the manifest records cache accounting as undeclared for that host
- **AND** the run banners that cache figures are unavailable on this host
- **AND** the banner is carried into the run's summary

#### Scenario: Edge case — the capability is read from the declaration, never from the host's identity

- **GIVEN** two adapters, one declaring cache accounting and one not
- **WHEN** the run program decides whether to expect cache figures
- **THEN** the decision reads the declared capability
- **AND** no branch is taken on the adapter's id or display name

### Requirement: A usage envelope's cache fields SHALL be carried through unchanged or not at all

Where an adapter parses a host's usage envelope, it SHALL carry the cache figures through with the tier distinction the host reported them under intact, or carry none of them. An adapter MUST NOT flatten distinct lifetime tiers into a single cache-creation total, and MUST NOT substitute a zero for a field the envelope omitted.

An envelope that is present but unparseable SHALL be treated as a host that did not report, not as a host that reported nothing.

#### Scenario: Happy path — tiers survive the parse

- **GIVEN** a usage envelope reporting cache creation split across two lifetime tiers
- **WHEN** the adapter parses it
- **THEN** both tier figures are carried through separately
- **AND** neither is summed into the other

#### Scenario: Failure — an omitted field is not read as a zero

- **GIVEN** a usage envelope that carries a cache-read figure and omits cache creation entirely
- **WHEN** the adapter parses it
- **THEN** the cache-read figure is carried through
- **AND** the cache-creation figure is carried as absent rather than as zero

#### Scenario: Edge case — an unparseable envelope degrades to unreported

- **GIVEN** a spawn whose usage envelope cannot be parsed
- **WHEN** the adapter reports that spawn's figures
- **THEN** the cache figures are reported as absent
- **AND** the spawn's other recorded outcomes are unaffected
