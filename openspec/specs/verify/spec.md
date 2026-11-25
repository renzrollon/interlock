# verify Specification

## Purpose

Keeps verification policy in the CLI while stopping verify agents from pasting oversized suite logs into context — they get a disk locator and a bounded preview instead.

## Requirements

### Requirement: Oversized verify output is spilled

When a planned verification step's combined stdout and stderr exceeds the spill threshold, the system MUST write the full bytes to a stable on-disk locator under the ship work directory and MUST NOT require the verify agent to return that full text in its structured result. The result for that step MUST include the locator, byte length, a truncated preview, and a content hash. Output at or below the threshold MAY be returned inline and MUST still be persisted when a run id is active so the trajectory can point at it.

#### Scenario: Large unit stdout becomes a locator

- **WHEN** a unit step emits more than the spill threshold of runner output
- **THEN** the verify result for that kind carries a repo-relative locator under `.claude/ship/`, a preview shorter than the full output, `truncated=true`, and a hash of the full bytes, and the full output is readable at the locator

#### Scenario: Small typecheck output stays inline

- **WHEN** a typecheck step emits fewer bytes than the spill threshold
- **THEN** the verify result MAY include the output inline, and a persisted copy still exists when the run has a run id

### Requirement: Agents receive preview plus locator, not the suite log

A verify agent (inter-wave or final) MUST report `exitCode`, counts, and failure signatures or clusters as today. It MUST NOT paste spilled output into `cliStdout`, `detail`, `failures`, or any other result field. `failures` MUST remain short lines or objects suitable for clustering. The preview MUST be a head-and-tail slice with an explicit omission marker so the model can see the start of the failure and the summary line without loading the middle.

#### Scenario: Judge still works from counts and clusters

- **WHEN** `interlock verify judge` is given a plan plus results whose unit step has spilled stdout and a `failures` array of short lines
- **THEN** the verdict is identical to judging the same counts and failures without the full log present in the result object

#### Scenario: Pasting spilled bytes into the result is rejected

- **WHEN** a verify result field that is not the preview contains more characters than the preview budget
- **THEN** the CLI rejects that result as oversized rather than passing it through as a judgement input

### Requirement: Spill obeys existing token-economy rules

Spill MUST reuse Interlock's locate-before-read discipline: the locator is the way to find the log; a later Read of the file MUST use offset/limit rather than loading the whole suite. Spill MUST NOT introduce a Cordis-style plugin host, a generic tool-result bus, or a second orchestrator. Threshold and preview budgets MUST live in `interlock limits` so they cannot be restated in `workflows/ship.js` prose.

#### Scenario: Limits print spill caps

- **WHEN** an operator runs `interlock limits`
- **THEN** the output names the spill threshold and the preview character budget as integers, alongside the existing ship caps

#### Scenario: Shared tool-economy doc describes verify spill

- **WHEN** an agent follows `shared/TOOL-ECONOMY.md` during verification
- **THEN** that document tells it to treat spilled suite output as a locator plus preview and not to Read the spilled file in full

### Requirement: Inter-wave plan is scoped by changed paths and budget

`interlock verify plan` MUST accept `--changed <files...>`, `--context <inter-wave|final>`, and `--budget-ms <n>` (budget already exists; it MUST remain). When `--context inter-wave`, the plan MUST NOT include e2e or coverage steps unless the caller also passed `--e2e` / did not pass `--no-coverage` *and* those flags are explicitly documented as overriding — default inter-wave is typecheck, unit, lint only. When `--changed` names at least one path and every path is documentation, the plan MUST emit no runnable steps and MUST skip every kind with a machine-readable docs-only reason. When elapsed time is at or past the budget, only typecheck remains, as today.

#### Scenario: Docs-only --changed skips the inter-wave plan

- **WHEN** `interlock verify plan --no-profile --context inter-wave --changed docs/foo.md README.md --json`
- **THEN** `steps` is empty and every skip carries the docs-only reason

#### Scenario: Inter-wave default omits e2e and coverage

- **WHEN** `interlock verify plan --profile <file> --context inter-wave --typecheck-command "tsc --noEmit" --json` with no `--e2e`
- **THEN** the plan has no e2e step and no coverage step

#### Scenario: Budget still collapses to typecheck

- **WHEN** `interlock verify plan` is given `--elapsed-ms` at or above `--budget-ms` (or the default budget) and a typecheck command
- **THEN** the only remaining step is typecheck, and unit/lint skips use the existing budget-exceeded reason

### Requirement: Ship inter-wave pings consume the structural plan

The ship wave loop MUST tell the verify (or fused record+verify) ping to call `interlock verify plan --context inter-wave --changed <paths from the completed wave> --budget-ms` (or the published default) and to run only the emitted steps. It MUST NOT instruct the agent to invent extra suites or to ignore a docs-only skip.

#### Scenario: Fused ping still uses verify plan

- **WHEN** a `record-batch` ping's `--write-state` stdout is `action: verify`
- **THEN** that same agent runs `interlock verify plan` with `--context inter-wave` before running checks, rather than spawning a new `inter-wave-verify-*` agent as a prerequisite

### Requirement: The verification verdict SHALL carry the type check's own result

The verdict `interlock verify judge` returns SHALL carry the type check's result as a field of its own, beside the unit, end-to-end and coverage results, in every context: whether it ran, its exit code, and whether it passed. When no type-check result was reported, the field SHALL be present and empty. The field SHALL NOT change which kinds halt in a context: a type check that fails at the final gate SHALL still be reported with its non-blocking banner and SHALL NOT halt.

Rationale: a passing type check otherwise leaves no trace in the verdict, so a reader cannot tell "passed" from "planned and never reported", and a failed one is visible only as a banner string. The merge verdict reads this field rather than parsing banners.

#### Scenario: Happy path — a passing type check is recorded

- **GIVEN** a plan with a type-check step and a reported type-check result that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict's type-check field records that it ran and passed

#### Scenario: Failure — a type check that failed at the final gate is recorded and still does not halt

- **GIVEN** a plan with a type-check step and a reported type-check result that exited non-zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict's type-check field records that it ran and did not pass, with the exit code
- **AND** the verdict does not halt, and carries the non-blocking type-check banner as before

#### Scenario: Edge case — no type-check result reported

- **GIVEN** a plan with a type-check step and results that carry no type-check entry
- **WHEN** the results are judged
- **THEN** the verdict's type-check field is present and empty
- **AND** every other field of the verdict is what it was before this field existed

### Requirement: The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant

For the inter-wave context, the verify budget SHALL be the number of inter-wave verifications a run may spend, as `interlock limits` publishes it, multiplied by the test profile's `unit.timeout_ms`, whenever that field is a positive integer. The budget SHALL never be less than the inter-wave verify budget `interlock limits` publishes: a profile can raise the budget and SHALL NOT be able to lower it. With no profile, or a `unit.timeout_ms` that is absent, null, zero or negative, the budget SHALL be the published one. A product too large to represent exactly SHALL be clamped to the largest exact integer rather than overflowing.

`interlock verify plan --context inter-wave`, given a profile and no `--budget-ms`, SHALL plan against the derived budget and SHALL report both the budget and where it came from. An explicit `--budget-ms` SHALL be used as given. Outside the inter-wave context nothing SHALL be derived.

Both factors SHALL be read at use from the limits definition and the profile; neither SHALL be restated as a literal.

A constant budget fits only the repositories whose suites fit it. A solution whose one honest checkpoint costs more than the constant spends the whole budget on that checkpoint, and every later one is reduced to a typecheck. Scaling the budget by the profile's own per-suite allowance lets the checkpoints the cap already permits run in full, and the floor keeps the profile from being a way to buy less verification.

#### Scenario: Happy path — a profile with a suite allowance raises the budget

- **GIVEN** a profile whose `unit.timeout_ms` is 120000, and a typecheck command
- **WHEN** `interlock verify plan --profile <file> --context inter-wave --elapsed-ms 160000 --json` runs
- **THEN** the reported budget is the published checkpoint cap multiplied by 120000, and its source is the profile
- **AND** the plan still holds the unit step

#### Scenario: Failure — a profile cannot lower the budget

- **GIVEN** a profile whose `unit.timeout_ms` is 1
- **WHEN** `interlock verify plan --profile <file> --context inter-wave --json` runs with `--elapsed-ms` equal to the published inter-wave verify budget
- **THEN** the reported budget is the published one, and its source is the published limit
- **AND** only the typecheck step remains, with the unit and lint skips carrying the budget-exceeded reason

#### Scenario: Edge case — an unusable allowance, an oversized one and an explicit budget

- **GIVEN** four profiles whose `unit.timeout_ms` is respectively absent, `null`, `0` and `9007199254740991`
- **WHEN** `interlock verify plan --context inter-wave --json` runs against each
- **THEN** the first three report the published budget with the published limit as its source
- **AND** the fourth reports the largest exact integer, not a non-finite number
- **AND** the same command given `--budget-ms 5000` against any of them reports a budget of 5000

### Requirement: A run SHALL fix its inter-wave verify budget at start and SHALL report it

A ship run SHALL derive its inter-wave verify budget once, when it starts, from the test profile it located, and SHALL record the budget and its source on the run. Every inter-wave plan of that run SHALL use the recorded budget. A change to the profile after the run started SHALL NOT move it. The run's receipt SHALL carry the budget and its source.

When a checkpoint is reduced because the budget is spent, and the budget is the published one because the profile carried no usable `unit.timeout_ms`, the run SHALL raise a banner that says so and names the command that records one. A checkpoint is reduced whenever a check was dropped for the spent budget: whether nothing is left to run, or the typecheck alone is left because the profile names a typecheck command. The banner SHALL be raised in both cases, and SHALL be raised once per run.

A run whose record carries no budget, because it started before the budget was recorded, SHALL use the published budget.

The budget is derived at the start rather than at each checkpoint so that it is a fact of the run, recorded once, rather than a value an agent working in the tree could move while the run is under way.

#### Scenario: Happy path — a later checkpoint still runs the suite

- **GIVEN** a run started against a profile whose `unit.timeout_ms` is 120000, whose first checkpoint's checks took 160 seconds
- **WHEN** the run plans its second inter-wave checkpoint
- **THEN** the plan holds the unit step
- **AND** the run's receipt carries the derived budget and names the profile as its source

#### Scenario: Failure — a budget left at the floor says why it ran out

- **GIVEN** a run started against a profile with no `unit.timeout_ms`, whose first checkpoint's checks took longer than the published budget
- **WHEN** the run plans its second inter-wave checkpoint
- **THEN** the unit step is skipped with `VERIFICATION SKIPPED: reason=verify-budget-exceeded`
- **AND** the run raises a banner containing `VERIFY BUDGET AT THE PUBLISHED FLOOR` and `/interlock:fix-tests --reconfigure`
- **AND** a third reduced checkpoint in the same run does not raise that banner again

#### Scenario: Failure — a checkpoint cut to typecheck alone says why as well

- **GIVEN** a run started against a profile that names a typecheck command and a unit command and carries no `unit.timeout_ms`, whose earlier checkpoints have spent the published budget
- **WHEN** the run plans its next inter-wave checkpoint
- **THEN** the plan holds the typecheck step alone, and the checkpoint is dispatched rather than skipped
- **AND** the run raises a banner containing `VERIFY BUDGET AT THE PUBLISHED FLOOR` and `/interlock:fix-tests --reconfigure`
- **AND** a later checkpoint reduced the same way does not raise that banner again

#### Scenario: Edge case — the profile changes mid-run, and an older run resumes

- **GIVEN** a run started against a profile whose `unit.timeout_ms` is 120000, after which the profile's value is changed to 1 and then to 900000
- **WHEN** the run plans each later checkpoint
- **THEN** each plan uses the budget recorded at the start
- **AND** a run whose record was written before the budget was recorded plans against the published budget and raises no banner about its absence

### Requirement: The coverage reader SHALL compute a project total and changed-line coverage on canonical repository paths

Given an lcov coverage report, the CLI SHALL compute the project total as covered lines over instrumented lines across every record, from each record's line-found and line-hit summary when present and from its per-line entries otherwise. Given the lines a diff adds, it SHALL compute changed-line coverage over the added lines that the report instruments, and SHALL report how many such lines there were. A report file path SHALL be resolved to one canonical repository-relative form before it is matched against a diff path, whether the report wrote it absolute, relative to the directory the coverage command ran in, or with a leading `./`. A record whose file lies outside the repository SHALL be left out of both figures and counted, and the count SHALL be stated. An added line the report does not instrument (a comment, a blank line, a file the report does not cover) SHALL NOT count as a changed line.

Rationale: no code in the repository reads a coverage report today, so the merge verdict's coverage input has no producer; and a report path that fails to match a diff path silently reads as "no changed lines", which the verdict treats as a small change and passes.

#### Scenario: Happy path — a total and a changed-line figure from one report

- **GIVEN** an lcov report with two file records whose summaries give 80 of 100 and 15 of 20 lines hit, and a diff that adds four instrumented lines in the first file, three of them hit
- **WHEN** the coverage figures are computed
- **THEN** the project total is 79.2 percent, from 95 of 120 lines
- **AND** the changed-line coverage is 75 percent over 4 changed lines

#### Scenario: Failure — a report with no instrumented line has no total

- **GIVEN** an lcov report whose records instrument no line at all
- **WHEN** the coverage figures are computed
- **THEN** the project total is absent, not zero
- **AND** the absence is stated, so no caller can record it as a measured figure

#### Scenario: Edge case — three spellings of one file resolve to the same path

- **GIVEN** a report run from the repository root whose records name `./lib/a.mjs`, and a second report whose records name the same file by its absolute path inside the repository, and a diff that adds lines to `lib/a.mjs`
- **WHEN** the changed-line coverage is computed from each report
- **THEN** both reports match the diff's lines to the same file and give the same figure
- **AND** a record naming a file outside the repository is left out of both figures and counted in the output

### Requirement: A coverage baseline SHALL be recorded only with a project total, and SHALL be usable only from an ancestor of the head

`interlock verify baseline` SHALL record the project total of a coverage report taken on the current commit, together with that commit, the branch it was taken on when there is one, the time it was written and a schema identifier, in the working root's testing directory or at a path the caller names. It SHALL refuse to write, exit 1 and leave any previous baseline in place when the report yields no project total or cannot be read. A reader SHALL look for the baseline at the path the caller names, else in the working root and then in the state home, as the test profile is found, and SHALL NOT write it into the state home. A baseline SHALL be usable as the base figure only when its commit is an ancestor of the head; whether it is SHALL be a fact read from the repository, never an age. A baseline file that exists and does not match the schema SHALL end the reading command with exit 1, naming the file.

Rationale: a baseline from another branch compares the change against code it never had; a baseline of any age on the change's own line of history is still the right comparison. A corrupt baseline read as "no baseline" would quietly move the judgement to a different rule.

#### Scenario: Happy path — a baseline from the default branch is used on a branch made from it

- **GIVEN** a baseline recorded on a commit of the default branch, and a branch whose head descends from that commit
- **WHEN** the coverage input is produced on the branch
- **THEN** the base figure is the baseline's total, with the baseline's commit
- **AND** the input states that the baseline's commit is an ancestor of the head

#### Scenario: Failure — a report with no total writes no baseline

- **GIVEN** an existing baseline, and a coverage report whose records instrument no line
- **WHEN** `interlock verify baseline` runs on that report
- **THEN** it exits 1, naming the missing total
- **AND** the existing baseline is unchanged

#### Scenario: Edge case — an old baseline on the same line of history, and a new one from another branch

- **GIVEN** a baseline recorded many commits ago on an ancestor of the head, and separately a baseline recorded today on a branch the head does not descend from
- **WHEN** the coverage input is produced against each
- **THEN** the first states that its commit is an ancestor of the head, whatever its age
- **AND** the second states that its commit is not an ancestor, so the merge verdict reads the coverage signal unobserved

#### Scenario: Edge case — a baseline file that does not match the schema

- **GIVEN** a baseline file whose schema identifier is missing or whose total is not a number between 0 and 100
- **WHEN** the coverage input is produced
- **THEN** the command exits 1 naming the baseline file
- **AND** standard output carries no coverage input

### Requirement: The coverage input the merge verdict reads SHALL be produced by the CLI from the head report, the baseline and the diff

`interlock verify coverage --base <ref>` SHALL print the coverage input the merge-confidence command reads, with the fields that input's schema names and no other judgement: the head total, the base total and its commit when a baseline is usable or present, whether the baseline's commit is an ancestor of the head, the changed-line coverage, the number of changed lines, the changed source files the report does not list (`unreportedFiles`), and the number of lines the diff adds in those files (`unreportedAddedLines`), all computed against the diff from the merge base of the reference to the head. A file SHALL be listed as unreported only when the diff adds at least one line to it, the report holds no record for it, and the project counts it as coverable source: a test, a configuration file or a document SHALL never be listed. Both fields SHALL be computed in `lib/coverage.mjs` from the report and the diff alone, and the changed-line figure SHALL still count only lines the report instruments. When the test profile declares no coverage command, or declares coverage disabled, and no report is named, it SHALL print an input that says coverage is not configured, in which both unreported fields are null. When a coverage command is declared and its report cannot be found or read, or is in a format the reader does not support, it SHALL exit 1, naming the report and the supported format, and print nothing on standard output. It SHALL run no coverage command unless asked to compute the base.

Rationale: the verdict's coverage signal reads exactly this schema; the producer computes figures and never bands them, so the thresholds stay in one module. The changed-line figure is honest about what it measured and silent about what it did not: the files a report never saw are the ones no test loaded, and the verdict cannot say so unless the input names them.

#### Scenario: Happy path — a configured repository with a usable baseline

- **GIVEN** a test profile with a coverage command, a readable lcov report at its report path, a usable baseline, and a base reference
- **WHEN** `interlock verify coverage --base <ref> --json` runs
- **THEN** it prints `configured: true`, the head total, the base total and commit, `baseIsAncestor: true`, the changed-line coverage and the changed-line count
- **AND** it exits 0 and prints no band or verdict

#### Scenario: Failure — a declared report that is missing

- **GIVEN** a test profile with a coverage command whose report path does not exist
- **WHEN** `interlock verify coverage --base <ref> --json` runs
- **THEN** it exits 1, naming the report path and saying the coverage command must run first
- **AND** standard output is empty, so the merge verdict reads the coverage signal unobserved rather than clean

#### Scenario: Edge case — no coverage tooling, and no baseline

- **GIVEN** one repository whose test profile declares no coverage command, and another with a readable report and no baseline anywhere
- **WHEN** `interlock verify coverage --base <ref> --json` runs in each
- **THEN** the first prints an input saying coverage is not configured
- **AND** the second prints the head total and changed-line figures with every base field empty, so the verdict judges the change on its changed lines alone

#### Scenario: Failure — a new source file no test loaded is named, not passed over

- **GIVEN** a diff that adds a source file of forty lines which the report holds no record for, beside a source file the report does list
- **WHEN** `interlock verify coverage --base <ref> --json` runs
- **THEN** `unreportedFiles` lists the first file only and `unreportedAddedLines` is forty
- **AND** the changed-line figure and count are what they are without that file

#### Scenario: Edge case — a test file outside the report, and no coverage configured

- **GIVEN** a diff that adds a test file the report holds no record for, and separately a profile that declares no coverage command
- **WHEN** the command runs for each
- **THEN** the first prints an empty `unreportedFiles` and an `unreportedAddedLines` of zero
- **AND** the second prints both fields as null

### Requirement: Computing the base figure on demand SHALL run in a temporary worktree that is always removed

With `--compute-base`, when no usable baseline exists, `interlock verify coverage` SHALL check out the merge base of the reference and the head in a temporary worktree outside the repository, run the test profile's coverage command there with the profile read from the main working tree, read the report at the profile's report path inside that worktree, record its total as the baseline with the merge base as its commit, and use it as the base figure. The temporary worktree SHALL be removed whether the command succeeded, failed or could not start. A failed or unreadable base measurement SHALL exit 1, naming the coverage command and its exit status, after the worktree is removed. The command SHALL state on standard error that it recorded a baseline.

Rationale: a repository with no job on its default branch has no other way to obtain a base figure; a worktree left behind on failure is the cleanup gap the existing lane code already has.

#### Scenario: Happy path — a base figure computed and recorded

- **GIVEN** a repository with no baseline, a coverage command that passes on the merge base, and a base reference
- **WHEN** `interlock verify coverage --base <ref> --compute-base --json` runs
- **THEN** the input carries the merge base's total as the base figure and the merge base as its commit
- **AND** a baseline is recorded for that commit, the temporary worktree no longer exists, and standard error says a baseline was recorded

#### Scenario: Failure — the coverage command fails on the merge base

- **GIVEN** a coverage command that exits non-zero when run on the merge base
- **WHEN** `interlock verify coverage --base <ref> --compute-base --json` runs
- **THEN** it exits 1 naming the command and its exit status
- **AND** the temporary worktree no longer exists, and no baseline is recorded

#### Scenario: Edge case — a usable baseline already exists

- **GIVEN** a usable baseline whose commit is an ancestor of the head
- **WHEN** `interlock verify coverage --base <ref> --compute-base --json` runs
- **THEN** no worktree is created and no coverage command runs
- **AND** the existing baseline is the base figure

### Requirement: The test profile SHALL be able to name a build command, and no discovery step SHALL invent one

The test profile SHALL accept a `build` section holding a command, a working directory and a time allowance, validated as the other sections are. `/interlock:fix-tests` SHALL resolve the command as it resolves the type check's: the profile's own value, then the project manifest's build script, then the step of the CI job that runs it. It SHALL NOT ask for one and SHALL NOT invent one: with nothing found the command SHALL be `null`.

#### Scenario: Happy path — a profile with a build section is accepted

- **GIVEN** a profile whose `build` section is `{ "command": "npm run build", "cwd": ".", "timeout_ms": 300000 }`
- **WHEN** `interlock verify plan --profile <file> --context final --json` runs
- **THEN** it exits 0 and the plan holds a build step
- **AND** `interlock doctor` reports the same profile's `test-profile` row as it did without the section

#### Scenario: Failure — a malformed build section is refused by name

- **GIVEN** one profile whose `build.command` is a number, and another whose `build.timeout_ms` is the string `"300000"`
- **WHEN** `interlock verify plan --profile <file> --json` runs against each
- **THEN** each exits 1, the first naming `build.command` and the second naming `build.timeout_ms`
- **AND** no plan is printed

#### Scenario: Edge case — nothing found is null, and the skill never asks

- **GIVEN** the shipped `skills/fix-tests/SKILL.md` and `shared/TEST-PROFILE.md`
- **WHEN** the skill suite reads them
- **THEN** the skill names `build.command` and `scripts.build` in the paragraph that resolves the type-check and lint commands, and that paragraph still says never to ask for one and never to invent one
- **AND** the contract's schema holds a `"build"` section, and its field table says a `null` build command is skipped with a reason, never guessed

### Requirement: The build SHALL be planned at the final gate only, from the profile's own command

`interlock verify plan` SHALL plan a build step only outside the inter-wave context, from the profile's `build.command` verbatim, with the profile's working directory and time allowance, after the lint step and before coverage and end-to-end, and SHALL mark it blocking. Between waves it SHALL skip the build with a reason of its own, and no flag SHALL plan it there. With no build command it SHALL skip the build with the no-detectable-command reason.

#### Scenario: Happy path — a final plan holds the build step

- **GIVEN** a profile with a unit command, a lint command, and a `build` section whose command is `npm run build` and whose `timeout_ms` is 300000
- **WHEN** `interlock verify plan --profile <file> --context final --json` runs
- **THEN** the plan holds a `build` step whose command is `npm run build`, whose `blocking` is true and whose `timeoutMs` is 300000
- **AND** the step sits after the `unit` and `lint` steps and before any coverage or end-to-end step

#### Scenario: Failure — no build command is a stated skip, never a guess

- **GIVEN** a profile with no `build` section, a profile whose `build` is `null`, and separately no profile at all
- **WHEN** `interlock verify plan --context final --json` runs for each
- **THEN** no plan holds a build step
- **AND** each plan's `skipped` list holds a `build` entry whose reason is `no-detectable-command`

#### Scenario: Edge case — between waves the build is never planned

- **GIVEN** a profile with a unit command and a build command
- **WHEN** `interlock verify plan --profile <file> --context inter-wave --json` runs
- **THEN** the plan holds no build step, and its `skipped` list holds a `build` entry whose reason is `final-gate-only`
- **AND** the budget the plan reports is what it reports for the same profile without the `build` section

#### Scenario: Edge case — a documentation-only change, and a spent budget

- **GIVEN** a profile with a build command
- **WHEN** the final plan is made once with `--changed docs/a.md` and once with `--elapsed-ms` at the budget
- **THEN** the first plan skips the build with the docs-only reason, as it skips every kind
- **AND** the second plan skips the build with the budget-exceeded reason

### Requirement: The verification verdict SHALL carry the lint's and the build's own results

The verdict `interlock verify judge` returns SHALL carry the lint's result and the build's result, each as a field of its own beside the type check's, in every context: whether it ran, its exit code, and whether it passed. A step that could not be executed SHALL be recorded as not passed. When no result was reported for a kind, its field SHALL be present and empty.

#### Scenario: Happy path — a passing lint and a passing build are recorded

- **GIVEN** a final plan with a lint step and a build step, and reported results for both that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict's lint field and its build field each record that the step ran and passed, with exit code 0

#### Scenario: Failure — a lint that could not run is recorded as not passed

- **GIVEN** a plan with a lint step and a reported lint result that says it did not run
- **WHEN** the results are judged
- **THEN** the verdict's lint field records that it did not run and did not pass, with no exit code
- **AND** the verdict carries a warning that names the lint and does not halt

#### Scenario: Edge case — no lint or build result reported

- **GIVEN** a plan with a lint step and a build step, and results that carry neither
- **WHEN** the results are judged
- **THEN** the verdict's lint field and its build field are both present and empty
- **AND** the unit, type-check, end-to-end and coverage fields are what they are without these two

### Requirement: A failed build SHALL halt the final gate, and a failed lint SHALL halt nothing

At the final gate a build that failed, or that could not be executed, SHALL halt the verdict, with a reason that names the build. The final gate's halting kinds SHALL be the unit suite and the build; the inter-wave halting kinds SHALL stay the type check and the unit suite. A failed lint SHALL be reported with a non-blocking warning in every context and SHALL NOT halt.

#### Scenario: Happy path — a green build passes the gate

- **GIVEN** a final plan with a unit step and a build step, and results for both that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict does not halt
- **AND** its halting kinds are the unit suite and the build

#### Scenario: Failure — a red build halts the final gate

- **GIVEN** a final plan with a unit step and a build step, a unit result that exited zero and a build result that exited 2
- **WHEN** `interlock verify judge --context final` judges them
- **THEN** the verdict halts with a reason that names the build and exit code 2, and the command exits 1
- **AND** a ship run whose final verification returns that verdict halts with that reason and commits nothing

#### Scenario: Failure — a build that could not run halts as well

- **GIVEN** a final plan with a build step and a reported build result that says it did not run
- **WHEN** the results are judged at the final gate
- **THEN** the verdict halts, and its reason says the build could not be executed

#### Scenario: Edge case — a red lint beside a green suite does not halt

- **GIVEN** a plan with a unit step and a lint step, a unit result that exited zero and a lint result that exited 1
- **WHEN** the results are judged, once at the final gate and once between waves
- **THEN** neither verdict halts, and each carries a non-blocking warning that names the lint
- **AND** each verdict's lint field records that the lint did not pass

#### Scenario: Edge case — a build result judged between waves does not halt

- **GIVEN** a unit result that exited zero and a build result that exited 2, handed to the judge although no inter-wave plan holds a build step
- **WHEN** `interlock verify judge --context inter-wave` judges them
- **THEN** the verdict does not halt, and carries a non-blocking warning that names the build
- **AND** its build field records that the build did not pass

#### Scenario: Edge case — a red type check at the final gate still does not halt

- **GIVEN** a final plan with a type-check step and a build step, a type-check result that exited non-zero and a build result that exited zero
- **WHEN** the results are judged at the final gate
- **THEN** the verdict does not halt, and carries the non-blocking type-check banner as before

### Requirement: The verification briefing SHALL state each planned step's time allowance

The briefing a ship run gives its verify agent SHALL name, in one paragraph after the planned lines, the time allowance of every planned step that carries one. It SHALL tell the agent to set its shell tool's timeout to the larger of the tool's default and the allowance, capped at the tool's maximum, and to report a step ended at its timeout as failed. A plan with no allowance SHALL be briefed as it is without the paragraph.

#### Scenario: Edge case — an allowance below the tool's default is a floor

- **GIVEN** a final plan whose unit step carries an allowance of 40000, one measured green run of the suite
- **WHEN** the verification briefing is assembled
- **THEN** the paragraph tells the agent to use the larger of the tool's default and the allowance, and never asks for a timeout shorter than the tool's default

#### Scenario: Happy path — a build's allowance reaches the agent

- **GIVEN** a final plan whose unit step carries an allowance of 120000 and whose build step carries one of 300000
- **WHEN** the verification briefing is assembled
- **THEN** it holds `TIME ALLOWANCES` one time, in a paragraph that names `unit` with 120000 and `build` with 300000
- **AND** every planned line is still the `interlock verify exec` command alone, and the paragraph sits after the sentence that says to run each line as written

#### Scenario: Failure — a step ended at its timeout is not reported as a pass

- **GIVEN** the same briefing
- **WHEN** a reader finds the paragraph
- **THEN** it says a step the tool ended at its timeout is reported with a `non-zero` exit code, naming the step and the timeout

#### Scenario: Edge case — a plan with no allowance is briefed as before

- **GIVEN** a plan whose steps are a type check and a lint, and separately a plan whose unit step's allowance is `null`, zero or negative
- **WHEN** each briefing is assembled
- **THEN** neither holds `TIME ALLOWANCES`
- **AND** each is byte for byte the briefing the same steps get without this requirement

#### Scenario: Edge case — between waves, and on a fix attempt

- **GIVEN** an inter-wave plan whose unit step carries an allowance, briefed once as a first attempt and once as a fix attempt
- **WHEN** each briefing is assembled
- **THEN** each holds the paragraph one time

### Requirement: `interlock verify exec` SHALL append what it observed to the file `--record` names, and a record it cannot write SHALL NOT change the exit code

With `--record <file>`, `interlock verify exec` (`lib/verify-exec.mjs`) SHALL append one JSON line `{ kind, command, exitCode, durationMs, at }` to that file after the command ends, creating the file's directories: the timing line it already records, byte for byte. Its exit code SHALL stay the command's. A record it cannot write, and a `--record` with no file, SHALL be said on standard error and SHALL change nothing else. Without `--record` it SHALL write no such file.

#### Scenario: Happy path — a command that exits 0

- **GIVEN** `--kind unit`, a command that exits 0, and `--record` naming a file in a directory that does not yet exist
- **WHEN** the command runs
- **THEN** the file holds one line that parses to an object with `kind: "unit"`, the command as given, `exitCode: 0`, a non-negative integer `durationMs` and an `at` timestamp
- **AND** the process exits 0

#### Scenario: Failure — a command that exits 3

- **GIVEN** a command that exits 3 and `--record` naming a file
- **WHEN** the command runs
- **THEN** the appended line holds `exitCode: 3`
- **AND** the process exits 3

#### Scenario: Failure — a record path that cannot be written

- **GIVEN** `--record` naming a path under an existing regular file, and a command that exits 0
- **WHEN** the command runs
- **THEN** standard error says the record was not written and names the path
- **AND** the process exits 0, and the timing it already records is still appended

#### Scenario: Edge case — no `--record`

- **GIVEN** the same command with no `--record`
- **WHEN** the command runs
- **THEN** no record file is written anywhere under `.claude/ship/settle/`
- **AND** its exit code and its timing line are what they were before the flag existed

#### Scenario: Edge case — two runs append two lines

- **GIVEN** the same `--record` file and two runs of one command, the first exiting 1 and the second exiting 0
- **WHEN** both have run
- **THEN** the file holds two lines in the order the runs ended, with `exitCode` 1 and then 0
- **AND** the first line is unchanged by the second run

#### Scenario: Edge case — a `--record` with no file

- **GIVEN** `--record` followed by another flag, or by a blank value, and a command that exits 2
- **WHEN** the command runs
- **THEN** standard error says `--record` needs a file, no record file is written, the process exits 2 and the timing line is still appended
