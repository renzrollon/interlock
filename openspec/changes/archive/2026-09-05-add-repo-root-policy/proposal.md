## Why

Interlock reads or ships support for three repo-root policy surfaces and applies none of them to itself. The gap is not cosmetic — in two of the three cases the machinery runs against empty input and reports success.

**`REVIEW.md` — the reader exists, the file does not.** `interlock review` parses a repo-root `REVIEW.md` and drops findings on its `## Do Not Report` paths; `interlock review-policy` prints the parsed result; [docs/12](../../../docs/12-repository-review-policy.md) documents the whole trust split. There is no `REVIEW.md` at this repo root, so every `review-code` run here has applied an empty policy. The reviewer has never been told that `test/graph/fixtures/**` is 14 files of deliberately fake code, and nothing records that as a decision — it reads exactly like a repo that considered exclusions and wanted none.

**`CLAUDE.md` — absent entirely.** Every session on this repository starts without the conventions that govern it. Three are load-bearing and non-obvious: the toolchain is zero-dependency stdlib Node (`package.json` has no `dependencies` key, and [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) installs nothing), the test command is a `find`-piped `node --test` invocation that a bare `node --test 'test/**'` glob silently breaks on Node 18/20 (recorded in `.claude/metrics/fix-tests-20260812-000000.json`), and gate thresholds live in the CLI specifically so a model cannot re-argue them ([docs/12](../../../docs/12-repository-review-policy.md)). An agent rediscovers each of these by getting them wrong.

**Corpus persistence — the policy is right here and undocumented everywhere.** This repo gitignores `.claude/ship/`, `.claude/metrics/` and `.claude/learning` ([.gitignore:19-29](../../../.gitignore)), which is correct *for this repo*: it is the plugin, its ship exhaust is development noise, and the evidence is on disk — `.claude/ship/runs.polluted-2026-08-29/` holds ~1018 entries that the archived `add-report-dashboard` diagnosis attributed 5690 of 5704 events to `change: "unnamed"` test pollution. But a repo that runs `/interlock:ship` against its own product has the opposite situation: the trajectory, the outcome corpus and the review metrics *are* the audit trail, and gitignoring them means the record dies with the developer's laptop. Interlock ships no guidance on this distinction, and `lib/doctor.mjs:93` checks only that `.claude/learning` is **writable**, never whether it is kept.

Two doc lines still describe the pre-fix state and read as open action items: [docs/10:248](../../../docs/10-agentic-workflow-ship-and-spec.md) asserts `.gitignore` does *not* cover `.claude/ship/`, and [docs/10:408](../../../docs/10-agentic-workflow-ship-and-spec.md) lists "Gitignore `.claude/ship/`" as work to do. Both were done.

## What Changes

- **New `CLAUDE.md` at the repo root** — commands, conventions, architecture, the mistakes that recur, and a *Verifying your work* block naming the test command and forbidding a green suite bought by weakening a check. Kept under a page, because it is read in full at every session start. It is the **canonical** root instruction file; when `port-interlock-to-codex-cli` lands `AGENTS.md`, that file becomes a one-line pointer here rather than a second copy to drift against.
- **New `REVIEW.md` at the repo root** — `## Owner`, the local meaning of *Important*, an exclusions rationale, and a `## Do Not Report` path list covering test fixtures and vendored host copies. Written to the split [docs/12](../../../docs/12-repository-review-policy.md) already defines: prose is advice to the reviewer, the path list is data the CLI enforces.
- **New corpus-persistence policy, documented and surfaced.** A docs section states the rule — a repo that runs `ship` on its own product commits the run corpora; a repo that only develops Interlock does not — with the recommended `.gitignore` block for each posture and the honest caveat that `.claude/learning/outcomes.jsonl` is a single append-only file and therefore a merge-conflict site when two branches ship in parallel, while per-run and per-review files are conflict-free because they are separate paths.
- **Modified `/interlock:bootstrap`** — its closing report covers the recommended corpus-persistence posture for the repo it just onboarded, observed per-path with `git check-ignore`. It never writes to the consumer's `.gitignore`: bootstrap is invoked to produce specs, and silently editing an unrelated file it was not asked to touch would be the wrong trade for a recommendation a person can act on in one line. The same change **widens bootstrap's `allowed-tools`** to admit `git check-ignore`, which its current grant does not — see Impact.
- **New one-line README pointer** — bootstrap only runs on brownfield repos with code and no specs, so greenfield adopters and repos that already have specs never reach its recommendation. The README install section is the one surface every adopter passes.
- **Fixed [docs/10:248](../../../docs/10-agentic-workflow-ship-and-spec.md) and [docs/10:408](../../../docs/10-agentic-workflow-ship-and-spec.md)** — both describe a gitignore state that no longer holds.

Explicitly out of scope: an `interlock doctor` check on persistence posture. `doctor` preflights conditions that **stall an unattended run**; a persistence opinion there is advice, not a blocker, and advice in a preflight becomes a nag people learn to skip past.

## Capabilities

### New Capabilities
- `bootstrap/corpus-persistence`: an **instruction contract** over `skills/bootstrap/SKILL.md` — it instructs a per-path posture report observed with `git check-ignore`, declares the tool permission that instruction requires, and instructs no write to `.gitignore`. Stated as an instruction contract rather than a runtime behaviour contract because what ships is model-facing prose; the shape follows `openspec/specs/implementer-prompts`, which pins assembled prompt text the same way.

### Modified Capabilities
<!-- None. `REVIEW.md` and `CLAUDE.md` add DATA to surfaces whose requirements already exist:
     the REVIEW.md reader and its trust split are specified under openspec/specs/review/,
     and CLAUDE.md is read by the host, not by Interlock. Supplying a file a specified
     reader already handles is not a requirement change. -->

## Impact

- **New root files** — `CLAUDE.md`, `REVIEW.md`. Both are read by existing consumers; neither adds a reader.
- **Behavioural blast radius of `REVIEW.md`** — every subsequent `review-code` run on this repo drops findings under the listed paths. This is the intended effect and it lowers finding volume; the drop is reported with its excluding path, so it is visible rather than silent.
- **`skills/bootstrap/SKILL.md`** — one new step in `## 6. REPORT`, plus a **permission widening** in the frontmatter. The current grant is `Bash(openspec *) Bash(interlock-graph *) Agent Read Write Glob Grep` — no `git` in any form, and no `Bash(interlock *)` either. Without `Bash(git check-ignore *)` the instructed command is denied at runtime on a consumer's repo, and because a failed check is routed to the "undetermined" branch, the denial is indistinguishable from a repo with no `.gitignore`: the step would report `undetermined` on every repo forever and look like it was working. Narrowed to `check-ignore`; no unrestricted `git`. No change to what bootstrap writes.
- **`docs/`** — one new section on corpus persistence; two stale assertions corrected in `docs/10-agentic-workflow-ship-and-spec.md`.
- **`README.md`** — one line, so adopters who never run bootstrap still reach the policy.
- **`test/skills.test.mjs` and `test/spine/review-policy.test.mjs`** — the bootstrap step, its permission and its no-write boundary are pinned, following the `--metrics` precedent in [docs/11](../../../docs/11-the-indicators.md) where an unasserted prose instruction silently stopped running for a year. `CLAUDE.md` and `REVIEW.md` are pinned too: the existing policy tests write fixtures into temp dirs and never touch the real root, so today deleting `REVIEW.md` keeps the suite green while restoring the empty policy — this change's own premise, recurring undetected.
- **No dependency, CLI-surface or exit-code change.** Zero runtime dependencies remain zero.
- **Interaction with `port-interlock-to-codex-cli`** — that change proposes `AGENTS.md` at the repo root. This change makes `CLAUDE.md` canonical and reduces that file to a pointer, removing a two-copy drift risk rather than creating one.
