## Context

Review policy today lives in two places with two different trust levels, and neither is repo-owned:

- **Enforced, in the CLI.** `lib/review-core.mjs` decides which findings survive: the quality band and nit cap. The reviewer prompt in `workflows/ship.js` says so out loud — *"The CLI decides survival and applies the quality band. Do not filter findings yourself and do not restate a threshold — the numbers live in the CLI precisely so they are not re-argued here."* This is the thesis in miniature: the gate is code.
- **Advisory, in the prompt.** `RUBRIC_INSTRUCTIONS` (`workflows/ship.js:466`) and the review step (`ship.js:1669`) assemble what each reviewer reads.

A downstream repo cannot touch either without forking `skills/review-code`. There is no versioned, repo-owned surface for "in this repo, `dist/` is out of scope and Priya owns the bar."

The naive fix — a `REVIEW.md` whose contents are pasted into the review prompt — would put the nit cap into "markdown a model can talk past", which is exactly what Interlock exists to avoid. So the design's whole job is to route each piece of policy to the layer whose trust level matches it.

## Goals / Non-Goals

**Goals:**
- One optional, versioned, repo-root `REVIEW.md` a team owns without forking the plugin.
- Prose (owner, "Important" definition, exclusion rationale) reaches the reviewer as clearly-delimited repository policy.
- Do-not-report paths are enforced by the CLI as a finding-survival filter — never a prompt request.
- Absence changes nothing; corruption is reported, not silently swallowed.

**Non-Goals:**
- Moving the quality band or nit cap into `REVIEW.md`. Those stay in `lib/review-core.mjs`.
- A general config language. `REVIEW.md` is prose + a path list, not a rules engine.
- Per-dimension rubric overrides. Dimension criteria remain plugin-owned (`skills/review-code/dimensions/*.md`); this change does not touch `rubric-delivery`.
- Changing the evidence gate or severity enum. `evidence-gate` behaves identically.

## Decisions

### D1 — Policy is split by trust boundary, not by convenience

`REVIEW.md` has exactly two consumers, one per trust level:

| Section | Consumer | Trust | Effect |
|---|---|---|---|
| Prose (`## Owner`, `## What "Important" means`, `## Exclusions rationale`) | reviewer prompt via `RUBRIC_INSTRUCTIONS` | advice | reviewers read it; it cannot lower survival |
| Do-not-report paths (`## Do Not Report`) | `interlock review` (`lib/review-core.mjs`) | enforced | findings on these paths are dropped before the band is applied |

A model is never handed the path list as something to honor. The path list is data the CLI applies. This is the line that keeps the change on-thesis.

### D2 — Path exclusion is a canonical-prefix filter, reusing the existing canonicalizer

The exclusion test reuses `canonicalizePath` from `lib/risk.mjs` — the same function the wave planner uses so that `src/a.ts` and `./src/a.ts` are one identity (see `lib/waves.mjs` `predictedPaths`). A finding is excluded when its canonical file path is at or under a canonical excluded prefix. Consequences, stated so they are not surprises:

- `./dist`, `dist`, and `dist/` all canonicalize to the same prefix and exclude `dist/bundle.js`.
- Matching is **case-sensitive**, mirroring the default filesystem. `DIST/a.js` is not excluded by a `dist` rule. We do not fold case, because doing so would exclude files the filesystem treats as distinct — a silent over-exclusion is worse than a visible under-exclusion.
- A path that cannot be canonicalized (absolute, escaping the root) excludes nothing and is reported, exactly as unusable predicted paths are handled in the planner.

The exclusion happens **before** the band is applied, so it shrinks the input set but never alters the arithmetic on what remains (spec: "exclusions shrink the input but never lower the bar").

### D3 — Fail-open on absence, fail-loud on corruption

- **Absent** `REVIEW.md` → the review-core policy object is the empty policy; every code path behaves as today. No feature flag; absence *is* the off switch.
- **Malformed** `REVIEW.md` → `interlock review` emits a parse-failure note (naming the file and the unusable section) and proceeds under default policy. Each half is validated independently: a valid prose half still injects even if the exclusions block is broken, and vice-versa; the broken half is reported unusable rather than half-guessed. This is deliberately not fail-closed: a typo in a policy file must not block a ship run, but it must be visible.

### D4 — Parsing: front-matter for the owner, headed sections for the rest

`REVIEW.md` is Markdown. The owner is an optional YAML front-matter key (`owner:`); the prose and the path list are `##`-headed sections read by heading name. No new dependency: front-matter is a small hand-parse over the existing toolchain (the repo already hand-parses `.openspec.yaml`-style content). Section lookup is by normalized heading text. Unknown `##` sections are ignored (forward-compatible); a recognized heading with an unparseable body is the "malformed section" case in D3.

### D5 — Wiring points

- `lib/review-core.mjs`: add `readReviewPolicy(repoRoot)` → `{ prose, excludePaths, owner, problems: [] }`; apply `excludePaths` in the finding-survival step; expose `problems` for reporting.
- `bin/interlock`: `interlock review` locates repo-root `REVIEW.md`, passes the parsed policy into review-core, and includes `problems` + drop counts in its JSON. `USAGE` gains a line.
- `workflows/ship.js`: the review step reads the policy prose (via a small CLI surface, e.g. `interlock review-policy --json`, so the workflow — which cannot import modules — gets prose without re-parsing) and injects it into the reviewer instructions as clearly-delimited `REPOSITORY REVIEW POLICY (advice)`.
- `lib/limits.mjs`: if a scan bound is needed (max `REVIEW.md` size), publish it there rather than restating it in prose.

### D6 — Prose is delimited as data, never as instructions

Injected prose is wrapped in an explicit `REPOSITORY REVIEW POLICY (advice, not overriding the rubric or the evidence gate)` frame. This is the same posture the ship prompt already takes toward transcribed CLI output: the reviewer treats it as repository context, and the built-in rubric + evidence gate remain authoritative.

## Risks / Trade-offs

- **Prose can still mislead a reviewer.** A repo could write prose that argues for a lax bar. Mitigation: prose cannot change survival (D1); the enforced gate is unaffected. The worst case is a reviewer that under-raises, which the adversarial skeptic pass and the CLI band already guard against.
- **Case-sensitivity will surprise someone.** A macOS user on a case-insensitive filesystem might expect `DIST` to match `dist`. We accept a visible under-exclusion over a silent over-exclusion, and document it. (D2.)
- **Two CLI surfaces read the same file** (`interlock review` for enforcement, `interlock review-policy` for prose). They share one parser in `review-core.mjs`, so the file is interpreted once, in one place — the drift risk is bounded by a single reader.
- **Fail-open means a broken policy silently reverts to default** for the enforced half. Mitigation: the parse failure is reported in the review JSON and surfaced in the run summary, so "my exclusions aren't working" is diagnosable rather than mysterious.
