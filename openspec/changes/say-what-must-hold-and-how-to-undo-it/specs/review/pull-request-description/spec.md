# Spec Delta

## Purpose

What a pull request description written by the `settle` skill must contain, the facts the CLI prints for it to be written from, and the check that reads the description the platform holds, so a reviewer is told what changed, what must hold, what comes first and how to undo it.

## ADDED Requirements

### Requirement: The description SHALL carry seven named sections and name its change first

The description template in `skills/settle/SKILL.md` SHALL hold, in this order, `## Summary`, `## Changes`, `## Must Not Change`, `## High Risk Changes`, `## Prerequisites to Production`, `## How to Roll Back` and `## Testing`. It SHALL tell the writer to copy the `Change:` line the CLI printed as the first line under `## Summary`. The seven headings and that instruction SHALL be pinned by token in the skill suite.

#### Scenario: Happy path — the shipped skill satisfies every description pin

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds each of the seven headings as a line of the fenced template, in the stated order
- **AND** it finds the instruction to copy the `Change:` line under `## Summary`

#### Scenario: Failure — a copy without `## How to Roll Back` fails the suite naming it

- **GIVEN** a copy of the skill whose template lacks the `## How to Roll Back` line
- **WHEN** the skill suite runs
- **THEN** it fails naming `## How to Roll Back`

#### Scenario: Edge case — a heading named only in a sentence does not satisfy the pin

- **GIVEN** a copy of the skill whose template lacks the `## Must Not Change` line, with the words `## Must Not Change` present in a sentence elsewhere
- **WHEN** the skill suite runs
- **THEN** it fails naming `## Must Not Change`

### Requirement: The new sections SHALL be written as labelled lines, and the risk section SHALL carry no rollback note

The template's `## How to Roll Back` SHALL hold three labelled lines, `Undo:`, `Not undone by a revert:` and `Order:`. Its `## Prerequisites to Production` SHALL hold `Before merging:` and `Before deploying:`. Its `## Must Not Change` SHALL ask, for each thing left alone, how that was checked. Its `## High Risk Changes` SHALL ask for a mitigation and SHALL NOT ask for a rollback note. The five labels SHALL be pinned by token inside the template.

#### Scenario: Happy path — the template holds the five labels under their sections

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite reads the fenced template
- **THEN** `Undo:`, `Not undone by a revert:` and `Order:` sit between `## How to Roll Back` and the next heading
- **AND** `Before merging:` and `Before deploying:` sit between `## Prerequisites to Production` and the next heading

#### Scenario: Failure — a rollback note under the risk section fails the suite

- **GIVEN** a copy of the skill whose template says, under `## High Risk Changes`, that each risk carries a rollback note
- **WHEN** the skill suite runs
- **THEN** it fails naming `## High Risk Changes` and the word it found

#### Scenario: Edge case — a label moved to another section does not satisfy the pin

- **GIVEN** a copy of the skill whose `Undo:` line sits under `## Testing`
- **WHEN** the skill suite runs
- **THEN** it fails naming `Undo:`

### Requirement: The skill SHALL run the description brief while it gathers and SHALL say when it could not

The skill SHALL run `interlock settle description-brief` with `--changed` and `--base` on a fenced command line, after it fetches the target branch and before the template, naming the change when one resolved and none otherwise. When the command exits non-zero the skill SHALL say `DESCRIPTION FACTS UNAVAILABLE:` with the first line of its output, and SHALL still compose every section from the artifacts and the diff. The command line and the spoken line SHALL be pinned by token.

#### Scenario: Happy path — the brief line precedes the template

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a fenced line beginning `interlock settle description-brief` that carries `--changed` and `--base`
- **AND** that line comes after the `git fetch origin` line and before the template's `## Summary` line

#### Scenario: Failure — dropping `--base` fails the suite, and a prose mention does not satisfy it

- **GIVEN** a copy of the skill whose brief line lacks `--base`, with the words `--base` present in a sentence elsewhere
- **WHEN** the skill suite runs
- **THEN** it fails naming the line

#### Scenario: Edge case — a skill that goes quiet on a failed brief fails the suite

- **GIVEN** a copy of the skill without `DESCRIPTION FACTS UNAVAILABLE`
- **WHEN** the skill suite runs
- **THEN** it fails naming that token

### Requirement: The skill SHALL check the description the platform holds, SHALL republish an incomplete one a single time, and SHALL never stop on the check

After it publishes, the skill SHALL pipe the platform's own copy of the description into `interlock settle description-check --file -` with `--from-json`, on one fenced line per platform that carries the pull request's number. On `DESCRIPTION INCOMPLETE:` it SHALL publish again a single time, check again, and report a second failure. Any other non-zero exit SHALL be reported as `DESCRIPTION NOT CHECKED:`. Neither SHALL stop the labels or the rest of the pass.

#### Scenario: Happy path — one check line per platform, after the publish lines

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a line piping `gh pr view <id> --json body` into `interlock settle description-check --file - --from-json body`
- **AND** a line piping `glab mr view <id> --output json` into `interlock settle description-check --file - --from-json description`
- **AND** both come after the two publish lines, `gh pr edit <id> --body` and `glab mr update <id> --description`, and before the first `--add-label` line

#### Scenario: Failure — a check moved before the publish fails the suite

- **GIVEN** a copy of the skill whose GitHub check line sits above the `gh pr edit <id> --body` line
- **WHEN** the skill suite runs
- **THEN** it fails saying the check does not follow the publish

#### Scenario: Edge case — the GitLab check line outside a not-exercised block fails the suite

- **GIVEN** a copy of the skill whose `glab mr view` check line sits in a block with no not-exercised marker
- **WHEN** the skill suite runs
- **THEN** it fails naming the line

#### Scenario: Edge case — a check line with no pull request number fails the suite

- **GIVEN** a copy of the skill whose GitHub check line reads `gh pr view --json body`, with no number
- **WHEN** the skill suite runs
- **THEN** it fails naming the line, because the settle meter reads a numberless lookup as the branch's own

#### Scenario: Edge case — the two spoken lines are pinned

- **GIVEN** a copy of the skill without `DESCRIPTION INCOMPLETE` or without `DESCRIPTION NOT CHECKED`
- **WHEN** the skill suite runs
- **THEN** it fails naming the missing token

### Requirement: `interlock settle description-brief` SHALL print the line that names the change and every requirement its delta specs touch

For a named change the command SHALL print ``Change: `<name>` (<dir>/proposal.md)`` and one row for each requirement the change's delta specs add, modify, remove or rename, with its capability and the delta section it sits under. With no change named it SHALL print `Change: none`, say that no change was named, and list no requirement. `--json` SHALL carry the same as `changeLine` and `requirements`.

#### Scenario: Happy path — four delta sections, four rows

- **GIVEN** a change whose delta specs hold one added, one modified and one removed requirement and one rename
- **WHEN** the command runs for that change
- **THEN** it prints the `Change:` line naming the change and its proposal's path
- **AND** it prints four rows, each with the capability, the requirement and one of `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`

#### Scenario: No change named — the line says none

- **GIVEN** a repository with an open change
- **WHEN** the command runs with no change named
- **THEN** it prints `Change: none` and says no change was named
- **AND** it lists no requirement, and does not pick the open change by default

#### Scenario: Edge case — a change with no delta specs lists none

- **GIVEN** a change whose directory holds a proposal and no `specs/`
- **WHEN** the command runs for that change
- **THEN** it prints the `Change:` line and says the change's delta specs hold no requirement

#### Scenario: Edge case — a change directory with no proposal

- **GIVEN** a change whose directory holds a `tasks.md` and no `proposal.md`
- **WHEN** the command runs for that change
- **THEN** the `Change:` line still names the change and `<dir>/proposal.md`
- **AND** the source row for `## Prerequisites to Production` reads `not found`

#### Scenario: `--json` carries the line and the rows

- **WHEN** the command runs with `--json` for a change with two delta requirements
- **THEN** standard output is one JSON object whose `changeLine` is the line and whose `requirements` holds two entries, each with `capability`, `section` and `heading`

### Requirement: The brief SHALL list the living requirements in force that the change does not modify, under the living list's own bound

The command SHALL list each living requirement in force over the changed paths, read from `--base`, that no delta spec of the change modifies, removes or renames, with its capability, heading and place. The selection and the size bound SHALL be those `interlock conformance --living` applies. It SHALL say how many the bound left out and how many the change itself modifies. A list that cannot be built SHALL be reported with its reason and SHALL NOT fail the command.

#### Scenario: Happy path — a requirement the change modifies is not listed as held

- **GIVEN** a capability whose living spec holds two requirements, and a change whose delta spec modifies one of them
- **WHEN** the command runs for that change
- **THEN** it lists the other requirement, with `openspec/specs/<capability>/spec.md` and its line
- **AND** it says one requirement in force is modified by the change

#### Scenario: Failure — a base that names no commit is a reason, not an exit

- **WHEN** the command runs with `--base` naming no commit
- **THEN** it exits 0, prints the `Change:` line and the delta requirements
- **AND** it says the living requirements were not built, with the reason

#### Scenario: Edge case — a renamed requirement counts as modified

- **GIVEN** a living requirement the change's delta spec renames
- **WHEN** the command runs for that change
- **THEN** that requirement is not listed as held

#### Scenario: Edge case — the bound's cut is spoken

- **GIVEN** more living requirements in force than the size bound keeps
- **WHEN** the command runs
- **THEN** it lists the kept ones and says how many were left out by the size bound

#### Scenario: No change named — every requirement in force is held

- **WHEN** the command runs with no change named over changed paths a living spec is linked to
- **THEN** every requirement the living list selects is listed, and none is counted as modified

### Requirement: The brief SHALL say where the artifacts answer each section, or that they do not

For a named change the command SHALL print, for `## Must Not Change`, `## High Risk Changes`, `## Prerequisites to Production` and `## How to Roll Back`, the artifact heading that feeds it with its line number: `design.md` `## Goals / Non-Goals`, `design.md` `## Risks / Trade-offs`, `proposal.md` `## Impact` and `design.md` `## Migration Plan`. An absent artifact or heading SHALL read `not found`. A heading inside a code fence SHALL NOT count.

#### Scenario: Happy path — four sources, four line numbers

- **GIVEN** a change whose proposal and design hold all four headings
- **WHEN** the command runs for that change
- **THEN** it prints one row per section naming the artifact, the heading and the line the heading is on

#### Scenario: Failure — a design with no migration plan reads not found

- **GIVEN** a change whose `design.md` has no `## Migration Plan`
- **WHEN** the command runs for that change
- **THEN** the row for `## How to Roll Back` reads `not found`, and the other three rows carry line numbers

#### Scenario: Edge case — no design at all

- **GIVEN** a change with a proposal and no `design.md`
- **WHEN** the command runs for that change
- **THEN** the three rows fed by `design.md` read `not found` and the command exits 0

#### Scenario: Edge case — a heading inside a fence is not a source

- **GIVEN** a `design.md` whose only `## Migration Plan` line sits inside a fenced code block
- **WHEN** the command runs for that change
- **THEN** the row for `## How to Roll Back` reads `not found`

### Requirement: The brief SHALL refuse a missing input or an unresolvable change with nothing on standard output, and SHALL read an archived change read-only

The command SHALL exit 1 with a usage line on standard error and nothing on standard output when `--changed` or `--base` is missing, and exit 1 naming the change when a named change resolves neither under `openspec/changes/` nor in the archive. A change found only in the archive SHALL be read without writing and announced as `CHANGE READ FROM ARCHIVE: <dir>` on standard error. `--changed -` SHALL read the paths from standard input. Every other case SHALL exit 0.

#### Scenario: Failure — no flags

- **WHEN** the command runs with no flag
- **THEN** it exits 1, prints nothing on standard output, and standard error holds a usage line naming `settle description-brief`

#### Scenario: Failure — a change that does not exist

- **WHEN** the command runs for a change name no directory holds
- **THEN** it exits 1 naming the change, with nothing on standard output

#### Scenario: Edge case — a change read from the archive

- **GIVEN** a change that exists only under `openspec/changes/archive/<date>-<name>/`
- **WHEN** the command runs for `<name>`
- **THEN** standard error holds `CHANGE READ FROM ARCHIVE:` with that directory
- **AND** the `Change:` line names the change and the archived proposal's path, and no file is written

#### Scenario: Edge case — the changed paths arrive on standard input

- **WHEN** the command runs with `--changed -` and three paths on standard input
- **THEN** its first line says three changed paths

### Requirement: `interlock settle description-check` SHALL name each required section that is missing or empty

The command SHALL read a description and report `missing section: ## <name>` for each of the seven required headings that is not a level-2 heading line of the text, and `empty section: ## <name>` for each whose body, up to the next level-2 heading, holds no non-blank character. A heading inside a code fence SHALL NOT count. `## Merge confidence` and any other heading SHALL be neither required nor refused.

#### Scenario: Happy path — a complete description passes

- **GIVEN** a description holding the seven sections, each with a body, and a valid `Change:` line
- **WHEN** the command reads it
- **THEN** it exits 0 and reports no problem

#### Scenario: Failure — two missing sections are both named, in template order

- **GIVEN** a description without `## Must Not Change` and without `## How to Roll Back`
- **WHEN** the command reads it
- **THEN** it exits 1 reporting `missing section: ## Must Not Change` and then `missing section: ## How to Roll Back`

#### Scenario: Failure — a heading with nothing under it is empty

- **GIVEN** a description whose `## Testing` heading is followed at once by the end of the text
- **WHEN** the command reads it
- **THEN** it reports `empty section: ## Testing`

#### Scenario: Edge case — a heading inside a fence does not count

- **GIVEN** a description whose only `## How to Roll Back` line sits inside a fenced code block
- **WHEN** the command reads it
- **THEN** it reports `missing section: ## How to Roll Back`

#### Scenario: Edge case — the confidence block and other headings are ignored

- **GIVEN** a complete description with no `## Merge confidence` section, a `## Description` heading above `## Summary` and a `## Notes` section at the end
- **WHEN** the command reads it
- **THEN** it exits 0

### Requirement: The check SHALL refuse a bare `None` in the two new sections and a `Change:` line that is absent or names another change

The command SHALL report `bare None in ## <name>` when the body of `## Must Not Change` or `## How to Roll Back` is only `None` or `N/A`, in any case, with or without a full stop, list markers and emphasis read past; the other sections MAY hold it. It SHALL report a `## Summary` with no line beginning `Change:`, a `Change:` line that is neither `Change: none` nor one naming a change in backticks, and, with `--change <name>`, a line that names another change or says `none`.

#### Scenario: Happy path — `None` under the risk section passes

- **GIVEN** a complete description whose `## High Risk Changes` body is `None`
- **WHEN** the command reads it
- **THEN** it exits 0

#### Scenario: Failure — `None.` under `## How to Roll Back`

- **GIVEN** a description whose `## How to Roll Back` body is `None.`
- **WHEN** the command reads it
- **THEN** it reports `bare None in ## How to Roll Back`

#### Scenario: Failure — a bulleted `None` under `## Must Not Change`

- **GIVEN** a description whose `## Must Not Change` body is `- None`, `**None**` or `` `N/A` ``, each line of it read past its list marker (`-`, `*`, `+`, `1.`) and its wrapping emphasis or code ticks
- **WHEN** the command reads it
- **THEN** it reports `bare None in ## Must Not Change`
- **AND** a body of `Undo: None` is not refused, because a label is not read past

#### Scenario: Edge case — `None` with a reason is not bare

- **GIVEN** a description whose `## Must Not Change` body is `None: this pull request only adds a new file nothing reads yet.`
- **WHEN** the command reads it
- **THEN** it reports no problem for that section

#### Scenario: Failure — no `Change:` line

- **GIVEN** a description whose `## Summary` holds bullets and no line beginning `Change:`
- **WHEN** the command reads it
- **THEN** it reports that `## Summary` holds no `Change:` line

#### Scenario: Failure — the line names another change

- **GIVEN** a description whose line reads ``Change: `other-change` (openspec/changes/other-change/proposal.md)``
- **WHEN** the command reads it with `--change this-change`
- **THEN** it reports that the line names `other-change`, not `this-change`

#### Scenario: Edge case — `Change: none` with and without a named change

- **GIVEN** a description whose line reads `Change: none`
- **WHEN** the command reads it with no `--change`
- **THEN** it reports no problem for the line
- **AND** read with `--change this-change`, it reports that the line says none

### Requirement: The check SHALL exit on its verdict, SHALL mark an incomplete description with a fixed prefix, and SHALL tell a broken input from an incomplete one

A complete description SHALL exit 0 and print one line beginning `description complete`. An incomplete one SHALL exit 1 with standard error beginning `interlock: DESCRIPTION INCOMPLETE: `, the problems after it, and empty standard output. A missing `--file`, an unreadable file, or with `--from-json <key>` input that is not JSON or has no string at that key SHALL exit 1 the same way without those two words. `--json` SHALL print `ok`, `problems`, `sections` and `changeLine` at either verdict.

#### Scenario: Happy path — complete

- **WHEN** the command reads a complete description from a file
- **THEN** it exits 0 and standard output is one line beginning `description complete`

#### Scenario: Failure — incomplete

- **WHEN** the command reads a description with two problems
- **THEN** it exits 1 with nothing on standard output
- **AND** standard error begins `interlock: DESCRIPTION INCOMPLETE: ` and names both problems

#### Scenario: Failure — a broken input does not read as incomplete

- **WHEN** the command runs with no `--file`, with a file that does not exist, or with `--from-json body` on input that is not JSON
- **THEN** each exits 1 with nothing on standard output
- **AND** standard error begins `interlock: ` and does not hold `DESCRIPTION INCOMPLETE`

#### Scenario: Edge case — an empty body on the platform is incomplete, not broken

- **GIVEN** the JSON `{"body": ""}` on standard input
- **WHEN** the command runs with `--file - --from-json body`
- **THEN** it exits 1 with standard error beginning `interlock: DESCRIPTION INCOMPLETE: `, naming seven missing sections

#### Scenario: Edge case — the key holds no string

- **GIVEN** the JSON `{"body": null}` on standard input
- **WHEN** the command runs with `--file - --from-json body`
- **THEN** it exits 1 with nothing on standard output, and standard error does not hold `DESCRIPTION INCOMPLETE`

#### Scenario: `--json` at both verdicts

- **WHEN** the command runs with `--json` on a complete description and on an incomplete one
- **THEN** each prints one JSON object on standard output with `ok`, `problems`, `sections` and `changeLine`, and the exit statuses are 0 and 1
- **AND** the incomplete one also writes the `interlock: DESCRIPTION INCOMPLETE: ` line on standard error

### Requirement: Both commands SHALL be members of the `settle` family: listed, accepted, smoked, documented and offline

`interlock settle --help` SHALL list `description-brief` and `description-check` with their usage lines. The CLI's accepted-flag table SHALL hold the flags of each, the post-install smoke SHALL run each, and `docs/07-cli-and-configuration.md` SHALL describe each in its settle table. Neither SHALL start a process or open a connection, and the module holding their rules SHALL import no `node:` module.

#### Scenario: Happy path — help lists both

- **WHEN** `interlock settle --help` runs
- **THEN** standard output holds a usage line beginning `interlock settle description-brief ` and one beginning `interlock settle description-check `

#### Scenario: Failure — a flag the table does not hold is refused

- **WHEN** `interlock settle description-check --file x --nonsense` runs
- **THEN** it exits non-zero naming `--nonsense`

#### Scenario: Edge case — every command the shipped skill spells is known, accepted and smoked

- **GIVEN** the shipped `skills/settle/SKILL.md` with its brief line and its two check lines
- **WHEN** the shipped-form inventory test runs
- **THEN** it passes: each leaf is known, each flag is accepted for its leaf, and the smoke inventory runs each leaf

#### Scenario: Edge case — the documentation names both

- **WHEN** a test reads `docs/07-cli-and-configuration.md`
- **THEN** it finds a table row beginning `interlock settle description-brief` and one beginning `interlock settle description-check`

#### Scenario: Edge case — the rules module is pure

- **WHEN** a test reads the imports of the module that holds the two commands' rules
- **THEN** none names a `node:` module
