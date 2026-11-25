# Proposal

## Why

Interlock reviews a pull request in one situation only: the author's own, on the current branch of the local working tree. `/interlock:settle` is that loop, and nearly every step it takes after the review is a write: a fixer edits the tree, each round commits and pushes, the description is replaced, labels are applied, a draft is marked ready. Every one of those is wrong on a colleague's branch.

The review engine underneath is already read-only and posts nothing, but it can only read `<base>...HEAD` of the local working tree. So the second use case, reviewing a team member's pull request, has no way in. The owner covers it today with three personal skills outside the plugin, which have no skeptics, no proof of coverage, no stable finding ids, and paste agent text into the platform note without inert rendering. The use case that faces other people is the one the engine's verification does not reach.

## What Changes

- **`/interlock:review-code --pr <ref>`** reviews a pull request named by number or URL. It reads the pull request from the platform, reviews the head the platform names in a detached worktree, removes that worktree, and prints one comment. It never touches the person's own working tree and never writes to the author's branch.
- **`interlock review target`** (new) reads the platform's own pull request document and writes a target file: the platform, the number, both commits as the platform states them, where the worktree goes, and the exact `git` argv to fetch, create and remove it. It refuses a fork, a pull request that is not open, and a document it does not recognise. It runs offline, as `interlock pipeline` does.
- **`--target <file>`** (new flag) on `interlock review brief`, `interlock review` and `interlock domain-context`. The root, the base and the head come from the target file, and the command refuses a worktree that is not at the pinned head. Nobody types a commit id or a path.
- **Reviewer and skeptic prompts under a target** name the review root, take the review context from the reviewer's own tree, and ask each reviewer to mark a defect the diff did not introduce. By default they tell the reviewer to read the code and run none of it.
- **`interlock review comment`** (new) renders the comment a colleague reads: the findings table with stable ids and inert reviewer text, as the settle comment has, under reader-facing weights (`Important`, `Nit`, `Pre-existing`), with the proof line, a line saying whether reviewers ran any code, and a closing line that this is an automated review and not an approval.
- **`Pre-existing`** is shown only when the reviewer marked the finding and the CLI confirms its line is outside the diff. Location alone is not enough: a regression the change caused usually sits on a line the change did not touch.
- **`--post`** posts that one comment. Without it the comment is printed and saved, and nothing reaches the platform.
- **`--run-code`** lets the reviewers run a single test file and the repository's own CLI, as they may on the author's path. Without it they read only. The skill itself runs none of the pull request's tests or builds either way, and reads the platform's checks through `interlock pipeline` instead.
- On this path the skill pushes nothing, commits nothing, fixes nothing, applies no label, edits no description, marks nothing ready, and never approves, requests changes, resolves a thread or merges. It records no autonomy outcome and derives no compound note: a colleague's finding is not this repository's ship loop's.
- A new docs page describes the path, what it never does, and which platform lines have been exercised.

No existing behaviour changes: without `--pr` and without `--target`, every command and every prompt is as it was.

## Capabilities

### New Capabilities

- `review/pull-request-review`: reviewing a named pull request read-only. Pinning it from the platform's document, the detached worktree and its removal, the `--target` binding, the reviewer comment and its weights, the `Pre-existing` rule, posting, and what the path never writes.

### Modified Capabilities

- `review/review-briefs`: the run-and-measure requirement gains the case of a target that does not allow running the code, and a new requirement covers what a prompt carries under `--target` (the review root, the review context's source, the pre-existing mark).

## Impact

- **Skill**: `skills/review-code/SKILL.md` gains a `--pr` section, three flags in its `argument-hint` (`--pr`, `--post`, `--run-code`) and narrow `gh` and `glab` grants in `allowed-tools` (view, comment, creating a note, the pipeline read, the sign-in check). This is a shipped surface, so each instruction is pinned by token in `test/skills.test.mjs`.
- **CLI**: two new `interlock review` leaves (`target`, `comment`) and one new flag (`--target`, on three commands). New modules `lib/review-target.mjs` and `lib/review-comment.mjs`; edits to `lib/review-cli.mjs`, `lib/prompts/review-dimension.mjs`, `lib/prompts/review-skeptics.mjs`, `lib/findings.mjs` and `lib/cli-flags.mjs`; usage lines in `cli/interlock`; two leaves in the post-install smoke inventory.
- **Docs**: a new `docs/17-reviewing-a-teammates-pull-request.md`, a row in `docs/07-cli-and-configuration.md`, and a `CHANGELOG.md` entry.
- **Dependencies**: none added. `gh` or `glab` is needed only on the `--pr` path, as settle needs it.
- **Platforms**: the GitLab lines are written from GitLab's and glab's documentation and are marked `not exercised`. The first run on a real pull request is the owner's, after this change ships.
- **Not affected**: `/interlock:settle`, the merge verdict, the gate, the ship loop's review step, and every review without `--pr`.
