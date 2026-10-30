# Spec Delta

## MODIFIED Requirements

### Requirement: The skill and its command family SHALL be named `settle`, and no shipped surface SHALL name the retired `mr`

The skill that opens, reviews and assesses a pull request SHALL live at `skills/settle/SKILL.md` with `name: settle` in its front matter, and its command family SHALL be `interlock settle <sub>` with the sub-verbs `comment`, `replies`, `remediate-brief`, `fixer-result`, `conformance-brief`, `test-paths` and `tree-check`, implemented in `lib/settle-cli.mjs`, with the fixer's briefing assembled by `lib/prompts/settle-remediate.mjs`. The loop's work directory SHALL be `.claude/ship/settle/` and its local artifact SHALL be `openspec/changes/<change>/settle-summary.md`. No alias, shim skill or fallback SHALL exist for the retired names: `interlock mr` SHALL exit non-zero as an unknown subcommand, and there SHALL be no `skills/mr/` directory.

A residue test SHALL scan the tracked shipped surfaces (`README.md`, `REVIEW.md`, the `[Unreleased]` section of `CHANGELOG.md`, the numbered `docs/*.md`, the generated `docs/assets/flow-*.svg`, `skills/**`, `shared/**`, `site/*.html`, `site/DESIGN-PROMPT.md`, `cli/**`, `lib/**`, `hooks/**`, `scripts/**`, `workflows/**`, `.claude-plugin/**` and `test/**`) and SHALL fail naming each file and line that carries the retired name as a word (`mr`, `MR`, `MRs`), as an identifier segment (`mrX`, `xMr`, `MR_`), or the phrase `merge request` / `merge-request`. Before matching it SHALL remove a closed allow-list of tokens GitLab owns or history fixed — `glab mr <verb>`, `--merge-request`, `CI_MERGE_REQUEST_`, `merge_requests`, `refs/merge-requests/`, `close-the-merge-request-loop`, `label-the-merge-request-with-confidence`, `merge-request-delivery` — and any `data:` URI. It SHALL leave out `test/fixtures/ship/**` (a recorded run) and its own file. Inside the `[Unreleased]` section it SHALL also leave out the rename note: the `- **BREAKING:` bullets and the `### Upgrading` subsection, which name the retired commands to say what changed.

Rationale: a rename that only a reviewer's eye enforces comes back at the first copy-paste from an old note. The owner asked for MR naming to be gone; the suite is what keeps it gone.

#### Scenario: Happy path — the renamed tree passes the residue test and the skill pins

- **GIVEN** the tree after this change
- **WHEN** `npm test` runs
- **THEN** the residue test passes, the skill suite reads `skills/settle/SKILL.md`, and `node cli/interlock settle --help` prints the family's own help

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
- **WHEN** `node cli/interlock mr comment` runs
- **THEN** it exits non-zero naming an unknown subcommand, and writes nothing under `.claude/ship/`
