# hooks/tool-guards Specification

## Purpose

Three `PreToolUse` deny rules that make already-hit failure modes structural: an agent cannot weaken a test it is being asked to make pass, cannot hand-tick `tasks.md`, and cannot commit outside the commit stage.

## Requirements

### Requirement: Test-file edits SHALL be denied during remediation and fix-tests

A `PreToolUse` guard SHALL deny an `Edit` or `Write` tool call whose target path is a test file when the current stage is `remediation` or `fix-tests`. The set of test-file paths SHALL be determined from the project's own test locations (the same source `.claude/testing/profile.json` names), not a hard-coded glob, so the guard tracks where tests actually live.

#### Scenario: Happy path — test edit blocked during remediation
- **GIVEN** an active ship run with stage marker `remediation`
- **WHEN** an implementer agent issues an `Edit` targeting `test/spine/waves.test.mjs`
- **THEN** the guard returns a deny decision naming the file and the stage
- **AND** the Edit does not reach the filesystem

#### Scenario: Failure — non-test edit during remediation is allowed
- **GIVEN** an active ship run with stage marker `remediation`
- **WHEN** the agent issues an `Edit` targeting `lib/waves.mjs`
- **THEN** the guard allows the call
- **AND** emits no deny decision, since remediation is expected to change source

#### Scenario: Edge case — test edit during implementation is allowed
- **GIVEN** an active ship run with stage marker `implement`
- **WHEN** an agent edits a test file to add coverage for the feature it is building
- **THEN** the guard allows the Edit, because weakening a check is only a hazard once the check is the thing being satisfied

### Requirement: tasks.md checkbox edits by implementers SHALL be denied

A `PreToolUse` guard SHALL deny an `Edit` or `Write` that would change a checkbox line (`- [ ]` / `- [x]`) in a change's `tasks.md` while the stage is an implementation stage. The completion tick is written by the CLI from adjudicated outcomes (`2026-08-25-tick-tasks-from-recorded-outcomes`); a hand-edit is never the authority.

#### Scenario: Happy path — implementer hand-tick blocked
- **GIVEN** an active ship run with stage marker `implement`
- **WHEN** an implementer agent edits `tasks.md` to flip `- [ ]` to `- [x]`
- **THEN** the guard denies the Edit and names the checkbox line
- **AND** the checkbox state is unchanged

#### Scenario: Failure — non-checkbox edit to tasks.md is allowed
- **GIVEN** an active ship run in an implementation stage
- **WHEN** an edit to `tasks.md` changes only prose in a task body, leaving every checkbox marker byte-identical
- **THEN** the guard allows the Edit

#### Scenario: Edge case — the CLI's own tick is not the implementer
- **GIVEN** the CLI updates `tasks.md` checkboxes from recorded outcomes outside the agent's Edit tool
- **WHEN** that write occurs
- **THEN** the guard does not fire, because the guard scopes to the agent-facing Edit/Write tools and the CLI does not route through them

### Requirement: git commit SHALL be denied outside the commit stage

A `PreToolUse` guard on `Bash` SHALL deny a command that performs a `git commit` unless the current stage is `commit`. `skills/commit/SKILL.md:7` and `skills/mr/SKILL.md:7` already set `disable-model-invocation: true`; this guard is the deterministic enforcement of the same intent and SHALL match commit-equivalent invocations (e.g. `git commit`, `git -C <path> commit`), not only the literal prefix `git commit`.

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

### Requirement: A denied tool call SHALL report a machine-readable reason

Every deny decision SHALL emit the reason in the structure Claude Code's hook protocol expects, so the blocked agent receives the deny as feedback it can act on rather than an opaque failure.

#### Scenario: Happy path — deny carries a reason string
- **GIVEN** any guard that denies a call
- **WHEN** it returns its decision to the host
- **THEN** the decision includes a human-readable reason naming the guard, the offending path or command, and the current stage

#### Scenario: Failure — guard script itself throws
- **GIVEN** a guard script that hits an unexpected error while evaluating a call
- **WHEN** it cannot complete its decision
- **THEN** it exits in the allow/non-blocking direction rather than blocking on its own crash, and the error is written to stderr for diagnosis

#### Scenario: Edge case — tool call with no resolvable path
- **GIVEN** an `Edit` whose payload does not resolve to a concrete file path
- **WHEN** an edit guard evaluates it
- **THEN** the guard allows the call rather than denying on an unresolvable target
