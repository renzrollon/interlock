## MODIFIED Requirements

### Requirement: git commit SHALL be denied outside the commit stage

A `PreToolUse` guard on `Bash` SHALL deny a command that performs a `git commit` unless the current stage is `commit`. `skills/commit/SKILL.md:7` and `skills/settle/SKILL.md:7` already set `disable-model-invocation: true`; this guard is the deterministic enforcement of the same intent and SHALL match commit-equivalent invocations (e.g. `git commit`, `git -C <path> commit`), not only the literal prefix `git commit`.

#### Scenario: Happy path — mid-run commit blocked
- **GIVEN** an active ship run with stage marker `implement`
- **WHEN** an agent runs `git commit -m "wip"` via Bash
- **THEN** the guard denies the command and names the stage it requires
- **AND** no commit is created

#### Scenario: Failure — commit during the commit stage is allowed
- **GIVEN** an active ship run with stage marker `commit`
- **WHEN** the commit step runs `git commit`
- **THEN** the guard allows the command

#### Scenario: Edge case — commit outside any ship run
- **GIVEN** no active ship run and no stage marker
- **WHEN** a developer runs `git commit` in their own terminal session
- **THEN** the guard allows the command, because the commit guard fails open when there is no run to constrain — its job is to bound *in-run* agents, not the human's own shell
