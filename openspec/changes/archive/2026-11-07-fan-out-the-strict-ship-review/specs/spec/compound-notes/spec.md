# Spec Delta

## MODIFIED Requirements

### Requirement: Rows SHALL be derived from findings that carry specGap, and the field SHALL be optional and never gate anything

`FINDING_SCHEMA` in `lib/findings.mjs` SHALL gain an optional boolean `specGap`, described as "the finding's root cause is a requirement no spec stated". `resolveReview` in `lib/review-core.mjs` SHALL pass a boolean value through unchanged. A non-boolean value SHALL be listed under a new non-blocking `anomalies.specGapShape` entry beside `anomalies.requirementCitations`, naming the finding and the value's type; the finding SHALL be kept, the field SHALL be read as absent, and `evaluateGate`'s `malformed` list and `passed` verdict SHALL be the same for any value of the field, including a non-boolean one, so a reviewer's typo on an advisory field can never block a review. `lib/notes.mjs` SHALL export `deriveNotes(findings, { change, source, date })`, which SHALL produce one row per surviving finding whose `specGap` is `true`, with `file` from the finding's `file`, `surprise` from its `title`, and `rule` from its `suggestion` when present, otherwise the first sentence of its `description`, stored as-is for a person to reword later; findings without `specGap: true` SHALL produce nothing. The finding shape shown to each strict ship reviewer in its own dimension briefing (`lib/prompts/review-dimension.mjs`, when the briefing names the reviewer's answer file) and the one in `skills/review-code/SKILL.md` §2 SHALL list `specGap` as optional. The domain and technical-lead dimension briefs under `skills/review-code/dimensions/` SHALL instruct the reviewer to set `specGap: true` on a finding whose root cause is a requirement the living specs and the change's delta specs never stated, and only then; the other dimension briefs SHALL not mention it. `test/skills.test.mjs` SHALL pin the `specGap` token in those two briefs and in `skills/review-code/SKILL.md` §2, and its absence from the other dimension briefs.

#### Scenario: Happy path — two of five survivors carry specGap

- **GIVEN** five surviving findings, two with `specGap: true`, one with `specGap: false`, two without the field
- **WHEN** `deriveNotes(findings, { change: 'add-x', source: 'run-123', date: '2026-10-19' })` runs
- **THEN** two rows are returned, each with the finding's `file`, its `title` as `surprise` and its `suggestion` as `rule`
- **AND** the three others produce nothing

#### Scenario: Failure — specGap is the string "yes"

- **GIVEN** a findings set in which one warning carries `specGap: "yes"`
- **WHEN** the review is resolved and the gate evaluated
- **THEN** the finding is kept, `anomalies.specGapShape` names it with `specGap is not a boolean`, and `evaluateGate` returns the same `passed`, `blockers` and `malformed` it returns for the identical set with `specGap: true`, `specGap: false` or no field
- **AND** `deriveNotes` treats it as not a gap

#### Scenario: Edge case — a specGap finding with no suggestion

- **GIVEN** a `specGap: true` finding with `description` and no `suggestion`
- **WHEN** `deriveNotes` runs
- **THEN** the row's `rule` is the description's first sentence, stored as-is
- **AND** the row is otherwise as any other
