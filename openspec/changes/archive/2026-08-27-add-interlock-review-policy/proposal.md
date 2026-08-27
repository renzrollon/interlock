## Why

Interlock's review policy — which findings count as "Important", how many nits survive, and which paths are exempt from review at all — is hard-coded across `lib/review-core.mjs` (the enforced band) and `workflows/ship.js` (the reviewer prompt). A team that wants to tune any of it must fork `skills/review-code` and edit the workflow. There is no repo-owned, versioned place to say "in *this* repository, generated code under `dist/` is not reviewed, and Priya owns the review bar."

That gap is the opposite of Interlock's own thesis. The pitch is *caps and gates are code, not markdown a model can talk past*. Yet the one dial a downstream repo actually wants to turn is buried in plugin source it does not own. The fix is a versioned repo-root `REVIEW.md` — but the fix has to honor the thesis, not violate it: a policy file is only trustworthy if the parts that gate are still enforced deterministically, and only the parts that are advice are handed to a model.

## What Changes

- Add a versioned, repo-root **`REVIEW.md`** — an optional policy file with a named owner. It carries (a) prose the reviewer prompt should read (the definition of "Important", the review bar's owner, rationale for exclusions) and (b) a declared list of **do-not-report paths**.
- **Split policy by trust boundary.** The prose is injected into the review prompt (advice a reviewer follows). The do-not-report **paths become a CLI filter**: `interlock review` reads REVIEW.md's path list and drops findings on excluded paths when deciding survival — a model is never asked to honor them, because a path exclusion a model can ignore is not an exclusion.
- **The numeric band and nit cap do NOT move into REVIEW.md.** They stay in `lib/review-core.mjs` where "the numbers live in the CLI precisely so they are not re-argued." REVIEW.md tunes *what is out of scope* and *who owns the bar*, not the survival arithmetic.
- **Fail-open on absence, fail-loud on corruption.** No `REVIEW.md` → review runs exactly as it does today (no behavior change). A present-but-malformed `REVIEW.md` → the run reports the parse failure and proceeds under default policy, rather than silently discarding the file's intent.
- Wire the REVIEW.md path list into `interlock review` (new input honored when deciding finding survival) and its prose into `RUBRIC_INSTRUCTIONS` / the review step in `workflows/ship.js`.
- Document the file: a `REVIEW.md` template at the repo root shape, and a `docs/` section on the prose-vs-enforced split.

## Capabilities

### New Capabilities
- `review/policy-file`: reading an optional repo-root `REVIEW.md`; injecting its prose into the reviewer prompt; enforcing its declared do-not-report paths as a CLI-side finding filter; and the absent/malformed fallbacks.

### Modified Capabilities
<!-- No requirement of rubric-delivery or evidence-gate changes: the citation gate, the severity enum, and per-dimension rubric delivery all behave identically. REVIEW.md adds a survival filter and a prose channel around them, it does not alter them. -->

## Impact

- **New file (repo consumer):** `REVIEW.md` at repo root (optional; a template ships with the plugin).
- **Code:** `lib/review-core.mjs` (finding-survival path filter, REVIEW.md parse + validation), `bin/interlock` (`interlock review` reads/plumbs the policy; `USAGE`), `workflows/ship.js` (`RUBRIC_INSTRUCTIONS` / review step injects prose), `lib/limits.mjs` if any new bound is introduced.
- **Docs:** a new `docs/` page on the split; `README.md` note that REVIEW.md is read and what it can and cannot change.
- **No new dependencies.** Parsing is Markdown/front-matter over the existing toolchain.
- **Backward compatible:** repos without `REVIEW.md` see no change in review behavior.
