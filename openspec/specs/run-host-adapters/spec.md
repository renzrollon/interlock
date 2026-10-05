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

For an isolated batch, the run program MUST emit a merge base and one worktree path per lane. The merge base MUST be the snapshot of the shared tree that the lanes capability describes — never HEAD while the shared tree differs from it — so that a later batch forks from the tree every earlier fold produced. The runner MUST create each worktree from that base, spawn the lane with the worktree as its working directory, and hand the results to `run record-batch`, which MUST verify that each clean lane's worktree was forked from that base and halt with `LANE BASE MISMATCH` when it was not, MUST fold ok lanes, halt on a real collision naming the path and the lanes, and leave a failed lane's worktree in place and named. The runner MUST remove folded worktrees. The runner MUST NOT choose, derive or substitute a base of its own: it reads the base off the step and interprets.

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

#### Scenario: Edge case — a second isolated batch forks from the folded tree, not from the pre-run commit

- **GIVEN** `interlock-run <change> --host qwen --isolate-waves`, where batch 0 has folded an edit to `lib/a.mjs` into the shared tree and the ship commit has not yet happened
- **WHEN** batch 1's step is emitted and the runner creates its lane worktree from the step's merge base
- **THEN** that merge base is a commit whose tree holds the folded edit, and the lane's worktree holds the edit before the lane's agent starts
- **AND** `run record-batch` accepts the lane's base as the snapshot and folds it

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

### Requirement: Effort control SHALL be a separately declared host capability

Each host adapter SHALL declare how it applies a named effort as its own capability, with exactly one of three values:

- `flag` — the adapter passes the level to its vendor CLI;
- `negotiated` — the adapter asks the agent at session creation;
- `unsupported` — the adapter has no effort channel it is verified to use on this host. That covers a host with no per-spawn channel at all, and a host whose channel the adapter does not route.

The declaration SHALL be recorded in the run manifest alongside the host's other declared capabilities, and in the run's receipt, so a reader of past runs can tell a run whose effort was applied from one where it could not be. The Workflow host SHALL record the verdict of the same `claude --help` probe the `claude` adapter runs, taken once at `run start`, rather than an unprobed `flag`. When that probe finds the flag, the manifest records `effort: flag`. When the flag is absent or the probe cannot be read, the manifest records `effort: unsupported` and the summary carries `EFFORT ROUTING UNAVAILABLE (workflow)` with the probe's reason. The Workflow script SHALL still pass each step's effort to `agent()` in either case. A caller that already passed an effort capability SHALL keep it, and the probe SHALL NOT replace it.

A declaration SHALL be made from what the vendor binary is known to accept. An adapter MUST NOT pass an effort flag that its vendor CLI is not verified to accept, and MUST NOT translate a level into another vendor's vocabulary.

The `claude` adapter SHALL apply a named effort with the CLI's effort flag, and SHALL pass no effort flag for a spawn that named none. It SHALL establish once, when the host is created, whether the installed CLI accepts that flag, from the CLI's own help. When the CLI does not, or when that cannot be established, the adapter SHALL declare `unsupported` for the run and SHALL pass no effort flag on any spawn.

Rationale: a capability that is merely implied by an adapter's code is a capability nothing can banner. Effort levels are not comparable across vendors' models, so a guessed flag or a translated label is a wrong effort that ran — invisible in a summary, where an `unsupported` declaration is not. A CLI that does not know the flag rejects the whole invocation, which would turn a missing capability into a failed run.

#### Scenario: Happy path — the Claude host applies a named effort by flag

- **GIVEN** `interlock-run <change> --host claude`, a CLI whose help lists the effort flag, and a lane spawn naming the effort `low`
- **WHEN** the adapter starts the agent
- **THEN** the argv carries `--effort low`
- **AND** the manifest records `effort: flag` among the host's declared capabilities

#### Scenario: Happy path — the Workflow host records the help probe

- **GIVEN** `interlock run start --host workflow` and a CLI whose help lists the effort flag
- **WHEN** the run starts
- **THEN** the manifest records `effort: flag`
- **AND** the summary does not contain `EFFORT ROUTING UNAVAILABLE (workflow)`

#### Scenario: Failure — a Workflow host whose CLI has no effort flag says so

- **GIVEN** `interlock run start --host workflow` and a CLI whose help does not list the effort flag
- **WHEN** the run starts and later closes
- **THEN** the manifest records `effort: unsupported`
- **AND** the summary contains `EFFORT ROUTING UNAVAILABLE (workflow): this claude CLI has no --effort flag`

#### Scenario: Edge case — a declared effort capability is not replaced by the probe

- **GIVEN** `interlock run start --host workflow` with an effort capability already passed, and a CLI whose help does not list the flag
- **WHEN** the run starts
- **THEN** the manifest records the capability that was passed

#### Scenario: Happy path — the receipt records the declaration

- **GIVEN** a run whose host declared `effort: unsupported`
- **WHEN** the run closes
- **THEN** the receipt's host block records `effort: unsupported`
- **AND** a receipt written before this capability existed reads as not recorded, never as `flag` or `unsupported`

#### Scenario: Failure — an unsupported host is given no invented flag

- **GIVEN** `interlock-run <change> --host codex` and a lane spawn naming an effort
- **WHEN** the adapter starts the agent
- **THEN** the argv is identical to the argv for the same spawn with no effort named
- **AND** the manifest records `effort: unsupported`

#### Scenario: Failure — a Claude CLI without the effort flag degrades instead of failing

- **GIVEN** `--host claude` and a CLI whose help does not list the effort flag
- **WHEN** the host is created and a lane spawn naming an effort is started
- **THEN** the host's effort capability is `unsupported` for that run
- **AND** the argv carries no effort flag, so the CLI does not reject the invocation
- **AND** the lane runs and returns its result

#### Scenario: Failure — an adapter that omits the declaration is caught

- **GIVEN** an adapter registered without an effort declaration, or with a value outside the three legal ones
- **WHEN** the registry test sweeps every declared capability over every adapter
- **THEN** it fails naming the adapter and the capability

#### Scenario: Edge case — a CLI whose help cannot be read is treated as unable

- **GIVEN** `--host claude` and a CLI whose help invocation fails or times out
- **WHEN** the host is created
- **THEN** the host's effort capability is `unsupported` for that run
- **AND** host creation does not fail because of it

#### Scenario: Edge case — a spawn that names no effort adds no flag

- **GIVEN** `--host claude` and a spawn whose effort is null
- **WHEN** the adapter starts the agent
- **THEN** the argv carries no effort flag
- **AND** the agent runs at the CLI's own default

### Requirement: An unapplied effort SHALL be bannered per spawn, and the spawn SHALL still run

For every spawn that names an effort and whose agent the adapter got as far as starting, the adapter MUST emit an effort-routing event stating the level requested, whether it was applied, by which method, and if not, why. An adapter MUST emit no such event for a spawn that named none. A spawn that fails before the adapter could attempt the effort is a failed spawn, reported as one, and is counted neither as applied nor as unapplied.

The reason MUST be true of that host. A host with no effort channel at all, a host whose channel the adapter does not route, and a CLI that lacks the flag MUST each give a different reason.

The runner MUST forward the step's effort to the adapter, and MUST read whether it was applied from the adapter's event alone — it MUST NOT compute that verdict itself. The runner MUST print `EFFORT ROUTING UNAVAILABLE (<host>)` when at least one spawn's effort was not applied, followed by one line per such spawn naming its label, the level it requested and the reason. When every spawn that named an effort had it applied, the runner MUST say so instead. A run in which no spawn named an effort MUST print neither.

Each banner line MUST state the level as the one requested, so that a host which could not apply an effort cannot be read as a host that ran at that effort. A spawn whose effort was not applied MUST still run, and its result MUST be recorded as any other spawn's is.

Rationale: on the Workflow host the plan's effort is applied; on a host that cannot apply it, the run is weaker in a way a green summary hides. A host that could not be bannered is a run that degraded silently.

#### Scenario: Happy path — every named effort was applied

- **GIVEN** `--host claude` and a run in which three spawns named an effort
- **WHEN** the run closes
- **THEN** the summary states that effort routing was applied on 3 of 3 spawns
- **AND** the summary does not contain `EFFORT ROUTING UNAVAILABLE`

#### Scenario: Failure — a host with no effort control is bannered and the lane still runs

- **GIVEN** `--host qwen` and a lane spawn naming the effort `low`
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING UNAVAILABLE (qwen)` followed by a line naming that lane's label, `low` as the level requested, and the reason that the host has no effort control
- **AND** the lane ran and its result was recorded

#### Scenario: Failure — a host whose channel is not routed says that, not that it has none

- **GIVEN** `--host codex` and a lane spawn naming an effort
- **WHEN** the run closes
- **THEN** the banner line for that lane gives the reason that effort is not routed on this host
- **AND** it does not say the host has no effort control

#### Scenario: Failure — a driver that decides application itself is caught

- **GIVEN** a runner that derives whether an effort was applied from the host id or the step, rather than from the adapter's event
- **WHEN** the driver test inspects how the unapplied set is built
- **THEN** the test fails because the verdict is not read from the event

#### Scenario: Edge case — a run in which no spawn named an effort says nothing about effort

- **GIVEN** a run whose only spawns carry a null effort
- **WHEN** the run closes
- **THEN** the summary contains neither the applied line nor `EFFORT ROUTING UNAVAILABLE`

#### Scenario: Edge case — a partly applied run names only the spawns that missed

- **GIVEN** `--host acp` and a run in which one spawn's effort was applied and another's was not
- **WHEN** the run closes
- **THEN** the summary contains `EFFORT ROUTING UNAVAILABLE (acp)` with exactly one line, naming the spawn that missed
- **AND** it does not also claim that effort routing was applied on every spawn

#### Scenario: Edge case — a spawn that names no effort raises no event

- **GIVEN** a run with a spawn whose effort is null, on any host
- **WHEN** that spawn runs
- **THEN** the adapter emits no effort-routing event for it
- **AND** it is not counted in the applied total

### Requirement: A forced subagent model SHALL be recorded as the observed model-selection kind `forced`

The legal values of the model-selection capability SHALL gain `forced`: an environment variable forces one model onto every spawned agent, so the per-spawn channel the host otherwise offers is ignored. No adapter MAY declare `forced`; the registry test SHALL fail an adapter that does. The value SHALL be observed only by `interlock run start` on the Workflow host, when `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set and the host version is at or above the version that introduced the variable or cannot be read, and SHALL be recorded on the run manifest in place of the assumed kind. A run on a runner host SHALL keep the model-selection kind its adapter declared, because its lanes are separate processes whose top-level model the variable does not govern.

#### Scenario: Happy path — FORCE on the Workflow host refines the manifest

- **GIVEN** `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` and a host whose version command reports `2.1.288`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the manifest's host records model selection `forced`
- **AND** `forced` is among the registry's legal values for that capability

#### Scenario: Failure — an adapter that declares the observed-only value is caught

- **GIVEN** an adapter registered with model selection `forced`
- **WHEN** the registry test sweeps every adapter's declared capabilities
- **THEN** it fails naming the adapter and the capability

#### Scenario: Edge case — the runner's host keeps its declaration

- **GIVEN** `interlock-run <change> --host claude` with `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` in the environment
- **WHEN** the run starts
- **THEN** the manifest's host records the model selection the adapter declared
- **AND** no `forced` value is recorded

### Requirement: The runner SHALL close the run when it receives SIGINT or SIGTERM

`interlock-run` SHALL trap `SIGINT` and `SIGTERM` and route each through its existing halting close exactly once, so a killed runner leaves a receipt, a terminal trajectory event and a resume card like any other halt. A second signal during the close SHALL NOT start a second close. A signal that arrives before the run program has returned its first step SHALL still reach the close, which reports that no manifest exists and exits non-zero.

#### Scenario: Happy path — SIGTERM during a lane leaves a receipt and a card

- **GIVEN** a runner with a lane in flight on a fixture host that holds its answer
- **WHEN** the runner process receives `SIGTERM`
- **THEN** the trajectory carries a `run-halt` whose reason names the signal
- **AND** a resume card is written and the runner exits non-zero

#### Scenario: Failure — a second signal during the close is ignored

- **GIVEN** a runner that has begun its close after `SIGINT`
- **WHEN** it receives `SIGTERM` before the close returns
- **THEN** exactly one close runs and exactly one `run-halt` is recorded

#### Scenario: Edge case — a signal before the first step still closes truthfully

- **GIVEN** a runner that receives `SIGTERM` before `run start` has returned
- **WHEN** the close runs
- **THEN** it reports that there is no run manifest and nothing was recorded
- **AND** the runner exits non-zero
