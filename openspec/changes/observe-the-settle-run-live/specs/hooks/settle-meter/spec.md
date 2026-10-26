## ADDED Requirements

### Requirement: The settle meter SHALL go live only on the plugin's settle skill load that carries `--review` in an interactive session, and SHALL take the change, the pull request and the head from the CLI's lines alone

The module SHALL start a settle run only when the plugin's settle skill is loaded in a session whose start reported it interactive and the load's arguments contain the word `--review`: a prompt submitted whose first word is `/interlock:settle`, or a Skill tool call naming `interlock:settle` that the engine did not mark errored. A load without `--review` SHALL start nothing. The prompt and the Skill call SHALL be passed on exactly as they came, and of them only the first word and the presence of `--review` SHALL be read. A Skill call naming `interlock:review-code` while a settle run is live SHALL change no section: it lands in the section already open, `review` on the first load and the open round on every re-review. At the start the status line and the pane SHALL read `change: unknown until named`; the change name SHALL be taken only from the CLI's own argv (`--change <name>` on the settle lines, the positional change on `interlock settle conformance-brief`, `interlock merge-confidence` and `interlock domain-context`, `--metrics <name>` on `interlock review`) or a `change` field in a result's JSON; the pull request number only from `--pr <n>` or a `pr` field, or the positional number on a `gh pr` stage; the head only from `--head <sha>` or a `head` or `head.sha` field. None of them SHALL be taken from a file path, a prompt or a tool input. A second settle load in the same session SHALL start the record over and say so once on the debug log. In a non-interactive session every hook this requirement adds SHALL return at its first line.

#### Scenario: Happy path — the load starts the run and the brief names the pass

- **GIVEN** an interactive session
- **WHEN** the prompt `/interlock:settle --create --review` is submitted
- **THEN** the status line reads `interlock settle: change: unknown until named`, the pane is opened unasked, and the prompt reaches the engine unchanged
- **AND** when `interlock settle remediate-brief --review .claude/ship/settle/review-r0.json --round 1 --change route-prose-spawns-by-role --head a96cb82cedb626d9b6c11c1f6a090b7e52a2afa8 --pr 25 … --json` resolves, the header names `route-prose-spawns-by-role`, `PR #25` and `head a96cb82`

#### Scenario: Failure — a non-interactive session or a load without `--review` draws nothing

- **GIVEN** `session.start` reporting `isInteractive: false`, or an interactive session in which the prompt `/interlock:settle --create` is submitted
- **WHEN** the settle lines, spawns and turn events of a pass follow
- **THEN** no status line is set, no pane is opened, no toast is shown and no record is kept
- **AND** every hook resolved to what the engine alone would have done

#### Scenario: Edge case — the review-code skill alone, and a second settle load

- **GIVEN** an interactive session in which the settle skill was not loaded
- **WHEN** a Skill call names `interlock:review-code` and four `general-purpose` agents whose prompts begin `# Dimension: ` are spawned
- **THEN** no status line is set and the pane reads that no settle run is live in this session
- **AND** when a live settle run exists and `/interlock:settle --review` is submitted again, the record starts over with `change: unknown until named`, the earlier rows are not kept, and one debug-log line says a new settle run replaced the previous one

### Requirement: The status line and the pane SHALL repeat the CLI's own words from the settle and review lines, read at every pipe stage, and SHALL make no verdict of their own

While a settle run is live, a Bash call whose command, or one of its segments or pipe stages, begins with one of the keyed lines SHALL be let through and its result read, on the Bash hook's path with no ship run live and on its path with one live alike, and whether or not the spec meter's reader keyed or declined the same line. Segments are split at unquoted `&&`, `||`, `;` or line breaks; each segment is further split at unquoted `|` and at `$(`, a `$(` inside double quotes included; the body of a quoted heredoc is one argument and is never re-split; and every stage is keyed by its own first words. A line that crosses again SHALL append a row, never replace the earlier one.

The keyed lines and the fields read from each:
- `interlock routing --json` (with or without `--depth`): `depth`, `roles.<role>.model`, `roles.<role>.effort`, `review.dimensions`, `review.skeptics`, `banners`; `interlock routing <role> --json`: `role`, `model`, `effort`, `banners`
- `interlock surface`, `interlock domain-context`, `interlock gate`, `interlock changes`, `interlock review-policy`, `interlock autonomy record`, `interlock note derive`: the command words and the exit code
- `interlock review … --json` (with or without `--out <file>`): `counts.raised`, `counts.dismissed`, `counts.surviving`, `counts.carried`, `dimensionStats` by name, `head`, `dimensions.ran`, `dimensions.skipped`, `dimensions.depth`; never `dimensions.completed`
- `interlock settle comment --round <n> --head <sha>`, `interlock settle replies --head <sha>`: the command words, the round and the exit code; the `gh pr comment <n>` / `glab mr note <iid>` stage beside them: its pull request number only
- `interlock settle tree-check`: the stdout it printed — `clean`, `clean (tolerated: …)`, or `dirty (<k>):` and the paths it listed — and the exit code
- `interlock settle test-paths … --json`: `protected` and `unprotected` by count and the `protected` paths, or, when `profile` is null, the `reason` field verbatim; with `--protected-only`, the exit code
- `interlock settle remediate-brief … --round <r> --change <c> --head <sha> --pr <n> … --json`: `findings` and `deferred` by count, `reReviewDimensions`; on exit 1 the stderr line beginning `STOP: `, verbatim, which ends the loop on the pane
- `interlock settle fixer-result --round <r>`: the stdout line `round <r>: <a> fixed, <b> not fixed`
- `git commit -m "<message>"`: the message's first line; `git push`: the exit code; both only inside a round, and passed through unread outside one
- `gh pr ready <n>` / `glab mr update <iid> --ready`: the exit code
- `interlock settle conformance-brief <c> --head <sha>`: the exit code, and on an empty stdout the stderr line, verbatim
- `interlock verify plan`, `interlock verify exec --kind <kind>`, `interlock verify judge`, `interlock verify coverage`: the kind, the exit code and the duration; a result with no stdout reads `result not seen (redirected)`
- `gh pr checks <n> --watch` / `glab ci get --merge-request <iid>`: `background` when the call ran in the background, else the exit code
- `interlock pipeline`: the stdout line beginning `pipeline <sha>:` or `pending <sha>:`, verbatim
- `interlock merge-confidence <c> … --json`: `verdict`, `score`, `head.sha`, `labels.verdict.name`, `labels.score.name`; with `--markdown` or a redirected result, the exit code, as a row of its own after the verdict row
- `interlock merge-confidence --label-names --json`: `labels.verdictNames` and `labels.scorePrefix`, as a row of its own, never `(unparsed)` for want of a verdict
- `gh pr edit <n> --add-label <names>` / `glab mr update <iid> --label <names>`: the label names; `gh pr edit <n> --remove-label <names>` / `glab mr update <iid> --unlabel <names>`: `removed` and the label names
- `interlock drift --changed … --json`: `unarchived` and `stale.broken` by count

Reading rules: stages SHALL be applied in the command's order; a stage whose result does not parse as JSON, or lacks the fields the line names, SHALL be shown as that line with `(unparsed)` and its first line of text, never as a verdict, and SHALL leave one debug-log line; a result the engine kept out of line (too large to read inline) SHALL be shown as `result not seen (too large)`; every other Bash call SHALL be passed through at the first line, its result unread. The module SHALL compare no count against any threshold, SHALL draw no tick, cross or verdict word of its own, and SHALL show no `quiet <n> min`.

#### Scenario: Happy path — the PR #25 pass reads back in the CLI's words

- **GIVEN** a live settle run
- **WHEN** `interlock review … --metrics route-prose-spawns-by-role --dimensions … --head a96cb82… --out .claude/ship/settle/review-r0.json --json` resolves with `counts: { raised: 6, dismissed: 0, surviving: 6 }` and `dimensions.depth: 'lean'`, then `interlock settle fixer-result --round 1 …` resolves with `round 1: 1 fixed, 0 not fixed`, then `gh pr view 25 --json headRefOid,statusCheckRollup | interlock pipeline --github - --required "test" --out .claude/ship/pipeline.json` resolves with `pipeline 161f955…: 3 check(s) (3 pass, 0 fail, 0 pending, 0 skipped); required: test; excluded: none`
- **THEN** the review row reads `6 raised · 0 dismissed · 6 surviving · head a96cb82`, the header reads `lean`, round 1's result row reads `round 1: 1 fixed, 0 not fixed`, and the merge-confidence group's first row is the pipeline line verbatim
- **AND** the status line after the last of them reads `interlock settle route-prose-spawns-by-role #25: merge confidence · pipeline 161f955`

#### Scenario: Failure — a STOP line, a redirected judge and an unparsed result

- **GIVEN** a live settle run in round 2
- **WHEN** `interlock settle remediate-brief … --round 2 … --json` exits 1 with stderr `interlock: STOP: round 2 is the verdict round (remediationRounds=2; no fix round remains)` and nothing on stdout, then `interlock verify judge --plan … --results … --context final --head 161f955… --json > .claude/ship/settle/verify.json.tmp` exits 0 with no stdout, then `interlock merge-confidence route-prose-spawns-by-role … --json` resolves with text that is not JSON
- **THEN** round 2's row reads `STOP: round 2 is the verdict round (remediationRounds=2; no fix round remains)`, the verify row reads `judge exit 0 · result not seen (redirected)`, and the merge-confidence row reads `merge-confidence (unparsed)` with the result's first line
- **AND** no row reads halted, passed, failed or any word the CLI did not print, and one debug-log line names the unparsed line
- **AND** in a pass whose round 1 `git status --porcelain=v1 -z --untracked-files=all | interlock settle tree-check --change route-prose-spawns-by-role --status -` exits 1 with stdout `dirty (1):` and `  notes.txt`, round 1's row reads `tree-check dirty (1): notes.txt · exit 1`

#### Scenario: Edge case — pipe stages, a background watch and a compound command

- **GIVEN** a live settle run
- **WHEN** `git status --porcelain=v1 -z --untracked-files=all | interlock settle tree-check --change route-prose-spawns-by-role --status -` resolves with `clean`, then `interlock settle comment --review .claude/ship/settle/review-r0.json --head a96cb82… --round 0 | gh pr comment 25 --body-file -` resolves with a comment URL, then `gh pr checks 25 --watch` is called with `run_in_background: true`, then `git commit -m "fix(review): answer the PR #25 review round 1" -m "Refs: #25" && git push` resolves
- **THEN** the pane reads `tree-check clean · exit 0`, the comment row reads `round 0 · exit 0` with `PR #25` taken from the second stage, the checks row reads `gh pr checks 25 --watch · background`, and round 1 reads `commit fix(review): answer the PR #25 review round 1 · push exit 0`
- **AND** `glab mr note 7 --message "$(interlock settle comment --review .claude/ship/settle/review-r0.json --head a96cb82… --round 0)"` is read as a comment row too, its `interlock` stage split from inside the double quotes, and every one of those calls reached the engine unchanged

### Requirement: Each spawn of a live settle run SHALL be attributed from the prompt's first line against pinned sources, and its model and effort SHALL be shown by source and labelled

While a settle run is live, the module SHALL read each `agent.spawn` as it crosses and pass it on unchanged. The role SHALL be read from the prompt's lines, each match anchored at a line's start and covering the whole source sentence. The prompt's first non-blank line SHALL be tested first against the two CLI-printed sources, which win over every other: `Fix round <r> for change "<c>", … at head <sha>.` is round r's fixer; `Confirm change "<c>" against its diff at head <sha>.` is the conformance worker. Otherwise the lines SHALL be read from the top, and the scan SHALL stop at the first line that is one of: `# Dimension: <words>`, a dimension reviewer named by those words; `You are a skeptical code reviewer.`, the refuting skeptic; `You are an independent reviewer giving a second opinion.`, the second-opinion skeptic. So a repository review policy block prepended to a reviewer's instructions does not hide its role, and a finding quoted inside a fixer's brief never makes it a skeptic. A prompt with no such line SHALL be drawn as `<subagentType> · unattributed`; the Agent call's `description` SHALL never be drawn. Each agent row SHALL carry: the model requested (the spawn input's `model`, or `inherit` when absent), the model resolved (the spawn result's `model`), the models served (`usage.model` of its steps, distinct), the effort the CLI routed for its role, labelled `routed`, read from the `interlock routing` lines of the pass and reading `routed: not seen` before one has crossed, the engine's per-step `effort` labelled `step` (the latest, and `<first> → <latest>` when they differ), its requests and token counts from its `turn.step` results, its elapsed time from the clock and its `turn.complete` `durationMs`, and the host's `reason` word at its end. Figures SHALL be labelled live until the agent's turn ends. The ship meter's agent records SHALL be untouched by a settle run.

#### Scenario: Happy path — a dimension reviewer and the fixer are attributed and labelled

- **GIVEN** a live settle run in which `interlock routing --json` resolved with `roles.review-dimension: { model: 'sonnet', effort: 'medium' }` and `interlock routing settle-fixer --json` resolved with `model: null, effort: 'xhigh'`
- **WHEN** an agent is spawned with `subagentType: 'general-purpose'`, `model: 'sonnet'` and a prompt beginning `# Dimension: language & framework`, the engine resolves it `model: 'claude-sonnet-5-5'`, its `turn.step` inputs carry `effort: 'medium'` and its results carry usage, and later an agent is spawned with no `model`, `parentModel: 'claude-opus-5-5'` and a prompt beginning `Fix round 1 for change "route-prose-spawns-by-role", pull request #25, at head a96cb82…`
- **THEN** the review group's dimensions row reads `routed sonnet · medium` and the reviewer's row reads `language & framework · sonnet → claude-sonnet-5-5 · step medium · <n> req · <tokens> · <elapsed> · live`
- **AND** round 1's fixer row reads `fixer · inherit → claude-opus-5-5 · routed — · xhigh · step <level> · … · live`, and when its `turn.complete` carries `reason: 'answer'` and `durationMs: 645000` the row ends `10m 45s · answer`

#### Scenario: Failure — a spawn matching no source, and a spawn before any routing line

- **GIVEN** a live settle run in which no `interlock routing` line has crossed
- **WHEN** an agent is spawned with `subagentType: 'general-purpose'` and a prompt beginning `Please summarise the diff`, then an agent whose prompt begins `You are a skeptical code reviewer.`
- **THEN** the first row reads `general-purpose · unattributed` with its engine figures and no word of its description, and the skeptics row reads `routed: not seen`
- **AND** both spawn calls reached the engine unchanged and the ship meter's agent records are empty

#### Scenario: Edge case — a changed step level, an aborted worker, and a ship run's agents

- **GIVEN** a live settle run in the conformance group
- **WHEN** the conformance worker's first `turn.step` carries `effort: 'medium'` and its latest `effort: 'high'`, and its `turn.complete` carries `reason: 'aborted'`
- **THEN** its row reads `step medium → high` and ends `aborted`, and one toast reads `conformance: aborted`
- **AND** when no settle run is live and a ship run is, the same events change the ship meter's records alone and nothing in the settle record

#### Scenario: Edge case — each role carries its own routed figure, and a policy block precedes a brief

- **GIVEN** a live settle run in which `interlock routing --json` resolved with `roles.review-dimension: { model: 'sonnet', effort: 'medium' }` and `roles.review-skeptic: { model: null, effort: 'xhigh' }`, and `interlock routing settle-conformance --json` resolved with `model: 'sonnet', effort: null`
- **WHEN** an agent is spawned whose prompt begins with a `REPOSITORY REVIEW POLICY` block followed by `# Dimension: technical lead`, then an agent whose prompt begins `You are a skeptical code reviewer.`, then, in the conformance group, an agent whose prompt begins `Confirm change "route-prose-spawns-by-role" against its diff at head 161f955….`
- **THEN** the first is drawn as the `technical lead` dimension reviewer and the dimensions row reads `routed sonnet · medium`, the skeptics row in the same group reads `routed — · xhigh`, and the conformance worker's row reads `routed sonnet · —`
- **AND** no row's routed figure is taken from another role's routing entry

### Requirement: The pane SHALL group the run by the settle skill's sections and rounds as a timeline on both surfaces, and SHALL toast only the CLI's STOP line, the verdict, a turn's non-answer end and a declined placement

The pane SHALL be registered as `interlock-settle` with the command `/interlock-settle` at any width, opened unasked when a settle run starts, and drawn by field on the terminal and desktop surfaces from the same keyed lines: a header (`interlock settle — <change> · PR #<n> · <depth> · head <sha7> · <elapsed>`), then one group per section word of the settle skill in the order the pass runs them — `review`, `round <n>` for each round seen, `ready`, `conformance`, `verify`, `checks`, `merge confidence`, `publish`, `drift` — each with the clock time it opened, the clock time of its last line and the span between them, its agent rows grouped by role (dimensions, skeptics, fixer, worker) with `<k> spawned · <m> <reason>` counts, the dimensions row drawing the routing listing and the engine's count as two labelled facts (`review dimensions <names> · <k> spawned`), and its CLI rows with their clock times; then a banners area repeating the routing lines' banners verbatim or reading `none`. A group not yet reached SHALL not be drawn; a group the pass skipped SHALL not be invented. Below 110 columns an agent row SHALL keep its role, served model, elapsed time and reason. The pane SHALL raise a toast only for: a `STOP: ` line (its text verbatim), a merge-confidence verdict (`merge-confidence: <verdict> <score>`), a settle agent's turn ending with a reason other than `answer` (`<role>: <reason>`), and an unasked open the surface declined (`/interlock-settle opens the settle meter`). With no settle run live the pane SHALL read that no settle run is live in this session.

The record SHALL hold one open section, and a line SHALL either open a section or append to the one open. Sections SHALL only move forward in the order below; a line whose kind opens an earlier section SHALL append to the section already open.

| section | opened by | also appends here while it is open |
|---------|-----------|------------------------------------|
| `review` | the run's first keyed line, Skill load or spawn | review-code's lines, `interlock review --out …review-r0.json`, `interlock settle comment --round 0`, dimension and skeptic spawns |
| `round <r>` | `interlock settle tree-check` after `review-r<r-1>.json` has crossed, or `interlock settle remediate-brief --round <r>` when no such tree-check did | the brief, `interlock routing settle-fixer`, the fixer spawn, `fixer-result`, `test-paths`, `git commit`, `git push`, the nested review-code load, its lines and its dimension and skeptic spawns, `interlock review --out …review-r<r>.json`, `interlock settle replies` |
| `ready` | `gh pr ready <n>` / `glab mr update <iid> --ready` | — |
| `conformance` | `interlock settle conformance-brief`, `interlock routing settle-conformance` | the conformance worker's spawn |
| `verify` | `interlock verify plan`, `exec`, `judge`, `coverage` | — |
| `checks` | `gh pr checks <n> --watch` / `glab ci get --merge-request <iid>` | — |
| `merge confidence` | `interlock pipeline`, `interlock merge-confidence <c> … --json` or `--markdown` | — |
| `publish` | a label add or remove line, `interlock merge-confidence --label-names` | any later `merge-confidence` row |
| `drift` | `interlock drift --changed` | — |

A line with no round of its own (`surface`, `domain-context`, `routing`, `gate`, `test-paths`, a `tree-check` before any review record, the nested review-code Skill load) and an unattributed spawn SHALL append to the section open.

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

### Requirement: The settle run SHALL end at the drift line, start over on a second load, and reset at the session boundary, and the module's one status line SHALL rank a live run above a finished one

When `interlock drift --changed … --json` crosses a live settle run, the run SHALL move to `done`: the pane SHALL keep its rows, with the time the run ended, and a later keyed line SHALL change nothing and be named once on the debug log. A labels line (`gh pr edit <n> --add-label …`, `glab mr update <iid> --label …`) SHALL be a `publish` row and SHALL NOT end the run. The `publish` and `drift` sections SHALL NOT retarget the status line: from the merge-confidence section on, it SHALL keep that section's last words, and `done` SHALL keep them until the boundary. The status figure SHALL otherwise be the open section's last CLI words or, while one or more attributed agents of the section run, the longest-running one's role, elapsed time and requests, preceded by `<k> live` when more than one runs; an unattributed spawn SHALL never take the figure. At a classic session-start event whose source is `clear`, `resume` or `fork` the settle run SHALL reset in the same hook and on the same event as the ship and spec runs, the status line cleared and the pane redrawn to its no-run text; a source of `startup` or `compact` SHALL leave it as it is. A Workflow tool call the launch rule recognises as an accepted ship launch SHALL leave the settle record and pane as they are; while that ship run is live the status line SHALL read the ship position and never both. The module SHALL compose its one status line in one place, a live run ranking above a finished one: the ship position while a ship run is live, otherwise the spec line while a spec run is live, otherwise the settle line while a settle run is live, otherwise the spec line while a spec run is stopped at its checkpoint, otherwise the settle line while a settle run is done, otherwise nothing.

#### Scenario: Happy path — the drift line ends the run and the verdict stays on the line

- **GIVEN** a live settle run whose merge-confidence row reads `HUMAN 58`
- **WHEN** `gh pr edit 25 --add-label "interlock/human-review,interlock/score-58"` resolves and then `interlock drift --changed … --json` resolves with `unarchived: ['route-prose-spawns-by-role']` and `stale.broken: []`
- **THEN** the run is still live after the labels line, the publish row reads `labels interlock/human-review, interlock/score-58`, the drift row reads `unarchived 1 · broken 0`, the pane reads `done <ISO>`, and the status line reads `interlock settle route-prose-spawns-by-role #25: merge confidence · HUMAN 58` throughout and is not cleared
- **AND** a later `interlock settle fixer-result …` changes nothing and is named once on the debug log

#### Scenario: Failure — a ship launch during a settle run takes the line and leaves the pane

- **GIVEN** a live settle run with its status line set
- **WHEN** a Workflow call naming `workflows/ship.js` returns `status: 'async_launched'` with a run id, and after it `interlock settle fixer-result --round 1 …` resolves with `round 1: 1 fixed, 0 not fixed`
- **THEN** the status line reads the ship meter's `interlock: <change> …` form and never both, the settle pane still draws its groups and agents, and round 1's result row reads `round 1: 1 fixed, 0 not fixed`
- **AND** when the launch returns an error or a deny, the settle line stays

#### Scenario: Edge case — a clear, a compaction, and a spec run beside a settle run

- **GIVEN** a live settle run with a status line set and groups drawn
- **WHEN** a classic session-start event with source `clear` crosses the module
- **THEN** the status line is cleared, the pane reads that no settle run is live, and a later settle line sets no status line and is named once on the debug log
- **AND** a `compact` source leaves the line, the groups and the counts unchanged
- **AND** when a spec run is live in the same session as a live settle run, the status line reads the spec line and the settle pane keeps drawing; when the spec run is at its checkpoint and the settle run is live, the status line reads the settle line; and when the settle run is done and the spec run is at its checkpoint, it reads the spec line
- **AND** when a spec run is at its checkpoint and an interlock gate line of the settle run's review crosses, the settle reader files it although the spec reader declines it

### Requirement: The settle meter SHALL observe only, from the pinned lines and the pinned role sources, and the guarantee SHALL be pinned statically

The settle meter's rules SHALL live in one pure module, `lib/settle-meter.mjs`, that imports nothing from `node:`, spells no engine call, and is reached from the hooks module through the pinned Node-free import walk. Every hook the settle meter adds or joins SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply; it SHALL add no deny, no substitute result, no catch handler, no new engine call, no new hooked event name, no new session-state key and no timer. A `node --test` case SHALL assert: that the hooks module's engine calls are still the recorded allow-list and its hooked event names the recorded list; that `SETTLE_PANE` is spelled in the hooks module as the pure module exports it; that neither the hooks module, the spec meter's rules nor the settle meter's rules spell the word `complete` or `interlock:advisor`; that the prompt, Skill and Read observers still pass their events on as they came; that `roleOf` classifies the first line of each bundled dimension brief, the first sentence of each of review-code's two skeptic blockquotes, the first line the remediate prompt assembler prints and the first line the conformance brief prints, each as its role, and a delimited repository review policy block followed by a dimension brief as that dimension; that every stage, as the settle reader splits it, of every fenced `interlock`, `gh`, `glab` and `git` command line of the settle skill and every fenced `interlock` line of the review-code skill is keyed, where a stage whose first word is `interlock` SHALL have a kind and only a non-`interlock` stage MAY instead match a command prefix the test writes down; and that every keyed line kind appears in some skill line; and that the kit's settle fixtures are the captured payloads, by provenance. The mod's tests for the settle meter SHALL live under `test/mod/` as `*.test.ts`, run by `claude plugin test`, and never be collected by `npm test`.

#### Scenario: Happy path — the pins hold on the shipped module

- **GIVEN** the module and the pure settle module as shipped
- **WHEN** `node --test test/spine/mod-pins.test.mjs test/spine/settle-meter.test.mjs` runs and then `claude plugin validate . --strict`
- **THEN** the allow-list, the event list, the `SETTLE_PANE` pin, the word pins, the role-source pin, the skill-lines pin and the fixture mirror all pass
- **AND** the validator's `hooks:` line lists the `interlock-settle` pane and its command beside the four earlier panes and commands, and its `calls:` line names nothing the settle meter added

#### Scenario: Failure — a reworded role source or a stray skill line fails a pin

- **GIVEN** the second skeptic blockquote in `skills/review-code/SKILL.md` reworded so its first sentence no longer begins `You are an independent reviewer giving a second opinion.`, or a new fenced `interlock settle <word>` line added to the settle skill that no keyed line covers, or a new `interlock` verb piped after an allowed `git diff` stage, or `lib/settle-meter.mjs` importing `node:path`
- **WHEN** `npm test` runs
- **THEN** the role-source pin, the skill-lines pin or the import walk fails naming the sentence, the line or the import
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the engine's behaviour stands

- **GIVEN** a Bash result that makes the settle line reader throw, a spawn whose prompt is not a string, or a pane draw whose clock read rejects
- **WHEN** the engine runs the chain
- **THEN** the tool call, the spawn or the draw resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and one debug-log line names what was not drawn
