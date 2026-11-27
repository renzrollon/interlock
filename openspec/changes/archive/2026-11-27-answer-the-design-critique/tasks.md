# Tasks

Design guidance for every task (design.md "Design guidance for implementers", D18). Before a site, README or terminal-text task, read:
- `DESIGN.md`;
- `.claude/skills/impeccable/reference/craft-floor.md`;
- the playbook the task names.

If any named playbook under `.claude/skills/impeccable/` is unreadable or absent (`.claude/skills/` is gitignored), note `PLAYBOOK UNAVAILABLE: <path>` in the handoff and continue from `DESIGN.md`.

Never run `impeccable detect` or `impeccable shot`, never follow a playbook step that asks a question or spawns an agent, and do not use `--isolate-waves`.

Pins: an assertion that pins a meaning a delta spec changes is updated in the task that changes that meaning, naming the assertion and the requirement it now pins. Any other red test is named in the handoff, never weakened.

## 1. Terminal, README, site brief and local-patch scaffold

- [x] 1.1 Add `suggestCommand(input, names)` to `lib/cli-flags.mjs`, beside `helpFor`.
  - It returns the nearest command name within a small edit-distance bound (a named constant), or `null`. No I/O.
  - Unit-test it: `valdiate` → `validate`, `verfy` → `verify`, `xyzzy-plugh` → `null`, an exact name → itself.
  - Verify: `node --test test/spine/suggest-command.test.mjs`, a new file of its own so no sibling lane's edits can turn it red.
- [x] 1.2 Create `lib/help-cli.mjs` and wire the help index and unknown-command suggestion into `cli/interlock`, `lib/cli-flags.mjs`, `test/spine/cli.test.mjs` and `docs/07-cli-and-configuration.md` (depends on 1.1 for `suggestCommand` in `lib/cli-flags.mjs`; shares `lib/cli-flags.mjs` with 1.1 and `docs/07-cli-and-configuration.md` with 1.3). Playbook: `.claude/skills/impeccable/reference/harden.md`.
  - Put `INDEX`, the `help` subcommand handler/dispatch, and the unknown-command refusal/suggestion formatter in a new `lib/help-cli.mjs` (importing `suggestCommand` and `helpFor` from `./cli-flags.mjs`). Keep ONLY a minimal forward (bare invocation, `case 'help':`, `default:`) and the `help` synopsis line in `USAGE` inside `cli/interlock` so `cli/interlock` stays below `test/spine/package.test.mjs`'s 245,760-byte headroom limit.
  - `INDEX`: every top-level command grouped under at most six headings for the part of the loop it serves, ending with `interlock help <command>` and `interlock --help --all`, at most 30 lines.
  - Bare `interlock` and `interlock help` print `INDEX`, exit 0.
  - `interlock help <command>` prints exactly what `<command> --help` prints (`SETTLE_HELP` for settle).
  - `interlock help --all`, `interlock --help --all` and `interlock -h --all` print `USAGE`. `--all` changes help output ONLY when no subcommand leads; when a subcommand leads (e.g. `interlock review-policy suggest --all --help`), keep printing that subcommand's usage lines, not the full usage. Declare `help: ['all']` in `TABLE` in `lib/cli-flags.mjs`, and add `help`'s synopsis line to `USAGE` in `cli/interlock` so `documentedForms` accepts it.
  - `--help` alone still prints `USAGE`.
  - The unknown-command default keeps `Unknown command: <name>` as its first stderr line and exits 1. Replace the trailing `USAGE` with `Did you mean: interlock <closest>?` (when `suggestCommand` finds one) and a pointer to `interlock help`. `interlock help <unknown>` takes the same path.
  - Tests in `test/spine/cli.test.mjs`:
    - split the bare = `--help` pin at `:200-207`: bare asserts the index, `--help`/`-h` assert the full text (cli/arguments "Bare interlock SHALL print a grouped index");
    - every top-level command in `USAGE`'s synopsis appears in `INDEX`;
    - `INDEX` is at most 30 lines;
    - `help doctor` stdout equals `doctor --help` stdout;
    - `help --all` and `--help --all` stdout equal `--help` stdout;
    - `review-policy suggest --all --help` stdout equals `review-policy --help` stdout, does not match `/Exit codes:/`, and exits 0;
    - `valdiate`, `xyzzy-plugh` and `help valdiate`: all exit 1, stdout empty, stderr starts `Unknown command:`, stderr names `interlock help` AND does not match `/Exit codes:/`; `valdiate` and `help valdiate` name `validate`; `xyzzy-plugh` names no closest command.
  - Document the forms in `docs/07-cli-and-configuration.md`'s help paragraph (shared with 1.3).
  - Verify: `node --test test/spine/cli.test.mjs test/spine/cli-arguments.test.mjs test/spine/doctor.test.mjs test/skills.test.mjs test/spine/package.test.mjs`.
- [x] 1.3 Skip dot-named directories in `listChanges` (`lib/artifacts.mjs:185-192`), updating `test/spine/artifacts.test.mjs` and `docs/07-cli-and-configuration.md` (shares `docs/07-cli-and-configuration.md` with 1.2), so `interlock changes` and every nameless `resolveChange` ignore them.
  - Add `test/spine/artifacts.test.mjs` cases for each `cli/change-resolution` scenario:
    - `.claude/` beside `add-auth/` lists `add-auth` only;
    - `resolveChange` picks `add-auth`;
    - only `archive/` and `.cache/` lists nothing.
  - Note the divergence from `openspec list` beside the `interlock changes` row in `docs/07-cli-and-configuration.md` (leave `skills/dispatch/SKILL.md` untouched per D5).
  - Verify: `node --test test/spine/artifacts.test.mjs test/spine/drift.test.mjs`.
- [x] 1.4 Make the commit denial name the way out with separated audiences and manifest verification (`hooks/tool-guards` delta), editing `lib/ship-stage.mjs`, `hooks/guard-commit.mjs`, `test/spine/ship-stage.test.mjs`, `test/hooks.test.mjs`, `test/mod/meter.test.ts` and `docs/13-the-guards.md`. Playbook: `.claude/skills/impeccable/reference/harden.md`.
  - In `lib/ship-stage.mjs`: update `readStage` to return `path` — the actual repo-relative POSIX path it read on disk (built from `SHIP_DIR`, the directory entry name and `MARKER_FILE`, never re-derived from `marker.change` so a missing `change` field never becomes `.claude/ship/undefined/stage.json`); add a pure `owedClose(markerPath)` returning `{ markerPath, command }` where `command` is `interlock run close --halt "<reason>"`.
  - In `hooks/guard-commit.mjs`:
    - validate `marker.change` with `isChangeName` (`lib/artifact-snapshot.mjs`) before quoting it into model-read text or matching against the manifest;
    - inspect `.claude/ship/run.json` in a try/catch via `inspectManifest` (`lib/run.mjs`, lazily imported on the deny path) and treat the manifest as usable and matching ONLY when `inspected.status === 'ok'` (current schema `RUN_SCHEMA`) AND `isChangeName(marker.change)` AND `manifest.change === marker.change` AND the marker's `path` equals `.claude/ship/<marker.change>/stage.json` (`runClose` clears only `stagePath(manifest.change)`);
    - if the import or `inspectManifest` throws, treat the manifest as not usable: still deny with the hand-removal text and put the error in the deny detail, never reach the outer `catch`'s allow;
    - keep the leading `guard-commit: ` sentence and `const GUARD = 'guard-commit'`, then name the actual marker `path`, the validated change (when valid), and the matched `runId` (only when a usable matching manifest exists and carries a plain non-empty `runId`);
    - separate two audiences explicitly: (1) first, an instruction addressed to an agent inside an active run — do not commit and do not close or halt the run; the run's own commit step commits; (2) second, a recovery instruction addressed to a person whose run has already stopped — run `interlock run close --halt "<reason>"` when a usable matching manifest exists, or remove `<markerPath>` by hand (naming no run id and NOT advising `interlock run close --halt`) when the manifest is absent, unparseable, foreign-schema, names a different change, the marker sits outside its own change's directory, or `marker.change` is missing/invalid;
    - never put the denied command in the reason text; put `stage`, `command`, validated `change` (when valid) and matched `runId` (when matched) in the deny detail.
  - Unit-test `readStage().path` (including a marker whose `change` field is absent or differs from its directory) and `owedClose` in `test/spine/ship-stage.test.mjs`.
  - Test every `hooks/tool-guards` scenario in `test/hooks.test.mjs`:
    - usable matching manifest: pins tokens for BOTH audiences (in-run agent do-not-commit/do-not-close + human `interlock run close --halt`), change, run id and actual marker path;
    - behavioural recovery test: runs the advised `interlock run close --halt` against that usable matching manifest and verifies a subsequent `guard-commit` check on `git commit` is allowed;
    - absent manifest, unparseable `run.json`, and foreign-schema `run.json`: denies without crashing, names actual marker path to remove by hand, names no run id, does not contain `interlock run close`, and keeps the in-run agent instruction;
    - mismatched-change manifest (`manifest.change !== marker.change`): names marker's change and actual marker path to remove by hand, names neither foreign `runId` nor foreign `change`, and does not contain `interlock run close`;
    - marker with missing or invalid `change` field (failing `isChangeName`): names actual marker path (never `undefined`), does not quote unvalidated `change`, names no run id, advises hand removal, and does not contain `interlock run close`;
    - marker at `.claude/ship/old-name/stage.json` whose `change` is `add-thing`, beside a current-schema manifest for `add-thing`: names `.claude/ship/old-name/stage.json` to remove by hand, names no run id, and does not contain `interlock run close`;
    - two different commit commands give the exact same reason text.
  - Update the mirrored sentence `COMMIT_REASON` in `test/mod/meter.test.ts:79-82`, and the guard-commit row in `docs/13-the-guards.md`.
  - Verify: `node --test test/spine/ship-stage.test.mjs test/hooks.test.mjs test/spine/mod-pins.test.mjs test/spine/ship-stage-drift.test.mjs test/spine/meter-refusals.test.mjs`.
- [x] 1.5 Add the halted-summary lines to `formatRunSummary` (`lib/receipt.mjs`), updating `test/spine/receipt.test.mjs`, `test/spine/run.test.mjs` and `docs/04-when-it-stops.md` (shares `docs/04-when-it-stops.md` with 1.6), in a `summary.halted` branch after the `resume card:` row and before the unchanged closing line (`ship/close-summary` delta, scoped to halted closes that read a usable manifest). Playbook: `.claude/skills/impeccable/reference/harden.md`.
  - Print `No commit is on record for this run.` when no commit is recorded.
  - Print the pick-up steps from a pure, import-free `pickUpSteps(change, leftoverIds)` in `lib/receipt.mjs`. `leftoverIds` ONLY decides whether the `interlock tasks tick` step prints; `--ids` MUST stay a placeholder naming verified ids and MUST NEVER be filled with any leftover task id (matching `lib/resume-card.mjs:234-246`).
  - Leave the resume card and the no-manifest, `closeUnusableManifest` and `closeAlreadyOnRecord` summaries unchanged.
  - Pin each new line verbatim in `test/spine/receipt.test.mjs`, covering every scenario of the two halted-summary requirements — including asserting that for leftovers `['2.1', '2.2']`, the `interlock tasks tick` line keeps a verified-ids placeholder and contains neither `2.1` nor `2.2`, and asserting that a halted summary and its resume card both name `/interlock:ship <change>`.
  - Assert in `test/spine/run.test.mjs` that the no-manifest close, `closeUnusableManifest` (foreign/unparseable) and `closeAlreadyOnRecord` (with unavailable `last-close.json`) summaries remain unchanged and carry neither `No commit is on record for this run.` nor the pick-up steps.
  - Reword `docs/04-when-it-stops.md:7,48` to "no commit is on record", and name the new lines at `:60` (shared with 1.6).
  - Verify: `node --test test/spine/receipt.test.mjs test/spine/resume-card.test.mjs test/spine/run.test.mjs test/workflows.test.mjs`.
- [x] 1.6 Replace the unreachable-close fallback sentence in `workflows/ship.js:667-668` and `cli/interlock-run:620-632`, add `test/spine/close-fallback.test.mjs`, and document it in `docs/04-when-it-stops.md` (shares `docs/04-when-it-stops.md` with 1.5; `ship/close-summary` delta). Playbook: `.claude/skills/impeccable/reference/harden.md`.
  - Core sentence (identical in both `workflows/ship.js` and `cli/interlock-run`): says the close was not recorded — preserving `no receipt was written` and noting no outcome or terminal trajectory event was recorded (NEVER using `nothing was recorded`, which is reserved for the no-manifest close) — that the stage marker may still block `git commit`, and that running `interlock run close --halt "<reason>"` from the directory the run started in (NEVER `from the project root`) clears it.
  - Spell out no marker path in either driver.
  - In `cli/interlock-run` (which knows `root`), print `  cwd: ${resolve(root)}` on the line after the core sentence, matching the terminal summary's `cwd:` row. Its `node:path` import holds only `dirname` and `join` today; add `resolve`.
  - Add `test/spine/close-fallback.test.mjs` (a new file so no sibling lane's Verify runs it):
    - source-equality test asserting the core sentence is present and identical in both `workflows/ship.js` and `cli/interlock-run`, `SHIP HALTED — ` still leads, `no receipt was written` is preserved, neither fallback contains `nothing was recorded` or `from the project root`, and `cli/interlock-run` prints `cwd:`;
    - behavioural test using `test/helpers/ship-harness.mjs` (`runShip` with the close relay returning `null`) asserting the emitted summary starts `SHIP HALTED — ` and carries the fallback sentence.
  - Document the fallback in `docs/04-when-it-stops.md` inside `### \`RELAY UNREADABLE\`` immediately after the L87 paragraph ("The CLI's own bytes are always on disk... Re-run `/interlock:ship` once the cause is clear."), before L89 (shared with 1.5).
  - Verify: `node --test test/spine/close-fallback.test.mjs test/workflows.test.mjs test/spine/ship-stage-drift.test.mjs`.
- [x] 1.7 Reorder `README.md`'s `## Install` (D17). Playbook: `.claude/skills/impeccable/reference/layout.md`.
  - The order: **You need** → the two `/plugin` lines ("In Claude Code, once per machine") → `! interlock doctor` with "the allowlist an unattended run needs" → a new session in the project, then `/interlock:bootstrap` → "Nothing else to install".
  - Keep the npm install line, every flow-node link title, the network sentence and the docs/14 and docs/15 links. Use no retired names.
  - Verify: `node --test test/spine/package.test.mjs test/flow-svg.test.mjs test/workflows.test.mjs test/retired-names.test.mjs test/skills.test.mjs`.
- [x] 1.8 Edit the site brief first (`site/DESIGN-PROMPT.md`), and `DESIGN.md` with it (D13, D14, D15). Playbook: `.claude/skills/impeccable/reference/layout.md`.
  - In `site/DESIGN-PROMPT.md`:
    - §3 "Output panels": an output panel's markup carries no whitespace between tags.
    - §5 L141 and C.3 L728: optional states get a dashed `color-border-strong` outline and `color-text-muted` ink, never faded; dimmed halts keep `color-halt`.
    - C.8 and §5: the diagram scrolls inside its container to keep the highlighted node in view at every width, instantly under reduced motion.
    - §5 L143: a halt-row click brings its node into view.
    - §6 L159: a header tab click, and a load with a tab hash, scroll the panel into view when its top is below the fold; `#install` and `#top` never change the tab.
    - §4 L92: the selected tab stays centred in the strip.
    - L5: the local-patch count becomes "the local patches `site/README.md` lists".
  - Mirror the optional-state rule at `DESIGN.md:383`.
  - Leave every Node-floor sentence and every re-pinned fact from the clarify pass as they are.
  - Verify: `node --test test/retired-names.test.mjs test/spine/package.test.mjs`.
- [x] 1.9 Scaffold `test/site-patches.test.mjs` and convert `site/README.md`'s `"Local patches"` section into the new list format (D16), establishing both files before Section 2 begins.
  - Reformat the existing `site/index.html` `onHash` local patch in `site/README.md` (going back to the hashless entry URL selects `Why`, brief §6) into the list format: file, what the export does, what the patch does, and the brief section that now asks for it.
  - Create `test/site-patches.test.mjs` pinning the `onHash` local patch in `site/index.html` by token, with an assertion message naming the patch.
  - Verify: `node --test test/site-patches.test.mjs test/retired-names.test.mjs`.

## 2. Site page, copied from the brief (needs section 1's brief text and local-patch scaffold)

Tasks 1.8 and 1.9 already wrote the brief updates, `site/README.md`'s `"Local patches"` list, and `test/site-patches.test.mjs`. Every task below edits its site file and appends its entry to `site/README.md` and its token pins to `test/site-patches.test.mjs` (both shared paths are named in every task so the planner serializes them into one lane).
- Each entry in `site/README.md` gives the file, what the export does, what the patch does, and the brief section that now asks for it.
- Each pin in `test/site-patches.test.mjs` names the patch in its assertion message.

- [x] 2.1 Patch `site/Run.dc.html`, and record and pin its patches in `site/README.md` and `test/site-patches.test.mjs` (D13, D15, D19). Playbooks: `.claude/skills/impeccable/reference/layout.md`, `craft-floor.md`.
  - Write the stepper terminal (`:60-64`) on one line, like `FirstHour.dc.html:49`.
  - Give `.sm-scroll` a ref. In `componentDidUpdate`, set its `scrollLeft` so `.sm-hl` (else `.sm-current`) is centred, or 0 when nothing is lit. Never scroll the page on Step or Play.
  - Make `pickHalt` bring the lit node into view after render. Use `behavior: 'auto'` under `prefers-reduced-motion` (read with `matchMedia`).
  - Put `<!-- impeccable-disable-next-line cramped-padding -- <evidence> -->` above `.sm-scroll` and each `.tbox` wrapper in this file, citing the rendered scan (no finding at 1440 or 390; cells carry 10–12 px padding).
  - Append entries to `site/README.md` ("Local patches") and token pins to `test/site-patches.test.mjs`: no whitespace between the `.term` open tag, `<sc-for>` and `.tline`; the ref and the scroll call; the waivers.
  - Verify: `node --test test/site-patches.test.mjs test/retired-names.test.mjs`.
- [x] 2.2 Patch `site/site.css`, and record and pin its patches in `site/README.md` and `test/site-patches.test.mjs` (D14). Playbook: `.claude/skills/impeccable/reference/craft-floor.md`.
  - `.sm-dim`: drop `opacity`, keep the dashed outline in `var(--color-border-strong)`, ink in `var(--color-text-muted)`.
  - `.sm-halt.sm-dim` keeps `var(--color-halt)`.
  - Dimmed `.sm-edge`, `.sm-head` and `.sm-elabel` use the same tokens with no opacity.
  - Restate `.sm-current` and `.sm-hl` as `.sm-node.sm-current` and `.sm-node.sm-hl` so a lit node still wins.
  - Append entries to `site/README.md` ("Local patches") and token pins to `test/site-patches.test.mjs`: no `opacity` in any `.sm-dim` or `.dim` rule, and the two restated selectors.
  - Verify: `node --test test/site-patches.test.mjs`.
- [x] 2.3 Patch `site/index.html`, and record and pin its patches in `site/README.md` and `test/site-patches.test.mjs` (D15, D19). Playbook: `.claude/skills/impeccable/reference/layout.md`.
  - Add `revealPanel()`: scroll `#panel` into view when its top is below the fold. Call it from a header tab click (the click at `:317` passes a scroll) and from mount when the hash names a tab.
  - Leave `onHash` (already reformatted and pinned by task 1.9), arrow keys, `#install`, `#top` and the hashless entry that selects Why untouched.
  - Centre the selected tab in the strip from `componentDidUpdate`.
  - Use `behavior: 'auto'` under reduced motion; on mount use the local `reduced`, not `this.state`.
  - Put the inline `cramped-padding` waiver above each of the three proof-strip `.figure` cells, with evidence.
  - Append entries to `site/README.md` ("Local patches") and token pins to `test/site-patches.test.mjs`: the header click passes a scroll; the mount-time reveal is gated on a tab hash; the tab centring call; the waivers.
  - Verify: `node --test test/site-patches.test.mjs test/retired-names.test.mjs test/spine/diff-reading.test.mjs`.
- [x] 2.4 Waive the `cramped-padding` findings in `site/FirstHour.dc.html` and `site/Limits.dc.html`, and record and pin the waivers in `site/README.md` and `test/site-patches.test.mjs` (D19).
  - Put the inline waiver above each `.tbox` wrapper, citing the rendered scan.
  - Touch no other line, in particular not the Node-floor sentences.
  - Append entries to `site/README.md` ("Local patches") and token pins for the waivers to `test/site-patches.test.mjs`.
  - Verify: `node --test test/site-patches.test.mjs test/spine/package.test.mjs test/retired-names.test.mjs`.

## 3. Integration

- [x] 3.1 Add the `CHANGELOG.md` `[Unreleased]` entries for this change: help index and suggestion, change listing, commit denial, halted summary, fallback, README install order, site patches. Use no retired names; `test/retired-names.test.mjs` scans `CHANGELOG.md`. Then run the whole suite.
  - Verify: `npm test` passes, with its output pasted in the handoff.

## Workflow follow-up

- Before ship: commit the step-1 clarify pass (README.md, site/*, DESIGN.md, PRODUCT.md, .impeccable/) so ship's one commit carries only this change.
- After ship, by a person:
  - serve `site/` (`python3 -m http.server -d site`) and check 1440 and 390 px in light and dark;
  - Step to 14/14 with and without `--strict`;
  - click a halt row;
  - load `#limits` cold;
  - follow the `#install` link;
  - go back to the hashless URL;
  - turn reduced motion on;
  - then re-run `/impeccable critique`.
- Archive the change after merge.
