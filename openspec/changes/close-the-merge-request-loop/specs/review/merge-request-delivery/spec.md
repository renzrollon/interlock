## MODIFIED Requirements

### Requirement: The skill SHALL hand the command only evidence about the commit under review

The skill SHALL take the base from the pull request's target branch as the platform reports it, and the checks from the platform's own document for that pull request, piped into `interlock pipeline`; it SHALL NOT take the checks' commit from the local repository, and for GitLab it SHALL NOT type a commit at all: the head travels from `--gitlab-pr` to `--gitlab` in the file the first step writes. When the run's evidence file `.claude/ship/merge-confidence.json` exists, the skill SHALL pass it with `--run` and leave the decision whether it is usable to the command, reporting the command's reason when it is not used in full. When the skill's own loop produced, in this pass and for the head under review, a review record, a verification verdict and a confirmation count under `.claude/ship/settle/`, each bound to that head, the skill SHALL pass them with `--review`, `--verify` and `--handoff`, naming the record of the last re-review and not an earlier round's, and SHALL pass the coverage figures the loop produced for the head with `--coverage` when, and only when, that file exists; it SHALL report the command's reason when it refuses any of them. The skill SHALL NOT pass a review, verification, handoff or coverage file left in the working directory by any other means, and without `--review` SHALL pass nothing from `.claude/ship/settle/`. The skill SHALL read nothing from the pull request's title, description or comments into the assessment. The skill SHALL tell the reader to push and assess again when the command reports that the pipeline input describes another commit.

Rationale: a verdict is a claim about one commit. A pipeline for the commit the platform holds, a run's evidence for the commit the run made, and a review of the head the loop pushed are three different claims, and the command can tell them apart only when each arrives with its own commit.

#### Scenario: Happy path — the skill's command lines carry the evidence flags

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds `--run` with `.claude/ship/merge-confidence.json`, `headRefOid` and `statusCheckRollup` on a `gh pr view` line piped into `interlock pipeline --github`, and a `--gitlab-pr` line followed by a `--gitlab` line carrying `--pending`
- **AND** the loop's `interlock merge-confidence` line carries `--review .claude/ship/settle/review-r<last>.json`, `--verify .claude/ship/settle/verify.json` and `--handoff .claude/ship/settle/handoff.json`, and `--coverage .claude/ship/settle/coverage.json` under the paragraph's condition that the file exists

#### Scenario: Failure — local commits the platform has not seen

- **GIVEN** a local head one commit ahead of the pull request's head, and the skill's commands run as written
- **WHEN** the command assesses
- **THEN** the pipeline input names the platform's head commit, the command reads the pipeline signal unobserved because it describes another commit, and the verdict is not `MERGE`
- **AND** the skill's text, pinned by token, tells the reader to push before assessing again

#### Scenario: Edge case — no evidence file, and one the command refuses

- **GIVEN** a pull request made by hand with no evidence file, and another whose evidence file describes an earlier commit that is not an ancestor of the head
- **WHEN** the skill's commands run for each
- **THEN** the first runs the command with no `--run`, and the block shows each run-supplied signal as the command read it with no file
- **AND** the second passes `--run`, and the skill reports the reason the command gave for not using the file
- **AND** neither, run without `--review`, passes a file from `.claude/ship/settle/`

## ADDED Requirements

### Requirement: With `--create` the skill SHALL push before it creates, SHALL create a draft when the loop will follow, and without `--create` SHALL push nothing

With `--create`, the skill SHALL push the branch before the create line: `git push -u origin HEAD` when the branch has no upstream, `git push` when it has one and the local head is ahead. With `--create --review` it SHALL create the pull request as a draft and mark it ready after the loop's last push and re-review, before the confirmation worker, whatever the verdict will be; with `--create` alone it SHALL create it ready, as before. Without `--create`, a branch that has no pull request SHALL stop the skill with a message that says to re-run with `--create` and that nothing was pushed. The GitLab lines of the push, the draft and the ready step SHALL be marked as not exercised.

Rationale: a pull request cannot be created without a pushed branch, so the flag always implied the push; it is a remote side effect all the same, and gets its own requirement. Code owners are not requested on a draft, so they are asked once, for the head they will read, and no approval is dismissed by a fix commit the loop was always going to make.

#### Scenario: Happy path — the push, the draft and the ready lines in order

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a `git push -u origin HEAD` line before the `gh pr create` line, `--draft` on that create line under the `--create --review` condition, and a `gh pr ready` line after the last `interlock settle replies` line and before the `interlock settle conformance-brief` line
- **AND** the paragraph around the create line says a pull request created without `--review` is created ready

#### Scenario: Failure — no pull request and no `--create`

- **GIVEN** the shipped skill
- **WHEN** the skill suite reads the stop message of the section that finds the pull request
- **THEN** it carries `re-run with` and `--create`
- **AND** it says nothing was pushed, and no fenced line before the create line runs `git push` outside the `--create` paragraph

#### Scenario: Edge case — the GitLab lines

- **GIVEN** the shipped skill
- **WHEN** the skill suite runs
- **THEN** the `glab mr create` line carries `--draft` under the same condition and the `glab mr update` line carries `--ready`
- **AND** each sits in a paragraph or block marked `not exercised`
