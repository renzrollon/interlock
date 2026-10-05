## ADDED Requirements

### Requirement: The test-edit guard SHALL read the test profile the run recorded when the working root has none

When the test-edit guard finds a live stage marker and the working root holds no test profile, it SHALL read the profile path the run manifest in the working root recorded at start and derive its test roots from that file, so a run in a linked worktree keeps the profile-derived roots of its main checkout. A manifest without a recorded path, a path that cannot be read, or no manifest at all SHALL leave the guard with the suffix rule alone, allowing as it does today. The guard SHALL NOT run version control to find the profile.

#### Scenario: Happy path — a worktree run keeps its test roots

- **GIVEN** a live `remediation` marker in a linked worktree with no profile, and a manifest recording the main checkout's profile path whose unit command names `test/`
- **WHEN** an implementer edits `test/helpers/setup.mjs`
- **THEN** the guard denies the edit, naming the stage

#### Scenario: Failure — the recorded path cannot be read

- **GIVEN** the same marker and a manifest whose recorded profile path no longer exists
- **WHEN** an implementer edits `test/helpers/setup.mjs`
- **THEN** the guard allows the edit, because it cannot establish the test roots
- **AND** an edit to `lib/a.test.mjs` is still denied by the suffix rule

#### Scenario: Edge case — no manifest

- **GIVEN** a live marker in a root with no profile and no manifest
- **WHEN** an implementer edits a file under `test/`
- **THEN** the guard allows it, as it does today, and spawns no process
