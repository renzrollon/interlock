# spec/machine-readable-gate-lines Specification

## Purpose

Makes the three Interlock verdicts the spec flow reaches — the decision-ledger audit, the artifact validation and the artifact-review gate — cross the Bash tool as JSON with a named verdict field, so a reader of the spec session's output (the model, and any observer keyed on those lines) takes the CLI's verdict from a field rather than from a sentence, while the exit code stays the contract. Pins the lines, their fields and their order in the skill suite, so a reword cannot silently return the flow to prose.

## Requirements

### Requirement: The ledger audit line SHALL request JSON and read blocking as the verdict

The spec skill's decision-ledger audit SHALL be run as `interlock ledger "<name>" --json`. The skill SHALL state, in one sentence beside the line, that `blocking` is the verdict, that the `needs_human` entries of `rows` and the entries of `invalidRows` are what to report, and that `missing` and `unparseable` are why a ledger with no rows still blocks. The exit code of the audit SHALL be the same with `--json` as without it: non-zero exactly when `blocking` is true. The skill SHALL NOT re-derive the verdict from the rows, SHALL NOT compare any count, and SHALL NOT read a ledger with zero rows as clear when `missing` or `unparseable` is true.

#### Scenario: Happy path — a resolved ledger reads as clear from one field

- **GIVEN** a change whose `decisions.md` exists and whose every row is a valid `agent_resolved` row recorded by id in `design.md`
- **WHEN** the spec skill runs `interlock ledger "<name>" --json`
- **THEN** the output is a JSON object whose `blocking` is `false`, whose `missing` and `unparseable` are `false`, and whose `needsHuman` and `invalidCount` are `0`
- **AND** the command exits `0`
- **AND** the skill continues to validation without reading any other field as a verdict

#### Scenario: Failure — a needs_human row blocks and is reported from the rows array

- **GIVEN** a change whose `decisions.md` holds one valid `needs_human` row and one `agent_resolved` row whose evidence cell is empty
- **WHEN** the spec skill runs `interlock ledger "<name>" --json`
- **THEN** the output's `blocking` is `true`, `needsHuman` is `1`, `invalidCount` is `1`, `rows` carries the `needs_human` row with its `id` and `question`, and `invalidRows` carries the invalid row with its `reason`
- **AND** the command exits `1`
- **AND** the skill reports those entries by `id` and `question` or `reason` and does not count blockers itself

#### Scenario: Edge case — an absent ledger blocks with zero rows and says so

- **GIVEN** a change with no `decisions.md`
- **WHEN** the spec skill runs `interlock ledger "<name>" --json`
- **THEN** the output's `exists` is `false`, `missing` is `true`, `blocking` is `true` and `total` is `0`
- **AND** the command exits `1`
- **AND** the skill reports the ledger as missing, never as "nothing needs a human"

### Requirement: The validate line SHALL request JSON and read ready as the verdict

The spec skill's artifact validation SHALL be run as `interlock validate "<name>" --json`, and the review-artifacts skill's change resolution SHALL keep its `interlock validate [change-name] --json` form. Each skill SHALL state, in one sentence beside its line, that `ready` is the verdict, that `problems` is the list to fix, and that an output carrying `error` and `candidates` in place of `ready` means the change name did not resolve. The exit code SHALL be the same with `--json` as without it: non-zero exactly when `ready` is false, and non-zero when the name did not resolve. The skill SHALL NOT infer readiness from the presence of files.

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

#### Scenario: Edge case — a name that does not resolve is reported as an error, not as not-ready

- **GIVEN** a change name that does not exist under `openspec/changes/`, or no name while several changes are active
- **WHEN** either skill runs its validate line with `--json`
- **THEN** the output is a JSON object carrying `error` and `candidates` and no `ready` field
- **AND** the command exits `1`
- **AND** the review-artifacts skill picks the change the user named, or the most recently modified candidate and says which; the spec skill names its own change explicitly on the line

### Requirement: The artifact-review gate line SHALL request JSON and read passed as the verdict

The review-artifacts skill's gate SHALL be run as `interlock gate --findings <findings file> --metrics <change> --json`, with `--metrics <change>` kept on the line. The skill SHALL state, in one sentence beside the line, that `passed` is the verdict, that `blockers` and `malformed` are what to report, that `metrics.written` and `metrics.reason` say whether the metrics record landed, and that `autonomyOutcome.blockers` is the blocker count the spec skill passes to the autonomy record. The spec skill SHALL take the `<n>` of `interlock autonomy record review-artifacts --blockers <n>` from the gate's `autonomyOutcome.blockers`, never from a count written in the review's prose. The exit code SHALL be the same with `--json` as without it: non-zero exactly when `passed` is false. The skill SHALL keep stating that the exit status is the verdict and SHALL keep its instruction not to re-derive the verdict in prose.

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

### Requirement: The lines an observer of the spec flow keys on SHALL be pinned by token

The skill suite SHALL assert, as tokens matched on the fenced command line and never on a prose mention, that `skills/spec/SKILL.md` runs `interlock drift --json`, `openspec new change`, `openspec status --change … --json`, `interlock ledger … --json`, `interlock validate … --json`, `interlock autonomy record review-artifacts --blockers`, `interlock autonomy clean review-artifacts explore spec` and `interlock notify checkpoint`, in that order, with `/interlock:review-artifacts` between validate and the autonomy lines and `GOAL MET: interlock spec stopped at the checkpoint` last; that `skills/review-artifacts/SKILL.md` runs `interlock validate … --json` and `interlock gate … --metrics <change> … --json`; and that each skill carries the field tokens its reading sentences name (`blocking`, `invalidRows`, `ready`, `problems`, `passed`, `malformed`, `autonomyOutcome.blockers`) and the review-artifacts skill keeps its prohibition on re-deriving the verdict in prose. The suite SHALL fail naming the skill and the token when any is missing. A reword that keeps the tokens SHALL pass. The existing `--metrics` pin SHALL stay as it is.

#### Scenario: Happy path — the shipped skills satisfy every pin

- **GIVEN** the two skills and the continuity procedure as shipped by this change
- **WHEN** the skill suite runs
- **THEN** every command-line pin matches a fenced command line in the named skill
- **AND** the match positions in `skills/spec/SKILL.md` ascend in the stated order
- **AND** every field token and the re-derive prohibition are found

#### Scenario: Failure — dropping --json from one line fails the suite naming it

- **GIVEN** a revision of `skills/spec/SKILL.md` whose ledger line reads `interlock ledger "<name>"` again, with every other line unchanged
- **WHEN** the skill suite runs
- **THEN** the ledger pin fails and its message names `skills/spec/SKILL.md` and the missing `--json`
- **AND** the gate's `--metrics` pin and every other pin still pass, so the failure is attributable to that line

#### Scenario: Edge case — a prose mention does not satisfy a command-line pin, and a reword that keeps the line does

- **GIVEN** a revision of `skills/spec/SKILL.md` that removes the fenced `interlock ledger "<name>" --json` block and keeps the sentence "`interlock ledger` audits all three parts of it" in the prose above it
- **WHEN** the skill suite runs
- **THEN** the ledger pin fails, because no fenced command line matches
- **AND** a different revision that keeps the fenced line and rewrites every sentence around it passes every pin
