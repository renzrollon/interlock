## Context

See `proposal.md` — Why. Three constraints shape the approach:

- **Interlock has zero runtime dependencies** (`package.json` carries no `dependencies` key; CI installs nothing). Nothing here may introduce one, and nothing here needs to.
- **The thesis is that thresholds live in code and advice lives in markdown** ([docs/12](../../../docs/12-repository-review-policy.md)). `REVIEW.md`'s path list is data the CLI enforces; its prose is advice a reviewer may weigh. This change supplies both halves and must not blur them.
- **A skill instruction nobody asserts is an instruction that silently stops running.** [docs/11](../../../docs/11-the-indicators.md) records the case: `interlock review --metrics` existed for a year, no skill ever passed it, and the corpus stayed empty in a way that read exactly like a loop that never ran. The fix was a test pinning the skill's command line. The new bootstrap step inherits that hazard and therefore that remedy.

## Goals / Non-Goals

**Goals:**

- Every repo-root policy surface Interlock reads is present and non-empty in Interlock's own repository.
- The corpus-persistence rule is written down once, in the page that already owns the corpora, and surfaced at the moment a repository is onboarded.
- Bootstrap's observation of gitignore state is correct for real `.gitignore` semantics, not for a naive substring match.

**Non-Goals:**

- Changing what `interlock review` does with `REVIEW.md`. The reader, the trust split and the drop reporting are already specified and already work; this change supplies the file they were built for.
- Auto-detecting whether a repository intends to run `ship` on its own product. Bootstrap cannot know this, and the spec deliberately requires a conditional recommendation rather than a verdict.
- Any `interlock doctor` involvement. Ruled out in the proposal: `doctor` exists to catch what stalls an unattended run, and mixing advice into a preflight teaches people to skim it.
- Deciding `AGENTS.md`'s contents. This change establishes that `CLAUDE.md` is canonical; `port-interlock-to-codex-cli` writes the pointer.

## Decisions

### D1 — `CLAUDE.md` is canonical; `AGENTS.md` becomes a pointer

The full instruction content lives in `CLAUDE.md`. When `port-interlock-to-codex-cli` lands, `AGENTS.md` is a one-line redirect to it.

*Why:* Claude Code is the primary host today, and the alternative — two files with the same content — is a drift site where the two hosts silently diverge on the conventions that govern the repo. A pointer cannot drift.

*Alternative considered:* `AGENTS.md` canonical, host-neutral from the start. Rejected as front-running: it makes this change depend on the shape of an unlanded 0/20-task change, and if that change's direction shifts, the canonical file moves twice.

*Consequence for this change:* `CLAUDE.md` states its own canonicality in one line, so the fact survives without depending on anyone reading this design.

### D2 — The corpus-persistence policy goes in `docs/11-the-indicators.md`, not a new page

[docs/11](../../../docs/11-the-indicators.md) already carries the one table naming all three corpora, their writers and their contents. The persistence rule attaches to that table as a new section.

*Why:* A new `docs/14-corpus-persistence.md` would be a page nobody arrives at. The question "should I keep these?" is only ever asked by someone already reading about what they contain.

*Alternative considered:* `docs/10-agentic-workflow-ship-and-spec.md`, which lists the corpus paths in its artifact inventory. Rejected — docs/10 describes the run's mechanics; docs/11 owns the corpora as a subject. docs/10 still gets its two stale lines fixed, but the policy does not live there.

### D3 — Bootstrap observes gitignore state with `git check-ignore`, not by reading `.gitignore`

The step runs `git check-ignore -q <path>` once per corpus path and reads the exit status.

*Why:* This is the load-bearing decision in the change. `.gitignore` semantics include negation (`!`), trailing-slash directory-only matching, `**` globs, precedence by order, and nested `.gitignore` files in subdirectories — and the *global* excludes file and `.git/info/exclude`, neither of which is in the repository at all. A model or a hand-rolled matcher reading the file will be wrong on some of these, and the spec's edge case requires per-path accuracy on exactly the split states most likely to be unintentional. `git check-ignore` is git's own matcher, so it is correct by construction.

*It also collapses two spec cases into the same branch:* outside a git repository `git check-ignore` exits non-zero with a message on stderr, which is the same "posture undetermined" branch as an unreadable `.gitignore`. The non-git case needs no separate detection.

*The permission this requires, which bootstrap does not currently have.* `skills/bootstrap/SKILL.md:7` declares `allowed-tools: Bash(openspec *) Bash(interlock-graph *) Agent Read Write Glob Grep` — no `Bash(git *)` in any form, and no `Bash(interlock *)` either. The step therefore needs `Bash(git check-ignore *)` added, narrowed to the one verb it uses. **This is load-bearing, not incidental:** because the requirement above routes a failed check to the undetermined branch, a denied tool call is indistinguishable from a repository with no `.gitignore`. Ship the instruction without the permission and the step reports `undetermined` on every repository forever while appearing to work. The permission is pinned as its own spec requirement for exactly that reason, and the widening happens in the same task that adds the instruction — they touch the same file, so they cannot be separate tasks in the same wave.

*Alternative considered:* parse `.gitignore` in `lib/`. Rejected — it means reimplementing git's matcher, and being subtly wrong about it, to avoid one narrowly-scoped permission line. Note that moving the check into a CLI subcommand does not dodge the permission question: `Bash(interlock *)` is absent from bootstrap's grant too.

### D3a — Bootstrap covers brownfield onboarding only, so the README carries the policy for everyone else

Bootstrap runs on repositories with code and no specs. A repository adopting Interlock with specs already in place, or starting greenfield through `/interlock:spec`, never invokes it. So bootstrap alone leaves the proposal's stated problem — consumers get no guidance — unsolved for those adopters.

*Decision:* the docs/11 section is the policy's home (D2), bootstrap raises it at onboarding (D3), and the README's install section gets one line pointing at it so every adopter passes the pointer regardless of entry path.

*Why not fix it inside bootstrap:* there is nothing to fix. Bootstrap's coverage is correct for what bootstrap is; the gap is that it was being treated as universal. Naming the boundary and adding one durable pointer costs a paragraph and closes it.

*Alternative considered:* accept the partial coverage and state it. Rejected as the cheaper half of a choice whose expensive half is also cheap — one README line is less work than the honest caveat explaining why there isn't one.

### D4 — The step lives in the skill's prose, pinned by a test — not in a new CLI subcommand

`skills/bootstrap/SKILL.md` gains one closing-summary step. `test/skills.test.mjs` asserts the step is still there.

*Why:* Interlock moves a decision into the CLI when something *reads it programmatically* and a model could otherwise re-argue it — that is what `interlock waves`, `gate` and `review` are for. Nothing consumes this posture; it is one advisory line for a human at the end of an onboarding. A subcommand would add CLI surface, a JSON contract and a test suite for a string nobody parses.

*The hazard this leaves* is the docs/11 hazard: prose instructions decay silently. The test is the specific countermeasure, and it is why the test is a task rather than an afterthought.

*Alternative considered:* `interlock doctor --json` gaining a persistence field. Rejected in the proposal, and separately here: doctor's output is consumed by the SessionStart hook, which would then surface a persistence opinion at every session start on every repo.

### D5 — `REVIEW.md` excludes test fixtures only

`## Do Not Report` lists `test/fixtures/` and `test/graph/fixtures/`.

*Why:* These are deliberately minimal, deliberately incomplete sample codebases — `test/graph/fixtures/mini-app`, `mini-py`, `mini-svc` exist to be *parsed*, not to be correct. A reviewer flagging a missing error path there is reporting on a prop. Every other path in the repository is real code and stays in scope.

*Explicitly not excluded:* `evals/` (real assets whose prompts and graders are worth review), `docs/` (a wrong doc is a real defect — [docs/10:248](../../../docs/10-agentic-workflow-ship-and-spec.md) in this very proposal is the proof), and `host-integration/` (named as vendored in `.github/workflows/evals.yml`, but absent from the checkout — listing a path that does not exist is policy theatre).

*Prose half:* `## Owner` and the local meaning of *Important* go in as advice. The definition reflects what the CLI already enforces rather than restating a threshold — per docs/12, a reviewer told a number will argue about the number.

*The boundary this file does not cross, recorded because it is invisible from the file itself:* `readReviewPolicy` is called from exactly two subcommands — `bin/interlock:1493` (`case 'review'`) and `bin/interlock:1527` (`case 'review-policy'`). `interlock gate` never reads it, and per docs/11 the artifact review reaches its verdict through `gate` rather than `review`. So a `## Do Not Report` path binds `review-code` and is inert for `review-artifacts`. Harmless for this exclusion set — artifact review reads artifacts and never reports on test fixtures — but a later maintainer adding a path meant to quiet artifact review would get silence rather than an error, so the exclusions rationale in `REVIEW.md` says which command the list binds.

### D5a — The specs are an instruction contract, following `implementer-prompts`

What ships for the bootstrap step is model-facing prose. The delta spec therefore states requirements about what `skills/bootstrap/SKILL.md` **instructs and declares**, verifiable by reading the file, rather than about runtime behaviour that only a metered model run could observe.

*Why:* the alternative was an eval case in `evals/` (8 cases today, run by `.github/workflows/evals.yml` on any `skills/**` change) exercising bootstrap against fixture repositories. Rejected by D4's own reasoning applied consistently: if this posture is not worth a CLI subcommand because nothing consumes it programmatically and it is one advisory line, it is not worth a metered model-behaviour case either. Spending eval budget here would rank an advisory summary line alongside `trampoline-halt` and `lane-partial-failure`.

*Why this is not a weakened spec:* `openspec/specs/implementer-prompts/spec.md` already pins assembled prompt text this way — its scenarios assert what the prompt names and states — and it is verified by the same static test stack that pins `interlock limits`. This capability is the same kind of object, so it takes the same shape.

*What the narrowing costs, stated plainly:* nothing verifies that a model **follows** the instruction, only that the instruction is present, correctly shaped, and permitted to run. That residual is the accepted trade, and it is the same residual every prose instruction in this repository carries.

### D6 — No new dependencies, and nothing to pin

This change adds two markdown files, one docs section, one skill step and one test. It introduces no library, no tool and no version. The pinned-version rule has nothing to bind.

## Risks / Trade-offs

- **`REVIEW.md` exclusions could hide a real defect in a fixture** → The CLI reports every drop with the excluding path, so a suppressed finding is visible rather than silent; and fixture correctness is already asserted by the tests that consume them, which is a stronger signal than a reviewer's read.
- **`CLAUDE.md` goes stale, and a stale instruction file is worse than none** → Keep it under a page so the whole thing is re-read on every edit, and confine it to facts that would otherwise be rediscovered by getting them wrong. The convention that a mistake seen twice gets written down is stated in the file itself.
- **The Codex change lands a full `AGENTS.md` anyway, producing two copies** → `CLAUDE.md` declares its own canonicality in-file, so the constraint is discoverable from the artifact rather than from this design doc, which that change's author may never open.
- **The bootstrap step decays silently once written** → This is the docs/11 failure mode by construction, and D4 accepts the risk explicitly in exchange for not adding CLI surface. The test in `test/skills.test.mjs` is the whole mitigation; if it is written as a brittle exact-string match it will be deleted at the first reword and the mitigation evaporates, so it asserts the three corpus paths and `git check-ignore` are mentioned, not a sentence.
- **`CLAUDE.md` or `REVIEW.md` is deleted or reverted and nobody notices** → This is the change's own premise recurring, and it is the reason the risk is listed rather than assumed away: `test/spine/review-policy.test.mjs` exercises the parser against temp fixtures and never touches the real repository root, so today a deleted `REVIEW.md` keeps every test green while silently restoring the empty policy. The mitigation is to assert both root files exist and are non-empty, and that `readReviewPolicy` on the real root returns a non-empty `excludePaths` — the same countermeasure D4 applies to the bootstrap step, applied to the files whose absence started this.
- **`git check-ignore` is a subprocess in a skill that could run in a sandbox without git** → It fails non-zero, which the spec already routes to the "posture undetermined" branch. Bootstrap completes either way; this is required by the spec, not merely tolerated.

## Migration Plan

No migration. Two new root files, one new docs section, two corrected doc lines, one skill step, one test. Nothing reads a persisted format that changes, and no existing behaviour is replaced.

Rollback is deleting `CLAUDE.md` and `REVIEW.md` and reverting the skill step; `interlock review-policy` treats an absent `REVIEW.md` as an empty policy, which is the current state.

The one ordering constraint: `REVIEW.md` takes effect on the next `review-code` run on this repository, so it should land before the change's own review rather than after, or the review that would first exercise it runs under the old empty policy.
