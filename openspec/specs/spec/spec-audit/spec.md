# spec/spec-audit Specification

## Purpose
Gives the question "do these living specs carry enough contract to review a change against?" an instrument: a non-gating report, per capability, of the structural and domain measures a reviewer relies on, each defined once so the figures can be repeated, and a pin that keeps this repository's own corpus from losing the invariants it holds today.

## Requirements

### Requirement: The spec audit SHALL report, per capability, measures defined by stated rules

`interlock spec-audit` SHALL read every living spec under `openspec/specs/` and report, for each capability, by the rules stated here:

- the requirements, counted by `### Requirement:` headings, and the requirements whose heading and prose carry neither `SHALL` nor `MUST`;
- the scenarios, counted by `#### Scenario:` headings, and the scenarios with no `GIVEN` line, no `WHEN` line or no `THEN` line, counting only the corpus's bulleted keyword lines;
- the scenarios whose title begins with `Failure`, those whose title begins with `Edge case`, and those whose title begins with neither nor with `Happy path`, each case-insensitively;
- the bound-or-prohibition lines: lines inside requirement blocks, prose or scenario, containing `SHALL NOT`, `MUST NOT`, `never` as a word, `at most`, `at least` or `exactly once`, case-insensitively;
- the numeric literals in requirement prose: each standalone number on a requirement's prose lines, outside inline code and outside scenario bodies, listed with its spec, line and value for a person to classify as semantics or as a restated threshold, never judged by the audit;
- with a graph, the files a capability's reliable spec-to-file edges name that no longer exist, by the same definition drift uses, and the count of files those edges name.

It SHALL flag a capability that has no bound-or-prohibition line, no `Failure` scenario or no `Edge case` scenario, and SHALL report scenarios with no `GIVEN` as a count, not a flag. Repository-wide it SHALL report the totals and, with a graph, the coverable source files no living spec's reliable edge names, as a count, a share of the coverable files in the graph, and a list.

Rationale: a requirement that only says what the system does gives a reviewer nothing to catch a regression against; the invariants are in the bounds and the prohibitions. The epic's hand audit could not be repeated because its counting rules were never written down.

#### Scenario: Happy path — a fixture corpus reproduces its stated counts

- **GIVEN** a fixture corpus of three capabilities whose requirements, scenarios, missing keyword lines, titled scenarios, bound lines and numeric literals are known
- **WHEN** `interlock spec-audit --json` runs over it
- **THEN** every per-capability count and every repository-wide total equals the known value
- **AND** each numeric literal is listed with its spec, line and value

#### Scenario: Failure — a capability with no bound and no failure scenario is flagged

- **GIVEN** a capability whose requirement blocks contain none of the bound-or-prohibition terms and whose scenario titles begin only with `Happy path`
- **WHEN** the spec audit runs
- **THEN** the capability carries the no-bound, no-failure-scenario and no-edge-case flags
- **AND** a capability with one bound line and a `Failure` scenario carries neither of the first two flags

#### Scenario: Edge case — counting rules at their boundaries

- **GIVEN** a requirement whose prose mentions `never` inside the word `nevertheless`, a number inside inline code, a number in a scenario body, and the line `SHALL NOT` written in lower case in a scenario
- **WHEN** the spec audit runs
- **THEN** `nevertheless` is not a bound line, while the lower-case `shall not` line is
- **AND** neither the number inside inline code nor the number in a scenario body is listed as a numeric literal

### Requirement: The spec audit SHALL never block and SHALL state what it could not measure

The spec audit SHALL exit zero whenever it completes, as drift does, and SHALL print one line or field for each measure it could not take, with the reason. With no `openspec/specs/` directory, or one holding no spec, it SHALL report that no living spec exists. With no usable graph, it SHALL report every text measure, SHALL leave the file-link and unspecified-source measures out with the reason that no graph exists, and SHALL NOT report them as zero. A spec file that cannot be read SHALL be named with the reason and left out of the totals, and the totals SHALL say how many specs they cover.

Rationale: an audit that fails a build would become a gate by accident; an audit that reports an unmeasured figure as zero would read as a clean corpus.

#### Scenario: Happy path — a corpus and a graph

- **GIVEN** a living corpus and a graph with reliable edges to existing files
- **WHEN** `interlock spec-audit` runs
- **THEN** it reports the text measures and the file-link measures for every capability
- **AND** it exits zero, even though some capability carries a flag

#### Scenario: Failure — no living spec

- **GIVEN** a repository with no `openspec/specs/` directory
- **WHEN** `interlock spec-audit --json` runs
- **THEN** it reports that no living spec exists, with every count absent rather than zero
- **AND** it exits zero

#### Scenario: Edge case — no graph, and an unreadable spec

- **GIVEN** a living corpus with no graph built, and one spec file that cannot be read
- **WHEN** `interlock spec-audit` runs
- **THEN** the file-link and unspecified-source measures are absent with the reason that no graph exists, not zero
- **AND** the unreadable spec is named with its reason, and the totals state that they cover one spec fewer than the corpus holds

### Requirement: This repository's living specs SHALL keep the structural invariants the audit measures

The repository's own test suite SHALL run the spec audit over its committed `openspec/specs/` and SHALL fail when any requirement lacks `SHALL` or `MUST`, when any scenario lacks a `WHEN` or a `THEN`, when any spec lacks a `## Purpose`, or when the audit's requirement and scenario totals differ from an independent count of the headings. It SHALL NOT pin exact counts of the live corpus, because every archive changes them.

Rationale: the invariants hold today across every living spec; a pin on them notices a regression in the next spec written, while a pin on counts would fail on every archive and teach the suite's readers to edit the number.

#### Scenario: Happy path — the committed corpus passes

- **GIVEN** the committed living specs of this repository
- **WHEN** the suite runs
- **THEN** the invariant pin passes
- **AND** the pin names no requirement or scenario count

#### Scenario: Failure — a requirement with no normative verb

- **GIVEN** a living spec edited so that one requirement's heading and prose carry neither `SHALL` nor `MUST`
- **WHEN** the suite runs
- **THEN** the invariant pin fails naming the spec and the requirement

#### Scenario: Edge case — an archive adds a capability

- **GIVEN** an archive that adds a well-formed capability with new requirements and scenarios to the living corpus
- **WHEN** the suite runs
- **THEN** the invariant pin still passes without any test edit
- **AND** the audit's totals equal the independent heading count of the enlarged corpus
