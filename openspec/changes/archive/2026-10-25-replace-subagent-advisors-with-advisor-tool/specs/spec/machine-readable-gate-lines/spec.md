## MODIFIED Requirements

### Requirement: The lines an observer of the spec flow keys on SHALL be pinned by token

The skill suite SHALL assert pins as tokens matched on the fenced command line, never on a prose mention.

For `skills/spec/SKILL.md`:
- It runs these lines, in this order: `interlock drift --json`, `openspec new change`, `openspec status --change … --json`, `interlock note match … --json`, `interlock ledger … --json`, `interlock validate … --json`, `interlock autonomy record review-artifacts --blockers`, `interlock autonomy clean review-artifacts explore spec` and `interlock notify checkpoint`.
- `/interlock:review-artifacts` sits between validate and the autonomy lines.
- `GOAL MET: interlock spec stopped at the checkpoint` comes last.
- No fenced line in the spec skill runs `interlock advisor`, and the skill does not spell `subagent_type: "interlock:advisor"`.
- When the `note match` line exits non-zero, the skill reports its `first output line` and continues. The suite SHALL assert this as tokens.

For `skills/review-artifacts/SKILL.md`: it runs `interlock validate … --json` and `interlock gate … --metrics <change> … --json`, and it keeps its prohibition on re-deriving the verdict in prose.

Each skill carries the field tokens its reading sentences name: `blocking`, `invalidRows`, `ready`, `problems`, `passed`, `malformed` and `autonomyOutcome.blockers`, plus `rows` and `unreadable` for the `note match` line.

The suite SHALL fail naming the skill and the token when any pin is missing. A reword that keeps the tokens SHALL pass. The existing `--metrics` pin SHALL stay as it is. The spec meter's skill-lines pin SHALL classify the `note match` line as the kind `notes`, that kind SHALL sit between `status` and `ledger` in `KEYED_LINES`, and no kind named `advisor` SHALL remain.

#### Scenario: Happy path — the shipped skills satisfy every pin

- **GIVEN** the two skills and the continuity procedure as shipped by this change
- **WHEN** the skill suite runs
- **THEN** every command-line pin matches a fenced command line in the named skill
- **AND** the match positions in `skills/spec/SKILL.md` ascend in the stated order, with the `note match` line after the status line and before the ledger line
- **AND** every field token, the `first output line` token for the `note match` line, and the re-derive prohibition are found

#### Scenario: Failure — dropping --json from one line fails the suite naming it

- **GIVEN** a revision of `skills/spec/SKILL.md` whose ledger line reads `interlock ledger "<name>"` again, with every other line unchanged
- **WHEN** the skill suite runs
- **THEN** the ledger pin fails and its message names `skills/spec/SKILL.md` and the missing `--json`
- **AND** the gate's `--metrics` pin and every other pin still pass, so the failure is attributable to that line
- **AND** a revision whose `note match` line has no `--json` fails the `note match` pin by name while the other pins pass

#### Scenario: Edge case — a prose mention does not satisfy a command-line pin, and a reword that keeps the line does

- **GIVEN** a revision of `skills/spec/SKILL.md` that removes the fenced `interlock ledger "<name>" --json` block and keeps the sentence "`interlock ledger` audits all three parts of it" in the prose above it
- **WHEN** the skill suite runs
- **THEN** the ledger pin fails, because no fenced command line matches
- **AND** a different revision that keeps the fenced line and rewrites every sentence around it passes every pin
- **AND** a revision that adds a fenced `interlock advisor "<name>" --brief --json` line fails the suite naming the advisor line
