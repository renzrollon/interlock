# Spec Delta

## MODIFIED Requirements

### Requirement: Interlock SHALL never configure the advisor tool, and SHALL name no subagent an advisor

No Interlock command, hook, skill or host adapter SHALL write `advisorModel` to any settings file, run `/advisor`, or pass `--advisor` to any host. The plugin's `agents/` directory SHALL hold no agent whose name contains `advisor`. No skill SHALL spawn one, and `/interlock:review-code` SHALL accept no `--advisor` flag. `interlock advisor`, `interlock review-advisor` and `interlock review --advisor-brief` SHALL not exist.

A static test SHALL pin the rule. Among the files under `lib/`, `cli/`, `hooks/` and `workflows/`, only the pure configuration reader, which imports no `node:` module and so cannot write, SHALL spell `advisorModel`. The claude adapter's argv builder SHALL never emit `--advisor`, whatever it is given.

#### Scenario: Happy path — a configured machine runs with no flag added

- **GIVEN** `advisorModel` set to `opus` in the user's `~/.claude/settings.json`
- **WHEN** a ship run spawns its lanes on the Workflow host, and on the claude runner host
- **THEN** no spawn's options and no `claude -p` argv carries `--advisor`
- **AND** the static test finds `advisorModel` spelled only in the pure configuration reader under `lib/`, `cli/`, `hooks/` and `workflows/`

#### Scenario: Failure — a removed command is refused by name

- **GIVEN** a script written for 1.7.0
- **WHEN** it runs `interlock advisor "add-the-thing" --brief --json`, or `interlock review-advisor "add-the-thing" --check -`
- **THEN** the CLI exits non-zero with its unknown-subcommand error, and writes no file under the change

#### Scenario: Edge case — the agent directory and the review flag

- **GIVEN** the plugin as shipped
- **WHEN** the plugin-agents test lists `agents/*.md` and the skill suite reads `skills/review-code/SKILL.md`
- **THEN** no agent name contains `advisor`, and the review-code argument hint and flag text do not name `--advisor`
