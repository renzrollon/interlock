## MODIFIED Requirements

### Requirement: tasks.md checkbox edits by implementers SHALL be denied

A `PreToolUse` guard SHALL deny an `Edit` or `Write` that would change a checkbox line in a change's `tasks.md` while the stage is an implementation stage. A checkbox line is any line the task reader in `lib/artifacts.mjs` counts as a task. That includes `- [ ]` / `- [x]`, and also `+` and ordered-list markers and any one-character box. The guard SHALL read lines through that reader, not through a pattern of its own. The completion tick is written by the CLI from adjudicated outcomes (`2026-08-25-tick-tasks-from-recorded-outcomes`); a hand-edit is never the authority.

#### Scenario: Happy path — implementer hand-tick blocked
- **GIVEN** an active ship run with stage marker `implement`
- **WHEN** an implementer agent edits `tasks.md` to flip `- [ ]` to `- [x]`, or `+ [ ]` to `+ [x]`
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
