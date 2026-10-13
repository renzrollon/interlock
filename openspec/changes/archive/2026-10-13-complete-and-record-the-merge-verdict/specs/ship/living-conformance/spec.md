## Purpose

Lists the living requirements a change is asked to confirm before it commits, chosen by the same rule, base and bound as the domain review's text, so that "did this change keep the requirements already in force?" is a counted question with a written answer a person can read.

## ADDED Requirements

### Requirement: The living list SHALL be the requirements in force for the capabilities a change touches, selected and bounded as the domain review's text is

The living list SHALL hold one entry per living requirement in force for the capabilities selected for the change. A capability SHALL be selected the two ways the domain review selects one: a changed path that a reliable graph link ties to a living spec, and a capability the change's own delta specs modify that has a living spec. The requirement text SHALL be read from the base when one is named and from the working tree otherwise, and the list SHALL say which. A requirement the change's delta specs modify, remove or rename SHALL NOT be listed, because the change's own scenarios answer for it. Whole requirements SHALL be kept, in capability order then spec order, until the published domain text bound is reached; a requirement past the bound SHALL NOT be listed and SHALL be named, by capability and heading, as left out. For one change, base and graph, the listed requirements SHALL be exactly the requirements the domain review's text carries.

Each entry SHALL carry an identifier `L1`, `L2`, … in list order, the capability, the living spec's path, the line of the requirement's heading, and the heading. An entry SHALL NOT carry the requirement's body. The list SHALL state its own count of entries, which is the only denominator a reader may use.

With no graph and no capability the change declares, the list SHALL be reported as skipped with that reason. With no graph and at least one declared capability, the list SHALL be built from the declared capabilities and reported as partial with that reason. With a graph that links none of the changed paths and no declared capability, the list SHALL be empty with that reason, and SHALL be neither skipped nor partial.

Rationale: one answer to "which living requirements is this change judged against" means the reviewer and the handoff can never disagree about the set, and reusing the published text bound adds no second threshold. The list is built in `lib/conformance.mjs` from the selection `lib/prompts/domain-context.mjs` makes.

#### Scenario: Happy path — two capabilities, listed in order, without what the change supersedes

- **GIVEN** a change whose changed path is linked to capability `alpha` with three living requirements, and whose delta specs modify one of the two living requirements of capability `beta`
- **WHEN** the living list is built
- **THEN** it holds four entries, `L1` to `L3` for `alpha` in spec order and `L4` for the unmodified requirement of `beta`
- **AND** each entry carries the living spec's path, the heading's line and the heading, and no requirement body
- **AND** the list's own count is four

#### Scenario: Failure — no graph and nothing declared is a stated skip, not an empty list

- **GIVEN** a repository with no graph, and a change whose delta specs modify no capability that has a living spec
- **WHEN** the living list is built
- **THEN** it is reported as skipped, with the reason that no graph exists and the change declares no capability
- **AND** it is not presented as a list with nothing to confirm

#### Scenario: Edge case — the bound cuts between requirements and names what it left out

- **GIVEN** a selected capability whose requirements in force exceed the published domain text bound after the fourth
- **WHEN** the living list is built
- **THEN** it holds the first four requirements and its count is four
- **AND** every later requirement is named by capability and heading as left out, and none is cut part-way
- **AND** the four listed are the four the domain review's text carries for the same change and base

#### Scenario: Edge case — a graph that links nothing, and no graph with a declared capability

- **GIVEN** one change in a repository whose graph links none of its changed paths and whose delta specs declare no capability, and another in a repository with no graph whose delta specs modify capability `beta`
- **WHEN** the living list is built for each
- **THEN** the first is empty with the reason that no link and no declaration selects a capability, and is neither skipped nor partial
- **AND** the second lists the requirements of `beta` in force and is reported as partial, with the reason that the changed files were not mapped

### Requirement: The conformance command SHALL list living requirements on request, after the delta scenarios, and SHALL still block nothing

The conformance command SHALL accept an option that adds the living list to its checklist, after the change's delta scenarios. With that option it SHALL accept a base reference naming where the living text is read from, and its output SHALL name the source it read. The machine-readable output SHALL carry the living entries, their count, the requirements left out by the bound, and the skip or partial reason when one applies. Without the option, the command's output SHALL be exactly what it was before the option existed.

The command SHALL NOT decide whether a requirement is satisfied, and SHALL exit zero in every case. A base reference that names no commit SHALL be reported as the reason the living list was not built, and SHALL NOT change the exit code or remove the delta scenarios from the output.

#### Scenario: Happy path — scenarios, then living requirements, and nothing decided

- **GIVEN** a change with two delta scenarios and a living list of three entries
- **WHEN** the conformance command runs with the living option and a base reference
- **THEN** the output lists `C1` and `C2`, then `L1` to `L3`, and names the base as the source of the living text
- **AND** it states that these are questions and that nothing here blocks
- **AND** it exits zero

#### Scenario: Failure — a base that names no commit is reported, not fatal

- **GIVEN** a base reference that resolves to no commit
- **WHEN** the conformance command runs with the living option and that reference
- **THEN** the delta scenarios are listed as they would be without the option
- **AND** the living list is reported as not built, naming the reference
- **AND** the command exits zero

#### Scenario: Edge case — without the option the output is unchanged

- **GIVEN** a change and its changed paths
- **WHEN** the conformance command runs without the living option
- **THEN** its human-readable and machine-readable output carry no living entry, count or reason
- **AND** the delta checklist is the same, field for field, as before this capability existed

### Requirement: A ship run asked for conformance SHALL list the living requirements in the handoff briefing and SHALL record the handoff's two counts

When a run's manifest asks for conformance, the handoff step SHALL build the living list over the run's own observed changed paths, with the run's start commit as the base, and the handoff briefing SHALL list its entries after the delta scenarios. The briefing SHALL ask for one answer per identifier with a `file:line` citation, SHALL say that a requirement that cannot be confirmed is recorded as unconfirmed and never as satisfied or omitted, and SHALL say that the answers never halt the run. The step SHALL carry the number of living entries. The handoff result SHALL be able to carry the number of living requirements checked and the number left unconfirmed, and the run SHALL record both beside the scenario counts. When the handoff reported a count of living requirements checked, the summary SHALL carry a row stating how many were confirmed out of how many were checked.

A list reported as skipped SHALL place `LIVING CONFORMANCE SKIPPED: <reason>` on the step and among the run's banners, and a list reported as partial SHALL place `LIVING CONFORMANCE PARTIAL: <reason>` there, each at most one time per run. An empty list that is neither SHALL raise no banner. A handoff that returns no usable result SHALL leave both counts absent; an absent count SHALL NOT be recorded as zero. When the manifest does not ask for conformance, no living list SHALL be built and the handoff briefing SHALL be exactly what it was before this capability existed.

Nothing in this capability SHALL halt a run or change its exit code.

#### Scenario: Happy path — a conformance run asks about living requirements and records the answer

- **GIVEN** a run with conformance on, two delta scenarios and a living list of three entries
- **WHEN** the handoff step is emitted and its result reports three living requirements checked and none unconfirmed
- **THEN** the briefing lists `L1` to `L3` after the scenarios, each with its spec path and line
- **AND** the step carries a living count of three
- **AND** the run records three checked and zero unconfirmed, and the summary's living-requirements row reads three of three confirmed

#### Scenario: Failure — a handoff that reports nothing leaves the counts absent

- **GIVEN** a run with conformance on and a living list of three entries
- **WHEN** the handoff step returns no usable result
- **THEN** the run records neither living count, and the summary carries no living-requirements row
- **AND** the note that the handoff did not complete is printed, as it is today
- **AND** the run goes on to its commit step

#### Scenario: Edge case — skipped and partial are each spoken, and a graph that links nothing is silent

- **GIVEN** three conformance runs: one with no graph and no declared capability, one with no graph and one declared capability, and one whose graph links none of its changed paths
- **WHEN** each emits its handoff step
- **THEN** the first carries `LIVING CONFORMANCE SKIPPED:` with its reason, the second `LIVING CONFORMANCE PARTIAL:` with its reason, and the third neither
- **AND** each banner reaches the close summary's degradation block, and appears there only one time

#### Scenario: Edge case — a run without conformance builds no list

- **GIVEN** a run whose manifest asks for the handoff artifacts and not for conformance
- **WHEN** the handoff step is emitted
- **THEN** the briefing names no living requirement and the step carries no living count
- **AND** the briefing's text is unchanged from before this capability existed
