## 1. Policy parsing (review-core)

- [x] 1.1 Add `readReviewPolicy(repoRoot)` to `lib/review-core.mjs`: locate root `REVIEW.md`; return `{ prose, excludePaths, owner, problems }`. Absent file → empty policy, no problems (fail-open per D3).
- [x] 1.2 Parse the owner from optional YAML-ish front-matter (`owner:`) and read prose sections (`## What "Important" means`, `## Exclusions rationale`, owner text) by normalized heading; ignore unknown `##` sections (forward-compatible, D4).
- [x] 1.3 Parse the `## Do Not Report` path list; canonicalize each entry via `canonicalizePath` from `lib/risk.mjs`; an uncanonicalizable entry excludes nothing and is pushed to `problems` (D2).
- [x] 1.4 Validate each half independently: a broken section is recorded in `problems` and yields the empty value for that half, while the other half still parses (D3). Enforce a max-size scan bound read from `lib/limits.mjs`.

## 2. Enforcement (finding survival)

- [x] 2.1 In `lib/review-core.mjs` finding-survival, drop findings whose canonical file path is at/under any canonical excluded prefix — BEFORE the band is applied, so the arithmetic on remaining findings is unchanged (spec §5 edge case).
- [x] 2.2 Make the drop path-only and case-sensitive; a reviewer voting a finding real on an excluded path does not re-include it (spec §3 failure). Emit per-drop records naming the excluding path.
- [x] 2.3 Reject any band-like key found in `REVIEW.md` (e.g. `nitCap:`) as not-an-accepted-field into `problems`; never adopt it as a threshold (spec §5 failure).

## 3. CLI wiring (bin/interlock)

- [x] 3.1 `interlock review`: locate repo-root `REVIEW.md`, call `readReviewPolicy`, apply exclusions in survival, and include `problems` + drop counts (with excluding paths) in the JSON output.
- [x] 3.2 Add `interlock review-policy [--json]`: emit the parsed prose + owner (for the workflow to inject without re-parsing) and `problems`. Add both to `USAGE`.
- [x] 3.3 Publish any new scan bound through `interlock limits` / `lib/limits.mjs` rather than restating it in prose.

## 4. Prompt injection (workflows/ship.js)

- [x] 4.1 In the review step, obtain policy prose via `interlock review-policy --json` and inject it into the reviewer instructions as a clearly-delimited `REPOSITORY REVIEW POLICY (advice)` block, distinct from the built-in rubric (D6, spec §2).
- [x] 4.2 Ensure injected prose is framed as data and cannot displace `RUBRIC_INSTRUCTIONS` or the evidence gate; a malformed policy injects nothing but does not halt the run (spec §2 edge, §4).

## 5. Template, docs, and tests

- [x] 5.1 Ship a `REVIEW.md` template (documented shape: front-matter owner + the three `##` sections) and reference it from the plugin so a repo can copy it.
- [x] 5.2 Add a `docs/` page on the prose-vs-enforced split; amend `README.md` to state `REVIEW.md` is read, what it can change (scope, advice) and what it cannot (the band/nit cap).
- [x] 5.3 Unit tests over every scenario in the delta spec: absent/empty/malformed files; prose injection incl. injection-shaped text; exclusion happy path, vote-real-still-dropped, canonical-form edge (`./dist` vs `dist/` vs `DIST` on case-sensitive fs); band-key rejection; exclusions-shrink-input-band-unchanged.
