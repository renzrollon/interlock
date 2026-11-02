# Spec Delta

## MODIFIED Requirements

### Requirement: The pane SHALL group the run by the settle skill's sections and rounds as a timeline on both surfaces, and SHALL toast only the CLI's STOP line, the verdict, a turn's non-answer end and a declined placement

The pane SHALL be registered as `interlock-settle` with the command `/interlock-settle` at any width, opened unasked when a settle run starts, and drawn by field on the terminal and desktop surfaces from the same keyed lines: a header (`interlock settle — <change> · PR #<n> · <depth> · head <sha7> · <elapsed>`), then one group per section word of the settle skill in the order the pass runs them — `review` (or `resolve` in a pass loaded without `--review`), `round <n>` for each round seen, `ready`, `conformance`, `verify`, `checks`, `merge confidence`, `publish`, `drift` — each with the clock time it opened, the clock time of its last line and the span between them, its agent rows grouped by role (dimensions, skeptics, fixer, worker) with `<k> spawned · <m> <reason>` counts, the dimensions row drawing the routing listing and the engine's count as two labelled facts (`review dimensions <names> · <k> spawned`), and its CLI rows with their clock times; then a banners area repeating the routing lines' banners verbatim or reading `none`. A group not yet reached SHALL not be drawn; a group the pass skipped SHALL not be invented. Below `settle pane full width (columns)` from `interlock limits` an agent row SHALL keep its role, served model, elapsed time and reason. A row, a group heading or the header the clock could not time SHALL read `time unknown` where its time would be. The pane SHALL raise a toast only for: a `STOP: ` line (its text verbatim), a merge-confidence verdict (`merge-confidence: <verdict> <score>`), a settle agent's turn ending with a reason other than `answer` (`<role>: <reason>`), and an unasked open the surface declined (`/interlock-settle opens the settle meter`). With no settle run live the pane SHALL read that no settle run is live in this session.

The record SHALL hold one open section, and a line SHALL either open a section or append to the one open. Sections SHALL only move forward in the order below; a line whose kind opens an earlier section SHALL append to the section already open. A verify line that crosses while a `round <r>` section is open is that round's verification before its commit: it SHALL append to the round, drawn as `verify <kind> · exit <n>` rows, and SHALL NOT open `verify`.

| section | opened by | also appends here while it is open |
|---------|-----------|------------------------------------|
| `review` | the run's first keyed line, Skill load or spawn | review-code's lines, `interlock review --out …review-r0.json`, `interlock settle comment --round 0`, dimension and skeptic spawns |
| `resolve` | in a pass loaded without `--review`, the run's first keyed line that has no section of its own, in place of `review` | every later line with no section of its own, until a later section opens |
| `round <r>` | `interlock settle tree-check` after `review-r<r-1>.json` has crossed, or `interlock settle remediate-brief --round <r>` when no such tree-check did | the brief, `interlock routing settle-fixer`, the fixer spawn, `fixer-result`, `test-paths`, the round's `interlock verify plan`, `exec` and `judge` lines, `git commit`, `git push`, the nested review-code load, its lines and its dimension and skeptic spawns, `interlock review --out …review-r<r>.json`, `interlock settle replies` |
| `ready` | `gh pr ready <n>` / `glab mr update <iid> --ready` | — |
| `conformance` | `interlock settle conformance-brief`, `interlock routing settle-conformance` | the conformance worker's spawn |
| `verify` | `interlock verify plan`, `exec`, `judge`, `coverage`, when no `round <r>` section is open | — |
| `checks` | `gh pr checks <n> --watch` / `glab ci get --merge-request <iid>` | — |
| `merge confidence` | `interlock pipeline`, `interlock merge-confidence <c> … --json` or `--markdown` | — |
| `publish` | a label add or remove line, `interlock merge-confidence --label-names` | any later `merge-confidence` row |
| `drift` | `interlock drift --changed` | — |

In a pass loaded without `--review`, `review` and `round <n>` SHALL never be opened, and every line that would have opened `review` opens or appends to `resolve` instead. A line with no round of its own (the branch's pull request lookup, `surface`, `domain-context`, `routing`, `gate`, `test-paths`, a `tree-check` before any review record, the nested review-code Skill load) and an unattributed spawn SHALL append to the section open.

#### Scenario: Happy path — the pass reads as a grouped timeline on both surfaces

- **GIVEN** a settle run in which the review lines, two rounds, the conformance brief, the verify lines, the pipeline line, `interlock merge-confidence … --json` resolving with `verdict: 'HUMAN', score: 58, head: { sha: '161f955…' }` and then the same command with `--markdown` in place of `--json` exiting 0 have crossed
- **WHEN** the pane is drawn on the terminal and on the desktop
- **THEN** both draw the groups `review`, `round 1`, `round 2`, `conformance`, `verify`, `checks`, `merge confidence` in that order, each with its open time, last time and span, the review group with a dimensions row, a skeptics row, the review record row and the comment row, round 1 with tree-check, brief, fixer, result, commit, re-review and replies rows, round 2 with its tree-check and STOP rows, and the merge-confidence group with the pipeline row, the verdict row `HUMAN 58 · head 161f955` and after it the row `merge-confidence --markdown · exit 0`
- **AND** one toast read `merge-confidence: HUMAN 58`, and the status line reads `interlock settle route-prose-spawns-by-role #25: merge confidence · HUMAN 58`

#### Scenario: Edge case — a re-review's fan-out lands in its round, not in review

- **GIVEN** a live settle run whose review group drew four dimension spawns and the `review-r0.json` record, and in which round 1's `tree-check` and `interlock settle remediate-brief --round 1 …` have crossed
- **WHEN** a Skill call names `interlock:review-code`, then `interlock routing --json` resolves, then an agent whose prompt begins `# Dimension: blast-radius` is spawned, then `interlock review … --out .claude/ship/settle/review-r1.json --json` resolves
- **THEN** the dimension agent, the routing row and the review record are drawn in round 1 as its re-review, and the review group still shows four dimension spawns
- **AND** the status line reads `round 1 · …` throughout and never `review · …`

#### Scenario: Failure — the unasked open is declined, and the command answers with no run

- **GIVEN** an interactive session whose surface answers `isPlaced: false` to an unasked open
- **WHEN** `/interlock:settle --review` is submitted
- **THEN** one toast reads `/interlock-settle opens the settle meter` and the status line is still set
- **AND** when `/interlock-settle` is run in a session with no settle run, the pane opens and reads that no settle run is live in this session, and the command replies with an empty result

#### Scenario: Edge case — a narrow terminal, a skipped group and a running fixer

- **GIVEN** a live settle run in round 1 whose fixer has stepped 18 times over 6m 10s and not ended
- **WHEN** the pane is drawn at 90 columns
- **THEN** the fixer row reads `fixer · claude-opus-5-5 · 6m 10s · live` and the status line reads `interlock settle route-prose-spawns-by-role #25: round 1 · fixer 6m 10s · 18 req`
- **AND** no `ready` group is drawn because no `gh pr ready` or `glab mr update --ready` line crossed, and no row reads any word the CLI, the engine or the clock did not supply

#### Scenario: Edge case — a round's verification lands in its round, not in verify

- **GIVEN** a live settle run in round 1 in which `fixer-result` and `test-paths` have crossed
- **WHEN** `interlock verify plan --context inter-wave … --json` resolves, then `interlock verify exec --kind unit …` exits 0, then `interlock verify judge --context inter-wave --head <sha> --json` exits 0, then `git commit -m "fix(review): answer the PR #25 review round 1"` and `git push` resolve
- **THEN** the three verify rows, the commit row with the message's first line and the push row are drawn in round 1, no `verify` group is drawn, and the status line reads `round 1 · …` throughout
- **AND** when, after the pass's `interlock settle conformance-brief` line, `interlock verify plan --context final …` resolves, the `verify` group opens as before, and a judge that exits 1 inside a round draws `verify judge · exit 1` in the round and opens nothing
