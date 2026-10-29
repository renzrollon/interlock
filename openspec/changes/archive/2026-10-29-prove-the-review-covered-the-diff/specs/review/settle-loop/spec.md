# Spec Delta

## MODIFIED Requirements

### Requirement: `interlock settle comment` SHALL render the surviving findings of a head-bound review with stable ids

`interlock settle comment --review <file> --head <sha> --round <n>` SHALL read an adjudicated review record, refuse one that lacks `surviving` or whose recorded `head` is not the given sha (exit 1, the reason on standard error, nothing on standard output), and print a Markdown comment whose heading names the round and the sha, followed by one row per surviving finding carrying its id, severity, file and line, and title, then each finding's description and suggestion. The id SHALL be the one `findingId` derives from the shared finding identity. Surviving findings that share a key SHALL be one finding at the highest severity among them, and that merged list SHALL be what `comment`, `replies`, `remediate-brief` and `fixer-result` all read, so no surviving blocker is hidden behind a warning with its key. Every reviewer-written title, location and unrecognised severity SHALL render as an inline code span, and every description and suggestion inside a code fence longer than any backtick run it holds, so no finding text renders as a mention, a link, markup or a line-start command. With `--json` it SHALL print `{ head, round, findings: [{ id, key, severity, file, line, title }], proof }`. Every comment SHALL end with a coverage line naming the dimensions that ran and how many of the changed source files their ledgers cited; on a record whose proof does not hold, a comment with surviving findings SHALL end instead with a line opening `REVIEW NOT PROVEN:` naming the same gaps. An empty surviving list on a record whose proof holds SHALL print one paragraph naming the sha, saying the review raised no surviving finding, and carrying the coverage line, and exit 0. An empty surviving list on a record whose proof does not hold, or that carries no proof, SHALL instead print a paragraph opening `REVIEW NOT PROVEN` that names the sha, each unproven dimension, each dimension with unread inputs and those inputs, and each uncited changed source file, SHALL NOT say the review raised no finding, and SHALL exit 0.

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
- **AND** no line outside a fence or a span begins with `/approve`

#### Scenario: Failure — the PR #28 record is not called clean

- **GIVEN** the PR #28 round-0 record at head `e177e7d`: an empty `surviving` list and a proof naming four unproven dimensions and four uncited source files
- **WHEN** the command runs with `--head e177e7d… --round 0`
- **THEN** standard output opens `REVIEW NOT PROVEN`, names the four dimensions and the four files, and does not contain `raised no surviving finding`
- **AND** it exits 0

### Requirement: `interlock settle tree-check` SHALL say whether the working tree holds anything a fix round would sweep in, and the skill SHALL start no loop and no round on a tree that does

`interlock settle tree-check --change <name> --status <file|->` SHALL read the output of `git status --porcelain=v1 -z --untracked-files=all`, take each entry's path and, for a rename or a copy, its original path as well, and SHALL tolerate exactly the paths `toleratedPaths(<name>)` names: the change's `settle-summary.md`, which the skill itself writes, in the change's own directory or, for a change read from the archive, in its archived directory; and `docs/notes/compound.md`, which the nested review appends to. Every other path SHALL be dirty. With no dirty path it SHALL exit 0; with any, it SHALL print the dirty paths and exit 1; with `--json` it SHALL print `{ clean, dirty, tolerated }` in both cases. Input that is not NUL-terminated, and a missing `--change` or `--status`, SHALL exit 1 with the reason on standard error and nothing on standard output. The skill SHALL run it before the pass clears `.claude/ship/settle/` and again at the start of each fix round. On a non-zero exit it SHALL print `WORKING TREE NOT CLEAN` with the paths, start nothing, commit nothing and push nothing, and the assessment SHALL still run, without the loop's records. The round's staging line SHALL exclude exactly the tolerated paths, read from `interlock settle staging-pathspecs`, so the paths the check lets through are never staged.

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
- **AND** the staging line reads its pathspecs from `interlock settle staging-pathspecs`, whose `:(exclude)` paths are exactly `toleratedPaths("<change>")`, the archived summary's path included when the change is read from the archive

#### Scenario: Edge case — an archived change's summary is tolerated

- **GIVEN** a change `x` read from `openspec/changes/archive/2026-10-28-x/`, and a status whose only entry adds that directory's `settle-summary.md`
- **WHEN** the command runs with `--change x`
- **THEN** it exits 0 with the archived summary under `tolerated`

## ADDED Requirements

### Requirement: Every review of the loop SHALL have run review-code's proof re-run before the loop posts its comment, and the loop SHALL run no second one

Each `/interlock:review-code` pass of the loop SHALL repeat its own `interlock review proof` re-run (D17) until that line exits 0 before it writes the record the loop reads: the first pass is recorded as a draft that carries the review's `--dimensions` and `--carry`, the CLI merges each re-run into the draft (a replaced answer for an unproven or unread dimension, an append for uncited files, the draft's verdicts kept), the re-run's new findings go through the skeptics, and the final record is the promoted draft, written once for the same head with `--metrics`, so no first-pass finding, verdict, skip or degraded entry is lost and no dimension outside a scoped review's `--dimensions` runs. The settle skill SHALL post the comment and plan the next round from that final record, SHALL NOT run `interlock review proof` itself, and the comment of a record left unproven at the cap SHALL say so.

#### Scenario: Happy path — one unproven dimension is re-run inside the review

- **GIVEN** a round-0 review in which `technical-lead` recorded an unread input
- **WHEN** the loop runs
- **THEN** review-code re-runs `technical-lead` alone, its findings are adjudicated by the skeptics, the record is written once for the same head, and the loop posts the comment from that record

#### Scenario: Edge case — a scoped fix round with a carry re-runs nothing outside its scope

- **GIVEN** a fix round whose review is scoped with `--dimensions technical-lead --carry <round-0 record>`, whose carried ledgers still cite every file the fix left unchanged, and whose `technical-lead` answer cites the files the fix changed
- **WHEN** the review's draft is written and its proof line runs
- **THEN** the line prints `proven`, `regression` is not re-run, and the round-0 `regression` survivors are carried into the record

#### Scenario: Failure — still unproven at the cap

- **GIVEN** a dimension that stays unproven through the published number of re-runs
- **WHEN** review-code's proof line prints `PROOF CAP REACHED`
- **THEN** the loop posts the comment, which opens `REVIEW NOT PROVEN` when nothing survived and ends with a `REVIEW NOT PROVEN:` line when findings did, and goes on to plan the round

#### Scenario: Edge case — the skills' pins

- **GIVEN** the shipped settle and review skills
- **WHEN** the skill suite runs
- **THEN** the `interlock review proof` line appears in the review skill after the skeptic line and before the record's final `interlock review` line, the settle skill holds no `interlock review proof` line, and neither names a count of re-runs

### Requirement: `interlock settle staging-pathspecs` SHALL print the round's staging pathspecs, so the staging line excludes exactly the tolerated paths

`interlock settle staging-pathspecs --change <name> --nul` SHALL print, NUL-terminated, `.` followed by one `:(exclude)` pathspec per path `toleratedPaths(<name>)` names, resolving an archived change's directory as the tree check does. The skill SHALL write them to `.claude/ship/settle/pathspecs-r<r>`, SHALL stage only when that file is non-empty, reading it with `git add -A --pathspec-from-file=<file> --pathspec-file-nul`, and SHALL fail the round when the command exits non-zero or the file is empty, because git reads an empty pathspec list as the whole tree.

#### Scenario: Happy path — an active change

- **GIVEN** an active change `x`
- **WHEN** the command runs with `--change x --nul`
- **THEN** it prints `.`, `:(exclude)openspec/changes/x/settle-summary.md` and `:(exclude)docs/notes/compound.md`, each NUL-terminated

#### Scenario: Edge case — an archived change

- **GIVEN** a change `x` read from `openspec/changes/archive/2026-10-28-x/`
- **WHEN** the command runs
- **THEN** the summary's pathspec names the archived directory

#### Scenario: Failure — an empty pathspec file stages nothing

- **GIVEN** a round in which `staging-pathspecs` exits non-zero and leaves an empty file
- **WHEN** the round reaches its staging line
- **THEN** nothing is staged, the skill prints `ROUND FAILED:` naming the command, and the loop stops early

#### Scenario: Failure — no change named

- **GIVEN** no `--change`
- **WHEN** the command runs
- **THEN** it exits 1 with nothing on standard output

### Requirement: The loop SHALL resolve a change archived in the pull request, read-only, and say so

When no active change resolves, the skill SHALL pipe `git diff --name-status -M <base>...HEAD`, read with no pathspec, into `interlock settle archived-change --name-status -`, which SHALL treat an archive directory with any `R` path from `openspec/changes/<name>/` as a rename, its added `settle-summary.md` included, SHALL print the one `openspec/changes/archive/<date>-<name>/` directory whose every path is `A` as the change (`{ change, dir, renamed }` with `--json`), and SHALL exit 1 naming the candidates when two qualify or none does. For that change, or one the person names that exists only in the archive, the review, conformance, domain-context and merge-confidence lines SHALL read the archived change's artifacts and print `CHANGE READ FROM ARCHIVE: <dir>`. Nothing SHALL write into an archived change other than `settle-summary.md`. Listings, no-name defaults, ship readiness, run start and every other writer SHALL keep excluding the archive.

#### Scenario: Happy path — the PR #28 change is read from the archive

- **GIVEN** the PR #28 name-status at `251cebe...e177e7d` read with `-M` and no pathspec, in which every file of `route-prose-spawns-by-role` and `agree-with-openspec-1-15` is `R100` from `openspec/changes/<name>/` beside one added `settle-summary.md` each, and every file of `openspec/changes/archive/2026-10-28-draw-the-settle-and-spec-panes-as-cards/` is `A`, and no active change
- **WHEN** `interlock settle archived-change --name-status -` reads it, and `interlock settle conformance-brief`, `interlock domain-context` and `interlock merge-confidence` run for the change it printed
- **THEN** the verb prints `draw-the-settle-and-spec-panes-as-cards` and lists the two renamed directories under `renamed`, each line prints `CHANGE READ FROM ARCHIVE:` naming the added directory, and none reports that the change was not found
- **AND** `conformance.delta` and `decisions.open` read the archived change's scenarios and ledger

#### Scenario: Failure — two archived changes and no name

- **GIVEN** a name-status in which two archive directories have every path `A`, and no change named
- **WHEN** `interlock settle archived-change --name-status -` reads it
- **THEN** it exits 1 naming both, and the loop picks neither and asks which change the pull request carries

#### Scenario: Edge case — the skill's derivation line

- **GIVEN** the shipped settle skill
- **WHEN** the skill suite runs
- **THEN** its §2 pipes a `git diff --name-status -M` line that carries no pathspec into `interlock settle archived-change --name-status -`, and the prose classifies no name-status line itself

#### Scenario: Edge case — archives stay out of listings and writers

- **GIVEN** an archived change and no active change
- **WHEN** `interlock changes`, `interlock drift`, `interlock ready` and `interlock run start` run with no change name
- **THEN** none of them selects or lists the archived change
