## MODIFIED Requirements

### Requirement: The lines an observer of the spec flow keys on SHALL be pinned by token

The skill suite SHALL assert, as tokens matched on the fenced command line and never on a prose mention, that `skills/spec/SKILL.md` runs `interlock drift --json`, `openspec new change`, `openspec status --change … --json`, `interlock ledger … --json`, `interlock validate … --json`, `interlock autonomy record review-artifacts --blockers`, `interlock autonomy clean review-artifacts explore spec`, `interlock advisor … --brief … --json`, `interlock advisor … --check … --json`, `interlock advisor … --check --failed … --json` and `interlock notify checkpoint`, in that order, with `/interlock:review-artifacts` between validate and the autonomy lines, `subagent_type: "interlock:advisor"` between the brief line and the check line, and `GOAL MET: interlock spec stopped at the checkpoint` last; that `skills/review-artifacts/SKILL.md` runs `interlock validate … --json` and `interlock gate … --metrics <change> … --json`; and that each skill carries the field tokens its reading sentences name (`blocking`, `invalidRows`, `ready`, `problems`, `passed`, `malformed`, `autonomyOutcome.blockers`, and for the advisor lines `step`, `status`, `questions`, `dropped`) and the review-artifacts skill keeps its prohibition on re-deriving the verdict in prose. The check pin SHALL exclude `--failed` and the failed pin SHALL require it, so each of the two check-shaped advisor lines is matched by exactly one pin and dropping `--json` from either fails its own pin. The suite SHALL also assert that the spec skill says the consult is never retried and never writes `decisions.md`, and that when the failed line exits non-zero the skill reports its `first output line` and continues, as tokens. The suite SHALL fail naming the skill and the token when any is missing. A reword that keeps the tokens SHALL pass. The existing `--metrics` pin SHALL stay as it is. The spec meter's skill-lines pin SHALL classify every advisor line as the kind `advisor`, and that kind SHALL sit between `autonomy` and `ready` in `KEYED_LINES`.

#### Scenario: Happy path — the shipped skills satisfy every pin

- **GIVEN** the two skills and the continuity procedure as shipped by this change
- **WHEN** the skill suite runs
- **THEN** every command-line pin matches a fenced command line in the named skill
- **AND** the match positions in `skills/spec/SKILL.md` ascend in the stated order, with the three advisor lines after the autonomy lines and before the checkpoint line
- **AND** every field token, the never-retried and never-writes-the-ledger tokens, and the re-derive prohibition are found

#### Scenario: Failure — dropping --json from one line fails the suite naming it

- **GIVEN** a revision of `skills/spec/SKILL.md` whose ledger line reads `interlock ledger "<name>"` again, with every other line unchanged
- **WHEN** the skill suite runs
- **THEN** the ledger pin fails and its message names `skills/spec/SKILL.md` and the missing `--json`
- **AND** the gate's `--metrics` pin and every other pin still pass, so the failure is attributable to that line
- **AND** a revision whose check line reads `interlock advisor "<name>" --check <draft>` with no `--json` fails the check pin by name, while the brief pin and the failed pin still pass, because the failed line's `--failed` keeps it from satisfying the check pin

#### Scenario: Edge case — a prose mention does not satisfy a command-line pin, and a reword that keeps the line does

- **GIVEN** a revision of `skills/spec/SKILL.md` that removes the fenced `interlock ledger "<name>" --json` block and keeps the sentence "`interlock ledger` audits all three parts of it" in the prose above it
- **WHEN** the skill suite runs
- **THEN** the ledger pin fails, because no fenced command line matches
- **AND** a different revision that keeps the fenced line and rewrites every sentence around it passes every pin
- **AND** a revision that moves the advisor section above the artifact-review gate fails the order pin naming the advisor line and the autonomy line it now precedes
