---
# Optional. The person or role who owns the review bar in this repository.
# This is the ONE accepted front-matter key. A key that looks like a survival
# threshold (nitCap:, minQuality:, band:) is reported and ignored, never adopted
# — the band and nit cap live in the CLI so they are not re-argued in markdown.
owner: <name or role, e.g. "Priya (platform)">
---

<!--
  REVIEW.md — a repository's review policy, read by `interlock review`.

  Copy this file to your repository ROOT as `REVIEW.md`. It is OPTIONAL: with no
  REVIEW.md, review runs exactly as it does today. It is split by trust boundary:

    - PROSE (the sections below) is ADVICE injected into the reviewer's prompt.
      It describes what "Important" means here and who owns the bar. It can never
      lower the survival threshold — the CLI decides survival regardless.

    - The `## Do Not Report` path list is ENFORCED by the CLI: findings whose
      file lies under a listed path are dropped when deciding survival. A model
      is never asked to honor it, because a path exclusion a model can ignore is
      not an exclusion.

  A malformed file is reported (in `interlock review` output and via
  `interlock review-policy`) and the run proceeds under default policy — a typo
  never silently changes or blocks a review. Unknown `##` sections are ignored.
-->

## What "Important" means

Describe, in this repository's terms, which findings are worth a blocker. For
example: "A blocker is a correctness bug reachable from a request handler, a data
loss, or an auth bypass. Style, naming, and test-only files are at most nits."

## Exclusions rationale

Explain WHY the paths below are out of scope, so a reviewer reading the policy
understands the intent. For example: "`dist/` and `vendor/` are generated or
third-party and are reviewed upstream, not here."

## Do Not Report

Repo-relative paths (files or directories) that are out of review scope.
Findings under these paths are dropped by the CLI before the quality band is
applied. Matching is on the canonical path and is case-sensitive, mirroring the
filesystem — `dist`, `./dist`, and `dist/` are the same rule; `DIST` is not.

- dist/
- vendor/
