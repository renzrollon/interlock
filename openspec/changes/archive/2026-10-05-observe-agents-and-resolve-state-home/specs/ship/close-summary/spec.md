## MODIFIED Requirements

### Requirement: The summary SHALL name the run and where it closed

Every terminal summary SHALL carry a `run: <runId>` row, a `project: <slug>` row and a `cwd: <absolute path>` row, and SHALL carry a `state home: <absolute path>` row directly under the `cwd:` row whenever the run's state home differs from the directory the close ran in, and no such row when the two are equal. `<runId>` is the trajectory's run id; when the run halted before a plan was adopted and therefore has no run id, the row SHALL read `run: none — the run halted before a plan was adopted` rather than printing an empty value. `<slug>` is the directory name the host uses under `~/.claude/projects` for the directory the close ran in: the absolute path with every character outside ASCII letters and digits replaced by `-`. The documentation SHALL state that the slug is derived from the directory the close ran in, which is the host's project directory only when the session was started there, and that the state home is where the run's corpora were written.

#### Scenario: Happy path — a clean run names itself

- **GIVEN** a run with run id `7c2f…` closing in `/Users/x/IdeaProjects/specflow`
- **WHEN** the summary is printed
- **THEN** it carries `run: 7c2f…`, `project: -Users-x-IdeaProjects-specflow` and `cwd: /Users/x/IdeaProjects/specflow`
- **AND** both hosts print the same three rows for the same run state, and no `state home:` row

#### Scenario: Happy path — a linked-worktree run names its state home

- **GIVEN** a run closing in `/r/.claude/worktrees/w1` whose state home is `/r`
- **WHEN** the summary is printed
- **THEN** it carries `cwd: /r/.claude/worktrees/w1` and, on the next row, `state home: /r`

#### Scenario: Edge case — a halt before any plan was adopted

- **GIVEN** a run that halted at validation, so the manifest carries no run id
- **WHEN** the summary is printed
- **THEN** the run row reads `run: none — the run halted before a plan was adopted`
- **AND** the project and cwd rows are still printed

#### Scenario: Edge case — the slug rule over dots, spaces and underscores

- **GIVEN** the close ran in `/Users/x/Application Support/repo/.claude/worktrees/w_1`
- **WHEN** the slug is derived
- **THEN** it is `-Users-x-Application-Support-repo--claude-worktrees-w-1`
- **AND** the derivation is a pure function of the path with no filesystem access

#### Scenario: Edge case — a halt before run start in a worktree

- **GIVEN** a close with no manifest, run from a linked worktree whose home resolves to `/r`
- **WHEN** the summary is printed
- **THEN** it carries the `cwd:` row and the `state home: /r` row, so the reader knows where a record would have gone
