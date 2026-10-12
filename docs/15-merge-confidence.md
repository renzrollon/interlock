# 15 — Merge confidence: producing and reading its inputs

`interlock merge-confidence` answers "can this be merged?" from facts a review and a run already produce. This page is about the inputs that need something set up around them, and how to read the one report that tells you whether the specs can carry a review. It does not repeat the command's own reference. For the verdict, the signal table, the flags and every flag of the command, read [07 — CLI and configuration](07-cli-and-configuration.md#merge-confidence-interlock-merge-confidence). For the rules `REVIEW.md` follows, read [12 — Repository review policy](12-repository-review-policy.md).

The page covers what has landed. Labels on the merge request, the pipeline file and the platform recipes are not here yet.

## What the verdict is

One of three words, `MERGE`, `HUMAN` or `BLOCK`, a score, and one entry per signal saying what it saw and what would lift it. The verdict is the worst band over the gating signals, and a signal nobody could observe counts against you, not for you. Every threshold is in code: read `interlock limits` for a number, never this page.

Every gating signal has a producer. A change that was reviewed, verified, confirmed against the requirements it touches and named in the specs can read `MERGE`, and when a signal reads `unobserved` the reason names the fact about this change that is missing, never a capability the tool lacks. Two signals are covered below because the facts they read need something around them: the living requirements a change is asked to confirm, and whether the source it adds is named in a spec. A ship run's close states the verdict once, and writes the evidence a later command can assess again.

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

**Where a path mention belongs.** In the spec text, in the requirement or the scenario that describes the behaviour the file carries, written as a repository-relative path in backticks: `` `lib/new.mjs` ``. A leading `./` is read as the same path. Put it where a reviewer reading the requirement would want to be pointed at the code, not in a list at the bottom. A path inside a URL is not a mention. An example path in a scenario names a real file of that name if one exists, which is the graph's blind spot too, and `interlock spec-audit` is where numeric and path literals are listed for a person to read.

**Why an inherited file is a flag and an added one is not.** An added source file that no spec names is amber, needing a fix: the change is the moment to say what the file is for, and the fix is one path in a delta spec. A kept file whose only naming spec the diff changed or deleted is amber for the same reason, naming the file and the spec. A file the diff merely edits that nothing names and that lost no spec in this diff is the `legacy-unspecced` flag: it lowers the score, moves no band, and its evidence states how many such files the diff edits and how many tracked coverable source files are named out of how many exist. Holding every change to a file a repository never specced at `HUMAN` would be a reason no one on the pull request can act on.

**No graph is needed.** The facts are computed from spec text and git alone, so a CI job on a plain checkout reads the same band a developer's machine does. The signal needs a base, because an added file cannot be told from an edited one without a diff: with no `--base` it is `unobserved`, and so it is when the base is the head or ahead of it, because that diff is empty by construction.

## What a run's close records and prints

On a run that completed, `interlock run close` assesses merge confidence once, from the facts the run observed, and states the result in four places. A halted close assesses nothing: a diff that stopped part-way is not a candidate for merging, and "never assessed" has to stay distinguishable from a low score.

- **The summary** prints a block between the run's identity rows and the archive reminder. Its first line is the headline `interlock merge-confidence` prints first; below it, one row per group that has an entry (needs a fix, needs a person, needs more evidence), a `flags:` row and an `assessment:` row naming the evidence file. The block, and how to read it, is in [04](04-when-it-stops.md). A `living requirements:` row beside the conformance row prints the confirmed count over the checked one.
- **The receipt** carries a `mergeConfidence` block: the verdict, the score, the worst band, the signal counts, the ids of the driving signals and the flags. It carries no reason and no evidence line, because those can quote a finding's title and file. A run halted at close records the block as absent, not as a score of zero.
- **The outcome record** carries the same verdict as `mergeVerdict` in its observed group. Nothing that decides reads it back ([14](14-evals.md)), and `interlock report` reads none of it ([11](11-the-indicators.md)).
- **The evidence file** `.claude/ship/merge-confidence.json` holds what the run saw, for the command below.

What the close supplies, and what it cannot: the base is the commit the run started on, the changed paths are the commit's, and the review, the final verification verdict, the handoff counts, the coverage figures and the run record are this run's own. A review or verification file left in the working directory by an earlier run is not read; the close takes the review only when this run adjudicated one, and the verification only when it carries this run's identifier, so a lean run that follows a strict one reads `review.ran` amber for no review rather than borrowing the earlier run's. No pipeline is supplied: the run is offline and no platform has seen the commit it just made. **So no close reads `MERGE`.** A lean run reads `HUMAN` naming `review.ran`, a strict run `HUMAN` naming `ci.pipeline`. A run with no recorded start commit reads every signal that needs a base as `unobserved`, naming that. A run that made no commit, because it was told not to or because its commit step failed, reads the diff shape and spec coverage as `unobserved` for that reason, since its diff against its own start is empty.

The verdict never changes the close's exit code. A `BLOCK` at close is reported, not enforced; a gather that could not read a fact, an assessment that threw and an evidence file that could not be written are each spoken as a banner (`MERGE EVIDENCE UNAVAILABLE`, `MERGE CONFIDENCE NOT ASSESSED`, `MERGE CONFIDENCE NOT WRITTEN`) and none moves the exit code ([04](04-when-it-stops.md)).

**The review's dimension record.** `review.json` carries `dimensions: { selected, ran, unavailable, completed, skipped }`, the record `review.ran` reads. The CLI never watches one dimension run, because the review worker fans out inside its own context and reports `ok`. So "ran" means dispatched with its rubric in a review the worker reported complete, minus any selected dimension whose rubric could not be read, plus any dimension the agent added. A worker that returned nothing usable leaves `completed: false` and an empty `ran`. A skipped `domain` dimension reaches the verdict as the `domain-skipped` flag.

**Unticked tasks hold a run at `HUMAN`.** A run that left a task of the change unticked did not finish the change by this repository's own definition, and whether what remains matters is a person's call. `run.integrity` reads amber, needing a person, and names how many. A change with a task only a person can do therefore reads `HUMAN`, intentionally; the direction costs a look and never grants a merge.

## The run's evidence file and `--run`

`.claude/ship/merge-confidence.json` is written by a completed close, in the working root beside the run's review record. It is per-run working state, gitignored, and never written to the state home. It holds a schema identifier, the change, the run id, the base, the head commit, whether the run committed, the five inputs only the run observed (review, verification, handoff, coverage and the run record), and the assessment as the close made it.

```bash
interlock merge-confidence <change> --base <start commit> --run .claude/ship/merge-confidence.json --pipeline pipeline.json
```

`--run` supplies those five inputs, and **only for the commit the run made**. The file is used when it carries the schema identifier, names this change, records that the run committed, and records as that commit the head. Evidence is about a tree; a commit added after the run (an archive, a hand fix) describes a different one, so the review, verification and run-integrity signals return to `unobserved`, and stderr names both commits. For the same reason **a run that made no commit leaves no usable file**: it writes `committed: false`, which no later command can use, because it describes a working tree nobody can name. When any condition fails the command uses nothing from the file and says which one failed. A file that is not valid JSON exits 1 with no verdict.

Two rules keep the file honest. The verdict, the score and the signal results recorded in it are never read: the command always reassesses from the evidence, so editing the recorded verdict to `MERGE` over a surviving blocker still reads `BLOCK`. And an explicit `--review`, `--verify`, `--handoff` or `--coverage` replaces the file's entry for that input.

This is the route to a first `MERGE`. The pipeline is the one input a run cannot have, so the command with the run's file and a pipeline input for the head is where the verdict can be raised. `.claude/ship/` is gitignored, so a CI job that wants the file is handed it as an artifact, or a person runs the command on the machine that ran the ship; without the file `run.integrity` reads `unobserved` and `--require-merge` reads `HUMAN`.

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

`verify coverage` prints figures and no band: the head total, the base total and commit, whether that commit is an ancestor of the head, the changed-line coverage and how many changed lines there were. It runs no coverage command of its own unless you ask it to compute the base. A repository whose profile declares no coverage command gets an input that says coverage is not configured, which is not an error. A declared report that cannot be found exits 1 with nothing on standard output, so the verdict reads the signal unobserved rather than clean.

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

- **A difference is shown, not hidden.** When the working copy differs from the committed one, ignoring line endings, the output says so and names the reference whose lists were applied. At the merge verdict any edit to `REVIEW.md` makes the signal amber, because a change to review policy is a person's call.
- **A ship run reads from the commit it started on.** The run records that commit when it starts and applies the lists from it, raising `POLICY DIFFERS FROM BASE` when the working copy has moved. If no start commit could be recorded it reads the working tree and raises `REVIEW BASE NOT PINNED`, naming what it read from there. The meaning of each banner and what to do is in [04](04-when-it-stops.md).
- **A reference that names no commit exits 1** before any review is decided. An absent `REVIEW.md` at the reference declares no lists and is not a problem.
- **A branch that predates a policy change reads amber.** The evidence says the copy differs from the base. Rebasing clears it. Reading the merge base instead would let a stale branch apply a policy the base has since tightened.
- **No `--base`, no signal.** Without a reference the human-paths signal is unobserved, with that reason, and every command reads the working tree as it did before.

## Reading a spec audit

The domain reviewer is only as good as the contract the living specs carry. `interlock spec-audit` measures that, per capability, and never blocks: it exits 0 whenever it completes, as `drift` does, and a flag on a capability is a thing to read, not a failure.

```bash
interlock spec-audit          # a table per capability, then repository totals
interlock spec-audit --json   # capabilities[], totals, unreadable[], graph
```

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
