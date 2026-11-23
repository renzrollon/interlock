# Spec Delta

## ADDED Requirements

### Requirement: Declared counts-as-source paths SHALL be parsed like the other path lists and SHALL be read only by the size signal

A `REVIEW.md` MAY declare a `## Counts as Source` section. Its paths SHALL be parsed with the grammar, the canonical path form and the problem reporting of the other two path lists, a pattern item included. The list SHALL be scope, not a threshold: it SHALL move no finding, no review or gate decision, and no merge signal other than `diff.shape`, and a problem in it SHALL NOT move the human-paths signal. The policy command SHALL print the list beside the other two.

#### Scenario: Happy path — a declared section is parsed and printed

- **GIVEN** a `REVIEW.md` whose `## Counts as Source` section lists `- skills/` and `- ./agents`
- **WHEN** the policy is read with `interlock review-policy --json`, and again without `--json`
- **THEN** the JSON output lists `skills` and `agents` in canonical form under `sourcePaths`
- **AND** the text output prints the list on its own line beside the exclusions and the always-human-review list
- **AND** the exclusions, the always-human-review list and the prose are unchanged by the section's presence

#### Scenario: Failure — a malformed section is reported and declares nothing

- **GIVEN** three policy files whose `## Counts as Source` section holds, in turn, prose and no list item, the item `- ../outside`, and the item `- skills/**`
- **WHEN** each policy is read
- **THEN** the first reports that the section has content and no path list items, and declares no path
- **AND** the second reports `../outside` as not a repository-relative path, and declares no path for it
- **AND** the third reports the item as a pattern in `Counts as Source` that was not read as a path

#### Scenario: Edge case — the list moves nothing but the size signal

- **GIVEN** a base whose `REVIEW.md` lists `skills/` under `## Counts as Source` and nothing under the other two lists, a surviving blocker on `skills/settle/SKILL.md`, and a change whose only changed path is that file
- **WHEN** `interlock review` decides survival, `interlock gate` evaluates the result, and the merge confidence is assessed with that base
- **THEN** the blocker survives and the gate blocks exactly as with no such section
- **AND** the risk signal and the human-paths signal read what they read with no such section

#### Scenario: Edge case — a problem in the section does not move the human-paths signal

- **GIVEN** a base whose `## Counts as Source` section holds the item `skills/**` and whose `## Always Human Review` section lists `lib/release/`, and a change that touches no path under `lib/release/`
- **WHEN** the merge confidence is assessed with that base
- **THEN** the human-paths signal is green
- **AND** the problem is named by the diff-shape signal's evidence and by no other signal

### Requirement: With a base reference, the counts-as-source list SHALL be read from the base

With a base reference, the merge verdict and `interlock review-policy` SHALL read the counts-as-source list from the `REVIEW.md` committed at that reference, as they read the always-human-review list, so a change cannot edit the list applied to it. A `REVIEW.md` absent at the reference SHALL declare no such path, without a problem. Without a base reference the policy command SHALL read the list from the working tree.

#### Scenario: Happy path — a pull request cannot take its own prose out of the count

- **GIVEN** a base whose `REVIEW.md` lists `skills/` under `## Counts as Source`, a working tree whose `REVIEW.md` no longer lists it, and a change to `skills/settle/SKILL.md` of more lines than the published line cap
- **WHEN** the merge confidence is assessed with that base
- **THEN** the diff-shape signal is amber, and its evidence names `skills/` and the reference the list was read from
- **AND** the human-paths signal is amber, because the policy file was edited

#### Scenario: Failure — a list the change adds is not applied to it

- **GIVEN** a base whose `REVIEW.md` has no `## Counts as Source` section, a working tree whose `REVIEW.md` lists `skills/` there, and a change to `skills/settle/SKILL.md`
- **WHEN** the merge confidence is assessed with that base, and `interlock review-policy --base <ref> --json` is run
- **THEN** the diff-shape signal counts the file as prose
- **AND** the policy command lists no counts-as-source path and says the working copy differs from the reference

#### Scenario: Edge case — absent at the base, and no base given

- **GIVEN** a reference with no `REVIEW.md` while the working tree's lists `skills/` under `## Counts as Source`, and a second invocation with no reference
- **WHEN** `interlock review-policy --json` is run with the reference, and again without one
- **THEN** the first lists no counts-as-source path and reports no problem
- **AND** the second lists `skills` from the working tree
