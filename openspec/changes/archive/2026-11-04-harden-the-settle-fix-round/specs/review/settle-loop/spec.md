# Spec Delta

## ADDED Requirements

### Requirement: A fix round SHALL verify the staged tree before it commits, and a red round SHALL push nothing

When a round leaves something staged, the skill SHALL plan its verification with `interlock verify plan --context inter-wave` over the staged paths, run each planned step with `interlock verify exec`, judge with `interlock verify judge --context inter-wave --head <sha>` into `verify-r<r>.json`, and commit only on exit 0. A halt SHALL print `ROUND FAILED: unit red` with the judge's reason, commit nothing, push nothing, leave the round staged, and stop the loop early.

#### Scenario: Happy path — a green round commits and pushes

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite reads the round
- **THEN** between the `git diff --cached --quiet` line and the commit line it finds an `interlock verify plan` line carrying `--context inter-wave`, `--profile .claude/ship/settle/profile-r<r>.json` and `--changed`, an `interlock verify exec` line, and an `interlock verify judge` line carrying `--context inter-wave`, `--head` and `> .claude/ship/settle/verify-r<r>.json`
- **AND** the prose says a judge that exits 0 leads to the commit, the commit and push lines stay adjacent, and no `interlock settle replies` line sits between the quiet check and the commit

#### Scenario: Failure — a red round pushes nothing

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the paragraph after the round's judge line
- **THEN** it carries `ROUND FAILED: unit red`, says the judge's reason is printed with it, that nothing is committed or pushed, that the round's changes are left staged, and that the loop stops early
- **AND** the pass-level judge line still carries `--context final` and `> .claude/ship/settle/verify.json.tmp`, so the round's verdict and the pass's never share a file

#### Scenario: Edge case — a round that stages nothing pays for no suite

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the round
- **THEN** the round's `interlock verify plan` line sits after the `git diff --cached --quiet` line, whose exit-0 path ends the loop before any verification
- **AND** the staged paths handed to `--changed` come from a fenced `git diff --cached --name-only` line, never from a `--name-only` diff without `--cached`

#### Scenario: Edge case — no profile copy, and a prose-only round

- **GIVEN** a round with no `.claude/ship/settle/profile-r<r>.json`, and another whose staged paths are all documentation
- **WHEN** the skill plans each round's verification
- **THEN** the prose says `--no-profile` replaces the profile flag when no copy exists, and each `verify exec` runs with the tool's timeout set to the profile's `unit.timeout_ms`
- **AND** a plan whose staged paths are all documentation plans no step and is a green round: the judge exits 0 and the round commits

#### Scenario: Degraded path — a round the plan could not verify says so

- **GIVEN** a round whose plan lists no `unit` step, and whose `skipped` entry for `unit` gives a reason other than `docs-only-changes` (no profile copy, or a profile with no unit command)
- **WHEN** the judge exits 0
- **THEN** the skill prints `ROUND UNVERIFIED: <that reason>` and the plan's banners before the commit, and says it again in the report
- **AND** a documentation-only round, whose `unit` skip reason is `docs-only-changes`, prints no such line

### Requirement: The fixer SHALL be the plugin's bounded `settle-fixer` agent, briefed to run the unit suite one time at most

The plugin SHALL ship `agents/settle-fixer.md` with the worker's tool list, `Skill`, `Agent` and `mcp__*` disallowed and no effort key; the skill SHALL spawn the fixer as `interlock:settle-fixer`. The briefing SHALL tell the fixer to run the unit suite one time at most and never the whole suite while another agent may be running, on a line that is not its first. `interlock doctor` SHALL count the file among the required files.

#### Scenario: Happy path — the agent file and its frontmatter

- **GIVEN** the shipped plugin
- **WHEN** the plugin-agents suite runs
- **THEN** `agents/settle-fixer.md` exists, its `tools` equal the worker's `Read, Write, Edit, Grep, Glob, Bash`, its `disallowedTools` carry `Skill`, `Agent` and `mcp__*`, and it declares no `effort`
- **AND** its description carries `Never invoke from a user conversation` and names `/interlock:settle` as the one spawner

#### Scenario: Happy path — the skill spawns it

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the fixer paragraph
- **THEN** it names `interlock:settle-fixer` as the fixer's type, no fenced or prose line of the round names `general-purpose`, and the paragraph still carries `ONE`, `whole prompt`, `no ship guards` and `Do not fix anything yourself`
- **AND** the routing lines `interlock routing settle-fixer --json` and `ROUTING UNAVAILABLE` stay as they were

#### Scenario: Failure — the fixer type is unknown or the spawn is refused

- **GIVEN** a host that reports `interlock:settle-fixer` as an unknown type, or a spawn that is refused
- **WHEN** the skill reaches the fixer spawn
- **THEN** it prints `ROUND FAILED: fixer type unavailable` with the tool's message and stops the loop early, with nothing staged, committed or pushed
- **AND** it spawns no other type in its place and fixes nothing itself

#### Scenario: Happy path — the briefing's lines

- **GIVEN** `interlock settle remediate-brief` briefing a round
- **WHEN** the briefing is printed
- **THEN** after the paragraph that opens `Do not commit, do not push and do not stage` it carries a line telling the fixer to run the unit suite one time at most and never the whole suite while another agent may be running
- **AND** the briefing's first line still reads `Fix round <r> for change "<c>", pull request #<n>, at head <sha>.`

#### Scenario: Failure — a plugin without the file

- **GIVEN** a plugin directory lacking `agents/settle-fixer.md`
- **WHEN** `interlock doctor` runs against it
- **THEN** it reports the missing file among the required ones
- **AND** with the file present it reports nothing about it

## MODIFIED Requirements

### Requirement: The skill SHALL enter the loop only with `--review`, after the pull request exists, and SHALL produce its evidence in a fixed order

With `--review`, after the pull request exists, the `settle` skill SHALL run, in this order: the working-tree check `interlock settle tree-check` and only then the clearing of `.claude/ship/settle/`; the platform's head compared with the local head; a `review-code` pass on the pull request's diff with `--base origin/<target>` and `--out` under `.claude/ship/settle/`, at the published default depth or, with `--strict`, the strict one; the findings comment `interlock settle comment` renders; fix rounds, each the working-tree check again, a copy of the test profile, a fixer briefed by `interlock settle remediate-brief` (from the second round on, with `--previous` naming the round before's fixer result, and every round keeping its answer with `--out`), the fixer's result checked by `interlock settle fixer-result` against that kept record with `--brief`, the fixer's tree staged except the paths the tree check tolerates and classified by `interlock settle test-paths` with the protected paths reverted, and then, when a staged change remains, the round's verification through `interlock verify plan`, `exec` and `judge` with `--context inter-wave`, and on a green verdict a commit, a push, a fresh `review-code` pass on the pushed head scoped with `--dimensions` to the `reReviewDimensions` the briefing named and given the round before's record with `--carry`, at the same depth as the first pass, and the reply table `interlock settle replies` renders, or, when none remains, the reply table rendered from the round's own review on both sides and the end of the loop; the pull request marked ready when this pass created it as a draft; the confirmation worker briefed by `interlock settle conformance-brief`; the final verification through `interlock verify plan`, `exec` and `judge` with `--context final` and `--head`, and `interlock verify coverage` for the head when the plan ran a coverage step; the platform's checks, then the pipeline document re-read from the platform for the pushed head; and only then the assessment. Without `--review` the skill SHALL run none of this and SHALL behave as it did before the flag existed. A pass SHALL clear `.claude/ship/settle/` before it writes there.

Rationale: a reply that cites a commit the platform never saw, a verdict read from evidence about an earlier head, and a pipeline document read before the checks ran on the pushed head are the failures the order exists to prevent; clearing the directory keeps a stale round from an earlier pass out of a fresh one. A re-review that runs every dimension again over the whole diff after four findings were fixed is the cost the scoped pass removes, and the carry is what keeps the round's record whole for the reply table and the verdict. A commit verified before it is pushed is what keeps a red head off the platform and out of the ready mark.

#### Scenario: Happy path — the skill's lines appear in the loop's order

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds, in this order among the fenced lines, a `git status --porcelain=v1 -z --untracked-files=all` line piped into `interlock settle tree-check`, the `rm -rf .claude/ship/settle` line, a `review-code` invocation carrying `--base origin/` and `--out .claude/ship/settle/review-r`, an `interlock settle comment` line, an `interlock settle remediate-brief` line, an `interlock settle fixer-result` line, a `git add -A -- .` line carrying one `:(exclude)` per tolerated path, an `interlock settle test-paths` line, a `git diff --cached --quiet` line, an `interlock verify judge` line carrying `--context inter-wave`, a `git push` line, an `interlock settle replies` line, a `gh pr ready` line, an `interlock settle conformance-brief` line, an `interlock verify judge` line carrying `--context final` and `--head`, an `interlock verify coverage` line carrying `--base origin/`, a `gh pr checks` line carrying `--watch`, the `gh pr view` line piped into `interlock pipeline --github -`, and the `interlock merge-confidence` line that carries `--review .claude/ship/settle/review-r<last>.json`, `--verify` and `--handoff`
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

### Requirement: `interlock settle comment` SHALL render the surviving findings of a head-bound review with stable ids

`interlock settle comment --review <file> --head <sha> --round <n>` SHALL read an adjudicated review record, refuse one that lacks `surviving` or whose recorded `head` is not the given sha (exit 1, the reason on standard error, nothing on standard output), and print a Markdown comment whose heading names the round and the sha, followed by one row per surviving blocker or warning, and per surviving finding of a severity it does not recognise, carrying its id, severity, file and line, and title, then each of those findings' description and suggestion, and then, when any suggestion survived, one `<details>` block whose `<summary>` names the count of suggestions and which holds the same table and the same bodies for them, so a reader sees what was verified first and nothing is dropped. The id SHALL be the one `findingId` derives from the shared finding identity. Surviving findings that share a key SHALL be one finding at the highest severity among them, and that merged list SHALL be what `comment`, `replies`, `remediate-brief` and `fixer-result` all read, so no surviving blocker is hidden behind a warning with its key. Every reviewer-written title, location and unrecognised severity SHALL render as an inline code span, and every description and suggestion inside a code fence longer than any backtick run it holds, so no finding text renders as a mention, a link, markup or a line-start command, and no reviewer-written text SHALL close the `<details>` block. With `--json` it SHALL print `{ head, round, findings: [{ id, key, severity, file, line, title }], proof }`, listing every surviving finding at every severity. Every comment SHALL end with a coverage line naming the dimensions that ran and how many of the changed source files their ledgers cited; on a record whose proof does not hold, a comment with surviving findings SHALL end instead with a line opening `REVIEW NOT PROVEN:` naming the same gaps. An empty surviving list on a record whose proof holds SHALL print one paragraph naming the sha, saying the review raised no surviving finding, and carrying the coverage line, and exit 0. An empty surviving list on a record whose proof does not hold, or that carries no proof, SHALL instead print a paragraph opening `REVIEW NOT PROVEN` that names the sha, each unproven dimension, each dimension with unread inputs and those inputs, and each uncited changed source file, SHALL NOT say the review raised no finding, and SHALL exit 0.

#### Scenario: Happy path — two findings, two ids

- **GIVEN** a record with `head` H and two surviving findings in different files
- **WHEN** the command runs with `--head H --round 0`
- **THEN** standard output's heading names round 0 and H, and two rows each carry an id of the form `F-` plus eight hexadecimal characters, the severity, `file:line` and the title
- **AND** running it again prints the same ids, and the comment ends with the coverage line

#### Scenario: Failure — a record for another head, or no adjudication

- **GIVEN** a record whose `head` is not H, and another that carries `findings` but no `surviving`
- **WHEN** the command runs for each with `--head H`
- **THEN** each exits 1 with nothing on standard output
- **AND** the first's standard error says the record describes another commit, naming both, and the second's says the record is not an adjudicated review

#### Scenario: Edge case — nothing survived

- **GIVEN** a record with `head` H, an empty `surviving` list and a proof that holds
- **WHEN** the command runs with `--head H --round 1`
- **THEN** it prints one paragraph naming H and round 1, saying no finding survived, and carrying the coverage line
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
- **AND** no line outside a fence or a span begins with `/approve`, and the only `<details>`, `<summary>` and `</details>` lines outside a fence or a span are the renderer's own

#### Scenario: Failure — the PR #28 record is not called clean

- **GIVEN** the PR #28 round-0 record at head `e177e7d`: an empty `surviving` list and a proof naming four unproven dimensions and four uncited source files
- **WHEN** the command runs with `--head e177e7d… --round 0`
- **THEN** standard output opens `REVIEW NOT PROVEN`, names the four dimensions and the four files, and does not contain `raised no surviving finding`
- **AND** it exits 0

#### Scenario: Edge case — suggestions are collapsed, with their ids

- **GIVEN** a record with `head` H whose surviving list holds a blocker, a warning and two suggestions, in that order
- **WHEN** the command runs with `--head H --round 0`, and again on a record of two suggestions only
- **THEN** the first comment's table holds two rows, blocker then warning, their bodies follow, and the two suggestion rows with their bodies sit between a `<details>` line whose `<summary>` reads `2 suggestions` and a `</details>` line, before the coverage line, which is still last
- **AND** all four ids are the ones `findingId` derives and `--json` lists all four; the second comment renders its heading, the `<details>` block and the coverage line, with no table before the block, and running either again prints the same bytes

### Requirement: `interlock settle conformance-brief` SHALL brief the confirmation of scenarios and living requirements from the CLI's own checklist, bound to the head

`interlock settle conformance-brief <change> --changed <files> --base <ref> --head <sha> [--result <file>]` SHALL gather the checklist `interlock conformance <change> --changed --living --base --json` produces and print a briefing asking one worker to confirm each scenario C1..Cn and each living requirement L1..Ln against the diff, answering into the result file with the five keys `scenariosChecked`, `scenariosUnconfirmed`, `requirementsChecked`, `requirementsUnconfirmed` and `detail`, and `head` equal to the sha the briefing names. The briefing SHALL tell the worker to read the code and the specs and not to run the test suite or a build, because the pass verifies separately, on a line that is not the briefing's first. When the living list could not be built, the briefing SHALL still list the scenarios, say why the list is absent, and ask for the same keys with the two requirement counts reported as zero. With nothing to confirm, neither a scenario nor a living requirement, it SHALL print nothing on standard output, say so on standard error, and exit 0. A change that cannot be resolved SHALL exit 1 naming it.

Rationale: a lean ship leaves the two conformance signals unobserved for want of a handoff, and the strict tail's worker answers exactly this checklist; asking the same questions through the same CLI keeps the two from drifting. The head in the answer is what lets the verdict refuse a handoff written for the previous head. A worker that runs the suite beside the pass's own verification doubles the cost and can collide with it.

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

#### Scenario: Edge case — the worker reads and does not run

- **GIVEN** a change with scenarios to confirm
- **WHEN** the command runs
- **THEN** the briefing carries a line telling the worker not to run the test suite or a build and to read the code and the specs instead
- **AND** the briefing's first line still reads `Confirm change "<c>" against its diff at head <sha>.`

### Requirement: The skill SHALL post only what the CLI rendered, SHALL commit and push each round's fix before replying, SHALL end a round that changed nothing without a push, and SHALL still never merge or approve

The skill SHALL post the comment `interlock settle comment` printed and the table `interlock settle replies` printed, each through the platform's comment command with the body from standard input, and SHALL write neither by hand. After the fixer and the test-path revert, a round that leaves nothing staged SHALL commit nothing and push nothing, SHALL post the reply table rendered from the round's own review on both sides, in which every finding reads `open`, and SHALL end the loop. Any other round's fix SHALL be verified as the round's verification requirement says and, on a green verdict, committed with a message that names the pull request and the round, and pushed, before the re-review and the reply. Beside the push the skill SHALL say what a push does on the platform: it dismisses the stale approvals a ruleset marks and takes the pull request out of auto-merge or a merge train, the loop's verdict restores neither, and the skill does not re-request a review. The skill SHALL NOT approve, request changes on, resolve a review thread of, or merge the pull request, and the paragraph that says so SHALL say that `MERGE` is a statement about the local signals and not the platform's branch rules, naming a merge queue among them. The GitLab lines of the loop SHALL be marked as not exercised; the GitHub lines SHALL carry no such marker, a pass of the loop having been recorded on PR #25 on 2026-10-26, and the archive's task 8.5 of `close-the-merge-request-loop` SHALL be ticked citing it; the GitLab wait SHALL poll the pull request's head pipeline rather than follow the branch pipeline. The create step SHALL hand the description to the platform from a quoted here-document, never inside a double-quoted argument, and the skill SHALL push nothing before the create step outside that step.

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

#### Scenario: Edge case — the GitHub marker is retired and the GitLab markers stay

- **GIVEN** the shipped skill, `README.md`, `docs/15-merge-confidence.md` and the archived `close-the-merge-request-loop/tasks.md`
- **WHEN** the skill suite runs and the files are read
- **THEN** no paragraph of the loop's section says its GitHub lines are not exercised end to end, and neither the README nor docs/15 says the GitHub loop is unexercised
- **AND** every `glab` line of the loop still sits in a block marked `not exercised`, and task 8.5 is ticked naming PR #25 and its head

### Requirement: `interlock settle replies` SHALL compute each finding's status under the shared finding identity

`interlock settle replies --before <file> --after <file> --head <sha> [--result <file>]` SHALL read two adjudicated review records, refuse either that lacks `surviving` and an after-record whose `head` is not the given sha, and, with `--result`, read the round's fixer result as `interlock settle fixer-result` validates one, refusing one that is missing, unparseable or not `ok: true` (exit 1, nothing on standard output). It SHALL compute: `fixed` for each surviving finding of the before-record whose key no surviving finding of the after-record shares and whose id the fixer result lists under `fixed`; `not re-raised` for each such finding whose id it does not list, and for every such finding when no `--result` is given; `open` for each whose key one does; `new` for each key of the after-record the before-record lacks. The key SHALL be `findingKey`: the file in its canonical repository form (`canonicalizePath`, or the trimmed spelling when it has none), a separator, and the title trimmed, with internal whitespace collapsed to one space, case-folded, and any trailing run of whitespace, `.`, `:`, `;` and `!` removed. It SHALL print a Markdown table whose heading names the sha, a counts line naming `fixed`, `not re-raised`, `open` and `new`, a fixed legend line saying that `fixed` means the round's fixer claimed the finding and a fresh review did not raise it again under the same file and title and is not a confirmation, a second legend line saying that `not re-raised` means a fresh review did not raise it again but no fixer claimed it, so nothing shows it was fixed, one row per finding with its id, status, file and title, and with `--json` `{ head, fixed, notReRaised, open, new, counts }`, `counts` carrying `notReRaised` beside the other three. An `open` finding that the after-record marks `carried` SHALL read `open (carried)` in the table and carry `carried: true` in its JSON entry, and the legend SHALL say that `carried` means the finding's dimension was not re-run and the finding was brought forward unexamined. The same file given as both records SHALL read every finding `open`.

Rationale: a reply that says "fixed" is a claim that the fixer worked the finding and an independent re-review on the pushed head did not raise it again. A fresh reviewer that simply did not mention a finding reads the same as one that checked it was gone: on PR #31, three of the five findings the reply table called `fixed` were never briefed and their code was unchanged. The fixer's claim is the record that tells the two apart, and it already exists; and two readers of the same identity are the only way the comment's ids and the reply's statuses name the same things. The same-file case is how a round that changed nothing says so without a second review. A carried finding is open because nobody looked, not because somebody looked and found it still there, and the reader of the pull request is owed the difference.

#### Scenario: Happy path — one fixed, one open, one new

- **GIVEN** a before-record with findings A and B, an after-record with `head` H carrying B and a new finding C, and a fixer result whose `fixed` lists A
- **WHEN** the command runs with `--head H --result <that result> --json`
- **THEN** `fixed` holds A's id, `open` holds B's, `new` holds C's, `notReRaised` is empty, and `counts` reads one of each of the first three
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
- **THEN** `open` holds A's and B's ids, and `fixed`, `notReRaised` and `new` are empty
- **AND** the table's heading names H and carries two rows reading `open`

#### Scenario: Edge case — a finding the re-review dropped that no fixer claimed

- **GIVEN** a before-record with findings A, B and C, an after-record with `head` H carrying C, and a fixer result whose `fixed` lists A and C
- **WHEN** the command runs with `--head H --json`, once without `--result` and once with it
- **THEN** without it `fixed` is empty and `notReRaised` holds A's and B's ids; with it `fixed` holds A's id, `notReRaised` B's and `open` C's
- **AND** the table reads `1 fixed, 1 not re-raised, 1 open, 0 new.`, B's row reads `not re-raised`, and both legend lines are printed, each its own line

#### Scenario: Failure — a fixer result the command cannot use

- **GIVEN** a `--result` that is missing, one that does not parse, and one whose `ok` is false
- **WHEN** the command runs for each
- **THEN** each exits 1 with nothing on standard output
- **AND** standard error names the fixer result

### Requirement: `interlock settle remediate-brief` SHALL brief a fix-only round under the ship loop's stop rule and the published cap

`interlock settle remediate-brief --review <file> --round <n> --change <name> --head <sha> [--pr <n>] [--profile <file>] [--result <file>] [--previous <file>] [--out <file>]` SHALL build the round's plan with the same planner the ship loop uses and the limits `interlock limits` publishes, under the rule the ship loop applies: the first round plans every surviving blocker and warning; a later round plans a fix only while a surviving blocker remains, and otherwise the plan is built at the verdict round, one past the published cap, which plans nothing; a round beyond the verdict round is refused by the planner. Before the planner runs, the command SHALL defer two kinds of finding and hand the planner the rest: every blocker and warning whose file is one the test guard protects, with a reason naming the path and the guard and saying a person fixes it; and, when `--previous` names the fixer result of the round before — validated as `interlock settle fixer-result` validates one, and refused when it is for another round — every finding that result lists under `notFixed`, with that entry's reason quoted. When the plan has a fix to brief, the command SHALL print a briefing that lists each finding with its id inside a block labelled as quoted reviewer data, lists the deferred findings under `Deferred this round` with their reasons and the sentence that the fixer does not touch them, names the head and the pull request, names what the fixer must not edit, tells the fixer not to commit, and names the result file and its shape `{ ok, fixed, notFixed }`; with `--json` it SHALL also carry `reReviewDimensions`, the planner's list of the dimensions whose findings this round fixes, and `deferred`, the deferred findings as `{ id, reason }`. With `--out <file>` it SHALL write that `--json` answer to the file before it prints anything, as the round's briefing record, and a file it cannot write SHALL exit 1 with nothing on standard output and a reason without the prefix; on a stop or a refusal it SHALL write nothing. What the fixer must not edit SHALL be computed by the command from the test profile, or from the copy `--profile` names, with the guard's own roots and suffix rule, and the briefing SHALL tell apart no profile, a profile that could not be read and a profile that names no test root; the command SHALL take no list of protected paths from its caller. The briefing SHALL carry no re-review instruction. When the deferrals leave no blocker or warning for the planner, the command SHALL exit 1 with nothing on standard output and `STOP: nothing fixable remains` on standard error naming how many findings sit in protected paths and how many the round before's fixer declined. When the plan has nothing to fix or halts, for any reason the planner gives (an empty surviving list, suggestions only, the verdict round, unresolved blockers past the cap, a round past the verdict round), the command SHALL exit 1 with nothing on standard output and the planner's reason on standard error behind the fixed prefix `STOP:`; a reason that concerns the cap SHALL name the round and the published value. After the `STOP:` line of any stop, standard error SHALL carry a line opening `ANOTHER PASS SUGGESTED:` when blockers or warnings the planner kept survive. That line SHALL name each one's id and severity, say that a new `/interlock:settle --review` pass's first round briefs every surviving blocker and warning, and say that the loop does not start one. It SHALL also carry a line opening `LEFT FOR A PERSON:` when findings were deferred, naming each one's id and why no fix round can take it. Neither line SHALL be printed when there is nothing for it to name, and a suggestion SHALL never be named in either. An input it cannot use (a record with no surviving list, a record for another head, a round that is not a positive integer, a missing flag, a `--previous` for another round or without `fixed` and `notFixed`) SHALL exit 1 with a reason that never carries the prefix.

Rationale: the round cap is a threshold and lives in the CLI, and the loop runs no extra round past it by default. A stop that leaves a warning the last re-review added, as on PR #31 where both of them were real, is one a new pass could fix, so the CLI names them and the person decides whether that pass is worth its cost; the skill loops while this command exits zero and never states a number. One stop rule, the ship loop's, so the loop neither briefs a fixer after the budget nor stops a round early. The prefix is what lets the loop tell its stop rule from a broken input: both exit 1, and only one of them means the review converged. The fixer does not re-review its own work: a fresh review of the pushed head does. A finding in a path the guard reverts, and a finding the last fixer already declined, are rounds the command can see will fix nothing; deferring them spends no fixer on them and hides nothing, because a deferred finding is still open in the reply table and still banded in the verdict.

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

#### Scenario: Edge case — a stop that leaves fixable findings suggests another pass

- **GIVEN** a published cap of at least two, a record with two surviving warnings and a suggestion at `--round 2`, and a record with one surviving blocker at the verdict round
- **WHEN** the command runs for each
- **THEN** each exits 1 with standard error beginning `interlock: STOP:`, and a later line opens `ANOTHER PASS SUGGESTED:`
- **AND** the first names `2 warning(s)` and both warnings' ids but not the suggestion's, and says the loop does not start one; the second names `1 blocker(s)`

#### Scenario: Edge case — a stop with nothing left suggests nothing, and a deferred finding is left for a person

- **GIVEN** a record whose surviving list is empty, a record of suggestions only, both at `--round 1`, and a record whose only surviving finding is a blocker in `test/x.test.mjs` with a profile naming `test/`
- **WHEN** the command runs for each
- **THEN** the first two carry neither `ANOTHER PASS SUGGESTED:` nor `LEFT FOR A PERSON:`
- **AND** the third carries `LEFT FOR A PERSON:` naming the blocker's id and `protected test path test/x.test.mjs`, and no `ANOTHER PASS SUGGESTED:`

### Requirement: The skill SHALL stop a round whose precondition fails, and SHALL say which one failed

Before the first review the skill SHALL compare the platform's head (`gh pr view <n> --json headRefOid --jq .headRefOid`) with `git rev-parse HEAD`, and on a difference SHALL print `HEAD NOT ON THE PLATFORM`, naming both, and skip the loop. It SHALL end the loop on a `remediate-brief` exit only when standard error begins `interlock: STOP:`, reporting the reason and printing verbatim, and again in the report, any `ANOTHER PASS SUGGESTED:` or `LEFT FOR A PERSON:` line after it, and SHALL start no pass and no round on either; any other non-zero exit of `remediate-brief`, `settle comment` or `settle replies` SHALL print `ROUND FAILED` with the reason and go on to the assessment, and a round's `verify judge` that exits non-zero SHALL print `ROUND FAILED: unit red` with its reason, commit nothing, and stop the loop early. It SHALL copy the test profile to `.claude/ship/settle/profile-r<r>.json` before briefing the round, record the head before spawning the fixer, and, after the fixer returns: end the loop with `FIXER COMMITTED` and nothing pushed when the head moved; and restore the profile from the copy, or remove one the fixer created, with `TEST PROFILE CHANGED` when the two differ. It SHALL name `interlock:settle-fixer` as the fixer's type and say that the fixer runs with no ship guards, its tools bounded by that definition. A push that fails SHALL end the loop and skip the ready mark. The pass's verification verdict (`verify.json`) SHALL be written to a temporary file and kept only when the judge printed one (`test -s`), so a halting verdict is kept and an empty file never lands; a round's judge writes `verify-r<r>.json` directly, nothing later reads it, and a round whose file is empty after a non-zero exit SHALL be stopped with `the judge printed no verdict` as its reason. Each verification step SHALL run with the tool's timeout set to the profile's `unit.timeout_ms`, and a step the tool killed SHALL be recorded as failed with the reason. The checks wait SHALL run in the background, and when it ends with checks unsettled the skill SHALL print `CHECKS STILL PENDING`. The ready step SHALL read `isDraft` on every pass, SHALL mark ready only a draft this pass created after a loop that did not stop early, and SHALL say why any other draft is still a draft.

Rationale: each of these is a state change the loop made as prose with no precondition. A fixer that commits its own test edit escapes the staged-path revert; a profile it rewrote changes the rule it is judged by; a stop and a broken input both exit 1; a review of a head the platform does not hold is posted against the wrong commit; a wait the tool cut short reads like a settled pipeline; a fix pushed before the suite ran puts a red head on the platform. Each one now has a check, a fixed token, or both.

#### Scenario: Happy path — the round's guards in order

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** the headRefOid `--jq` line comes before the first `review-code` line, the profile copy line before the `remediate-brief` line, the `fixer-result` line between the fixer spawn and the staging line, and the round's `verify judge` line between the `git diff --cached --quiet` line and the commit line
- **AND** the prose carries `STOP:`, `ANOTHER PASS SUGGESTED:`, `LEFT FOR A PERSON:`, `ROUND FAILED`, `unit red`, `FIXER COMMITTED`, `TEST PROFILE CHANGED`, `interlock:settle-fixer`, `test -s`, `run_in_background`, `CHECKS STILL PENDING`, `timeout_ms` and `isDraft`

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

- **GIVEN** a copy of the skill with, in turn, the tree-check line moved after the clearing line, the `--literal-pathspecs` dropped from the revert, a bare `git add -A` line restored, the `STOP:` token removed, the round's `verify judge` line moved after the commit line, and `interlock:settle-fixer` replaced by `general-purpose`
- **WHEN** the pins run on each copy
- **THEN** each copy fails with a message naming what was dropped
- **AND** the shipped skill satisfies every pin
