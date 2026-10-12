# 15 — Merge confidence: producing and reading its inputs

`interlock merge-confidence` answers "can this be merged?" from facts a review and a run already produce. This page is about the inputs that need something set up around them, and how to read the one report that tells you whether the specs can carry a review. It does not repeat the command's own reference. For the verdict, the signal table, the flags and every flag of the command, read [07 — CLI and configuration](07-cli-and-configuration.md#merge-confidence-interlock-merge-confidence). For the rules `REVIEW.md` follows, read [12 — Repository review policy](12-repository-review-policy.md).

The page covers what has landed. Labels on the merge request, the pipeline file, the platform recipes and the per-signal table are not here yet.

## What the verdict is

One of three words, `MERGE`, `HUMAN` or `BLOCK`, a score, and one entry per signal saying what it saw and what would lift it. The verdict is the worst band over the gating signals, and a signal nobody could observe counts against you, not for you. Every threshold is in code: read `interlock limits` for a number, never this page.

Two signals have no producer yet, `conformance.living` and `spec.coverage`. Until they do, no input can read `MERGE`, and the output says so on a line of its own. That is the current state of the tool, not a fault in your setup.

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
