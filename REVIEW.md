---
owner: Carl Rollon
---

# Review instructions

Repository policy for `/interlock:review-code`. Scope and advice only — the survival band, the nit cap and every gate verdict live in the CLI, and this file cannot move them.

## Owner

Carl Rollon owns the review bar for this repository. Route a disagreement about what counts as Important here, or about an exclusion below, to the owner rather than arguing it inside a review.

## What "Important" means

Reserve Important for a finding that would break behaviour, leak data, or breach a stated policy of this repository. Three repo-specific cases qualify and are easy to miss:

- **A guard that fails closed.** Every hook in `hooks/` must allow on anything it cannot establish — unknown stage, unresolvable path, missing profile, its own crash. A guard that denies on a missing marker breaks ordinary work the moment the plugin is installed.
- **A threshold restated in prose.** A cap, band or verdict written into a skill or a reviewer prompt instead of read from the CLI. The numbers live in code so a model cannot re-argue them; a copy in markdown is a second source of truth that will drift.
- **A silent fallback.** A degraded path that does not say it degraded — a missing graph, an absent credential, an unreadable corpus — is worse than a failure, because nothing downstream can tell the difference between a clean result and a skipped one.

Naming, formatting and structure preference are nits. So is a suggestion to make the two corpus-loss policies "consistent": the outcome corpus and review metrics are deliberately never-fatal while the run trajectory and spill are deliberately fatal, and that asymmetry is the design.

## Exclusions rationale

The paths below hold deliberately minimal, deliberately incomplete sample code. `test/graph/fixtures/` contains `mini-app`, `mini-py` and `mini-svc` — tiny trees that exist to be *parsed* by the graph extractor, not to be correct or complete. `test/fixtures/` holds prompt and ACP fixtures in the same role. A finding that one of these lacks an error path is a finding about a prop.

Their correctness is already asserted more strongly than a reviewer could: the tests that consume them fail if a fixture stops producing the expected parse.

Nothing else is excluded. In particular `docs/` stays in scope — a wrong doc is a real defect, and this repository has shipped stale doc claims that survived review. `evals/` stays in scope too; its prompts and graders are real assets.

One boundary worth knowing, because it is invisible from this file: the path list below is read by `interlock review` and by `interlock review-policy`, and **not** by `interlock gate`. Artifact review reaches its verdict through `gate`, so an exclusion added here governs `review-code` and is inert for `review-artifacts`. That costs nothing today — artifact review reads change artifacts and never reports on fixtures — but a path added here expecting to quiet artifact review would be silently ignored.

## Do Not Report

- test/fixtures/
- test/graph/fixtures/
