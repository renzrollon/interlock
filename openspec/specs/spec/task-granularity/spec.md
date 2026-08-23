# task-granularity Specification

## Purpose

Keeps `tasks.md` coarse enough that ship can put independent work in one wave and treat sequential edits to one file as one implementer, so the spec workflow does not feed the planner a 1-task-per-slice staircase.

## Requirements

### Requirement: A numbered section is one wave of independent work

When writing `tasks.md` for a change that will be shipped, each numbered section MUST contain only tasks that can share a wave: they either run in parallel (disjoint edit paths) or serialize only because they claim the same path. A new numbered section MUST be introduced only when a later set of tasks needs the previous section's output to already exist. Sequential TDD beats, comment moves, and trap-enforcement slices that all edit the same production file MUST be one checkbox, not one checkbox per beat.

#### Scenario: Happy path — one file, one checkbox

- **GIVEN** a change that creates a module, moves a function into it, and enforces three call-site traps, all in `src/pkg/runner.py`
- **WHEN** `/interlock:spec` writes `tasks.md`
- **THEN** those steps are a single unchecked checkbox under one numbered section
- **AND** `tasks.md` does not contain five consecutive checkboxes that each name only `src/pkg/runner.py`

#### Scenario: Failure — a same-file staircase is rejected at review

- **GIVEN** a `tasks.md` whose section 2 lists five implementation checkboxes that each name the same production path
- **WHEN** artifact review inspects task quality
- **THEN** the review reports a blocker or warning that sequential same-file work must be one checkbox
- **AND** it names the repeated path

#### Scenario: Edge case — independent files share a section so they can share a batch

- **GIVEN** a destination-path feature in `src/pkg/runner.py` and a manifest schema in `src/pkg/registry.py` that do not need each other's output
- **WHEN** `/interlock:spec` writes `tasks.md`
- **THEN** those two checkboxes live in the same numbered section
- **AND** a later section is used only for work that must wait on both (for example wiring names into the runner)

### Requirement: Authoring surfaces state the granularity rules

The Interlock spec workflow MUST state the three rules: default grouping is the numbered section; sequential same-file edits are one checkbox; a new section is only an output-exists boundary between sets of work. `skills/spec/SKILL.md` MUST contain a `Task shape for ship` subsection under artifact generation that states those rules, including the phrase `sequential same-file work is one checkbox`. The same rules MUST appear in `openspec/config.yaml` task rules (so `openspec instructions tasks` injects them). The checkpoint page and artifact-review task-quality checks MUST look for the same-file staircase. The stock OpenSpec propose skill is not an authoring surface for this requirement.

#### Scenario: Happy path — instructions carry the three rules

- **GIVEN** an operator runs `openspec instructions tasks` for this repository
- **WHEN** they read the injected task rules
- **THEN** the text states that a numbered section is a wave, that sequential same-file work is one checkbox, and that a new section is only for an output-exists boundary

#### Scenario: Failure — the spec skill omits the ship task-shape section

- **GIVEN** `skills/spec/SKILL.md` in this repository
- **WHEN** the test suite inspects that skill text and `openspec/config.yaml` task rules
- **THEN** a missing `Task shape for ship` heading, or a missing statement of `sequential same-file work is one checkbox`, fails the suite
- **AND** the failure names which surface omitted them

#### Scenario: Edge case — checkpoint reading still flags vague and fine-grained tasks

- **GIVEN** the ten-minute checkpoint page for `tasks.md`
- **WHEN** a human follows it
- **THEN** it still rejects vague phrases (`update accordingly`, `handle edge cases`, `etc.`)
- **AND** it also tells them to reject consecutive checkboxes that name the same production file
