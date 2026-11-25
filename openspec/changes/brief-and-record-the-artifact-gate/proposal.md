# Proposal

## Why

The artifact gate inside `/interlock:spec` reviews against a generic web-app checklist written into the skill's own prose. By default the session that wrote the artifacts is the one that reviews them. None of the repository's own review context reaches the gate (`REVIEW.md:31`: "inert for `review-artifacts`"), and its metrics record cannot say which depth or which reader produced it. The 2026-11-25 revisit (`.docs/REVIEW-ARTIFACTS-REVISIT-2026-11-25.md`, §5; a local, gitignored report, so the figures used here are restated) measured the cost over 65 gates. Of the 54 blockers, 18 were harness hazards the checklist does not name, and 9 were consumers or living requirements that the project's own context holds. Three passes were later overturned by a different reader. The owner answered D1–D4 the same day (§8). This change is items 1 and 2 of the §9.4 split, done as one change.

## What Changes

- **A brief the CLI assembles.** `interlock review brief --artifacts <change> [--lens <a,b>] [--since <findings file>]` prints the artifact reviewer's whole prompt:
  - an opening block of status lines that names every input and every degraded one;
  - the bundled base rubric, ending with the blocker definition, and the selected lenses;
  - quoted repository data: `REVIEW.md` prose and `## Artifact Checks`, `.claude/graph/REVIEW_CONTEXT.md`, the living requirements for the paths `tasks.md` names, and the matched compound notes;
  - the read-only rules and the emit shape.

  Both depths read the brief, and the strict reviewer is handed it verbatim. The two depths still differ only in who reads.
- **The rubric becomes bundled files.** It moves out of `skills/review-artifacts/SKILL.md` into `rubric.md`, `re-gate.md`, `lenses/agentic-harness.md` and `lenses/web-ui.md` beside it. The base rubric is reworked (report R2, R7):
  - each scenario's GIVEN produces its THEN, and the THEN is observable;
  - traceability both ways, an omissions question, and one term per meaning;
  - proportionality, and verification inside each task, which agrees with OpenSpec 2.0;
  - Non-Goals, alternatives and rollback asked for as content, not as new headings.

  The accessibility and loading lines move into the `web-ui` lens.
- **Lenses chosen per run.** The order is `--lens`, then `REVIEW.md` `## Artifact Review Lenses` read from HEAD, then CLI detection, then none. The brief prints where its lenses came from. An unknown name is printed and skipped, so the gate never stops for a lens. A cap that `interlock limits` publishes bounds how many lenses run.
- **Two new `REVIEW.md` headings.** `## Artifact Review Lenses` and `## Artifact Checks` are read from the base, like the path lists. A heading that names an artifact section but is not one of the two is a reported problem, never silently ignored. A problem in these sections changes neither the proof of coverage nor the merge verdict, which read only the path lists. `interlock review-policy` prints both.
- **Spec's own gate reads independently by default (D1).**
  - `interlock routing` gains `--caller <skill>`.
  - A published `CALLER_DEPTH` table answers `strict` for `artifact-reviewer` when the caller is `spec`.
  - `/interlock:spec` passes `--caller spec` to its gate, so its default gate is one routed `interlock:reviewer`.
  - `--lean` returns either skill to the inline read.
  - A standalone `/interlock:review-artifacts` and review-code keep their defaults.
- **The record says what ran (R3).** The review-metrics record gains `stage`, `depth`, `reviewer` and `lenses`. `interlock gate --stage --depth --reviewer --lenses` sets them, and so do the two code-review writers. An absent or unknown value records `null`, never a guess. The schema id stays `interlock.review-metrics/1`, so an older reader still recognizes the record.
- **The report splits the figures.** `interlock report` splits the review-metrics figures by stage, and within a stage by depth and reader. A record that names none of them is counted as unrecorded.
- **Small gate fixes.**
  - Drop the unused `Bash(openspec *)` grant, and add `Bash(interlock-graph *)` for the invariant check.
  - Add a SUGGESTION line to the Output block.
  - A finding may carry an optional `check` tag that names the lens question or Artifact Check that raised it.

## Capabilities

### New Capabilities

- `spec/artifact-review-brief`: the CLI-assembled artifact reviewer prompt, the lens order and detection, and the bundled base rubric and lenses.

### Modified Capabilities

- `spec/artifact-gate-depth`: both depths read the printed brief; spec's gate defaults to the routed reader; `--lean`; the fallback when the brief cannot be printed; the gate line records the depth, the reader and the lenses.
- `spec/machine-readable-gate-lines`: the artifact-review gate line carries the recording flags.
- `spawn-routing`: `--caller` and the published caller depths, the review-artifacts spawn site passing it, and the spec skill naming the gate's reviewer among the routed workers.
- `review/policy-file`: the two artifact headings, read from the base, and the misnamed-heading problem.
- `review/metrics-emission`: the record names the stage, depth, reader and lenses that produced it.
- `report/indicators`: the review-metrics figures split by stage, depth and reader.

## Impact

- **Code:**
  - new: `lib/prompts/artifact-review.mjs`, `lib/artifact-lenses.mjs`;
  - changed: `lib/review-cli.mjs`, `lib/review-core.mjs`, `lib/merge-evidence.mjs`, `lib/routing.mjs`, `lib/limits.mjs`, `lib/metrics.mjs`, `lib/run.mjs`, `lib/report.mjs`, `lib/report-html.mjs`, `lib/cli-flags.mjs`, `lib/prompts/index.mjs` (the new assembler's registration) and `lib/prompts/domain-context.mjs` (an optional lead for the artifact brief; the default is unchanged);
  - `cli/interlock` gets usage lines and dispatch only, because it has about 3.2 KB of headroom left (design D12).
- **Skills and prose:** `skills/review-artifacts/SKILL.md` and its four new bundled files, `skills/spec/SKILL.md`, `shared/TOOL-ECONOMY.md`, `skills/review-code/REVIEW.template.md`, and `REVIEW.md:31`, which this change makes false.
- **Docs:** `docs/07`, `10`, `11`, `12`, `16` and `CHANGELOG.md`.
- **Cost:** every default `/interlock:spec` gate now spawns one routed reviewer (D1). Every artifact gate's prompt also carries the project context it lacked.
- **Not in this change:** these are later items of the §9.4 split: the snapshot-based `--since` (R4), `interlock review-policy suggest` (T1–T4), gate evals (R6), the requirement-wording lint (R8) and cited blockers (R9).
