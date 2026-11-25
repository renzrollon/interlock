# review/validation-comment Specification

## Purpose
The comment `/interlock:settle --review` posts beside the findings: what the pass ran against the assessed commit, what each command and check returned, which scenarios were confirmed and how, and what none of it would catch. `interlock settle validation` renders it from the pass's records and says which figures the CLI observed and which the session recorded.

## Requirements

### Requirement: `interlock settle validation` SHALL render a comment bound to the assessed commit

`interlock settle validation --head <sha> --plan <file> --results <file> --verify <file>` SHALL print a Markdown comment whose first line is `## Validation — <sha>`, followed by `### Commands run`, `### Platform checks`, `### Spec adherence` and `### What these checks would not catch`, in that order. It SHALL exit 1, the reason on standard error and nothing on standard output, when a required flag is missing, a required record cannot be read, or the verdict's `head` is absent or is not the sha.

#### Scenario: Happy path — the four sections in order

- **GIVEN** a plan with one unit step, its results, and a verdict whose `head` is H
- **WHEN** the command runs with `--head H`
- **THEN** standard output's first line is `## Validation — H`, and the four section headings follow in the stated order
- **AND** it exits 0

#### Scenario: Failure — a verdict for another commit, or one that records none

- **GIVEN** a verdict whose `head` is not H, and another that carries no `head`
- **WHEN** the command runs for each with `--head H`
- **THEN** each exits 1 with nothing on standard output
- **AND** the first's standard error names both commits, and the second's says the verdict records no head

#### Scenario: Failure — a head that is not a commit sha

- **GIVEN** a verdict whose `head` is the same value, and `--head` holding a newline and a heading, or markup
- **WHEN** the command runs
- **THEN** it exits 1 with nothing on standard output, and standard error's first line says `--head` must be a commit sha and quotes the value on that one line

#### Scenario: Failure — a record that cannot be read

- **GIVEN** `--results` naming a file that does not exist, and separately a `--plan` that is not JSON
- **WHEN** the command runs for each
- **THEN** each exits 1 naming the flag and the file on standard error
- **AND** nothing is printed on standard output

#### Scenario: Edge case — the same records render the same bytes

- **GIVEN** the same plan, results, verdict and optional records
- **WHEN** the command runs twice
- **THEN** both outputs are byte for byte the same
- **AND** with `--json` it prints one object carrying `head`, `commands`, `checks`, `adherence`, `gaps`, `visual` and `cut`

### Requirement: The comment SHALL carry no verdict and SHALL hold every text it did not write inert

The comment SHALL state no merge verdict, score, band or label. Every command, check name, scenario title, citation, failing test name, and reviewer-written input and reason SHALL render as an inline code span, and the worker's `detail` inside a code fence longer than any backtick run it holds, so none renders as a mention, a link, markup or a line-start command, and none closes a `<details>` block.

#### Scenario: Happy path — records that hold no verdict word render none

- **GIVEN** records in which no string holds `MERGE`, `HUMAN` or `BLOCK`
- **WHEN** the command runs
- **THEN** standard output holds none of those three words and no `## Merge confidence` heading
- **AND** it holds no label name that begins `interlock/`

#### Scenario: Failure — records that carry a verdict, a score, a band and a label render none

- **GIVEN** a verdict, a review record and a checked handoff for H that each carry, beside the keys the renderer reads, `verdict: "HUMAN"`, a `score` that no count in the fixture equals, `band: "amber"` and a `labels` list naming `interlock/human`
- **WHEN** the command runs with `--review` and `--handoff`, and again on the same records with those four keys removed
- **THEN** the first output holds none of `HUMAN`, `amber`, that score or `interlock/human`
- **AND** the two outputs are byte for byte the same

#### Scenario: Failure — text that tries to be markup stays text

- **GIVEN** a check named with an `@`-mention and a Markdown link, a scenario title holding `</details><!--`, and a worker `detail` holding a line reading `/approve` and a run of three backticks
- **WHEN** the command runs
- **THEN** the check name and the title each render inside an inline code span, and the `detail` inside a fence longer than its backtick run
- **AND** no line outside a fence or a span begins with `/approve`, and the only `<details>`, `<summary>` and `</details>` lines outside a fence or a span are the renderer's own

### Requirement: `### Commands run` SHALL show each planned command with the exit code the CLI observed

The section SHALL hold one row per step of the plan, in plan order, with its kind, command, exit code, duration and counts, then one row per kind the plan skipped, with the plan's reason. With `--exec <file>`, a step's exit code and duration SHALL be those of the last entry of that record whose `kind` and `command` equal the step's. Without such an entry the exit code SHALL be the results entry's, marked `session-recorded`, and the duration SHALL read `not recorded`.

#### Scenario: Happy path — a unit step with an exec entry

- **GIVEN** a plan whose one step is `unit` with the command `npm test`, an exec record whose last matching entry holds `exitCode: 0` and `durationMs: 102300`, and a verdict whose unit counts are 4948 total, 4943 passed, 0 failed and 5 skipped
- **WHEN** the command runs with `--exec`
- **THEN** the row holds `unit`, the command in a code span, exit `0`, `1m 42s` and the four counts
- **AND** the row carries no `session-recorded` mark

#### Scenario: Edge case — no exec entry for the step

- **GIVEN** the same plan and results, and no `--exec`, and separately an exec record whose entries name another command
- **WHEN** the command runs for each
- **THEN** the row shows the results entry's exit code marked `session-recorded`, and the duration reads `not recorded`
- **AND** the gap section holds an item saying the exit code is the session's own record

#### Scenario: Edge case — a kind the plan skipped reads as not run

- **GIVEN** a plan that skipped `typecheck` with `no-detectable-command` and `e2e` with `e2e-not-requested`
- **WHEN** the command runs
- **THEN** the table holds a row for each after the planned steps, reading `not run` with the plan's reason
- **AND** neither row holds an exit code

#### Scenario: Edge case — a step with no results entry

- **GIVEN** a plan with a `lint` step and results that hold no `lint` entry
- **WHEN** the command runs with no `--exec`
- **THEN** the `lint` row reads `no result recorded`
- **AND** the gap section holds an item naming `lint`

### Requirement: A disagreement between the session's exit code and the observed one SHALL be said, and so SHALL a halt

When a step's results entry and its exec entry carry different exit codes, the row SHALL show the observed code, and a line opening `RESULT DISAGREES:` naming the kind and both codes SHALL follow the table. One line after the table SHALL say whether the final verification halted, with its reason. A red unit verdict SHALL list its failing test names and print no test output. A spill locator SHALL be shown. None of these SHALL change the exit code: the command exits 0.

#### Scenario: Failure — the session recorded 0 and the command exited 1

- **GIVEN** a results entry for `unit` with `exitCode: 0` and an exec entry for the same kind and command with `exitCode: 1`
- **WHEN** the command runs
- **THEN** the row shows exit `1`, and a line reading `RESULT DISAGREES: unit: the session recorded exit 0, verify exec observed exit 1` follows the table
- **AND** the gap section holds the same line as an item, and the command exits 0 with the comment on standard output

#### Scenario: Failure — a halted verification names its reason and its failing tests

- **GIVEN** a verdict with `halt: true`, a reason, and a unit verdict whose clusters name three tests and hold a representative failure text
- **WHEN** the command runs
- **THEN** the line after the table says the final verification halted and gives the reason in a code span, and the three test names follow, each in a code span
- **AND** the representative failure text appears nowhere in the output, and the command exits 0

#### Scenario: Edge case — a results entry with a spill locator

- **GIVEN** a results entry for `unit` that carries a `locator` string
- **WHEN** the command runs
- **THEN** the section holds a line saying the output was spilled, with the locator in a code span
- **AND** no line of the spilled output is printed

### Requirement: A duration SHALL read in minutes and seconds and SHALL never be rounded up

A duration of a minute or more SHALL read `<m>m <s>s` with whole seconds, and minutes are never folded into hours. One under a minute SHALL read `<s>s` with one decimal. Both forms SHALL drop the remainder, so a run never reads longer than it took. An exec entry whose `durationMs` is absent, negative or not a number SHALL read `not recorded`.

#### Scenario: Happy path — a minute or more

- **GIVEN** exec entries whose `durationMs` are 102300, 60000 and 4503000
- **WHEN** the command runs for each
- **THEN** the durations read `1m 42s`, `1m 0s` and `75m 3s`
- **AND** none holds a decimal

#### Scenario: Failure — a duration the record does not hold

- **GIVEN** exec entries for the step whose `durationMs` is absent, is `-5`, and is the string `fast`
- **WHEN** the command runs for each
- **THEN** each row's duration reads `not recorded`
- **AND** the row still shows the entry's exit code with no `session-recorded` mark

#### Scenario: Edge case — under a minute

- **GIVEN** exec entries whose `durationMs` are 8349, 59960 and 0
- **WHEN** the command runs for each
- **THEN** the durations read `8.3s`, `59.9s` and `0.0s`
- **AND** none reads `60.0s` or `1m 0s`

### Requirement: `### Commands run` SHALL say whose reading the counts are, how often a command ran, and when none ran

The counts SHALL be marked `as the session read them`: no command of the CLI parses a runner's output. When the exec record holds more than one entry for a step, the row SHALL give the number of runs, and each earlier run that exited non-zero SHALL be named in a line opening `RE-RUN:` after the table and as a gap item. When the plan holds no step, the table SHALL hold only the kinds not run, and the line after it SHALL say no command ran.

#### Scenario: Happy path — the counts carry their mark

- **GIVEN** a unit step with an exec entry and a verdict that holds its four counts
- **WHEN** the command runs
- **THEN** the counts column is headed `as the session read them`
- **AND** the exit code in the same row carries no `session-recorded` mark

#### Scenario: Failure — a command that went green on its second run

- **GIVEN** an exec record holding two entries for the `unit` step's command, the first with `exitCode: 1` and the second with `exitCode: 0`, and a results entry with `exitCode: 0`
- **WHEN** the command runs
- **THEN** the row shows exit `0` and `2 runs`, and a line reading `RE-RUN: unit: an earlier run exited 1` follows the table
- **AND** the gap section holds the same line as an item, and no `RESULT DISAGREES:` line is printed

#### Scenario: Edge case — two green runs

- **GIVEN** an exec record holding two entries for the step, both with `exitCode: 0`
- **WHEN** the command runs
- **THEN** the row shows `2 runs`
- **AND** no line opens `RE-RUN:` and the gap section holds no item for it

#### Scenario: Edge case — a plan with no step

- **GIVEN** a plan made with no test profile, holding no step and five skipped kinds, and a verdict for H
- **WHEN** the command runs with `--head H`
- **THEN** the table holds five rows reading `not run`, and the line after it says no command ran
- **AND** the gap section holds an item for each of the five kinds

### Requirement: `### Platform checks` SHALL show the platform's checks for the same commit, or say why it shows none

With `--pipeline <file>` whose `sha` is the head, the section SHALL give the number of checks by state and how many are required, SHALL list each failing or pending check as a row, and SHALL hold the rest in one `<details>` block whose `<summary>` names their count. With no `--pipeline`, with a record for another commit, or with no check reported, the section SHALL say which, and SHALL list no check from another commit.

#### Scenario: Happy path — twelve passing checks are counted and collapsed

- **GIVEN** a pipeline input for H with eleven checks in state `pass`, five of them required, and one in state `skipped`
- **WHEN** the command runs with `--head H`
- **THEN** the section's first line counts twelve checks, eleven passed, one skipped and five required
- **AND** all twelve sit inside one `<details>` block whose `<summary>` reads `12 checks`, and no check row sits outside it

#### Scenario: Failure — a failing required check is shown outside the block

- **GIVEN** a pipeline input for H in which the required check `test (20)` is in state `fail` and another check is pending
- **WHEN** the command runs
- **THEN** both are rows of a table before the `<details>` block, each with its name in a code span, its state and whether it is required
- **AND** the first line's counts include both, and the gap section holds an item for the pending check and none for the failing one

#### Scenario: Edge case — a record for another commit

- **GIVEN** a pipeline input whose `sha` is not H
- **WHEN** the command runs with `--head H`
- **THEN** the section says the record describes another commit, naming it, and lists no check
- **AND** the gap section holds an item saying the platform's checks for H are not shown

#### Scenario: Edge case — no record, and a record with no check

- **GIVEN** no `--pipeline`, and separately a pipeline input for H whose `checks` list is empty
- **WHEN** the command runs for each
- **THEN** the first says no pipeline record was given, and the second says the platform reported no check for H
- **AND** each adds an item to the gap section

### Requirement: A check the caller excluded SHALL be named apart, counted nowhere, and listed as a gap

Each name under the `excluded` list of a pipeline input for the head SHALL be named, in a code span, in one line opening `Excluded by the caller:` that follows the section's first line. It SHALL be counted in no figure of that first line, SHALL be no row inside or outside the `<details>` block, and SHALL be an item of the gap section.

#### Scenario: Happy path — one excluded check beside three that passed

- **GIVEN** a pipeline input for H with three checks in state `pass` and `excluded` naming `e2e (nightly)`
- **WHEN** the command runs with `--head H`
- **THEN** the section's first line counts three checks, and the next line opens `Excluded by the caller:` and names `e2e (nightly)` in a code span
- **AND** no row names it, and the gap section holds one item naming it

#### Scenario: Failure — a record for another commit names no excluded check

- **GIVEN** a pipeline input whose `sha` is not H and whose `excluded` names `e2e (nightly)`
- **WHEN** the command runs with `--head H`
- **THEN** no line opens `Excluded by the caller:`
- **AND** `e2e (nightly)` appears nowhere in the output

#### Scenario: Edge case — nothing excluded

- **GIVEN** a pipeline input for H with no `excluded` key, and separately one whose `excluded` is an empty list
- **WHEN** the command runs for each
- **THEN** no line opens `Excluded by the caller:`
- **AND** the gap section holds no item about an excluded check

### Requirement: `### Spec adherence` SHALL show the checked confirmation row by row

With `--handoff <file>` whose `head` is the head and which carries `checked: true`, the section SHALL give how many scenarios and living requirements were confirmed with a citation and how many were not, SHALL list every unconfirmed row with its id, title and reason, and SHALL hold the confirmed rows, each with its citation, and the worker's `detail` in one `<details>` block. A handoff without `checked: true` SHALL show the worker's own counts, marked `not checked`, and no row.

#### Scenario: Happy path — twenty-nine scenarios and four requirements, all confirmed

- **GIVEN** a checked handoff for H with twenty-nine scenario rows and four requirement rows, every one `confirmed` with a citation
- **WHEN** the command runs with `--head H`
- **THEN** the section's first line reads 29 of 29 scenarios and 4 of 4 living requirements confirmed with a citation, none unconfirmed
- **AND** the thirty-three rows sit inside one `<details>` block, each with its id, its title and its citation in code spans

#### Scenario: Failure — unconfirmed rows are listed first, with their reasons

- **GIVEN** a checked handoff for H in which C7 is unconfirmed because the worker did not confirm it and L2 because its cited file was not found
- **WHEN** the command runs
- **THEN** a table before the `<details>` block holds C7 and L2, each with its title and its reason
- **AND** the first line counts both as unconfirmed

#### Scenario: Edge case — a handoff the check did not write

- **GIVEN** a handoff for H that carries the five counts and no `checked` key
- **WHEN** the command runs
- **THEN** the section shows the worker's counts marked `not checked` and no row
- **AND** the gap section holds an item saying the confirmation's citations were not checked

#### Scenario: Edge case — no handoff, and a handoff for another commit

- **GIVEN** no `--handoff`, and separately a checked handoff whose `head` is not H
- **WHEN** the command runs for each with `--head H`
- **THEN** the first says no confirmation was recorded for H, and the second says the confirmation describes another commit, naming it, and shows no row
- **AND** each adds an item to the gap section

### Requirement: The adherence totals SHALL count the briefed rows, and the worker's `detail` SHALL show with no confirmed row

The first line's two totals SHALL be the handoff's rows of each kind. A living requirement the size bound left out has no row and SHALL be in neither total; when any were left out, a second line SHALL say how many. With no confirmed row the `<details>` block SHALL still be present, its `<summary>` reading `0 confirmed`, holding the worker's `detail`. With no confirmed row and an empty `detail` there SHALL be no block.

#### Scenario: Happy path — three living requirements left out by the size bound

- **GIVEN** a checked handoff for H with four requirement rows, all confirmed, and `living.omitted` of 3, and separately the same handoff with `living.omitted` of 0
- **WHEN** the command runs for each
- **THEN** the first output's first line reads 4 of 4 living requirements confirmed, and its second line says three living requirements were left out by the size bound
- **AND** neither figure of that first line is 7, and the second output holds no line about requirements left out

#### Scenario: Failure — no row is confirmed

- **GIVEN** a checked handoff for H with two scenario rows, both unconfirmed, and a `detail` paragraph
- **WHEN** the command runs
- **THEN** the first line reads 0 of 2 scenarios confirmed, and the table before the block holds both rows with their reasons
- **AND** the `<details>` block is present, its `<summary>` reads `0 confirmed`, and it holds the `detail` inside a fence

#### Scenario: Edge case — no confirmed row and no detail

- **GIVEN** the same handoff with `detail` an empty string
- **WHEN** the command runs
- **THEN** the section holds no `<details>` block
- **AND** the table of unconfirmed rows is unchanged

### Requirement: `### What these checks would not catch` SHALL name every gap the records hold, in a fixed order

The section SHALL hold one item per gap, ordered by source: the plan's skipped kinds; the commands' gaps; the pipeline's, pending and excluded checks included; the confirmation's; the skipped, degraded and unavailable dimensions and the proof's gaps of the `--review <file>` record, when its `head` is the head; the source files the `--coverage <file>` record does not list; a missing changed-path list. With no gap it SHALL print `No gap is recorded in these records.` It SHALL never be collapsed.

#### Scenario: Happy path — skipped kinds and unread inputs become items

- **GIVEN** a plan that skipped four kinds, and a review record for H whose proof lists two unread inputs for `language` and whose dimension record lists `domain` as degraded with a reason and `blast-radius` as unavailable
- **WHEN** the command runs with `--review`
- **THEN** the section holds four items for the skipped kinds first, each with its reason, then an item for `domain`, an item for `blast-radius` and an item for each unread input, each reviewer-written string in a code span
- **AND** no item sits inside a `<details>` block

#### Scenario: Edge case — nothing is recorded as a gap

- **GIVEN** a plan that skipped nothing, an exec entry for every step that agrees with the results, a pipeline input for H with every check passed, a checked handoff for H with every row confirmed, a review record for H whose proof holds, a coverage record that lists every changed source file, and a changed-path list
- **WHEN** the command runs with every optional flag
- **THEN** the section holds the one line `No gap is recorded in these records.`
- **AND** it holds no list item

#### Scenario: Edge case — no review record, and one for another commit

- **GIVEN** no `--review`, and separately a review record whose `head` is not H
- **WHEN** the command runs for each with `--head H`
- **THEN** the first holds an item saying no review record was given, and the second an item saying the review record describes another commit, naming it
- **AND** neither prints a dimension or an unread input from a record for another commit

#### Scenario: Edge case — the confirmation's and the coverage record's gaps

- **GIVEN** a pipeline input for H with one pending check, a checked handoff for H with two unconfirmed scenarios and three living requirements left out by the size bound, and a coverage record that names two changed source files its report does not list
- **WHEN** the command runs
- **THEN** the section holds an item counting the two unconfirmed scenarios, an item counting the three requirements left out, and an item counting the two files, each file in a code span
- **AND** they follow the pending check's item, in that order

#### Scenario: Edge case — every source at once, in the fixed order

- **GIVEN** a plan that skipped `typecheck`; a `unit` step with no exec entry; a pipeline input for H with one pending check and one excluded name; a checked handoff for H with one unconfirmed scenario and two living requirements left out; a review record for H whose dimension record lists `security` skipped with a reason, `domain` degraded and `blast-radius` unavailable, and whose proof lists `qa` unproven, one unread input for `language` and one uncited path; a coverage record naming one file its report does not list; and no `--changed`
- **WHEN** the command runs with every other optional flag
- **THEN** the items read, in this order: the skipped kind; the session-recorded exit code; the pending check, then the excluded name; the unconfirmed scenario, then the requirements left out; `security`, `domain`, `blast-radius`; the unproven dimension, the unread input, the uncited path; the unlisted file; the missing changed-path list
- **AND** there are fourteen items, and every reviewer-written and platform-written string in them sits in a code span

### Requirement: `### Visual check owed` SHALL list the changed paths the surface classifier calls UI-testable, and SHALL attach nothing

With `--changed <files|->`, the last section SHALL be `### Visual check owed` when `interlock surface` classes a changed path `UI-TESTABLE`: those paths, their count, the number of changed paths it classes `UI-INDIRECT`, and a sentence saying no screen was looked at, no image is attached, and a person who has looked can add images to the thread. With no such path it SHALL be absent. Without `--changed` it SHALL be absent and a gap item SHALL say no changed-path list was given.

#### Scenario: Happy path — a component, a style file and a route handler

- **GIVEN** a changed list holding `src/components/Button.tsx`, `./src/styles/form.css`, `app/api/login/route.ts` and `docs/readme.md`
- **WHEN** the command runs with `--changed`
- **THEN** the comment's last section is `### Visual check owed`, listing the component and the style file in code spans, counting two, and saying one more changed path reaches a screen only indirectly
- **AND** it says no screen was looked at and no image is attached, and neither the route handler nor the document is listed

#### Scenario: Edge case — no UI-testable path

- **GIVEN** a changed list holding `docs/readme.md`, `lib/a.mjs` and `test/a.test.mjs`
- **WHEN** the command runs with `--changed`
- **THEN** the comment holds no `### Visual check owed` section
- **AND** the gap section holds no item about screens

#### Scenario: Edge case — no changed-path list

- **GIVEN** a run with no `--changed`
- **WHEN** the command runs
- **THEN** the comment holds no `### Visual check owed` section
- **AND** the gap section holds one item saying no changed-path list was given, so no screen was listed

#### Scenario: Edge case — the classes are the classifier's own

- **GIVEN** a changed list holding `src/components/Button.tsx`, `tests/components/Button.tsx`, `app/page.tsx`, `tailwind.config.js` and `src/hooks/useForm.ts`
- **WHEN** the command runs with `--changed`, and `interlock surface --changed` runs on the same list with `--json`
- **THEN** the paths the section lists are exactly the ones the second command classes `UI-TESTABLE`, and its indirect count is that command's `indirectCount`
- **AND** the test file under `tests/` is not listed

### Requirement: The comment SHALL fit a published bound and SHALL say what it left out

The comment SHALL be no longer than `LIMITS.maxValidationCommentChars`, which `interlock limits` publishes. Over it, rows SHALL be dropped last first, block by block, in order: confirmed rows, passing and skipped checks, the worker's `detail`, failing test names, visual paths, unconfirmed rows, failing and pending checks, gap items. A cut block SHALL say how many it lost, a section's first line SHALL still count the whole list, and the last line SHALL open `CUT:` and name each block and number.

#### Scenario: Happy path — a comment under the bound carries no cut line

- **GIVEN** records whose comment is shorter than the bound
- **WHEN** the command runs
- **THEN** no line opens `CUT:`
- **AND** under `--json`, `cut` is an empty list

#### Scenario: Failure — six hundred confirmed rows are cut and counted

- **GIVEN** a checked handoff for H with six hundred confirmed rows, long enough that the whole comment would pass the bound
- **WHEN** the command runs
- **THEN** standard output is no longer than the bound, the adherence section's first line still counts six hundred, and the confirmed block ends with a line saying how many rows were left out
- **AND** the comment's last line opens `CUT:` and names the confirmed rows with that number

#### Scenario: Edge case — gap items outlast every row

- **GIVEN** the same records with five gap items
- **WHEN** the command runs
- **THEN** all five gap items are present
- **AND** the `CUT:` line names no gap item

#### Scenario: Edge case — a long list of UI paths is cut and counted

- **GIVEN** a changed list holding enough `.tsx` paths that the whole comment would pass the bound
- **WHEN** the command runs
- **THEN** standard output is no longer than the bound, the visual section still counts every matching path, and it ends with a line saying how many paths were left out
- **AND** the `CUT:` line names the visual paths with that number

#### Scenario: Edge case — the bound is published

- **WHEN** `interlock limits` runs
- **THEN** its output names the validation comment's bound with its value
- **AND** `skills/settle/SKILL.md` states no number for it

### Requirement: The cut SHALL keep every heading, first line, marker line and the commands table

Whatever the cut drops, the comment SHALL keep each heading, each section's first line, the commands table, and the lines after it that open `RESULT DISAGREES:` or `RE-RUN:`, say whether the verification halted, or show a spill locator. A gap item that repeats such a line is a gap item like any other: it SHALL be dropped with them, last, and the gap section SHALL then say how many items it lost.

#### Scenario: Happy path — the commands table is whole beside six hundred cut rows

- **GIVEN** a plan with one `unit` step and four skipped kinds, and a checked handoff for H with six hundred confirmed rows, long enough that the whole comment would pass the bound
- **WHEN** the command runs
- **THEN** the commands table holds its five rows, and the line saying whether the verification halted follows it
- **AND** the comment's first line and its four section headings are present

#### Scenario: Failure — gap items alone pass the bound

- **GIVEN** a `unit` step whose two exit codes differ, and a review record for H whose proof lists enough unread inputs that the gap items alone would pass the bound
- **WHEN** the command runs
- **THEN** standard output is no longer than the bound, the gap section ends with a line saying how many items were left out, and the `CUT:` line names the gap items with that number
- **AND** the `RESULT DISAGREES:` line after the commands table is still present

### Requirement: `--summary` SHALL print the three lines the description's testing section carries

With `--summary`, the command SHALL print three lines in place of the comment, under the same refusals: `- Ran:` with each planned command, its kind, its exit code and its counts, or `no command ran`; `- Not run:` with the kinds the plan skipped, or `nothing skipped`; and `- Proof:` naming the `latest` `Validation` comment for the sha, or with `--unposted` reading `not posted` for it. A halted verification SHALL read `halted` on the first line. `--unposted` without `--summary` SHALL exit 1.

#### Scenario: Happy path — one green unit step and four skipped kinds

- **GIVEN** a plan with one `unit` step and four skipped kinds, an exec record whose entry for that step holds `exitCode: 0`, and a verdict for H
- **WHEN** the command runs with `--head H --summary --exec <that record>`
- **THEN** standard output is three lines opening `- Ran:`, `- Not run:` and `- Proof:`, the first holding the command in a code span, exit `0` with no `session-recorded` mark and the counts, the second the four kinds, and the third H and the word `latest`
- **AND** it holds no heading and no table

#### Scenario: Failure — a verdict for another commit prints nothing

- **GIVEN** a verdict whose `head` is not H
- **WHEN** the command runs with `--head H --summary`
- **THEN** it exits 1 with nothing on standard output
- **AND** standard error names both commits

#### Scenario: Edge case — a halted verification

- **GIVEN** a verdict for H with `halt: true` and a unit step that exited 1
- **WHEN** the command runs with `--summary`
- **THEN** the `- Ran:` line holds exit `1` and the word `halted`
- **AND** it exits 0

#### Scenario: Edge case — a plan with no step

- **GIVEN** a plan holding no step and five skipped kinds, and a verdict for H
- **WHEN** the command runs with `--head H --summary`
- **THEN** the first line reads `- Ran: no command ran`, and the second names the five kinds
- **AND** it still prints three lines and exits 0

#### Scenario: Edge case — a plan that skipped nothing

- **GIVEN** a plan with one `unit` step and no skipped kind, and a verdict for H
- **WHEN** the command runs with `--head H --summary`
- **THEN** the second line reads `- Not run: nothing skipped`
- **AND** it prints three lines

#### Scenario: Edge case — a comment that was not posted

- **GIVEN** the happy path's records
- **WHEN** the command runs with `--head H --summary --unposted`, and separately with `--unposted` and no `--summary`
- **THEN** the first prints three lines whose third opens `- Proof:`, holds `not posted` and H, and does not hold `latest`
- **AND** the second exits 1 naming `--unposted`, with nothing on standard output

### Requirement: The summary's exit codes SHALL be the comment's, with the same marks

A step's exit code on the `- Ran:` line SHALL be the one the comment's row shows under the same flags: the observed code with `--exec`, otherwise the results entry's, marked `session-recorded`. A step whose two codes differ SHALL carry `RESULT DISAGREES:` and both codes on that line. The verdict's own copy of an exit code SHALL be shown by neither form.

#### Scenario: Happy path — the summary and the comment show the same code

- **GIVEN** a results entry for `unit` with `exitCode: 0`, an exec entry for the same kind and command with `exitCode: 0`, and a verdict for H
- **WHEN** the command runs with `--exec`, with and without `--summary`
- **THEN** the `- Ran:` line and the comment's row both show exit `0`
- **AND** neither carries `session-recorded` or `RESULT DISAGREES:`

#### Scenario: Failure — the session recorded 0 and the command exited 1

- **GIVEN** a results entry for `unit` with `exitCode: 0`, an exec entry for the same kind and command with `exitCode: 1`, and a verdict for H whose own unit entry says exit 0
- **WHEN** the command runs with `--summary --exec`
- **THEN** the `- Ran:` line holds exit `1` and `RESULT DISAGREES:` with both codes
- **AND** it still prints three lines and exits 0

#### Scenario: Edge case — no exec record

- **GIVEN** the same results entry and verdict, and no `--exec`
- **WHEN** the command runs with `--summary`
- **THEN** the `- Ran:` line holds exit `0` marked `session-recorded`
- **AND** it holds no `RESULT DISAGREES:`

### Requirement: With `--review`, the skill SHALL post the comment one time per pass, as printed, before it composes the description, and SHALL never stop on it

After the assessment and before it composes the description, `skills/settle/SKILL.md` SHALL pipe `interlock settle validation` into the platform's comment command, body from standard input, one time per pass, typing none of it. When the command exits non-zero or the post fails it SHALL print `VALIDATION NOT POSTED: <reason>` and carry on. Without `--review` it SHALL post none. The GitLab line SHALL be marked not exercised.

#### Scenario: Happy path — the posting line sits between the assessment and the description

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a fenced `interlock settle validation` line carrying `--head`, `--plan`, `--results`, `--verify`, `--changed` and `--exec .claude/ship/settle/exec.jsonl`, piped into `gh pr comment` with `--body-file -`
- **AND** that line sits after the first `interlock merge-confidence` line that carries `--markdown` and before the fenced `interlock settle validation` line that carries `--summary`

#### Scenario: Failure — a comment that could not be rendered or posted

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section that holds the posting line
- **THEN** it finds `VALIDATION NOT POSTED:` and that the pass carries on
- **AND** it finds that the skill writes no part of the comment by hand

#### Scenario: Edge case — without the flag no comment is posted

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section's first paragraph
- **THEN** it names `--review` as the section's condition
- **AND** it says that without the flag no validation comment is posted

#### Scenario: Edge case — the GitLab line

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** the `glab mr note` line that posts the comment sits in a block marked `not exercised`
- **AND** the GitHub line carries no such marker

#### Scenario: Edge case — the final verification records what it ran

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the final verification's lines and the round's
- **THEN** the final verification's `interlock verify exec` line carries `--record .claude/ship/settle/exec.jsonl`
- **AND** the round's `interlock verify exec` line carries no `--record`

### Requirement: The skill SHALL render the comment only from records this pass wrote, for the paths the assessment was given

The skill SHALL pass each record flag only for a file this pass wrote. A pass whose loop did not start, or stopped early before the final verification, wrote no verdict: it SHALL print `VALIDATION NOT POSTED:` saying so and post nothing from an earlier pass's files. `--changed` SHALL be the changed-file list read again after the fix rounds, the one the confirmation and the assessment are passed. A pass SHALL edit or remove no earlier comment.

#### Scenario: Happy path — the section says which files and which paths are passed

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section that holds the posting line
- **THEN** it finds that every record flag is passed only for a file `this pass wrote`
- **AND** it finds that `<files>` is the list `§5e` read again, and not the list of `§3`

#### Scenario: Failure — a pass with no final verification of its own posts none

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the same section
- **THEN** it finds that a pass whose loop `did not start` or `stopped early` prints `VALIDATION NOT POSTED:` and runs no posting line
- **AND** it finds that nothing left in `.claude/ship/settle/` by an earlier pass is rendered

#### Scenario: Edge case — a second pass on the same commit

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the same section
- **THEN** it finds that each pass posts its own comment and edits or removes no earlier one
- **AND** it finds that the `latest` comment for a commit is the one `## Testing` names

### Requirement: Both new commands SHALL be members of the `settle` family: listed, accepted, smoked, documented and pure

`interlock settle --help` SHALL list `handoff-check` and `validation` with their usage lines. The CLI's accepted-flag table SHALL hold the flags of each, the post-install smoke SHALL run each, and `docs/07-cli-and-configuration.md` SHALL describe each in its settle table. Neither SHALL start a process or open a connection, and the modules holding their rules, `lib/settle-validation.mjs` and `lib/settle-handoff.mjs`, SHALL import no `node:` module.

#### Scenario: Happy path — help lists both

- **WHEN** `interlock settle --help` runs
- **THEN** standard output holds a usage line beginning `interlock settle handoff-check ` and one beginning `interlock settle validation `

#### Scenario: Failure — a flag the table does not hold is refused

- **WHEN** `interlock settle validation --head x --nonsense` runs
- **THEN** it exits non-zero naming `--nonsense`

#### Scenario: Edge case — every command the shipped skill spells is known, accepted and smoked

- **GIVEN** the shipped `skills/settle/SKILL.md` with its check line, its summary line and its posting lines
- **WHEN** the shipped-form inventory test runs
- **THEN** it passes: each leaf is known, each flag is accepted for its leaf, and the smoke inventory runs each leaf

#### Scenario: Edge case — the documentation names both

- **WHEN** a test reads `docs/07-cli-and-configuration.md`
- **THEN** it finds a table row beginning `interlock settle handoff-check` and one beginning `interlock settle validation`

#### Scenario: Edge case — the rules modules are pure

- **WHEN** a test reads the imports of the two modules that hold the commands' rules
- **THEN** none names a `node:` module
