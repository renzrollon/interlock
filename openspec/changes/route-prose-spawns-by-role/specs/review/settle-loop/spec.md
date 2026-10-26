## MODIFIED Requirements

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
