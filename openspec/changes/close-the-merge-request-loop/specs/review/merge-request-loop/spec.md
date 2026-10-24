# review/merge-request-loop Specification

## Purpose
The loop `/interlock:mr --review` drives after a merge request exists: review the merge request's own diff, post the findings, fix them in bounded rounds that commit and push, reply with what each finding became, confirm the scenarios, verify the head, and hand the verdict evidence bound to that head. The `interlock mr` command family renders every comment and computes every status, so nothing a reader sees on the merge request is a judgement a model typed.

## ADDED Requirements

### Requirement: The skill SHALL enter the loop only with `--review`, after the merge request exists, and SHALL produce its evidence in a fixed order

With `--review`, after the merge request exists, the `mr` skill SHALL run, in this order: a `review-code` pass on the merge request's diff with `--base origin/<target>` and `--out` under `.claude/ship/mr/`; the findings comment `interlock mr comment` renders; fix rounds, each a fixer briefed by `interlock mr remediate-brief`, the fixer's whole tree staged and classified by `interlock mr test-paths` with the protected paths reverted, and then, when a staged change remains, a commit, a push, a fresh `review-code` pass on the pushed head and the reply table `interlock mr replies` renders, or, when none remains, the reply table rendered from the round's own review on both sides and the end of the loop; the merge request marked ready when this pass created it as a draft; the confirmation worker briefed by `interlock mr conformance-brief`; the final verification through `interlock verify plan`, `exec` and `judge` with `--context final` and `--head`, and `interlock verify coverage` for the head when the plan ran a coverage step; the platform's checks, then the pipeline document re-read from the platform for the pushed head; and only then the assessment. Without `--review` the skill SHALL run none of this and SHALL behave as it did before the flag existed. A pass SHALL clear `.claude/ship/mr/` before it writes there.

Rationale: a reply that cites a commit the platform never saw, a verdict read from evidence about an earlier head, and a pipeline document read before the checks ran on the pushed head are the failures the order exists to prevent; clearing the directory keeps a stale round from an earlier pass out of a fresh one.

#### Scenario: Happy path — the skill's lines appear in the loop's order

- **GIVEN** the shipped `skills/mr/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds, in this order among the fenced lines, a `review-code` invocation carrying `--base origin/` and `--out .claude/ship/mr/review-r`, an `interlock mr comment` line, an `interlock mr remediate-brief` line, a `git add -A` line, an `interlock mr test-paths` line, a `git diff --cached --quiet` line, a `git push` line, an `interlock mr replies` line, a `gh pr ready` line, an `interlock mr conformance-brief` line, an `interlock verify judge` line carrying `--context final` and `--head`, an `interlock verify coverage` line carrying `--base origin/`, a `gh pr checks` line carrying `--watch`, the `gh pr view` line piped into `interlock pipeline --github -`, and the `interlock merge-confidence` line that carries `--review .claude/ship/mr/review-r<last>.json`, `--verify` and `--handoff`
- **AND** the frontmatter's `argument-hint` carries `--review` and `allowed-tools` carries `Agent`

#### Scenario: Failure — without the flag nothing of the loop runs

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section that opens the loop
- **THEN** that section's first paragraph names `--review` as its condition
- **AND** the paragraph tells the reader that without it the skill assesses as before and passes no file from `.claude/ship/mr/`

#### Scenario: Edge case — a fresh pass clears the directory

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** a fenced line removes `.claude/ship/mr/` before the first `review-code` invocation of the loop
- **AND** no line of the loop reads a file from that directory before that removal

### Requirement: `interlock review` SHALL write its record to `--out`, SHALL bind it to `--head`, and SHALL record the dimension record `--dimensions` names

`interlock review` SHALL accept `--out <file>`, writing the same JSON its `--json` output prints, creating the file's directories as needed; `--head <sha>`, recorded in the output under `head`; and `--dimensions <file>`, a JSON record `{ selected, ran, unavailable, skipped }` in which the first three are arrays of strings and `skipped` is an array of `{ name, reason }` with both strings, recorded in the output under `dimensions` with `completed: true`. A write that fails SHALL exit 1 with the reason and the file named on standard error, and an earlier file at that path SHALL NOT survive it. A dimension record that cannot be read, parsed or validated SHALL exit 1 naming the file and the fault on standard error, with nothing printed and nothing written to `--out`. With no `--head`, the output SHALL carry no `head` key; with no `--dimensions`, no `dimensions` key.

Rationale: the verdict reads review evidence from a file, and a file that names the commit it reviewed is how the command, not the caller's discipline, tells a review of this head from an older one. The dimension record was written only by the run's review step; a review the skill produced carried none, so the ran signal could never read it clean and a skipped dimension never reached the verdict.

#### Scenario: Happy path — the file is the output, with its head and its dimensions

- **GIVEN** findings and verdicts, `--head` naming a commit, `--dimensions` naming a record that selects eight dimensions, ran seven and skipped `blast-radius` with a reason, and `--out` naming a file in a directory that does not yet exist
- **WHEN** `interlock review` runs with `--json`
- **THEN** the file exists, parses, and equals standard output's JSON, including `surviving`, `head` equal to the commit named, and `dimensions` carrying the record's four lists and `completed: true`
- **AND** the command exits 0

#### Scenario: Failure — a file that cannot be written

- **GIVEN** `--out` naming a path under an existing regular file
- **WHEN** `interlock review` runs
- **THEN** it exits 1 with the path on standard error
- **AND** no partial file remains at the path

#### Scenario: Failure — a dimension record that is not one

- **GIVEN** `--dimensions` naming a file whose `skipped` entry lacks a `reason`, and `--out` naming a writable path
- **WHEN** `interlock review` runs
- **THEN** it exits 1 naming the file and the missing key on standard error
- **AND** nothing is printed on standard output and nothing exists at the `--out` path

#### Scenario: Edge case — no head and no dimensions recorded

- **GIVEN** the same inputs and neither `--head` nor `--dimensions`
- **WHEN** `interlock review` runs with `--out`
- **THEN** the file carries no `head` key and no `dimensions` key
- **AND** `interlock merge-confidence --review` reads it as it reads any record without a head, with the ran signal green under the flag that says the dimension record is absent

### Requirement: `interlock mr comment` SHALL render the surviving findings of a head-bound review with stable ids

`interlock mr comment --review <file> --head <sha> --round <n>` SHALL read an adjudicated review record, refuse one that lacks `surviving` or whose recorded `head` is not the given sha (exit 1, the reason on standard error, nothing on standard output), and print a Markdown comment whose heading names the round and the sha, followed by one row per surviving finding carrying its id, severity, file and line, and title, then each finding's description and suggestion. The id SHALL be the one `findingId` derives from the shared finding identity. With `--json` it SHALL print `{ head, round, findings: [{ id, key, severity, file, line, title }] }`. An empty surviving list SHALL print one paragraph naming the sha and saying the review raised no surviving finding, and exit 0.

#### Scenario: Happy path — two findings, two ids

- **GIVEN** a record with `head` H and two surviving findings in different files
- **WHEN** the command runs with `--head H --round 0`
- **THEN** standard output's heading names round 0 and H, and two rows each carry an id of the form `F-` plus eight hexadecimal characters, the severity, `file:line` and the title
- **AND** running it again prints the same ids

#### Scenario: Failure — a record for another head, or no adjudication

- **GIVEN** a record whose `head` is not H, and another that carries `findings` but no `surviving`
- **WHEN** the command runs for each with `--head H`
- **THEN** each exits 1 with nothing on standard output
- **AND** the first's standard error says the record describes another commit, naming both, and the second's says the record is not an adjudicated review

#### Scenario: Edge case — nothing survived

- **GIVEN** a record with `head` H and an empty `surviving` list
- **WHEN** the command runs with `--head H --round 1`
- **THEN** it prints one paragraph naming H and round 1 and saying no finding survived
- **AND** it exits 0

### Requirement: `interlock mr replies` SHALL compute each finding's status under the shared finding identity

`interlock mr replies --before <file> --after <file> --head <sha>` SHALL read two adjudicated review records, refuse either that lacks `surviving` and an after-record whose `head` is not the given sha, and SHALL compute: `fixed` for each surviving finding of the before-record whose key no surviving finding of the after-record shares; `open` for each whose key one does; `new` for each key of the after-record the before-record lacks. The key SHALL be `findingKey`: the trimmed file, a separator, and the title trimmed, with internal whitespace collapsed to one space, case-folded, and trailing `.`, `:`, `;` and `!` removed. It SHALL print a Markdown table whose heading names the sha, one row per finding with its id, status, file and title, and with `--json` `{ head, fixed, open, new, counts }`. The same file given as both records SHALL read every finding `open`.

Rationale: a reply that says "fixed" is a claim that an independent re-review on the pushed head did not raise the finding again, and two readers of the same identity are the only way the comment's ids and the reply's statuses name the same things. The same-file case is how a round that changed nothing says so without a second review.

#### Scenario: Happy path — one fixed, one open, one new

- **GIVEN** a before-record with findings A and B and an after-record with `head` H carrying B and a new finding C
- **WHEN** the command runs with `--head H --json`
- **THEN** `fixed` holds A's id, `open` holds B's, `new` holds C's, and `counts` reads one of each
- **AND** the Markdown table's heading names H and its rows carry the same ids

#### Scenario: Failure — an after-record for another head

- **GIVEN** an after-record whose `head` is not H
- **WHEN** the command runs with `--head H`
- **THEN** it exits 1 with nothing on standard output
- **AND** standard error says the record describes another commit, naming both

#### Scenario: Edge case — a re-cased, re-spaced, re-punctuated title is the same finding

- **GIVEN** a before-record whose finding is titled `Missing null check.` in `lib/a.mjs` and an after-record carrying `missing  NULL check` in `lib/a.mjs` and `Missing null check.` in `lib/b.mjs`
- **WHEN** the command runs
- **THEN** the `lib/a.mjs` finding is `open` under one id, and the `lib/b.mjs` finding is `new`
- **AND** `findingKey` of the two `lib/a.mjs` titles is one string

#### Scenario: Edge case — the same record on both sides

- **GIVEN** one record with `head` H and findings A and B, given as both `--before` and `--after`
- **WHEN** the command runs with `--head H --json`
- **THEN** `open` holds A's and B's ids, and `fixed` and `new` are empty
- **AND** the table's heading names H and carries two rows reading `open`

### Requirement: `interlock mr remediate-brief` SHALL brief a fix-only round under the ship loop's stop rule and the published cap

`interlock mr remediate-brief --review <file> --round <n> --change <name> --head <sha> [--pr <n>] [--protected <paths>] [--result <file>]` SHALL build the round's plan with the same planner the ship loop uses and the limits `interlock limits` publishes, under the rule the ship loop applies: the first round plans every surviving blocker and warning; a later round plans a fix only while a surviving blocker remains, and otherwise the plan is built at the verdict round, one past the published cap, which plans nothing; a round beyond the verdict round is refused by the planner. When the plan has a fix to brief, the command SHALL print a briefing that lists each finding with its id, names the head and the merge request, lists the protected paths the fixer must not edit, tells the fixer not to commit, and names the result file and its shape `{ ok, fixed, notFixed }`. The briefing SHALL carry no re-review instruction. When the plan has nothing to fix or halts, for any reason the planner gives (an empty surviving list, suggestions only, the verdict round, unresolved blockers past the cap, a refused round), the command SHALL exit 1 with the planner's reason on standard error and nothing on standard output; a reason that concerns the cap SHALL name the round and the published value.

Rationale: the round cap is a threshold and lives in the CLI; the skill loops while this command exits zero and never states a number. One stop rule, the ship loop's, so the loop neither briefs a fixer after the budget nor stops a round early. The fixer does not re-review its own work: a fresh review of the pushed head does.

#### Scenario: Happy path — round one is briefed

- **GIVEN** a record with two surviving warnings, `--round 1`, `--head H`, `--pr 7` and `--protected test/a.test.mjs`
- **WHEN** the command runs
- **THEN** standard output names H, `#7`, both finding ids, `test/a.test.mjs` under the protected list, the result file and the keys `ok`, `fixed` and `notFixed`
- **AND** it contains no `re-review` and tells the fixer not to commit

#### Scenario: Failure — the verdict round, and a round beyond it

- **GIVEN** the same record and a `--round` equal to the `remediationRounds` value `interlock limits --json` publishes plus one; and the same record with that round plus two
- **WHEN** the command runs for each
- **THEN** each exits 1 with nothing on standard output
- **AND** the first's standard error names the round and the published cap, and the second's says the round is past the verdict round

#### Scenario: Edge case — nothing to fix

- **GIVEN** a record whose surviving list is empty, and another whose surviving findings are all suggestions
- **WHEN** the command runs for each with `--round 1`
- **THEN** each exits 1 with nothing on standard output
- **AND** standard error says there is nothing to remediate

#### Scenario: Edge case — a later round with no blocker left

- **GIVEN** a published cap of at least two, a record with two surviving warnings and `--round 2`, and another record with one surviving blocker and `--round 2`
- **WHEN** the command runs for each
- **THEN** the first exits 1 and standard error names the verdict round and the published cap, because a round after the first is briefed only while a blocker survives
- **AND** the second prints a briefing naming the blocker's id and exits 0

### Requirement: `interlock mr test-paths` SHALL name the changed paths the test guard protects, with the guard's own predicate

`interlock mr test-paths --changed <files|-> [--json]` SHALL read the test profile the guard reads and classify each changed path with the predicate the guard uses, printing `{ protected, unprotected, profile, reason }`; `--changed -` SHALL read the paths from standard input, one per line. With no profile, `protected` SHALL be empty, `profile` null, and `reason` SHALL say no profile was found at its path and nothing is protected. The predicate and the profile readers SHALL be one implementation, exported from `lib/` and re-exported to the guard. The skill SHALL hand the command every path that differs from HEAD, staged or not, by staging the fixer's tree first and piping the staged list in, and SHALL revert the protected paths it names from HEAD in both the index and the working tree, so a protected file the fixer created is removed.

Rationale: the guard that denies test edits during a run's remediation does not run after a close; the loop's fix rounds hold the same rule by reverting what the same predicate names, over the same set of paths the commit would carry, and a missing profile fails open out loud rather than pretending to protect.

#### Scenario: Happy path — a test file and a source file

- **GIVEN** a profile naming `test/` as a test root and `--changed test/a.test.mjs,lib/a.mjs`
- **WHEN** the command runs with `--json`, and again with `--changed -` and the same two paths on standard input one per line
- **THEN** `protected` is `["test/a.test.mjs"]` and `unprotected` is `["lib/a.mjs"]` both times
- **AND** `profile` names the profile's path

#### Scenario: Failure — no profile

- **GIVEN** no file at the profile's path and `--changed test/a.test.mjs`
- **WHEN** the command runs with `--json`
- **THEN** `protected` is empty, `profile` is null and `reason` names the missing path
- **AND** the skill's text, pinned by token, prints `TEST PATHS UNKNOWN` with that reason and reverts nothing

#### Scenario: Edge case — the guard and the command agree

- **GIVEN** the same profile and path
- **WHEN** the guard's `isTestPath` and the command classify it
- **THEN** both name it protected
- **AND** the guard's module imports the predicate from `lib/` rather than defining its own

#### Scenario: Edge case — the skill hands it the staged tree

- **GIVEN** the shipped `skills/mr/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a `git add -A` line before the `interlock mr test-paths` line, and that line reads `git diff --cached --name-only` piped into `--changed -`
- **AND** the revert line carries `git restore --staged --worktree --source=HEAD`, and no fenced line of the loop runs `git diff --name-only` without `--cached`

### Requirement: `interlock mr conformance-brief` SHALL brief the confirmation of scenarios and living requirements from the CLI's own checklist, bound to the head

`interlock mr conformance-brief <change> --changed <files> --base <ref> --head <sha> [--result <file>]` SHALL gather the checklist `interlock conformance <change> --changed --living --base --json` produces and print a briefing asking one worker to confirm each scenario C1..Cn and each living requirement L1..Ln against the diff, answering into the result file with the five keys `scenariosChecked`, `scenariosUnconfirmed`, `requirementsChecked`, `requirementsUnconfirmed` and `detail`, and `head` equal to the sha the briefing names. When the living list could not be built, the briefing SHALL still list the scenarios, say why the list is absent, and ask for the same keys with the two requirement counts reported as zero. With nothing to confirm, neither a scenario nor a living requirement, it SHALL print nothing on standard output, say so on standard error, and exit 0. A change that cannot be resolved SHALL exit 1 naming it.

Rationale: a lean ship leaves the two conformance signals unobserved for want of a handoff, and the strict tail's worker answers exactly this checklist; asking the same questions through the same CLI keeps the two from drifting. The head in the answer is what lets the verdict refuse a handoff written for the previous head.

#### Scenario: Happy path — three scenarios and two living requirements

- **GIVEN** a change whose delta specs carry three scenarios, a graph that selects two living requirements for the changed files, `--base` naming a commit and `--head H`
- **WHEN** the command runs
- **THEN** standard output lists C1, C2, C3, L1 and L2 with the artifact and line each is written at, names H, the result file, the five count keys and the `head` key
- **AND** it exits 0

#### Scenario: Failure — an unknown change

- **GIVEN** a change name that resolves to no change
- **WHEN** the command runs
- **THEN** it exits 1 naming the change on standard error
- **AND** nothing is printed on standard output

#### Scenario: Edge case — a base that names no commit

- **GIVEN** the same change and `--base` naming no commit
- **WHEN** the command runs
- **THEN** the scenarios are still listed and the briefing says the living list was not built and why
- **AND** the briefing asks for the five keys and `head` all the same, with the two requirement counts to be reported as zero

#### Scenario: Edge case — nothing to confirm

- **GIVEN** a change whose delta specs carry no scenario and changed files for which the graph selects no living requirement
- **WHEN** the command runs
- **THEN** standard output is empty and standard error says there is nothing to confirm
- **AND** it exits 0

### Requirement: The skill SHALL post only what the CLI rendered, SHALL commit and push each round's fix before replying, SHALL end a round that changed nothing without a push, and SHALL still never merge or approve

The skill SHALL post the comment `interlock mr comment` printed and the table `interlock mr replies` printed, each through the platform's comment command with the body from standard input, and SHALL write neither by hand. After the fixer and the test-path revert, a round that leaves nothing staged SHALL commit nothing and push nothing, SHALL post the reply table rendered from the round's own review on both sides, in which every finding reads `open`, and SHALL end the loop. Any other round's fix SHALL be committed with a message that names the merge request and the round, and pushed, before the re-review and the reply. Beside the push the skill SHALL say what a push does on the platform: it dismisses the stale approvals a ruleset marks and takes the merge request out of auto-merge or a merge train, the loop's verdict restores neither, and the skill does not re-request a review. The skill SHALL NOT approve, request changes on, resolve a review thread of, or merge the merge request, and the paragraph that says so SHALL say that `MERGE` is a statement about the local signals and not the platform's branch rules, naming a merge queue among them. The GitLab lines of the loop SHALL be marked as not exercised, and the GitLab wait SHALL poll the merge request's head pipeline rather than follow the branch pipeline.

#### Scenario: Happy path — the posting and commit lines

- **GIVEN** the shipped `skills/mr/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds an `interlock mr comment` line piped into `gh pr comment` with `--body-file -`, an `interlock mr replies` line piped the same way, and a commit message token `fix(review): answer the PR #` with `review round`
- **AND** a `git push` line sits between the commit line and the first `review-code` invocation that follows it

#### Scenario: Failure — a line that would decide for the reader

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** no fenced line runs `gh pr merge`, `gh pr review`, `glab mr merge` or `glab mr approve`
- **AND** the prose still carries `never merges` and `never approves`, and the paragraph that carries them names `branch rules` and `merge queue` as what `MERGE` does not read

#### Scenario: Edge case — the GitLab lines

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** the `glab mr note` line, the `glab ci get --merge-request` wait line and the `glab mr update` ready line each sit in a paragraph or block marked `not exercised`
- **AND** no fenced line runs `glab ci status --live`

#### Scenario: Edge case — a round that changed nothing

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the round's paragraph
- **THEN** it finds the `git diff --cached --quiet` line before the commit line, and the prose says a round with nothing staged commits nothing, pushes nothing, renders `interlock mr replies` with the same record as `--before` and `--after`, and ends the loop
- **AND** the prose says every finding then reads `open`

#### Scenario: Edge case — what a push does on the platform

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the paragraph around the round's `git push` line
- **THEN** it finds `dismiss` with `approval`, `merge train` and `auto-merge`
- **AND** it finds that the skill does not `re-request` a review
