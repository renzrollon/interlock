# Design

## Context

See `proposal.md` for the motivation. The facts that shape the approach:

- **Every review scope is `<base>...HEAD` of one root.** `interlock review brief` and `interlock review` diff the root's own `HEAD` against a base (`lib/review-cli.mjs:299, 312-315`). The root defaults to the directory the command runs in.
- **The CLI never calls a platform.** `interlock pipeline` reads a document the skill piped in, and a package test fails on any shipped network API (`test/spine/package.test.mjs:1458`).
- **Prompts are printed by the CLI and relayed whole.** The skill adds nothing to a reviewer's prompt (`openspec/specs/review/review-briefs/spec.md:103`). A prompt names no root today (`lib/prompts/review-dimension.mjs:200-213`), because the reviewer starts in the tree it reviews.
- **Reviewers are already bounded.** Every dimension reviewer and skeptic is `interlock:reviewer`, which holds no tool that edits a file, spawns an agent or invokes a skill (`agents/reviewer.md`). It keeps the shell.
- **The graph and the review context are ignored files** (`.gitignore:19`), so a new worktree has neither.
- **`cli/interlock` is about 3 KB under its size pin** (`test/spine/package.test.mjs:392-407`; 242,655 bytes on 2026-11-23).

## Goals / Non-Goals

**Goals:**

- One review engine for both use cases. The pull-request path differs from the author's path in where the code is read from, what the prompts allow, and what is done with the result. It does not differ in rubrics, skeptics, survival, proof or the quality band.
- The skill types no commit id and no ref. Each comes from a file the CLI wrote from the platform's document, and the one path the skill copies out of that file is the worktree's.
- Every write the author's loop makes is absent from this path, and its absence is pinned by tests.

**Non-Goals:**

- No inline review threads (D9).
- No reading of the existing discussion, and no guard against a second comment on the same head (D20).
- No fork pull requests in the first cut (D10).
- No local run of a test suite, build or lint by the skill (D21). That belongs to the `let-tooling-own-the-small-checks` brief.
- No change to `/interlock:settle`, the merge verdict, the gate or the ship loop's review step.
- No new agent type (D23).

## Decisions

### The surface (D1)

`--pr <ref>` on `/interlock:review-code`, with `--post` and `--run-code` beside it. The skill gains one `--pr` section. Under `--pr` that section takes the place of §1 whole (D32): none of §1's commands runs, because each one reads or writes the person's own tree. §2 to §5 are followed for what to spawn, what to collect and what to report, and their `interlock` lines are run as the new section spells them (D31).

The owner chose the flag on 2026-11-23 (D1). The alternative was a new skill: the `--pr` section in its own `SKILL.md` with its own narrow `allowed-tools`, leaving this skill's grants alone, at the cost of a second copy of the review instructions to keep in step.

Alternative considered and rejected: a flag on `/interlock:settle`. One skill would hold two opposite contracts, and a mistake in one flag would push to a colleague's branch.

### The target file is the contract (D7, D11, D12, D26)

`interlock review target` reads the platform's document from a file or from standard input and writes one file. Every later step reads that file:

- The skill runs the `git` argv it prints, so the fetch refs, the worktree path and the commits are typed by nobody (D7).
- `interlock review brief`, `interlock review` and `interlock domain-context` take `--target <file>` and derive the root (the worktree), the base and the head from it (D11). Passing `--base`, `--head` or `--root` beside it is an error, so two sources can never disagree. Each call checks that the worktree's own head is the pinned head, which makes a record of the wrong commit impossible rather than unlikely.
- `interlock review comment` takes the same file and refuses a record of another head.

The command is offline (D12): the skill runs `gh` or `glab` and pipes the document in, the way `interlock pipeline` is fed. That keeps the package's no-network pin true and keeps credentials out of the CLI.

Field mapping:

| Target field | GitHub (`gh pr view <ref> --json …`) | GitLab (`glab mr view <ref> --output json`) |
|---|---|---|
| `number` | `number` | `iid` |
| `url` | `url` | `web_url` |
| open | `state` is `OPEN` | `state` is `opened` |
| `draft` | `isDraft` | `draft` |
| fork | `isCrossRepository` | `source_project_id` differs from `target_project_id` |
| `base.ref`, `base.sha` | `baseRefName`, `baseRefOid` | `target_branch`, `diff_refs.base_sha` |
| `head.ref`, `head.sha` | `headRefName`, `headRefOid` | `source_branch`, `sha` |
| head ref to fetch | `refs/pull/<number>/head` | `refs/merge-requests/<iid>/head` |

For GitLab the base is `diff_refs.base_sha` (D26), the commit GitLab's own diff starts from. GitLab fills `diff_refs` shortly after a pull request is created; a document where it is still empty is refused with a line saying so.

The fetch names full refs (`refs/heads/<base.ref>`, `refs/pull/<number>/head`), so a branch name can never be read as an option. Commit ids are checked to be full hexadecimal ids before they are placed in an argv. A branch name holding a colon, whitespace, a control character or `..` is refused: none of those can be in a git ref name, and a colon would turn a fetch argument into a refspec with a local destination. The commands are argv arrays, and the CLI never passes one through a shell. The skill does: it runs each as the one line `interlock review target` prints under `lines`, every word that needs it single-quoted, so a root holding a space stays one word, and a base branch holding a character a shell would read (`;`, `$`, a backtick, a pipe, a quote, a parenthesis, a brace, `&`, `<`, `>`, `!`) is refused at the pin. The changed files reach every later line on standard input from `<dir>/changed.txt` (`--changed -`), never typed into one.

When the pull request belongs to another repository than `origin` (a URL pasted into the wrong clone), the fetch brings other commits, the pinned head is not among them, and the worktree command fails. That failure is printed. No separate repository check is added.

### What is refused (D10, D19)

`interlock review target` exits 1 and writes nothing for: a fork (D10), a pull request that is not open (D19), a commit id that is not a full hexadecimal id, a branch name that cannot be a git ref name, and a document missing any field it reads. An absent fork field is refused, never read as "same repository". A draft is reviewed, and the target records `draft: true`.

The owner chose to refuse forks in the first cut on 2026-11-23 (D10). A later change that reviews them needs little: both platforms already serve a fork's head under the pull request ref the fetch names. It should refuse `--run-code` for a fork, since that code is a stranger's and not a colleague's.

### The worktree (D6, D22)

The review runs in a detached worktree at the pinned head, at `.claude/worktrees/review-pr-<platform>-<number>-<first 12 of the head>` under the person's working directory. The session files (target, findings, verdicts, dimension record, drafts, the record, the pipeline input, the comment) live in `.claude/ship/review-pr/<platform>-<number>-<first 12 of the head>/`. Both sit inside the working directory, so a reviewer reads them with no further grant (D22). A repository that does not ignore `.claude/worktrees/` lists that directory as untracked while a review runs; the docs page says so and gives the ignore line. The names follow the head, so a new push gives new places and a re-run on the same head reuses its own.

The person's tree is never switched, stashed, reset or required to be clean (D6). The fetch creates no local branch. It can move the remote-tracking ref of the base branch, as any fetch does.

The worktree is removed with `git worktree remove --force` on every path once it exists. `--force` is right here because the tree is the skill's own and may hold a built graph. When a worktree from an interrupted run is in the way, the skill runs the target's remove command and then the add again, one time.

Alternative considered: export the head's tree with `git archive` into a plain directory. Rejected: every scope command diffs a git root, so each would need a second code path.

### How a reviewer finds the code (D13, D23)

A reviewer agent starts in the person's own tree, which is another commit. Under `--target` the CLI prints a `REVIEW ROOT` paragraph into every dimension and skeptic prompt: the worktree's absolute path, that every path in the prompt is relative to it, that `git` runs as `git -C <root>` and graph queries with `--root <root>`, and that the directory the agent starts in is not the code under review. The paths in findings and ledgers stay repository-relative, so the proof, the finding identity and the comment need no change.

The paragraph is never a prompt's first line (D29). In a dimension prompt it sits inside the scope block, after the rubric. In a skeptic prompt it follows the skeptic's opening brief and comes before the findings. Each prompt's first line is what it is without a target: the settle meter attributes a reviewer spawn by the `# Dimension:` line (`lib/settle-meter.mjs:1178-1196`), and the living spec has each skeptic prompt open with its published first sentence.

No new agent type is needed (D23): `interlock:reviewer` is already the read-only type every reader of the review loop runs as.

### Running the pull request's code (D4, D21, D24)

The run line reviewers get today allows "a single test file, and the repository's own CLI" (`lib/prompts/review-dimension.mjs:108`). On a colleague's pull request that is someone else's code, run outside any sandbox the plugin controls. So a target carries `runCode`, false unless the person passed `--run-code`, and under a target with `runCode` false the prompts carry a different line: read the code under review and run none of it; `git` and the graph's query commands are what may run. With `runCode` true the ordinary line is printed. The comment says which applied.

`--run-code` changes only the prompts (D21). The skill runs no test, build or lint either way; it reads the platform's checks through `interlock pipeline`, which already exists, and prints the summary that command prints when it describes the pinned head (D35).

The rule is a prompt line, not a tool bound (D24): the reviewer type keeps the shell. The same is true of the write-nothing rule today. The docs page says so.

This requires modifying the living requirement "The prompt SHALL let the reviewer run read-only checks…", which says no prompt may tell a reviewer not to run tests. That rule exists because an orchestrating model once wrote "Do not run npm test" into a prompt by hand. The exception is narrow: the line comes from the CLI, is read from the target, and can never be written by a skill.

The owner chose off by default, with `--run-code` as the opt-in, on 2026-11-23 (D4).

**What the default does to the proof (D30).** The measure rule stays under every target: a claim about a size, a width, a count or a duration is measured and cited. A reviewer who may run nothing can still measure by reading and counting. A measurement only a run could take is recorded under `unread`, and under a target that does not allow running the code the run line tells the reviewer to give that as the reason. An `unread` entry means the proof does not hold, so the comment says `REVIEW NOT PROVEN:` and names the gap, directly above the line saying reviewers ran no code. That is the honest reading: the review did not check that claim. The docs page says a default review can read this way and that `--run-code` is the remedy.

### The graph and the review context (D14, D15, D16)

- **Graph (D14).** `interlock-graph covers` reads the root's own graph and exits 3 with none, and a graph query in a linked worktree falls back to the main tree's graph, which describes another commit. So when the person's own tree keeps a graph, the skill builds one inside the worktree with `interlock-graph build <worktree>` before it selects dimensions. Building in the person's tree is the person's call, and the skill still never does it. The worktree is the skill's own, and the person keeping a graph is their standing choice to use one. With no graph in the person's tree, or a failed build, `blast-radius` is skipped with the existing line and the skip is recorded.
- **Review context (D15).** `REVIEW_CONTEXT.md` is the reviewer's own primer. Under a target it is read from the directory the command runs in. The worktree's copy, if a repository commits one, is the pull request's and is not read.
- **Policy (D16).** `REVIEW.md` is read as the living requirement says: the enforced lists from the base commit, the prose from the tree under review, a difference reported. That requirement's rationale already weighed an author editing the prose, and this change does not reopen it.

### The comment and its weights (D2, D9, D28)

`interlock review comment` renders one top-level comment (D9). It uses the settle comment's finding identity, grouping, inert spans and fences, so text a reviewer agent wrote can mention nobody and open no markup. Those helpers are private to `lib/settle-cli.mjs` today; they are exported or moved into a module both commands import, never copied (D28). The settle comment's output must stay byte for byte what it is, which its existing tests pin.

The weights (D2):

| Stored severity | Weight |
|---|---|
| `blocker`, `warning`, or a value the CLI does not recognise | `Important` |
| `blocker` or `warning`, marked and confirmed (below) | `Pre-existing` |
| `suggestion`, marked or not | `Nit` |

A confirmed mark changes the weight of a `blocker` or a `warning` only. A marked `suggestion` stays `Nit`. A marked finding whose severity the CLI does not recognise stays `Important`: an unknown severity is read as the heavier case, and a mark does not lighten it. Neither mark is counted as refused when its line is off the diff; the table simply has no `Pre-existing` row for that severity.

Order: `Important` (blockers first), then `Pre-existing`, then the nits inside one `<details>` block headed by their count. The stored severities do not change, and `--json` carries both. The comment has no gate word, verdict, score or label: on a colleague's pull request the reviewer decides what to make of the findings.

The owner chose these weights on 2026-11-23 (D2).

### Pre-existing (D8, D27)

The brief had the CLI compute the tag from the changed ranges alone. That does not hold. The `regression` rubric says "most of what this dimension finds sits in an unchanged line or an unchanged file", `blast-radius` findings are on consumers outside the diff, and any dimension can report text the change made untrue elsewhere. Location alone would tell a colleague that each of those is not theirs.

So the tag needs both halves (D8):

1. **The reviewer marks it.** Under a target the dimension prompt tells the reviewer to set `preExisting: true` only when the defect is on a line the diff did not change and would be there without this pull request, and never on a finding about what the change breaks, leaves stale or fails to update.
2. **The CLI confirms it.** `interlock review comment` diffs the target's base against its head and accepts the mark only when the finding has a file and a line and the line is outside every changed range of that file, or the file is not in the diff. A mark it cannot confirm is refused and counted; the finding then reads by its severity.

An unmarked finding never reads `Pre-existing`, wherever it sits. When git cannot produce the diff, nothing reads `Pre-existing` and standard error says `PRE-EXISTING NOT CHECKED:`.

The mark is an optional boolean on a finding (D27). `interlock review` keeps it on the surviving finding and treats a non-boolean as it treats a malformed `specGap` (`lib/review-core.mjs:284-300`): read as absent, listed under `anomalies.preExistingShape`, the finding kept. Findings of one identity read `Pre-existing` only when every one of them is marked and confirmed.

A wrong mark costs a word and hides nothing: `Pre-existing` findings are listed in the open.

### Posting and what the path never writes (D3, D5, D20, D33, D34, D36)

The comment is written to `<dir>/comment.md` and printed. Under `--post` the skill posts that file with one command (D3); without it the skill prints `NOT POSTED:` and sends nothing. The skill never adds `--post`.

**Both platforms post the file itself (D33).** GitHub takes it with `--body-file`. GitLab takes it on standard input: `glab mr note create <iid> --resolvable=false < <dir>/comment.md`. An earlier draft posted GitLab with `glab mr note <iid> --message "$(interlock review comment …)"`. That was a second render placed in one argument, so its size limit was the operating system's and not the platform's. glab 1.102.0 also answers that form with `Flag --message has been deprecated, use glab mr note create instead`. Two things follow from the `create` leaf:

- It opens a resolvable thread unless told otherwise, and a project that requires all threads resolved holds a merge back for one. The comment carries no gate (D5), so the line passes `--resolvable=false` and posts a plain note, as `gh pr comment` does.
- glab marks the leaf experimental, and an older glab has none. Either way the post fails aloud, which is the next paragraph's case.

**A post that fails is said, and not retried (D36).** A post command that exits non-zero prints `POST FAILED:` with the platform CLI's message and the path of the comment file. The skill does not run it again and sends the comment no other way: after a failure it cannot tell whether the platform took the comment, and a second attempt could post it twice. The person posts the file by hand or runs the review again. `NOT POSTED:` keeps its one meaning, that nobody asked for a post.

Nothing else on the path writes (D5). The skill's `allowed-tools` gains only these patterns: `gh auth status`, `gh pr view`, `gh pr comment`, `glab auth status`, `glab mr view`, `glab mr note create`, `glab ci get`. A test pins that list and pins the absence of every write verb from the `--pr` section. The note pattern names the `create` leaf because current glab puts `delete`, `update`, `resolve` and `reopen` beside it under `glab mr note`.

**That list bounds what this change adds, not what the path can do (D34).** `allowed-tools` belongs to a skill and not to a flag. Under `--pr` the skill still holds the `Write` and `Bash(git *)` it holds on the author's path, and the path needs both itself: the first for the findings, verdicts and dimension record under `<dir>`, the second for the target's own `git` argv. The skill has one grant list for both paths, so the list cannot be narrower under the flag than the author's path needs. A reviewer keeps the shell (D24) and starts in the person's own tree, and `hooks/guard-commit.mjs` allows a commit when no ship run is active, by design. So a commit, a push or a platform write on this path is stopped by no tool bound. Three things stand in its way: the section's instructions, the test that fails a write verb in that section, and the write-nothing line in every prompt. What a shell command may do beyond those is for the person's own permission settings to decide. This residual is accepted, and the docs page states it. The remedy, if it proves too thin, is the separate skill D1 weighed, with its own narrow grants.

A second run with `--post` on the same head posts a second comment (D20). Reading the discussion first is not designed here.

The owner chose posting only under `--post` on 2026-11-23 (D3).

### What the path does not record (D17, D18)

No `interlock autonomy record` and no `interlock note derive` (D17): a blocker on a colleague's change must not reset this repository's own ship ladder or write into its compound notes. The gate line still runs, because the report's counts and the quality band come from it.

Metrics follow the living rule (D18): written when the person named a change, attributed to that change; otherwise not written, and the skill says `REVIEW METRICS NOT RECORDED: no change named`. Under `--target` the CLI's root is the worktree, and the state home still resolves to the person's own tree, as it does for any linked worktree.

### What was exercised (D25)

Nothing on this path has run against a live pull request. The GitHub field names were confirmed against a real document on 2026-11-23, and the GitLab field names against GitLab's API documentation. The GitLab post line was read from the help text of glab 1.102.0 on the same day and has posted nothing. Every platform line of the `--pr` section sits in a block marked `not exercised`, and the docs page says so. The first real runs are the owner's, after this ships (see Migration Plan).

## The skill's `--pr` sequence

What the new section of `skills/review-code/SKILL.md` carries, in order. `<target>` is the path `interlock review target` printed as `file`, `<dir>` its `dir`, `<worktree>` its `worktree`. `<record>` is `<dir>/review.json`, or the file the person gave with `--out`.

1. Detect the platform from `origin` and check that its CLI is signed in (`gh auth status` or `glab auth status`), as `skills/settle/SKILL.md` §1 does. A CLI that is missing or not signed in prints `PULL REQUEST NOT REVIEWED:` with its message and stops.
2. Pin: `gh pr view <ref> --json number,url,state,isDraft,isCrossRepository,baseRefName,baseRefOid,headRefName,headRefOid | interlock review target --github - [--run-code] --json`. GitLab: `glab mr view <ref> --output json | interlock review target --gitlab - [--run-code] --json`. A non-zero exit prints `PULL REQUEST NOT REVIEWED:` and stops. When the platform's CLI is what failed (no such pull request, a sign-in that lapsed, no access, no network), it printed its own message and no document. `interlock review target` then refuses the empty input, saying the platform's CLI printed no document, and the skill gives the platform CLI's message as the reason.
3. Run `commands.fetch`, then `commands.worktreeAdd`, as printed. A failed fetch prints `PULL REQUEST NOT REVIEWED:` with git's message and stops; nothing exists to remove yet. A failed add prints `REVIEW WORKTREE NOT CREATED:`. When a sandbox refused the write, that is one run of the same command outside it. When the path is already a worktree, it is the remove command and the add again, one time. A second failure stops.
4. Read the checks: `gh pr view <number> --json headRefOid,statusCheckRollup | interlock pipeline --github - --out <dir>/pipeline.json`. GitLab uses settle's two lines. The line that command prints names the commit the checks are for (D35). When it is the target's `head.sha`, print the line. When it is another commit, the pull request moved after it was pinned: print `CHECKS NOT READ:` naming both commits in place of the line. A refusal prints `CHECKS NOT READ:` with its reason. In every case the review goes on, on the pinned head.
5. Run `commands.changed` for the changed files. When it prints none, print `PULL REQUEST NOT REVIEWED: no changed files` and stop. Otherwise run `interlock surface --changed <files> --json`. When the person named a change, read its artifacts under `<worktree>`, never from the person's own tree.
6. When `.claude/graph/graph.json` exists in the person's tree, `interlock-graph build <worktree>`, then pipe the changed files to `interlock-graph covers --changed - --root <worktree>`. No `--update`: the graph was just built.
7. Ask for the domain context with the first line of the block below. Routing is read in the person's tree, unchanged.
8. Follow §2 and §3 for what to spawn and what to collect, and run their `interlock` lines as the block below spells them (D31). Every scratch file goes under `<dir>`.
9. `interlock gate --findings <survivors> --json`, for the report. No autonomy line, no note line.
10. Render the comment with the last line of the block below. Print the comment.
11. Under `--post`: `gh pr comment <number> --body-file <dir>/comment.md`. GitLab: `glab mr note create <iid> --resolvable=false < <dir>/comment.md` (D33). A non-zero exit prints `POST FAILED:` with the platform CLI's message and the path of `comment.md`, and the skill runs no second post (D36). Without `--post`, print `NOT POSTED:`.
12. Run `commands.worktreeRemove`. A failure prints `REVIEW WORKTREE LEFT:`.

Step 12 also runs after any stop once the worktree exists.

### What takes §1's place (D32)

An earlier draft had the section's first steps run before §1 and left §1 in force. §1 is written for the author: every command in it reads or writes the person's own tree. Its diff is `main...HEAD` of that tree and it stops when that diff is empty, so a review started from a tree with nothing committed past its base would have stopped before any reviewer ran. Its graph line would have updated the person's own graph. Under `--pr` none of §1 runs, and the section's own steps do its work:

| §1, on the author's path | Under `--pr` |
|---|---|
| `interlock changes`, to find the change | Not run: it lists the person's own changes. The change is the one the person named, or none. |
| `git diff --name-only main...HEAD` | `commands.changed`, which diffs the pinned base against the worktree's head (step 5). |
| Stops when that diff is empty | Stops when `commands.changed` prints no file, with `PULL REQUEST NOT REVIEWED: no changed files`. The person's own diff is never read. |
| `interlock surface --changed <files> --json` | The same line, on the files of step 5. |
| Reads the change's OpenSpec artifacts | Reads them under `<worktree>`, where the pull request's copy is. `interlock review brief --change` already resolves a change inside its root (`lib/review-cli.mjs:342-355`), and the target makes that root the worktree. |
| `git diff <base>...HEAD`, piped to `interlock-graph covers --changed - --update` | Step 6: a graph built inside the worktree and read with `--root <worktree>`, with no `--update`. Nothing under the person's own `.claude/graph/` is written. |

The paragraphs of §1 that describe a flag, or what the CLI does with `REVIEW.md`, run no command and stay true. §1 opens with one line that sends a `--pr` reader to §6, and a test holds that line above §1's first fenced block. A second test holds §1's own commands out of §6: no fenced command line there holds `main...HEAD`, begins `interlock changes` or carries `--update`. The rule reads command lines only, so the section's prose may still say that the graph line takes no `--update`.

### The lines under a target (D31)

The first draft of this design put `--target` on "every line that carries `--base` or `--head`". That left the skeptics line without it, since it carries neither, and skeptics with no review root judge findings against the person's own tree. Saying "every `interlock review` line" fails the other way: `interlock review proof` accepts only `--review`. So the section spells every line in full, and a test pins each:

```bash
interlock domain-context [<change>] --changed - --target <target> --json < <dir>/changed.txt
interlock review brief --dimension <name> --target <target> [--change <change>] --changed - < <dir>/changed.txt
interlock review brief --skeptics --findings <f> --target <target> [--depth strict] --json
interlock review --target <target> --findings <f> --verdicts <f> --changed - --dimensions <dimension record> --draft --out <draft> --json < <dir>/changed.txt
interlock review proof --review <draft>
interlock review brief --dimension <name> --target <target> [--change <change>] --changed - --rerun-of <draft> < <dir>/changed.txt
interlock review brief --skeptics --findings <re-run answers> --rerun-of <draft> --target <target> [--depth strict] --json
interlock review --rerun-of <draft> --target <target> --findings <re-run answers> --verdicts <re-run verdicts> --changed - --dimensions <dimension record> --draft --out <next draft> --json < <dir>/changed.txt
interlock review --rerun-of <last draft> --target <target> --changed - [--metrics <change>] --dimensions <dimension record> --out <record> --json < <dir>/changed.txt
interlock gate --findings <survivors.json> --json
interlock review comment --review <record> --target <target> --out <dir>/comment.md
```

The rule the test holds: every `interlock review brief` line, every `interlock review` line that writes a draft or the record, the `interlock domain-context` line and the `interlock review comment` line carry `--target`; no `interlock review proof` line and no `interlock gate` line does; no line of the section carries `--base`, `--head` or `--carry`. The bracketed parts are placeholders, as elsewhere in the skill: `--metrics <change>` is written only for a named change.

## Shapes the tests and the implementation share

**Test names.** Every new test's name starts with one of seven prefixes, one per task that turns it green: `pr review target:`, `pr review bind:`, `pr review prompt:`, `pr review mark:`, `pr review comment:`, `pr review skill:`, `pr review docs:`. Sections 2 and 3 run tests by prefix, so a task never verifies against a test another task owns.

**Words in shipped files.** `test/retired-names.test.mjs` fails any shipped file that spells GitLab's own name for a pull request, as a phrase, an abbreviation or an identifier. Write "pull request" for both platforms, and spell GitLab's commands and refs whole, as the allow-list in that test strips them: `glab mr view`, `glab mr note`, `refs/merge-requests/`. Never build one of them from separate argv strings in a file that test scans.

**`lib/review-target.mjs`** — pure: no `node:fs`, no git, no network.

| Export | Shape |
|---|---|
| `targetFromGithub(doc, { root, runCode })` | `{ ok: true, target }` or `{ ok: false, reason }` |
| `targetFromGitlab(doc, { root, runCode })` | the same |
| `validateTarget(value)` | `{ ok: true }` or `{ ok: false, reason }`; the one statement of what a target is |
| `REVIEW_PR_DIR` | `'.claude/ship/review-pr'` |
| `REVIEW_PR_WORKTREES` | `'.claude/worktrees'` |

`root` is the absolute path of the person's tree; the CLI resolves it and hands it in.

**The target file.**

```json
{ "platform": "github",
  "number": 44,
  "url": "https://github.com/owner/repo/pull/44",
  "draft": false,
  "base": { "ref": "main", "sha": "<full commit id>" },
  "head": { "ref": "feat/x", "sha": "<full commit id>" },
  "runCode": false,
  "dir": ".claude/ship/review-pr/github-44-<first 12 of head.sha>",
  "file": ".claude/ship/review-pr/github-44-<first 12 of head.sha>/target.json",
  "worktree": "<root>/.claude/worktrees/review-pr-github-44-<first 12 of head.sha>",
  "commands": {
    "fetch": ["git", "fetch", "origin", "refs/heads/main", "refs/pull/44/head"],
    "worktreeAdd": ["git", "worktree", "add", "--detach", "<worktree>", "<head.sha>"],
    "changed": ["git", "-C", "<worktree>", "diff", "--name-only", "<base.sha>...HEAD"],
    "worktreeRemove": ["git", "worktree", "remove", "--force", "<worktree>"] } }
```

**`lib/review-comment.mjs`** — pure.

| Export | Shape |
|---|---|
| `WEIGHTS` | `['Important', 'Pre-existing', 'Nit']`, frozen |
| `confirmPreExisting(findings, ranges)` | `{ confirmed: string[], refused: Array<{ id, reason }> }`, ids from `findingId`; `ranges` is what `changedRanges` returns, or `null` when the diff could not be read |
| `weightOf(finding, confirmedIds)` | one of `WEIGHTS` |
| `renderReviewerComment({ head, findings, proof, runCode, confirmed })` | the comment text |
| `NOT_AN_APPROVAL_LINE` | `'This is an automated review, not an approval. A person decides whether this merges.'` |
| `RAN_NOTHING_LINE` | `'Reviewers read the code and ran none of it.'` |
| `RAN_CODE_LINE` | `'Reviewers were allowed to run a single test file and the repository\'s own CLI.'` |

`interlock review comment --json` prints `{ head, findings: [{ id, key, severity, weight, file, line, title }], proof, runCode, preExistingRefused: [{ id, reason }] }`.

**The comment's fixed parts.** The heading `## Automated review — <head.sha>`; the table header `| Id | Weight | Location | Finding |`; the collapsed block's summary `<n> nit` or `<n> nits`; then the proof line, the run line and `NOT_AN_APPROVAL_LINE`, each as its own paragraph, in that order.

**Prompt assemblers.** `assembleDimensionPrompt` and `assembleSkepticPrompts` each take an optional `target: { root, runCode }`. `renderProofRules` takes `runCode` (default true) and `preExisting` (default false). With every new option absent, each prints what it prints today, byte for byte. The paragraph's heading is the literal `REVIEW ROOT`.

**CLI flags** (`lib/cli-flags.mjs`): `review`, `review brief` and `domain-context` gain `target`; new leaves `review target` (`github`, `gitlab`, `run-code`) and `review comment` (`review`, `target`, `out`). Both leaves join `INVENTORY` in `scripts/postinstall-smoke.mjs`.

**The skill's section.** The new section is the last one in `skills/review-code/SKILL.md`, under the heading `## 6. Pull request review (--pr)`, and runs to the end of the file. It goes last so the existing tests that find the first matching line of §2 and §3 still find those lines. Each fenced block of `gh` lines opens with a comment line starting `# GitHub — not exercised`, and each block of `glab` lines with one starting `# GitLab — not exercised`. The paragraph that introduces `--post` and `--run-code` holds the word `never`.

**Lines the skill prints.** Eight: `PULL REQUEST NOT REVIEWED:`, `REVIEW WORKTREE NOT CREATED:`, `REVIEW WORKTREE LEFT:`, `CHECKS NOT READ:`, `REVIEW METRICS NOT RECORDED: no change named`, `COMMENT NOT RENDERED:`, `POST FAILED:`, `NOT POSTED:`. A pull request with no changed file prints the first with the fixed reason `no changed files`. The CLI prints `PRE-EXISTING NOT CHECKED:` on standard error.

## Risks / Trade-offs

- [A reviewer reads the person's own tree instead of the worktree, and reviews the wrong commit] → the `REVIEW ROOT` paragraph is printed by the CLI into every dimension and skeptic prompt; a file the pull request adds exists only in the worktree; a finding about code that is not at the head is what the skeptics exist to refute. Nothing checks this mechanically, and the docs say so.
- [The read-and-run-nothing rule is a prompt line; the reviewer type keeps the shell] → D24. Forks are refused, so the code is a colleague's. `--run-code` is an explicit opt-in the comment reports.
- [A reviewer marks a finding `preExisting` that the change did cause, on a line off the diff] → the prompt carries the "never" half of the rule, the finding is still listed in the open under `Pre-existing`, and the skeptics still judge whether it is real.
- [A pull request's code, comments and artifacts are untrusted text read by the reviewers] → prompts quote repository data as data (`openspec/specs/review/review-briefs/spec.md:37`), reviewers cannot edit, spawn or invoke a skill, and the posted comment renders their text inert. A reviewer misled by text in the code can still raise a wrong finding; two skeptics judge it.
- [A default review reads `REVIEW NOT PROVEN` because a reviewer could not run a measurement] → D30: the gap is named in the comment beside the line saying no code was run, the docs page explains it, and `--run-code` is the remedy. A quieter comment would hide that a claim went unchecked.
- [The `REVIEW ROOT` paragraph is placed first and breaks spawn attribution] → D29: the spec and a test hold each prompt's first line to what it is without a target.
- [The GitLab lines have never run] → `not exercised` markers on every one, a reader that refuses any document it does not recognise, and the first real run named below as owed.
- [Creating or removing a worktree fails in a sandboxed session] → each failure has its own line naming one run of the same command outside the sandbox; nothing is reviewed until the worktree exists.
- [An interrupted run leaves a worktree] → the next run on that head finds it at the same path, removes it and adds it again; `REVIEW WORKTREE LEFT:` names the command when a removal fails.
- [Building a graph of a large repository takes time] → it happens only when the person already keeps a graph, costs no model tokens, and a failure skips `blast-radius` aloud.
- [`cli/interlock` crosses its size pin] → D28: the two commands live in `lib`, and the CLI file gains usage lines only.
- [A skill that settle and ship call gains `gh` and `glab` grants] → the grants are the narrowest patterns the path needs, and a test pins the list. The alternative recorded under "The surface", a separate skill, would have kept them out of this one; the owner chose the flag.
- [The path inherits `Write` and `Bash(git *)` from the skill, and a reviewer's shell starts in the person's own tree, so no tool bound stops a `git commit`, a `git push` or a platform write; `hooks/guard-commit.mjs` allows a commit outside a ship run] → D34: accepted. The section's instructions, the test that fails a write verb in it and the write-nothing line in every prompt stand in the way, and the person's own permission settings decide what a shell command may do. The docs page says so. A separate skill with its own grants is the remedy if this proves too thin.
- [A push lands between the pin and the checks read, and the check summary describes another commit] → D35: the skill prints the summary only when its commit is the pinned head, and otherwise names both commits. The record and the comment are bound to the pinned head either way.
- [The post fails part-way, and a retry posts the comment twice] → D36: one attempt, `POST FAILED:` with the comment file's path, and no other write.
- [`glab mr note create` is marked experimental by glab, and an older glab has no such leaf] → D33: the line is marked `not exercised`, a glab that refuses it ends in `POST FAILED:` with the comment file's path, and the first GitLab run is owed below. That run also shows whether the host passes a command that reads a file on standard input under the `glab mr note create` grant, or asks the person first. A prompt there is the person approving the one write the path makes.
- [A pull request with nothing committed on the person's own branch is never reviewed, because the author's scoping section stops on an empty diff] → D32: that section does not run under `--pr`, and two tests hold the separation.

## Migration Plan

Additive. Without `--pr` and without `--target` nothing changes, and tests pin the prompts byte for byte.

Rollback is a revert of the change's commit. Nothing persists outside `.claude/ship/review-pr/`, which is an ignored session directory that can be deleted, and any worktree a failed removal left, which `git worktree remove --force <path>` clears.

Owed after the run, by the owner, because each needs the network, a real pull request and a worktree outside the sandbox:

1. One pass on an open pull request of this repository **without `--post`**. It writes nothing to the platform.
2. One pass with `--post` on a pull request the owner chooses.
3. One pass on a real GitLab pull request.

After each, the matching `not exercised` marker in the skill and the sentence in the docs page are edited to say what ran, in a follow-up commit.

## Open Questions

- Should the author's own loop show `Pre-existing` too? The settle comment could read the same mark. Not needed for this change, and it would touch the settle loop's requirements.
- Should a later change read the existing discussion so the review does not repeat a person's comment (D20)?
- Should `interlock pipeline` take `--target` and refuse a check document of another head itself (D35)? Today the skill compares the two commits, and a test holds only that the step names `head.sha`. The summary is in no record and not in the comment, so this waits for the change that next touches the pipeline reader.
