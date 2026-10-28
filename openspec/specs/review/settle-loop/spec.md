# review/settle-loop Specification

## Purpose
The loop `/interlock:settle --review` drives after a pull request exists: review the pull request's own diff, post the findings, fix them in bounded rounds that commit and push, reply with what each finding became, confirm the scenarios, verify the head, and hand the verdict evidence bound to that head. The `interlock settle` command family renders every comment and computes every status, so nothing a reader sees on the pull request is a judgement a model typed.

## Requirements

### Requirement: The skill SHALL enter the loop only with `--review`, after the pull request exists, and SHALL produce its evidence in a fixed order

With `--review`, after the pull request exists, the `settle` skill SHALL run, in this order: the working-tree check `interlock settle tree-check` and only then the clearing of `.claude/ship/settle/`; the platform's head compared with the local head; a `review-code` pass on the pull request's diff with `--base origin/<target>` and `--out` under `.claude/ship/settle/`, at the published default depth or, with `--strict`, the strict one; the findings comment `interlock settle comment` renders; fix rounds, each the working-tree check again, a copy of the test profile, a fixer briefed by `interlock settle remediate-brief` (from the second round on, with `--previous` naming the round before's fixer result, and every round keeping its answer with `--out`), the fixer's result checked by `interlock settle fixer-result` against that kept record with `--brief`, the fixer's tree staged except the paths the tree check tolerates and classified by `interlock settle test-paths` with the protected paths reverted, and then, when a staged change remains, a commit, a push, a fresh `review-code` pass on the pushed head scoped with `--dimensions` to the `reReviewDimensions` the briefing named and given the round before's record with `--carry`, at the same depth as the first pass, and the reply table `interlock settle replies` renders, or, when none remains, the reply table rendered from the round's own review on both sides and the end of the loop; the pull request marked ready when this pass created it as a draft; the confirmation worker briefed by `interlock settle conformance-brief`; the final verification through `interlock verify plan`, `exec` and `judge` with `--context final` and `--head`, and `interlock verify coverage` for the head when the plan ran a coverage step; the platform's checks, then the pipeline document re-read from the platform for the pushed head; and only then the assessment. Without `--review` the skill SHALL run none of this and SHALL behave as it did before the flag existed. A pass SHALL clear `.claude/ship/settle/` before it writes there.

Rationale: a reply that cites a commit the platform never saw, a verdict read from evidence about an earlier head, and a pipeline document read before the checks ran on the pushed head are the failures the order exists to prevent; clearing the directory keeps a stale round from an earlier pass out of a fresh one. A re-review that runs every dimension again over the whole diff after four findings were fixed is the cost the scoped pass removes, and the carry is what keeps the round's record whole for the reply table and the verdict.

#### Scenario: Happy path — the skill's lines appear in the loop's order

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds, in this order among the fenced lines, a `git status --porcelain=v1 -z --untracked-files=all` line piped into `interlock settle tree-check`, the `rm -rf .claude/ship/settle` line, a `review-code` invocation carrying `--base origin/` and `--out .claude/ship/settle/review-r`, an `interlock settle comment` line, an `interlock settle remediate-brief` line, an `interlock settle fixer-result` line, a `git add -A -- .` line carrying one `:(exclude)` per tolerated path, an `interlock settle test-paths` line, a `git diff --cached --quiet` line, a `git push` line, an `interlock settle replies` line, a `gh pr ready` line, an `interlock settle conformance-brief` line, an `interlock verify judge` line carrying `--context final` and `--head`, an `interlock verify coverage` line carrying `--base origin/`, a `gh pr checks` line carrying `--watch`, the `gh pr view` line piped into `interlock pipeline --github -`, and the `interlock merge-confidence` line that carries `--review .claude/ship/settle/review-r<last>.json`, `--verify` and `--handoff`
- **AND** the frontmatter's `argument-hint` carries `--review` and `--strict`, and `allowed-tools` carries `Agent`

#### Scenario: Happy path — the round's review is scoped and carries the rest

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the round's `review-code` line
- **THEN** it carries `--dimensions` and `--carry .claude/ship/settle/review-r<r-1>.json`, and the paragraph before it names `reReviewDimensions` as where the dimensions come from
- **AND** the first `review-code` line of the loop carries neither `--dimensions` nor `--carry`

#### Scenario: Failure — without the flag nothing of the loop runs

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section that opens the loop
- **THEN** that section's first paragraph names `--review` as its condition
- **AND** the paragraph tells the reader that without it the skill assesses as before and passes no file from `.claude/ship/settle/`

#### Scenario: Edge case — a fresh pass clears the directory

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** a fenced line removes `.claude/ship/settle/` before the first `review-code` invocation of the loop
- **AND** no line of the loop reads a file from that directory before that removal

#### Scenario: Edge case — the second round's briefing names the first round's result

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the `remediate-brief` line
- **THEN** it carries `--previous .claude/ship/settle/remediate-r<r-1>.json` inside a placeholder
- **AND** the paragraph says the placeholder is filled from the second round on

#### Scenario: Edge case — the fixer's result is checked against the briefing's own record

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the `remediate-brief` and `fixer-result` lines
- **THEN** the `remediate-brief` line carries `--out .claude/ship/settle/brief-r<r>.json` and the `fixer-result` line carries `--brief .claude/ship/settle/brief-r<r>.json`
- **AND** the `fixer-result` line carries neither `--profile` nor `--previous`, so no deferral is worked out a second time after the fixer ran

### Requirement: `interlock review` SHALL write its record to `--out`, SHALL bind it to `--head`, and SHALL record the dimension record `--dimensions` names

`interlock review` SHALL accept `--out <file>`, writing the same JSON its `--json` output prints, creating the file's directories as needed; `--head <sha>`, recorded in the output under `head`; and `--dimensions <file>`, a JSON record `{ selected, ran, unavailable, skipped }` in which the first three are arrays of strings and `skipped` is an array of `{ name, reason }` with both strings, with an optional `depth` that is `lean` or `strict`, recorded in the output under `dimensions` with `completed: true`. It SHALL also accept `--carry <file>`, an earlier review record of the same pull request: every finding of that record's `surviving` whose `dimension` is not in this review's `ran` SHALL be appended to this review's `surviving`, marked `carried: true` and `carriedFrom` the earlier record's `head` or `null`; `counts.carried` SHALL be their number, `counts.surviving` SHALL count the list as emitted, `dimensionStats` SHALL count them under `carried` for their dimension, the metrics record SHALL count none of them, and the text output SHALL print `carried=<n>` and one line per carried finding. `--carry` without `--dimensions` SHALL exit 1 naming both flags, and a carry file with no `surviving` list SHALL exit 1 naming the file, each with nothing printed and nothing written. A write that fails SHALL exit 1 with the reason and the file named on standard error, and an earlier file at that path SHALL NOT survive it. A dimension record that cannot be read, parsed or validated, or whose `depth` is another value, SHALL exit 1 naming the file and the fault on standard error, with nothing printed and nothing written to `--out`. With no `--head`, the output SHALL carry no `head` key; with no `--dimensions`, no `dimensions` key; with no `depth` in the record, no `dimensions.depth` key; with no `--carry`, no `counts.carried` key.

Rationale: the verdict reads review evidence from a file, and a file that names the commit it reviewed is how the command, not the caller's discipline, tells a review of this head from an older one. The dimension record was written only by the run's review step; a review the skill produced carried none, so the ran signal could never read it clean and a skipped dimension never reached the verdict. A re-review that runs only the dimensions whose findings moved must still leave a record of the whole pull request, or the reply table would read every carried finding `fixed` and the verdict would miss a blocker nobody re-examined; the carry is marked so neither reader mistakes it for a fresh look.

#### Scenario: Happy path — the file is the output, with its head and its dimensions

- **GIVEN** findings and verdicts, `--head` naming a commit, `--dimensions` naming a record that selects eight dimensions, ran seven, skipped `blast-radius` with a reason and carries `depth: lean`, and `--out` naming a file in a directory that does not yet exist
- **WHEN** `interlock review` runs with `--json`
- **THEN** the file exists, parses, and equals standard output's JSON, including `surviving`, `head` equal to the commit named, and `dimensions` carrying the record's four lists, `depth` equal to `lean` and `completed: true`
- **AND** the command exits 0

#### Scenario: Happy path — a scoped re-review carries what it did not run

- **GIVEN** a previous record with `head` H0 whose `surviving` holds a `qa` warning and a `language` blocker, a dimension record whose `ran` is `language` only, and this review's findings and verdicts leaving the `language` blocker dismissed
- **WHEN** `interlock review --dimensions <record> --carry <previous> --head H1 --out <file> --json` runs
- **THEN** `surviving` holds the `qa` warning marked `carried: true` with `carriedFrom` H0 and no `language` finding, `counts.carried` is 1, `counts.surviving` is 1, and `dimensionStats.qa.carried` is 1
- **AND** the metrics record written under `--metrics` counts no carried finding, and the text output carries `carried=1`

#### Scenario: Failure — a file that cannot be written

- **GIVEN** `--out` naming a path under an existing regular file
- **WHEN** `interlock review` runs
- **THEN** it exits 1 with the path on standard error
- **AND** no partial file remains at the path

#### Scenario: Failure — a dimension record that is not one

- **GIVEN** `--dimensions` naming a file whose `skipped` entry lacks a `reason`, and another whose `depth` is `deep`, each with `--out` naming a writable path
- **WHEN** `interlock review` runs for each
- **THEN** each exits 1 naming the file and the fault on standard error
- **AND** nothing is printed on standard output and nothing exists at the `--out` path

#### Scenario: Failure — a carry without a dimension record, and a carry file without a surviving list

- **GIVEN** `--carry` naming a valid earlier record and no `--dimensions`; and separately `--carry` naming a file that holds findings but no `surviving` list, with `--dimensions`
- **WHEN** `interlock review` runs for each
- **THEN** the first exits 1 naming `--carry` and `--dimensions`, and the second exits 1 naming the carry file
- **AND** neither prints on standard output or writes to `--out`

#### Scenario: Edge case — no head, no dimensions, no depth and no carry recorded

- **GIVEN** the same inputs and neither `--head`, `--dimensions` nor `--carry`, and separately a dimension record without `depth`
- **WHEN** `interlock review` runs with `--out` for each
- **THEN** the first file carries no `head` key, no `dimensions` key and no `counts.carried` key, and the second carries `dimensions` with no `depth` key
- **AND** `interlock merge-confidence --review` reads the first as it reads any record without a head, with the ran signal green under the flag that says the dimension record is absent

### Requirement: `interlock settle comment` SHALL render the surviving findings of a head-bound review with stable ids

`interlock settle comment --review <file> --head <sha> --round <n>` SHALL read an adjudicated review record, refuse one that lacks `surviving` or whose recorded `head` is not the given sha (exit 1, the reason on standard error, nothing on standard output), and print a Markdown comment whose heading names the round and the sha, followed by one row per surviving finding carrying its id, severity, file and line, and title, then each finding's description and suggestion. The id SHALL be the one `findingId` derives from the shared finding identity. Surviving findings that share a key SHALL be one finding at the highest severity among them, and that merged list SHALL be what `comment`, `replies`, `remediate-brief` and `fixer-result` all read, so no surviving blocker is hidden behind a warning with its key. Every reviewer-written title, location and unrecognised severity SHALL render as an inline code span, and every description and suggestion inside a code fence longer than any backtick run it holds, so no finding text renders as a mention, a link, markup or a line-start command. With `--json` it SHALL print `{ head, round, findings: [{ id, key, severity, file, line, title }] }`. An empty surviving list SHALL print one paragraph naming the sha and saying the review raised no surviving finding, and exit 0.

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

#### Scenario: Edge case — two findings with one key are one finding at the higher severity

- **GIVEN** a record with `head` H whose surviving list holds a warning and then a blocker with the same file and title
- **WHEN** `comment` runs with `--head H --round 0`, and `remediate-brief` runs on the same record with `--round 1`
- **THEN** the comment carries one id, at `blocker`
- **AND** the briefing lists that id one time, as a blocker

#### Scenario: Failure — reviewer text that tries to be markup stays text

- **GIVEN** a surviving finding whose title carries an `@`-mention and a Markdown link, and whose description carries `</details><!--`, a line reading `/approve` and a run of three backticks
- **WHEN** `comment` runs
- **THEN** the title renders inside an inline code span, and the description inside a fence longer than its backtick run
- **AND** no line outside a fence or a span begins with `/approve`

### Requirement: `interlock settle replies` SHALL compute each finding's status under the shared finding identity

`interlock settle replies --before <file> --after <file> --head <sha>` SHALL read two adjudicated review records, refuse either that lacks `surviving` and an after-record whose `head` is not the given sha, and SHALL compute: `fixed` for each surviving finding of the before-record whose key no surviving finding of the after-record shares; `open` for each whose key one does; `new` for each key of the after-record the before-record lacks. The key SHALL be `findingKey`: the file in its canonical repository form (`canonicalizePath`, or the trimmed spelling when it has none), a separator, and the title trimmed, with internal whitespace collapsed to one space, case-folded, and any trailing run of whitespace, `.`, `:`, `;` and `!` removed. It SHALL print a Markdown table whose heading names the sha, a fixed legend line saying that `fixed` means a fresh review did not raise the finding again under the same file and title and is not a confirmation, one row per finding with its id, status, file and title, and with `--json` `{ head, fixed, open, new, counts }`. An `open` finding that the after-record marks `carried` SHALL read `open (carried)` in the table and carry `carried: true` in its JSON entry, and the legend SHALL say that `carried` means the finding's dimension was not re-run and the finding was brought forward unexamined. The same file given as both records SHALL read every finding `open`.

Rationale: a reply that says "fixed" is a claim that an independent re-review on the pushed head did not raise the finding again, and two readers of the same identity are the only way the comment's ids and the reply's statuses name the same things. The same-file case is how a round that changed nothing says so without a second review. A carried finding is open because nobody looked, not because somebody looked and found it still there, and the reader of the pull request is owed the difference.

#### Scenario: Happy path — one fixed, one open, one new

- **GIVEN** a before-record with findings A and B and an after-record with `head` H carrying B and a new finding C
- **WHEN** the command runs with `--head H --json`
- **THEN** `fixed` holds A's id, `open` holds B's, `new` holds C's, and `counts` reads one of each
- **AND** the Markdown table's heading names H, the legend line says `fixed` is not a confirmation, and its rows carry the same ids

#### Scenario: Happy path — a carried finding is open and says so

- **GIVEN** a before-record with findings A and B and an after-record with `head` H carrying B marked `carried: true` and A unmarked
- **WHEN** the command runs with `--head H`
- **THEN** A's row reads `open` and B's row reads `open (carried)`, and the legend names `carried`
- **AND** with `--json`, B's entry under `open` carries `carried: true` and A's does not

#### Scenario: Failure — an after-record for another head

- **GIVEN** an after-record whose `head` is not H
- **WHEN** the command runs with `--head H`
- **THEN** it exits 1 with nothing on standard output
- **AND** standard error says the record describes another commit, naming both

#### Scenario: Edge case — a re-cased, re-spaced, re-punctuated title is the same finding

- **GIVEN** a before-record whose finding is titled `Missing null check.` in `lib/a.mjs` and an after-record carrying `missing  NULL check` in `lib/a.mjs` and `Missing null check.` in `lib/b.mjs`
- **WHEN** the command runs
- **THEN** the `lib/a.mjs` finding is `open` under one id, and the `lib/b.mjs` finding is `new`
- **AND** `findingKey` of the two `lib/a.mjs` titles is one string, and so is the key of the same finding with its file spelled `./lib/a.mjs` and its title ending in a spaced period

#### Scenario: Edge case — the same record on both sides

- **GIVEN** one record with `head` H and findings A and B, given as both `--before` and `--after`
- **WHEN** the command runs with `--head H --json`
- **THEN** `open` holds A's and B's ids, and `fixed` and `new` are empty
- **AND** the table's heading names H and carries two rows reading `open`

### Requirement: `interlock settle remediate-brief` SHALL brief a fix-only round under the ship loop's stop rule and the published cap

`interlock settle remediate-brief --review <file> --round <n> --change <name> --head <sha> [--pr <n>] [--profile <file>] [--result <file>] [--previous <file>] [--out <file>]` SHALL build the round's plan with the same planner the ship loop uses and the limits `interlock limits` publishes, under the rule the ship loop applies: the first round plans every surviving blocker and warning; a later round plans a fix only while a surviving blocker remains, and otherwise the plan is built at the verdict round, one past the published cap, which plans nothing; a round beyond the verdict round is refused by the planner. Before the planner runs, the command SHALL defer two kinds of finding and hand the planner the rest: every blocker and warning whose file is one the test guard protects, with a reason naming the path and the guard and saying a person fixes it; and, when `--previous` names the fixer result of the round before — validated as `interlock settle fixer-result` validates one, and refused when it is for another round — every finding that result lists under `notFixed`, with that entry's reason quoted. When the plan has a fix to brief, the command SHALL print a briefing that lists each finding with its id inside a block labelled as quoted reviewer data, lists the deferred findings under `Deferred this round` with their reasons and the sentence that the fixer does not touch them, names the head and the pull request, names what the fixer must not edit, tells the fixer not to commit, and names the result file and its shape `{ ok, fixed, notFixed }`; with `--json` it SHALL also carry `reReviewDimensions`, the planner's list of the dimensions whose findings this round fixes, and `deferred`, the deferred findings as `{ id, reason }`. With `--out <file>` it SHALL write that `--json` answer to the file before it prints anything, as the round's briefing record, and a file it cannot write SHALL exit 1 with nothing on standard output and a reason without the prefix; on a stop or a refusal it SHALL write nothing. What the fixer must not edit SHALL be computed by the command from the test profile, or from the copy `--profile` names, with the guard's own roots and suffix rule, and the briefing SHALL tell apart no profile, a profile that could not be read and a profile that names no test root; the command SHALL take no list of protected paths from its caller. The briefing SHALL carry no re-review instruction. When the deferrals leave no blocker or warning for the planner, the command SHALL exit 1 with nothing on standard output and `STOP: nothing fixable remains` on standard error naming how many findings sit in protected paths and how many the round before's fixer declined. When the plan has nothing to fix or halts, for any reason the planner gives (an empty surviving list, suggestions only, the verdict round, unresolved blockers past the cap, a round past the verdict round), the command SHALL exit 1 with nothing on standard output and the planner's reason on standard error behind the fixed prefix `STOP:`; a reason that concerns the cap SHALL name the round and the published value. An input it cannot use (a record with no surviving list, a record for another head, a round that is not a positive integer, a missing flag, a `--previous` for another round or without `fixed` and `notFixed`) SHALL exit 1 with a reason that never carries the prefix.

Rationale: the round cap is a threshold and lives in the CLI; the skill loops while this command exits zero and never states a number. One stop rule, the ship loop's, so the loop neither briefs a fixer after the budget nor stops a round early. The prefix is what lets the loop tell its stop rule from a broken input: both exit 1, and only one of them means the review converged. The fixer does not re-review its own work: a fresh review of the pushed head does. A finding in a path the guard reverts, and a finding the last fixer already declined, are rounds the command can see will fix nothing; deferring them spends no fixer on them and hides nothing, because a deferred finding is still open in the reply table and still banded in the verdict.

#### Scenario: Happy path — round one is briefed

- **GIVEN** a record with two surviving warnings, `--round 1`, `--head H`, `--pr 7` and `--profile` naming a profile copy whose commands name `test/` as a test root
- **WHEN** the command runs
- **THEN** standard output names H, `#7`, both finding ids, `test/` under what the fixer must not edit, the result file and the keys `ok`, `fixed` and `notFixed`
- **AND** it contains no `re-review` and tells the fixer not to commit, and with `--json` `reReviewDimensions` holds the dimensions of the two warnings and `deferred` is empty

#### Scenario: Happy path — the answer is kept as the round's briefing record

- **GIVEN** the record and flags of the scenario above, with `--out` naming a file under a directory that does not exist yet
- **WHEN** the command runs
- **THEN** it exits 0, and the file holds the same JSON object `--json` prints, with `round`, `head` and `findings`
- **AND** when the same record is given at the verdict round, the command stops with `STOP:` and the file is not written

#### Scenario: Happy path — a finding in a protected path is deferred, not briefed

- **GIVEN** a record with one surviving blocker in `test/x.test.mjs` and one surviving warning in `lib/y.mjs`, `--round 1` and `--profile` naming a profile whose commands name `test/` as a test root
- **WHEN** the command runs
- **THEN** it exits 0, the quoted findings block carries the warning's id only, and `Deferred this round` lists the blocker's id with `protected test path test/x.test.mjs` and that a person fixes it
- **AND** with `--json`, `findings` holds the warning's id, `deferred` holds the blocker's id with that reason, and `reReviewDimensions` holds the warning's dimension only

#### Scenario: Happy path — a finding the last fixer declined is deferred with its reason

- **GIVEN** a record with two surviving warnings W1 and W2 in `lib/`, `--round 2`, and `--previous` naming a round-1 fixer result whose `notFixed` holds W1 with the reason `needs a design decision`
- **WHEN** the command runs with a surviving blocker B also present so that round 2 is briefed
- **THEN** the briefing's quoted block carries B and W2, and `Deferred this round` carries W1 with `needs a design decision`
- **AND** with `--json`, `deferred` holds W1 with that reason

#### Scenario: Failure — nothing fixable remains

- **GIVEN** a record whose only surviving findings are a blocker and a warning in `test/x.test.mjs`, `--round 1` and a profile naming `test/`; and separately the same record at `--round 2` with `--previous` naming a result whose `notFixed` holds both
- **WHEN** the command runs for each
- **THEN** each exits 1 with nothing on standard output and standard error beginning `interlock: STOP: nothing fixable remains`
- **AND** the first names two in protected paths and zero declined, and the second names two in protected paths as well, because the protected deferral is applied first

#### Scenario: Failure — the verdict round, and a round beyond it

- **GIVEN** the same record and a `--round` equal to the `remediationRounds` value `interlock limits --json` publishes plus one; and the same record with that round plus two
- **WHEN** the command runs for each
- **THEN** each exits 1 with nothing on standard output and standard error beginning `interlock: STOP:`
- **AND** the first's standard error names the round and the published cap, and the second's says the round is past the verdict round

#### Scenario: Edge case — nothing to fix

- **GIVEN** a record whose surviving list is empty, and another whose surviving findings are all suggestions
- **WHEN** the command runs for each with `--round 1`
- **THEN** each exits 1 with nothing on standard output
- **AND** standard error begins `interlock: STOP:` and says there is nothing to remediate

#### Scenario: Edge case — a later round with no blocker left

- **GIVEN** a published cap of at least two, a record with two surviving warnings and `--round 2`, and another record with one surviving blocker and `--round 2`
- **WHEN** the command runs for each
- **THEN** the first exits 1 and standard error begins `interlock: STOP:` and names the verdict round and the published cap, because a round after the first is briefed only while a blocker survives
- **AND** the second prints a briefing naming the blocker's id and exits 0

#### Scenario: Failure — a broken input is not a stop

- **GIVEN** a record that carries findings but no surviving list, a record whose `head` is not H, `--round 0`, and `--round 2` with `--previous` naming a round-3 fixer result
- **WHEN** the command runs for each with `--head H`
- **THEN** each exits 1 with nothing on standard output
- **AND** no standard error carries `STOP:`, and the last names the round the result is for

#### Scenario: Edge case — no profile, an unreadable profile, and a profile naming no root

- **GIVEN** a record with one surviving warning in `test/x.test.mjs` and `--profile` naming, in turn, no file, a file that does not parse, and a profile whose commands name no test directory
- **WHEN** the command runs for each with `--round 1`
- **THEN** each prints a briefing carrying the warning's id and exits 0, because nothing is protected and so nothing is deferred
- **AND** the three briefings say, in turn, that no profile exists, that the profile could not be read, and that the profile names no test root, each saying what that leaves protected

### Requirement: `interlock settle test-paths` SHALL name the changed paths the test guard protects, with the guard's own predicate

`interlock settle test-paths --changed <files|-> [--profile <file>] [--protected-only [--nul]] [--json]` SHALL read the test profile the guard reads, or the copy `--profile` names, and classify each changed path with the predicate the guard uses, printing `{ protected, unprotected, profile, reason }`; `--changed -` SHALL read the paths from standard input, separated by NUL when the input holds one and otherwise one per line, and a bare `--changed` with no value SHALL be refused with the usage line. With no profile, `protected` SHALL be empty, `profile` null, and `reason` SHALL say no profile was found at its path and nothing is protected; a profile that exists and cannot be read SHALL say so in its own words. `--protected-only` SHALL print the protected paths alone, and `--nul` with it SHALL end each with NUL. The predicate and the profile readers SHALL be one implementation, exported from `lib/` and re-exported to the guard. The skill SHALL hand the command every path that differs from HEAD, staged or not, by staging the fixer's tree first and piping the staged list in, and SHALL revert the protected paths it names from HEAD in both the index and the working tree, so a protected file the fixer created is removed, by feeding the NUL-separated list to `git --literal-pathspecs restore --staged --worktree --source=HEAD --pathspec-from-file=- --pathspec-file-nul`, and only when the list is not empty. The skill SHALL classify against the copy of the profile it took before the fixer ran, and SHALL check again after the revert that nothing protected is still staged.

Rationale: the guard that denies test edits during a run's remediation does not run after a close; the loop's fix rounds hold the same rule by reverting what the same predicate names, over the same set of paths the commit would carry, and a missing profile fails open out loud rather than pretending to protect. The profile is ignored by git, so HEAD cannot restore it and the fixer could rewrite the rule it is judged by; the copy is the rule as it stood. A path the model typed into the revert, or one read as pathspec magic, could name a file nobody classified.

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

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds the `git add -A -- .` staging line before the `interlock settle test-paths` line, and that line reads `git diff --cached --name-only -z` piped into `--changed -`
- **AND** the revert line pipes `--protected-only --nul` into `git --literal-pathspecs restore --staged --worktree --source=HEAD` with `--pathspec-file-nul`, no fenced line is a bare `git add -A`, and no fenced line of the loop runs `git diff --name-only` without `--cached`

#### Scenario: Edge case — the copy of the profile decides, and the output feeds git

- **GIVEN** a profile copy naming `test/` as a test root, a live profile naming no root, and `test/a b.test.mjs` and `lib/a.mjs` on standard input separated by NUL
- **WHEN** the command runs with `--profile` naming the copy and `--protected-only --nul`, and again with `--nul` alone
- **THEN** the first prints `test/a b.test.mjs` followed by one NUL and nothing else
- **AND** the second is refused with the usage line

### Requirement: `interlock settle conformance-brief` SHALL brief the confirmation of scenarios and living requirements from the CLI's own checklist, bound to the head

`interlock settle conformance-brief <change> --changed <files> --base <ref> --head <sha> [--result <file>]` SHALL gather the checklist `interlock conformance <change> --changed --living --base --json` produces and print a briefing asking one worker to confirm each scenario C1..Cn and each living requirement L1..Ln against the diff, answering into the result file with the five keys `scenariosChecked`, `scenariosUnconfirmed`, `requirementsChecked`, `requirementsUnconfirmed` and `detail`, and `head` equal to the sha the briefing names. When the living list could not be built, the briefing SHALL still list the scenarios, say why the list is absent, and ask for the same keys with the two requirement counts reported as zero. With nothing to confirm, neither a scenario nor a living requirement, it SHALL print nothing on standard output, say so on standard error, and exit 0. A change that cannot be resolved SHALL exit 1 naming it.

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

The skill SHALL post the comment `interlock settle comment` printed and the table `interlock settle replies` printed, each through the platform's comment command with the body from standard input, and SHALL write neither by hand. After the fixer and the test-path revert, a round that leaves nothing staged SHALL commit nothing and push nothing, SHALL post the reply table rendered from the round's own review on both sides, in which every finding reads `open`, and SHALL end the loop. Any other round's fix SHALL be committed with a message that names the pull request and the round, and pushed, before the re-review and the reply. Beside the push the skill SHALL say what a push does on the platform: it dismisses the stale approvals a ruleset marks and takes the pull request out of auto-merge or a merge train, the loop's verdict restores neither, and the skill does not re-request a review. The skill SHALL NOT approve, request changes on, resolve a review thread of, or merge the pull request, and the paragraph that says so SHALL say that `MERGE` is a statement about the local signals and not the platform's branch rules, naming a merge queue among them. The GitLab lines of the loop SHALL be marked as not exercised, and so SHALL the loop's GitHub lines until a pass of the loop has been recorded on a real pull request; the GitLab wait SHALL poll the pull request's head pipeline rather than follow the branch pipeline. The create step SHALL hand the description to the platform from a quoted here-document, never inside a double-quoted argument, and the skill SHALL push nothing before the create step outside that step.

#### Scenario: Happy path — the posting and commit lines

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds an `interlock settle comment` line piped into `gh pr comment` with `--body-file -`, an `interlock settle replies` line piped the same way, and a commit message token `fix(review): answer the PR #` with `review round`
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
- **THEN** it finds the `git diff --cached --quiet` line before the commit line, and the prose says a round with nothing staged commits nothing, pushes nothing, renders `interlock settle replies` with the same record as `--before` and `--after`, and ends the loop
- **AND** the prose says every finding then reads `open`

#### Scenario: Edge case — what a push does on the platform

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the paragraph around the round's `git push` line
- **THEN** it finds `dismiss` with `approval`, `merge train` and `auto-merge`
- **AND** it finds that the skill does not `re-request` a review

#### Scenario: Edge case — the create step's description, and pushes outside it

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** no line carries `--body "<` or `--description "<`, and the `gh pr create` lines read the description with `--body-file -` from a quoted here-document
- **AND** every fenced `git push` line before the first `gh pr create` line sits inside the create step

### Requirement: `interlock settle tree-check` SHALL say whether the working tree holds anything a fix round would sweep in, and the skill SHALL start no loop and no round on a tree that does

`interlock settle tree-check --change <name> --status <file|->` SHALL read the output of `git status --porcelain=v1 -z --untracked-files=all`, take each entry's path and, for a rename or a copy, its original path as well, and SHALL tolerate exactly the paths `toleratedPaths(<name>)` names: the change's `settle-summary.md`, which the skill itself writes, and `docs/notes/compound.md`, which the nested review appends to. Every other path SHALL be dirty. With no dirty path it SHALL exit 0; with any, it SHALL print the dirty paths and exit 1; with `--json` it SHALL print `{ clean, dirty, tolerated }` in both cases. Input that is not NUL-terminated, and a missing `--change` or `--status`, SHALL exit 1 with the reason on standard error and nothing on standard output. The skill SHALL run it before the pass clears `.claude/ship/settle/` and again at the start of each fix round. On a non-zero exit it SHALL print `WORKING TREE NOT CLEAN` with the paths, start nothing, commit nothing and push nothing, and the assessment SHALL still run, without the loop's records. The round's staging line SHALL exclude exactly the tolerated paths, so the paths the check lets through are never staged.

Rationale: a fix round stages the whole tree. On a tree that was clean before the fixer ran, the whole tree is the fixer's work, so the commit carries nothing the person had in progress and the revert of protected paths destroys nothing the person wrote. The two tolerated paths are the loop's own writes; the staging line keeps them out of every commit.

#### Scenario: Happy path — a clean tree, and one holding only the tolerated paths

- **GIVEN** an empty status, and a status whose only entries modify `openspec/changes/x/settle-summary.md` and `docs/notes/compound.md`
- **WHEN** the command runs on each with `--change x`
- **THEN** both exit 0
- **AND** the second's `--json` reads `clean: true` with both paths under `tolerated`

#### Scenario: Failure — a modified file, an untracked file and a rename

- **GIVEN** a status with a modified `.gitignore`, an untracked `json`, a rename of `a.txt` to `b c.txt`, and the `settle-summary.md` of another change
- **WHEN** the command runs with `--change x`
- **THEN** it exits 1
- **AND** standard output names `.gitignore`, `json`, `b c.txt`, `a.txt` and the other change's summary

#### Scenario: Failure — a status that is not NUL-terminated

- **GIVEN** the newline-separated output of `git status --porcelain`
- **WHEN** the command runs
- **THEN** it exits 1 with nothing on standard output
- **AND** standard error names the status command it expects

#### Scenario: Edge case — the skill's lines

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** the tree-check line comes before the `rm -rf .claude/ship/settle` line, and the prose carries `WORKING TREE NOT CLEAN`
- **AND** the staging line's `:(exclude)` paths are exactly `toleratedPaths("<change>")`

### Requirement: `interlock settle fixer-result` SHALL accept a round only when the fixer's result accounts for every briefed finding

`interlock settle fixer-result --result <file> --review <file> --round <n> [--head <sha>] [--brief <file> | [--profile <file>] [--previous <file>]]` SHALL exit 1 with the reason on standard error when the result file is absent, does not parse, is not an object, or carries `ok` other than `true`, and when its `fixed` ids and its `notFixed` entries, each with a non-empty `reason`, do not partition the ids `remediate-brief` briefs for that review and round: an id listed twice, an id nobody briefed, or a briefed id in neither list. With `--brief <file>`, the briefed ids SHALL be the `findings` of the record `remediate-brief --out` wrote, and the command SHALL neither plan the round again nor work out any deferral again; it SHALL refuse that record when it is missing, does not parse, is not an object, records another round, records a head other than `--head` (or, without `--head`, the review record's), lists no id, or lists an id the `--review` record does not hold as surviving, and it SHALL refuse `--profile` or `--previous` given beside it. Without `--brief`, it SHALL plan the round as `remediate-brief` does, applying the same two deferrals from the `--profile` and `--previous` it is given, and a round that `remediate-brief` would not brief SHALL be refused, naming why. Otherwise it SHALL exit 0 and print the counts and each `notFixed` reason. The skill SHALL run it with `--brief` naming the round's briefing record, after the fixer returns and before anything is staged, and on a non-zero exit SHALL print `ROUND FAILED` with the reason, commit nothing, say that the fixer's edits are left in the working tree, and end the loop.

Rationale: the git index shows what the fixer changed, not what it says it did. A result that leaves a briefed finding out is what a silent drop looks like, and the fixer's contract says every finding is either fixed or given a reason. The deferrals decide which findings were briefed, and they read a test profile and a previous result that sit in the fixer's reach, between the briefing and this check: worked out a second time, they can give another set than the one the fixer was handed. The briefing's own record is the set the fixer was handed.

#### Scenario: Happy path — every briefed id is fixed or given a reason

- **GIVEN** a review with two surviving warnings, and a result with `ok: true`, one id under `fixed` and the other under `notFixed` with a reason
- **WHEN** the command runs with `--round 1`
- **THEN** it exits 0
- **AND** standard output reads one fixed and one not fixed, with the reason

#### Scenario: Happy path — the briefed ids come from the briefing's record

- **GIVEN** a review with a surviving warning in `lib/y.mjs` and a surviving blocker in `test/x.test.mjs`, briefed at `--round 1` under a profile naming `test/` with `--out` keeping the record, so the blocker is deferred; then the profile removed, which would leave nothing protected; and a result listing the warning's id under `fixed`
- **WHEN** the command runs with `--brief` naming that record
- **THEN** it exits 0 and `--json` `briefed` holds the warning's id only
- **AND** the same command with `--profile` beside `--brief` exits 1, naming both flags

#### Scenario: Failure — no result, an unparseable one, and one that says it failed

- **GIVEN** no file at the result path, a result that is not JSON, and a result with `ok: false`
- **WHEN** the command runs for each
- **THEN** each exits 1
- **AND** each standard error names the fault

#### Scenario: Failure — a briefing record for another round, another head or another review

- **GIVEN** a briefing record whose `round` is 2 checked at `--round 1`, one whose `head` is not the `--head` given, and one listing an id the `--review` record does not hold as surviving
- **WHEN** the command runs with `--brief` naming each
- **THEN** each exits 1 with nothing on standard output
- **AND** each standard error names the record and what does not match

#### Scenario: Edge case — ids that do not partition the briefed set

- **GIVEN** a result that lists an id nobody briefed, one that leaves a briefed id out, and one that lists an id under both `fixed` and `notFixed`
- **WHEN** the command runs for each
- **THEN** each exits 1
- **AND** each standard error names the offending id

### Requirement: The skill SHALL stop a round whose precondition fails, and SHALL say which one failed

Before the first review the skill SHALL compare the platform's head (`gh pr view <n> --json headRefOid --jq .headRefOid`) with `git rev-parse HEAD`, and on a difference SHALL print `HEAD NOT ON THE PLATFORM`, naming both, and skip the loop. It SHALL end the loop on a `remediate-brief` exit only when standard error begins `interlock: STOP:`, reporting the reason; any other non-zero exit of `remediate-brief`, `settle comment` or `settle replies` SHALL print `ROUND FAILED` with the reason and go on to the assessment. It SHALL copy the test profile to `.claude/ship/settle/profile-r<r>.json` before briefing the round, record the head before spawning the fixer, and, after the fixer returns: end the loop with `FIXER COMMITTED` and nothing pushed when the head moved; and restore the profile from the copy, or remove one the fixer created, with `TEST PROFILE CHANGED` when the two differ. It SHALL name `general-purpose` as the fixer's type and say that the fixer runs with no ship guards. A push that fails SHALL end the loop and skip the ready mark. The verification verdict SHALL be written to a temporary file and kept only when the judge printed one (`test -s`), so a halting verdict is kept and an empty file never lands. Each verification step SHALL run with the tool's timeout set to the profile's `unit.timeout_ms`, and a step the tool killed SHALL be recorded as failed with the reason. The checks wait SHALL run in the background, and when it ends with checks unsettled the skill SHALL print `CHECKS STILL PENDING`. The ready step SHALL read `isDraft` on every pass, SHALL mark ready only a draft this pass created after a loop that did not stop early, and SHALL say why any other draft is still a draft.

Rationale: each of these is a state change the loop made as prose with no precondition. A fixer that commits its own test edit escapes the staged-path revert; a profile it rewrote changes the rule it is judged by; a stop and a broken input both exit 1; a review of a head the platform does not hold is posted against the wrong commit; a wait the tool cut short reads like a settled pipeline. Each one now has a check, a fixed token, or both.

#### Scenario: Happy path — the round's guards in order

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** the headRefOid `--jq` line comes before the first `review-code` line, the profile copy line before the `remediate-brief` line, and the `fixer-result` line between the fixer spawn and the staging line
- **AND** the prose carries `STOP:`, `ROUND FAILED`, `FIXER COMMITTED`, `TEST PROFILE CHANGED`, `general-purpose`, `test -s`, `run_in_background`, `CHECKS STILL PENDING`, `timeout_ms` and `isDraft`

#### Scenario: Failure — a fixer that committed

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the round
- **THEN** a head is recorded before the fixer spawn and compared after it
- **AND** the paragraph that compares it prints `FIXER COMMITTED`, says nothing was pushed and ends the loop

#### Scenario: Failure — a head the platform does not hold

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the section before the first review
- **THEN** it finds `HEAD NOT ON THE PLATFORM`
- **AND** the paragraph says the loop is skipped

#### Scenario: Edge case — each pin fails on a doctored copy

- **GIVEN** a copy of the skill with, in turn, the tree-check line moved after the clearing line, the `--literal-pathspecs` dropped from the revert, a bare `git add -A` line restored, and the `STOP:` token removed
- **WHEN** the pins run on each copy
- **THEN** each copy fails with a message naming what was dropped
- **AND** the shipped skill satisfies every pin
