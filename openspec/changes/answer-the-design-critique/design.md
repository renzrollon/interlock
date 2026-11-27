# Design

## Context

See proposal.md for why. It is one change rather than an epic, because the owner asked for one; `interlock validate` measures its width (D1). The discovery is in `.claude/handoff/explore-answer-the-design-critique-20261126-064937.md`, and the decision ids below are the rows of `decisions.md`.

Three surfaces, three constraints:

- **Terminal.** The CLI's help and refusal text are consumed by more than people.
  - About 30 test assertions, the postinstall smoke inventory and CI read `interlock --help` as the full usage.
  - `doctor`, the spec skill and their tests detect a pre-1.8 CLI by an `Unknown command` answer and a non-zero exit.
  - The halt summary's closing line is read by the ship skill and the relaunch guard.
  - The `guard-commit` reason is repeated to the person as a meter toast, once per distinct text per run.
- **Site.** The site is a Claude Design export.
  - Its brief, `site/DESIGN-PROMPT.md`, is the contract. A fix is written there first, then copied into the page string for string.
  - A fix the export would not produce is a local patch, recorded in `site/README.md` so the next install re-applies it.
  - Nothing tests the site's CSS, JS or DOM today.
- **README.** No test pins the README's install order. It must keep its pinned lines: the npm install line, the flow-node link titles, the network sentence, and no retired names.

The step-1 clarify pass left uncommitted edits in `README.md`, `site/*`, `DESIGN.md`, `PRODUCT.md` and `.impeccable/`. This change builds on that text as it stands in the working tree. The owner should commit it before ship, so ship's one commit carries only this change.

## Goals / Non-Goals

**Goals:**
- Every refusal and halt the terminal prints names the next action a person can take.
- No existing contract line moves: exit codes, the `Unknown command` first line, `--help`'s full text, the closing summary line, the `resume card:` row, the resume card.
- Every site fix survives a regeneration, because a test fails when one is dropped.

**Non-Goals (D20):**
- The critique's P2 items wait for a later change:
  - line length on the site;
  - the hero film's keyboard pause;
  - `role="listitem"` on the flow buttons;
  - doctor's settings-file wording;
  - board truncation;
  - the report HTML's kickers.
- A browser test for the site. The visual check stays with a person after ship.
- Relaying out the state-machine diagram (D13).

## Decisions

### CLI help: the index is new, the full text keeps its flag (D2, D3)

- **Module home (`lib/help-cli.mjs`).** `cli/interlock` is 244,912 bytes at HEAD — only 848 bytes below `test/spine/package.test.mjs`'s 245,760-byte headroom limit (`262,144 - 16,384`). Following the `lib/*-cli.mjs` convention (which `package.json`'s `"files": ["lib", ...]` ships and `test/spine/cli-arguments.test.mjs` automatically scans for flag reads, requiring no manifest update), `INDEX`, the `help` subcommand handler/dispatch and the unknown-command refusal/suggestion formatter live in a new `lib/help-cli.mjs`. `cli/interlock` keeps only a minimal forward for bare invocation, `help` and `default`, plus the `help` synopsis line in `USAGE`.
- **Bare `interlock` and `interlock help`.** They print `INDEX` from `lib/help-cli.mjs`: every top-level command, grouped under five or six headings for the part of the loop it serves (set up, spec, ship, settle, read the record, called by the loop), at most 30 lines. It ends with `interlock help <command>` and `interlock --help --all`.
- **`--help`.** It keeps printing the full `USAGE`, so every assertion, smoke check and CI line that reads it stays valid. Only `test/spine/cli.test.mjs:200-207`, which pins bare = `--help`, splits.
- **`--all`.** `--all` selects the full usage ONLY when no subcommand leads (`interlock --help --all`, `interlock -h --all`, `interlock help --all`). When a subcommand leads — notably `interlock review-policy suggest --all --help`, because `review-policy suggest` declares its own `--all` — the existing `-h`/`--help` path keeps printing the leading subcommand's usage lines (`helpFor(USAGE, rest._[0])`), never the full usage. `help: ['all']` is declared in `lib/cli-flags.mjs`'s `TABLE`.
- **`interlock help <command>`.** It calls the same `helpFor(USAGE, command)` that `<command> --help` uses (`SETTLE_HELP` for settle). The two forms are identical by construction. Adding the prose sections was rejected: `<command> --help` would then differ, and `doctor --help` is pinned as scoped.
- **The index cannot drift silently.** A test asserts that every top-level command in the full usage's synopsis appears in `INDEX`.

### Unknown subcommand: same first line, a suggestion after it (D4)

- The refusal keeps `Unknown command: <name>` as its first stderr line, and exit 1. That is what `lib/doctor.mjs:644-672` and the spec skill's version-skew check key on.
- Formatted in `lib/help-cli.mjs`, the full `USAGE` after that line is replaced by one `Did you mean: interlock <closest>?` line, when one is near, and a pointer to `interlock help`. Nothing parses the old tail.
- The suggestion is a pure function, `suggestCommand(input, names)` in `lib/cli-flags.mjs` beside `helpFor`.
- It ranks the command names by edit distance and returns the nearest within a small bound, or none. The bound is a code constant, not prose.
- The name list is read from the same source the index is checked against.

### Change listing skips dot-directories (D5)

- `listChanges` (`lib/artifacts.mjs:185-192`) also filters out names that start with `.`. `resolveChange` reads the same list, so every command that picks the change on its own (`validate`, `ledger`, `risk`, `ready`, `tasks`, `verify`, `plan`, `checkpoint`, `conformance`) gains the fix with no further edit.
- This diverges from `openspec list`, which still lists `.claude`. `docs/07-cli-and-configuration.md` says so beside the `interlock changes` row.
- **`skills/dispatch/SKILL.md` sees both listings — accepted without editing the skill.** `dispatch`'s Step 0 pre-flight runs both `openspec list --json` and `interlock changes`, so a stray dot-directory appears in `openspec list --json` and not in `interlock changes`. That divergence is deliberately accepted here rather than editing `skills/dispatch/SKILL.md`: `openspec list --json` supplies OpenSpec's own task/artifact status and is pinned after `openspec --version` in `test/skills.test.mjs:607`; routing to `ship` already runs `interlock validate <change>` (which uses `resolveChange` and ignores dot-directories); `docs/07-cli-and-configuration.md` documents the difference; and leaving `skills/` untouched avoids altering a shipped prose surface or contending on `test/skills.test.mjs` across parallel Wave 1 verification.
- The stray `openspec/changes/.claude/.cc-writes/` is a Claude Code sandbox artifact, not a repo file. It is not removed by this change.

### Commit denial names the way out (D9, D10)

- **Actual marker path and validated change.** `readStage` (`lib/ship-stage.mjs`) returns `path` — the actual repo-relative POSIX path it read on disk (built from `SHIP_DIR`, the directory entry name and `MARKER_FILE`), rather than re-deriving `.claude/ship/${marker.change}/stage.json`, which would turn a hand-written or older marker missing `change` into `.claude/ship/undefined/stage.json`. Before quoting `marker.change` into model-read text or matching it against the manifest, `guard-commit` validates it with `isChangeName` (`lib/artifact-snapshot.mjs`).
- **Usable matching manifest check.** On the deny path, `guard-commit` inspects `.claude/ship/run.json` in a try/catch via `inspectManifest` (`lib/run.mjs`, lazily imported only when denying so ordinary Bash calls pay no startup cost). A manifest is usable and matching ONLY when `inspected.status === 'ok'` (file exists, parses as JSON, carries `RUN_SCHEMA`) AND `isChangeName(marker.change)` AND `manifest.change === marker.change` AND the marker was read from `marker.change`'s own path (its `path` equals `.claude/ship/<marker.change>/stage.json`). The last condition is there because `runClose` clears `stagePath(manifest.change)` and no other file (`lib/run.mjs:4753`, `:4977`): a marker stored under another directory would survive the advised close and be denied again with the same advice.
- **A failed read changes the text, never the decision.** The deny decision still rests on the stage marker alone, as today. If the lazy import or `inspectManifest` throws, the guard treats the manifest as not usable, still denies with the hand-removal text, and puts the error in the deny detail; it never falls through to the outer `catch`'s allow. Checking usability with `inspectManifest` guarantees exact agreement with `runClose`: on a usable matching manifest, `interlock run close --halt` clears the marker (even if the run was already closed, via `clearLingeringStage`), whereas on an absent, unparseable or foreign-schema manifest `runClose` leaves the marker untouched (`closeUnusableManifest` at `lib/run.mjs:5346`, `docs/04-when-it-stops.md:104`), and on a manifest for another change `runClose` would act on that other run.
- **Two separated audiences.** The guard cannot tell a live run from a stopped one, and its first reader is an in-run worker that has Bash and no guard on `interlock run close`. To avoid handing a worker an escape hatch to halt its own run, the denial separates audiences explicitly:
  1. First, an instruction to an agent inside an active run: do not commit and do not close or halt the run; the run's commit step makes the commit.
  2. Second, a recovery instruction addressed to a person whose run has already stopped:
     - when a usable matching manifest exists: quote `runId` (when it is a plain non-empty identifier) and advise `interlock run close --halt "<reason>"` to clear the stage marker at `<markerPath>`;
     - when no usable matching manifest exists (absent, unparseable, foreign schema, mismatched `change`, missing/invalid `marker.change`, a marker stored outside its own change's directory, or a read that threw): name NO `runId`, do NOT advise `interlock run close --halt`, and instead name `<markerPath>` as the file to remove by hand (matching `closeUnusableManifest`'s wording).
- **Pure helper in `lib/ship-stage.mjs`.** `owedClose(markerPath)` accepts the actual marker path returned by `readStage` (normalized to POSIX `/`, never a driver-side literal, preserving `test/spine/ship-stage-drift.test.mjs`) and returns `{ markerPath, command }` where `command` is `interlock run close --halt "<reason>"`.
- The reason keeps its leading `guard-commit: ` (`lib/meter-refusals.mjs` slices from it) and the `GUARD` constant (`test/spine/mod-pins.test.mjs:1262`).
- The reason never includes the denied command, so repeated attempts produce one toast. `stage`, `command`, validated `change` (when valid) and matched `runId` (when matched) go in the deny detail, as `guard-tasks` already does.

### Halted summary: a commit-record line and pick-up steps, before the unchanged closing line (D6, D7, D8)

- **Scope.** Both additions live in `formatRunSummary` (`lib/receipt.mjs`) and therefore apply ONLY to a halted close that read a usable run manifest. The three halted summaries built outside `formatRunSummary` — the no-manifest close (`lib/run.mjs:4789`), `closeUnusableManifest` (`lib/run.mjs:5324`) and `closeAlreadyOnRecord` (`lib/run.mjs:4693`) — remain unchanged.
- **Placement.** In `formatRunSummary`, a `summary.halted` branch placed after the `resume card:` row and before line 564 adds:
  - `No commit is on record for this run.` when `committed` is false (`lib/receipt.mjs:548` computes it). A halt with a recorded commit already prints its `commit:` row.
  - the pick-up steps, addressed to the person.
- **Why not "Nothing was committed".** It is not provable: a stop after the commit spawn can leave `manifest.commit` null.
- **Where the steps come from (D8).** A pure function in `receipt.mjs`, `pickUpSteps(change, leftoverIds)`, which keeps the module import-free.
  - **`--ids` is NEVER filled from `leftoverIds`.** `leftoverIds` only decides whether the `interlock tasks tick` step prints (non-empty vs empty); `--ids` MUST stay a placeholder naming verified ids (matching `lib/resume-card.mjs:234-246`'s rationale: a paste-ready command over all leftover ids would tick unattempted work behind a `[x]`).
  - The resume card's text is unchanged: its printed commands are executed by its own tests, and the card spec pins what it carries.
  - A test asserts that summary and card both name `/interlock:ship <change>`, so the two cannot drift on the one command they share.
- **The closing line stays last and verbatim (D7).** The ship skill tells the model to print the summary and stop, `guard-relaunch` denies a relaunch without a new prompt, and five test files pin the sentence.

### Unreachable-close fallback, one sentence in both drivers (D11)

- `workflows/ship.js:667-668` and `cli/interlock-run:620-632` print the same core sentence after `SHIP HALTED — <reason>`: the close was not recorded (preserving `"no receipt was written"`, and noting no outcome or terminal trajectory event was recorded), the stage marker may still block `git commit`, and running `interlock run close --halt "<reason>"` from the directory the run started in clears it.
- **Why not "nothing was recorded" or "from the project root".** When the close cannot be reached, the manifest, the fatally appended trajectory and `last-step.json` are already on disk; `"nothing was recorded"` is reserved exclusively for the no-manifest close (`lib/run.mjs:4818`). And a linked-worktree run keeps its manifest and stage marker in that worktree, so `"from the project root"` would send the operator to the main working tree, where `run close` finds no manifest and clears nothing.
- **Actual run directory in `cli/interlock-run`.** `cli/interlock-run` knows `root` (unlike the sandboxed `workflows/ship.js`), so right below the shared core sentence it prints `  cwd: ${resolve(root)}`, matching the terminal summary's `cwd:` row.
- Neither driver spells out the marker path (`test/spine/ship-stage-drift.test.mjs`).
- `test/spine/close-fallback.test.mjs` combines two checks: (1) a source-equality test asserting the core sentence is present and identical in both `workflows/ship.js` and `cli/interlock-run` (since `ship.js` runs in the Workflow runtime and cannot import `lib/`) and that `cli/interlock-run` prints `cwd:`; and (2) a behavioural test using `test/helpers/ship-harness.mjs` where the close relay returns `null` and the emitted summary starts `SHIP HALTED — ` and carries the fallback sentence.

### docs/04 stops promising "nothing is committed" on every halt (D12)

- `docs/04-when-it-stops.md:7,48` are reworded to match D6.
- `:60` names the new lines between the `resume card:` row and the closing line.
- Inside `### \`RELAY UNREADABLE\``, immediately after the L87 paragraph ("The CLI's own bytes are always on disk..."), a short paragraph documents the unreachable-close fallback (D11).

### Site Run tab and navigation (D13, D14, D15)

The brief is edited first, then the page.

- **Stepper terminal.** `site/Run.dc.html:60-64` is written on one line, like `FirstHour.dc.html:49`. The runtime keeps whitespace text nodes that contain a space, and `.term` is `white-space: pre`. Brief §3 "Output panels" gains the rule that an output panel's markup carries no whitespace between tags.
- **State machine (D13).**
  - The 1,484 px canvas and its layout tables stay.
  - `.sm-scroll` gets a ref. After each update the component sets the scroller's `scrollLeft` so the lit node (`.sm-hl`, else `.sm-current`) is centred; with nothing lit (Reset) it scrolls to 0.
  - It never calls a page scroll on Step or Play.
  - Brief C.8 and §5 say the diagram follows the highlight at every width.
- **Optional states (D14).**
  - `.sm-dim` loses its `opacity` and keeps the dashed outline, in `--color-border-strong`, with ink in `--color-text-muted`. Dimmed halts keep `--color-halt`.
  - Dimmed edges, heads and labels move from opacity to the same tokens.
  - `.sm-current` and `.sm-hl` are restated as `.sm-node.sm-current` and `.sm-node.sm-hl` so a lit node still wins.
  - Brief §5 L141, brief C.3 L728 and `DESIGN.md:383` change from "30% opacity with a dashed outline" to the new rule, in the same task, before the CSS.
- **Tab routing (D15).**
  - `revealPanel()` scrolls `#panel` into view when its top is below the fold. It is called from a header tab click and from mount when the hash names a tab.
  - Arrow keys, back/forward, `#install`, `#top` and the hashless entry that selects Why are untouched.
  - The halt-row click brings its node into view.
  - `componentDidUpdate` centres the selected tab in the strip.
  - Every new JS scroll uses `behavior: 'auto'` under `prefers-reduced-motion`, because `site.css:323` cannot stop a JS smooth scroll.
  - Brief §6 L159, §5 L143 and §4 L92 say this.

### Local patches are listed and pinned (D16, D19)

- **The list.** `site/README.md` "Local patches" becomes a list, scaffolded in Section 1 before Wave 2 edits any page file. Each entry gives the file, what the export does, what the patch does, and the brief section that now asks for it. The existing `site/index.html` `onHash` local patch (going back to the hashless entry URL selects `Why`, brief §6) already documented in `site/README.md` is reformatted into this list shape and pinned alongside the new patches.
- **The brief's count.** Brief L5 "one local patch" gives the new wording ("the local patches `site/README.md` lists").
- **The test.** A new `test/site-patches.test.mjs` (scaffolded in Section 1 with the `onHash` pin, then extended in serialized Section 2 tasks) pins every patch by token: `onHash` selecting `Why` on a hashless URL, the one-line stepper terminal, `.sm-dim` without `opacity`, the header click passing a scroll, the mount-time reveal, the tab centring, and the inline waivers. An install that drops one fails `npm test` and names the patch.
- **The 14 `cramped-padding` design-hook findings (D19).** The rendered scans did not reproduce them. Each gets `<!-- impeccable-disable-next-line cramped-padding -- <evidence> -->` immediately above the flagged element. `.claude/skills/impeccable/reference/hooks.md:76` sanctions inline markers for an exported standalone document. The waivers are local patches too.

### README install order (D17)

- `## Install` reads, in order:
  1. **You need**;
  2. the two `/plugin` lines, "In Claude Code, once per machine";
  3. `! interlock doctor` with "the allowlist an unattended run needs";
  4. a new session in the project, then `/interlock:bootstrap`;
  5. "Nothing else to install".
- That is the order the site panels and `docs/01-first-hour.md:17-51` already use.
- The collapsed Fine print keeps its doctor detail.

### Design guidance for implementers (D18)

Ship's workers cannot run skills (`agents/worker.md` disallows the Skill tool), so impeccable reaches them as files to read.

- **Read before a site or README task:**
  - `DESIGN.md` (repo root), its rules section;
  - `.claude/skills/impeccable/reference/craft-floor.md` (the Refuse list; skip its `impeccable shot` verify steps);
  - `.claude/skills/impeccable/reference/layout.md` for the tab and diagram scrolling;
  - `.claude/skills/impeccable/reference/harden.md` for the guard, summary and fallback text.
- **If a gitignored playbook is absent:** `.claude/skills/` is gitignored; if any named playbook under `.claude/skills/impeccable/` is unreadable or absent, note `PLAYBOOK UNAVAILABLE: <path>` in the handoff and continue from `DESIGN.md`.
- **Do not:**
  - run `impeccable detect` or `impeccable shot` (no allowlist entry, and shot needs a browser);
  - follow any step that asks a question or spawns an agent;
  - use `--isolate-waves`, whose lane trees lack the gitignored `.claude/skills/` and which halts on the Workflow host.
- The project's design hook may surface findings after an edit. It never blocks; triage what it reports on files the task touches.

### Test pins this change moves

An assertion that pins a meaning a delta spec changes is updated in the task that changes that meaning, never during a remediation stage. The update names the assertion and the requirement it now pins. Known pins:
- `test/spine/cli.test.mjs:200-207` (bare = `--help`), which splits under the index requirement;
- `test/mod/meter.test.ts:79-82` `COMMIT_REASON`, which mirrors the deny sentence: stale, not red, and `npm test` does not run `.ts`;
- `docs/13-the-guards.md:21`'s guard-commit row.

Anything else found red is named in the handoff, never weakened.

## Risks / Trade-offs

- **[Ship's commit picks up the step-1 clarify edits in the same files]** → The checkpoint asks the owner to commit the clarify pass first.
- **[The site has no browser test; a JS slip in `index.html` surfaces only in a browser]** → The local-patch test pins presence, not behaviour. After ship, a person serves `site/` and checks: 1440 and 390 px, Step to 14/14 with and without `--strict`, a halt-row click, cold `#limits`, `#install`, back to the hashless URL, reduced motion. Then re-run `/impeccable critique`.
- **[The index's grouping is a judgement call that can age]** → The drift test makes a new command that is missing from the index a failing build.
- **[Edit-distance suggestions can be wrong]** → The suggestion only ever adds a line after the unchanged refusal, and exits 1 regardless.
- **[The design hook's reminders inside workflow workers are unproven]** → Nothing in the tasks depends on them.
