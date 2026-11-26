# Spec Delta

## MODIFIED Requirements

### Requirement: The artifact-review gate line SHALL request JSON and read passed as the verdict

The review-artifacts skill's gate SHALL be run as `interlock gate --findings <findings file> --metrics <change> --stage artifacts [--depth <depth>] --reviewer <reader> --lenses <names|none> --json`, with `--metrics <change>` and `--stage artifacts` kept on the line. The skill SHALL state, in one sentence beside the line, that `passed` is the verdict, that `blockers` and `malformed` are what to report, that `metrics.written` and `metrics.reason` say whether the metrics record landed, and that `autonomyOutcome.blockers` is the blocker count the spec skill passes to the autonomy record. The spec skill SHALL take the `<n>` of `interlock autonomy record review-artifacts --blockers <n>` from the gate's `autonomyOutcome.blockers`, never from a count written in the review's prose. The exit code SHALL be the same with `--json` as without it: non-zero exactly when `passed` is false. The recording flags SHALL move neither the verdict nor the exit code. The skill SHALL keep stating that the exit status is the verdict and SHALL keep its instruction not to re-derive the verdict in prose.

#### Scenario: Happy path — a clean gate passes and records its metrics

- **GIVEN** a findings file with no `blocker` finding and every severity a recognized value
- **WHEN** the review-artifacts skill runs the gate line with `--json`
- **THEN** the output's `passed` is `true`, `blockers` and `malformed` are empty, `autonomyOutcome.blockers` is `0`, and `metrics.written` is `true` with `metrics.path` naming the record
- **AND** the command exits `0`
- **AND** the spec skill runs `interlock autonomy clean review-artifacts explore spec`

#### Scenario: Failure — a blocker blocks, is reported from the array, and reaches the autonomy record as a field

- **GIVEN** a findings file with one `blocker` finding and one `warning`
- **WHEN** the review-artifacts skill runs the gate line with `--json`
- **THEN** the output's `passed` is `false`, `blockers` carries the one finding with its `file`, `line` and `title`, `counts.blocker` is `1` and `autonomyOutcome.blockers` is `1`
- **AND** the command exits `1`
- **AND** the review-artifacts skill reports the entries of `blockers` and halts
- **AND** the spec skill runs `interlock autonomy record review-artifacts --blockers 1`, the `1` read from `autonomyOutcome.blockers`

#### Scenario: Edge case — a malformed severity blocks with zero blockers, and a failed metrics write moves nothing

- **GIVEN** a findings file whose one finding carries a severity outside the recognized set, in a repository where the metrics directory cannot be written
- **WHEN** the review-artifacts skill runs the gate line with `--json`
- **THEN** the output's `passed` is `false`, `blockers` is empty, `malformed` carries the finding with its `reason`, and `metrics.written` is `false` with a non-empty `metrics.reason`
- **AND** the command exits `1`, the same exit it gives when the write succeeds
- **AND** the skill reports the malformed finding and the unwritten record by their reasons, and does not treat the failed write as the cause of the block

#### Scenario: Edge case — the stage and reader flags are pinned on the line

- **GIVEN** a revision of `skills/review-artifacts/SKILL.md` whose gate line drops `--stage artifacts` or `--reviewer`
- **WHEN** the skill suite runs
- **THEN** it fails naming `skills/review-artifacts/SKILL.md` and the missing flag, and the `--metrics` and `--json` pins still pass
