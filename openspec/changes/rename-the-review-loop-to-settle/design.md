## Context

The pull-request skill shipped in 1.8.0 as `/interlock:mr`. Its CLI family, `interlock mr <sub>`, is unreleased (CHANGELOG `[Unreleased]`). The `interlock pipeline --gitlab-mr / --mr` flags shipped in 1.8.0. The owner renamed the skill to `settle` on 2026-10-25 and asked for MR naming to be gone from README, docs, tests, commands and pages, with no backward compatibility. The discovery is in `.claude/handoff/explore-rename-the-review-loop-to-settle-20261025-230839.md`, and the file and line references below come from it.

The active change `close-the-merge-request-loop` (62/63 tasks; 8.5 waits on a real remote run by the owner) introduced most of what is being renamed. It is not archived, so its delta specs still feed the living specs.

## Goals / Non-Goals

**Goals:**
- One name, `settle`, for the skill, its CLI family, its work directory and its artifact.
- No "MR", "MR/PR", "PR or MR" or "merge request" in any shipped surface, apart from the closed allow-list in D4/D6.
- A test that keeps it that way.

**Non-Goals:**
- No alias, shim, fallback reader or deprecation notice for any retired name (D1, D2).
- No rewrite of history: released CHANGELOG sections, dated notes, archived changes, recorded run fixtures (D6).
- No rename of OpenSpec capability ids that are already living, and no rewording of platform prose inside `openspec/` beyond our own tokens (D7).
- No full Claude Design regeneration of the site (D9).
- No change to behaviour: every sub-verb, flag meaning, exit code and output shape stays the same apart from the names.

## Decisions

### Rename map

| Retired | New |
|---|---|
| `/interlock:mr`, `skills/mr/`, `name: mr` | `/interlock:settle`, `skills/settle/`, `name: settle` |
| `interlock mr <sub>` | `interlock settle <sub>` (same sub-verbs) (D1) |
| `lib/mr-cli.mjs`; `MR_HELP`, `MR_SUBCOMMANDS`, `mrCommand` | `lib/settle-cli.mjs`; `SETTLE_HELP`, `SETTLE_SUBCOMMANDS`, `settleCommand` |
| `lib/prompts/mr-remediate.mjs`; `assembleMrRemediatePrompt`; registry key `mrRemediate` | `lib/prompts/settle-remediate.mjs`; `assembleSettleRemediatePrompt`; `settleRemediate` |
| `lib/cli-flags.mjs` keys `'mr <sub>'` | `'settle <sub>'` |
| `.claude/ship/mr/` | `.claude/ship/settle/` (D2) |
| `openspec/changes/<c>/mr-summary.md` | `openspec/changes/<c>/settle-summary.md` (D2) |
| `interlock pipeline --gitlab-mr <file>` | `--gitlab-pr <file>` (D5) |
| `interlock pipeline --gitlab <file> --mr <file>` | `--gitlab <file> --pending <file>` (D5) |
| `pendingFromGitlabMr` | `pendingFromGitlabPr` |
| `test/fixtures/pipeline/gitlab-mr-*.json` | `gitlab-pr-*.json` |
| `test/spine/mr-cli.test.mjs` | `test/spine/settle-cli.test.mjs` |
| diagram node `mr` (`scripts/gen-flow-svg.mjs:67`) | `settle` |
| prose "MR", "MR/PR", "PR or MR", "merge request" | "pull request" or "PR" (D3) |
| "settled at the checkpoint / before ship" (`gen-flow-svg.mjs:86`, `docs/06:40`, `docs/09:113`) | "decided …", so the verb `settle` means one thing |

Files move with `git mv`, so history follows them. Module, identifier and argv renames land in the same wave as the tests that pin them. The suite is then never run against a half-renamed tree, and no inter-wave check spends fix attempts on tests that are only waiting for their rename.

### D1. The CLI family takes the skill's name, and the sub-verbs stay

`interlock settle comment` reads as the skill's own commands, the way `interlock mr comment` did. The sub-verbs describe what each command does, and none of them contains MR. No alias: `interlock mr` falls through to the dispatcher's unknown-subcommand path. Evidence: owner instruction 2026-10-25; `bin/interlock:4049`, `lib/mr-cli.mjs:40`.

### D2. The work directory and the artifact are renamed, and old files are orphaned

`.claude/ship/mr/` is scratch that the loop clears at the start of every pass (`rm -rf` in the skill's allowed-tools). `mr-summary.md` is written fresh each time. Nothing reads an old one once the names change, which is what "no backward compatibility" asks for. Every writer and reader moves together: `lib/mr-cli.mjs:74,96-98,439`, `lib/prompts/mr-remediate.mjs:87`, `lib/prompts/index.mjs:299-328`, and the skill's allowed-tools and body.

### D3. The generic noun becomes "pull request", GitLab included

"Pull request" is GitHub's term, and the skill's own commit messages already say "PR". "Change request" was rejected because it collides with "OpenSpec change". Where a sentence is about GitLab specifically, it still says "pull request" ("the GitLab pull request's head pipeline"), and the GitLab token in the adjacent code span shows the platform's own name.

### D4 and D6. The allow-list is closed

The residue test strips these tokens before matching, and nothing else:

- GitLab-owned (D4): `glab mr <verb>`, `--merge-request`, `CI_MERGE_REQUEST_`, `merge_requests`, `refs/merge-requests/`.
- History (D6): `close-the-merge-request-loop`, `label-the-merge-request-with-confidence` (change ids), and `merge-request-delivery` (a living capability id, D7).
- `data:` URIs, whose base64 can contain `mr` between word boundaries.

One structural exclusion sits beside the token list. Inside `CHANGELOG.md` `[Unreleased]`, the rename note D11 requires has to name the retired commands, so the test leaves out the `- **BREAKING:` bullets and the `### Upgrading` subsection of that section. Every other `[Unreleased]` line is scanned. The exclusion is by structure rather than by one bullet's text, so a later BREAKING bullet or Upgrading line is not scanned either: a reviewer reads those two places by eye.

The test scans no files outside the listed surfaces. That covers `docs/notes/**`, `briefs/**`, `openspec/**`, `docs/assets/DESIGN-PROMPT.md` (its only hits are in a retired, kept-for-the-record appendix), `CHANGELOG.md` outside `[Unreleased]`, `test/fixtures/ship/**` and the test itself. A new exception means editing the list in the test, which a reviewer sees.

### D5. `--gitlab-pr` and `--pending`

`--gitlab-pr` keeps the pairing with `--github` and `--gitlab` that the platform dispatch reads (`bin/interlock:3022`). `--mr <file>` was never about the merge request: it carries the pending record the first step wrote (`bin/interlock:3049-3050`). So `--pending` names what it is. `--pr` was rejected because `remediate-brief` already uses `--pr` for a number.

### D7. Inside `openspec/`, only our tokens change

Living requirement titles that say "merge request" (for example `review/pipeline-evidence`) would need RENAMED blocks for a wording change with no behaviour in it, and `openspec/` belongs to the CLI. This change MODIFIES only requirements whose body names a retired token: two in `review/merge-request-delivery`, one in `review/pipeline-evidence`, one in `hooks/tool-guards`. The living capability id `review/merge-request-delivery` and its Purpose line stay. A Purpose line cannot be changed through a delta.

### D8. The active change is edited in place

`close-the-merge-request-loop` is not archived. Its deltas are what will reach the living specs, so they have to say `settle`, or archiving it would bring the retired names back. Edits:

- Move `specs/review/merge-request-loop/` to `specs/review/settle-loop/`. The capability is not living yet, so no RENAMED block is needed. Rewrite its seven `interlock mr <sub>` titles and its body tokens.
- Update the tokens in its `review/merge-request-delivery` delta. That delta MODIFIES "The skill SHALL hand the command only evidence about the commit under review", the one living requirement naming `--gitlab-mr` and `skills/mr` that this change does not MODIFY itself. The two changes therefore never MODIFY the same requirement, and either archive order is conflict-free. Conflict-free is not consistent, though: until `close-the-merge-request-loop` archives, the living copy of that requirement still names `--gitlab-mr`, `--mr` and `skills/mr/SKILL.md`, which the CLI and tree no longer have. So this change archives after `close-the-merge-request-loop`, never before it (task 3.1).
- Update the `NEXT —` line in its `ship/close-summary` ADDED requirement, and rename that title's "merge-request step" to "settle step". It is ADDED, so no verbatim constraint applies.
- Update open task 8.5's text to `skills/settle/SKILL.md`. Its proposal, design, ledger, done tasks and review artifacts stay as history (D6).

### D9. The site exports are text-patched

`site/README.md` allows hand-patching only the version string, and full regeneration runs in Claude Design, which no implementer can drive. Leaving the exports alone would leave a public page advertising a command that no longer exists. So `site/DESIGN-PROMPT.md` (the source) is edited, and the same strings are patched in `site/index.html`, `site/FirstHour.dc.html`, `site/Run.dc.html` and `site/Limits.dc.html`. That includes internal identifiers such as `fMr` / `setF('mr')`, renamed together with their callers. Visible text and identifiers only: no layout or markup change. The next Claude Design regeneration at a version pin replaces the patch with a clean export of the same words.

### D10. A residue test pins the rename

The test is `test/retired-names.test.mjs`. It lists tracked files with `git ls-files`, keeps those under the surfaces in the ADDED requirement, keeps only the `[Unreleased]` section of `CHANGELOG.md` minus its rename note (the `- **BREAKING:` bullets and the `### Upgrading` subsection, D4/D6), strips the D4/D6 allow-list, and matches:

- `\bmrs?\b` (case-insensitive)
- `\bmr(?=[A-Z])`, `[a-z]Mr(?![a-z])`, `\bMR_` (case-sensitive: with case folded, `fromReceipt`, `memRoot`, `resumeFromRunId` and `armResult` match, and none of them is the retired name)
- `merge[ -]requests?` (case-insensitive)

It reads text files only. The listed surfaces hold no images, and a file containing a NUL byte is skipped.

It fails with one `path:line: text` per hit. The patterns are built from fragments, so the test file never matches itself. It also asserts that `skills/mr` does not exist and that `node bin/interlock mr comment` exits non-zero without creating `.claude/ship/settle/`. This follows the repository rule that an instruction nobody asserts stops running (`.claude/CLAUDE.md`, "Things to get right").

### D11. CHANGELOG

`[Unreleased]` entries are rewritten to the new names, because they describe what will ship. One `### Changed` line states the rename: `/interlock:mr` (shipped in 1.8.0) is now `/interlock:settle`, `interlock pipeline --gitlab-mr/--mr` are now `--gitlab-pr/--pending`, and there is no alias. Released sections are left as written (D6).

## Risks / Trade-offs

- [Prose sweep of a shipped skill — about 45 "merge request" phrases in the skill file] → Token pins in `test/skills.test.mjs` move in lockstep. The replacement is a noun swap, so no instruction is added or dropped, and a reviewer can compare sentence counts.
- [Test edits read like weakening] → Each edit changes a literal name and keeps the assertion. Assertion counts per file stay the same. The rename is the deliberate behaviour, recorded here, and no test is skipped or deleted.
- [Heading anchors break] → `docs/07` "The merge-request loop" and `docs/15` "Closing the loop on a merge request" get new headings. Every link to them is updated in the same task: `docs/15:5,124,196`, `docs/01:136`, `docs/07:66,205`.
- [Generated SVGs hand-edited] → Change only `scripts/gen-flow-svg.mjs`, then run `node scripts/gen-flow-svg.mjs`. `test/flow-svg.test.mjs` fails on drift. Check the wider `settle` label in the wide layout. The README and `docs/09` alt text copy `SUMMARY` word for word.
- [Site patch drifts from the design source] → Patch the same strings in `site/DESIGN-PROMPT.md` and the exports in one task. The residue test covers both.
- [Residue false positives] → Start with the closed allow-list. A real false positive is fixed by rewording the shipped text, not by widening the list, unless the token is GitLab's.
- [Installed 1.8.0 users lose `/interlock:mr`] → Accepted by the owner. The CHANGELOG line says so.
- [Compound notes N3 and N4 name `skills/mr/SKILL.md` and `lib/mr-cli.mjs`] → Both rules still hold under the new names. The clean-tree precondition before the work directory is cleared (N3) and the inert rendering of reviewer text (N4) keep their code and their pins. Renaming a pin's helper (`mrSkillProblems` → `settleSkillProblems`) must keep every token it asserts. `docs/notes/compound.md` rows stay as written (D6).
