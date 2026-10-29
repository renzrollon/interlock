# Spec Delta

## MODIFIED Requirements

### Requirement: The settle meter SHALL observe only, from the pinned lines and the pinned role sources, and the guarantee SHALL be pinned statically

The settle meter's rules SHALL live in one pure module, `lib/settle-meter.mjs`, that imports nothing from `node:`, spells no engine call, and is reached from the hooks module through the pinned Node-free import walk. Every hook the settle meter adds or joins SHALL resolve to the engine's own behaviour: `next(e)`, `yield* next(e)`, a drawing, or an empty command reply; it SHALL add no deny, no substitute result, no catch handler, no new engine call, no new hooked event name, no new session-state key and no timer. A `node --test` case SHALL assert: that the hooks module's engine calls are still the recorded allow-list and its hooked event names the recorded list; that `SETTLE_PANE` is spelled in the hooks module as the pure module exports it; that neither the hooks module, the spec meter's rules nor the settle meter's rules spell the word `complete` or `interlock:advisor`; that the prompt, Skill and Read observers still pass their events on as they came; that `roleOf` classifies the first line of each bundled dimension brief, every prompt `interlock review brief --dimension` prints, the first sentence of each skeptic prompt `interlock review brief --skeptics` prints, the first line the remediate prompt assembler prints and the first line the conformance brief prints, each as its role, and a delimited repository review policy block followed by a dimension brief as that dimension; that every stage, as the settle reader splits it, of every fenced `interlock`, `gh`, `glab` and `git` command line of the settle skill and every fenced `interlock` line of the review-code skill is keyed, where a stage whose first word is `interlock` SHALL have a kind and only a non-`interlock` stage MAY instead match a command prefix the test writes down; and that every keyed line kind appears in some skill line; and that the kit's settle fixtures are the captured payloads, by provenance. The mod's tests for the settle meter SHALL live under `test/mod/` as `*.test.ts`, run by `claude plugin test`, and never be collected by `npm test`.

#### Scenario: Happy path — the pins hold on the shipped module

- **GIVEN** the module and the pure settle module as shipped
- **WHEN** `node --test test/spine/mod-pins.test.mjs test/spine/settle-meter.test.mjs` runs and then `claude plugin validate . --strict`
- **THEN** the allow-list, the event list, the `SETTLE_PANE` pin, the word pins, the role-source pin, the skill-lines pin and the fixture mirror all pass
- **AND** the validator's `hooks:` line lists the `interlock-settle` pane and its command beside the four earlier panes and commands, and its `calls:` line names nothing the settle meter added

#### Scenario: Failure — a reworded role source or a stray skill line fails a pin

- **GIVEN** the skeptic assembler edited so the second skeptic prompt no longer begins `You are an independent reviewer giving a second opinion.`, or a new fenced `interlock settle <word>` or `interlock review <word>` line added to a skill that no keyed line covers, or a new `interlock` verb piped after an allowed `git diff` stage, or `lib/settle-meter.mjs` importing `node:path`
- **WHEN** `npm test` runs
- **THEN** the role-source pin, the skill-lines pin or the import walk fails naming the sentence, the line or the import
- **AND** no session needs to load the module to find it

#### Scenario: Edge case — a hook that throws is skipped and the engine's behaviour stands

- **GIVEN** a Bash result that makes the settle line reader throw, a spawn whose prompt is not a string, or a pane draw whose clock read rejects
- **WHEN** the engine runs the chain
- **THEN** the tool call, the spawn or the draw resolves as the engine alone would have resolved it
- **AND** the module's later hooks keep working and one debug-log line names what was not drawn

### Requirement: The status line and the pane SHALL repeat the CLI's own words from the settle and review lines, read at every pipe stage, and SHALL make no verdict of their own

While a settle run is live, a Bash call of the main session (one whose event carries no `agentId`: every keyed line of a pass runs there, and a ship lane's `interlock verify exec` or `git commit` is never the pass's) whose command, or one of its segments or pipe stages, begins with one of the keyed lines SHALL be let through and its result read, on the Bash hook's path with no ship run live and on its path with one live alike, and whether or not the spec meter's reader keyed or declined the same line. Segments are split at unquoted `&&`, `||`, `;` or line breaks; each segment is further split at unquoted `|` and at `$(`, a `$(` inside double quotes included; the body of a quoted heredoc is one argument and is never re-split; and every stage is keyed by its own first words. A line that crosses again SHALL append a row, never replace the earlier one.

The keyed lines and the fields read from each:
- `interlock routing --json` (with or without `--depth`): `depth`, `roles.<role>.model`, `roles.<role>.effort`, `review.dimensions`, `review.skeptics`, `banners`; `interlock routing <role> --json`: `role`, `model`, `effort`, `banners`
- `interlock surface`, `interlock domain-context`, `interlock gate`, `interlock-graph covers`, `interlock changes`, `interlock review-policy`, `interlock autonomy record`, `interlock note derive`: the command words and the exit code
- `interlock review … --json` (with or without `--out <file>`), whose second word is not `brief` or `proof`: `counts.raised`, `counts.dismissed`, `counts.surviving`, `counts.carried`, `dimensionStats` by name, `head`, `dimensions.ran`, `dimensions.skipped` (the `name` of each `{ name, reason }`), `dimensions.unavailable`, `dimensions.degraded` (the `name` of each), `dimensions.depth`, `proof.proven` and the counts of `proof.unproven`, `proof.unread` and `proof.uncited`, the skipped, unavailable and degraded names drawn on the review row; never `dimensions.completed`
- `interlock review brief --dimension <name>` and `interlock review brief --skeptics --json`: the dimension name or `skeptics`, the number of `prompts`, and the exit code; never the prompt text
- `interlock review … --draft`: drawn as one `draft` row with the CLI's counts and `proof.proven`, never as the round's review record
- `interlock review proof`: the first line of stdout (`proven`, `PROOF CAP REACHED: …`, or `re-run: …`) and the exit code
- `interlock settle staging-pathspecs`: the exit code
- `interlock settle archived-change`: the change name it printed, or on exit 1 the stderr line, and the exit code
- `interlock settle comment --round <n> --head <sha>`, `interlock settle replies --head <sha>`: the command words, the round and the exit code; the `gh pr comment <n>` / `glab mr note <iid>` stage beside them: its pull request number only
- `interlock settle tree-check`: the stdout it printed — `clean`, `clean (tolerated: …)`, or `dirty (<k>):` and the paths it listed — and the exit code
- `interlock settle test-paths … --json`: `protected` and `unprotected` by count and the `protected` paths, or, when `profile` is null, the `reason` field verbatim; with `--protected-only`, the exit code
- `interlock settle remediate-brief … --round <r> --change <c> --head <sha> --pr <n> … --json`: `findings` and `deferred` by count, `reReviewDimensions`; on exit 1 the stderr line beginning `STOP: `, verbatim, which ends the loop on the pane
- `interlock settle fixer-result --round <r>`: the stdout line `round <r>: <a> fixed, <b> not fixed`
- `git commit -m "<message>"`: the message's first line, or `(message not read)` when the message is written inside `$( )`; `git push`: the exit code; both only inside a round, and passed through unread outside one
- `gh pr ready <n>` / `glab mr update <iid> --ready`: the exit code
- `interlock settle conformance-brief <c> --head <sha>`: the exit code, and on an empty stdout the stderr line, verbatim
- `interlock verify plan`, `interlock verify exec --kind <kind>`, `interlock verify judge`, `interlock verify coverage`: the kind and the exit code; a result with no stdout reads `result not seen (redirected)`
- `gh pr checks <n> --watch` / `glab ci get --merge-request <iid>` when it is not piped onward (piped into `interlock pipeline` it is that line's input): `background` when the call ran in the background, else the exit code
- `interlock pipeline`: the stdout line beginning `pipeline <sha>:` or `pending <sha>:`, verbatim
- `interlock merge-confidence <c> … --json`: `verdict`, `score`, `head.sha`, and `labels.verdict.name` and `labels.score.name` drawn as `labels <verdict name>, <score name>`; with `--markdown` or a redirected result, the exit code, as a row of its own after the verdict row
- `interlock merge-confidence --label-names --json`: `labels.verdictNames` and `labels.scorePrefix`, as a row of its own, never `(unparsed)` for want of a verdict
- `gh pr edit <n> --add-label <names>` / `glab mr update <iid> --label <names>`: the label names; `gh pr edit <n> --remove-label <names>` / `glab mr update <iid> --unlabel <names>`: `removed` and the label names
- `interlock drift --changed … --json`: `unarchived` and `stale.broken` by count

Reading rules: stages SHALL be applied in the command's order; a stage whose result does not parse as JSON, or lacks the fields the line names, SHALL be shown as that line with `(unparsed)` and its first line of text, never as a verdict, and SHALL leave one debug-log line; a result the engine kept out of line (too large to read inline) SHALL be shown as `result not seen (too large)`, and a review record's `--out review-r<n>.json` SHALL still name its round; a stage's exit code SHALL be drawn as `exit <n>` only when the call's exit is that stage's own — the stage runs outside every `$( )`, is the last stage of its pipeline, sits in the command's last `;`-separated list, and that list joins its pipelines with `&&` alone, with more than one pipeline only for an exit of 0 — and otherwise as `exit not its own`; a failed `git commit … && git push` SHALL read `exit <n> from the commit or the push`; control characters SHALL be made spaces and every row, status line and toast cut to `settle row chars` from `interlock limits`; every other Bash call SHALL be passed through at the first line, its result unread. The module SHALL compare no count against any threshold, SHALL draw no tick, cross or verdict word of its own, and SHALL show no `quiet <n> min`.

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

#### Scenario: Edge case — an unproven review reads back as not proven, and the brief and proof lines are their own kinds

- **GIVEN** a live settle run
- **WHEN** `interlock review … --head e177e7d… --out .claude/ship/settle/review-r0.json --json` resolves with `counts: { raised: 0, dismissed: 0, surviving: 0 }` and `proof: { proven: false }` naming four unproven dimensions and four uncited files, then `interlock review proof --review .claude/ship/settle/review-r0.json` exits 1 naming `language`
- **THEN** the review row carries `not proven` with the counts 4 unproven and 4 uncited after the CLI's own counts, and no row reads it as a clean review
- **AND** the proof line is a row of its own naming `language` and `exit 1`, and is not read as a review record
- **AND** `git diff --name-status -M 251cebe...e177e7d | interlock settle archived-change --name-status - --json` is a row of its own naming `draw-the-settle-and-spec-panes-as-cards`, its `git diff` stage passed through unread
