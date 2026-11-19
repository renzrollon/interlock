# Spec Delta

## Purpose

Gives the review loop's read-only agents one plugin agent type whose tool list the host enforces, so a dimension reviewer, a skeptic, the settle confirmation and the strict artifact reviewer cannot edit a file, spawn an agent or invoke a skill. It also says what each skill does when that type cannot be spawned.

## ADDED Requirements

### Requirement: The plugin SHALL ship a read-only `reviewer` agent type

The plugin SHALL ship `agents/reviewer.md`, named `reviewer`. Its `tools` SHALL be `Read, Grep, Glob, Bash`, and its `disallowedTools` SHALL carry `Write`, `Edit`, `Skill`, `Agent` and `mcp__*`. It SHALL declare no model and no effort. Its description SHALL carry `Never invoke from a user conversation`, SHALL name the three skills that spawn it, and SHALL say that a spawn one of them names is the sanctioned use.

#### Scenario: Happy path — the agent file and its frontmatter

- **GIVEN** the shipped plugin
- **WHEN** the plugin-agents suite runs
- **THEN** `agents/reviewer.md` exists, its `name` is `reviewer`, its `tools` are `Read, Grep, Glob, Bash`, which is the worker's list with `Write` and `Edit` taken out, and its `disallowedTools` carry `Write`, `Edit`, `Skill`, `Agent` and `mcp__*`
- **AND** it declares no `model` key and no `effort` key

#### Scenario: Happy path — the description reserves the type for its three skills

- **GIVEN** the shipped `agents/reviewer.md`
- **WHEN** its description is read
- **THEN** it carries `Never invoke from a user conversation`, names `/interlock:review-code`, `/interlock:settle` and `/interlock:review-artifacts`, and carries `sanctioned use`
- **AND** it is one line that holds no colon followed by a space, so it reads as one plain value

#### Scenario: Happy path — the body repeats the bound in words

- **GIVEN** the shipped `agents/reviewer.md`
- **WHEN** the text under its frontmatter is read
- **THEN** it tells the agent to create, change or delete no file, through the shell either, to invoke no skill and to spawn no agent

#### Scenario: Failure — a tool list that gains a write, a spawn or a skill

- **GIVEN** a copy of the file whose `tools` line adds, in turn, `Write`, `Edit`, `Agent`, `Skill` and an `mcp__` name
- **WHEN** the suite's check reads each copy
- **THEN** each copy fails, and the failure names the tool that was added

### Requirement: `interlock doctor` SHALL count the reviewer agent among the plugin's required files

`interlock doctor` SHALL treat `agents/reviewer.md` as a file the installed plugin needs, beside the other agent definitions, and SHALL name it when it is missing.

#### Scenario: Failure — a plugin without the file

- **GIVEN** a plugin directory lacking `agents/reviewer.md`
- **WHEN** `interlock doctor` runs against it
- **THEN** its `plugin` row fails and lists `agents/reviewer.md` among the missing files

#### Scenario: Happy path — a complete plugin

- **GIVEN** a plugin directory holding every required file
- **WHEN** `interlock doctor` runs against it
- **THEN** its `plugin` row passes and its detail counts four agent types

### Requirement: Every read-only spawn of the review loop SHALL name `interlock:reviewer`

`skills/review-code/SKILL.md` SHALL spawn each dimension reviewer, on the first pass and on a proof re-run, and each skeptic as `interlock:reviewer`. `skills/settle/SKILL.md` SHALL spawn its conformance worker as that type, and `skills/review-artifacts/SKILL.md` its strict reviewer. Each site SHALL say that the type's definition bounds the agent's tools, and SHALL keep passing the `model` and `effort` its routing answered.

#### Scenario: Happy path — review-code names the type for reviewers and skeptics

- **GIVEN** the shipped `skills/review-code/SKILL.md`
- **WHEN** the skill suite reads the dimension spawn paragraph, the skeptic spawn paragraph and the re-run paragraph
- **THEN** each names `interlock:reviewer` as the type of the agent it spawns
- **AND** the dimension paragraph still carries `with the printed prompt as its whole prompt`, and the skeptic paragraph still carries `as its whole prompt`

#### Scenario: Happy path — settle's confirmation names the type

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite reads section 5e
- **THEN** its spawn paragraph names `interlock:reviewer`, and the section still carries `interlock routing settle-conformance --json`, `ROUTING UNAVAILABLE`, `spawn no worker` and `nothing to confirm`

#### Scenario: Happy path — the strict artifact gate names the type

- **GIVEN** the shipped `skills/review-artifacts/SKILL.md`
- **WHEN** the skill suite reads its Depth section
- **THEN** the paragraph that makes the one Agent call names `interlock:reviewer` as the call's `subagent_type`
- **AND** no paragraph of the section says the call names no `subagent_type`

#### Scenario: Edge case — routing fails and the spawn is still typed

- **GIVEN** a site whose routing lookup exits non-zero
- **WHEN** it prints `ROUTING UNAVAILABLE:` and spawns at the session defaults
- **THEN** the call still names `interlock:reviewer`, and carries no `model` and no `effort`
- **AND** each of the three skills says that routing chooses the model and the effort and never the type

#### Scenario: Failure — a skill names a type the plugin does not ship

- **GIVEN** the shipped skills, and a copy of one that names `interlock:reviewers`
- **WHEN** the skill suite resolves every backticked `interlock:<name>` a skill spells against the plugin's agent definitions and its skills
- **THEN** the shipped skills pass, because each name is an agent the plugin ships or a skill it ships, and the copy fails naming `interlock:reviewers`

#### Scenario: Edge case — the settle meter attributes a typed spawn by its prompt

- **GIVEN** a live settle run, and spawns whose calls name `interlock:reviewer` and whose prompts open as a dimension brief, a skeptic brief and the conformance briefing
- **WHEN** the meter files each
- **THEN** each is filed under the role its prompt names, as an untyped spawn with the same prompt is
- **AND** the record keeps `interlock:reviewer` as the agent's type

### Requirement: A review whose reviewers cannot be spawned SHALL fail aloud and record nothing

When the Agent tool reports `interlock:reviewer` as an unknown type, or a dimension or skeptic spawn is refused or declined, `skills/review-code/SKILL.md` SHALL print `REVIEW FAILED: reviewer type unavailable — <the tool's message, or the refusal>`, SHALL spawn no other type in its place, SHALL review nothing itself, and SHALL run no draft, proof or promote line. It SHALL name both remedies: a new session, and `interlock doctor`.

#### Scenario: Failure — the type is unknown at the dimension fan-out

- **GIVEN** a session whose plugin has no `interlock:reviewer` type
- **WHEN** review-code makes its first dimension spawn and the Agent tool answers that the type was not found
- **THEN** the skill prints `REVIEW FAILED: reviewer type unavailable` followed by the tool's message
- **AND** it says that a session started before the plugin was updated does not have the type and a new session does, and that `interlock doctor` names an install whose `agents/` lacks the file
- **AND** it spawns no agent of another type, writes no findings file, and runs no `interlock review` line

#### Scenario: Failure — a skeptic cannot be spawned after the reviewers ran

- **GIVEN** a review whose dimension reviewers returned findings, and a skeptic spawn that is refused
- **WHEN** the skill reaches the refusal
- **THEN** it prints `REVIEW FAILED: reviewer type unavailable` with the refusal, and promotes no record
- **AND** no finding is reported as verified

#### Scenario: Failure — the settle loop stops early on a failed review

- **GIVEN** `/interlock:settle --review`, and a `review-code` pass that printed `REVIEW FAILED:`
- **WHEN** the settle skill reads that line
- **THEN** it prints the line and stops the loop early, as its other early stops do
- **AND** it posts no findings comment for that pass, and nothing more is committed or pushed

### Requirement: The settle confirmation SHALL be skipped aloud when its reviewer cannot be spawned

When the conformance worker's spawn reports `interlock:reviewer` as an unknown type, or is refused or declined, `skills/settle/SKILL.md` SHALL print `CONFORMANCE SKIPPED: reviewer type unavailable — <the tool's message, or the refusal>`, SHALL spawn no other type and confirm nothing itself, SHALL write no handoff, and SHALL go on to the head verification without stopping the loop.

#### Scenario: Failure — the confirmation's spawn is refused

- **GIVEN** a settle pass whose reviews ran, and a conformance spawn that is refused
- **WHEN** the skill reaches the refusal
- **THEN** it prints `CONFORMANCE SKIPPED: reviewer type unavailable` with the refusal, and writes no `.claude/ship/settle/handoff.json`
- **AND** it runs the head verification next, and the assessment line carries no `--handoff`

#### Scenario: Edge case — nothing to confirm prints no skip line

- **GIVEN** a `conformance-brief` that exits 0 with nothing on standard output
- **WHEN** the skill reads it
- **THEN** it spawns no worker and prints no `CONFORMANCE SKIPPED` line

### Requirement: The strict artifact gate SHALL fall back to its inline read when its reviewer cannot be spawned

When the strict reviewer's spawn reports `interlock:reviewer` as an unknown type, or is refused or declined, `skills/review-artifacts/SKILL.md` SHALL print `STRICT REVIEWER UNAVAILABLE: <the tool's message, or the refusal>`, SHALL spawn no other type, and SHALL perform the inline read in the session, so the gate still runs a single time.

#### Scenario: Failure — the type is unknown under `--strict`

- **GIVEN** `/interlock:review-artifacts <change> --strict` in a session whose plugin has no `interlock:reviewer` type
- **WHEN** the one Agent call answers that the type was not found
- **THEN** the skill prints `STRICT REVIEWER UNAVAILABLE:` followed by the tool's message, and makes no second Agent call
- **AND** it reviews the artifacts in the session as the lean depth does, writes the findings file and runs the gate line

#### Scenario: Edge case — an unreadable reply keeps its own line

- **GIVEN** a strict reviewer that was spawned and whose reply holds no `findings` array
- **WHEN** the skill reads the reply
- **THEN** it prints `STRICT REVIEW UNREAD:` as before, and no `STRICT REVIEWER UNAVAILABLE` line
