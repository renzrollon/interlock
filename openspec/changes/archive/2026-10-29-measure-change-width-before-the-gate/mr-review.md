## Review coverage, change width, and strict artifact routing review — code review, regression and performance

Scope: `1b16c5e...efaf402` (5 commits, 192 files). No changes were made during review. Review is commits only; dirty tree excluded (untracked `openspec/changes/archive/2026-10-28-draw-the-settle-and-spec-panes-as-cards/settle-summary.md`).

**Gate:** build not run (no build script; `.claude/CLAUDE.md` Commands). `npm test` in the detached tree at `efaf402`: 4468 pass, 0 fail, 5 skipped. The skips are opt-in live/host tests (`INTERLOCK_ACP_COMMAND` unset; `INTERLOCK_LIVE_HOSTS` unset for claude, codex and qwen; `INTERLOCK_HARNESS_BIN` unset — the previous-release CLI runs only in CI's upgrade-install job). This diff did not cause them. `npm run validate` (`claude plugin validate . --strict`) passes. ESLint: not run (no lint script and no eslint config; `.claude/CLAUDE.md` says there is no lint step).

### 🔴 Critical / High

(none)

### 🟡 Medium – Low

| # | Sev | Category | Issue | Location | Suggested fix |
|---|---|---|---|---|---|
| M1 | Med | `correctness` `regression` | `provenPaths` unions `--changed` with `diffShape` when git succeeds, which is what review/review-proof requires so a typed list cannot drop a file. When `diffShape` throws, the catch warns and returns only the caller list. `computeProof` can then set `proven: true` on that subset, and merge-confidence reads `proof.proven`, not the warning. `changedSince` in the same file fails closed and returns every path. No test mentions the warning string. | `lib/review-cli.mjs:86-90` | On that catch, return null so `computeProof` takes the `NO_DIFF` path (`lib/review-proof.mjs:180`) and `proven` stays false. Mirror `changedSince` at `lib/review-cli.mjs:109-110`. |

### ❓ To investigate

- `checkCovers` (`lib/graph/graph/covers.mjs:35-36`): when `readIndexed` returns `ok: false`, the path is in neither `absent` nor `changed`, so `covers` exits 0. graph/staleness names only a missing manifest entry and a hash mismatch. No review caller was traced that feeds an unreadable source file.
- `provenPaths` ignores `diffShape`'s `nothingToDiff` (empty because `--base` is HEAD or a descendant, `bin/interlock:2956-2961`) and still unions `--changed`. The review-proof spec requires that union. Coverage signals treat `nothingToDiff` as unobserved (`lib/merge-confidence.mjs:815`). Left unpromoted.

### Agentic workflow / harness

| # | Sev | Category | Issue | Location | Suggested fix |
|---|---|---|---|---|---|
| E1 | Med | `security` `harness` | The ship review briefing and the fix-round briefing wrap `REVIEW.md` prose in a `"""` frame and do not escape a run of three quotes inside it. `composePolicy` takes that prose from the working tree (`lib/review-core.mjs:1172`), and `reviewPolicyAt` does the same when `--base` is set (`bin/interlock:2549-2558`), so the change under review can edit the text the worker is given. `assembleDimensionPrompt` already neutralises the delimiter (`escapeFrame`, `lib/prompts/review-dimension.mjs:32-34`). A `"""` in the prose closes the ship block and the following lines are instructions. Contract: prove-the-review-covered-the-diff, review/review-briefs, "Failure — instruction-shaped text cannot escape its block". | `lib/prompts/review.mjs:66`; `lib/prompts/remediate.mjs:81` | Run the same `escapeFrame` `quoted()` uses (`lib/prompts/review-dimension.mjs:32-40`) inside both `renderPolicyBlock` functions. |
| E2 | Med | `correctness` `harness` | `assembleReviewPrompt` tells the ship run's skeptics that a citation whose path is outside the diff fails. This change added `regression` to the strict always-on set the ship run selects (`lib/prompts/dimensions.mjs:33`, `lib/limits.mjs:579-580`). `evidencePathsFor` allows a `regression` or `blast-radius` refutation to cite the finding's own file (`lib/review-core.mjs:140-146`), and the skeptic prompt already says so (`lib/prompts/review-skeptics.mjs:37-38`). A ship skeptic that follows the briefing will not produce the citation that can dismiss an out-of-diff regression finding, so the finding survives. Contract: review/review-depth, "Edge case — a regression finding outside the diff can be refuted from its own file". | `lib/prompts/review.mjs:147-148` | Replace that sentence with the `EVIDENCE` sentence in `lib/prompts/review-skeptics.mjs:37-38`. |
| E3 | Low | `docs` `harness` | The skill description still says the review runs language, architecture, QA, devops, security, technical-lead and blast radius. This change made `regression` always-on at both depths (`lib/limits.mjs:575-580`). The body table lists nine dimensions and their triggers (`skills/review-code/SKILL.md:72-82`). The description names neither `regression` nor that devops, security and blast-radius are conditional. §2 tells the session to spawn `review.dimensions` from routing; the description is the text a session sees first. | `skills/review-code/SKILL.md:3` | Name `regression` in the description, and mark devops, security, domain and blast-radius as conditional. |

### ✅ Checked, no issue

- `resolveChange` default `archived: false` (`lib/artifacts.mjs:117`). 7 call sites in `lib/`: 6 pass `{ archived: true }` (`review-cli.mjs:303` and `:363`, `settle-cli.mjs:117`, `conformance.mjs:39`, `note-cli.mjs:65`, `merge-evidence.mjs:403`); `ready.mjs:710` keeps the two-argument form.
- `toleratedPaths(change)` still returns the active summary path (`lib/settle-cli.mjs:110-112`). The archived directory is the optional second argument, used only by tree-check and staging-pathspecs (`:834-836`, `:872-874`). 4 call sites, all in `lib/settle-cli.mjs`.
- Archive exclusion: `walkMarkdown` skips `openspec/changes/archive` in `lib/graph/extract/openspec.mjs`, `lib/graph/graph/build.mjs` and `lib/graph/retrieve/markdown.mjs`. `buildDocsIndex` default dirs are `docs` and `openspec/specs` (`lib/graph/retrieve/docs-index.mjs:14`).
- `computeProof` records a dimension with no `coverage` key as unproven (`NOT_RECORDED`, `lib/review-proof.mjs:148-149`). `proof.proven` is false when any gap remains (`:182`). `proofAnswer` exits 0 on `PROOF CAP REACHED` because review/review-proof requires that, and `interlock settle comment` prints `REVIEW NOT PROVEN` when `proof.proven` is not true (`lib/settle-cli.mjs:265-289`).
- `readReviewRan` ambers a missing or unproven proof (`lib/merge-confidence.mjs:328-351`). A green blockers signal names the proof and does not move its own band (`:222-231`). The verdict is MERGE only when every signal is green (`lib/merge-confidence.mjs:15-16`).
- `measureWidth` does not change `ready` (`lib/artifacts.mjs:380`, `:394-402`). `skills/spec/SKILL.md:244-248` reads `width.wide` and runs no artifact gate when it is true. `skills/spec/continuity.md:19` stops `--continue` when the artifact review wrote no findings file.
- Ship dimension selection uses `STRICT_ALWAYS_ON_DIMENSIONS` (`language`, `architecture`, `qa`, `technical-lead`, `regression`), which ship/run-program requires. Lean routing stays `language`, `technical-lead`, `regression` (`lib/limits.mjs:575-577`). `review-code` §2 spawns `review.dimensions` from `interlock routing`.
- `interlock-graph covers` exits 3 with no graph, runs `update` once on `--update` when lists are non-empty, then exits 1 if gaps remain (`lib/graph/cli.mjs:272-294`). That matches graph/staleness. `skills/review-code/SKILL.md:42-48` prints `GRAPH STALE` and records `blast-radius` under `degraded` on that exit 1.
- `escapeFrame` is applied to policy, review context and domain text on the CLI dimension brief (`lib/prompts/review-dimension.mjs:32-40`, `:137-150`). Domain text is appended only when `dimension === 'domain'` (`:150`).
- `bundledDimensions` returns `[]` if the briefs directory cannot be read, and `briefDimension` then exits with that empty list (`lib/review-cli.mjs:61-62`, `:288-290`). `review brief` dies when `base...HEAD` changes no file (`:296`).
- `listLivingCapabilities` returns no capabilities when `openspec/specs` cannot be read (`lib/artifacts.mjs:61-62`). It does not mark a change ready.
- No new dependencies, no new env keys, no raw SQL, no new routes. `package.json` is outside this range and still has no `dependencies` key.
- Width caps and `maxProofReruns` are read from `lib/limits.mjs` (`:171`, `:180`, `:187`). The spec skill names no width number; the unit suite passed, including the skill pins.
- `bin/interlock` is 237992 bytes and `lib/run.mjs` is 243335 bytes, both under the 245760-byte pin.
- The nine deleted `test()` blocks were replaced in the same files. The suite reported 0 failures, so the behaviour those names guarded is pinned by the replacements.
- Feature-off: archive exclusion is unconditional, which graph/staleness and settle-loop require. `--strict` is opt-in on `review-code` and `review-artifacts`; without it, routing's default depth is `lean`. The ship run's always-on set does not consult that flag, which ship/run-program requires.
