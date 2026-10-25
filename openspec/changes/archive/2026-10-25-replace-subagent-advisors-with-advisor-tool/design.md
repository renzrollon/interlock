## Context

See proposal.md, "Why". The explore brief is `.claude/handoff/explore-replace-subagent-advisors-with-advisor-tool-20261023-205134.md`. Every `D<n>` below is a row in `decisions.md`.

**Two subagent advisors exist today.**
- The checkpoint advisor (v1.7.0): `agents/advisor.md`, `lib/advisor.mjs`, `lib/advisor-cli.mjs`, `lib/prompts/advisor.mjs`, spec skill §5a.
- The review-code findings advisor (unreleased): `agents/review-advisor.md`, `lib/review-advisor.mjs`, `lib/review-advisor-cli.mjs`, `lib/prompts/review-advisor.mjs`, review-code §4a.
- They share `lib/advisor-kit.mjs` and `lib/prompts/brief-kit.mjs`, which have no other importer. The review advisor imports `verdictFromLabels` from `lib/advisor.mjs:230-306`.
- `interlock note add|derive|match` (compound notes, not the advisor) lives in `lib/advisor-cli.mjs:168-210`, with helpers at :24-37.

**Facts about Claude Code's advisor tool that shape this design.** Sources: code.claude.com/docs/en/advisor.md and the mods events page; the 2.1.309 binary as read by the explore investigators.
- Only the user turns it on: `/advisor`, `advisorModel` in any settings scope, or the hidden `--advisor` flag. A plugin's settings apply only `agent` and `subagentStatusLine`, and no frontmatter key reaches it (D4).
- `CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1` turns it off whatever else is set.
- Subagents inherit it, including ones with a `tools:` allowlist. Its schema is appended after the client tool pool is filtered. The pairing check runs against each subagent's own model, and a pairing that fails drops the tool silently.
- The model decides when to call. A prompt can ask, but nothing forces or caps a call.
- Advice from an Opus 5.5 or Fable advisor is `advisor_redacted_result`, readable only by the executor.
- No tool hook fires for an advisor call. A mod's `turn.step` sees `result.serverToolUses` (`{ id, name: 'advisor', … }`, Claude Code ≥ 2.1.290). Transcript rows carry a `server_tool_use` block named `advisor`.
- The advisor's own tokens are left out of the top-level `usage` (API docs, usage section).

**The 2026-10-14 note (D12).** docs/notes/2026-10-14-claude-code-opportunities.md:16,22,161 rejected the tool for four reasons. Three still hold and are why the file-writing consults go: the advice is redacted, the executor chooses when to call, and the input is empty with the whole transcript injected. The fourth, "only the primary thread can consult", is a Managed Agents limit and is false in Claude Code. It was the stated reason not to put the tool on ship lanes, and this change reverses that half.

## Goals / Non-Goals

**Goals:**
- No subagent in Interlock is called an advisor (D1).
- Whenever the real tool can reach a run, the run says so, counts what it can, and says what it cannot (D2, D13).
- Interlock asks for no consult (D2). Briefings are byte-identical whether or not an advisor is configured, so runs stay comparable across users and the counts measure unprompted use.
- Compound notes keep a reader (D3).

**Non-Goals:**
- Turning the tool on, choosing its model, or passing `--advisor` (D4).
- Recording or summarising the advice. It is redacted for current advisors and belongs to the executor.
- A host-registry capability key for the advisor (D5).
- Modelling the pairing table. Interlock does not predict which lanes the engine pairs; it counts what happened.
- Counting consults on runner hosts. Their `claude -p` lanes have no transcript recorder (D14).
- Ship-meter changes. Only the spec meter gains a consult count.
- Asking lanes or the spec session to consult. That is a later change, decided on evidence: the transcript probe (Open Questions), whether advisor tokens reach lane usage, and real runs' consult counts beside their remediation rounds and review blockers (D2).

## Decisions

### Removal order: relocate, then cut by pin cluster (D1, D15)

The removal cannot be split arbitrarily: several tests cross-check files against each other. Each cluster below changes in one task.
- The CLI leaves (`advisor`, `review-advisor`, `review --advisor-brief`) change with `lib/cli-flags.mjs`, the `scripts/postinstall-smoke.mjs` inventory, and every skill line that spells them. `test/spine/cli-inventory.test.mjs` cross-checks all four.
- `KEYED_LINES` and `TEXT_KINDS` in `lib/spec-meter.mjs` change with the fenced lines of `skills/spec/SKILL.md`; `test/spine/spec-meter.test.mjs:659-668` pins them together, in both directions.
- The two clusters above meet in the spec skill's advisor fences, and `test/skills.test.mjs` pins the same fences. So the CLI removal, the meter's advisor kind, the skills' advisor sections and those pins are one task. The `note match` fence and the meter's `notes` kind are a later task of their own.
- `EXPECTED_CASES` in `test/evals.test.mjs` changes with the case directories and `evals/CALIBRATION-DEFERRALS.md` rows. This cluster goes before the code: the cases declare `agents/advisor.md` and `agents/review-advisor.md` under `exercises:`, which `test/evals.test.mjs:607` requires to exist, and their tests read the advisor caps from `LIMITS`. Eval coverage is reported, never asserted, so removing the cases first fails nothing.
- `lib/prompts/index.mjs` changes with the prompt modules on disk; `test/spine/prompt-integrity.test.mjs:48-60` checks the registry.
- `scripts/gen-flow-svg.mjs` changes with its generated `docs/assets/flow-*.svg`; `test/flow-svg.test.mjs` fails on drift.

Survivors move first. `noteCommand`, `noteWrite`, `findingsListOf` and `readOr` go to a new `lib/note-cli.mjs` with behaviour unchanged, and `bin/interlock` imports `noteCommand` from there. `test/spine/cli-arguments.test.mjs:157-158` is repointed at the new file. Then `lib/advisor-cli.mjs` and the rest go.

Alternative rejected: a `git revert` of 590ebae/133aa8a/54433f2/b474eb4. Compound notes, the `specGap` field, eval-triage changes and the host-probe eval mode landed in the same commits. Later commits (63ea221) also edited the same files. A revert would remove survivors and conflict with later work.

### Both kits and `verdictFromLabels` go with the advisors (D1)

With both advisors removed, `lib/advisor-kit.mjs` and `lib/prompts/brief-kit.mjs` have no importer, so they are deleted, and `brief-kit.mjs` leaves `NON_ASSEMBLER_MODULES`. `lib/md-table.mjs` stays: `lib/ledger.mjs` and `lib/notes.mjs` use it.

`verdictsFor` in `lib/review-core.mjs:86-108` was exported for the review advisor alone, so it goes with its tests. The `resolveReview` docstring fix at :220-223 is not advisor work and stays, reworded to stop naming `verdictsFor`. The `resolveReview` output snapshot (test/spine/review-core.test.mjs:918-1085) stays under a name that does not mention `verdictsFor`.

### `note match` names unreadable rows; the cap is renamed (D3, D6)

`interlock note match <change> [--paths a,b] [--json]` already prints the rows whose `file` the change's tasks (or `--paths`) name, cut at the cap.
- It now also reports how many rows of a parseable table were malformed: `unreadable` in JSON, and a text line `compound notes: <n> rows unreadable` when non-zero.
- A table that does not parse keeps exiting 1 with `interlock: docs/notes/compound.md: <reason>`, as it does today.

The spec skill's reading of these is in the next decision.

`LIMITS.maxAdvisorNoteRows` becomes `LIMITS.maxNoteMatchRows`, value 20 unchanged. Every reader moves to the new name: `lib/notes.mjs:283`, the `formatLimits` row, `test/spine/notes.test.mjs:488-500`, `shared/COMPOUND-NOTES.md:60` and the compound-notes spec. Every other advisor key leaves `LIMITS`, including `advisorRepeatMaxPercent`, whose last reader was the review advisor's fallback.

### The spec skill reads compound notes itself (D3)

The advisor brief was the only automated reader of compound notes, so §3 gains one fenced line:
- When: after the artifact loop has written `tasks.md`, and before §3a's ledger audit.
- The line: `interlock note match "<name>" --json`.
- Matched rows: for each row, the skill checks that `design.md` and `tasks.md` honour the row's `rule`. Where they do not, it either revises the artifact or writes a ledger row before acting, as §3a requires for every ambiguity.
- Failure: when the line exits non-zero, the skill reports its first output line and continues. Notes are guidance and never a gate.
- Hand-off: §6 reports the matched count.

This is better than the brief route. The executor writing the design now sees the rule, and a native advisor reading that executor's transcript sees it too.

### Configuration is read by one pure module, from files the caller reads (D4, D5)

New `lib/advisor-tool.mjs`. It imports nothing from `node:`, and the caller does the I/O.
- `readAdvisorConfig(sources)` takes `[{ scope, text } | { scope, absent: true } | { scope, error }]` for the four scopes `lib/doctor.mjs:91-110` `settingsSources` names. It returns `{ scopes, unreadable }`:
  - `scopes` holds the scopes whose JSON sets `advisorModel` to a non-empty string. Any other value (a number, an array, an empty string) is unset (D17).
  - `unreadable` holds `{ scope, reason }` for a file that exists but does not read or parse, and for one whose JSON parses to something other than an object.
  - The value is never returned. Like the prompt-cache row (`lib/doctor.mjs:1290-1356`), Interlock names where a key is set and never resolves which scope wins.
- `lib/host/claude-env.mjs` `observeClaudeEnv` gains `advisorDisabled`: `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` read with the module's existing `enabled()` rule, and its name exported beside the other env names.
- `advisorNotes({ scopes, unreadable, disabled }, { counted })` returns the run-note texts:
  - With a scope set and not disabled: `ADVISOR CONFIGURED (<scopes>): lanes the engine pairs with it may consult it; <counted ? 'consults are counted per lane' : 'consults are not counted on this host'>, the advice is not recorded, and its spend is not established`
  - With a scope set and disabled: `ADVISOR DISABLED: CLAUDE_CODE_DISABLE_ADVISOR_TOOL is set, so advisorModel in <scopes> is ignored`
  - For each unreadable file: `ADVISOR CONFIGURATION NOT READ: <scope> settings (<reason>)`
  - Nothing when no scope sets it. An unset advisor is the default, not a degradation (D5). A session started with `--advisor` alone is invisible here, and the doctor row says so.
- `advisorConfigured(observation)` is true when a scope is set and it is not disabled. The close reads it.

Alternative rejected: a new `CAPABILITY_KEYS` entry. Every key there names a way a host is weaker than the default (`lib/host/registry.mjs:10-31`), and a host without an advisor is the default.

### Where the run speaks (D13, D14)

- **Workflow host.** `bin/interlock` `run start --host workflow` already builds `hostEnv` from this process (`bin/interlock:4728-4735`).
  - It now also reads the four settings files and stores `hostEnv.advisor = { scopes, unreadable, disabled }`.
  - `decideHostEnvironment` (`lib/run.mjs:3100-3160`) appends `advisorNotes(…, { counted: true })` to its `notes`.
  - The manifest carries the observation, so a later reader sees exactly what the decision saw. Every later step of the run, the close included, reads this snapshot; nothing re-reads settings mid-run (D20). A `/advisor` change after `run start` (including one in a Remote Control session that never writes the key) is not seen until the next run. A relaunch is a new `run start` and reads the settings again.
- **Runner hosts that drive the Claude binary.** In `bin/interlock-run`'s banner block (:346-390), when `drivesClaudeBinary` holds, the same texts are added with `{ counted: false }`. They follow the `EFFORT ROUTING OVERRIDDEN` precedent: the operator's environment is bannered and never stripped.
  - These hosts get no consult line and no count. `run start` records no `hostEnv` for them, and their `claude -p` lanes have no recorder (D14).
- **Hosts that do not drive the Claude binary.** Nothing: the tool cannot reach them.

### Briefings ask for no consult (D2)

`lib/run.mjs` `spawn()` and every prompt assembler are untouched. A configured run's briefings are byte-identical to an unconfigured run's, and every snapshot under `test/fixtures/prompts/` is unchanged. A test pins the first: the same implementer and remediation steps, emitted from a configured and an unconfigured manifest, carry the same briefing and the same sha.

A lane the engine pairs with the advisor can still consult it unprompted; the count records that. Interlock adds nothing to it, for three reasons:
- The advice is redacted for current advisors, so no reviewer and no gate can read what a lane acted on. Inviting it adds an input the record cannot hold.
- Its spend is not established (D13). Two consults asked of every implementer and remediation lane is a cost the close cannot show.
- An invite turns the count into a measure of prompt compliance. Without it, the count is the baseline a later invite would be judged against.

Alternative rejected: an `ADVISOR_BRIEFING_LINE` appended by `spawn()` for implementer and remediation steps when an advisor is configured. That was the 2026-10-23 resolution of D2, narrowed on 2026-10-24 after the artifact review's findings 8 and 10. Adding it later is one option on `spawn()` and one line; it waits for the evidence named in Non-Goals.

### Counting consults (D13)

- **Per lane.** `summarizeTranscript` (`lib/agent-usage.mjs:242-305`) counts `server_tool_use` content blocks named `advisor` on every assistant row, keyed by block `id`. It counts before the per-message-id grouping, because that grouping keeps only the last row per message and the engine writes each content block as its own row. It returns `advisorConsults`: a number when at least one line parsed, otherwise `null`.
  - A block with no string `id` counts once for the row it is on.
  - A block whose `name` is not the string `advisor` is not counted.
  - A row that is not an assistant message, or whose `content` is not an array, adds nothing. It does not make the result `null` by itself; only a transcript with no parsed line does.
- **In the close.** `joinAgentUsage` (`lib/run.mjs:1092-1148`) sums it over the joined lanes. The close summary gains one line, only when `hostEnv.advisor` was configured (`advisorConfigured`) or the sum is above 0:
  - `advisor consults: <n> across <m> lanes`, when every briefed spawn joined a transcript that parsed and the sum is above 0
  - `advisor consults: not established (<k> of <m> lanes unrecorded)`, when a briefed spawn joined no parsed transcript
  - `advisor consults: not established (none recognized in <m> lanes)`, when every lane parsed and the sum is 0
  - Unknown is never 0, following the `TOKEN USAGE NOT REPORTED` precedent (`lib/run.mjs:5142-5179`). Existing close-summary lines are untouched.
  - With `--json`, the close carries `advisorConsults: { count, lanes, unrecorded }` exactly when the line prints, with `count: null` when not established. `count: null` with `unrecorded: 0` is the none-recognized case.
- **Why a recognized zero is not printed as 0 (D16).** No transcript on this machine holds an advisor block yet, so the reader is written against binary-derived shapes (Risks). A block type, a versioned name or a result-only row it does not know would still parse, so a configured run that consulted would read 0. Until a real Workflow-lane transcript confirms the shape (Open Questions), a zero is not established. The per-lane reader still returns its 0; only the close refuses to print it as a count. Making 0 a number again is a later change, once that probe has run.
- **The never-configure rule is pinned statically.** Only `lib/advisor-tool.mjs`, which is pure and cannot write, may spell `advisorModel` under `lib/`, `bin/`, `hooks/` and `workflows/`, and the claude adapter's argv builder never emits `--advisor`.
- **In the spec meter.** `hooks/mod.mjs` already hooks `turn.step` for usage, so no new hooked event is needed. While a spec run is live, it counts `result.serverToolUses` entries whose `name` is `advisor`, keyed by `id`. Events with no `e.agentId` count toward the session and the rest toward subagents, because Explore investigators inherit the advisor too. The pane draws `advisor consults seen: session <a> · subagents <b>` from the first advisor entry of the run onward, and draws no advisor-consults line before that (D18). The meter does not read settings, so it cannot tell a tool that is off from an engine below 2.1.290 that never reports the field. A `none seen` line on every spec run would read as a measured zero on sessions that never turned the tool on, so the line waits for a first entry. "Seen" is deliberate for the same reason. The count is drawn and never compared.

### The spec meter loses the subagent advisor lines (D7)

The following go: the `advisor` keyed kind and text kind; `READERS.advisor`; the `draft` write kind; the advisor stage texts, pane line and question rows; the consult line keyed on `interlock:advisor` spawns (`hooks/mod.mjs:703-706`, `countConsult`); and the `waiting on you` line, whose needs_human half repeats the ledger line.

A `notes` keyed kind is added for `interlock note match … --json`, between `status` and `ledger`, with its result read:
- Fields: `rows` by count, `omitted`, `unreadable`, or `error` with `candidates`.
- Stage text: `notes <n> matched (omitted <k>)`.
- Pane line: `notes: <n> matched · omitted <k> · unreadable <u>`.

The non-zero exit on an unparseable table prints text, not JSON, so it reads as `notes (unparsed)` like every other text-only result.

### The spec skill's native-advisor prose (D2)

- §3 "Gates while generating" gains an "Advisor tool" bullet. It asks for no consult (D2); the session may have the tool because the user turned it on, and the bullet says:
  - Never run `/advisor` or edit `advisorModel`: the choice and its spend are the user's.
  - If the session consults it, its advice is guidance, and a conflict with the evidence is written as a ledger row, not resolved silently.
  - A call that fails is said at the hand-off and never retried, and the spec continues (D19). The tool being absent is not an error either; §6 says it.
- §5a is deleted.
- §6's advisor bullet becomes: whether the advisor tool was available, or `not available in this session`, and the consults made, by the session's own account. The bullet names the spec meter's advisor line as the record. The model sees its own tool calls, so its tally is not invented, but it is a self-report, and the meter counts the same calls from the engine's events. The skill cannot repeat the meter's figure: the pane is drawn for the person and never reaches the model.
- The description line and `metadata` stop naming `advisor.md`, and `Agent` leaves `allowed-tools`, since §5a was its only use.

The tokens are pinned in `test/skills.test.mjs`: `/advisor`, `advisorModel`, `ledger row`, `not available in this session`, `retried`, `own account`, `spec meter`.

### Review-code

Removed: `[--advisor]` from the argument hint, the flag table (its only row was `--advisor`), `[--advisor-brief <change>]` on the §3 review line, §4a, and the §5 `When --advisor ran` line. Review-code gets no native-advisor prose. Its reviewers run inside the main session or the ship strict tail's review step, so they inherit any advisor without asking. No ask is added there, to keep the change to the two kinds D2 named.

### Doctor row (D4)

`checkAdvisor` sits beside `checkPromptCache` and is pushed in `diagnose` next to the `prompt-cache` row. It reads the four settings files, calls `readAdvisorConfig`, and reads `advisorDisabled` from the env. Its detail and fix texts come from `lib/advisor-tool.mjs`, so the static pin's "only the pure reader spells `advisorModel`" holds for doctor too:
- **`ok`** when a scope is set and the tool is not disabled: `advisorModel set in <scopes>; Claude decides when to consult it; ship lanes the engine pairs with it may consult it; Interlock counts consults on the Workflow host and never records the advice`. A scope that is set is evidence on its own, so an unreadable file elsewhere does not demote the row (D17). The detail then adds `; not read: <scope> (<reason>)` for each such file.
- **`skip`** when no scope sets it: `advisorModel not set in any settings scope read here; a session's --advisor flag is not visible to doctor`, plus the same `not read` clause for each unreadable file. The fix text: `Run /advisor <model> to turn it on. Interlock cannot: a plugin's settings apply only agent and subagentStatusLine.`
- **`skip`** when disabled: names the env var and the ignored scopes.
- **Never `fail`.** A throw becomes a `skip` naming the reason, because guards and advice fail open.

### OpenSpec, docs and history (D9, D10, D11, D12)

- `openspec/specs/spec/checkpoint-advisor` and `openspec/specs/evals/spec-range` get REMOVED deltas for every requirement. The archived `2026-10-21-add-checkpoint-advisor` folder stays as history (D10).
- `openspec/changes/add-review-findings-advisor/` is deleted with `git rm -r` (D9). It never reached a living spec, so archiving it would write specs only to remove them.
- CHANGELOG:
  - The unreleased review-advisor bullet (CHANGELOG.md:12) is deleted.
  - A `### Removed` entry under `[Unreleased]` names `interlock advisor`, `agents/advisor.md`, `advisor.md`, the Spec Range cases and `scripts/advisor-e2e.mjs`.
  - `### Added` gains the doctor row, the run note, the counts and the consult line (D11).
- Docs:
  - docs/02 loses its advisor.md section.
  - docs/07 loses the meter rows and the two consult sections; it gains the doctor row, the run note and `note match` in the spec flow.
  - docs/10 loses the review-advisor sentences.
  - docs/14 loses Spec Range and Review Range.
  - README loses "plus advisor.md" and the glossary row.
- `test/fixtures/evals/spec-range-2026-10-21.json` stays, with its README entry rewritten to say it is a triage fixture now (D8). The `lib/evals-triage.mjs:47` comment is kept accurate.
- `.github/workflows/evals.yml` changes its comments only; the grant test (test/evals.test.mjs:1139-1176) still derives `--allow-tools` from the remaining cases.
- The dated notes and the owner's untracked files are not edited (D12).

## Risks / Trade-offs

- **[A released command disappears]** A script calling `interlock advisor` from 1.7.0 exits with an unknown-subcommand error. → `[Unreleased]` already carries 63ea221's `!` commit, so the next release is a major either way. The `### Removed` entry and docs/16-upgrading.md's upgrade notes name it.
- **[Transcript shape is unverified]** No transcript on this machine holds an advisor block, so the per-lane counter is written against binary-derived row shapes and synthetic fixtures. → An unparsed transcript reads `null`, and the close prints a recognized zero as `not established`, never 0. A shape the reader does not know can therefore only under-count a run that consulted, and never shows a false 0. One cost-capped `scripts/host-probe.mjs` run with `--advisor` settles the shape (Open Questions).
- **[Advice reaches the diff unseen]** A lane that consults unprompted may act on advice that is redacted, so no reviewer and no gate can read it, and its spend is not on the close (D13). → Interlock does not add to it: no briefing asks for a consult (D2). The review judges the diff on evidence whatever prompted it, as it does any lane's own reasoning. The run note and the close line say an advisor was configured and how many consults were recognized, so a reader of the run knows to ask.
- **[Configured is not active]** A remote feature flag, the per-lane pairing check, or `DISABLE_TELEMETRY` can keep the tool off while `advisorModel` is set. → Every text says "configured" or "may consult", never "active", and the counts are the evidence.
- **[Lanes may rarely consult unprompted]** A user who turned `/advisor` on hoping lanes would lean on it may see few consults. → The close line shows how many, and that figure is the evidence for or against a later invite (D2).
- **[Empty living specs at archive]** Removing every requirement may leave `spec/checkpoint-advisor` and `evals/spec-range` with no requirements after `openspec archive`. → The archive commit deletes those two spec folders if the CLI leaves them empty. That happens at archive time, after merge, and is not a task here.
- **[An open change names the advisor]** `harden-release-upgrade-path` (design.md:139, decisions D7) names the `advisor` `requestedName` caller, which goes away. → Flagged at the checkpoint. This change does not edit another change's artifacts.
- **[Ship's guards and test deletions]** `hooks/guard-tests.mjs` denies test edits in a run's remediation and fix-tests stages. → Every test this change deletes or edits is inside the implementation task that removes the code it covers, never left for remediation.
- **[The spec session's own pairing]** An Opus 5.5 main session accepts only Fable or Opus 5+ advisors, so `/advisor sonnet` gives the spec session nothing. → §6 reports `not available in this session` from what the session actually has, not from settings.

## Open Questions

- Does a Workflow lane's transcript carry the advisor `server_tool_use` as its own row with the block `id` the binary suggests? One probe answers it. It is not a task here: it needs a paid, credentialed `claude` session that a ship lane must not start. The counter's contract (number, or `null` when unparsed) stays the same either way; only the fixture shape might change. Once the probe confirms the shape, a later change may print a recognized zero as `0`.
