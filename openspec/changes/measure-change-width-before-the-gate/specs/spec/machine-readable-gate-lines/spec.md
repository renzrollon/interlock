# Spec Delta

## MODIFIED Requirements

### Requirement: The validate line SHALL request JSON and read ready as the verdict

The spec skill's artifact validation SHALL be run as `interlock validate "<name>" --json`, and the review-artifacts skill's change resolution SHALL keep its `interlock validate [change-name] --json` form. Each skill SHALL state, in one sentence beside its line, that `ready` is the verdict, that `problems` is the list to fix, and that an output carrying `error` and `candidates` in place of `ready` means the change name did not resolve. The exit code SHALL be the same with `--json` as without it: non-zero exactly when `ready` is false, and non-zero when the name did not resolve. The skill SHALL NOT infer readiness from the presence of files. The output SHALL also carry `width`: `capabilities`, `tasks`, `caps` (`maxChangeCapabilities`, `maxChangeTasks`), `wide` and `over`; a wide change SHALL still be `ready`, and the spec skill SHALL read `width.wide` from the same output, running no artifact gate and stopping at the checkpoint with a split when it is true, and saying `CHANGE WIDTH: not reported by this CLI` and continuing when the field is absent.

#### Scenario: Happy path — an implementable change reads ready from one field

- **GIVEN** a change whose `proposal.md`, `design.md` and `tasks.md` are present and non-empty and whose `tasks.md` carries at least one checkbox task
- **WHEN** the spec skill runs `interlock validate "<name>" --json`
- **THEN** the output is a JSON object whose `ready` is `true`, whose `missing` is empty and whose `problems` is empty
- **AND** the command exits `0`

#### Scenario: Failure — a change with no checkbox tasks is not ready and names why

- **GIVEN** a change whose three artifacts are present but whose `tasks.md` holds no checkbox line
- **WHEN** the spec skill runs `interlock validate "<name>" --json`
- **THEN** the output's `ready` is `false` and `problems` carries an entry saying `tasks.md` contains no checkbox task lines
- **AND** the command exits `1`
- **AND** the skill fixes what `problems` names before continuing, and does not proceed to the artifact review

#### Scenario: Edge case — a wide change is ready and says so

- **GIVEN** a change whose three artifacts are present, whose `tasks.md` carries checkbox tasks, and whose delta spec files outnumber `maxChangeCapabilities`
- **WHEN** the spec skill runs `interlock validate "<name>" --json`
- **THEN** `ready` is `true`, `width.wide` is `true`, `width.over` holds `capabilities`, and the command exits `0`
- **AND** the skill prints the command's `CHANGE WIDE:` line, runs no artifact gate, and stops at the checkpoint with the split

#### Scenario: Edge case — a name that does not resolve is reported as an error, not as not-ready

- **GIVEN** a change name that does not exist under `openspec/changes/`, or no name while several changes are active
- **WHEN** either skill runs its validate line with `--json`
- **THEN** the output is a JSON object carrying `error` and `candidates` and no `ready` field
- **AND** the command exits `1`
- **AND** the review-artifacts skill picks the change the user named, or the most recently modified candidate and says which; the spec skill names its own change explicitly on the line
