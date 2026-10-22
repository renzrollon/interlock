# CI trust: what a review should catch, and where to wire it

22 October 2026. Lessons from a whole-codebase security review of this repository and the session that handled its findings (`be8a234`, `7f56e12`, plus four rulesets and one Actions setting changed live through `gh api`). Written to feed the review skills and gates. This is a proposal, not a change.

## Verdict

1. **The worst exposures were not code, and a scored review nearly dropped them.** The review reported "no vulnerabilities at confidence 8 or higher". The `workflow_run` rollback scored 6/10, and the inert branch ruleset was not a finding at all. Both surfaced only because the owner asked a separate question about CI. A settings sweep has to be its own section of a review, not a candidate that competes for a confidence bar.
2. **Interlock's own gate routes CI changes to the right reviewer and then asks it the wrong questions.** `interlock surface` sets `needsDevopsReview` for CI configuration, and `skills/review-code/dimensions/devops.md` covers environment, dependencies, routes and build health. Nothing in it asks about triggers, token scope or what a privileged job installs. The diff that introduced `plugin-bundle.yml` would have passed that dimension clean.
3. **No new skill.** Three existing surfaces already fire at the right moment. Each needs a short, pinned checklist, listed under *Where to wire it* below.

## What the session found and fixed

| Finding | Visible in a diff? | Fix |
|---|---|---|
| `plugin-bundle.yml` follows `workflow_run: [Release]` by name, so a fork PR's same-named workflow on a branch called `v1.0.0` rolls the `release` branch back to that published version | yes | guard on `event == 'push'`, `head_repository.full_name == github.repository`, `path == '.github/workflows/release.yml'`; same on `pages.yml` |
| The bundle job held `contents: write` and ran `npm install -g @anthropic-ai/claude-code` | yes | split: `validate` (read-only) installs and validates; `bundle` (write) checks the handed tarball against the integrity recorded before the install |
| The publish job (holds `id-token: write`) ran `npm install -g npm@latest` | yes | `npm@12.2.0`, the version `@latest` resolved to for 1.7.0 |
| `ci.yml`, `evals.yml`, `ship-outcome-eval.yml` inherited the repository's default token scope | yes | `permissions: contents: read` |
| `writeBriefing` built a file path from planner-returned task ids | yes | clean at the sink, hash-suffix when changed; minted labels (`1.1+2`) unchanged |
| Ruleset `main` active with an empty include list: protected nothing | **no** | include `~DEFAULT_BRANCH` |
| `release` (what plugin users install) and `v*` tags unprotected | **no** | `release` ruleset (no force-push, no delete); `version tags` ruleset (admin-only) |
| Fork-PR approval only for first-time contributors | **no** | `all_external_contributors` |
| Five actions on Node 20 (a CI warning, not the review) | yes | next majors; release notes read for each |

`test/spine/github-workflows.test.mjs` now holds every tracked workflow to the guard, the pinning rule, an explicit scope, and a single writer (only the bundle job holds `contents: write`).

## Checklist for a diff that touches CI configuration

1. **Privileged triggers.** `workflow_run`, `pull_request_target` and `issue_comment` run with the base repository's token. `workflows: [Name]` matches on the name alone, and a fork can add a workflow with any name. The job's `if:` must check the upstream run's `event`, `head_repository.full_name` and `path`. Anything read from `workflow_run.head_branch` / `head_sha` that reaches a privileged step is attacker-chosen without those checks.
2. **A job's privilege is its token.** Any `write` scope (`contents`, `packages`, `pages`, `id-token`, `write-all`) makes the job privileged. In such a job nothing may be installed at a version chosen at run time: `@latest`, a bare `npm i -g pkg`, `npx`, `curl … | sh`, an image tag that moves. `actions/checkout` leaves the token in `.git/config`, so every step of the job can read it. The isolation boundary is the job (a separate VM), never the step.
3. **Splitting a job safely.** Record anything the write job trusts (version, integrity) in steps that run *before* the untrusted step: `GITHUB_OUTPUT` is per step, so a later step cannot rewrite them. Hand the bytes across as an artifact and verify the hash in the write job, so a tampered handoff fails rather than ships.
4. **Scope is stated.** Every workflow carries `permissions:` at the top or on every job; a default changed in the settings must not widen a job.
5. **Untrusted expressions.** `${{ github.event.* }}` (titles, bodies, branch names, commit messages) inside a `run:` is script injection. Pass it through `env:` and quote the variable.
6. **Action bumps.** Read the target ref's `action.yml` (`runs.using`) and the release notes of every major in between. Examples from this session: `upload-pages-artifact` v4 drops dotfiles, `download-artifact` v5 changed the by-id path and v8 fails on a digest mismatch.
7. **Model output that becomes a path.** An id a planner or model returned that is used as a file name gets cleaned at the sink. Keep the cleaning injective with a hash suffix, and check the real ids first: lane labels carry `+`, so the worktree filter would have renamed every multi-task briefing.

## Checks no diff shows (live repository settings)

1. **Effective rules, not declared ones.** A ruleset can be `active` with an empty `conditions.ref_name.include`. Read `gh api repos/<r>/rules/branches/<branch>` for every branch a workflow pushes to or users install from.
2. **The sweep:** default workflow permissions; fork-PR approval policy; which secrets exist; effective rules for the default branch, every branch a workflow writes, and release tags; `sha_pinning_required`.
3. **Required checks are names.** A required context must equal the check-run name exactly (`test (18)` for a matrix entry; a job's `name:` replaces its id). Read the names from `gh api repos/<r>/commits/<sha>/check-runs`. A wrong name blocks every merge.
4. **Bypass is per ruleset.** Keep rules with different bypass needs apart: force-push and deletion with no bypass, required CI with an admin bypass. Adding an admin bypass to the first would weaken it.
5. **A personal-account repository cannot exempt Actions.** GitHub reportedly refuses the Actions app (integration 15368) as a bypass actor outside an organization (community reports, not verified here). So restricting updates on a branch a workflow pushes to needs a deploy key or App token, which is a new long-lived secret. Weigh that against who actually holds write access.

## How the fixes were verified (reusable)

- **A guard is tested against real payloads before it ships.** The last two Release runs' `event`, `path` and `head_repository` were read with `gh api …/actions/workflows/release.yml/runs`. A guard that blocked the real release would have been a silent outage.
- **A pin is the last version known to work.** The version came from the previous run's log, was at least two weeks old, and its `engines` was checked against the runner's Node (`npm@12` needs `^22.22.2`).
- **A new pin test fails on the old tree.** Run it against `git archive HEAD` with only the new test copied in. It must fail there, for the reviewer's reason.
- **Pins cover a class, not a list.** The workflow rules iterate over `git ls-files .github/workflows`, so a workflow added later is held to them.
- **An integrity check is exercised on real bytes.** The published 1.7.0 tarball matched npm's own value, and a one-byte append failed the check.

## Where to wire it

| Surface | Change | Why there |
|---|---|---|
| `skills/review-code/dimensions/devops.md` (Interlock, shipped) | A **CI pipelines** group carrying checklist items 1–6, short | Already selected for CI files by `interlock surface`, and its findings go through the skeptics. A shipped surface: pin the tokens in `test/skills.test.mjs`. Under CONTRIBUTING this needs an OpenSpec change |
| `review-context` (user skill) | A `## ci-trust` section: per workflow, its triggers × token scope × secrets read × refs it pushes; then the live-settings sweep above | The only surface that runs outside a diff. It catches the inert-ruleset class every time the primer is refreshed, and every review lens reads it |
| `mr-code-review` (user skill, GitLab) | A Lens A sub-list when `.gitlab-ci.yml` or an `include:`d file is in the diff: fork MR pipelines run in the parent project only on a maintainer's trigger; protected variables reach only protected refs; `CI_JOB_TOKEN` scope; unpinned `image:` and `include: remote:` in jobs that deploy or publish | The same rules in GitLab's terms. It reads `## ci-trust` from the primer |
| Security review report shape | Live settings as their own section, never scored against the code-finding bar | Verdict 1 |

**Status, 22 October:** the `devops.md` checklist landed, pinned in `test/skills.test.mjs`. `review-context` gained `## ci-trust` (files plus a dated, read-only live sweep). `mr-code-review` Lens A now lists `## ci-trust` among the primer sections it reads; its GitLab-specific checklist was not added.
