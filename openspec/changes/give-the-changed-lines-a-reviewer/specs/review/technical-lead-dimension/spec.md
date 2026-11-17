# Spec Delta

## Purpose

States what the bundled `technical-lead` review brief asks beyond comparing the plan with the diff, so the checks it alone owns (the repository's written rules, fix depth, and the scenario-to-test check) are pinned.

## ADDED Requirements

### Requirement: The `technical-lead` brief SHALL check the diff against the repository's written rules on quoted evidence

The brief SHALL tell the reviewer to check the diff against the repository's written rules: the quoted review policy and review context blocks of its prompt, and the instruction files that govern the changed files. A violation SHALL be raised only when the reviewer quotes the rule, names the file it is written in and names the line that breaks it; otherwise it SHALL raise nothing.

#### Scenario: Happy path — the check and its evidence rule are present

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `Written rules`, `CLAUDE.md`, `AGENTS.md`, `quote the rule` and `raise nothing`

#### Scenario: Failure — a written rule cannot lower the bar

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief says a written rule can `add a finding` and can never remove one or `lower a severity`

#### Scenario: Edge case — a rule broken with no other consequence

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief says such a violation is a `warning at most`

### Requirement: The brief SHALL ask whether a fix removes the cause

When the change fixes a defect, the brief SHALL require the reviewer to judge whether it removes the cause or hides the symptom, and to name the cause with its `path:line` and what still reaches it.

#### Scenario: Happy path — the fix-depth question is asked

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the brief carries `Fix depth`, `cause`, `symptom` and `still reaches`

#### Scenario: Edge case — a change that fixes nothing

- **GIVEN** the shipped brief
- **WHEN** the skill suite runs
- **THEN** the bullet that carries `Fix depth` opens its question with `When the change fixes a defect`

### Requirement: The scenario-to-test check SHALL have one owning brief

The `technical-lead` brief SHALL carry the cross-reference of the change's spec scenarios against the tests, with its severity rule, and SHALL ask whether a test would still pass with the behaviour broken. The `qa` brief SHALL NOT repeat the cross-reference: it SHALL keep untested behaviour and edge cases and SHALL say the scenario check belongs to the technical lead.

#### Scenario: Happy path — the technical lead holds the check

- **GIVEN** the shipped `technical-lead` brief
- **WHEN** the skill suite runs
- **THEN** it carries `GIVEN/WHEN/THEN`, `Happy-path gaps are blockers` and `still pass with the behaviour broken`

#### Scenario: Failure — the QA brief repeats it

- **GIVEN** the shipped `qa` brief
- **WHEN** the skill suite runs
- **THEN** it finds neither `GIVEN/WHEN/THEN` nor, in any casing, `happy-path`
- **AND** the brief carries `technical lead` and `Edge cases`

#### Scenario: Edge case — the default depth still asks about test quality

- **GIVEN** the always-on dimension set the limits surface publishes for the default review depth
- **WHEN** the skill suite reads the brief of each dimension in that set
- **THEN** at least one of them carries `still pass with the behaviour broken`
