## Context

See proposal.md for why. What shapes the approach:

- **The flag already exists on every subcommand.** `bin/interlock:1785` reads `const json = Boolean(flags.json)` once, before the `switch`, and every branch prints through `emit(json, obj, text)` at `:961`, which writes `JSON.stringify(obj, null, 2)` when `json` is set and the text otherwise. `ledger` (`:2234-2252`), `validate` (`:1869-1875`) and `gate` (`:1822-1867`) all go through it. The exit happens after the emit and reads the result, never the flag: `if (summary.blocking) process.exit(1)` at `:2250`, `if (!result.ready) process.exit(1)` at `:1873`, `if (!result.passed) process.exit(1)` at `:1865`. A change name that does not resolve goes through `requireChange` (`:1742-1753`): with `--json` it prints `{ error, candidates }` and exits 1; without it, it dies with the same words on stderr.
- **What each line prints today, and what it prints with the flag.**
  - `interlock ledger "<name>"`: `DECISIONS MISSING — no decisions.md at <path> (missing, not empty — …)`, `DECISIONS UNPARSEABLE — …`, or `DECISIONS BLOCKING|CLEAR — <n> row(s): <a> needs_human, <b> agent_resolved, <c> invalid` followed by `[needs_human] <id>: <question>` and `[invalid] <id> — <reason>` lines (`lib/ledger.mjs:412-440`). With `--json`: `{ change, path, total, needsHuman, agentResolved, invalidCount, invalid, exists, missing, unparseable, changeExists, blocking, rows, invalidRows }` (`bin/interlock:2240-2244`, `lib/ledger.mjs:329-342`); `rows[]` carry `id, question, class, resolution, evidence, valid` (`lib/ledger.mjs:213-221`), `invalidRows[]` carry `{ row, reason }`.
  - `interlock validate "<name>"`: `READY — <change>: <r> of <t> task(s) remaining` or `NOT READY — <change>`, then `present:`, `specs:` and `problem:` lines (`lib/artifacts.mjs:305-316`). With `--json`: `{ change, path, exists, ready, present, missing, tasks: { total, done, remaining, items, redSection }, specFiles, problems }` (`lib/artifacts.mjs:238-292`); `ready` is `missing.length === 0 && items.length > 0` (`:286`).
  - `interlock gate --findings … --metrics <change>`: `GATE PASS — <n> finding(s), no blockers` or `GATE BLOCKED — <b> blocker(s) of <n> finding(s)[ and <m> malformed]`, then `blocker=… warning=… suggestion=…`, `[malformed]` and `[blocker]` lines, `remediation groups:`, and `metrics: <path>` or `metrics: not written (<reason>)` (`lib/findings.mjs:314-339`, `bin/interlock:1861-1863`). With `--json`: `{ passed, total, malformed, dismissedCount, droppedByQuality, counts: { blocker, warning, suggestion }, byDimension, blockers, byFile, unscoped, autonomyOutcome: { blockers }, metrics: { written, path, reason } }` (`lib/findings.mjs:293-310`, `bin/interlock:1864`); `passed` is `blockers.length === 0 && malformed.length === 0` (`:294`), and `autonomyOutcome` is commented as "what the caller feeds straight back into `interlock autonomy record`" (`:308-309`). Probed on 2026-10-06 against a scratch root: `--metrics demo --json` parses as `flags.metrics === 'demo'` and `flags.json === true`, the JSON carries `metrics.path`, and the exit is 1 on a blocker in both renderings.
- **The CLI tests already parse all three.** `test/spine/cli.test.mjs:51-60` defines `runJson(args, expectedCode)`, which appends `--json`, asserts the exit code first and then parses stdout. Ledger: `:844-855` (missing → `missing: true`, `blocking: true`, exit 1), `:857-868` (present and empty → exit 0), `:870-898` (`needsHuman`, `invalid`, `invalidRows.length`, exit 1). Validate: `:1610-1632` (`--json` with two active changes and no name exits non-zero; `--change beta --json` exits 0 with `ready: true`). Gate: `:438-460` (`--json` with a failed metrics write: exit 1, `passed: false`, `blockers.length`, `metrics.written: false` with a reason), `:470-479` (`--json` without `--metrics`: exit 1, no `metrics` key). Not asserted today: `validate --json` on a change with artifacts but no checkbox exits 1 with `ready: false` and `problems`; `gate --json` carries `autonomyOutcome.blockers`.
- **Where the lines sit, and what is pinned around them.** `skills/spec/SKILL.md`: `interlock drift --json` at `:94`, `openspec new change "<name>"` at `:113`, `openspec status --change "<name>" --json` at `:123` (and in prose at `:144`), `interlock ledger "<name>"` at `:197` with a prose mention at `:191`, `openspec validate` and `interlock validate "<name>"` at `:209-210`, `Run /interlock:review-artifacts` at `:219`, the two `interlock autonomy` lines at `:226` and `:228`, "Keep the blocker and warning counts. Continuity needs them" at `:233`, `interlock notify checkpoint "<change-name>"` at `:255`, `GOAL MET: interlock spec stopped at the checkpoint.` at `:262`. `skills/review-artifacts/SKILL.md`: `interlock validate [change-name] --json` at `:19`, the gate line at `:122`, "Its exit status is the verdict … Do not re-derive the verdict in prose." at `:125`, the `--metrics` paragraph at `:127`, and the prose summary block `SUMMARY: N blockers, N warnings, N suggestions` at `:94`. `skills/spec/continuity.md:16` already runs `interlock ready "<name>" --findings … --paths … --json`. `test/skills.test.mjs` pins: `--metrics` on both review lines by `/interlock gate [^\n]*--metrics/` and `/--metrics <change>/` (`:468-501`); `GOAL MET` (`:645-649`); `interlock notify checkpoint` before `GOAL MET` by `indexOf`, and `no-op|exits 0|unconditionally` (`:651-664`); continuity `interlock ready`, `--findings`, and the blocker-count prohibition `/(?:do not|never|must not)[^.]{0,80}blocker count/i` (`:747-769`); `RED_SECTION_MARKER` imported from `lib/artifacts.mjs` (`:15`, `:367-379`). The file's own rule is repeated at `:196-198`, `:223`, `:444`, `:509-512`, `:738-740`: tokens, not sentences.
- **The autonomy count's provenance.** `skills/spec/SKILL.md:226` takes `--blockers <n>` from the review-artifacts output, whose only count is the prose `SUMMARY:` line the reviewer wrote (`skills/review-artifacts/SKILL.md:94`). `openspec/specs/spec/continuity-provenance/spec.md` names that defect class — a value the loop acts on, reported by the party it assesses — and says its list of instances is incomplete.
- **The docs rows.** `docs/10-agentic-workflow-ship-and-spec.md:187-195` is the handoff table; `:191` is `.claude/ready/<name>-review.json | continuity only`. A grep of `lib bin skills hooks test docs` for `.claude/ready` finds only that line. `lib/ready.mjs:238-249` reads the findings file handed to `--findings` and names no path of its own; `--review` warns as deprecated at `bin/interlock:2261-2266`. `docs/05-continuity.md:18` shows `interlock ready <change-name> --review <review-result> --paths <planned paths>`. `docs/10:114-116` are steps 7-9 (ledger, validate, review) and show the text forms.
- **The sibling.** `observe-the-spec-run-live` is a hooks module that reads these lines off `tool.call` results for Bash, the way `hooks/mod.mjs:564-578` reads ship steps, and draws what the CLI said. Research §6 ("Minimal plugin-side changes", item 1) and §7 ("Prose drift breaks it silently") are the reason the pins land here, before it.

## Goals / Non-Goals

**Goals:**

- The three verdicts the spec flow branches on cross the Bash tool as JSON with the field the exit code is computed from, and the skill names that field in one sentence per line.
- Every line the sibling meter will key on is pinned by token on the fenced command line, with its order, before the meter exists.
- No exit code, no CLI shape, no threshold and no corpus moves.

**Non-Goals:**

- Any change under `bin/` or `lib/`: the flag, the shapes and the exit codes exist. The CLI side of this change is two assertions.
- A spec trace on disk (a CLI job: outcome-class, with an `interlock report` reader on day one), the spec meter, or any edit to `hooks/`.
- `--json` on `openspec validate` (OpenSpec's own `{ version, results, summary }`), on the two `interlock autonomy` lines, or on `skills/explore/SKILL.md:151`'s `interlock ledger <change>` (D7, D10).
- Filtering the JSON through `python3 -c` as the `openspec instructions` line does (D3).
- Rewriting the human-facing commands in `docs/02-the-checkpoint.md:77-82`; a person reading `NOT READY` needs no field.

## Decisions

### D1 — `--json` on the existing skill line, not a wrapper subcommand or a changed default

Each of the three lines gains the flag at its end: `interlock ledger "<name>" --json`, `interlock validate "<name>" --json`, `interlock gate --findings … --metrics <change> --json`. Nothing else on the line moves, so `--metrics <change>` stays where the existing pin reads it.

*Why.* The flag is read once for every subcommand (`bin/interlock:1785`) and every branch already emits through it; the flow's other lines (`openspec status`, `interlock drift`, `interlock ready`, review-artifacts' own `interlock validate`) already carry it, so the model reads one form across the whole flow. The sibling meter reads the Bash result as the CLI printed it, so the line itself must produce the JSON.

*Alternatives.* A wrapper subcommand (`interlock spec-gate <stage> <name>`) would be a second path to the same verdict and a second place to keep exit codes aligned. Making JSON the default rendering would change `docs/02`'s human commands, every text assertion in `test/spine/cli.test.mjs`, and ship's own calls. A `--json` on `openspec validate` too: OpenSpec's shape is not Interlock's to pin, and the Interlock validate that follows is the line the flow branches on.

### D2 — The exit code stays the verdict; the field is the same fact in a form a reader can take

Each skill keeps saying the exit status is the verdict (the review-artifacts sentence at `:125` is now pinned) and adds that the named field carries it. No sentence tells the model to branch on the field instead of the exit.

*Why.* `.claude/CLAUDE.md`: a gate blocks by exiting non-zero. `review/metrics-emission` already requires that emission cannot change a verdict or an exit status; `--json` is a rendering decided before the exit at `:1865`, `:1873` and `:2250`, so the flag cannot reach it. Keeping both forms in the prose means a reader who ignores one still gets the other, including the unresolved-name case, where the JSON carries no verdict field at all and the exit is 1.

*Alternatives.* Branch on the field only: a reader who drops the exit code would then read `{ error, candidates }` as neither pass nor block. Branch on the exit only and drop the sentence: the field goes unnamed, and the next reword drops the flag.

### D3 — One sentence per line names the verdict field and the list to act on, and no number

- Ledger: `blocking` is the verdict; report the `needs_human` entries of `rows` by `id` and `question` and the entries of `invalidRows` by `reason`; `missing` and `unparseable` are why a ledger with no rows still blocks.
- Validate: `ready` is the verdict; fix what `problems` names; `error` with `candidates` means the name did not resolve.
- Gate: `passed` is the verdict; report `blockers` and `malformed`; `metrics.written` and `metrics.reason` say whether the record landed; `autonomyOutcome.blockers` is the `<n>` for the autonomy record.

*Why these fields.* They are the ones the exit code is computed from (`lib/ledger.mjs:341`, `lib/artifacts.mjs:286`, `lib/findings.mjs:294`) and the ones the existing CLI tests assert. The sentence names a field and an array; it compares nothing and restates no threshold, so `test/skills.test.mjs:246-251`'s posture holds. The gate's JSON repeats each finding under `byFile`; for an artifact review of ten findings that is a few kilobytes the model wrote a moment earlier, so the line is kept raw rather than filtered: a filter would change what the sibling reads off the Bash result and add a second shape to pin.

*Alternatives.* Pin the field names against the modules' return shapes, the way `RED_SECTION_MARKER` is imported: `inspectChange` and `evaluateGate` could be imported into the skills test, but `rows` and `invalidRows` are composed in `bin/interlock:2242`, which the test cannot import, so the pin would cover two lines and not the third. The field tokens are pinned as text in the skills test and as keys in the CLI test instead (D5); the two sides meet on the token.

### D4 — The autonomy record's `<n>` is the gate's `autonomyOutcome.blockers`

`skills/spec/SKILL.md` §5 says `<n>` is `autonomyOutcome.blockers` from the gate's JSON, carried over from the review, never a count made in prose; the "Keep the blocker and warning counts" sentence at `:233` becomes a sentence naming what the two consumers take: continuity takes the findings file (`continuity.md:11-16`), the autonomy record takes `autonomyOutcome.blockers`. `skills/review-artifacts/SKILL.md` names the field in the gate sentence so the value crosses the skill boundary by name.

*Why.* `lib/findings.mjs:308-309` already designates the field for this. The count is today read off the reviewer's own `SUMMARY:` line, which is the defect class `spec/continuity-provenance` describes and says is not fully enumerated. The autonomy ladder gates nothing (`docs/10:454`), so this moves no decision; it moves where a number comes from.

*Alternatives.* `counts.blocker` is the same number; `autonomyOutcome` is the field the code labels for this caller. Leaving the count in prose keeps a value the loop records being written by the party it assesses.

### D5 — The CLI side is two pins, not a feature

`validate --json` on a change whose three artifacts exist but whose `tasks.md` has no checkbox exits 1 with `ready: false` and a `problems` entry naming it; `gate --json` carries `autonomyOutcome.blockers` equal to `blockers.length`. Both go in `test/spine/cli.test.mjs` beside the tests that already parse those commands (`:1610-1632`, `:470-479`).

*Why.* The research suspected `interlock validate` had no `--json`; `bin/interlock:1869-1875` and `test/spine/cli.test.mjs:1628` show it does, so there is no red section and no TDD shape: the task shape is standard. What is not asserted today is the not-ready exit under `--json` and the one gate field the spec skill now reads, and a field a skill reads by name should have a test that prints it. Every other field the sentences name is already asserted (`blocking`, `missing`, `invalidRows`, `ready`, `passed`, `blockers`, `malformed`, `metrics`).

*Alternatives.* No CLI test, trusting the existing ones: `autonomyOutcome` would then be a field a skill reads that no test prints. A TDD section for a flag that exists: the red test would be green on `main`, which the task shape rules out.

### D6 — Which lines are pinned, and which are not

Pinned, in `skills/spec/SKILL.md`: `interlock drift --json`, `openspec new change`, `openspec status --change … --json`, `interlock ledger … --json`, `interlock validate … --json`, `/interlock:review-artifacts`, `interlock autonomy record review-artifacts --blockers`, `interlock autonomy clean review-artifacts explore spec`, `interlock notify checkpoint`, `GOAL MET: …` — in that order. In `skills/review-artifacts/SKILL.md`: `interlock validate … --json`, `interlock gate … --json`, the existing `--metrics` pair, the exit-status sentence and the re-derive prohibition. In `skills/spec/continuity.md`: `--json` on the line that already carries `interlock ready` and `--findings`. Field tokens: `blocking`, `invalidRows`, `ready`, `problems` (spec); `ready`, `problems`, `passed`, `malformed`, `autonomyOutcome.blockers` (review-artifacts); `autonomyOutcome.blockers` (spec §5).

Not pinned: `openspec instructions … --json` (`openspec status` after each write already tells an observer which artifact is next; `instructions` adds no state), `interlock-graph consumers` (explore-side, no verdict), `openspec validate` (OpenSpec's output), and `skills/explore/SKILL.md:151`'s `interlock ledger <change>` (runs with an active change in a standalone explore; inside the spec flow explore runs before `openspec new change`, so that line never fires there).

*Why this set.* Research §6 lists the signals the smallest spec meter reads: the change name from `openspec new change` or `--change`, the artifact ladder from `openspec status`, drift, ledger, validate, the gate, the autonomy result, the checkpoint, and `interlock ready` on the `--continue` path. Each is one line; each is unpinned today except `notify`. The order pin exists because the docs describe the flow as steps 7-9 and the meter's ladder is that order; reordering the gates is a behaviour change and should fail by name.

### D7 — The autonomy lines stay text and are pinned as commands

Neither `interlock autonomy record …` nor `interlock autonomy clean …` gains `--json`. Both are pinned by their command tokens.

*Why.* Nothing branches on their result: the ladder is storage-only (`docs/10:454`), the skill does not read what they print, and a meter that showed `L2 (2/3 clean)` as a figure would be the "autonomy as a score" misreading research §7 names; its mitigation is to show the CLI's words or nothing, which text already is. The command tokens are pinned because the lines are what credits and debits the ladder, and a reword that dropped one would empty `.claude/autonomy.json` for the spec path without failing anything — the `--metrics` shape again.

*Alternatives.* `--json` on both: two more line edits with no reader of the fields. Leave them unpinned: the sibling would then key on lines that can vanish silently.

### D8 — Pins match the fenced command line and check order by match index

Command-line pins use `^…$` with the `m` flag, for example `/^interlock ledger [^\n]*--json$/m`, `/^openspec status --change [^\n]*--json$/m`, `/^interlock gate [^\n]*--json$/m`, `/^interlock autonomy clean review-artifacts explore spec$/m`; the order is asserted by `text.search(re)` ascending across the spec skill's list. Field tokens are matched as backticked words (`` `blocking` ``) or dotted paths (`autonomyOutcome.blockers`). Prohibitions keep the existing shape: `/(?:do not|never|must not)[^.]{0,60}re-derive the verdict/i`.

*Why.* `interlock ledger` appears in prose at `skills/spec/SKILL.md:191` before the command at `:197`, and `openspec status … --json` appears in prose at `:144` after the command at `:123`; an unanchored `indexOf`, the shape the notify pin uses, would be satisfied by a mention or mis-order the chain. Verified on 2026-10-06 against the current files with `--json` appended in memory: every anchored pattern matches exactly the fenced line at the positions listed in Context, the order ascends (94, 113, 123, 197, 210, 219, 226, 228, 255, 262), and the review-artifacts patterns match `:19`, `:122` and `:125`.

*Alternatives.* `indexOf` on the bare command, as `:656-657` does for notify: fine for a line with no prose mention, wrong for ledger and status. Pinning the full line with its argument form (`"<name>"`): a quoting change would delete the pin for no behaviour change.

### D9 — The stale docs row becomes the findings file, and the deprecated flag goes with it

`docs/10:191` becomes a row for `.claude/metrics/review-artifacts-<change>-<ts>.json`, consumed by `interlock gate` (the verdict and the metrics record) and by `interlock ready --findings` (continuity only). Steps 7-9 at `:114-116` show the `--json` lines and the field each reads. `docs/05:18` shows `--findings <the artifact review's findings JSON>` in place of `--review <review-result>`.

*Why.* Nothing writes `.claude/ready/`; the path is the home of an input `bin/interlock:2261-2266` deprecates. A reader following the row would wait for a file that never appears, and a reader of `docs/05:18` would pass a flag that warns. Both are the same stale concept, so they are fixed in the same task.

### D10 — Named follow-ups

- **A spec trace on disk** is a CLI job: outcome-class (the artifacts are the record), never `fatal: true`, written by a CLI subcommand that is already run unconditionally (`interlock notify checkpoint` is pure transport today, `lib/notify.mjs:8-12`) or a new one, with an `interlock report` reader on day one, because a corpus nobody reads is a corpus nobody notices is empty (`docs/11-the-indicators.md:37-38`). Not this change.
- **The spec meter** is `observe-the-spec-run-live`. It reads the lines this change pins, and nothing here touches `hooks/mod.mjs` or `test/spine/mod-pins.test.mjs`.
- **`openspec validate --json`** and **`--json` on the autonomy lines** are available if the meter wants them; each would be one line and one pin, decided there.

## Risks / Trade-offs

- [The model reads the JSON and stops saying the ledger's questions in words at the checkpoint] → the ledger sentence names `rows[].question` and `invalidRows[].reason` as what to report; §6's handoff still lists assumptions and pending clarifications, and the question text is in the JSON.
- [A reader takes `total: 0` for clear, or `{ error, candidates }` for pass] → the sentences name `missing`, `unparseable` and `error`; the exit code is 1 on all three, and the skill keeps saying the exit status is the verdict.
- [The gate's `byFile` doubles the findings in the Bash result] → a few kilobytes the model wrote moments before; the line is kept raw so the sibling reads one shape (D3). If a consumer repository's review grows past that, a filter is the sibling's decision, since it changes what crosses the tool.
- [`--json` at the end of the gate line is read as the value of `--metrics`] → probed: `--metrics demo --json` gives `flags.metrics === 'demo'` and `flags.json === true`. The existing `--metrics requires a change name` die at `bin/interlock:1847` guards the bare-flag case.
- [The order pin makes a future restructure of the spec skill fail the suite] → intended: reordering the gates is a behaviour change, and the failure names the first line out of order.
- [Two pins on one line (`--metrics` and `--json`)] → both are anchored on the same fenced line; the existing pin is not edited, so a regression on either is attributed to its own assertion.
- [The autonomy `<n>` was a count the model could read from anywhere; now it is one field] → that is the point (D4). A gate that never ran leaves no `autonomyOutcome`, and the spec skill halts on blockers before reaching the autonomy line anyway.
- [Consumer repositories run an installed copy of the skill until they update the plugin] → the CLI is unchanged, so the old text lines keep working; the sibling meter reads `not run yet` for a text line, which is spoken, not silent.

## Migration Plan

No data, no file format and no CLI change. The skills update with the plugin; a consumer on the previous skill text gets the previous text output from the same CLI. Rollback is a revert of the skill lines, the pins, the docs rows and the changelog entry. Lands before `observe-the-spec-run-live`.

## Open Questions

- Does the engine expose a Bash tool's exit code to a hooks module on `tool.call`? Research §3 could not establish it. It does not affect this change — the verdict field is in the JSON — and the sibling decides whether it needs the exit at all.
- Should the spec skill's `openspec validate` line also ask for `--json`? Deferred to the sibling; it is OpenSpec's shape, and the flow branches on the Interlock validate that follows.
- This change was written with the four planning artifacts only; it carries no `decisions.md`, so `interlock ledger "print-json-from-the-spec-gate-lines"` reports the ledger missing until one is written. D1-D10 above are the candidate rows, all `agent_resolved` with this file as evidence.
