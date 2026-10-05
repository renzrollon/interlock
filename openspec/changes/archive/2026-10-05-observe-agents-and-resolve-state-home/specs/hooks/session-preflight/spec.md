## ADDED Requirements

### Requirement: The preflight SHALL report whether a bare headless run would have a credential, as advice

`interlock doctor` SHALL carry a `claude-bare` row that reports, by name and never by value, whether `ANTHROPIC_API_KEY` is set or an `apiKeyHelper` is configured in a settings scope the doctor reads, whether `CLAUDE_CODE_SIMPLE` is set, and the vendor fact that the headless documentation recommends `--bare` and says it will become the default for print mode, under which OAuth and the keychain are never read and a plugin loads only through its directory flag. The row SHALL be `ok` when a key or a helper is present and `skip` otherwise, SHALL never be `fail`, and SHALL NOT change the preflight's exit status.

#### Scenario: Happy path — a key is present

- **GIVEN** an environment with `ANTHROPIC_API_KEY` set
- **WHEN** the doctor runs
- **THEN** the `claude-bare` row is `ok`, names the key by name only, and prints no value

#### Scenario: Failure — neither key nor helper

- **GIVEN** an environment with no key and settings with no `apiKeyHelper`
- **WHEN** the doctor runs
- **THEN** the row is `skip`, says a bare print-mode run would have no credential, and names the fix
- **AND** the doctor's exit status is unchanged by the row

#### Scenario: Edge case — a helper in one scope and an unreadable settings file

- **GIVEN** an `apiKeyHelper` in the user scope and a project settings file that is not valid JSON
- **WHEN** the doctor runs
- **THEN** the row is `ok` naming the user scope
- **AND** the unreadable file is not reported by this row and does not make it `fail`

### Requirement: The preflight SHALL report the state home and probe each state directory where it lives

`interlock doctor` SHALL carry a `state-home` row naming the resolved home and the surface, saying on a linked worktree that corpora are written to the home and that the test profile and graph are read from it when the root has none, and reporting `skip` with the reason when the resolver fell back, never `fail`. The state-directory row SHALL probe each directory under the home it belongs to: the trajectory, learning, metrics, handoff and interrupted-note directories under the state home, and the spill and agent-usage directories under the root, where the run writes them. The doctor's machine-readable output SHALL carry the resolved home.

#### Scenario: Happy path — a worktree session

- **GIVEN** the doctor run in a linked worktree of `/r`
- **WHEN** the report is printed
- **THEN** the `state-home` row names `/r` and `linked-worktree`
- **AND** the state-directory row's evidence names `/r/.claude/ship/runs` and the worktree's `.claude/ship/agent-usage`

#### Scenario: Failure — the home's fatal directory is unwritable

- **GIVEN** a main checkout whose `.claude/ship/runs` is read-only and a doctor run from its linked worktree
- **WHEN** the report is printed
- **THEN** the state-directory row fails naming that path, because a failed append there ends a run

#### Scenario: Edge case — the resolver fell back

- **GIVEN** a root where version control cannot be read
- **WHEN** the doctor runs
- **THEN** the `state-home` row is `skip` with the reason and the JSON carries the root as the home

### Requirement: The SessionStart preflight SHALL read interrupted-run notes from the state home the doctor resolved

The preflight SHALL read the home from the doctor's machine-readable output and surface unspoken interrupted-run notes from that home's notes directory, marking nothing, so a worktree session reports the notes a worktree run left in the main checkout. When the doctor's output carries no home the preflight SHALL read from the working directory as before.

#### Scenario: Happy path — a note in the main checkout is surfaced in the worktree

- **GIVEN** an unspoken note under `/r/.claude/ship/interrupted/` and a session starting in a linked worktree of `/r`
- **WHEN** the preflight runs
- **THEN** its output carries the note's line and the note is still unspoken afterwards

#### Scenario: Failure — the doctor could not run

- **GIVEN** a preflight whose doctor invocation produced no readable output
- **WHEN** the preflight runs
- **THEN** it reads notes from the working directory, says the preflight could not run, and exits 0

#### Scenario: Edge case — a note in the worktree itself

- **GIVEN** a note written under the worktree's own `.claude/ship/interrupted/` by a run whose manifest recorded no home
- **WHEN** the preflight runs in that worktree with the doctor resolving `/r`
- **THEN** the note under `/r` is read and the worktree's own note is read too, so neither is lost
