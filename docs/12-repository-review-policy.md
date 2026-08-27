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

`REVIEW.md` has exactly two consumers, one per trust level.

| Part of the file | Consumer | Trust | Effect |
|---|---|---|---|
| **Prose** — `## Owner` / front-matter `owner:`, `## What "Important" means`, `## Exclusions rationale` | the reviewer prompt | **advice** | reviewers read it as repository context; it can never lower survival |
| **`## Do Not Report` paths** | `interlock review` (the CLI) | **enforced** | findings whose file lies under a listed path are dropped before the band is applied |

The line that keeps this on-thesis: **a model is never handed the path list as
something to honor.** A path exclusion a model can choose to ignore is not an
exclusion. The list is data the deterministic CLI applies; the prose is advice a
reviewer follows.

### What `REVIEW.md` can change

- **Scope** — declare paths (`dist/`, `vendor/`, generated code) that are out of
  review entirely. The CLI drops findings on them and reports each drop with the
  excluding path.
- **Advice** — the local definition of "Important", the rationale for the
  exclusions, and the name of the person or role who owns the review bar. This is
  injected into every reviewer's prompt, clearly delimited as repository policy.

### What `REVIEW.md` cannot change

- **The survival band and the nit cap.** These stay in the CLI. A key that looks
  like a threshold (`nitCap:`, `minQuality:`, `band:`) is **reported as not an
  accepted field and ignored**, never adopted. A file that could edit the band
  would relocate the gate into markdown a careless edit — or a model — can talk
  past, which is the one thing this change refuses to allow.
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
- Only the **repository root** `REVIEW.md` is read. A file in a subdirectory is
  not policy.

## Path matching

Exclusions match on the **canonical path form** and are **case-sensitive**,
mirroring the default filesystem:

- `dist`, `./dist`, and `dist/` are the same rule and all exclude `dist/bundle.js`.
- On a case-sensitive filesystem, `DIST/a.js` is **not** excluded by a `dist`
  rule. Interlock accepts a visible under-exclusion over a silent over-exclusion:
  folding case would drop files the filesystem treats as distinct.
- A path that cannot be placed inside the repo (absolute, escaping the root)
  excludes nothing and is reported.

## Try it

```bash
interlock review-policy --json        # what the CLI parsed from your REVIEW.md
interlock review --findings f.json --verdicts v.json --changed <files> --json
#   → the JSON carries droppedByPolicy (with excluding paths) and policyProblems
```

Copy [`skills/review-code/REVIEW.template.md`](../skills/review-code/REVIEW.template.md)
to your repository root to start.
