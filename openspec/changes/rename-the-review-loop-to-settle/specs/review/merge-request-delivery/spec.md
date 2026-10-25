## MODIFIED Requirements

### Requirement: The skill SHALL obtain the verdict from the CLI and SHALL NOT state a confidence of its own

`skills/settle/SKILL.md` SHALL run `interlock pipeline` to produce the pipeline input and `interlock merge-confidence` with `--base`, `--pipeline` and `--json` to obtain the verdict, on fenced command lines. It SHALL name `verdict` as the field that decides, and `score`, `driving`, `flags`, `labels` and `head` as the fields it reports from, each written as a backticked key. It SHALL say that an exit status of 1 with a verdict on standard output is the verdict `BLOCK` and not a failed command, and that when `interlock pipeline` or `interlock merge-confidence` exits non-zero with nothing on standard output the skill stops the assessment, reports the reason, and writes no `## Merge confidence` section and no label. The skill SHALL NOT ask for, or contain, a confidence level written by the model: `## High Risk Changes` SHALL be narrative under the CLI's verdict. The command lines and field names SHALL be pinned by token in the skill suite, so a reword that drops one fails the suite naming it.

Rationale: the description's risk section was the one place a reviewer was told how hard to look, and it was a level a model wrote. An instruction no test asserts is an instruction that stops running at the first reword.

#### Scenario: Happy path — the shipped skill satisfies every pin

- **GIVEN** the shipped `skills/settle/SKILL.md`
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

### Requirement: The skill SHALL apply one verdict label and one score label, after removing their predecessors, and only for the commit that was assessed

The label names SHALL be the ones the command printed under `labels`; the skill SHALL NOT contain or compose a label name. Before applying, the skill SHALL read the merge request's head commit from the platform again. When it equals `head.sha` from the command's output, the skill SHALL remove from the merge request every label it currently carries that is one of `labels.verdictNames` or starts with `labels.scorePrefix`, then add `labels.verdict.name` and `labels.score.name`. When it differs, or `head` is null, the skill SHALL remove those labels, add none, and say that the head moved. When the assessment stopped, there is no `labels` to read: the skill SHALL obtain `labels.verdictNames` and `labels.scorePrefix` from `interlock merge-confidence --label-names`, which assesses nothing, remove every label of the merge request they recognise, add none, and say that the merge request carries no verdict label because the assessment stopped. That command line SHALL be pinned in the skill suite. The skill SHALL remove and add even when the verdict is unchanged, so the platform records the new assessment. A label that cannot be created or applied SHALL be reported, never passed over. The skill SHALL NOT merge, approve or request changes on a merge request, and SHALL say so.

Rationale: a label is a claim about a commit, and the platform keeps a label when new commits arrive. A merge label left on a head nobody assessed is the failure this requirement exists to prevent. What a label means for merging is the platform's policy; the skill's part ends at the label.

#### Scenario: Happy path — a re-assessment replaces the labels

- **GIVEN** a merge request labelled `interlock/human-review` and `interlock/score-61`, and a new verdict of `MERGE` with a score of 93 for the head the platform still reports
- **WHEN** the skill labels
- **THEN** the merge request carries `interlock/merge` and `interlock/score-93` and neither earlier label

#### Scenario: Failure — the head moved between the assessment and the label

- **GIVEN** a verdict assessed for one commit, and a platform head that is now another
- **WHEN** the skill reaches the label step
- **THEN** it removes the verdict and score labels the merge request carries, adds none, and says the verdict describes a commit that is no longer the head

#### Scenario: Failure — a re-assessment that stops takes the earlier labels off

- **GIVEN** a merge request labelled `interlock/merge` and `interlock/score-93`, and a run of the skill in which `interlock pipeline` exits non-zero
- **WHEN** the skill reaches the label step
- **THEN** it removes both labels, adds none, and says the assessment stopped, with the command's reason
- **AND** the skill's text carries an `interlock merge-confidence --label-names` command line after its first label removal

#### Scenario: Failure — the skill's text carries the re-read and no label name

- **GIVEN** the shipped `skills/settle/SKILL.md`
- **WHEN** the skill suite runs
- **THEN** it finds a platform read of the head commit after the `--markdown` line and before the first label command
- **AND** it finds `labels.verdictNames` and `labels.scorePrefix` and no occurrence of `interlock/merge`, `interlock/human-review`, `interlock/blocked` or `interlock/score-`

#### Scenario: Edge case — an unchanged verdict is applied again, and a label that cannot be created is reported

- **GIVEN** a merge request already labelled with the verdict and score the new assessment prints, and a repository that refuses to create a label
- **WHEN** the skill labels each
- **THEN** on the first the two labels are removed and added, so the platform shows a new label event
- **AND** on the second the skill reports which label could not be created and applies nothing it did not report

## ADDED Requirements

### Requirement: The skill and its command family SHALL be named `settle`, and no shipped surface SHALL name the retired `mr`

The skill that opens, reviews and assesses a pull request SHALL live at `skills/settle/SKILL.md` with `name: settle` in its front matter, and its command family SHALL be `interlock settle <sub>` with the sub-verbs `comment`, `replies`, `remediate-brief`, `fixer-result`, `conformance-brief`, `test-paths` and `tree-check`. The loop's work directory SHALL be `.claude/ship/settle/` and its local artifact SHALL be `openspec/changes/<change>/settle-summary.md`. No alias, shim skill or fallback SHALL exist for the retired names: `interlock mr` SHALL exit non-zero as an unknown subcommand, and there SHALL be no `skills/mr/` directory.

A residue test SHALL scan the tracked shipped surfaces (`README.md`, `REVIEW.md`, the `[Unreleased]` section of `CHANGELOG.md`, the numbered `docs/*.md`, the generated `docs/assets/flow-*.svg`, `skills/**`, `shared/**`, `site/*.html`, `site/DESIGN-PROMPT.md`, `bin/**`, `lib/**`, `hooks/**`, `scripts/**`, `workflows/**`, `.claude-plugin/**` and `test/**`) and SHALL fail naming each file and line that carries the retired name as a word (`mr`, `MR`, `MRs`), as an identifier segment (`mrX`, `xMr`, `MR_`), or the phrase `merge request` / `merge-request`. Before matching it SHALL remove a closed allow-list of tokens GitLab owns or history fixed — `glab mr <verb>`, `--merge-request`, `CI_MERGE_REQUEST_`, `merge_requests`, `refs/merge-requests/`, `close-the-merge-request-loop`, `label-the-merge-request-with-confidence`, `merge-request-delivery` — and any `data:` URI. It SHALL leave out `test/fixtures/ship/**` (a recorded run) and its own file.

Rationale: a rename that only a reviewer's eye enforces comes back at the first copy-paste from an old note. The owner asked for MR naming to be gone; the suite is what keeps it gone.

#### Scenario: Happy path — the renamed tree passes the residue test and the skill pins

- **GIVEN** the tree after this change
- **WHEN** `npm test` runs
- **THEN** the residue test passes, the skill suite reads `skills/settle/SKILL.md`, and `node bin/interlock settle --help` prints the family's own help

#### Scenario: Failure — a retired name in a shipped surface fails the suite naming it

- **GIVEN** a copy of `docs/07-cli-and-configuration.md` with one line reading `run interlock mr comment`
- **WHEN** the residue test scans it
- **THEN** it fails naming the file and the line number

#### Scenario: Edge case — GitLab's own tokens and historical change ids pass

- **GIVEN** a shipped file whose code span reads `glab mr view <iid> --output json | interlock pipeline --gitlab-pr - --out p.json`, and a comment citing design D3 of `close-the-merge-request-loop`
- **WHEN** the residue test scans it
- **THEN** it reports nothing for either line

#### Scenario: Edge case — the retired command is not an alias

- **GIVEN** the tree after this change
- **WHEN** `node bin/interlock mr comment` runs
- **THEN** it exits non-zero naming an unknown subcommand, and writes nothing under `.claude/ship/`
