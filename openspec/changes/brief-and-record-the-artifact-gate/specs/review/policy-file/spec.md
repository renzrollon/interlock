# Spec Delta

## ADDED Requirements

### Requirement: `REVIEW.md` SHALL declare artifact-review lenses and checks under two known headings, read from the base

`## Artifact Review Lenses` and `## Artifact Checks` SHALL each be a list of `- ` items: lens names, and one-line checks. With a base reference both SHALL be read from the base, as the path lists are, and without one from the working tree. A threshold-shaped item SHALL be a reported problem and never read. `interlock review-policy` SHALL print the lens names and the number of checks, and its JSON SHALL carry `artifactLenses` and `artifactChecks`.

#### Scenario: Happy path — both sections are parsed and printed

- **GIVEN** a `REVIEW.md` with `## Artifact Review Lenses` listing `agentic-harness` and `## Artifact Checks` listing two lines
- **WHEN** `interlock review-policy --json` runs
- **THEN** `artifactLenses` is `["agentic-harness"]` and `artifactChecks` holds the two lines in file order
- **AND** the text output carries one line naming the lens and one counting two checks

#### Scenario: Failure — a check added in the working copy is not read from the base

- **GIVEN** a `REVIEW.md` at HEAD with one Artifact Check and a working copy with two
- **WHEN** `interlock review-policy --base HEAD --json` runs
- **THEN** `artifactChecks` holds the one check from HEAD, and the output says `REVIEW.md` differs from HEAD

#### Scenario: Edge case — a threshold-shaped item is refused

- **GIVEN** an `## Artifact Checks` list holding `- nitCap: 0` and one ordinary check
- **WHEN** the policy is parsed
- **THEN** `artifactChecks` holds the ordinary check alone, and `problems` names the threshold-shaped item as ignored

#### Scenario: Edge case — a section with text but no list items declares nothing

- **GIVEN** an `## Artifact Review Lenses` section holding a paragraph and no `- ` item
- **WHEN** the policy is parsed
- **THEN** `artifactLenses` is empty and `problems` says the section has content but no list items

#### Scenario: Edge case — the shipped template parses clean and declares nothing

- **GIVEN** `skills/review-code/REVIEW.template.md` as shipped
- **WHEN** it is parsed
- **THEN** it holds both artifact headings, `problems` is empty, and `artifactLenses` and `artifactChecks` are empty

### Requirement: An artifact-section item SHALL be read as written, never as a path or a pattern

An item of `## Artifact Review Lenses` or `## Artifact Checks` SHALL be read as the text it holds. It SHALL not be canonicalized as a path, and an item holding `?` or `*` SHALL not be refused as a pattern, so a check may ask a question or name a glob.

#### Scenario: Edge case — a check written as a question is read

- **GIVEN** an `## Artifact Checks` list holding `- Does every task name its verification?` and `- Is lib/*.mjs free of node: imports?`
- **WHEN** the policy is parsed
- **THEN** `artifactChecks` holds both lines as written, and `problems` is empty

### Requirement: A heading that names an artifact section but is not a known one SHALL be a reported problem

A `##` heading SHALL be a misnamed artifact heading when it is neither of the two known artifact headings, its normalized words hold `artifact` or `artifacts` together with `lens`, `lenses`, `check`, `checks` or `review`, and its last word is not `rationale`. A misnamed artifact heading SHALL add a problem that names the heading and the two known ones, and SHALL declare nothing. Every other unknown heading SHALL stay ignored.

#### Scenario: Failure — a misnamed heading is reported

- **GIVEN** a `REVIEW.md` with `## Artifact Lenses` listing `agentic-harness`
- **WHEN** `interlock review-policy --json` runs
- **THEN** `artifactLenses` is empty and `problems` names `Artifact Lenses` and the known headings `Artifact Review Lenses` and `Artifact Checks`

#### Scenario: Failure — a plural misspelling is reported too

- **GIVEN** a `REVIEW.md` with `## Artifacts Checks`
- **WHEN** the policy is parsed
- **THEN** `problems` names `Artifacts Checks` and the two known headings

#### Scenario: Edge case — an unrelated unknown heading stays ignored

- **GIVEN** a `REVIEW.md` with a `## Notes` section
- **WHEN** the policy is parsed
- **THEN** no problem names it, as before this change

#### Scenario: Edge case — a rationale heading stays ignored

- **GIVEN** a `REVIEW.md` with `## Artifact checks rationale` holding a paragraph, beside `## Always-human rationale`
- **WHEN** the policy is parsed
- **THEN** no problem names either heading

### Requirement: A problem the artifact sections report SHALL leave the proof of coverage and the merge verdict as they were

`sectionOfProblem` SHALL answer `artifact` for every problem `## Artifact Review Lenses`, `## Artifact Checks` or a misnamed artifact heading reports. `proofSourcePaths` SHALL keep the counts-as-source list beside an `artifact` problem, and the merge verdict's human-paths signal SHALL not read one. A threshold-shaped line written without a list marker SHALL stay a problem of no section, as it is in every other section.

#### Scenario: Happy path — an artifact-section problem is classed as its own section

- **GIVEN** each problem a malformed `## Artifact Review Lenses`, a malformed `## Artifact Checks` and an `## Artifact Lenses` heading report, as is and labelled with the copy it came from
- **WHEN** `sectionOfProblem` reads each
- **THEN** it answers `artifact` for every one

#### Scenario: Failure — a misnamed artifact heading leaves the proof's source list in place

- **GIVEN** a `REVIEW.md` holding `## Counts as Source` with `- skills/` and an `## Artifact Lenses` heading
- **WHEN** `proofSourcePaths` reads the parsed policy
- **THEN** it answers `["skills"]`, not `null`

#### Scenario: Failure — a misnamed artifact heading at the base does not make the merge verdict ask for a person

- **GIVEN** a base `REVIEW.md` holding `## Always Human Review` with `- lib/release/` and an `## Artifact Lenses` heading, and a change that touches no path under `lib/release/`
- **WHEN** `interlock merge-confidence --base <ref>` runs
- **THEN** the `policy.humanPaths` signal reads as it does without the misnamed heading, and its problems do not include the heading's

#### Scenario: Edge case — a problem in Counts as Source still drops the list

- **GIVEN** a `REVIEW.md` holding `## Counts as Source` with `- skills/**` beside an `## Artifact Checks` list
- **WHEN** `proofSourcePaths` reads the parsed policy
- **THEN** it answers `null`, as before this change
