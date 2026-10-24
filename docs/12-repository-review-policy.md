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

`REVIEW.md` has exactly three consumers, one per part of the file, and they sit at two trust levels.

| Part of the file | Consumer | Trust | Effect | Read from |
|---|---|---|---|---|
| **Prose** — `## Owner` / front-matter `owner:`, `## What "Important" means`, `## Exclusions rationale` | the reviewer prompt | **advice** | reviewers read it as repository context; it can never lower survival | the working tree |
| **`## Do Not Report` paths** | `interlock review` (the CLI) | **enforced** | findings whose file lies under a listed path are dropped before the band is applied | the base ref (`--base`), or the run's start commit; the working tree when neither exists |
| **`## Always Human Review` paths** | `interlock merge-confidence` (the CLI), and no other consumer | **enforced** | a change that touches a listed path, or edits `REVIEW.md` itself, reads amber on the `policy.humanPaths` signal and needs a person | the base ref (`--base`); unobserved without one |

The line that keeps this on-thesis: **a model is never handed a path list as
something to honor.** A path exclusion a model can choose to ignore is not an
exclusion. The lists are data the deterministic CLI applies; the prose is advice a
reviewer follows. That is also why the always-human-review list is consumed by
the merge verdict alone: no reviewer prompt carries it, no review drops or
re-bands a finding because of it, and `interlock review` reads and ignores it. It
cannot make a review stricter or looser. It can only make the verdict ask for a
person.

### Where each part is read from, and why

The two path lists are enforced, so a change must not be able to edit the copy
that is applied to it. A pull request that adds `src/legacy/` to `## Do Not
Report` would otherwise quiet the review of exactly the paths it touches, and one
that deleted a path from `## Always Human Review` would remove the person from the
decision about its own change. So the lists are read from a **base**:

- **`interlock review --base <ref>`** and **`interlock review-policy --base <ref>`**
  read both lists from the commit at the ref. `merge-confidence --base` reads the
  always-human-review list from the base **tip**, as GitHub reads `CODEOWNERS`
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

Both path lists (`## Do Not Report` and `## Always Human Review`) use the same rules. They match on the **canonical path form** and are **case-sensitive**,
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

## The `blast-radius` dimension and its recorded skip

`review-code` runs eight dimensions, and the eighth, `blast-radius`, is the one that asks who else a change touches. For every exported symbol or shared value the diff changes it asks, with `interlock-graph consumers <symbol>` before it reads any code, who calls it outside the diff, what those callers see before and after, what the change does to data and concurrency, and whether it can be rolled back alone. It reports in the shared finding schema under `dimension: "blast-radius"`, with the same three severities, and names the observing caller's file. It raises nothing for a change only the diff itself observes (additive plumbing), and nothing for a symbol with no consumer outside the diff; it says that in its summary. Because it is a dimension, its findings get the two skeptics, the quality band, the nit cap and `REVIEW.md`'s do-not-report paths like any other, and reach the merge verdict through the same file.

It runs whenever `.claude/graph/graph.json` exists. Without a graph the skill prints `BLAST RADIUS SKIPPED: no graph at .claude/graph/graph.json — run /interlock:graph`, the other dimensions still run, and the skip is written into the dimension record under `skipped` with its reason. That record is handed to `interlock review --dimensions <file>`, which validates and stores it, so the skip does not live in a line only the person watching saw: the merge verdict reads it as the `blast-radius-skipped` flag on `review.ran`, beside `domain-skipped` ([15](15-merge-confidence.md#the-flags)). The flag lowers the score and moves no band, since the other dimensions ran with their rubrics. Naming `blast-radius` in `--dimensions` with no graph is reported with the same skip line and not run silently. An unknown dimension name is refused with the list of the eight.

## This repository's own always-human list

This repository's `REVIEW.md` names `.github/workflows/` under `## Always Human Review`. A workflow edit can grant a token or change a trigger that no diff reviewer sees, so a merge request that touches one reads `HUMAN` on `policy.humanPaths` whatever its score, with the path in the evidence. The list stays that narrow on purpose: this repository has no `CODEOWNERS`, and `.github/` outside `workflows/` holds issue templates, a pull request template and agent prompts, none of which gates a merge. The list is read from the base ref, so a merge request cannot add or remove its own entry ([above](#where-each-part-is-read-from-and-why)). `interlock review-policy --json` lists it under `humanPaths`.

## Try it

```bash
interlock review-policy --json        # what the CLI parsed from your REVIEW.md
interlock review-policy --base origin/main --json
#   → both lists read from the ref, plus listsFrom and differsFromBase
interlock review --findings f.json --verdicts v.json --changed <files> --base origin/main --json
#   → the JSON carries droppedByPolicy (with excluding paths) and policyProblems
interlock merge-confidence --changed <files> --base origin/main --json
#   → the policy.humanPaths signal: green, or amber naming each touched path
```

Copy [`skills/review-code/REVIEW.template.md`](../skills/review-code/REVIEW.template.md)
to your repository root to start.
