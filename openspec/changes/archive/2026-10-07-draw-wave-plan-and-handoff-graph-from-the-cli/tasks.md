## 1. Failing tests first (TDD, red)

- [x] 1.1 Create `test/fixtures/ship/halted-run-6e9d0b02/` holding `plan.json`, `state.json` and `trajectory.jsonl`, byte copies (`cp`, no reformatting) of `.claude/ship/plan.json`, `.claude/ship/state.json` and `.claude/ship/runs/6e9d0b02-c70b-4d7a-9865-fa892722cecb.jsonl` (design D10). Confirm `git check-ignore` matches none of the three, that `trajectory.jsonl` has 26 lines, and that `state.json`'s `runId` is `6e9d0b02-c70b-4d7a-9865-fa892722cecb`. Add no provenance key to any file. (spec: ship/diagrams — The wave board SHALL be keyed by wave position and SHALL name each lane as its agent is named; The handoff graph SHALL be drawn from the trajectory in sequence order and SHALL state its two caveats)

- [x] 1.2 Write `test/spine/draw-plan.test.mjs`, its header naming the three source paths and the copy date. Cases:
  - **Board, no overlay, at `LIMITS.waveBoardDefaultColumns`:** three blocks whose top rules start `┌─ wave 1 · idx 0 · group 1`, `┌─ wave 2 · idx 1 · group 1` (with `5 batches`) and `┌─ test wave`; the five lanes of the first block and the six of the second sit in different blocks; no top rule names a group without `idx`; every lane row of the second block starts `│ b0` … `│ b4`; the `1.5` row carries `←1.6`, the `1.1` row `←1.3`, `2.2` `←2.1` and `2.3` `←2.2`, and `2.1` carries no `←`; the header carries `plan only` and no row carries a word from `STATE_WORDS`; the last line starts `then: verify-final → commit → close`. Each row's label plus ` · ` plus gist equals `laneTitle(lane)`, imported from `lib/lane.mjs`.
  - **Empty plan** (`{ waves: [], testWave: null }`, plus `null` and `'x'`): returns an array; the header reads `holds no waves`; no line starts `┌`, `│` or `└`; a tail line is present.
  - **Cut:** a one-lane plan whose description is longer than the row leaves, drawn at `LIMITS.waveBoardMinColumns + 10` with an overlay: the row ends `…`, `[...row].length` equals the width, and the row still holds the lane's model, `T<tier>`, effort and state word in full.
  - **Below the minimum:** at `LIMITS.waveBoardMinColumns - 1`, exactly one line, naming both numbers, with none of `┌│└─`. A non-integer `columns` draws at the default.
  - **Overlay, the fixture state:** `1.7 1.4 1.2 1.3` read `ok`, `1.6` `not recorded`, `1.5 1.1` `failed`, `2.1` `current`, and `2.2 2.3 3.2 3.1 3.3` `not reached`; the header carries `cursor idx 1` and `halted`; the tail carries the state's halt reason at a width of 400; a line under the last block names `task-1.6-verify-settings`, `wave 1`, `impl` and `no error recorded`, and no `│` row carries that id.
  - **Skip by group:** the fixture state's cell after idx 0 carries `1 skip for group 1` and `idx 0 or idx 1`; no line contains `skipped: no-detectable-command`. With a synthetic plan whose waves carry groups 1 and 2 and a state skipping group 1, the cell after idx 0 reads `skipped: <reason>`.
  - **Wave-count mismatch:** the fixture plan against the fixture state with its `waves` cut to two: the header names `state has 2 waves, plan has 3` and `by task id only`; the completed ids still read `ok`; no row reads `current`; no verify cell carries a skip.
  - **Mermaid:** line 1 is `flowchart LR` and line 2 starts `%% source:`; there are subgraphs `W0`, `W1`, `W2` and `W1B0`…`W1B4`; one line is the main chain `W0 --> V0{{…}} --> W1 --> V1{{…}} --> W2 --> VF[[…]] --> C[[…]] --> X[[…]]`; the four `-. dependsOn .->` edges run `L1_3→L1_1`, `L1_6→L1_5`, `L2_1→L2_2` and `L2_2→L2_3`; two renders are equal; with the overlay, every lane node's label ends with its state word; no line matches `style`, `classDef`, `class `, `linkStyle` or `:::`.
  - **The `docs/10` pin:** a `compareFence(docPath, text, lines)` helper in this file finds the `<!-- generated: interlock waves --plan test/fixtures/ship/halted-run-6e9d0b02/plan.json --format mermaid -->` comment and compares the next ```` ```mermaid ```` fence body line by line with `drawPlanMermaid(plan, { source: 'test/fixtures/ship/halted-run-6e9d0b02/plan.json' })`. It returns `null`, or a message naming `docs/10-agentic-workflow-ship-and-spec.md` and the first differing line. One case asserts `null` on the real document; another edits one line of a copy and asserts the message names the document and that line.
  - **The purity pin:** `walkModule` imported from `../helpers/module-walk.mjs` reports no problem for `lib/draw-plan.mjs`, `lib/draw-run.mjs` and `lib/lane.mjs`, and their closure is within those three plus `lib/limits.mjs`; none of the three sources contains `process.`, `Date`, `performance`, `globalThis`, `readFileSync` or `import(`; `test/spine/mod-pins.test.mjs`'s source imports `walkModule` from `../helpers/module-walk.mjs`; and walking `lib/ship-stage.mjs` reports a problem naming the file and `'node:fs'`.

  Run `node --test test/spine/draw-plan.test.mjs` and record that it fails, on the missing `lib/draw-plan.mjs`. (spec: ship/diagrams — The wave board SHALL be keyed by wave position and SHALL name each lane as its agent is named; The overlay SHALL show only recorded facts and SHALL name each attribution the state does not force; The Mermaid plan SHALL be generated from the plan, and the documented block SHALL be pinned to it; The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 1.3 Write `test/spine/draw-run.test.mjs`, parsing the fixture `trajectory.jsonl` line by line into `records`, the state wrapped as `{ value, read: 'ok' }` and the manifest as `{ value: null, read: 'absent' }`. Cases:
  - **Board, the real run:** the header names `6e9d0b02-c70b-4d7a-9865-fa892722cecb`, `harden-unattended-ship-runs`, `26 records`, `state.json: this run` and `run.json: absent`. The node lines appear in this order: `[1-2]` create → run-batch idx 0; `[3]` run-start; `[4-5]` next → run-batch idx 0; an `idx 0 · implementers [6-10]` group with rows `[6]`…`[10]` for `1.7 1.4 1.2 1.3 1.6`; `[11]` spawn `record-batch-1`; `[12-13]` record-batch → verify idx 0, carrying `skip (group 1): no-detectable-command`; `[14-15]` record-verify → run-batch idx 1, followed by four packet lines `1.7 ok · confirmed`, `1.4 ok · confirmed`, `1.2 ok · confirmed`, `1.3 partial · confirmed`; an `idx 1 · implementers [16-21]` group; `[22]` spawn `tick-1`; `[23-25]` halt with `exit 1` and the `run-halt` reason; `[26]` receipt as the last node.
  - **The caveats:** every implementer row carries `result: not recorded`; the header counts `13 of 13 spawns`; `step-emission times` appears exactly once.
  - **Another run:** the state with its `runId` changed: the header reads `state.json: another run <that id>`; there are no packet lines; no implementer row carries a `[ids]` cell from the state; no step reads a skip.
  - **The manifest joins:** a synthetic `{ schema: 'interlock.run/1', runId: <the run>, dispatched: [{ label: '1.7', kind: 'implementer', sha: <64 hex> }] }` gives `run.json: this run`, `sha <first 12>` on the `1.7` row, and `sha not recorded` on `1.4`.
  - **Order and junk:** the records reversed draw the same lines as in file order. A record `{ type: 'future-type', seq: 27 }`, a record with no `seq`, and `skipped: [{ line: 3 }]` are each counted in the header and drawn as nothing.
  - **Width:** at `LIMITS.waveBoardMinColumns - 1`, one line; at 80, no line is wider than 80.
  - **Mermaid:** line 1 is `flowchart TD` and line 2 starts `%% source:`; the edge into `n14` is labelled with `record-verify` and the four `<id> <status>/<verdict>` pairs; no style directive appears.

  Run `node --test test/spine/draw-run.test.mjs` and record that it fails, on the missing `lib/draw-run.mjs`. (spec: ship/diagrams — The handoff graph SHALL be drawn from the trajectory in sequence order and SHALL state its two caveats; The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 1.4 In `test/spine/limits.test.mjs` add two cases, following the meter caps' pair at `:119-137`. First, `formatLimits()` prints `wave board min width (columns)` and `wave board default width (columns)`, each followed by its `LIMITS` value. Second, `lib/draw-plan.mjs` and `lib/draw-run.mjs` each contain `LIMITS.waveBoardMinColumns` and `LIMITS.waveBoardDefaultColumns`, `bin/interlock` contains `LIMITS.waveBoardDefaultColumns`, and `docs/07-cli-and-configuration.md` names `interlock limits` and neither printed label followed by a number. Leave every existing case as it is; the cap-authority sweep covers the new keys by construction. Run the file and record that the two new cases fail. (spec: ship/diagrams — The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 1.5 In `test/spine/cli.test.mjs` add a `--format` block using the file's `run` helper and scratch dirs. For `waves`:
  - `--plan <copy> --state <copy> --format board --columns 80` exits 0, every stdout line is at most 80 code points, the header carries `cursor idx 1`, and rows carry `ok` and `failed`. `--format mermaid` on the same inputs prints `flowchart LR` first.
  - `--format board --json` exits non-zero with stderr naming `--format` and `--json`. `--format wat` exits non-zero naming `board` and `mermaid`. `--columns 80` and `--state <copy>` without `--format` each exit non-zero naming `--format`. `--plan` with `--classified` exits non-zero naming both.
  - `--plan missing.json --format board` prints exactly `no plan at missing.json` and exits 0. `--plan <copy> --state missing.json --format board` exits 0 with a header carrying `plan only` and `no state at missing.json`.
  - `--plan <copy>` alone prints exactly `formatPlan(plan)`. `--classified <fixture>` without `--format` prints exactly `formatPlan(planWaves(input))`.

  For `run-log show`, with a scratch state home holding the fixture as `.claude/ship/runs/6e9d0b02-c70b-4d7a-9865-fa892722cecb.jsonl` and `.claude/ship/state.json`, run with `--root` and `--state-home` both pointing at it:
  - `--format board` exits 0 with `state.json: this run` and `run.json: absent` in the header. `--format mermaid` prints `flowchart TD` first.
  - With the state's `runId` rewritten, the header reads `state.json: another run` with no packet line, and the command exits 0.
  - `never-recorded --format board` prints the same bytes as `never-recorded` without `--format` and exits 0.
  - Without `--format`, the output equals `formatRunLog(readRunLog(home, id))`.
  - `--format board --json` and `--format wat` exit non-zero naming the flags and the two formats. `run-log query --run <id> --format board` exits non-zero naming `show`.

  Run the file and record that the new cases fail. (spec: ship/diagrams — The CLI SHALL expose both diagrams behind flags that leave every exit code as it is; ship-run — Session-query over trajectories)

## 2. The lane module, the widths and the walker (no renderer yet)

- [x] 2.1 Create `lib/lane.mjs`, importing only `EFFORT` and `LANE_CAPS` from `./limits.mjs`. Move `laneTier`, `laneLabel`, `TITLE_SEPARATOR`, `TITLE_MAX` (still unexported), `laneTitle`, `laneModel` and `laneEffort` from `lib/waves.mjs:471-588` with their doc comments and unchanged bodies, and add `fitRow(text, columns)` per design D3: returned unchanged at or under `columns` code points, else the first `columns - 1` code points and `…`. In `lib/waves.mjs`, import the five functions from `./lane.mjs` for internal use and re-export them and `TITLE_SEPARATOR`. Keep `effectiveLaneCaps` and `capForTier` in `lib/waves.mjs`, which still reads `LANE_CAPS.byTier`, and drop `EFFORT` from its `./limits.mjs` import (`:105`), since `laneEffort` was its only reader there (`:587`). `node --test test/spine/waves.test.mjs test/spine/plan-fingerprint.test.mjs test/workflows.test.mjs` stays green with no edit to any of them. (spec: ship/diagrams — The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits; The wave board SHALL be keyed by wave position and SHALL name each lane as its agent is named)

- [x] 2.2 In `lib/limits.mjs` add `waveBoardMinColumns: 48` and `waveBoardDefaultColumns: 100` after `meterTickMs`, with doc comments giving design D8's derivation (41 columns of fixed cells plus one ordered-after id; the fixture's widest uncut lane row is 89 columns) and naming their readers. Print them from `formatLimits` as `wave board min width (columns)` and `wave board default width (columns)` after `meter tick (ms)`. Both of task 1.4's printing assertions go green; its reader assertions wait for §3 and §4. (spec: ship/diagrams — The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 2.3 Create `test/helpers/module-walk.mjs` exporting `specifiers(source)` and `walkModule(entry, root)`, moved verbatim from `test/spine/mod-pins.test.mjs:101-140`, with `walkModule`'s `root` a required parameter and the file's own `rel` helper taking it. In `test/spine/mod-pins.test.mjs`, delete the two definitions, import both from `../helpers/module-walk.mjs`, re-export them, and pass `ROOT` where the two walker tests (`:276-286`) call `walkModule`. Leave every assertion and message unchanged. `node --test test/spine/mod-pins.test.mjs` stays green. (spec: ship/diagrams — The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

## 3. The two renderers (needs §2)

- [x] 3.1 Create `lib/draw-plan.mjs`, importing only from `./lane.mjs` and `./limits.mjs`, and exporting `drawPlanBoard(plan, opts)`, `drawPlanMermaid(plan, opts)` and the frozen `STATE_WORDS` as design D2 states them. Build the board as internal `{ key, text }` rows and return their texts. Draw:
  - the header, blocks, rows, verify cells, unplaced failures and tail of D4, each line through `fitRow`, rule lines built to the width, and the one spoken line below `LIMITS.waveBoardMinColumns`, with `LIMITS.waveBoardDefaultColumns` for a missing or non-integer width;
  - the overlay of D5: positional only on equal wave counts, the word order, per-task words in a mixed lane, the group rule for skips and unresolved entries with the first-boundary ambiguity text and `see idx <a>`, and `no skip recorded` for an empty reached boundary;
  - the Mermaid of D6: positional subgraph and gate ids, the label-derived lane ids with collision suffixes, `#quot;` escaping, dotted `dependsOn` edges from `plan.deferred`, and the `%% dependsOn …` comment for an id in no lane.

  Read of the plan only `waves`, `testWave` and `deferred`. Never read `plan.lanes`, `plan.effort` or `task.dependsOn`, never throw, and treat a wave with no `kind` as `impl`. Task 1.2 goes green except the `docs/10` pin, which waits for §5. (spec: ship/diagrams — The wave board SHALL be keyed by wave position and SHALL name each lane as its agent is named; The overlay SHALL show only recorded facts and SHALL name each attribution the state does not force; The Mermaid plan SHALL be generated from the plan, and the documented block SHALL be pinned to it; The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 3.2 Create `lib/draw-run.mjs`, importing only `laneLabel` and `fitRow` from `./lane.mjs` and `LIMITS` from `./limits.mjs`, and exporting `drawRunBoard(run, opts)` and `drawRunMermaid(run, opts)` as design D2 states them. Implement design D7:
  - Sort by `seq`, keeping file order on ties. Count and skip unsequenced records, types outside the module's own list of the nine trajectory types, and `skipped` lines.
  - Build step nodes (a `wave-action` joined to its `cli-exit`, labelled by `source`), spawn nodes with implementers grouped under their step, `agent-result` joined by label to the earliest open spawn, verify-judgement, run-start and run-complete nodes, the merged halt node, and the receipt last.
  - Join the state and the manifest only when their `runId` is the run's; otherwise name each as `another run <id>`, `absent` or `unreadable` in the header.
  - Add packet lines under the first step entering each position `k > 0`, with `no audit recorded` where the audit is missing. Take the sha from the manifest's `dispatched[]` by label, in order. Place verify skips by reached boundary.
  - State the spawn-time caveat once and the count of spawns with no result.
  - Draw the `flowchart TD` with `n<seq>` and `I<seq>` ids, `source`-labelled edges, and the packets on the edge into the first step of each later position.

  Never throw. Task 1.3 goes green, and so do task 1.4's reader assertions for both renderers. (spec: ship/diagrams — The handoff graph SHALL be drawn from the trajectory in sequence order and SHALL state its two caveats; The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits; ship-run — Session-query over trajectories)

## 4. The CLI flags (needs §3)

- [x] 4.1 In `bin/interlock`, import `drawPlanBoard` and `drawPlanMermaid` from `../lib/draw-plan.mjs`, `drawRunBoard` and `drawRunMermaid` from `../lib/draw-run.mjs`, and `STATE_PATH` and `MANIFEST_PATH` from `../lib/run.mjs`. Add one `boardColumns(flags)` helper: `--columns` through `num` and a positive-integer check, else `process.stdout.columns` when `process.stdout.isTTY` and it is an integer, else `LIMITS.waveBoardDefaultColumns`. Add one `readSource(path)` helper returning `{ value, read: 'ok' | 'absent' | 'unreadable' }`. Then:
  - In `case 'waves'` (`:1797-1811`), implement design D9's order of refusals (`--format` value, `--format` with `--json`, `--state` or `--columns` without `--format`, `--plan` with `--classified`). Read `--plan` before `--classified`: a missing path prints `no plan at <path>` and exits 0, or `{ plan: null, reason }` with `--json`. A missing `--state` becomes `stateNote: 'no state at <path>'`. Pass the `--plan` argument, or `interlock waves --classified <path>`, as the Mermaid `source`. Print `lines.join('\n') + '\n'`.
  - In `run-log`, have `list`, `query`, `append` and `check` refuse `--format`. Have `show`, when `--format` is given, refuse `--json` and an unknown format; print `formatRunLog(result)` unchanged when `result.exists` is false; otherwise read the state and manifest from `join(logHome, STATE_PATH)` and `join(logHome, MANIFEST_PATH)` (a manifest whose `schema` is not `interlock.run/1` reads `unreadable`), and print the drawn lines.
  - Extend the usage text: the `waves:` block (`:407-411`) gains `--plan`, `--format board|mermaid`, `--state` and `--columns`, saying the widths are in `interlock limits` and that Mermaid is never cut; the `run-log:` block (`:560`) and the command line at `:288` gain `show --format`.

  Leave every path without `--format` or `--plan` unchanged. `npm test` is green except the `docs/10` pin. (spec: ship/diagrams — The CLI SHALL expose both diagrams behind flags that leave every exit code as it is; ship-run — Session-query over trajectories)

## 5. Docs, changelog, brief and verification (needs §4)

- [x] 5.1 In `docs/07-cli-and-configuration.md`, extend the `interlock waves` row of the command table with `--plan`, `--format board|mermaid`, `--state` and `--columns`, and the `interlock run-log` row with `show --format`. Add a `### Drawing a plan and a run: --format board|mermaid` subsection before `### The ship meter`. It should say: what each form draws; that the board keys waves by position because two waves can share a group; what the six state words mean and that a skip recorded by group is left unplaced when two boundaries share it; the handoff graph's two caveats; that the two widths are printed by `interlock limits`, without restating either number; that `--format` refuses `--json`; and that a missing file is spoken and exits 0. (spec: ship/diagrams — The CLI SHALL expose both diagrams behind flags that leave every exit code as it is; The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 5.2 In `docs/10-agentic-workflow-ship-and-spec.md`, add `### The plan, drawn` after lean step 9 and before `### The --strict sequence`. Write two sentences saying the block below is generated from the fixture plan of a real halted run and that a test pins it, then the HTML comment `<!-- generated: interlock waves --plan test/fixtures/ship/halted-run-6e9d0b02/plan.json --format mermaid -->`, then a ```` ```mermaid ```` fence holding exactly the stdout of `node bin/interlock waves --plan test/fixtures/ship/halted-run-6e9d0b02/plan.json --format mermaid`. Do not edit it by hand. The `docs/10` pin in `test/spine/draw-plan.test.mjs` goes green. (spec: ship/diagrams — The Mermaid plan SHALL be generated from the plan, and the documented block SHALL be pinned to it)

- [x] 5.3 In `docs/assets/DESIGN-PROMPT.md`, after `Its ship strip is stale; the revision prompt is below.` (`:286`), add one sentence pointing at the generated block in `docs/10-agentic-workflow-ship-and-spec.md` (`### The plan, drawn`) as the current wave structure. It should say the block regenerates with `interlock waves --plan <file> --format mermaid` and is pinned by a test, while the poster is not. (spec: ship/diagrams — The Mermaid plan SHALL be generated from the plan, and the documented block SHALL be pinned to it)

- [x] 5.4 In `CHANGELOG.md`, add a `## Unreleased` heading above `## 1.2.1 — 2026-10-06` if no such heading exists by then; otherwise add to it. Under `### Added`, write one entry in the file's voice: the CLI draws a plan as a wave board and as Mermaid, and a run as a handoff graph. Sub-bullets cover:
  - the flags, and that `--format` refuses `--json`;
  - waves keyed by position, and the overlay's unplaced attributions;
  - the two caveats on the handoff graph;
  - the two widths in `interlock limits`;
  - `lib/lane.mjs` holding the lane rule, re-exported by `lib/waves.mjs`;
  - the pinned `docs/10` block;
  - no exit code changed and no dependency added.

  (spec: ship/diagrams — The CLI SHALL expose both diagrams behind flags that leave every exit code as it is)

- [x] 5.5 In `briefs/claude-code-teams-and-orchestration-briefs.md`, under `### App ideas, revised` (`:1340`), after its bullets and before `### Rejected mechanisms (mods), so nobody re-proposes them`, add a dated paragraph `**Note, <date>: the plan and the run, drawn.**`. It names this change and `draw-the-wave-board-in-the-meter-pane`, says no brief asked for a diagram and the deep-research note recommended both (key questions 6 and 7), and states the order: the Node-free renderer and `lib/lane.mjs` here, the pane after. (spec: ship/diagrams — The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

- [x] 5.6 Final verification: run `npm test` and `npm run validate`. If a test fails, fix the code, not the test. Append a `## Closing note (<date>)` to this file holding both commands' tails pasted verbatim, any sandbox caveat the run needed (the notify-relay cases bind a local port), and the output of `node bin/interlock waves --plan test/fixtures/ship/halted-run-6e9d0b02/plan.json --state test/fixtures/ship/halted-run-6e9d0b02/state.json --format board --columns 80` for comparison with design D4's worked example. (spec: ship/diagrams — The CLI SHALL expose both diagrams behind flags that leave every exit code as it is; The renderers SHALL be pure and Node-free, and SHALL read their widths from the published limits)

## Closing note (2026-10-06)

`npm test`, run inside the sandbox, ended:

```text
ℹ tests 2622
ℹ suites 14
ℹ pass 2612
ℹ fail 6
ℹ cancelled 0
ℹ skipped 4
ℹ todo 0
```

The six failures are all notify-relay cases in `test/spine/run.test.mjs`, and each is `listen EPERM: operation not permitted 127.0.0.1`: the sandbox refuses loopback binding. `node --test test/spine/run.test.mjs` re-run outside the sandbox ended:

```text
ℹ tests 157
ℹ suites 0
ℹ pass 157
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm run validate` ended:

```text
  ❯ ./mod.mjs state writes: interlock.ledger
  ❯ ./mod.mjs state reads: interlock.ledger

✔ Validation passed
```

`node bin/interlock waves --plan test/fixtures/ship/halted-run-6e9d0b02/plan.json --state test/fixtures/ship/halted-run-6e9d0b02/state.json --format board --columns 80` prints the following. It matches design D4's worked example line for line:

```text
plan · 3 waves · 13 tasks · run 6e9d0b02 · cursor idx 1 b1 · halted
┌─ wave 1 · idx 0 · group 1 · impl · 1 batch ───────────────────────────────────
│ b0 1.7 sonnet T4 inherit ok           · Docs (design D2, D4, D5, D7
│ b0 1.4 sonnet T3 inherit ok           · In lib/receipt.mjs (design D4, D5, D7
│ b0 1.2 sonnet T2 low     ok           · Create lib/project-slug.mjs exporting…
│ b0 1.3 sonnet T2 low     ok           · In lib/limits.mjs add notifyTimeoutMs…
│ b0 1.6 haiku  T1 low     not recorded · Verify — do not edit
└───────────────────────────────────────────────────────────────────────────────
  verify after idx 0 · 1 skip for group 1 · state does not say idx 0 or idx 1 ·…
┌─ wave 2 · idx 1 · group 1 · impl · 5 batches ─────────────────────────────────
│ b0 1.5 sonnet T4 inherit failed       ←1.6 · In lib/doctor.mjs (design D5, D1…
│ b0 1.1 sonnet T3 inherit failed       ←1.3 · Create lib/notify.mjs (design D1…
│ b1 2.1 sonnet T4 inherit current      · In lib/run.mjs (design D1, D5, D7
│ b2 2.2 sonnet T3 inherit not reached  ←2.1 · In bin/interlock (design D1, D14…
│ b3 2.3 sonnet T2 low     not reached  ←2.2 · In workflows/ship.js and bin/int…
│ b4 3.2 sonnet T2 low     not reached  · In skills/spec/SKILL.md §6 (design D6
└───────────────────────────────────────────────────────────────────────────────
  verify after idx 1 · not reached · group 1 skips: see idx 0
┌─ test wave · idx 2 · test · 1 batch ──────────────────────────────────────────
│ b0 3.1 sonnet T3 inherit not reached  · In test/workflows.test.mjs (design D1…
│ b0 3.3 sonnet T2 low     not reached  · Run 'openspec validate harden-unatten…
└───────────────────────────────────────────────────────────────────────────────
  unplaced: task-1.6-verify-settings · wave 1 impl · no error recorded
then: verify-final → commit → close · halted: 3 task failures accumulated acros…
```

One departure from design D7: the run board's header orders its fields `run <id> · <n> records · state.json: … · run.json: … · <change>`, with the change name last. In D7's order, the full run id and change name pushed the source words past the default width, so `--format board` piped at the default cut `state.json: t…`. With the change name last, it is the prose that gives way first, which is the cut order D4 sets for a lane row.
