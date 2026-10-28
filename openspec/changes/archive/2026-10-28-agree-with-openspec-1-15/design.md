# Design: agree with OpenSpec 1.15

## Context

Interlock composes the OpenSpec CLI. This machine runs 1.4.0; 1.15.0 shipped on 2026-10-24. The explore brief `.claude/handoff/explore-agree-with-openspec-1-15-20261028-161836.md` measured each behaviour difference on scratch copies, with every CLI installed under `$TMPDIR`. Its findings F1 to F8 are the evidence this design cites.

Four of the differences reach shipped behaviour:

- **Nested deltas (F1).** 1.4.0 and 1.6.0 archive a nested-only change without syncing it. 1.7.0 and later sync it. Every capability in this repo is nested.
- **Scenario loss (F2).** 1.7.0's `validate` passes a change its own `archive` refuses. 1.8.0 and later reject it in both commands.
- **Bare validate (F3).** `openspec validate` with no target exits 1 having checked nothing, in every version.
- **Task lines (F4).** 1.15.0 counts `+`, ordered markers, any one-character box and empty text. Interlock's two readers count `-`/`*` with ` `/`x`/`X` only, and they disagree with each other.

Constraints from `.claude/CLAUDE.md`: guards fail open; degradation is spoken; thresholds live in code, not prose; zero runtime dependencies; a prose instruction is pinned by token in `test/skills.test.mjs`.

## Goals / Non-Goals

**Goals:**

- A CLI too old to handle nested deltas is named by `interlock doctor`, and by every surface that relays the doctor.
- Ship, ready, drift and the plan fingerprint see the same open tasks the CLI counts.
- The tick guard and the reader agree on what a checkbox is.
- The authoring skills' validate step checks something, and the spec skill states the rule that makes archive refuse a MODIFIED block.
- `openspec validate --specs` on this repo has no ERROR under 1.15.0.

**Non-Goals:**

- `--strict` validation, and splitting long requirements. 1.15.0 warns on 332 of them, but its own guidance says not to trim them (F6).
- Calling the CLI from ship, or reading `instructions apply --json`.
- Adopting `openspec version --check`, `status --all` or `show --diff`.
- Upgrading the user's CLI, or committing the uncommitted `route-prose-spawns-by-role` hand archive.
- `readLeftoverIds` dropping tasks with no leading id (`lib/run.mjs:5526`). That predates this change and is out of scope.

## Decisions

### D1 — The floor is 1.8.0

1.7.0 is the first version that syncs nested deltas, but it validates a change its own archive refuses (F2). The spec skill will rely on `openspec validate "<name>"` to catch scenario loss before archive does (D8), and that holds only from 1.8.0. *Rejected:* 1.7.0, which is enough for sync but leaves validate unable to predict archive. *Rejected:* 1.15.0, which would warn for no behaviour this change depends on.

### D2 — A floor miss is a warn

`checkOpenSpec` already warns for gaps that only affect authoring (`lib/doctor.mjs:803`). Ship reads artifacts off disk and still works on an old CLI. A `fail` would break a session that only ships. The preflight prints only `[FAIL]` rows on stdout, so the warn reaches the user through `interlock doctor`, `preflight.json`, the meter band and `/interlock-preflight`, all of which relay the row's detail verbatim.

### D3 — An unreadable version is a warn that quotes the line

`compareVersions` returns `null` when either side has no `x.y.z` (`lib/host/claude-env.mjs:76`). A `null` beside a non-empty version line becomes its own warn whose detail quotes the line. It is never treated as `ok`. The `cli-version` row already handles `null` this way (`lib/doctor.mjs:746`).

### D4 — The constant lives beside `OPENSPEC_INSTALL`

`export const OPENSPEC_MIN_VERSION = '1.8.0'` goes in `lib/doctor.mjs`, next to `OPENSPEC_INSTALL` (`:121`). It follows the `PROMPT_CACHE_MIN_HOST_VERSION` precedent (`:114`). `lib/limits.mjs` publishes Interlock's own budgets, and the Node 20.19.0 floor is inline in the doctor too. The new branch sits after the `!version` guard and before the `!configured` guard, so the not-initialised warn keeps its own case. Docs name the floor through a test that reads the constant, not through a restated number.

### D5 — The task reader takes OpenSpec 1.15.0's shape

`TASK_LINE` becomes `^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)`, upstream's pattern from `dist/utils/task-progress.js:53`. It is anchored the same way and keeps the negative lookahead that leaves link bullets out. The capture groups change, so the reader keeps the box's span (its start and end within the line) and the marker character. `done` stays `x`/`X` only, matching upstream. The description is trimmed. An empty description is a task with a `null` id, which the tick cannot address. That is the existing behaviour for any task with no leading id. *Rejected:* keeping the narrow shape and warning on unrecognised lines. That needs a second pattern to keep in step, and ship still skips the task.

### D6 — The guard reads through the reader

`hooks/guard-tasks.mjs` drops its own `CHECKBOX` and takes the box state of each line `TASK_LINE` matches, with every non-`x` marker folded to open. It already imports `node:fs` and `../lib/ship-stage.mjs`. It is a guard process, not `hooks/mod.mjs`, so importing `lib/artifacts.mjs` breaks no engine rule (`test/spine/mod-pins.test.mjs` scans only the module's import graph). Folding means `[~]` → `[ ]` reads as unchanged, and `[~]` → `[x]` reads as a flip. The existing three scenarios in `hooks/tool-guards` keep their titles verbatim (F2).

### D7 — Tick and normalise rewrite the matched span

`tickTasks` replaces the matched box span with `[x]`, and `normalizeTaskMarkers` replaces it with `[ ]`. Every other byte of the line is kept. `tickTasks` still reports an `x`/`X` box as `already` and never rewrites it. Line splitting stays on `\n`, so a CRLF line keeps its `\r` as today. The lookahead in D5 cannot see past a `\r`, and upstream's lack of a `$` anchor exists for that same case.

### D8 — The validate lines name their target

The spec skill's §4 runs `openspec validate "<name>"`. Bootstrap's §4 runs `openspec validate --specs`. `test/spine/spec-meter.test.mjs` `UNREAD_BY_NAME` takes the new spec-skill literal in place of the bare one. The meter does not read validate's output, so no `--json` is added (`print-json-from-the-spec-gate-lines` design D10). The §4 prose stops saying a bare validate "checks schema conformance".

### D9 — The scenario-title rule is one sentence in the spec skill, pinned by token

The rule goes in §3's "Gates while generating": a `## MODIFIED` requirement copies every `#### Scenario:` title its living spec holds, verbatim. To drop or rename one, remove the requirement and add it back. `test/skills.test.mjs` pins the tokens `MODIFIED`, `scenario title` and `REMOVED`. *Rejected:* adding it to `skills/review-artifacts`. The author is the one who can still fix it cheaply, and validate (D8) catches it after that.

### D10 — No `--strict`, no requirement splitting

1.15.0's spec instructions (`schemas/spec-driven/schema.yaml:108`) say never to trim existing requirements under MODIFIED just to meet the length. A named non-strict validate exits 0 on the warnings.

### D11 — The two retired specs are deleted

`openspec/specs/evals/spec-range/spec.md` and `openspec/specs/spec/checkpoint-advisor/spec.md` hold no requirement, and 1.15.0 rejects them (F5). Nothing reads either path. Upstream's own retirement path (`retire_capabilities: true`) deletes the spec file. The retired text survives in git and in `openspec/changes/archive/2026-10-25-replace-subagent-advisors-with-advisor-tool/`. `distribution/npm-package` gets a Purpose written from its requirements in place of the archive placeholder (F7). The working tree's `spawn-routing` placeholder belongs to the uncommitted hand archive and is left to it.

### D12 — No code reads the new JSON keys

`isPlanningComplete`, `root`, `taskTrackingConfigured` and per-task `sourcePath`/`line` are additive (F8). `compact-instructions.mjs` keeps its five keys.

### D13 — The bare `--version` probe stays

`test/skills.test.mjs` pins `openspec --version` as the first CLI line in spec, bootstrap and dispatch. `compareVersions` reads that line's first `x.y.z`. `openspec version --check --json` is 1.14.0 and later only, so on an old CLI it would fail where the probe is needed most.

### D14 — The shared probe stub stays

`baseOpts` answers every binary with `stub 1.0.0` (`test/spine/doctor.test.mjs:259`). That is below the floor, so the `openspec` row becomes `warn` in every doctor test. No test counts warnings or reads that row's status under the default stub (`openspec` is read only at `:533-568`, each with its own setup), and a warn leaves `report.ok` true (`lib/doctor.mjs:1833`). The floor tests pass their own probe, and the shared stub is not raised, because raising it would move the `claude-env` rows that read the same probe.

### D15 — Compound note N1 does not bind here

`interlock note match` returns N1 for `lib/doctor.mjs`, which is about the `cli-version` row reporting skew when the doctor runs by name. This change edits only the `openspec` row (`:774-812`), not `cli-version` (`:725-772`), so N1's rule is neither applied nor broken.

## Risks / Trade-offs

- [A CLI between 1.8.0 and 1.13.0 counts fewer lines than Interlock] → Interlock errs toward open work: a task it plans that the CLI does not count is visible, never lost.
- [A `[1]`-style bullet in a tasks.md now reads as an open task] → This is upstream's own trade (`task-progress.js` comment). It is a loud false positive that the plan coverage check names.
- [Widening the guard denies an edit it used to allow] → Only during an active run's implementation stages, and only for a box state change, which the CLI owns. Outside a run it still fails open.
- [The installed 1.4.0 reports this change's nested `hooks/tool-guards` delta as "No deltas found"] → `node bin/interlock validate` reads it, and 1.15.0 parses all four deltas (measured).
- [Users on 1.4.0 see a new warn at every session start] → Intended. The detail names the fix.
