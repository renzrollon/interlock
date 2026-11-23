# Delta for effort-routing

## ADDED Requirements

### Requirement: A verify spawn SHALL carry the model and effort published for its check

The first attempt of an inter-wave check SHALL carry the published verify model and verify effort. Each inter-wave fix attempt SHALL carry no model, so it runs on the session model, and the published verify retry effort. The final check SHALL carry no model and the published final verify effort. The defaults are Sonnet with `medium` for the first attempt, `xhigh` for a fix attempt and `high` for the final check. The choice MUST be derived from the step's context and attempt counter.

#### Scenario: Happy path — the first inter-wave check runs on the published model

- **GIVEN** an inter-wave verify step on its initial attempt
- **WHEN** the run program emits it, on either driver
- **THEN** its spawn carries the published verify model and the published verify effort

#### Scenario: Happy path — a red check escalates to the session model

- **GIVEN** an inter-wave verify whose first attempt reported a red unit suite
- **WHEN** the run program emits each fix attempt of that wave
- **THEN** each spawn carries no model and the published verify retry effort

#### Scenario: Happy path — the final check stays on the session model

- **GIVEN** a run that reaches its final check, which has no attempt counter
- **WHEN** the run program emits it
- **THEN** its spawn carries no model and the published final verify effort

#### Scenario: Failure — a verify spawn emitted without an effort fails the suite

- **GIVEN** a run program whose verify spawn carries no effort
- **WHEN** the test that reaches a verify step compares the spawn's effort with the published effort for that check
- **THEN** the test fails naming the verify spawn
- **AND** the failure is a test failure before any run, not a verify agent quietly running at a host default

#### Scenario: Failure — a published verify model nothing reads fails the suite

- **GIVEN** a run program whose first inter-wave check ignores the published verify model
- **WHEN** the test compares that spawn's model with the published value
- **THEN** the test fails naming the verify spawn

#### Scenario: Edge case — a fix attempt resumed after a halt routes as it did before

- **GIVEN** a run halted while a wave's second verify attempt was owed
- **WHEN** the run is resumed and emits that attempt
- **THEN** its spawn carries no model and the published verify retry effort
- **AND** both were derived from the step's attempt counter, not from anything the resumed process remembered

#### Scenario: Edge case — a host that cannot apply the model or effort still runs the spawn

- **GIVEN** a host with no mapping for the published verify model, or no way to apply the effort
- **WHEN** it receives the first inter-wave check
- **THEN** the spawn runs on the host's default
- **AND** the routing event says what was not applied

## MODIFIED Requirements

### Requirement: The effort-by-tier defaults are published, not restated

The tier→effort mapping, the three verify efforts, the verify model and the skeptic effort SHALL live in `lib/limits.mjs` and be surfaced by `interlock limits`, so the mapping is read at one source rather than re-stated in prose or duplicated in code that can drift.

Every effort the limits surface prints SHALL be read by the code path it governs. A published effort that nothing reads SHALL fail the cap-authority check, on the same terms as every other published cap. `interlock limits` SHALL print the effort of the first inter-wave check, of an inter-wave fix attempt and of the final check in three rows, each labelled with the check it governs, and the verify model in a row labelled as governing the first inter-wave check. `interlock limits --json` SHALL carry all four.

Rationale: "a cap written down twice is a cap that drifts" — the same reason the wave caps already live in `lib/limits.mjs`. A value that is printed and never read is the same failure from the other side: `interlock limits` printed a verify effort while the verify step ran at the host's default.

#### Scenario: Happy path — interlock limits surfaces the effort mapping

- **GIVEN** an operator runs `interlock limits`
- **WHEN** they read the output
- **THEN** it shows the tier→effort defaults, the three verify efforts, the verify model and the skeptic effort
- **AND** each verify row names the check it governs

#### Scenario: Failure — no code path hardcodes a tier→effort threshold beside the published one

- **GIVEN** the run program, the wave planner and both drivers
- **WHEN** the suite sweeps each of them for an effort level written beside an `effort` key
- **THEN** none is found, because every effort is read from the published `lib/limits.mjs` source
- **AND** a level written a second time in any of the four fails the sweep naming the file

#### Scenario: Failure — a published effort with no reader fails the suite

- **GIVEN** an effort that appears in the printed limits output and is read by no code path
- **WHEN** the cap-authority check runs
- **THEN** the check fails and names the unread effort

#### Scenario: Edge case — changing a default in limits re-routes without other edits

- **GIVEN** the tier-3 default is changed in `lib/limits.mjs` from `medium` to `high`
- **WHEN** a tier-3 lane is next planned
- **THEN** its emitted effort is `high`
- **AND** no edit to the routing functions was required to effect the change

#### Scenario: Edge case — a plan stored under another effort table is rebuilt, naming the table

- **GIVEN** a stored plan and fingerprint built under one tier→effort table, or before the table was part of the fingerprint
- **WHEN** the table in `lib/limits.mjs` differs from the one the plan was built under and the next run checks plan reuse
- **THEN** the plan is rebuilt, not reused, so its lane report cannot name an effort the spawn does not carry
- **AND** the reuse reason names `effortByTier` and does not say the artifacts were edited

## REMOVED Requirements

### Requirement: A verify spawn SHALL carry the verify effort on a first attempt and the retry effort on a fix attempt

**Reason**: The first inter-wave check and the final check no longer share a model or an effort, so the two scenarios that say they do cannot be kept.

**Migration**: Read "A verify spawn SHALL carry the model and effort published for its check". `interlock limits` prints the value for each check.
