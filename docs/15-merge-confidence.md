# 15 — Merge confidence: producing and reading its inputs

`interlock merge-confidence` answers "can this be merged?" from facts a review and a run already produce. This page is about the inputs that need something set up around them, how the verdict reaches a merge request, and how to read the one report that tells you whether the specs can carry a review. It does not repeat the command's own reference. For every option of the command, its exit codes and its inputs, read [07 — CLI and configuration](07-cli-and-configuration.md#merge-confidence-interlock-merge-confidence). For the rules `REVIEW.md` follows, read [12 — Repository review policy](12-repository-review-policy.md).

The page has three parts. The first says what the verdict reads: [the signals](#the-signals) and [the flags](#the-flags), then the inputs that need explaining. The second says how the verdict is delivered: [the pipeline input](#the-pipeline-input-interlock-pipeline), [the description block and the labels](#the-description-block-and-the-labels), [three platform recipes](#platform-recipes) and [a CI job](#a-ci-job-that-reassesses), with [how far a label can be trusted](#how-far-a-label-can-be-trusted). The third covers the coverage baseline, the always-human-review paths and the spec audit.

## What the verdict is

One of three words, `MERGE`, `HUMAN` or `BLOCK`, a score, and one entry per signal saying what it saw and what would lift it. The verdict is the worst band over the gating signals, and a signal nobody could observe counts against you, not for you. Every threshold is in code: read `interlock limits` for a number, never this page.

Every gating signal has a producer. A change that was reviewed, verified, confirmed against the requirements it touches and named in the specs can read `MERGE`, and when a signal reads `unobserved` the reason names the fact about this change that is missing, never a capability the tool lacks. Two signals are covered below because the facts they read need something around them: the living requirements a change is asked to confirm, and whether the source it adds is named in a spec. A ship run's close states the verdict once, and writes the evidence a later command can assess again.

## The signals

One row per registered signal. A signal reads green, amber, red or `unobserved`; amber and `unobserved` say what would lift them: a fix, a person, or more evidence. A suite test holds this table equal to the registry, so a signal cannot be added without its row.

| Signal | What it reads | What moves it |
|---|---|---|
| `review.blockers` | The surviving findings of the adjudicated review | Red for a surviving blocker, or a surviving finding whose severity is outside the published set. Green with none. `unobserved` with no review, or one that carries no surviving list |
| `review.warnings` | The surviving warnings, against the warnings cap | Amber, needing a fix, over the cap. Green at or under it. `unobserved` with no review |
| `review.ran` | The review's dimension record: which dimensions were selected, which ran with their rubric, whether the review completed | Amber, needing more evidence, when no review ran, the review did not complete, or a selected dimension could not run with its rubric or has no record of running. Green when every selected dimension ran. Flags: `dimensions-unrecorded`, `domain-skipped` |
| `review.adversarial` | Refutations refused for citing nothing, and the skeptic verdicts behind each surviving blocker and warning | Amber, needing more evidence, when a refutation was refused or such a finding has fewer verdicts than the floor. Green otherwise. `unobserved` with no review |
| `risk.class` | The risk class of the changed paths and the change's artifacts | Amber, needing a person, when the class is outside the allowed classes, or nothing could be classified. Never red: a sensitive path is a person's decision, not a defect. Green inside the allowed classes |
| `verify.suite` | The unit suite and the type check, from the final verification verdict | Red when the unit suite is red, weakened or errored, or the type check failed. Amber, needing a person, when the suite was red before this change. Amber, needing more evidence, when the unit suite was skipped for want of a profile or a command. `unobserved` with no verdict, a verdict that is not the final one, a spent budget, or a kind with no result. Green otherwise. Flags: `no-typecheck`, `docs-only-changes` |
| `verify.e2e` | The end-to-end result in the final verification verdict | Amber, needing a fix, when the suite ran and failed. `unobserved` with no final verdict, a spent budget, or no result. Green when it passed or every changed path is documentation. Flag: `no-e2e` |
| `verify.coverage` | The coverage input: the head and base totals, the changed-line coverage, the changed source the report does not list | Green under the small-change floor. With a usable baseline: green when the total held within the decline tolerance, amber, needing a fix, beyond it. With none: green at or above the patch floor, amber below. `unobserved` with no input, a baseline whose commit is not an ancestor of the head, or missing figures. Flags: `no-coverage`, `no-baseline`, `unmeasured-source` |
| `ci.pipeline` | The pipeline input: the platform's checks for the head commit | Red for a failed required check on the head. Amber, needing a fix, for a failed check that is not required; amber, needing more evidence, for an entry in a state outside the four. `unobserved` with no input, an input for another commit (a failed required check on it is named and does not block), a pending check, or an input that is not well-formed. Green when every check passed or was skipped. Flag: `no-pipeline`. Excluded checks are named in the evidence whatever the band |
| `conformance.delta` | The handoff's scenario counts, against the command's own count of the change's delta scenarios | Amber, needing more evidence, when the checklist could not be built, a scenario is unconfirmed, a count is missing, or the number checked differs from the number counted. Amber, needing a fix, when the delta specs carry no scenario for changed source. `unobserved` when there are scenarios and no handoff. Green when every scenario was checked |
| `conformance.living` | The handoff's requirement counts, against the living list the command counts itself | Amber, needing more evidence, when a requirement is unconfirmed, a count is missing, or the number checked differs from the number counted. `unobserved` when no list was gathered, or the list has entries and no handoff. Green when every listed requirement was checked, and when there is nothing to confirm. Flags: `no-graph`, `requirements-omitted` |
| `spec.coverage` | Whether each source file the diff adds is named by a spec, and whether a kept file lost the only spec that named it | Amber, needing a fix, for an added file no spec names, or a kept file whose naming spec the diff changed or deleted. `unobserved` with no base, or a diff that is empty by construction. Green otherwise. Flag: `legacy-unspecced` |
| `diff.shape` | The changed lines and changed files against the base | Amber, needing a person, over either diff-size cap. `unobserved` with no base, or a base that is the head or ahead of it. Green at or under both |
| `decisions.open` | The change's decision ledger | Amber, needing a person, for a missing or unparseable ledger, a row that needs a person, an invalid row, or a change directory that does not exist. Amber, needing more evidence, when no change is under assessment. Green for a ledger with neither |
| `run.integrity` | The observations a run's close records: whether it halted, whether its trajectory is complete, the stage markers not published, the handoff reports rejected, the permission prompts, the auto-mode denials, the tasks left unticked | Amber, needing a person, for any recorded degradation. `unobserved` with no run record, and when the record lacks an observation or carries it as null: the reason names each by its record key. Green only for a record that carries every observation, none a degradation |
| `drift.stale` | Living-spec citations of files this change removed, and other complete, unarchived changes on its capabilities | Amber, needing a fix, for a citation of a file this change removed. Amber, needing a person, for another unarchived change on a shared capability. `unobserved` when drift was not gathered. Green otherwise. Flag: `no-graph` |
| `policy.humanPaths` | The always-human-review list in the `REVIEW.md` committed at the base, against the changed paths | Amber, needing a person, when a changed path falls under a listed path, when `REVIEW.md` differs from the base, or when the base's section has a problem (a glob-shaped item is one). `unobserved` with no base. Green otherwise |
| `plan.fidelity` | Whether the run record carries the planned and the touched path sets | Informational, not gating: it is reported and never banded, and it never enters the verdict or the score |

## The flags

A flag is "green, but you should know". It lowers the score and never moves a band. One row per published flag, held equal to the command's list by a suite test.

| Flag | Raised by | What it says |
|---|---|---|
| `no-e2e` | `verify.e2e` | No end-to-end suite is enabled or requested here |
| `no-typecheck` | `verify.suite` | The test profile names no type-check command |
| `no-coverage` | `verify.coverage` | Coverage is not configured in this repository |
| `no-baseline` | `verify.coverage` | There is no usable baseline, so the change was judged on its changed lines alone |
| `no-pipeline` | `ci.pipeline` | The pipeline input for the head commit holds an explicit, empty check list |
| `docs-only-changes` | `verify.suite` | A verification kind was skipped because every changed path is documentation |
| `dimensions-unrecorded` | `review.ran` | The review carries its counts and no dimension record, so which dimensions ran is unrecorded |
| `domain-skipped` | `review.ran` | The `domain` review dimension was skipped, with the reason in the evidence |
| `legacy-unspecced` | `spec.coverage` | The diff edits a file no spec ever named |
| `no-graph` | `drift.stale`, `conformance.living` | A check that reads the graph did not run, or ran on the declared capabilities only |
| `requirements-omitted` | `conformance.living` | The size bound left living requirements out of the list the handoff was asked about. The evidence says how many were asked and how many were not, a list cut to nothing included |
| `unmeasured-source` | `verify.coverage` | The diff adds lines to source files the coverage report does not list. The evidence names the files and the lines added in them |

**Why `unmeasured-source` is a flag.** A coverage report lists the files the tests loaded. A new source file no test loads is absent from it, so its lines count neither for nor against any figure, and the change that most needs the signal would read "under the small-change floor" with nothing said. The coverage input therefore names such files, and a green reading carries the flag. It is not a band, because a report cannot tell a file no test loaded from one the project leaves out of coverage on purpose (generated code, a second language): holding the band would give those repositories an amber nothing could lift. An input from a producer that predates the two fields raises no flag, and its evidence says the input does not state unreported files.

## Confirming living requirements at handoff

The change's own delta scenarios answer for what the change adds or modifies. They say nothing about the requirements already in force for the capabilities it touches, which a diff can break without a single delta scenario noticing. A ship run started with `--conformance` therefore asks its handoff step about those too, and the `conformance.living` signal reads the answers.

**Which requirements are asked.** The ones the `domain` review dimension is judged against, by the same rule, from the same base: a capability is selected when a reliable graph link ties a changed path to a living spec, and when the change's own delta specs modify a capability that has a living spec. A requirement the change's delta specs modify, remove or rename is not asked, because its own scenarios answer for it. The text is read from the run's start commit, so the change cannot edit the requirement it is asked to confirm. The list is `L1..Ln`, each entry a spec path, a line and a heading, never the body: the handoff agent reads the spec at the cited line and answers each with a `file:line` citation, or records it as unconfirmed. An answer is never "satisfied" by default and never "omitted". `interlock conformance --living --base <ref>` prints the same list by hand, and the answers never halt the run.

**Why the list is bounded.** Every in-force requirement of every selected capability is an unbounded handoff. The list is cut at the same size bound the domain reviewer's text is, the `domain spec text budget (chars)` row of `interlock limits`, at a requirement boundary: whole requirements are kept in capability then spec order, and none is cut part-way. Using the reviewer's bound means the reviewer and the handoff can never disagree about the set, and it adds no second number to defend.

**What `requirements-omitted` means.** The bound left requirements out. The signal's evidence states how many were asked and how many were not, and the flag lowers the score without moving the band. It is a flag and not a band because the bound is the CLI's, nobody on the change can act on it, and holding every large capability at `HUMAN` would punish the repositories that wrote the most spec. Read the omitted names in the conformance output, and look at those requirements yourself if the change is large.

**How the signal reads.**

- Green when every listed requirement was checked and none is unconfirmed, and green when the list holds nothing to confirm.
- Amber, needing more evidence, when any requirement is unconfirmed, when the handoff gave neither count, or when the number checked differs from the number the command counted. The handoff's own claim of how many answers were required is ignored; the command counts.
- `unobserved` when the list has entries and no handoff was given, and when no list was gathered at all.
- A graph that was built but links none of the changed paths gives an empty list and a green signal with no flag: nothing in force is touched. With no graph and no capability the change declares, the list is skipped and the signal is green with the `no-graph` flag; with no graph and a declared capability it is built from the declared capabilities, reads whatever the answers decide, and carries `no-graph`. A skipped or partial list also raises a banner in a run ([04](04-when-it-stops.md)).

## Spec coverage: is the source this change adds named?

A repository still being specced is judged on what a change adds, not on what it inherited. The `spec.coverage` signal looks at the files the diff between the base and the head adds, edits and deletes, and asks whether each source file the change adds is named by a spec.

**What "named" means.** A file is named when its repository-relative path is mentioned in a living spec as the head has it, or in one of the change's own delta specs. The mention is recognised by the same rule the graph applies when it links a spec to a file, so the two cannot disagree about what a mention is. The delta specs count because they are the living specs the archive will write. Only coverable source files are judged: a test, a configuration file or a document having no spec is not a gap.

**Where a path mention belongs.** In the spec text, in the requirement or the scenario that describes the behaviour the file carries, written as a repository-relative path in backticks: `` `lib/new.mjs` ``. A leading `./` is read as the same path. Put it where a reviewer reading the requirement would want to be pointed at the code, not in a list at the bottom. A path inside a URL is not a mention. An example path in a scenario names a real file of that name if one exists, which is the graph's blind spot too.

**A file at the repository root is named as `./<file>`.** The mention rule reads a path only when it carries a directory and a file extension, so a bare file name in backticks, such as `` `index.js` ``, names nothing: in a spec it is usually an example, or a file elsewhere in the tree. A root-level source file is therefore written `` `./index.js` ``, which is read as that file. Without the `./` the signal reads the file as added and named by no spec.

**Why an inherited file is a flag and an added one is not.** An added source file that no spec names is amber, needing a fix: the change is the moment to say what the file is for, and the fix is one path in a delta spec. A kept file whose only naming spec the diff changed or deleted is amber for the same reason, naming the file and the spec. A file the diff merely edits that nothing names and that lost no spec in this diff is the `legacy-unspecced` flag: it lowers the score, moves no band, and its evidence states how many such files the diff edits and how many tracked coverable source files are named out of how many exist. Holding every change to a file a repository never specced at `HUMAN` would be a reason no one on the pull request can act on.

**No graph is needed.** The facts are computed from spec text and git alone, so a CI job on a plain checkout reads the same band a developer's machine does. The signal needs a base, because an added file cannot be told from an edited one without a diff: with no `--base` it is `unobserved`, and so it is when the base is the head or ahead of it, because that diff is empty by construction.

## What a run's close records and prints

On a run that completed, `interlock run close` assesses merge confidence once, from the facts the run observed, and states the result in four places. A halted close assesses nothing: a diff that stopped part-way is not a candidate for merging, and "never assessed" has to stay distinguishable from a low score.

- **The summary** prints a block between the run's identity rows and the archive reminder. Its first line is the headline `interlock merge-confidence` prints first; below it, one row per group that has an entry (needs a fix, needs a person, needs more evidence), a `flags:` row and an `assessment:` row naming the evidence file. The block, and how to read it, is in [04](04-when-it-stops.md). A `living requirements:` row beside the conformance row prints the confirmed count over the checked one.
- **The receipt** carries a `mergeConfidence` block: the verdict, the score, the worst band, the signal counts, the ids of the driving signals and the flags. It carries no reason and no evidence line, because those can quote a finding's title and file. A run halted at close records the block as absent, not as a score of zero.
- **The outcome record** carries the same verdict as `mergeVerdict` in its observed group. Nothing that decides reads it back ([14](14-evals.md)), and `interlock report` reads none of it ([11](11-the-indicators.md)).
- **The evidence file** `.claude/ship/merge-confidence.json` holds what the run saw, for the command below.

What the close supplies, and what it cannot: the base is the commit the run started on, the changed paths are the commit's, and the review, the final verification verdict, the handoff counts, the coverage figures and the run record are this run's own. A review or verification file left in the working directory by an earlier run is not read; the close takes the review only when this run adjudicated one, and the verification only when it carries this run's identifier, so a lean run that follows a strict one reads `review.ran` amber for no review rather than borrowing the earlier run's. No pipeline is supplied: the run is offline and no platform has seen the commit it just made. **So no close reads `MERGE`.** A lean run reads `HUMAN` naming `review.ran`, a strict run `HUMAN` naming `ci.pipeline`. A run on a host with no recorder, where nothing could observe a permission prompt or an auto-mode denial, also reads `run.integrity` `unobserved`, naming the two counts: a count nobody made is not a zero. A run with no recorded start commit reads every signal that needs a base as `unobserved`, naming that. A run that made no commit, because it was told not to or because its commit step failed, reads the diff shape and spec coverage as `unobserved` for that reason, since its diff against its own start is empty.

The verdict never changes the close's exit code. A `BLOCK` at close is reported, not enforced; a gather that could not read a fact, an assessment that threw and an evidence file that could not be written are each spoken as a banner (`MERGE EVIDENCE UNAVAILABLE`, `MERGE CONFIDENCE NOT ASSESSED`, `MERGE CONFIDENCE NOT WRITTEN`) and none moves the exit code ([04](04-when-it-stops.md)).

**The review's dimension record.** `review.json` carries `dimensions: { selected, ran, unavailable, completed, skipped }`, the record `review.ran` reads. The CLI never watches one dimension run, because the review worker fans out inside its own context and reports `ok`. So "ran" means dispatched with its rubric in a review the worker reported complete, minus any selected dimension whose rubric could not be read, plus any dimension the agent added. A worker that returned nothing usable leaves `completed: false` and an empty `ran`, and so does one that reported success and left no findings list: the run removes the findings and verdicts work files before the reviewer starts, so a missing, unparseable or list-less findings file is that review's own silence, never a clean result and never an earlier run's ([04](04-when-it-stops.md)). A skipped `domain` dimension reaches the verdict as the `domain-skipped` flag.

**Unticked tasks hold a run at `HUMAN`.** A run that left a task of the change unticked did not finish the change by this repository's own definition, and whether what remains matters is a person's call. `run.integrity` reads amber, needing a person, and names how many. A change with a task only a person can do therefore reads `HUMAN`, intentionally; the direction costs a look and never grants a merge.

## The run's evidence file and `--run`

`.claude/ship/merge-confidence.json` is written by a completed close, in the working root beside the run's review record. It is per-run working state, gitignored, and never written to the state home. It holds a schema identifier, the change, the run id, the base, the head commit, whether the run committed, the five inputs only the run observed (review, verification, handoff, coverage and the run record), and the assessment as the close made it.

```bash
interlock merge-confidence <change> --base origin/main --run .claude/ship/merge-confidence.json --pipeline .claude/ship/pipeline.json
```

`--run` supplies those five inputs, and **only for the commit the run made and the diff the run reviewed**. The file is used when it carries the schema identifier, names this change, records that the run committed, and records as that commit the head. With `--base` there is one more condition: the base the file records must be the merge base of `--base` and the head. A run reviews the diff from the commit it started on to the commit it made, and the file ends at the same head whatever lies under it, so a pull request of five commits whose last commit a run made is not a reviewed pull request. When the two differ, when the file records no base, or when git cannot give a merge base (a shallow clone: the reason names fetch depth), nothing is taken from the file and stderr names both diffs. A target branch that gained commits after the run started does not refuse the file, because the merge base is still the commit the run started on.

**Pass `--base` with `--run`.** No base is ever taken from the file. Without `--base` the file is still used under its first four conditions, but the diff shape, the spec coverage and the human-paths signals stay `unobserved`, so the verdict cannot be `MERGE`. Evidence is about a tree; a commit added after the run (an archive, a hand fix) describes a different one, so the review, verification and run-integrity signals return to `unobserved`, and stderr names both commits. For the same reason **a run that made no commit leaves no usable file**: it writes `committed: false`, which no later command can use, because it describes a working tree nobody can name. When any condition fails the command uses nothing from the file and says which one failed. A file that is not valid JSON exits 1 with no verdict.

Two rules keep the file honest. The verdict, the score and the signal results recorded in it are never read: the command always reassesses from the evidence, so editing the recorded verdict to `MERGE` over a surviving blocker still reads `BLOCK`. And an explicit `--review`, `--verify`, `--handoff` or `--coverage` replaces the file's entry for that input.

This is the route to a first `MERGE`. The pipeline is the one input a run cannot have, so the command with `--base`, the run's file and a pipeline input for the head is where the verdict can be raised. `.claude/ship/` is gitignored, so a CI job that wants the file is handed it as an artifact, or a person runs the command on the machine that ran the ship; without the file `run.integrity` reads `unobserved` and `--require-merge` reads `HUMAN`.

## The pipeline input: `interlock pipeline`

The `ci.pipeline` signal reads one file: the commit it describes, one entry per check with its name, its state (`pass`, `fail`, `pending` or `skipped`) and whether the platform requires it, and the names of any checks the caller left out.

```json
{ "sha": "<head commit>", "checks": [{ "name": "unit", "state": "pass", "required": true }], "excluded": [] }
```

`interlock pipeline` produces it from the platform's own output. The state of a check decides whether the verdict can read `MERGE`, so the mapping from a platform's vocabulary to those four states is code with a test behind it, not something a model or a person transcribes. The command is offline: you fetch the document with the platform's CLI and pipe it in.

**GitHub.** One document carries the head commit and its checks. The required checks come from a second call, and each name is passed as a flag:

```bash
gh pr checks <n> --required --json name
gh pr view <n> --json headRefOid,statusCheckRollup | interlock pipeline --github - --required "<name>" --out .claude/ship/pipeline.json
```

A missed required name reads a failed check amber where it should be red; an invented one adds a pending required entry. Neither turns a check the platform reported green. A required check that has not reported at all is in neither document, so it is visible only when it is named, which is why an unmatched required name becomes a pending entry.

**GitLab.** Two commands, and nobody types the head commit. The first reads the merge request and writes either a complete input with no checks (there is no head pipeline) or a pending record holding the head commit and the pipeline's id. The second reads the head pipeline and the record:

```bash
glab mr view <iid> --output json | interlock pipeline --gitlab-mr - --out .claude/ship/pipeline.json
glab ci get --merge-request <iid> --output json | interlock pipeline --gitlab - --mr .claude/ship/pipeline.json --out .claude/ship/pipeline.json
```

A merged-result pipeline runs on a commit GitLab made, so its own commit is never the head; the merge request is the platform's statement of which commit the pipeline answers for, and the file carries it from one step to the next. A job is required when it is not allowed to fail. **The GitLab reader is written from GitLab's and `glab`'s documentation and source, with fixtures built to match them. Nobody has run it against a live project.** It refuses a document it does not recognise instead of guessing.

**What the command refuses, and what it does about the old file.**

- A result the platform did not give reads `pending`, never a pass and never a failure: a cancelled or stale run, and any value the state table does not name. The verdict reads a pending check `unobserved`. The tables are in `interlock --help` under `pipeline:`.
- A document that is not JSON, or is not the one the platform flag expects, exits 1 with nothing on stdout. A GitHub document with no check list is refused; one with an empty list is "no checks".
- **A refused document removes the earlier file at `--out`**, and stderr says so. A fixed output path that kept its last good file would hand the next command an earlier moment's checks, with a commit that may still match.
- **A missing or misshapen file is refused by `merge-confidence`.** A `--pipeline` file with no `checks` list, an entry in a state outside the four, or the pending record of a GitLab merge request whose second step never ran exits 1 naming the fault, with no verdict. An absent or misspelt list is never read as "no checks": read that way, a file whose only fault is a misspelt key would hide a failed required check behind a green signal.

**Excluding the gate's own check.** A required job that fails until the merge request is labelled, or a job that itself runs `merge-confidence --require-merge`, is in the pipeline the verdict reads. Counted, it is a failed or pending required check, and the verdict it waits for can never arrive. `--exclude <name>` leaves it out by exact name, records the name in the file, and the signal's evidence and the description block both show it. No name is excluded by default and no pattern is accepted: an exclusion that matched nothing is said on stderr. In the `mr` skill the flag is `--gate-check <name>`.

## The description block and the labels

`interlock merge-confidence --json` names what it assessed and prints the labels for its verdict:

- `head` holds the assessed commit as `sha`, and is null when the head cannot be read.
- `base` holds the reference given as `ref` and the merge base the diff was taken from as `sha`. `sha` is null when the reference resolves and its merge base cannot be read; `base` is null when no base was given.
- `labels` holds `verdict` and `score`, each with a `name`, a `color` and a `description`, with `verdictNames` (the three verdict label names) and `scorePrefix`, so a caller can recognise the labels a merge request already carries.

| Verdict | Label |
|---|---|
| `MERGE` | `interlock/merge` |
| `HUMAN` | `interlock/human-review` |
| `BLOCK` | `interlock/blocked` |

The score label is `interlock/score-` followed by the integer score with no padding. The names are defined once, in the CLI; the `mr` skill carries none and applies what it is handed.

`interlock merge-confidence --markdown` prints the description block and nothing else: a `## Merge confidence` heading, the verdict with its score and range, the commit and the base, what is driving grouped by what would lift it, the flags, any excluded checks, the two labels, and every signal in a collapsed table. Reasons and evidence quote names this repository does not control: a check is named by the workflow that defines it, a finding by the reviewer that wrote it, a ledger question by its author. Posted as plain Markdown under the account of whoever ran the skill, such a name could mention a person or close the collapsed section. So each reason, evidence line and excluded name is an inline code span, with any backtick replaced, line breaks folded and its length bounded. The exit status is what it is without the flag; with `--json` it is a usage error.

**What `/interlock:mr` does with them.** It fetches the target branch, pipes the platform's checks into `interlock pipeline`, runs `merge-confidence` with `--base`, `--pipeline` and, when the file exists, `--run`, and pastes the block into the description unedited. Then it reads the platform's head again. Only when that is still the commit that was assessed does it remove the verdict and score labels the merge request carries and add the two the command printed; it removes and adds even when the verdict is unchanged, so the platform records the new assessment. When the head moved it removes the old labels, adds none, and says so. `--confidence-comment` also posts the block as a comment, and `--gate-check <name>` excludes a check. The skill never merges, approves or requests changes, and it reads nothing from the merge request's title, description or comments into the assessment.

A merge request made by hand, with no ship run behind it, has no run record, so it reads `HUMAN` on `run.integrity` whatever its review says. That is correct: nothing observed the run. The block shows each run-supplied signal as the command read it with no file.

## Platform recipes

A label is advice to a policy the repository owns. Each recipe below is a sketch of such a policy, in the manner of the baseline job further down: enough to see the moving parts and what each one needs. Each opens by saying who merges, which step keeps a label from outliving the commit it was computed for, and whether the recipe was run against the platform or written from its documentation.

### Recipe: GitHub, a label-keyed approval

**Merges:** GitHub, through a ruleset on the target branch that requires one approval and dismisses stale approvals. Nothing in Interlock merges.

**Clears labels:** the `clear` job below, on `synchronize`: every new commit removes the verdict and score labels, and the ruleset dismisses the approval the last label earned.

**Exercised:** no. Written from GitHub's documentation, read on 2026-10-12. Resting on documentation alone: that `pull_request_target` runs for the `labeled` and `synchronize` activity types, that an event raised with the repository token starts no workflow (so the job's own label removal does not trigger it again), and that Actions may approve a pull request once the repository setting allows it. GitHub's settings page does not say whether that approval counts toward a required-approval rule: check it on your plan before relying on this.

```yaml
on:
  pull_request_target:
    types: [labeled, synchronize]
permissions:
  pull-requests: write
jobs:
  approve:
    if: github.event.action == 'labeled' && github.event.label.name == 'interlock/merge'
    runs-on: ubuntu-latest
    steps:
      - run: gh pr review "$PR" --repo "$REPO" --approve --body "Approved on the merge-confidence label for $SHA."
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
          SHA: ${{ github.event.pull_request.head.sha }}
  clear:
    if: github.event.action == 'synchronize'
    runs-on: ubuntu-latest
    steps:
      - run: |
          gh pr view "$PR" --repo "$REPO" --json labels --jq '.labels[].name' |
            grep -E '^interlock/(merge|human-review|blocked|score-)' |
            xargs -r -I{} gh pr edit "$PR" --repo "$REPO" --remove-label {}
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
          REPO: ${{ github.repository }}
```

`pull_request_target` runs the workflow as the base branch has it, and neither job checks the head out, so a pull request cannot rewrite its own gate. The repository setting "Allow GitHub Actions to create and approve pull requests" has to be on.

### Recipe: Mergify, a queue rule

**Merges:** Mergify, through a queue rule conditioned on the label and on the checks you name.

**Clears labels:** the same `clear` job as the GitHub recipe, run on `synchronize`. Mergify has no condition for "this label is older than the head", so without that job a label would outlive its commit.

**Exercised:** no. Written from Mergify's documentation, read on 2026-10-12. Resting on documentation alone: the `label` and `check-success` condition attributes and the shape of a queue rule.

```yaml
queue_rules:
  - name: merge-confidence
    queue_conditions:
      - label=interlock/merge
      - check-success=<your required check>
pull_request_rules:
  - name: queue a pull request the verdict allows
    conditions:
      - label=interlock/merge
    actions:
      queue:
        name: merge-confidence
```

### Recipe: GitLab, a pipeline job

**Merges:** GitLab, with "Pipelines must succeed" on: the job below is what must succeed.

**Clears labels:** an earlier job in the same merge request pipeline, which removes the verdict and score labels through the API when a pipeline starts for new commits. Re-running the pipeline for the same commit clears them too, and the skill has to be run again.

**Exercised:** no. Written from GitLab's documentation, read on 2026-10-12. Resting on documentation alone: that `CI_MERGE_REQUEST_LABELS` is set before the pipeline and only in merge request pipelines (which is why the job asks the API for the current labels instead), that a label change starts no pipeline, and the merge request API's label fields.

```yaml
clear-merge-confidence:
  stage: .pre
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - 'curl --fail --request PUT --header "PRIVATE-TOKEN: $MERGE_GATE_TOKEN" --data-urlencode "remove_labels=$STALE_LABELS" "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID"'

merge-gate:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - 'curl --fail --header "PRIVATE-TOKEN: $MERGE_GATE_TOKEN" "$CI_API_V4_URL/projects/$CI_PROJECT_ID/merge_requests/$CI_MERGE_REQUEST_IID" > mr.json'
    - 'grep -q "\"interlock/merge\"" mr.json'
```

`$STALE_LABELS` is the verdict and score labels the merge request carries, which the job reads from the same API response before removing them. Both jobs need a project token. `merge-gate` is the gate's own check: it fails until the merge request is labelled, so run the skill with `--gate-check merge-gate`, and because a label change starts no pipeline, retry the job after labelling. A team that also accepts a human approval adds that test beside the label's.

## A CI job that reassesses

`interlock merge-confidence --require-merge` exits 1 unless the verdict is `MERGE`, so it can be a required check. It re-reads evidence a ship run produced; it does not produce any, and it runs no review. Left as it is in a default CI job it reads `HUMAN`, for three reasons, each with its fix:

- **It has to assess the merge request's head commit.** On GitHub the default checkout of a pull request is a merge commit GitHub made, which is not the commit the run made or the pipeline input describes. Check out the head (`ref: ${{ github.event.pull_request.head.sha }}`, with `fetch-depth: 0` so the merge base can be read).
- **It has to be given the run's evidence file.** `.claude/ship/` is gitignored, so the job is handed `.claude/ship/merge-confidence.json` as an artifact, or a person runs the command on the machine that ran the ship. Without it `run.integrity` and the review signals are `unobserved`.
- **It has to exclude itself.** The job is one of the checks in the pipeline input it reads, and while it runs it is pending, which reads `unobserved`. Produce the input with `--exclude <the job's own check name>`.

```bash
gh pr view "$PR" --json headRefOid,statusCheckRollup | interlock pipeline --github - --required unit --exclude merge-confidence --out pipeline.json
interlock merge-confidence <change> --base origin/main --run merge-confidence.json --pipeline pipeline.json --require-merge
```

Unlike the rest of the page's commands, the first line calls the platform, so the job needs a token that can read the pull request.

## How far a label can be trusted

A label is the claim of whoever ran the skill, on their machine, with the evidence file their ship run wrote. Anyone able to label a merge request can make the same claim by hand, and the platform's timeline shows who did. The verdict behind an honest label fails closed: no input it reads can turn "could not be read" into a clean reading. That is a statement about the command, not about the person holding the keyboard.

A team that needs a gate an author cannot assert for themselves has to produce the evidence on a machine the author does not control: the review, the verification and the run record would have to come from CI, not from a file the author hands over. Interlock does not provide that. The CI job above re-reads what a run produced; it cannot vouch for where the file came from. Use a label as advice to a policy you own (who must approve, which checks are required), and keep the approval rule the place where the decision is made.

## Recording a coverage baseline

The coverage signal judges a change by how much the project total moved against a base figure, and by how well the changed lines are covered. The base figure comes from a baseline: the project total of a coverage report taken on a commit that is an ancestor of the one under review.

Record it on the default branch, after the coverage command has run and left its report where the test profile says (`coverage.report_path`, relative to `unit.cwd`; see `shared/TEST-PROFILE.md`):

```bash
interlock verify baseline --report coverage/lcov.info
```

That writes `.claude/testing/coverage-baseline.json` in the working root with the total, the commit it was taken on, the branch, the time and a schema identifier. Three rules to know:

- **It needs a total.** A report that instruments no line has none, and the command exits 1 and leaves the previous baseline where it was. A baseline of zero would read as a measured figure; this refuses to write one.
- **Only lcov is read.** A report in another format ends the reading command with exit 1, naming the report and the format that is supported.
- **Age does not matter, ancestry does.** The reader asks git whether the baseline's commit is an ancestor of the head. An old baseline on the change's own line of history is still the right comparison. A fresh one from a branch the head does not descend from compares the change against code it never had, so it reads as not usable and the signal is unobserved.

### The default-branch job

Run the two commands on every push to the default branch, and cache the file so a pull request's job can restore it. A GitHub Actions sketch; the other platforms differ only in the cache syntax:

```yaml
on:
  push:
    branches: [main]
jobs:
  coverage-baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm ci && npm run coverage
      - run: npx -p @renzrollon/interlock interlock verify baseline --report coverage/lcov.info
      - uses: actions/cache/save@v4
        with:
          path: .claude/testing/coverage-baseline.json
          key: coverage-baseline-${{ github.sha }}
```

The pull-request job restores the newest cache entry with that prefix, runs its own coverage command, and then:

```bash
interlock verify coverage --base origin/main --json > coverage-input.json
interlock merge-confidence <change> --changed <files...> --base origin/main --coverage coverage-input.json
```

`verify coverage` prints figures and no band: the head total, the base total and commit, whether that commit is an ancestor of the head, the changed-line coverage and how many changed lines there were, and the changed source files the report does not list with the lines the diff adds in them (`unreportedFiles` and `unreportedAddedLines`: only coverable source, never a test, a configuration file or a document). It runs no coverage command of its own unless you ask it to compute the base. A repository whose profile declares no coverage command gets an input that says coverage is not configured, which is not an error. A declared report that cannot be found exits 1 with nothing on standard output, so the verdict reads the signal unobserved rather than clean.

A baseline is looked for at the path you name, else in the working root, then in the state home, the way the test profile is found. Nothing is ever written into the state home.

## Computing the base on demand: `--compute-base`

A repository with no default-branch job has no baseline. `--compute-base` fills the gap for one run:

```bash
interlock verify coverage --base origin/main --compute-base --json
```

When no usable baseline exists, it checks the merge base out in a temporary worktree outside the repository, runs the profile's coverage command there, reads the report inside that worktree, records the total as the baseline for the merge base, and uses it. The worktree is removed whether the command passed, failed or never started, and standard error says a baseline was recorded. When a usable baseline already exists, nothing is created and nothing runs.

Its limits are the limits of a fresh checkout, and they are the reason the default-branch job is the recommended route:

- **No gitignored files.** Anything the coverage command expects that git does not track is not there. The test profile is read from the main working tree, so that part works.
- **No installed dependencies.** The worktree has no `node_modules` or equivalent. A coverage command that needs them fails; the worktree is still removed, and the command exits 1 naming the coverage command and its exit status. Nothing is recorded.
- **A shallow clone may lack the merge base.** The ancestor check then reads false, the baseline is unusable, and the signal is unobserved. The line on standard error names fetch depth. Fetch enough history, or the full history, in the job.

It runs the repository's own coverage command, so it costs what that command costs.

## Always-human-review paths, and why they are read from the base

Some paths need a person whatever the evidence says: a release script, a CI workflow, the policy file itself. `REVIEW.md` can say so in an `## Always Human Review` section, written as a list of paths in the same grammar as `## Do Not Report`. The two sections are parsed alike; they are consumed differently. The review never reads the always-human list: it drops, adds and re-bands no finding. Only the merge verdict reads it, and a changed path under a listed path makes the `policy.humanPaths` signal amber and marked as needing a person. The rules for the file, including what it cannot change, are in [12](12-repository-review-policy.md).

The lists are read from the base, not from the working tree. A pull request that can edit the list its own review obeys can remove its own paths from it. So with `--base <ref>`, `interlock review`, `interlock review-policy` and `interlock merge-confidence` take both path lists from the `REVIEW.md` committed at the reference, and take the advice prose from the working tree, where reading the copy the change proposes costs nothing because prose can never relax a gate.

What follows from that:

- **A pattern is not a path.** The lists hold paths and directory prefixes. An item that holds `*` or `?`, such as `src/**`, is reported as a problem and listed nowhere; read as a literal path it would match no file and say nothing. At the merge verdict a pattern in the always-human-review section committed at the base makes the signal amber, naming the item. List the directory instead: `src/`.
- **A difference is shown, not hidden.** When the working copy differs from the committed one, ignoring line endings, the output says so and names the reference whose lists were applied. At the merge verdict any edit to `REVIEW.md` makes the signal amber, because a change to review policy is a person's call.
- **A ship run reads from the commit it started on.** The run records that commit when it starts and applies the lists from it, raising `POLICY DIFFERS FROM BASE` when the working copy has moved. If no start commit could be recorded it reads the working tree and raises `REVIEW BASE NOT PINNED`, naming what it read from there. The meaning of each banner and what to do is in [04](04-when-it-stops.md).
- **A reference that names no commit exits 1** before any review is decided. An absent `REVIEW.md` at the reference declares no lists and is not a problem.
- **A branch that predates a policy change reads amber.** The evidence says the copy differs from the base. Rebasing clears it. Reading the merge base instead would let a stale branch apply a policy the base has since tightened.
- **No `--base`, no signal.** Without a reference the human-paths signal is unobserved, with that reason, and every command reads the working tree as it did before.

## Reading a spec audit

The domain reviewer is only as good as the contract the living specs carry. `interlock spec-audit` measures that, per capability, and never blocks: it exits 0 whenever it completes, as `drift` does, and a flag on a capability is a thing to read, not a failure.

```bash
interlock spec-audit          # a summary: the totals, then where to look
interlock spec-audit --json   # capabilities[], totals, unreadable[], graph
```

The two outputs carry different things. `--json` is the per-capability report: every capability is under `capabilities`, flagged or not, with all of its measures. The text output is a summary, in this order: the repository totals; each flagged capability with its flags, or that none is flagged; each requirement that states neither `SHALL` nor `MUST`, when there is one; each numeric literal in requirement prose with its spec, line and value; and the two graph measures, or the reason they were not measured. A capability that carries no flag has no row in the text output, because a table of every capability buries the flagged ones. The audit lists numeric literals, not path literals.

What each measure is, and what to make of it:

| Measure | How it is counted | What to read in it |
|---|---|---|
| Requirements without `SHALL` or `MUST` | A `### Requirement:` heading whose heading and prose carry neither | A requirement that states no obligation gives a reviewer nothing to contradict |
| Scenarios without a `GIVEN`, `WHEN` or `THEN` | `#### Scenario:` blocks, counting only the bulleted keyword lines | A count, not a flag. Missing `GIVEN` is common and often harmless; a missing `WHEN` or `THEN` is not a scenario |
| `Failure` and `Edge case` scenarios | Scenario titles beginning with those words, case-insensitively | A capability with none of one kind is flagged. A spec that only describes the happy path cannot catch a regression at its edges |
| Bound or prohibition lines | Lines in a requirement block containing `SHALL NOT`, `MUST NOT`, `never` as a word, `at most`, `at least` or `exactly once` | The invariants live here. A capability with none is flagged, because what it forbids is what a diff is most likely to break |
| Numeric literals in requirement prose | Each standalone number on a requirement's prose lines, outside inline code and scenario bodies, with its spec, line and value | A list for a person to classify. A number can be semantics or a threshold restated from the CLI; the audit never judges which |
| Broken file links | With a graph: files a capability's reliable spec-to-file edges name that no longer exist | The same definition `drift` uses. A broken link means the reviewer is pointed at a file that is gone |
| Source no spec names | With a graph: coverable source files no living spec's reliable edge names, as a count, a share and a list | The number to move. A changed file in this list is never selected for domain review by a link |

**Absent is not zero.** Anything the audit could not measure is printed with its reason. With no graph, the two graph measures are left out and say that no graph exists. With no `openspec/specs/`, it says no living spec exists. A spec it cannot read is named, left out of the totals, and the totals say how many specs they cover. If you see a figure, it was measured; if you see a reason, it was not.

**Read the output as a list of where to look, not as a score.** The audit has no pass mark, and this page states no count of this repository's corpus: every archive changes it, and the suite pins the structural invariants of the committed specs instead of the figures. The flagged capabilities and the unnamed source are the places a domain review has the least to hold a diff against.
