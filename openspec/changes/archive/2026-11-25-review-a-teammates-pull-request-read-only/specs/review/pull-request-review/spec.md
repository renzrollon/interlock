# Spec Delta

## Purpose

Reviewing a pull request someone else wrote, read-only: the pull request is named by number or URL, pinned from the platform's own document, reviewed in a worktree that is removed afterwards, and answered with at most one comment. Nothing on this path writes to the author's branch, to the pull request's settings or to the reviewer's own working tree.

## ADDED Requirements

### Requirement: `interlock review target` SHALL pin a pull request from the platform's own document, offline

`interlock review target --github <file|-> | --gitlab <file|-> [--run-code]` SHALL read the document the platform's CLI printed and write a target file naming the platform, the number, the base and the head as that document states them, the session directory, the worktree path, and the `git` argv that fetch the commits, create the worktree, list its changed files and remove it. It SHALL open no network connection and run no platform CLI.

#### Scenario: Happy path — a GitHub pull request is pinned

- **GIVEN** the document `gh pr view 44 --json number,url,state,isDraft,isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid` prints for an open pull request whose head is in the same repository
- **WHEN** `interlock review target --github - --json` reads it
- **THEN** it exits 0, and the output's `number` is the document's `number`, `head.sha` its `headRefOid`, `base.sha` its `baseRefOid`, `base.ref` its `baseRefName`, and `runCode` is false
- **AND** the file at the output's `file` exists inside the output's `dir` and holds the same object
- **AND** `commands.worktreeAdd` creates a detached worktree at `worktree` on `head.sha`, and `commands.fetch` names `refs/heads/<base.ref>` and `refs/pull/<number>/head` in full

#### Scenario: Happy path — a GitLab pull request is pinned

- **GIVEN** the document `glab mr view 12 --output json` prints for an opened pull request whose source and target projects are the same
- **WHEN** `interlock review target --gitlab - --json` reads it
- **THEN** `number` is the document's `iid`, `head.sha` its `sha`, `base.sha` its `diff_refs.base_sha` and `base.ref` its `target_branch`
- **AND** `commands.fetch` names `refs/heads/<base.ref>` and `refs/merge-requests/<iid>/head` in full

#### Scenario: Edge case — `--run-code` is recorded and changes nothing else

- **GIVEN** the same GitHub document
- **WHEN** the command runs once with `--run-code` and once without
- **THEN** the first target's `runCode` is true and the second's is false
- **AND** every other field of the two targets is the same

#### Scenario: Edge case — the places follow the head

- **GIVEN** two documents for the same pull request that state different head commits
- **WHEN** the command reads each
- **THEN** the two targets name different session directories and different worktree paths
- **AND** reading the first document a second time names the same two places as the first time

### Requirement: `interlock review target` SHALL refuse a pull request it cannot pin

The command SHALL exit 1, print nothing on standard output and write no file when the document names a fork, a pull request that is not open, a commit that is not a full hexadecimal commit id, a branch name that cannot be a git ref name, or lacks any field the command reads. An absent field SHALL never be read as a default: a document that does not say whether the head lives in another repository is refused, not taken as same-repository.
#### Scenario: Failure — a fork is refused

- **GIVEN** a GitHub document with `isCrossRepository` true, and a GitLab document whose `source_project_id` differs from its `target_project_id`
- **WHEN** the command reads each
- **THEN** each exits 1 with nothing on standard output, and standard error says fork pull requests are not reviewed and names the pull request
- **AND** no target file is written

#### Scenario: Failure — a pull request that is not open

- **GIVEN** a GitHub document whose `state` is `MERGED`
- **WHEN** the command reads it
- **THEN** it exits 1 naming the state, and writes no file

#### Scenario: Failure — a document that does not say whether it is a fork

- **GIVEN** a GitHub document with every field but `isCrossRepository`
- **WHEN** the command reads it
- **THEN** it exits 1 naming the missing field, and writes no file

#### Scenario: Failure — a GitLab pull request whose diff references are not filled yet

- **GIVEN** a GitLab document for a pull request created a moment ago, whose `diff_refs` holds no `base_sha`
- **WHEN** the command reads it
- **THEN** it exits 1 saying the pull request does not state its base commit yet, and writes no file

#### Scenario: Failure — a branch name that cannot be a ref name

- **GIVEN** a GitHub document whose `baseRefName` holds a colon, and another whose `headRefName` holds a space
- **WHEN** the command reads each
- **THEN** each exits 1 naming the field, and writes no file

#### Scenario: Failure — a commit that is not a full commit id

- **GIVEN** a GitHub document whose `headRefOid` is a seven-character abbreviation, and a GitLab document whose `diff_refs.base_sha` holds a character that is not hexadecimal
- **WHEN** the command reads each
- **THEN** each exits 1 naming the field, and writes no file

#### Scenario: Edge case — a draft is pinned

- **GIVEN** an open GitHub pull request whose `isDraft` is true
- **WHEN** the command reads its document
- **THEN** it exits 0 and the target's `draft` is true

### Requirement: `interlock review target` SHALL refuse an input that is not a document

The command SHALL exit 1, print nothing on standard output and write no file when its input is empty or is not a JSON document, and standard error SHALL say the platform's CLI printed no document. That is what the command reads when `gh` or `glab` failed in front of the pipe. The rules that pin a pull request and refuse one SHALL live in `lib/review-target.mjs`, which SHALL import no module.

#### Scenario: Failure — the platform's CLI printed no document

- **GIVEN** standard input with nothing on it, as when `gh pr view` or `glab mr view` failed in front of the pipe
- **WHEN** `interlock review target --github -` reads it, and `interlock review target --gitlab -` likewise
- **THEN** each exits 1 with nothing on standard output, and standard error says the platform's CLI printed no document
- **AND** no target file is written

#### Scenario: Edge case — text that is not JSON

- **GIVEN** a file holding an error message and no JSON
- **WHEN** `interlock review target --github <file>` reads it
- **THEN** it exits 1 with the same reason, and writes no file

### Requirement: `--target` SHALL bind the review's commands to the pinned pull request

Given `--target <file>`, `interlock review`, `interlock review brief` (dimension and skeptic prompts alike) and `interlock domain-context` SHALL read the code from the target's worktree, diff the target's base commit against its head commit, and bind what they write to that head. They SHALL exit 1 when the worktree's own head is not the target's, when the file is not a target, and when `--base`, `--head` or `--root` is given beside it. Without `--target` they SHALL behave as before.

#### Scenario: Happy path — a record bound to the platform's head

- **GIVEN** a target and its worktree, created by the target's own commands
- **WHEN** `interlock review --target <file> --findings <f> --verdicts <f> --changed <files> --dimensions <record> --out <file> --json` runs from the person's own tree
- **THEN** the record's `head` is the target's `head.sha`
- **AND** the proof is judged against the files the target's base and head differ in

#### Scenario: Failure — the worktree is not at the pinned head

- **GIVEN** a target whose worktree now sits on another commit
- **WHEN** `interlock review brief --dimension regression --target <file>` runs
- **THEN** it exits 1 with nothing on standard output, and standard error names the worktree's commit and the target's

#### Scenario: Failure — a target file whose git argv was edited

- **GIVEN** a target file whose `commands.fetch` was changed by hand to another `git` argv, or whose `worktree` holds a `..` segment
- **WHEN** `interlock review brief --dimension regression --target <file>` runs
- **THEN** it exits 1 with nothing on standard output, and standard error says the file is not a review target and names the field

#### Scenario: Failure — a base given beside the target

- **GIVEN** a valid target
- **WHEN** `interlock review brief --dimension regression --target <file> --base origin/main` runs
- **THEN** it exits 1 naming `--base` and saying the target supplies it

#### Scenario: Failure — a head given beside the target

- **GIVEN** a valid target and its worktree
- **WHEN** `interlock review --target <file> --head <a commit id>` runs with its other flags and `--out <file>`
- **THEN** it exits 1 naming `--head` and saying the target supplies it, and writes no record

#### Scenario: Failure — a root given beside the target

- **GIVEN** a valid target and its worktree
- **WHEN** `interlock review brief --dimension regression --target <file> --root <a directory>` runs, and `interlock domain-context --target <file> --changed <files> --root <a directory>` likewise
- **THEN** each exits 1 with nothing on standard output, naming `--root` and saying the target supplies it

#### Scenario: Happy path — the domain context is read for the pinned commits

- **GIVEN** a target and its worktree, and a living spec in force over a file the pull request changes
- **WHEN** `interlock domain-context --target <file> --changed <files> --json` runs from the person's own tree
- **THEN** the requirements it selects are read at the target's base commit, for the changed files it was given

#### Scenario: Failure — the worktree does not exist

- **GIVEN** a target whose worktree was never created
- **WHEN** `interlock review --target <file>` runs with its other flags
- **THEN** it exits 1 naming the worktree path, and writes no record

#### Scenario: Edge case — nothing moves without the flag

- **GIVEN** a diff against `origin/main` and no `--target`
- **WHEN** `interlock review brief --dimension regression --base origin/main --changed <files>` runs before and after this change
- **THEN** the two outputs are the same byte for byte

### Requirement: The review skill SHALL review a named pull request in a detached worktree at the pinned head

With `--pr <ref>` the review skill SHALL read the pull request with the platform's CLI, pipe that document to `interlock review target`, run the target's fetch and worktree commands as printed, and pass `--target` to every command that reads the code under review. It SHALL NOT switch, stash, reset or commit in the person's working tree, SHALL NOT require that tree to be clean, and SHALL create no branch.

#### Scenario: Happy path — reviewed without touching the person's tree

- **GIVEN** a working tree on another branch with uncommitted edits, and an open pull request in the same repository
- **WHEN** `/interlock:review-code --pr 44` runs
- **THEN** every reviewer is given a prompt printed under `--target`, and the record's `head` is the head the platform named
- **AND** afterwards the person's branch, index and uncommitted edits are what they were

#### Scenario: Edge case — which lines carry the target

- **GIVEN** the section of the review skill that describes `--pr`
- **WHEN** its fenced `interlock` lines are read
- **THEN** every `interlock review brief` line, every `interlock review` line that writes a draft or the record, the `interlock domain-context` line and the `interlock review comment` line carry `--target`
- **AND** no `interlock review proof` line and no `interlock gate` line carries it, and no line of the section carries `--base`, `--head` or `--carry`

#### Scenario: Failure — the target is refused

- **GIVEN** a pull request from a fork
- **WHEN** the skill runs with `--pr`
- **THEN** it prints `PULL REQUEST NOT REVIEWED:` with the reason `interlock review target` gave
- **AND** it fetches nothing, creates no worktree and spawns no reviewer

#### Scenario: Failure — the worktree cannot be created

- **GIVEN** a valid target, in a session whose sandbox refuses the write a new worktree needs
- **WHEN** the skill runs the target's worktree command
- **THEN** it prints `REVIEW WORKTREE NOT CREATED:` with git's message, and names one run of the same command outside the sandbox
- **AND** it spawns no reviewer until the worktree exists

#### Scenario: Edge case — flags that do not combine

- **GIVEN** `--pr 44 --base origin/main`, then `--pr 44 --carry earlier.json`, then `--post` with no `--pr`, then `--run-code` with no `--pr`
- **WHEN** the skill reads each set of arguments
- **THEN** it names the flag that does not apply and stops, having reviewed nothing

### Requirement: On the pull-request path the skill SHALL scope the review from the worktree, never from the person's own tree

With `--pr` the skill SHALL take the changed files from the target's own command, run in the worktree, and SHALL run none of the commands that scope the author's own diff: it SHALL NOT diff the person's working tree, stop because that tree's own diff is empty, read a change's artifacts from that tree, or update that tree's codebase graph. When the pull request changes no file it SHALL print `PULL REQUEST NOT REVIEWED: no changed files` and spawn no reviewer.

#### Scenario: Happy path — a tree with nothing committed past its base is still reviewed

- **GIVEN** a working tree whose own branch holds no commit its base lacks, and an open pull request that changes three files
- **WHEN** `/interlock:review-code --pr 44` runs
- **THEN** the changed files are the three the target's `commands.changed` printed in the worktree, and the reviewers are spawned
- **AND** the skill ran no diff of the person's own tree and did not stop for an empty one

#### Scenario: Happy path — a named change is read from the pull request

- **GIVEN** `/interlock:review-code add-export --pr 44`, where the pull request's head carries the OpenSpec change `add-export` and the person's own tree does not
- **WHEN** the skill reads the change's artifacts
- **THEN** it reads them under the review worktree
- **AND** `interlock review brief --dimension technical-lead --target <file> --change add-export --changed <files>` exits 0 and lists that change's artifacts

#### Scenario: Edge case — the author's scoping commands are absent from the section

- **GIVEN** the section of the review skill that describes `--pr`, and the section that scopes the author's own diff
- **WHEN** their fenced command lines are read
- **THEN** no command line of the `--pr` section holds `main...HEAD`, begins `interlock changes` or carries `--update`
- **AND** the author's scoping section sends a `--pr` reader to the `--pr` section above its own first command

#### Scenario: Failure — a pull request that changes no file

- **GIVEN** a pinned pull request whose head adds nothing to its base
- **WHEN** the target's `commands.changed` prints no file
- **THEN** the skill prints `PULL REQUEST NOT REVIEWED: no changed files`, spawns no reviewer and removes the worktree

### Requirement: The skill SHALL say why a pull request could not be read, and SHALL review nothing

With `--pr`, when the platform's CLI is missing, is not signed in or cannot read the pull request, or when the target's fetch command fails, the skill SHALL print `PULL REQUEST NOT REVIEWED:` with that command's own message. It SHALL then create no worktree, spawn no reviewer and post nothing.

#### Scenario: Failure — the platform cannot read the pull request

- **GIVEN** a `--pr` reference the platform's CLI cannot read: no pull request by that number, a sign-in that lapsed, no access, or no network
- **WHEN** the skill runs the line that pins the pull request
- **THEN** it prints `PULL REQUEST NOT REVIEWED:` with the platform CLI's own message
- **AND** it fetches nothing, creates no worktree, spawns no reviewer and posts nothing, with or without `--post`

#### Scenario: Failure — the commits cannot be fetched

- **GIVEN** a valid target, in a session where the target's fetch command exits non-zero
- **WHEN** the skill runs it
- **THEN** it prints `PULL REQUEST NOT REVIEWED:` with git's message, creates no worktree and spawns no reviewer

#### Scenario: Edge case — the platform's CLI is not signed in

- **GIVEN** a session where `gh auth status` exits non-zero
- **WHEN** the skill runs with `--pr` on a GitHub repository
- **THEN** it prints `PULL REQUEST NOT REVIEWED:` with that command's message, and runs no line that pins the pull request

### Requirement: The skill SHALL remove the review worktree however the review ends

Once the worktree exists, the skill SHALL run the target's remove command when the review ends: after the report, after a `REVIEW FAILED:` line, and after any line that stops the review early. When the removal fails it SHALL print `REVIEW WORKTREE LEFT: <path>` with the command that removes it. The session directory, with the record and the comment, SHALL stay.

#### Scenario: Happy path — removed after the report

- **GIVEN** a review under `--pr` that reached its report
- **WHEN** the skill ends
- **THEN** the worktree path no longer exists and `git worktree list` no longer names it
- **AND** the record and the comment are still in the session directory

#### Scenario: Failure — a review that could not spawn its reviewers

- **GIVEN** a session whose host does not have the `interlock:reviewer` type
- **WHEN** the skill prints `REVIEW FAILED: reviewer type unavailable`
- **THEN** it removes the worktree and posts nothing, with or without `--post`

#### Scenario: Edge case — the removal is refused

- **GIVEN** a removal that git or the sandbox refuses
- **WHEN** the skill runs the target's remove command
- **THEN** it prints `REVIEW WORKTREE LEFT:` with the path and the command, and still reports the review

#### Scenario: Edge case — a worktree left by an interrupted run

- **GIVEN** a worktree at the target's path, left by an earlier run on the same head
- **WHEN** the target's worktree command fails because the path is already a worktree
- **THEN** the skill runs the target's remove command and the worktree command again, one time, and reviews in the new worktree

### Requirement: On the pull-request path the skill SHALL write nothing to the platform except one comment under `--post`

With `--pr` the skill SHALL NOT push, commit, edit a file under review, apply or create a label, edit the description, mark a draft ready, approve, request changes, resolve a thread or merge. With `--post` it SHALL post one comment, the text `interlock review comment` rendered, and nothing else. Without `--post` it SHALL print that comment, print `NOT POSTED:`, and send nothing. The skill SHALL never add `--post` itself.

#### Scenario: Happy path — printed and not posted

- **GIVEN** a finished review under `--pr` with no `--post`
- **WHEN** the skill reports
- **THEN** it prints the comment `interlock review comment` rendered, the path of the file holding it, and a `NOT POSTED:` line naming `--post`
- **AND** it runs no command that writes to the platform

#### Scenario: Happy path — one comment under `--post`

- **GIVEN** a finished review under `--pr --post` on a GitHub pull request
- **WHEN** the skill posts
- **THEN** it runs one `gh pr comment <number> --body-file <the comment file>` and no other command that writes to the platform
- **AND** the posted text is the file's text, with nothing added

#### Scenario: Failure — the comment could not be rendered

- **GIVEN** `--pr --post` and an `interlock review comment` that exits non-zero
- **WHEN** the skill reaches the posting step
- **THEN** it prints `COMMENT NOT RENDERED:` with the reason from standard error and posts nothing

#### Scenario: Edge case — the skill suite catches a write verb

- **GIVEN** a `--pr` section edited to carry `gh pr review`, `gh pr merge`, `gh pr edit`, `gh pr ready`, `gh label`, `git push`, `git commit`, `glab mr approve`, `glab mr update` or `glab mr merge`
- **WHEN** the skill suite runs
- **THEN** a test fails naming the verb
- **AND** a test fails when the skill's `allowed-tools` grants a `gh` or `glab` pattern other than the view, the comment, the creation of a note, the pipeline read and the auth status

### Requirement: Under `--post` the skill SHALL post the comment file itself, as a plain comment

On either platform the posted comment SHALL be the file `interlock review comment` wrote, handed to the platform's CLI as a file or on standard input, with its text in no argument of the command. On GitLab the comment SHALL be a note that opens no resolvable thread, so it holds back no merge.

#### Scenario: Happy path — a GitLab comment is the file, as a plain note

- **GIVEN** a finished review under `--pr --post` on a GitLab pull request
- **WHEN** the skill posts
- **THEN** it runs one `glab mr note create <iid> --resolvable=false` with the comment file on standard input, and no other command that writes to the platform
- **AND** the comment's text is in no argument of that command

#### Scenario: Edge case — the skill suite catches a comment passed as an argument

- **GIVEN** a `--pr` section edited so a post line carries `--message` or a command substitution
- **WHEN** the skill suite runs
- **THEN** a test fails naming the line

### Requirement: A post the platform rejects SHALL be reported and SHALL NOT be retried

With `--pr --post`, when the post command exits non-zero the skill SHALL print `POST FAILED: <reason>` with the path of the comment file. It SHALL NOT run the command again and SHALL NOT send the comment another way, because it cannot tell whether the platform took the comment.

#### Scenario: Failure — the platform rejects the comment

- **GIVEN** `--pr --post` and a post command that exits non-zero
- **WHEN** the skill posts
- **THEN** it prints `POST FAILED:` with the platform CLI's message and the path of the comment file, and prints no `NOT POSTED:` line
- **AND** it runs no second post command and no other command that writes to the platform
- **AND** it removes the worktree

#### Scenario: Edge case — a glab without the note leaf

- **GIVEN** `--pr --post` on a GitLab pull request, with a glab that has no `glab mr note create`
- **WHEN** the post command exits non-zero
- **THEN** the skill prints `POST FAILED:` with glab's message and the path of the comment file, and falls back to no other form of the command

### Requirement: On the pull-request path the skill SHALL record no outcome against this repository's own loop

With `--pr` the skill SHALL run no `interlock autonomy record` and no `interlock note derive`: a finding on a colleague's change is not evidence about this repository's ship loop. It SHALL pass `--metrics <change>` only when the person named a change, and otherwise SHALL print `REVIEW METRICS NOT RECORDED: no change named`.

#### Scenario: Happy path — a blocker leaves the ladder alone

- **GIVEN** a review under `--pr` whose gate reports one surviving blocker
- **WHEN** the skill finishes
- **THEN** it has run no `interlock autonomy record` and no `interlock note derive`
- **AND** the autonomy ledger and `docs/notes/compound.md` are what they were

#### Scenario: Edge case — a named change

- **GIVEN** `/interlock:review-code add-export --pr 44`, where the pull request carries the OpenSpec change `add-export`
- **WHEN** the review is promoted
- **THEN** the promote line carries `--metrics add-export`
- **AND** the metrics file is written under the person's own tree, not inside the review worktree

#### Scenario: Edge case — no change named

- **GIVEN** `/interlock:review-code --pr 44`
- **WHEN** the review is promoted
- **THEN** the promote line carries no `--metrics`, and the skill prints `REVIEW METRICS NOT RECORDED: no change named`

### Requirement: `interlock review comment` SHALL render the comment a colleague reads

`interlock review comment --review <record> --target <file> [--out <file>]` SHALL print one Markdown comment for a record bound to the target's head: the surviving findings under reader-facing weights, with the stable ids and the inert reviewer text of `interlock settle comment`, the proof line, a line saying whether reviewers were allowed to run code, and a closing line saying it is an automated review and not an approval. It SHALL exit 1 and write nothing for a record of another head.

#### Scenario: Happy path — three severities, two weights

- **GIVEN** a record at the target's head with a surviving blocker, a surviving warning and a surviving suggestion, none marked pre-existing, and a proof that holds
- **WHEN** the command runs
- **THEN** the comment opens `## Automated review — <head sha>`, the blocker and the warning are listed under the weight `Important` with the blocker first, and the suggestion is listed under `Nit` inside one `<details>` block headed by its count
- **AND** it holds the coverage line, the line `Reviewers read the code and ran none of it.`, and ends with `This is an automated review, not an approval. A person decides whether this merges.`
- **AND** with `--json` each finding carries its stored `severity` and its `weight`

#### Scenario: Happy path — nothing survived

- **GIVEN** a proven record at the target's head with no surviving finding
- **WHEN** the command runs
- **THEN** it prints one paragraph saying the review raised no surviving finding, with the coverage line, the run line and the closing line

#### Scenario: Failure — a record of another head

- **GIVEN** a record whose `head` is not the target's `head.sha`, and `--out comment.md`
- **WHEN** the command runs
- **THEN** it exits 1 with nothing on standard output, standard error names both commits, and `comment.md` is not written

#### Scenario: Edge case — an unproven review says so

- **GIVEN** a record whose proof does not hold
- **WHEN** the command runs
- **THEN** the comment carries `REVIEW NOT PROVEN:` with the gaps where the coverage line would be

#### Scenario: Edge case — reviewer text cannot act as markup

- **GIVEN** a surviving finding whose title holds `@someone`, a table pipe and a run of three backticks
- **WHEN** the command runs
- **THEN** the title is rendered inert, as `interlock settle comment` renders it: it mentions nobody, opens no table cell and closes no fence

#### Scenario: Edge case — no word of the author's loop

- **GIVEN** any record
- **WHEN** the command runs
- **THEN** outside reviewer text the comment holds no stored severity name, no gate word, no verdict, no score and no label name

#### Scenario: Edge case — a severity the CLI does not recognise reads as important

- **GIVEN** a surviving finding whose stored severity is a value the CLI does not recognise
- **WHEN** the command runs
- **THEN** the finding is listed under `Important`, and with `--json` it carries the stored value as its `severity`

#### Scenario: Edge case — a target that allowed running code says so

- **GIVEN** a target whose `runCode` is true
- **WHEN** the command runs
- **THEN** the run line reads `Reviewers were allowed to run a single test file and the repository's own CLI.`

### Requirement: A finding SHALL read `Pre-existing` only when its reviewer marked it and the CLI finds its line outside the diff

A dimension reviewer MAY mark a finding `preExisting: true`, and `interlock review` SHALL keep that mark on the surviving finding. `interlock review comment` SHALL give a finding the weight `Pre-existing` only when it is marked, has a file and a line, and that line is outside every changed range of the target's base-to-head diff. A mark the command cannot confirm SHALL be refused and counted in the output, and the finding SHALL read by its severity.

#### Scenario: Happy path — marked, and off the diff

- **GIVEN** a surviving warning marked `preExisting: true` at `lib/a.mjs:210`, where the diff changes `lib/a.mjs` only in lines 12 to 40
- **WHEN** `interlock review comment` runs
- **THEN** the finding is listed under the weight `Pre-existing`, after the `Important` findings and outside the collapsed block

#### Scenario: Failure — marked, but on a changed line

- **GIVEN** a surviving warning marked `preExisting: true` at `lib/a.mjs:20`, a line the diff changes
- **WHEN** the command runs
- **THEN** the finding is listed under `Important`
- **AND** standard error says one pre-existing mark was refused, and under `--json` the finding's id is listed in `preExistingRefused`

#### Scenario: Edge case — unmarked and off the diff stays the author's

- **GIVEN** a surviving warning with no mark, on a file the diff does not touch, saying a caller still passes the argument the change removed
- **WHEN** the command runs
- **THEN** the finding is listed under `Important`

#### Scenario: Edge case — a mark with no line

- **GIVEN** a surviving warning marked `preExisting: true` that names a file and no line
- **WHEN** the command runs
- **THEN** the mark is refused and the finding is listed under `Important`

#### Scenario: Edge case — two findings of one identity that disagree

- **GIVEN** a record whose surviving findings hold the same finding from two dimensions, one marked `preExisting: true` and one not, both on a line the diff does not change
- **WHEN** `interlock review comment` lists them as one finding under the shared finding identity
- **THEN** that finding is listed under the weight its severity gives, not under `Pre-existing`

#### Scenario: Edge case — a mark that is not a boolean

- **GIVEN** a dimension answer whose finding carries `preExisting: "yes"`
- **WHEN** `interlock review` records it
- **THEN** the surviving finding carries no mark, and the finding itself is kept
- **AND** the record lists the finding under `anomalies.preExistingShape`

#### Scenario: Edge case — the diff cannot be read

- **GIVEN** a target whose base commit git can no longer find
- **WHEN** `interlock review comment` runs
- **THEN** no finding is listed under `Pre-existing`, standard error carries `PRE-EXISTING NOT CHECKED:` with git's reason, and the comment is still printed

### Requirement: The pre-existing check SHALL read a diff the person's git configuration cannot reshape

`interlock review comment` SHALL diff the target's base and head with no external diff or textconv driver, no relative mode and the `a/` and `b/` prefixes, whatever the person's git configuration says. When the diff names a file git does not list as changed for the same range, the command SHALL confirm no mark and SHALL say `PRE-EXISTING NOT CHECKED:` on standard error.

#### Scenario: Edge case — a configured prefix or an external diff driver

- **GIVEN** a blocker marked `preExisting: true` on a line the pull request changes, and the person's git configuration sets `diff.srcPrefix` and `diff.dstPrefix`, `diff.noprefix`, `diff.relative` or `diff.external`
- **WHEN** `interlock review comment` runs
- **THEN** the mark is refused and the finding is listed under `Important`, as it is with no such configuration

### Requirement: A pre-existing mark SHALL be refused unless its file and line exist at the head and the change did not touch them

`interlock review comment` SHALL refuse a mark whose file cannot be placed inside the repository once the review worktree's or the person's tree's prefix is dropped, whose file git lists as changed and the diff gave no lines for, whose file the pull request deletes, whose line is below 1 or borders lines the pull request removes, or whose file or line the head does not hold.

#### Scenario: Failure — the worktree's absolute path on a changed line

- **GIVEN** a warning marked `preExisting: true` at `<worktree>/lib/a.mjs:20`, or at `lib//a.mjs:20`, where the diff changes `lib/a.mjs` in line 20
- **WHEN** the command runs
- **THEN** the mark is refused and the finding is listed under `Important`

#### Scenario: Failure — a file or a line the head does not have

- **GIVEN** a warning marked `preExisting: true` on a file the diff does not touch, at a line past that file's end at the head, and another on a file the head does not hold
- **WHEN** the command runs
- **THEN** both marks are refused, each with its reason on standard error

#### Scenario: Failure — a deleted file and a removal's edge

- **GIVEN** a warning marked `preExisting: true` on a file the pull request deletes, and another on the line just after lines the pull request removes
- **WHEN** the command runs
- **THEN** both marks are refused

### Requirement: The comment SHALL name no path on the person's machine and SHALL fit its published bound

`interlock review comment` SHALL name every file relative to the repository, replacing the review worktree's path and the person's tree's path wherever reviewer text holds them. The comment SHALL fit `maxReviewerCommentChars`, published by `interlock limits`: over it, the nits' bodies go first, then the nits' rows, then the leading findings' bodies, and a `CUT:` line says what went. The rows of `Important` and `Pre-existing` findings are never cut.

#### Scenario: Edge case — a finding written under the worktree's absolute path

- **GIVEN** a finding whose file, title and description name `<worktree>/lib/a.mjs` and the person's own tree
- **WHEN** the command runs
- **THEN** the comment reads `lib/a.mjs` and holds neither absolute path, and the finding keeps the id the record gives it

#### Scenario: Edge case — a review too long for one comment

- **GIVEN** a record of a hundred findings with 400-character descriptions
- **WHEN** the command runs
- **THEN** the comment is no longer than `maxReviewerCommentChars`, every `Important` row is listed, and a `CUT:` line before the proof paragraph names what was left out

### Requirement: A pre-existing mark SHALL change the weight of a blocker or a warning only

`interlock review comment` SHALL give the weight `Pre-existing` to no finding whose stored severity is not `blocker` or `warning`. A marked finding of any other severity SHALL read by its severity, and its mark SHALL NOT be counted as refused when its line is outside the diff. `lib/review-comment.mjs` SHALL hold the rule and render the comment, with the reader-text parts `lib/comment-parts.mjs` shares with `interlock settle comment`.

#### Scenario: Edge case — a marked suggestion stays a nit

- **GIVEN** a surviving suggestion marked `preExisting: true` on a line the diff does not change
- **WHEN** `interlock review comment` runs
- **THEN** the finding is listed under `Nit`, inside the collapsed block

#### Scenario: Edge case — a marked finding of an unrecognised severity stays important

- **GIVEN** a surviving finding whose stored severity is a value the CLI does not recognise, marked `preExisting: true` on a line the diff does not change
- **WHEN** `interlock review comment` runs
- **THEN** the finding is listed under `Important`, not under `Pre-existing`
- **AND** under `--json` its id is not listed in `preExistingRefused`

### Requirement: The skill SHALL read the platform's checks and SHALL run none of the pull request's code itself

With `--pr` the skill SHALL pipe the platform's check document to `interlock pipeline` and print the summary it prints for the pinned head. A refusal SHALL be printed as `CHECKS NOT READ: <reason>` and SHALL NOT stop the review. The skill SHALL run no test, build, lint or script of the pull request. `--run-code` SHALL change only what the reviewers' prompts allow, SHALL be passed to `interlock review target`, and SHALL never be added by the skill.

#### Scenario: Happy path — checks read, nothing run

- **GIVEN** a GitHub pull request with three finished checks, whose head is still the pinned one
- **WHEN** the skill runs with `--pr`
- **THEN** it prints the summary `interlock pipeline --github -` printed, whose commit is the target's `head.sha`
- **AND** it runs no command from the pull request's own scripts, test profile or build

#### Scenario: Failure — the check document is refused

- **GIVEN** a check document `interlock pipeline` does not recognise, or a platform CLI that printed none
- **WHEN** the skill reads the checks
- **THEN** it prints `CHECKS NOT READ:` with the reason and goes on to review

#### Scenario: Edge case — `--run-code`

- **GIVEN** `/interlock:review-code --pr 44 --run-code`
- **WHEN** the skill pins the pull request
- **THEN** it passes `--run-code` to `interlock review target`, and still runs no test or build itself

### Requirement: The skill SHALL print a check summary only for the pinned head

With `--pr` the skill SHALL print the summary `interlock pipeline` prints only when the commit that summary names is the target's head. When it names another commit, the skill SHALL print `CHECKS NOT READ:` naming both commits in place of the summary, and SHALL go on to review the pinned head.

#### Scenario: Failure — the checks are for another commit

- **GIVEN** a pull request that received a push after it was pinned, so the summary `interlock pipeline` prints names a commit that is not the target's `head.sha`
- **WHEN** the skill reads the checks
- **THEN** it prints `CHECKS NOT READ:` naming both commits, and does not print that summary as the reviewed head's checks
- **AND** it goes on to review the pinned head, and the comment still names that head

#### Scenario: Edge case — the skill suite catches a summary printed unchecked

- **GIVEN** a `--pr` section edited so the step that reads the checks no longer names the target's `head.sha`
- **WHEN** the skill suite runs
- **THEN** a test fails naming the step

### Requirement: The skill SHALL give the blast-radius dimension a graph of the pull request's head, or skip it aloud

With `--pr`, when the person's own tree holds a codebase graph, the skill SHALL build one inside the review worktree before it selects dimensions, so `blast-radius` reads the pull request's head. When the person's tree holds none, or the build fails, it SHALL run no `blast-radius` reviewer, print the `BLAST RADIUS SKIPPED` line with the reason, and record the skip in the dimension record.

#### Scenario: Happy path — a graph built in the worktree

- **GIVEN** a person's tree with `.claude/graph/graph.json`, and a review under `--pr`
- **WHEN** the skill prepares the review
- **THEN** it runs `interlock-graph build` on the worktree, and the `blast-radius` reviewer is briefed
- **AND** nothing under the person's own `.claude/graph/` is written

#### Scenario: Failure — the build fails

- **GIVEN** a graph build on the worktree that exits non-zero
- **WHEN** the skill prepares the review
- **THEN** it prints `BLAST RADIUS SKIPPED:` with the build's first line, runs the other dimensions, and writes the skip under `skipped` in the dimension record

#### Scenario: Edge case — the person keeps no graph

- **GIVEN** a person's tree with no `.claude/graph/graph.json`
- **WHEN** the skill prepares the review
- **THEN** it builds nothing and prints `BLAST RADIUS SKIPPED: no graph at .claude/graph/graph.json — run /interlock:graph`

### Requirement: The documentation SHALL say what the path does, what it never does and what was exercised

A docs page SHALL describe `--pr`, `--post` and `--run-code`, list what the path never does and say what holds that list, state the reader-facing weights and the `Pre-existing` rule, and say that fork pull requests are refused. A platform line of the skill's `--pr` section that has not run against a real pull request SHALL sit in a block marked `not exercised`, and the page SHALL say which platform's lines have run.

#### Scenario: Happy path — the page names the flags and the limits

- **GIVEN** the shipped docs
- **WHEN** the page on reviewing a teammate's pull request is read
- **THEN** it names `--pr`, `--post` and `--run-code`, the three weights, and the things the path never does
- **AND** it says which platform's lines have run against a real pull request, and that the GitLab lines are written from documentation
- **AND** it says a review that ran no code can read `REVIEW NOT PROVEN`, and names `--run-code` as the remedy
- **AND** it says the list of things the path never does is held by the skill's instructions, its tests and the prompts, and that neither the skill's `allowed-tools` nor the reviewer type takes the shell away
- **AND** it says what `POST FAILED` means, and that the comment file it names can be posted by hand

#### Scenario: Failure — the skill suite catches an unmarked platform line

- **GIVEN** a `--pr` section edited so a `glab` line that never ran sits in a block without `not exercised`
- **WHEN** the skill suite runs
- **THEN** a test fails naming the line

#### Scenario: Edge case — nothing has run yet

- **GIVEN** the `--pr` section as this change ships it, before any run against a real pull request
- **WHEN** the skill suite runs
- **THEN** every `gh` line and every `glab` line of the section sits in a block marked `not exercised`
