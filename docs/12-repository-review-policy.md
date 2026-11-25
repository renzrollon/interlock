# 12 — Repository review policy (`REVIEW.md`)

Interlock's review has one bar that is deliberately hard to argue with: the CLI
decides which findings survive, applies the quality band and the nit cap, and
the reviewer prompt is told not to restate a threshold. *The numbers live in the
CLI precisely so they are not re-argued.* That is the thesis — caps and gates are
code, not markdown a model can talk past.

But a real repository does have policy it wants to own: which paths are simply
out of review scope, what "Important" means *here*, and who owns the bar. Before
`REVIEW.md`, tuning any of that meant forking the `review-code` skill. `REVIEW.md`
is the repo-owned, versioned surface for it — added **without** violating the
thesis, by routing each piece of policy to the layer whose trust level matches
it.

## The split: advice vs. enforced

`REVIEW.md` has exactly five consumers, one per part of the file, and they sit at two trust levels.

| Part of the file | Consumer | Trust | Effect | Read from |
|---|---|---|---|---|
| **Prose** — `## Owner` / front-matter `owner:`, `## What "Important" means`, `## Exclusions rationale` | the reviewer prompt | **advice** | reviewers read it as repository context; it can never lower survival | the working tree |
| **`## Do Not Report` paths** | `interlock review` (the CLI) | **enforced** | findings whose file lies under a listed path are dropped before the band is applied | the base ref (`--base`), or the run's start commit; the working tree when neither exists |
| **`## Always Human Review` paths** | `interlock merge-confidence` (the CLI), and no other consumer | **enforced** | a change that touches a listed path, or edits `REVIEW.md` itself, reads amber on the `policy.humanPaths` signal and needs a person | the base ref (`--base`); unobserved without one |
| **`## Artifact Review Lenses` and `## Artifact Checks`** | the artifact gate's brief (`interlock review brief --artifacts`), and `interlock review-policy suggest`, which reads the checks to name the stale ones | **advice** | the lens names replace the detected lenses; each check is quoted to the gate's reader, numbered `review-md.<n>`. Neither can set a threshold or move a verdict ([below](#the-artifact-sections)) | `HEAD`; the working tree when the repository has no commit, which then reads neither section |
| **`## Counts as Source` paths** | the `diff.shape` signal of `interlock merge-confidence` (the CLI), and the proof of coverage in `interlock review` | **enforced** | a changed file under a listed path is counted as source toward the size caps, whatever its name, where it would otherwise be set aside as a test or as prose; the proof of coverage reads it too, so an unread entry on a listed file stays unread. It can only keep an entry unread, never lift one | the base ref (`--base`); a ship run's close reads it from the run's start commit |

The line that keeps this on-thesis: **a model is never handed a path list as
something to honor.** A path exclusion a model can choose to ignore is not an
exclusion. The lists are data the deterministic CLI applies; the prose is advice a
reviewer follows. That is also why the always-human-review list is consumed by
the merge verdict alone: no reviewer prompt carries it, no review drops or
re-bands a finding because of it, and `interlock review` reads and ignores it. It
cannot make a review stricter or looser. It can only make the verdict ask for a
person. The counts-as-source list is scope of the same kind, read by one signal:
`diff.shape` sets documentation and test paths aside when it applies its caps
([15](15-merge-confidence.md#what-the-size-signal-counts)), and a path listed
here keeps counting. The review, the gate, the risk signal and the human-paths
signal never read it, and a problem in the section moves no signal but
`diff.shape`, which then counts every changed line and file and says why.

### Where each part is read from, and why

The three path lists are enforced, so a change must not be able to edit the copy
that is applied to it. A pull request that adds `src/legacy/` to `## Do Not
Report` would otherwise quiet the review of exactly the paths it touches, and one
that deleted a path from `## Always Human Review` would remove the person from the
decision about its own change. One that dropped its own prose from `## Counts as
Source` would take its own lines out of the size count. So the lists are read
from a **base**:

- **`interlock review --base <ref>`** and **`interlock review-policy --base <ref>`**
  read all three lists, and the two artifact sections the brief and `review-policy suggest` read, from the commit at the ref. `merge-confidence --base` reads
  the always-human-review and counts-as-source lists from the base **tip**, as GitHub reads `CODEOWNERS`
  from the base branch. A branch that predates a policy change reads amber on
  the signal until it is rebased, which is the safe direction: reading the merge
  base instead would let a stale branch apply a policy the base has since
  tightened.
- **A ship run** records the commit it started on and reads the lists from it,
  not from the working tree, so an edit the run itself makes to `REVIEW.md`
  cannot reach its own review.
- **The prose is read from the working tree.** It is advice and can never relax
  the gate, and an uncommitted edit to it reaching the reviewer is the behaviour
  that lets a person tune a review before committing.

A working copy that differs from the base is **said**, never silently resolved:
`review-policy --base` prints `differsFromBase`, a ship run raises `POLICY DIFFERS
FROM BASE` ([04](./04-when-it-stops.md#policy-differs-from-base-and-review-base-not-pinned)),
and `merge-confidence` reads `policy.humanPaths` amber naming `REVIEW.md`. Any
edit to the policy therefore reaches a person. With no base to read from, every
command falls back to the working tree as before, and a run says so with `REVIEW
BASE NOT PINNED`.

### What `REVIEW.md` can change

- **Scope** — declare paths (`dist/`, `vendor/`, generated code) that are out of
  review entirely. The CLI drops findings on them and reports each drop with the
  excluding path.
- **Who must look** — declare paths (`auth/`, `migrations/`, a payments
  directory) a person must see before the change merges. The merge verdict names
  each touched path and does not read `MERGE` while one is touched; the
  deterministic checks around it are unchanged.
- **Advice** — the local definition of "Important", the rationale for the
  exclusions, and the name of the person or role who owns the review bar. This is
  injected into every reviewer's prompt, clearly delimited as repository policy.

### What `REVIEW.md` cannot change

- **The survival band and the nit cap.** These stay in the CLI. A key that looks
  like a threshold (`nitCap:`, `minQuality:`, `band:`) is **reported as not an
  accepted field and ignored**, never adopted. A file that could edit the band
  would relocate the gate into markdown a careless edit — or a model — can talk
  past, which is the one thing this change refuses to allow. This holds in both
  path sections: a list item shaped like a threshold (`- nitCap: 0`) is reported
  and not read as a path.
- **Survival arithmetic.** Exclusions shrink the *input* set (findings on excluded
  paths never reach the skeptics), but the band and nit cap applied to what
  remains are identical to a run with no `REVIEW.md`. Exclusions lower the volume,
  never the bar.

## Behaviour: fail-open on absence, fail-loud on corruption

- **No `REVIEW.md`** → review runs exactly as it does without this feature.
  Absence *is* the off switch; there is no feature flag.
- **A malformed `REVIEW.md`** → the parse failure is reported (in the
  `interlock review` output and via `interlock review-policy`) and the run
  proceeds under default policy. Each half is validated independently: valid
  prose still injects even if the exclusions block is broken, and vice-versa. A
  typo in a policy file must never block a ship run — but it must be visible, so
  "my exclusions aren't working" is diagnosable rather than mysterious.
- Only the **repository root** `REVIEW.md` is read, from the working tree for the
  prose and from the base ref or the run's start commit for the two lists. A file
  in a subdirectory is not policy. A base that has no `REVIEW.md` is the empty
  list, so a policy added by the change under review is not applied to that same
  change.

## Path matching

All three path lists (`## Do Not Report`, `## Always Human Review` and `## Counts as Source`) use the same rules. They match on the **canonical path form** and are **case-sensitive**,
mirroring the default filesystem:

- `dist`, `./dist`, and `dist/` are the same rule and all exclude `dist/bundle.js`.
- On a case-sensitive filesystem, `DIST/a.js` is **not** excluded by a `dist`
  rule. Interlock accepts a visible under-exclusion over a silent over-exclusion:
  folding case would drop files the filesystem treats as distinct.
- A path that cannot be placed inside the repo (absolute, escaping the root)
  excludes nothing and is reported.
- **The lists hold paths and directory prefixes, never patterns.** An item that
  holds `*` or `?`, such as `src/**` or `docs/*.md`, is **reported as a problem
  and added to neither list**. The problem names the section it was found in and
  the item, and says that only a path or a directory prefix is read. Read as a
  literal path a pattern matches no file, so `- src/**` under `## Always Human
  Review` used to list nothing and say nothing, and every path under it read as
  not needing a person. List the directory instead: `src/` covers every file
  under it. Square brackets and braces are characters a real path may hold (a
  route directory such as `app/[id]/`), so they are read as part of the path.
  At the merge verdict a pattern in the always-human-review section committed
  at the base reads `policy.humanPaths` amber, needing a person, like any other
  problem in that section; the same item under `## Do Not Report` is reported
  wherever policy problems are and does not move that signal
  ([15](15-merge-confidence.md#always-human-review-paths-and-why-they-are-read-from-the-base)).
  The same item under `## Counts as Source` does not move it either: it makes
  `diff.shape` count every changed line and file, naming the item.

## The artifact sections

`## Artifact Review Lenses` and `## Artifact Checks` govern the artifact gate (`/interlock:review-artifacts`), never a code review. Each is a list of `- ` items with the path lists' structure rules: a code fence, or content with no list item, declares nothing and is reported, and text mixed with items is reported while the items are read. Unlike a path list, an item is **read as written**: it is not canonicalized as a path and is not refused as a pattern, so a check may end in `?` or name a glob such as `lib/*.mjs`. A threshold-shaped item (`- nitCap: 0`) is reported and never read, as in every other section.

Every problem either section reports names it in quotes, so it is classed as an `artifact` problem. A heading that names an artifact section but is neither known one, such as `## Artifact Lenses` or `## Artifacts Checks`, is reported too, naming itself and the two known headings, and declares nothing. The test is that its words hold `artifact` or `artifacts` with `lens`, `lenses`, `check`, `checks` or `review`, and that its last word is not `rationale`: `## Artifact checks rationale` is prose and stays ignored, as every other unknown heading does. An `artifact` problem reaches `interlock review-policy` and the brief, and moves neither the proof of coverage's counts-as-source list nor the merge verdict's `policy.humanPaths` signal: a typo in an advisory heading changes no enforced signal. A threshold-shaped line written without a `- ` is still caught by the body-wide scan, whose problem names no section, as it does anywhere in the file.

With a base, `composePolicy` takes both lists from it beside the path lists, and the artifact brief reads them from `HEAD`, so a change being spec'd cannot edit the checks it is judged under. `interlock review-policy` prints `artifact lenses: …` and `artifact checks: <n>`, and its JSON carries `artifactLenses` and `artifactChecks`. The shipped template carries both headings empty.

## What `review-policy suggest` reads

`interlock review-policy suggest` reads the repository's own history and lists rules `REVIEW.md` might gain. It never writes `REVIEW.md`: the owner does, because a rule that changes what the gate blocks is a decision. Four triggers raise a candidate:

- the same file escapes the spec in the compound-note rows of several changes;
- an artifact gate passes and the next gate of that change finds a blocker, read by a different reader;
- blockers carry the same `check` tag across several changes;
- an archived decision ledger row cites a human decision.

A fifth list names the checks that sat in the brief and caught nothing across enough gates. The counts those lines need are published by `interlock limits` (`minSuggestChanges`, `staleCheckGates`), not restated here.

**The window.** Evidence counts from the last commit that touched `REVIEW.md`, because revising the file is the owner acting on it, so the list shrinks when the owner acts. `--all` opens the window to every record, and so does a repository with no such commit; the output says which. Each source degrades aloud on its own status line. `/interlock:spec` and `/interlock:settle` print the one-line `--summary` form and continue when it is unavailable.

## The `blast-radius` dimension and its recorded skip

`review-code` has nine bundled dimensions, and `blast-radius` is the one that asks who else a change touches. For every exported symbol or shared value the diff changes it asks, with `interlock-graph consumers <symbol>` before it reads any code, who calls it outside the diff, what those callers see before and after, what the change does to data and concurrency, and whether it can be rolled back alone. It reports in the shared finding schema under `dimension: "blast-radius"`, with the same three severities, and names the observing caller's file. It raises nothing for a change only the diff itself observes (additive plumbing), and nothing for a symbol with no consumer outside the diff; it says that in its summary. Because it is a dimension, its findings get the two skeptics, the quality band, the nit cap and `REVIEW.md`'s do-not-report paths like any other, and reach the merge verdict through the same file. One difference in the evidence gate follows from where its findings point: a skeptic who refutes a blast-radius finding may cite the observing caller's file, the finding's own `file`, which lies outside the diff. For any other dimension a citation outside the diff still dismisses nothing.

It runs whenever `.claude/graph/graph.json` exists. Without a graph the skill prints `BLAST RADIUS SKIPPED: no graph at .claude/graph/graph.json — run /interlock:graph`, the other dimensions still run, and the skip is written into the dimension record under `skipped` with its reason. That record is handed to `interlock review --dimensions <file>`, which validates and stores it, so the skip does not live in a line only the person watching saw: the merge verdict reads it as the `blast-radius-skipped` flag on `review.ran`, beside `domain-skipped` ([15](15-merge-confidence.md#the-flags)). The flag lowers the score and moves no band, since the other dimensions ran with their rubrics, and a selected `blast-radius` (or `domain`) recorded as skipped counts as accounted for. A skip under any other name does not, so a skipped `security` still reads amber. Naming `blast-radius` in `--dimensions` with no graph is reported with the same skip line and not run silently. An unknown dimension name is refused with the list of the nine bundled dimensions.

## This repository's own lists

This repository's `REVIEW.md` names `.github/workflows/` under `## Always Human Review`. A workflow edit can grant a token or change a trigger that no diff reviewer sees, so a pull request that touches one reads `HUMAN` on `policy.humanPaths` whatever its score, with the path in the evidence. The list stays that narrow on purpose: this repository has no `CODEOWNERS`, and `.github/` outside `workflows/` holds issue templates, a pull request template and agent prompts, none of which gates a merge. The list is read from the base ref, so a pull request cannot add or remove its own entry ([above](#where-each-part-is-read-from-and-why)). `interlock review-policy --json` lists it under `humanPaths`.

It names `skills/`, `agents/` and `shared/` under `## Counts as Source`. They are model-facing prose and a shipped surface, where a reworded instruction is a behaviour change, so their changed lines count toward the size caps, and a reviewer who leaves one unread still fails the proof of coverage, although they are Markdown. `docs/` is not listed: it stays in review scope, because it is not under `## Do Not Report` and a wrong doc is a real defect, but its lines are set aside by `diff.shape`. `interlock review-policy --json` lists the three under `sourcePaths`.

## Try it

```bash
interlock review-policy --json        # what the CLI parsed from your REVIEW.md
interlock review-policy --base origin/main --json
#   → all three lists read from the ref, plus listsFrom and differsFromBase
interlock review --findings f.json --verdicts v.json --changed <files> --base origin/main --json
#   → the JSON carries droppedByPolicy (with excluding paths) and policyProblems
interlock merge-confidence --changed <files> --base origin/main --json
#   → the policy.humanPaths signal: green, or amber naming each touched path
```

Copy [`skills/review-code/REVIEW.template.md`](../skills/review-code/REVIEW.template.md)
to your repository root to start.
