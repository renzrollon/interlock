## Why

The skill that turns a shipped change into a reviewed pull request is called `/interlock:mr`. That name says less than `spec` and `ship`, and it uses GitLab's word for something both platforms have. The owner chose `settle` (2026-10-25): "spec, ship, settle". They want MR naming gone from every surface a person reads, with no backward compatibility.

## What Changes

- **BREAKING** `/interlock:mr` becomes `/interlock:settle` (`skills/mr/` → `skills/settle/`). No alias and no shim skill.
- **BREAKING** The `interlock mr <sub>` command family becomes `interlock settle <sub>`. The sub-verbs (`comment`, `replies`, `remediate-brief`, `fixer-result`, `conformance-brief`, `test-paths`, `tree-check`) stay the same. `interlock mr` becomes an unknown subcommand.
- **BREAKING** `interlock pipeline --gitlab-mr <file>` becomes `--gitlab-pr <file>`, and `--gitlab <file> --mr <file>` becomes `--gitlab <file> --pending <file>`.
- **BREAKING** The loop's work directory `.claude/ship/mr/` becomes `.claude/ship/settle/`, and the local artifact `openspec/changes/<change>/mr-summary.md` becomes `settle-summary.md`. Files left at the old paths are not read.
- The ship receipt's closing line names `/interlock:settle --create --review`.
- Prose across README, numbered docs, skills, shared prose, CLI help and errors, and the site pages says "pull request" (or "PR") where it said "MR", "MR/PR" or "merge request". GitLab's own tokens stay in code spans: `glab mr <verb>`, `glab ci get --merge-request`, `CI_MERGE_REQUEST_*`, `/merge_requests/`, `refs/merge-requests/`.
- The flow diagram's `mr` node becomes `settle`. The diagram footer and two docs lines that say decisions are "settled" before ship are reworded to "decided", so the verb is not used twice.
- A residue test fails if a retired name comes back to any shipped surface.
- CHANGELOG `[Unreleased]` is rewritten to the new names and gains one line for the rename. Released sections are left as written.
- The active change `close-the-merge-request-loop` (not yet archived) has its delta specs and its open task 8.5 edited in place to the new names. Its new capability `review/merge-request-loop` becomes `review/settle-loop`.

## Capabilities

### New Capabilities

None. The settle loop's own capability arrives with `close-the-merge-request-loop`, which this change edits in place.

### Modified Capabilities

- `review/merge-request-delivery`: the skill path in two requirements becomes `skills/settle/SKILL.md`. A new requirement says the skill and its command family are named `settle` and that no shipped surface names the retired `mr`.
- `review/pipeline-evidence`: the GitLab requirement names `--gitlab-pr` and `--pending` in place of `--gitlab-mr` and `--mr`.
- `hooks/tool-guards`: the commit-stage requirement cites `skills/settle/SKILL.md`.

## Impact

- Code: `bin/interlock` (import, usage, help routing, dispatch, pipeline flags), `lib/mr-cli.mjs` → `lib/settle-cli.mjs`, `lib/prompts/mr-remediate.mjs` → `lib/prompts/settle-remediate.mjs`, `lib/prompts/index.mjs`, `lib/cli-flags.mjs`, `lib/pipeline.mjs`, `lib/receipt.mjs`, and comment and prose edits in other `lib/` and `hooks/` modules.
- Scripts: `scripts/postinstall-smoke.mjs` argv; `scripts/gen-flow-svg.mjs` plus the four generated `docs/assets/flow-*.svg`.
- Skills: `skills/settle/SKILL.md` (moved), `dispatch`, `commit`, `review-code`, `manual-test-plan`, `shared/CONTEXT-HYGIENE.md`.
- Docs and pages: `README.md`, `CHANGELOG.md` `[Unreleased]`, `docs/01`, `03`, `04`, `06`, `07`, `09`, `10`, `12`, `15`, `site/DESIGN-PROMPT.md`, and `site/*.html`.
- Tests: `test/spine/mr-cli.test.mjs` → `test/spine/settle-cli.test.mjs`, `test/skills.test.mjs`, `test/spine/receipt.test.mjs`, `test/workflows.test.mjs`, `test/hooks.test.mjs`, `test/spine/pipeline.test.mjs`, `test/spine/merge-delivery.test.mjs`, `test/fixtures/pipeline/gitlab-mr-*.json` → `gitlab-pr-*.json`, and the new residue test.
- Anyone who installed 1.8.0 and typed `/interlock:mr`, or scripted `interlock pipeline --gitlab-mr`, has to switch to the new names. No dependency changes.
