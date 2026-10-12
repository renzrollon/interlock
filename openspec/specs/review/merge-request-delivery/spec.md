# review/merge-request-delivery Specification

## Purpose
How a change's merge verdict reaches its merge request: the `mr` skill asks the CLI for the verdict, writes the CLI's block into the description and applies the CLI's labels, so the surface a reviewer uses to decide how hard to look is never a number a model wrote.

## Requirements

### Requirement: The skill SHALL obtain the verdict from the CLI and SHALL NOT state a confidence of its own

`skills/mr/SKILL.md` SHALL run `interlock pipeline` to produce the pipeline input and `interlock merge-confidence` with `--base`, `--pipeline` and `--json` to obtain the verdict, on fenced command lines. It SHALL name `verdict` as the field that decides, and `score`, `driving`, `flags`, `labels` and `head` as the fields it reports from, each written as a backticked key. It SHALL say that an exit status of 1 with a verdict on standard output is the verdict `BLOCK` and not a failed command, and that when `interlock pipeline` or `interlock merge-confidence` exits non-zero with nothing on standard output the skill stops the assessment, reports the reason, and writes no `## Merge confidence` section and no label. The skill SHALL NOT ask for, or contain, a confidence level written by the model: `## High Risk Changes` SHALL be narrative under the CLI's verdict. The command lines and field names SHALL be pinned by token in the skill suite, so a reword that drops one fails the suite naming it.

Rationale: the description's risk section was the one place a reviewer was told how hard to look, and it was a level a model wrote. An instruction no test asserts is an instruction that stops running at the first reword.

#### Scenario: Happy path — the shipped skill satisfies every pin

- **GIVEN** the shipped `skills/mr/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds an `interlock pipeline` line for each platform and an `interlock merge-confidence` line carrying `--base`, `--pipeline` and `--json`
- **AND** it finds each of the six field names as a backticked key, the word `BLOCK`, and `disable-model-invocation: true` in the front matter

#### Scenario: Failure — a self-assessed confidence fails the suite

- **GIVEN** a copy of the skill in which a sentence asks the model to state a confidence level
- **WHEN** the skill suite runs
- **THEN** it fails naming the phrase

#### Scenario: Edge case — dropping `--json` from the verdict line fails the suite, and a prose mention does not satisfy it

- **GIVEN** a copy of the skill whose `interlock merge-confidence` line lacks `--json`, with the words `--json` present in a sentence elsewhere
- **WHEN** the skill suite runs
- **THEN** it fails naming the line

### Requirement: The skill SHALL hand the command only evidence about the commit under review

The skill SHALL take the base from the merge request's target branch as the platform reports it, and the checks from the platform's own document for that merge request, piped into `interlock pipeline`; it SHALL NOT take the checks' commit from the local repository, and for GitLab it SHALL NOT type a commit at all: the head travels from `--gitlab-mr` to `--gitlab` in the file the first step writes. When the run's evidence file `.claude/ship/merge-confidence.json` exists, the skill SHALL pass it with `--run` and leave the decision whether it is usable to the command, reporting the command's reason when it is not used. The skill SHALL NOT pass a review or verification file left in the working directory by any other means. The skill SHALL read nothing from the merge request's title, description or comments into the assessment. The skill SHALL tell the reader to push and assess again when the command reports that the pipeline input describes another commit.

Rationale: a verdict is a claim about one commit. A pipeline for the commit the platform holds and evidence for a commit only the local clone holds are two different claims, and the command can tell them apart only when each arrives with its own commit.

#### Scenario: Happy path — the skill's command lines carry the evidence flags

- **GIVEN** the shipped `skills/mr/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds `--run` with `.claude/ship/merge-confidence.json`, `headRefOid` and `statusCheckRollup` on a `gh pr view` line piped into `interlock pipeline --github`, and a `--gitlab-mr` line followed by a `--gitlab` line carrying `--mr`

#### Scenario: Failure — local commits the platform has not seen

- **GIVEN** a local head one commit ahead of the merge request's head, and the skill's commands run as written
- **WHEN** the command assesses
- **THEN** the pipeline input names the platform's head commit, the command reads the pipeline signal unobserved because it describes another commit, and the verdict is not `MERGE`
- **AND** the skill's text, pinned by token, tells the reader to push before assessing again

#### Scenario: Edge case — no evidence file, and one the command refuses

- **GIVEN** a merge request made by hand with no evidence file, and another whose evidence file describes an earlier commit
- **WHEN** the skill's commands run for each
- **THEN** the first runs the command with no `--run`, and the block shows each run-supplied signal as the command read it with no file
- **AND** the second passes `--run`, and the skill reports the reason the command gave for not using the file

### Requirement: The description SHALL carry the CLI's block unedited, naming the commit assessed

The skill SHALL obtain the description block from `interlock merge-confidence --markdown` and place it in the description as printed, under its own `## Merge confidence` heading. The skill SHALL NOT re-derive a band, a score or a signal's state, and SHALL NOT reorder or summarise the block. With `--confidence-comment` the skill SHALL also post the same block as a comment; without it no such comment SHALL be posted.

#### Scenario: Happy path — the block is in the description as printed

- **GIVEN** a verdict of `HUMAN` with two driving signals
- **WHEN** the description is composed
- **THEN** it contains the block the command printed, including the commit and the base, with no line changed

#### Scenario: Failure — the command printed no block

- **GIVEN** a `merge-confidence` command that exited 1 with nothing on standard output because an input could not be read
- **WHEN** the skill reaches the description
- **THEN** it writes no `## Merge confidence` section and no label, and reports the command's reason

#### Scenario: Edge case — the comment is opt-in

- **GIVEN** two runs of the skill on the same merge request, one with `--confidence-comment`
- **WHEN** each publishes
- **THEN** only the run with the flag posts the block as a comment

### Requirement: The skill SHALL apply one verdict label and one score label, after removing their predecessors, and only for the commit that was assessed

The label names SHALL be the ones the command printed under `labels`; the skill SHALL NOT contain or compose a label name. Before applying, the skill SHALL read the merge request's head commit from the platform again. When it equals `head.sha` from the command's output, the skill SHALL remove from the merge request every label it currently carries that is one of `labels.verdictNames` or starts with `labels.scorePrefix`, then add `labels.verdict.name` and `labels.score.name`. When it differs, or `head` is null, the skill SHALL remove those labels, add none, and say that the head moved. The skill SHALL remove and add even when the verdict is unchanged, so the platform records the new assessment. A label that cannot be created or applied SHALL be reported, never passed over. The skill SHALL NOT merge, approve or request changes on a merge request, and SHALL say so.

Rationale: a label is a claim about a commit, and the platform keeps a label when new commits arrive. A merge label left on a head nobody assessed is the failure this requirement exists to prevent. What a label means for merging is the platform's policy; the skill's part ends at the label.

#### Scenario: Happy path — a re-assessment replaces the labels

- **GIVEN** a merge request labelled `interlock/human-review` and `interlock/score-61`, and a new verdict of `MERGE` with a score of 93 for the head the platform still reports
- **WHEN** the skill labels
- **THEN** the merge request carries `interlock/merge` and `interlock/score-93` and neither earlier label

#### Scenario: Failure — the head moved between the assessment and the label

- **GIVEN** a verdict assessed for one commit, and a platform head that is now another
- **WHEN** the skill reaches the label step
- **THEN** it removes the verdict and score labels the merge request carries, adds none, and says the verdict describes a commit that is no longer the head

#### Scenario: Failure — the skill's text carries the re-read and no label name

- **GIVEN** the shipped `skills/mr/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a platform read of the head commit after the `--markdown` line and before the first label command
- **AND** it finds `labels.verdictNames` and `labels.scorePrefix` and no occurrence of `interlock/merge`, `interlock/human-review`, `interlock/blocked` or `interlock/score-`

#### Scenario: Edge case — an unchanged verdict is applied again, and a label that cannot be created is reported

- **GIVEN** a merge request already labelled with the verdict and score the new assessment prints, and a repository that refuses to create a label
- **WHEN** the skill labels each
- **THEN** on the first the two labels are removed and added, so the platform shows a new label event
- **AND** on the second the skill reports which label could not be created and applies nothing it did not report

### Requirement: A check named as the gate's own SHALL be excluded from the pipeline input and shown in the block

`--gate-check <name>` on the skill, repeatable, SHALL be passed to `interlock pipeline` as `--exclude <name>`. The skill SHALL NOT exclude a check the person did not name.

#### Scenario: Happy path — the named check is excluded and visible

- **GIVEN** a repository whose merge is gated by a check that fails until the merge request is labelled, and the skill run with `--gate-check` naming it
- **WHEN** the verdict is assessed
- **THEN** that check is not in the pipeline input, and the description block names it as excluded

#### Scenario: Failure — no check is excluded on the skill's own judgement

- **GIVEN** a failing check and a skill run without `--gate-check`
- **WHEN** the verdict is assessed
- **THEN** the check is in the pipeline input and the verdict reflects it

### Requirement: The delivery documentation SHALL say who merges, how a label is kept from outliving its commit, and what was exercised

`docs/15-merge-confidence.md` SHALL document the labels, the pipeline input, at least three platform recipes and the continuous-integration job that runs the command with `--require-merge`. Every recipe SHALL sit under a heading beginning `### Recipe:` and SHALL open with three labelled lines: `**Merges:**`, naming the platform as the party that merges; `**Clears labels:**`, naming the step that removes the verdict and score labels when new commits arrive; and `**Exercised:**`, saying whether the recipe was run against the platform or written from the platform's documentation, and in the second case which claims rest on documentation alone. The page SHALL state that a label is the claim of whoever ran the skill, that anyone able to label a merge request can make the same claim by hand, and that the job reads `HUMAN` unless it assesses the merge request's head commit, is given the run's evidence file and excludes its own check. Every label name the command can print SHALL appear in the page, held equal to the command's list by a test.

Rationale: a recipe that keys a merge on a label, without saying who can apply that label or what happens to it on the next push, describes a gate that is weaker than it reads.

#### Scenario: Happy path — the page carries the recipes and their limits

- **GIVEN** the shipped `docs/15-merge-confidence.md`
- **WHEN** the documentation pins run
- **THEN** every label name the command can print appears in the page
- **AND** there are at least three `### Recipe:` sections, each carrying the three labelled lines, and the page carries `--require-merge`

#### Scenario: Failure — a label renamed in the CLI and not in the page fails the suite

- **GIVEN** a verdict label whose name in the CLI no longer matches the page
- **WHEN** the documentation pins run
- **THEN** the suite fails naming the label

#### Scenario: Edge case — a recipe without its three lines fails the suite

- **GIVEN** a copy of the page in which one recipe lacks its `**Exercised:**` line
- **WHEN** the documentation pins run
- **THEN** the suite fails naming the recipe
