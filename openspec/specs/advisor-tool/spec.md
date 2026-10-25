# advisor-tool Specification

## Purpose

How Interlock works with Claude Code's own advisor tool, which only the user can turn on. Interlock reads whether it is configured, says so in doctor and in a ship run, and counts the consults it can see. It asks no lane and no session to consult, never turns the tool on, and never names a subagent an advisor.

## Requirements

### Requirement: Interlock SHALL never configure the advisor tool, and SHALL name no subagent an advisor

No Interlock command, hook, skill or host adapter SHALL write `advisorModel` to any settings file, run `/advisor`, or pass `--advisor` to any host. The plugin's `agents/` directory SHALL hold no agent whose name contains `advisor`. No skill SHALL spawn one, and `/interlock:review-code` SHALL accept no `--advisor` flag. `interlock advisor`, `interlock review-advisor` and `interlock review --advisor-brief` SHALL not exist.

A static test SHALL pin the rule. Among the files under `lib/`, `bin/`, `hooks/` and `workflows/`, only the pure configuration reader, which imports no `node:` module and so cannot write, SHALL spell `advisorModel`. The claude adapter's argv builder SHALL never emit `--advisor`, whatever it is given.

#### Scenario: Happy path — a configured machine runs with no flag added

- **GIVEN** `advisorModel` set to `opus` in the user's `~/.claude/settings.json`
- **WHEN** a ship run spawns its lanes on the Workflow host, and on the claude runner host
- **THEN** no spawn's options and no `claude -p` argv carries `--advisor`
- **AND** the static test finds `advisorModel` spelled only in the pure configuration reader under `lib/`, `bin/`, `hooks/` and `workflows/`

#### Scenario: Failure — a removed command is refused by name

- **GIVEN** a script written for 1.7.0
- **WHEN** it runs `interlock advisor "add-the-thing" --brief --json`, or `interlock review-advisor "add-the-thing" --check -`
- **THEN** the CLI exits non-zero with its unknown-subcommand error, and writes no file under the change

#### Scenario: Edge case — the agent directory and the review flag

- **GIVEN** the plugin as shipped
- **WHEN** the plugin-agents test lists `agents/*.md` and the skill suite reads `skills/review-code/SKILL.md`
- **THEN** no agent name contains `advisor`, and the review-code argument hint and flag text do not name `--advisor`

### Requirement: Doctor SHALL report the advisor configuration by scope and never fail on it

`interlock doctor` SHALL carry one `advisor` row, built from the four settings scopes it already reads (managed, user, project, local) and from `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`. Its status:
- **`ok`** when at least one scope sets `advisorModel` to a non-empty string and the variable is not enabled. The detail names those scopes, says Claude decides when to consult, and says Interlock counts consults and never records the advice.
- **`skip`** when no scope sets it. The detail says a session's `--advisor` flag is not visible to doctor, and the fix says `Run /advisor <model> to turn it on. Interlock cannot: a plugin's settings apply only agent and subagentStatusLine.`
- **`skip`** when the variable is enabled. The detail names the variable and the scopes whose setting it overrides.

A scope sets `advisorModel` only when its value is a non-empty string; any other value reads as unset. A settings file that does not read, does not parse, or parses to something other than a JSON object is unreadable. Every unreadable file SHALL be named in the detail with its reason, whatever the status. An unreadable file SHALL NOT demote an `ok` row: a scope that sets the key is evidence on its own.

The row SHALL name scopes and never print the configured value. It SHALL never be `fail`: an unreadable file with no scope set, or a throw inside the check, SHALL make it `skip` with the reason.

#### Scenario: Happy path — set in two scopes

- **GIVEN** `advisorModel` set in the user scope and in the project scope, and the variable unset
- **WHEN** `interlock doctor --json` runs
- **THEN** the `advisor` row is `ok` and names `user` and `project`, and the model name does not appear in the row

#### Scenario: Failure — unset in every scope

- **GIVEN** no settings scope setting `advisorModel`, and the variable unset
- **WHEN** `interlock doctor --json` runs
- **THEN** the `advisor` row is `skip`, its detail says a session's `--advisor` flag is not visible to doctor, and its fix reads `Run /advisor <model> to turn it on. Interlock cannot: a plugin's settings apply only agent and subagentStatusLine.`

#### Scenario: Failure — an unparseable settings file

- **GIVEN** a `.claude/settings.local.json` that is not valid JSON, and no other scope setting `advisorModel`
- **WHEN** `interlock doctor` runs
- **THEN** the `advisor` row is `skip`, names `local` and the parse reason, and doctor's exit code is what it would have been without the row

#### Scenario: Edge case — set in one scope while another does not parse

- **GIVEN** `advisorModel` set in the user scope, a `.claude/settings.local.json` that is not valid JSON, and the variable unset
- **WHEN** `interlock doctor --json` runs
- **THEN** the `advisor` row is `ok`, names `user`, and its detail also names `local` and the parse reason

#### Scenario: Edge case — a value that is not a string, and a file that is not an object

- **GIVEN** a user settings file setting `advisorModel` to `5`, and a project `.claude/settings.json` whose whole content is `[]`
- **WHEN** `interlock doctor --json` runs
- **THEN** the `advisor` row is `skip`, no scope is named as setting the key, and the detail names `project` as not read because it is not an object

#### Scenario: Edge case — disabled by the environment

- **GIVEN** `advisorModel` set in the user scope and `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1`
- **WHEN** `interlock doctor` runs
- **THEN** the `advisor` row is `skip` and says the variable is set, so `advisorModel` in `user` is ignored

### Requirement: A ship run SHALL say at start when an advisor is configured or disabled

`interlock run start --host workflow` SHALL read the four settings scopes and `CLAUDE_CODE_DISABLE_ADVISOR_TOOL`, and SHALL record what it read on the manifest's host environment as the scopes setting `advisorModel`, the scopes that could not be read, and whether the variable is enabled. The start step's notes:
- When a scope sets it and the tool is not disabled: `ADVISOR CONFIGURED (<scopes>): lanes the engine pairs with it may consult it; consults are counted per lane, the advice is not recorded, and its spend is not established`.
- When a scope sets it and the variable is enabled: `ADVISOR DISABLED: CLAUDE_CODE_DISABLE_ADVISOR_TOOL is set, so advisorModel in <scopes> is ignored`.
- For each scope that could not be read: `ADVISOR CONFIGURATION NOT READ: <scope> settings (<reason>)`.
- When no scope sets it: nothing.

Every later step of the run, the close included, SHALL read this recorded observation, and nothing SHALL re-read the settings mid-run. A relaunch is a new `run start` and reads them again.

`interlock-run`, on a host that drives the Claude binary, SHALL add the same texts to its banners, with `consults are not counted on this host` in place of `consults are counted per lane`. A host that does not drive the Claude binary SHALL add none. No note SHALL say the advisor is active or claim a spend figure.

#### Scenario: Happy path — configured in the user scope

- **GIVEN** `advisorModel` set in `~/.claude/settings.json` and the variable unset
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step's notes include `ADVISOR CONFIGURED (user): …` with the words `the advice is not recorded` and `its spend is not established`
- **AND** the manifest records the scope `user` and `disabled: false`, and no banner names the advisor

#### Scenario: Failure — a settings file that cannot be read is spoken, and the run continues

- **GIVEN** a project `.claude/settings.json` that is not valid JSON
- **WHEN** `interlock run start --host workflow` runs
- **THEN** the step's notes include `ADVISOR CONFIGURATION NOT READ: project settings (<reason>)`, and the step is the one it would otherwise have been

#### Scenario: Edge case — unset, and a runner host

- **GIVEN** no scope setting `advisorModel`
- **WHEN** `interlock run start --host workflow` runs
- **THEN** no note or banner names the advisor
- **AND** with `advisorModel` set and `interlock-run --host claude` driving the run, the banners include `ADVISOR CONFIGURED (user): … consults are not counted on this host …`, and with `--host codex` no banner names the advisor

### Requirement: No briefing and no skill SHALL ask for an advisor consult

Interlock SHALL ask no ship lane and no spec session to consult the advisor tool. A run whose manifest records a configured advisor SHALL emit every briefing byte-identical to the briefing the same step emits from a manifest that records none, with the same sha256 on its bootstrap. No shipped skill SHALL ask the session to consult the tool. A lane or session the engine pairs with the advisor may still consult it unprompted; the counts record that.

#### Scenario: Happy path — a configured run's briefings equal an unconfigured run's

- **GIVEN** two manifests for the same change, one recording `advisorModel` in the user scope and not disabled, the other recording no scope
- **WHEN** the run program emits the same implementer step and the same remediation step from each
- **THEN** the two briefings are byte-identical and their bootstrap sha256 values are equal

#### Scenario: Failure — a skill reword that adds a consult request fails

- **GIVEN** a revision of `skills/spec/SKILL.md` that adds a sentence asking the session to consult the advisor tool before writing `design.md`
- **WHEN** the skill suite runs
- **THEN** the pin fails naming `skills/spec/SKILL.md`

#### Scenario: Edge case — the prompt snapshots are unchanged

- **GIVEN** this change applied
- **WHEN** the prompt snapshot tests assemble every briefing under `test/fixtures/prompts/`
- **THEN** each matches its snapshot unchanged

### Requirement: A ship run SHALL count advisor consults per lane and never read an unknown count as zero

The transcript reader SHALL count, per recorded agent, the distinct `server_tool_use` content blocks named `advisor` across every assistant row of its transcript, keyed by block id, before rows are grouped by message. A block with no string id SHALL count once for the row it is on. A block whose name is not the string `advisor` SHALL not count. A row that is not an assistant message, or whose content is not an array, SHALL add nothing and SHALL NOT by itself make the result `null`. The result SHALL be a number when at least one transcript line parsed, and `null` otherwise.

At close on the Workflow host, the summary SHALL gain one line when the manifest recorded a configured advisor or the counted sum is above 0:
- `advisor consults: <n> across <m> lanes`, when every briefed spawn joined a transcript that parsed and the sum is above 0
- `advisor consults: not established (<k> of <m> lanes unrecorded)`, when a briefed spawn joined no parsed transcript
- `advisor consults: not established (none recognized in <m> lanes)`, when every lane parsed and the sum is 0

The close SHALL never print a recognized zero as `advisor consults: 0`. The block shape is read from the binary, not yet from a real lane transcript, and a shape the reader does not know would read as zero.

With `--json`, the close output SHALL carry `advisorConsults: { count, lanes, unrecorded }` exactly when the text line is printed, where `count` is `null` when not established. Every other line and field of the summary SHALL stay as it is.

#### Scenario: Happy path — three consults over two lanes

- **GIVEN** a configured run whose two briefed lanes' transcripts carry, between them, three `server_tool_use` blocks named `advisor` with distinct ids
- **WHEN** `interlock run close` runs
- **THEN** the summary carries `advisor consults: 3 across 2 lanes`

#### Scenario: Failure — one lane was not recorded

- **GIVEN** a configured run with three briefed lanes, one of which joined no transcript
- **WHEN** `interlock run close` runs
- **THEN** the summary carries `advisor consults: not established (1 of 3 lanes unrecorded)`, and never `advisor consults: 0`
- **AND** with `--json`, `advisorConsults` is `{ count: null, lanes: 3, unrecorded: 1 }`

#### Scenario: Failure — every lane parsed and no advisor block was recognized

- **GIVEN** a configured run with two briefed lanes whose transcripts both parse and carry no `server_tool_use` block named `advisor`
- **WHEN** `interlock run close` runs
- **THEN** the summary carries `advisor consults: not established (none recognized in 2 lanes)`, and never `advisor consults: 0`
- **AND** with `--json`, `advisorConsults` is `{ count: null, lanes: 2, unrecorded: 0 }`

#### Scenario: Edge case — a block repeated across rows, and an unconfigured run

- **GIVEN** a transcript where the same advisor block id appears on two rows that share a message id
- **WHEN** the transcript is read
- **THEN** it counts one consult
- **AND** an advisor block with no id counts once for its row, and a user row or an assistant row whose content is a string adds nothing and leaves the result a number
- **AND** in a run whose manifest recorded no advisor and whose lanes made no consult, the summary carries no advisor line

### Requirement: The spec skill SHALL forbid configuring the advisor tool and report its use at the hand-off

`skills/spec/SKILL.md` SHALL say, without asking the session to consult the tool:
- never run `/advisor` or edit `advisorModel`, because the choice and its spend are the user's
- if the session consults it, the advice is guidance, and a conflict with the evidence becomes a ledger row
- a call that fails is said at the hand-off and never retried, and the spec continues

The hand-off SHALL report whether the tool was available to the session, or `not available in this session`, and the consults made, as the session's own account. It SHALL name the spec meter's advisor line as the record of the count. The skill suite SHALL pin these as tokens: `/advisor`, `advisorModel`, `ledger row`, `not available in this session`, `retried`, `own account`, and `spec meter`.

#### Scenario: Happy path — the shipped skill carries the tokens

- **GIVEN** `skills/spec/SKILL.md` as shipped by this change
- **WHEN** the skill suite runs
- **THEN** each token is found, and the hand-off section names the advisor tool's availability

#### Scenario: Failure — a reword that drops the prohibition fails

- **GIVEN** a revision that removes the sentence forbidding `/advisor` and `advisorModel` edits
- **WHEN** the skill suite runs
- **THEN** the pin fails naming `skills/spec/SKILL.md` and the missing token

#### Scenario: Edge case — the skill no longer grants itself an agent spawn

- **GIVEN** `skills/spec/SKILL.md` as shipped
- **WHEN** the skill suite reads its frontmatter
- **THEN** `allowed-tools` does not list `Agent`, and the description does not name `advisor.md`
