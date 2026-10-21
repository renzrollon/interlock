## Purpose

Lets a ship run that stops while nobody is watching reach a person: one push message per terminal close to an ntfy topic the operator configured, sent by the CLI's own close so every host gets it, spoken in the summary when it was attempted, and absent by default so the CLI stays off the network for everyone who never asked.

## ADDED Requirements

### Requirement: The closing step SHALL post one message per terminal close when a topic is configured and the caller requested it

When `interlock run close` is invoked with `--notify` and a topic is configured, the close SHALL post exactly one message to that topic for the run's terminal outcome — a halt, a completion, or a completion with leftovers alike. When no topic is configured the close SHALL post nothing and SHALL NOT report a degradation, because an optional feature left unconfigured is not a degraded run. When `--notify` is absent the close SHALL post nothing even if a topic is configured, so that a developer's shell environment cannot make a test suite post.

#### Scenario: Happy path — a halted run is pushed at high priority

- **GIVEN** a configured topic and a run halted by the failure budget
- **WHEN** the driver calls `run close --halt <reason> --notify`
- **THEN** exactly one message is posted to that topic with ntfy priority `high`
- **AND** the summary carries a `push: sent (ntfy)` row

#### Scenario: Happy path — a clean completion is pushed at default priority

- **GIVEN** a configured topic and a run whose commit spawn reported a sha
- **WHEN** the driver calls `run close --notify` with the commit result
- **THEN** exactly one message is posted at ntfy's default priority
- **AND** the run's exit code is `0`, as it would have been without the push

#### Scenario: Edge case — no topic is configured

- **GIVEN** `INTERLOCK_NTFY_TOPIC` is unset
- **WHEN** the driver calls `run close --notify`
- **THEN** no request is made
- **AND** the summary carries no `push:` row and no push-related degradation banner

#### Scenario: Edge case — the flag is absent

- **GIVEN** a configured topic
- **WHEN** `run close` runs without `--notify`, as the suite's tests do outside the notification tests, which post only to a loopback stub
- **THEN** no request is made
- **AND** the summary carries no `push:` row

### Requirement: The message SHALL carry the terminal line, the change and the run id, and nothing that identifies the machine

The message title SHALL be the summary's first line — `SHIP HALTED — <reason>`, `SHIP COMPLETE WITH LEFTOVERS — <change>` or `SHIP COMPLETE — <change>` — produced by the same code that produces the printed summary, so the two cannot disagree. The body SHALL name the change and the run id, or state that no run id exists when the run halted before a plan was adopted. The message SHALL NOT carry the topic, the working directory, the project slug, any file path beyond what the halt reason itself contains, any diff, or any finding or suite text.

#### Scenario: Happy path — the body names the run

- **GIVEN** a halted run with run id `7c2f…` for change `add-thing`
- **WHEN** the message is composed
- **THEN** its title is `SHIP HALTED — <reason>` and its body names `add-thing` and `7c2f…`
- **AND** the body contains neither the topic nor the absolute working directory

#### Scenario: Edge case — the run halted before a plan was adopted

- **GIVEN** a run that halted at validation, so no run id was ever minted
- **WHEN** the message is composed
- **THEN** the body says that no run id exists because the run halted before a plan was adopted
- **AND** it does not print `null`, `undefined` or an empty field

#### Scenario: Failure — the topic never reaches any record

- **GIVEN** a configured topic and a run that closes with a push
- **WHEN** the summary, the receipt event and the trajectory are inspected
- **THEN** none of them contains the topic value
- **AND** the only push-related text in any of them is the outcome row or banner

### Requirement: The push outcome SHALL be spoken and SHALL NOT change the exit code

When a push was attempted the summary SHALL carry one row stating the outcome: `push: sent (ntfy)` on success, or `push: failed — <reason>` naming the condition (a non-2xx status, a network error, the timeout, or invalid configuration) without echoing the topic value. A failed push SHALL additionally appear as a `PUSH FAILED: <reason>` banner in the degradation block, so that the "No degradation banners" line is not printed for a run whose operator expected a message and got none. A push attempt SHALL be bounded by the published `notifyTimeoutMs` cap. The push outcome SHALL NOT alter the close's exit code or its first line.

#### Scenario: Failure — the server refuses the post

- **GIVEN** a configured topic whose server answers `403`
- **WHEN** the close attempts the push
- **THEN** the summary carries `push: failed — HTTP 403` and the degradation block carries `PUSH FAILED: HTTP 403`
- **AND** the "No degradation banners" line is not printed
- **AND** the exit code equals what the same close returns without `--notify`

#### Scenario: Failure — the network is unreachable or the post times out

- **GIVEN** a configured topic and a server that never answers
- **WHEN** the close attempts the push
- **THEN** the attempt ends within `notifyTimeoutMs` and the summary says the push failed and why
- **AND** the run's first line and exit code are unchanged

#### Scenario: Edge case — invalid configuration

- **GIVEN** a topic value containing whitespace or a slash, or a server URL that does not parse
- **WHEN** the close attempts the push
- **THEN** no request is made and the summary says the push failed because the configuration is invalid, naming which variable
- **AND** the offending value is not echoed

### Requirement: Configuration SHALL come from the environment and SHALL never be written to the tree

The topic SHALL be read from `INTERLOCK_NTFY_TOPIC` and the server from `INTERLOCK_NTFY_URL`, defaulting to `https://ntfy.sh` when the latter is unset. No file under the repository or under `.claude/` SHALL be read or written for this configuration. The documentation SHALL state that the topic is a capability — anyone who knows it reads every message — and that a self-hosted server is configured through the URL variable.

#### Scenario: Happy path — the public server by default

- **GIVEN** `INTERLOCK_NTFY_TOPIC=my-topic` and `INTERLOCK_NTFY_URL` unset
- **WHEN** the close posts
- **THEN** the request goes to `https://ntfy.sh/my-topic`

#### Scenario: Happy path — a self-hosted server

- **GIVEN** `INTERLOCK_NTFY_URL=https://ntfy.example.internal`
- **WHEN** the close posts
- **THEN** the request goes to `https://ntfy.example.internal/my-topic`
- **AND** nothing is read from `.claude/settings.json` or `.claude/settings.local.json`

### Requirement: No CLI path other than notify SHALL open a network connection

`interlock notify` and `interlock run close --notify` SHALL be the only invocations that make a network request. Every other subcommand SHALL remain runnable with no network, and a test SHALL pin that only the notification transport reaches for `fetch` and that no test in the suite passes `--notify` or invokes `interlock notify` against a real server. The published statement that the CLI runs without the network SHALL name this one exception.

#### Scenario: Happy path — a standalone notify from a terminal

- **GIVEN** a configured topic
- **WHEN** a person runs `interlock notify --title "<t>" --body "<b>"` (or the checkpoint form below)
- **THEN** one message is posted and the command exits `0` on success, non-zero with the reason on failure
- **AND** with no topic configured it prints that push is not configured and exits `0`

#### Scenario: Failure — a second module reaches for the transport

- **GIVEN** a decision module that imports the network transport
- **WHEN** the network-isolation test runs
- **THEN** it fails naming that module

### Requirement: The spec checkpoint SHALL announce itself through the same transport

When `/interlock:spec` stops at the human checkpoint it SHALL call `interlock notify checkpoint <change>` beside its `GOAL MET` line, so that a checkpoint reached while nobody is watching is pushed the same way a halt is. The call SHALL be pinned by token in the skill tests. With no topic configured the call is a no-op that exits `0`.

#### Scenario: Happy path — a checkpoint is pushed

- **GIVEN** a configured topic and a spec run that reached the checkpoint for `add-thing`
- **WHEN** the skill reaches its handoff
- **THEN** one message titled `SPEC CHECKPOINT — add-thing` is posted at default priority
- **AND** the skill still prints `GOAL MET: interlock spec stopped at the checkpoint.`

#### Scenario: Edge case — no topic

- **GIVEN** no topic configured
- **WHEN** the skill calls `interlock notify checkpoint add-thing`
- **THEN** the command prints that push is not configured and exits `0`
- **AND** the checkpoint proceeds unchanged
