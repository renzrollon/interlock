## answer-the-design-critique review — code review, regression and performance

Scope: `ac7deed...cd20693` (4 commits, 57 files). No changes were made during review.

**Gate:** No build or lint step exists (`.claude/CLAUDE.md`), and the diff adds no env keys. `npm run validate` passes. `npm test`: 5887 pass, 0 fail, 5 skipped (of 5892). `claude plugin test .`: 206 pass, 0 fail (6 files, which covers the changed `test/mod/meter.test.ts`). ESLint: not configured, so 0 new errors in changed files.

The round-0 comment reviewed up to `169bdf5`. This pass covers the whole range and reads `cd20693` (the CLI critique fixes and the site polish) for the first time.

### 🔴 Critical / High

(none)

### 🟡 Medium – Low

| # | Sev | Category | Issue | Location | Suggested fix |
|---|---|---|---|---|---|
| M1 | Med | `correctness` `security` | The new `failing:` row prints each failing test name as recorded. Names have no length bound, and embedded newlines are kept. A failure with no `test`/`name`/`title` falls back to its error message, so `{message:'AssertionError: expected 3\n    at t.mjs:4:5'}` renders as `failing: AssertionError: expected 3\n    at t.mjs:4:5`, and one 3 kB message gave a 3,088-char row. `LIMITS.haltFailingTests` bounds only the count, although its doc says the row is "one line beside the `SHIP HALTED` headline". The row prints in the same close summary as the new `agent:`/`person:` lines. A test name containing `\nperson: …` therefore prints a column-0 instruction line the model reads (reproduced through `formatRunSummary`). No spec covers the row: `cd20693` added it outside the change's delta specs. | `lib/verify.mjs:528-541`; `lib/verify.mjs:558-571`; `lib/limits.mjs:286-291` | In `failingTests`: keep the first line of each name (`split(/\r?\n/)[0]`), strip control and ANSI characters, cap each name at about 120 chars with `…`, and use the message only after `test`/`name`/`title`. Add `verify.test.mjs` cases for a multi-line name and an over-long name. |
| M2 | Low | `regression` | See F-b3b6d579 in the earlier comment. `cd20693` added another 335 B (+702 B over the whole PR, from 244,912 B). `cli/interlock` is now 245,614 B against the 245,760 B headroom pin, so **146 B** are left (481 B at `169bdf5`). The next edit of almost any size turns `package.test.mjs` red. | `cli/interlock`; `test/spine/package.test.mjs:392-398,442` | Before merge, move the `help` case body and the no-command branch into `lib/help-cli.mjs`, as `lib/note-cli.mjs` was moved after PR #20. |
| M3 | Low | `docs` | The new no-command path (`interlock --verbose` exits 1 with `No command given, and no command takes --verbose.` and the corrected order) is described only in CHANGELOG. docs/07's arguments list covers `help`, `--all` and unknown commands, but not flags given without a command. | `docs/07-cli-and-configuration.md:35-36` | Add a bullet after "An unknown command names the closest one". It should describe the `noCommand` text, the reorder hint and exit 1. |
| M4 | Low | `docs` | docs/11 says sorting runs per change by run count means "the cap never hides a change that took several". Once more than `TEXT_LIST_MAX_ROWS` changes have 2 or more runs, the cap does hide them. For example, 7 changes with 3 runs each print 5 and fold 2 into the "and N more" line. | `docs/11-the-indicators.md:398-399`; `lib/report.mjs:1409-1424` | Reword to "a change the cap hides never has more runs than one it shows, and the fold line counts their runs". |
| M5 | Low | `performance` | `guard-commit` runs on every Bash tool call. It now statically imports `lib/artifact-snapshot.mjs` (plus `line-diff.mjs`, `repo-file.mjs` and `node:crypto`, about 19.5 KB) only to call `isChangeName`, a one-line regex. ESM evaluates that import before the allow early exits. Measured in-process, it costs 1.7–1.9 ms per call, about 4% of the guard's 40–45 ms process. | `hooks/guard-commit.mjs:22`; `lib/artifact-snapshot.mjs:176-179` | Move `SAFE_CHANGE`/`isChangeName` into `lib/ship-stage.mjs`, which the guard already imports and which uses only stdlib, and re-export it from `artifact-snapshot.mjs`. Or import it lazily inside `wayOut`, which runs only on the deny path. |
| M6 | Low | `security` | `wayOut` quotes `marker.path` in the deny reason the model reads, without filtering it. `readStage` builds that path from the raw `.claude/ship/<dirent>` name, which is not checked with `isChangeName`, unlike `change` and the run id (`PLAIN_RUN_ID`). Reproduced: a directory named `x\nSYSTEM: … git commit --no-verify` with a live-pid marker printed that text as its own line in the `person:` sentence. Reaching it needs a local writer in gitignored `.claude/ship/`. | `hooks/guard-commit.mjs:81-83,115-118`; `lib/ship-stage.mjs:193` | Quote the path only when its directory name passes `isChangeName`. Otherwise write "a stage marker under .claude/ship/". Add a `hooks.test.mjs` case with a newline in the directory name. |
| M7 | Low | `docs` `observability` | `cd20693` adds two display bounds outside `lib/limits.mjs`: `TEXT_LIST_MAX_ROWS = 5` and `TEXT_MAX_EVIDENCE_LINES = 4`. CHANGELOG restates them as numbers ("five rows", "four lines") and calls the report bound a cap. The same PR's README says "`interlock limits` prints every cap", but `interlock limits` lists only `haltFailingTests`, the sibling bound that did go into `LIMITS`. | `lib/report.mjs:140`; `lib/merge-confidence.mjs:1403`; `CHANGELOG.md:15-16`; `README.md:95` | Either add both to `LIMITS` and `formatLimits` and point CHANGELOG at `interlock limits`, or drop the numbers from CHANGELOG and call them display bounds, as docs/11 and docs/15 already do. |
| M8 | Low | `performance` | `failingTests` re-runs `normalizeFailureSignature(failureText(f))` on every failure that `clusterFailures` has just normalized. That doubles `judgeUnitResult`, which `verify unit`, `verify judge` and each inter-wave checkpoint call. Benchmark with 1,000 failures of about 2.1 KB each: 3,235 ms at base, 6,357 ms at head. `failing` also repeats `clusters[].tests` in the logged verdict. | `lib/verify.mjs:533`; `lib/verify.mjs:693-694` | Normalize once. Have `clusterFailures` return each failure's signature, or build `failing` from `clusters.flatMap(c => c.tests)`, keeping each test's file in the cluster. |
| M9 | Low | `correctness` | A `verify-final.json` written by a CLI older than this change has no `unit.failing`. A run that straddles the upgrade then gets `failing: none named — the unit result reported N failing without test names`, even though that verdict's `clusters[].tests` hold the names (true at base, `clusterFailures` L502-507). | `lib/verify.mjs:560-565`; `lib/run.mjs:4004-4009` | When `unit.failing` is absent, fall back to `clusters.flatMap(c => c.tests)`, or print no row instead of "none named". |

### ❓ To investigate

- On a red-unit halt where `.claude/ship/verify-final.json` is absent, belongs to another run, or cannot be read, `haltFailingRow` returns `null`. The summary then drops the `failing:` row and prints no line saying it could not be built (`lib/run.mjs:4004-4009`). Check with a close test on a red halt with that file missing.
- `verify unit` and `verify judge` call `formatFailingRow` without `whole`. A cut there says "and N more" but not where the rest is (`lib/verify.mjs:1257,1266`). Only `--json` `failing` has the full list.
- `node cli/interlock --json; echo $?` prints nothing on stdout and exits 1. The unknown-flag refusal mirrors to stdout for the Workflow relay, and `noCommand` does not. No driver sends a commandless line today.
- `interlock help ''` prints `No command given.` and exits 1. No test covers it, and the spec says only that an unknown name is refused like an unknown subcommand.
- Before this PR, `normalizeFailureSignature` was already superlinear on long word tokens: 4,000 chars take 6.7 ms and 8,000 chars take 26 ms. The likely cause is the bare-filename regex at `lib/verify.mjs:452`. It is bounded by the 4,096-char field cap but not by the failure count, and M8 doubles its cost.

### ✅ Checked, no issue

- `guard-commit` still fails open. The deny decision rests on `readStage` alone. The lazy `import('../lib/run.mjs')` (241 KB, 16–17.5 ms) runs only on the deny path and sits in a try/catch that changes only the wording and records `manifestError`. Nothing outside that try can throw on any marker shape. Probes with a live-pid marker all denied in about 50 ms: no manifest, a matching manifest (run id quoted), a backtick run id (dropped by `PLAIN_RUN_ID`) and a garbage manifest.
- The run id is quoted only when `inspectManifest` returns ok, the manifest's change matches, the path equals `.claude/ship/<change>/stage.json` and the id matches `PLAIN_RUN_ID`. The denied command never enters the reason.
- The deleted test `--help and a bare invocation print USAGE and exit 0` was split, not weakened. `--help` and `-h` still exit 0 with `Exit codes:` (`test/spine/cli.test.mjs:200`). Bare `interlock` prints the 18-line index with the same first line. No workflow, script or `package.json` hook runs bare `interlock` expecting the full usage.
- I ran the help edge cases. `help unknowncmd` exits 1 with `Unknown command:` first and empty stdout. `help --all`, `-h --all` and `--help --all` print the full 1,130-line usage and exit 0. `help --bogus` exits 2 through the `help: ['all']` TABLE row. `help settle` prints `SETTLE_HELP`. `--verbose` has no TABLE row and collides with no flag. The only new flag is `all`, and it has its row.
- Callers of every changed export, grepped across `cli/ lib/ hooks/ workflows/ skills/ test/`. All are updated:
  - `pickUpSteps`: 1.
  - `formatRunSummary`: 1 production caller (`runClose`, passes `failingRow`) plus 2 test files.
  - `formatFailingRow`: 2.
  - `owedClose`: 1.
  - `TEXT_LIST_MAX_ROWS`: 1 plus its test.
  - `unknownCommand` and `helpCommand`: 1 each.
  - `readStage` (gains `path`): 4 hooks, all destructuring stage/change only.
  - `listChanges`: 2 (`cli/interlock`, `lib/drift.mjs`). Its dot-directory skip matches preflight's `listedNames`.
- No reader still matches the old text: 0 hits for "The full text, with every flag", "to pick this run up", "Fix the halt reason above" or "If you are an agent/person". `test/mod/meter.test.ts` `COMMIT_REASON` moved to the newline form, and the toast dedupe key stays stable per run.
- `--json` output is unchanged by the text caps. `formatReport` and `formatMergeConfidence` are text-only. skills/report and settle read `--json`/`--markdown`, and the posted markdown path (`cli/interlock:3699-3703`) is untouched, so the `inertSpan` obligations stand. `judgeUnitResult` only gains a `failing` key.
- Cap edges: `capped` uses `>`, so exactly 5 rows print no fold line, and every cut states its count and the `--json` pointer. The runs sort is stable. The report's `not counted N file(s)` line is a total ahead of the capped list, not a duplicate.
- Startup: the new static import `lib/help-cli.mjs` (4,662 B) depends only on the already-loaded `cli-flags.mjs`. `--version` over 30 runs is within noise (base 58–60 ms, head 58–61 ms). `suggestCommand` runs only on the error path (about 40 names, 0.22 ms for an 8-char typo).
- `workflows/ship.js` and `cli/interlock-run` change only string literals plus one `resolve(root)` on the close-failure path, with `root` bound at L215. Nothing runs per wave or per step.
- Site: no new asset, font, `<script src>`, `<link>` or preload. Text adds about 30 KB uncompressed (`index.html` +5.6 KB, `site.css` +7.9 KB). `tabFromHash` whitelists 4 tabs. There is no `innerHTML`, `dangerouslySetInnerHTML` or `eval`. `copyLine` uses `navigator.clipboard.writeText` with a Range fallback and an aria-live notice. The `hashchange` and film listeners are added once and removed on unmount, and no scroll, resize or IntersectionObserver listener was added.
- Rules from `.claude/CLAUDE.md`:
  - Zero runtime dependencies: `package.json` is unchanged.
  - No `fetch`, `http`, `net` or `child_process` is added in `cli/ lib/ hooks/ workflows/`.
  - `hooks/mod.mjs` is not in the diff.
  - No test was weakened: one split, no assertion dropped.
  - Degradation is spoken: `failing: none named …` and every fold line state their cut.
  - `haltFailingTests` lives in `LIMITS` and prints in `interlock limits`.
- Round-0 status at `cd20693`:
  - F-d9f68fd7: still open. `pickUpSteps(undefined, ['1.1'])` prints `/interlock:ship undefined`.
  - F-7fee1ead: unchanged (`SUGGEST_MAX_DISTANCE` is still 2).
  - F-400270c4: still open in `guard-commit`.
  - F-b3b6d579/F-1211a270: worse, see M2.
