# bootstrap/corpus-persistence Specification

## Purpose

Makes a repository's decision about keeping its ship-run corpora a decision it actually made, by pinning the instruction that raises the question at onboarding — and by pinning the tool permission that instruction depends on, so the step cannot ship in a state where it silently reports nothing.

This capability is an **instruction contract**, not a runtime behaviour contract. What ships is model-facing prose in `skills/bootstrap/SKILL.md`, so every requirement below is a statement about what that file instructs and declares, verifiable by reading it. The shape follows `openspec/specs/implementer-prompts`, which pins assembled prompt text the same way and for the same reason.

## Requirements

### Requirement: The bootstrap skill SHALL instruct a per-path corpus-persistence report

`skills/bootstrap/SKILL.md` MUST instruct that its closing report cover each of the three run corpora — the ship trajectory (`.claude/ship/`), the outcome corpus (`.claude/learning/`) and the review metrics (`.claude/metrics/`) — and report each path's exclusion state **separately**, never collapsed into a single posture verdict.

The instruction MUST direct that the state be observed with `git check-ignore`, git's own matcher, rather than by reading or parsing `.gitignore`. It MUST pair the observation with a recommendation stated as **conditional** on whether the repository will run `/interlock:ship` against its own product, never asserted as a verdict about the repository, because bootstrap cannot determine that intent. It MUST direct that a non-zero result from the matcher — an unreadable `.gitignore`, or a directory that is not a git repository — be reported as an undetermined posture with its reason, and that bootstrap complete normally regardless.

#### Scenario: Happy path — the three paths and the matcher are named

- **GIVEN** `skills/bootstrap/SKILL.md` as shipped
- **WHEN** its corpus-persistence step is read
- **THEN** the step names `.claude/ship/`, `.claude/learning/` and `.claude/metrics/`, and names `git check-ignore` as the means of observing each
- **AND** it directs that each path's state be reported separately rather than as one verdict

#### Scenario: Failure — the undetermined branch is instructed, not left implicit

- **GIVEN** the same step
- **WHEN** it is read for the case where the matcher exits non-zero
- **THEN** it directs that the posture be reported as undetermined together with the reason
- **AND** it directs that bootstrap still write every artifact it would otherwise have written, so a failed check never fails the onboarding

#### Scenario: Edge case — the recommendation is conditional, not a verdict

- **GIVEN** the same step
- **WHEN** its recommendation wording is read
- **THEN** the recommendation is expressed as conditional on whether the repository will run `ship` on its own product
- **AND** the step does not instruct bootstrap to classify the repository itself, since no observation available to it determines that intent

### Requirement: The bootstrap skill SHALL declare the tool permission its corpus-persistence step requires

`skills/bootstrap/SKILL.md` MUST declare, in its `allowed-tools` frontmatter, permission for every command its corpus-persistence step instructs. An instruction to run a command the skill cannot invoke is worse than an absent instruction: the denial surfaces at runtime on a consumer's repository, and because a failed check is routed to the undetermined branch by the requirement above, a permission denial is indistinguishable from a repository with no `.gitignore` — the step would report `undetermined` on every repository and appear to be working.

The declaration MUST be narrowed to the verbs the step actually uses. A blanket grant is a wider permission than the step needs and is not licensed by this requirement.

#### Scenario: Happy path — the declared permission covers the instructed command

- **GIVEN** the skill's corpus-persistence step instructs `git check-ignore`
- **WHEN** the skill's `allowed-tools` frontmatter is read
- **THEN** it declares a permission that admits `git check-ignore`

#### Scenario: Failure — an instructed command with no matching declaration

- **GIVEN** a `skills/bootstrap/SKILL.md` whose step instructs a command its `allowed-tools` does not admit
- **WHEN** the skill is checked against this requirement
- **THEN** the check fails and names the instructed command and the absent permission
- **AND** the failure is reported at check time rather than deferred to a run on a consumer's repository

#### Scenario: Edge case — the grant is no wider than the step needs

- **GIVEN** the step uses only the `check-ignore` verb
- **WHEN** the declared permission is read
- **THEN** it does not grant unrestricted `git` access

### Requirement: The bootstrap skill SHALL NOT instruct any write to `.gitignore`

`skills/bootstrap/SKILL.md` MUST NOT instruct bootstrap to create, append to, or edit `.gitignore`, under any observed posture and regardless of the recommendation made. It MUST instead instruct that the entries a person could add be named in the report. Bootstrap is invoked to produce an architecture document and specs; editing an unrelated file it was not asked to touch trades a one-line action the reader can take for a surprise in their diff.

#### Scenario: Happy path — the entries are named, not applied

- **GIVEN** the corpus-persistence step as shipped
- **WHEN** its recommendation wording is read
- **THEN** it instructs that the recommended `.gitignore` entries be named in the report
- **AND** it contains no instruction to write, append to, create or edit `.gitignore`

#### Scenario: Failure — a write instruction anywhere in the step

- **GIVEN** a version of the step that instructs appending the recommended entries to `.gitignore`
- **WHEN** the skill is checked against this requirement
- **THEN** the check fails and names the write instruction

#### Scenario: Edge case — an absent `.gitignore` is still not created

- **GIVEN** the step's wording for a repository with no `.gitignore` at all
- **WHEN** it is read
- **THEN** it instructs naming the entries rather than creating the file
- **AND** the absence is not treated as licence to write one
