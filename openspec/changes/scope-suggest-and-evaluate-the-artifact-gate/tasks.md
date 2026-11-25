# Tasks

Test-first. Section 1 writes the failing tests, one checkbox per test file or pair of files. Each test file is owned by the one section-2 task that turns it green, and that task runs it in its own Verify. No section-2 task runs another task's section-1 file. The skill and docs tasks (2.9–2.12) carry their own pins, because prose has no red wave.

**Guards.** A test marked *(guard)* pins behaviour that already holds and must keep holding, such as a code-review blocker with no line staying a blocker. It passes before section 2 runs. Every other new test fails until its owner lands, so each section-1 Verify reads "fails on the new tests, guards aside".

**Bounded pin rule.** An assertion that pins a meaning the delta specs change is updated in the task that changes that meaning, never during a remediation stage (the test guard denies test edits there). The update names the assertion and the requirement it now pins. These are the known pins, not a complete list:

| Pin | Task that updates it |
|---|---|
| `test/spine/metrics.test.mjs:48`: "the payload has exactly eight keys", which gains `findings` | 2.2 |
| `test/spine/cli.test.mjs:722-723`: `autonomyOutcome.blockers` equals `blockers.length` and `counts.blocker`. It stays true for a fixture whose blockers are cited. If `paths.findings` holds an uncited artifact blocker, the fixture gains a `line` | 2.3 |
| `test/spine/cli-inventory.test.mjs:481-502`: the `SUBCOMMAND_FLAGS` keys and the smoke INVENTORY, which gain `review-policy suggest` | 2.6 |
| `test/evals.test.mjs:94`: the expected-case list, which gains the three cases | 1.8 |
| `test/skills.test.mjs`: any pin on the review-artifacts emit sentence "`line` and `suggestion` are optional" | 2.9 |
| `test/spine/spec-meter.test.mjs:775-781`: `UNREAD_BY_NAME`, which gains the spec skill's `interlock review-policy suggest --summary` line verbatim | 2.10 |

These stay as they are, and must keep passing:

- `test/evals.test.mjs:700-728`: the 40-hex scaffold pin. The new scaffolds fetch every sha they check out or restore from.
- `test/spine/limits.test.mjs:243-315`: the cap-authority sweep. Each new cap lands with its reader.
- `test/spine/package.test.mjs:398,435-445`: the headroom pin.
- `test/spine/artifact-brief.test.mjs:258-289`: the part-order test, whose "every data block follows the lens" holds because `Changed since` is the first data block after the lenses (D28).
- The `test/skills.test.mjs` pins on `re-gate.md`'s `Re-check each earlier blocker` and `changed hunk`, which 2.9 keeps.

A pin found later is handled the same way.

**Shared files.** `cli/interlock` has 2,405 bytes before the headroom pin's zone (design §9). 2.2 and 2.6 add dispatch and usage only, and each runs `node --test test/spine/package.test.mjs`. `lib/limits.mjs` is edited by 2.4 and 2.6, each adding its own caps with their reader and `interlock limits` row. `test/skills.test.mjs` is edited by 2.9, 2.10 and 2.11, each in its own new test.

## 1. Failing tests first

- [x] 1.1 Create `test/spine/line-diff.test.mjs` and `test/spine/artifact-snapshot.test.mjs` with failing tests for spec `spec/artifact-re-gate`'s pure parts:
  - the line diff returns hunks with up to two context lines, merges hunks whose contexts touch, and names each hunk's current and snapshot ranges of its changed lines only: rewriting lines 40–44 names 40–44 while printing 38–46, and a pure removal names the current line it follows (D31);
  - an identical pair gives no hunk;
  - a whole-file add and a whole-file removal;
  - the rework share is `round(100 × max(added, removed) / max(before, after))`: 400 → 410 lines with 20 added and 10 removed reads 5; both totals 0 reads 0; deleting everything reads 100;
  - a snapshot payload built from files has schema `interlock.artifact-snapshot/1`, the change, the findings name, and each file's path, text and SHA-256;
  - reading a payload back answers a reason for unparseable text, another schema, and another change.

  Owned by 2.1. Verify: `node --test test/spine/line-diff.test.mjs test/spine/artifact-snapshot.test.mjs` fails, since neither module exists yet.
- [x] 1.2 Create `test/spine/gate-snapshot.test.mjs` with failing CLI tests for spec `spec/artifact-re-gate`'s gate requirements. They run in a temporary repository holding a change `x`:
  - `gate --findings .claude/metrics/review-artifacts-x-20261125-120000.json --metrics x --stage artifacts --json` writes `.claude/metrics/snapshots/review-artifacts-x-20261125-120000.json` holding the five files, and prints `snapshot.written` `true`;
  - no `snapshot` field without `--stage artifacts`, without `--metrics`, or with `--findings -`;
  - `--metrics y` for a missing change gives `written: false` and a reason naming `y`;
  - with `snapshots` made a plain file, so the directory cannot be created, standard error warns and `passed`, the exit code and every other field equal a run without the snapshot;
  - after a gate that wrote a snapshot, `interlock report --json` gives the same record count and the same unrecognized count as with the snapshot directory removed, and `interlock checkpoint x` names the findings file.

  In `test/spine/metrics.test.mjs`, add failing tests for spec `review/metrics-emission`'s new requirement:
  - the gate's record carries `findings` as the root-relative path, for a relative and for an absolute `--findings` inside the root;
  - `null` for `-` and for a file outside the root;
  - `interlock review --metrics` writes `findings: null`.

  Owned by 2.2. Verify: `node --test test/spine/gate-snapshot.test.mjs test/spine/metrics.test.mjs` fails on the new tests.
- [x] 1.3 In `test/spine/findings.test.mjs`, add failing tests for spec `review/evidence-gate`'s new requirements:
  - an artifact blocker cited by `line` `85` blocks;
  - one cited by `passage` alone blocks;
  - one with neither is under `malformed` with `cause` `citation` and the citation reason, absent from `blockers` and `counts.blocker`, `passed` `false`, and counted in `autonomyOutcome.blockers`;
  - an unknown severity's `malformed` entry carries `cause` `severity`;
  - `line` `0`, `-3` and `"intro"` with no passage are malformed;
  - a blocker with no `dimension` `artifacts` and no citation stays a blocker *(guard)*;
  - uncited artifact warnings and suggestions are counted under their severity *(guard)*;
  - an unknown severity is malformed and not counted in `autonomyOutcome.blockers` *(guard)*.

  In `test/spine/ready.test.mjs`, add a failing test for the readiness scenario: findings holding only an uncited artifact blocker refuse readiness with `REVIEW_FINDINGS_MALFORMED`, and its reason names the missing citation and does not say a severity is outside the defined set (D29).

  Owned by 2.3. Verify: `node --test test/spine/findings.test.mjs test/spine/ready.test.mjs` fails on the new tests, guards aside.
- [x] 1.4 In `test/spine/artifact-brief.test.mjs`, add failing tests for spec `spec/artifact-re-gate`'s brief requirements and spec `review/evidence-gate`'s emit-shape requirement. Each `--since` case writes a findings file and its snapshot by hand into a temporary repository, so this file never needs the gate.
  - **The order under `--since`:** beside the existing order test (`:258`), a `--since` brief with one selected lens holds the re-gate rules after the rubric, the lens after the re-gate rules, and the `Changed since <file>` block after the lens and before every other data marker (`PROSE-MARKER` included), with the run rules and the emit shape after it.
  - **One edited section:** the `Changed since <file>` block holds one `design.md` hunk naming the current lines 40–44 as its changed lines, with its context printed outside that range, and lists the other four files as unchanged. A removal-only edit of lines 10–12 names them as removed `after line 9`.
  - **Added and removed files:** they are named, and the added file's text is one hunk.
  - **Nothing changed:** the opening block says nothing changed since that gate.
  - **The share:** the `RE-GATE:` line carries the share, the added and removed counts, and the changed-file count.
  - **Over the bound:** a share over `LIMITS.maxRegateReworkPercent`, read from `lib/limits.mjs` and not written as a number, adds a `RE-GATE REWORK:` line naming the share and the bound. The brief still holds the re-gate rules and the block.
  - **No usable snapshot:** with no snapshot, a non-JSON one, one of another schema, and one naming change `y`, the `RE-GATE:` line names each case and that git scoping applies. No `Changed since` block is printed, and the exit code is 0.
  - **The emit shape:** it names `passage`, and says a blocker carries a `line` or a `passage`.
  - **The limits surface:** `interlock limits --json` carries `maxRegateReworkPercent`.

  Owned by 2.4. Verify: `node --test test/spine/artifact-brief.test.mjs` fails on the new tests.
- [x] 1.5 Create `test/spine/review-policy-suggest.test.mjs` with failing tests for spec `review/policy-suggestions`, against the pure module and plain inputs, with the caps injected:
  - **The window:** it filters day-dated rows on or after the window's day and timestamped records at or after its time; `all: true` opens it, and so does a missing anchor.
  - **T1:** two changes' rows for `lib/widget.mjs` raise one candidate with both rows; three rows from one change raise none.
  - **T2:** a `lean`/`session` pass followed by a `strict`/`agent` block raises one candidate naming both files, both readers and the blocker title. The same reader twice raises none, and so does an unrecorded reader on either side. Two qualifying pairs in one change raise one candidate holding both pairs, in gate order (D32).
  - **T3:** `agentic-harness.2` on blockers from two changes raises one candidate.
  - **T4:** a row whose evidence holds `human decision 2026-11-26` raises one candidate with the change, id, question and resolution.
  - **Stale:** with enough gates, `review-md.2` is stale and `review-md.1` is not; with fewer, nothing is stale and the reason is stated. With `maxArtifactChecks` injected as 2, a third silent check is under `unquoted`, never `stale`, and the summary does not count it (D30).
  - **The summary:** two candidates and one stale give exactly `REVIEW.md candidates: 3 — interlock review-policy suggest`, and nothing gives an empty string.
  - **The text output:** it opens with `REVIEW POLICY SUGGEST:` and names the window.

  Owned by 2.5. Verify: `node --test test/spine/review-policy-suggest.test.mjs` fails, since the module does not exist yet.
- [x] 1.6 Create `test/spine/review-policy-suggest-cli.test.mjs` with failing CLI tests for spec `review/policy-suggestions`. They run in a temporary git repository:
  - `REVIEW.md` is committed on a known date, and compound-note rows fall before and after it. Only the later row is evidence, and `--all` reads both.
  - Two artifact gates of one change are run through `interlock gate … --metrics x --stage artifacts --depth lean --reviewer session` and then `--depth strict --reviewer agent`, over a passing and then a blocking findings file. They give one `T2` candidate, joined through each record's `findings`.
  - A record with no `findings` field beside a findings file of the same change is counted on the records line and never joined.
  - `openspec/changes/archive/2026-11-26-x/decisions.md` with a human-decision row gives one `T4` candidate.
  - A repository with nothing exits 0 with each source's absent line.
  - `--summary` prints the one line or nothing.
  - The command leaves `git status --porcelain` and the metrics directory's listing unchanged.
  - `interlock limits --json` carries `minSuggestChanges` and `staleCheckGates`.
  - An unknown flag exits non-zero naming it.

  Owned by 2.6. Verify: `node --test test/spine/review-policy-suggest-cli.test.mjs` fails.
- [x] 1.7 Create `test/spine/requirement-wording.test.mjs` with failing tests for spec `spec/requirement-wording`.
  - **Pure tests:** `eventually` at a known line is flagged with its line, reason and a `message` beginning `WORDING:`; `Eventually` matches; `improperly` and `every` do not; a backticked `etc.` and a double-quoted `if possible` are not flagged; a `## REMOVED Requirements` block and heading lines are not read; the list holds exactly the seven phrases.
  - **CLI tests:** `interlock validate <change> --json` in a temporary repository carries `wording`, prints the message in text mode, and leaves `ready`, `problems` and the exit code as without the phrase. A change with no phrase carries `wording: []`.

  Owned by 2.7. Verify: `node --test test/spine/requirement-wording.test.mjs` fails.
- [x] 1.8 In `test/evals.test.mjs`, add `artifact-gate-recall-merge-verdict`, `artifact-gate-recall-shared-writer` and `artifact-gate-clean-pin-list` to the expected-case list at `:94`. Add failing tests for spec `evals/case-suite`'s new requirements:
  - each case declares a scaffold, `exercises` naming `skills/review-artifacts/SKILL.md`, only deterministic grader types, no smoke tag, and `max_turns` and `timeout_seconds`;
  - the merge-verdict case's provenance names `add-merge-confidence-gate`, `2026-10-12` and "All-green MERGE is required and forbidden";
  - the shared-writer case holds `seed.patch`, and its scaffold applies it with a check first;
  - each grader's regex matches a recorded passing text and misses a recorded failing text, both written in the test. For the pin-list case the failing text is a blocker about an incomplete pin list, and the passing one is a blocker on another ground, followed by a `SUMMARY:` line. The pin-list grader gives the same answers compiled with and without the `m` flag, and fails a text with no `SUMMARY:` line (D34).

  Owned by 2.8. Verify: `node --test test/evals.test.mjs` fails on the new tests.

## 2. Make §1 green, and carry the prose

- [x] 2.1 Create `lib/line-diff.mjs`: a pure line diff with head and tail trimming, a longest-common-subsequence middle, hunks with two context lines, and current and snapshot ranges. Create `lib/artifact-snapshot.mjs`, which holds:
  - the pure payload builder, the validating reader and the comparison that yields per-file hunks, added and removed files, unchanged files and the rework share (design §1–§2);
  - `snapshotForGate(root, flags)`, which checks `--stage artifacts`, `--metrics` and a `--findings` path, reads the change's files from `openspec/changes/<name>/` as given, and writes `snapshots/<findings name>`, answering `{ written, path, reason }` or `null` when its conditions are not met.

  Stdlib only. Verify: `node --test test/spine/line-diff.test.mjs test/spine/artifact-snapshot.test.mjs` passes.
- [x] 2.2 Wire the snapshot and the record's `findings` into the gate. This depends on 2.1's `snapshotForGate`.
  - In `cli/interlock`'s `gate` case, call `snapshotForGate` after the metrics write, warn on standard error on a failed write, and add `snapshot` to the JSON only when it answered. That is dispatch only.
  - In `lib/metrics.mjs`, `recordFieldsOf(flags, warn, root)` adds `findings` (design §3), and `writeReviewMetrics` copies it. The other two writers record `null`.
  - Update `test/spine/metrics.test.mjs:48` to nine keys, naming the requirement "A gate's review-metrics record SHALL name the findings file it read, or `null`".

  Verify: `node --test test/spine/gate-snapshot.test.mjs test/spine/metrics.test.mjs test/spine/package.test.mjs` passes, and `node --test --test-name-pattern "gate" test/spine/cli.test.mjs` still passes.
- [x] 2.3 In `lib/findings.mjs`'s `evaluateGate`, add the citation rule for artifact blockers, a `cause` on every `malformed` entry, and the `autonomyOutcome.blockers` count (design §6). In `lib/ready.mjs`, have `readFindings` keep the malformed causes and the `REVIEW_FINDINGS_MALFORMED` reason name each one (D29). Check `paths.findings` in `test/spine/cli.test.mjs` against the pin at `:722-723` and update the fixture only if it holds an uncited artifact blocker, under the bounded pin rule. Verify: `node --test test/spine/findings.test.mjs test/spine/ready.test.mjs` passes, and `node --test --test-name-pattern "gate" test/spine/cli.test.mjs` passes.
- [x] 2.4 Add the scoped re-gate to the brief. This depends on 2.1's comparison.
  - In `lib/review-cli.mjs`'s `briefArtifacts`, read `snapshots/<basename of --since>` beside the `--since` file, compare, and pass a `changedSince` to the assembler, or one of the fallback reasons.
  - In `lib/prompts/artifact-review.mjs`, print the `RE-GATE:` forms, the `RE-GATE REWORK:` line and the `Changed since <file>` data block (framed with `quoted` and `escapeFrame`) as the first data block, after every lens and before the policy block (design §2, D28), name it in the module's part-order comment, and add `passage` and the citation sentence to the emit shape.
  - Add `LIMITS.maxRegateReworkPercent` (value per D3) to `lib/limits.mjs`, with its JSDoc and its `interlock limits` row. Its one reader is `briefArtifacts`.
  - Add a `changedSince` sample to the assembler's `PROMPTS` entry in `lib/prompts/index.mjs`.

  Verify: `node --test test/spine/artifact-brief.test.mjs test/spine/prompt-integrity.test.mjs test/spine/limits.test.mjs` passes.
- [x] 2.5 Create `lib/review-policy-suggest.mjs`: the pure window filter, the T1–T4 triggers, the stale and unquoted lists, the text format and the summary line (design §4). It takes plain inputs and the caps as arguments, and reads no `LIMITS` itself. `evaluateGate` is imported to decide whether a joined gate passed. Verify: `node --test test/spine/review-policy-suggest.test.mjs` passes.
- [x] 2.6 Create `lib/review-policy-cli.mjs` and wire `interlock review-policy suggest`. This depends on 2.5's module, and on 2.2's `findings` field, which the join test records through `interlock gate`.
  - `lib/review-policy-cli.mjs` reads the window from `git log -1 --format=%cI HEAD -- REVIEW.md`, the compound notes, the artifact records from the report's corpus home and their findings files, the archived ledgers, and the HEAD policy. It passes `LIMITS.minSuggestChanges`, `LIMITS.staleCheckGates` and `LIMITS.maxArtifactChecks` to the pure module, and prints the text, JSON or summary.
  - Add both caps (values per D3) to `lib/limits.mjs`, with their JSDoc and `interlock limits` rows.
  - Delegate from `cli/interlock`'s `review-policy` case on `suggest`, and add its usage and help lines (dispatch only).
  - Add `'review-policy suggest': ['all', 'summary']` to `lib/cli-flags.mjs`, and the verb to the smoke INVENTORY in `test/spine/cli-inventory.test.mjs`.

  Verify: `node --test test/spine/review-policy-suggest-cli.test.mjs test/spine/cli-inventory.test.mjs test/spine/cli-arguments.test.mjs test/spine/limits.test.mjs test/spine/package.test.mjs` passes.
- [x] 2.7 Create `lib/requirement-wording.mjs`: the frozen seven-phrase list with reasons, and `lintWording(path, text)` over ADDED and MODIFIED blocks, skipping headings, fences, backtick spans and double-quoted text (design §5). In `lib/artifacts.mjs`, `inspectChange` returns `wording` over its delta spec files, and `formatInspection` prints each `message`. `ready` and `problems` are untouched. Verify: `node --test test/spine/requirement-wording.test.mjs test/spine/artifacts.test.mjs` passes.
- [x] 2.8 Create the three case directories under `evals/`, each with `case.yaml`, `scaffold.sh` and `graders/*.md`, following `evals/review-recall-pr28` and the table in design §7:
  - `artifact-gate-recall-merge-verdict`, with four graders of weight 1, one for each blocker D33 confirmed at `4966355`;
  - `artifact-gate-recall-shared-writer`, with `seed.patch` and one grader;
  - `artifact-gate-clean-pin-list`, with one narrow negative grader that opens with `(?<![\s\S])` and requires the `SUMMARY:` line, and a prompt that asks for that line (D34).

  Each prompt asks for every finding with its severity, file and line, ending with the review's `SUMMARY:` line.

  Every sha is the full 40-hex one from design §7, and each scaffold fetches every sha it checks out or restores from. Verify:
  - `node --test test/evals.test.mjs` passes;
  - `bash -n` passes on each `scaffold.sh`;
  - `git show 4966355:<path>` still shows each passage a merge-verdict grader names (D33);
  - in a scratch copy built from the two shas with `git show`, `git apply --check evals/artifact-gate-recall-shared-writer/seed.patch` succeeds.
- [x] 2.9 In `skills/review-artifacts/re-gate.md`, split step 2 into the snapshot branch (`Changed since`, raise a new finding only in a `changed hunk`) and the git fallback (when the `RE-GATE:` line says no snapshot could be used), keeping `Re-check each earlier blocker`. In `skills/review-artifacts/SKILL.md`'s emit section:
  - name `passage` in the JSON example and the field sentence: "`line`, `passage` and `suggestion` are optional, but a blocker carries a `line` or a `passage`";
  - say that an uncited blocker is reported under `malformed`.

  Add a test in `test/skills.test.mjs` pinning the tokens `Changed since`, `changed hunk`, `RE-GATE:`, `git diff -- openspec/changes/<change>/` and `Re-check each earlier blocker` in `re-gate.md`, and `passage` and `malformed` in the emit section. Update any pin on the old optional-fields sentence under the bounded pin rule. Verify: `node --test test/skills.test.mjs test/spine/artifact-rubric.test.mjs` passes.
- [x] 2.10 In `skills/spec/SKILL.md` §4, after the validate line, print each `wording` entry's `message` verbatim as a warning that never stops the run, and print `WORDING: not reported by this CLI` when the field is absent. In §6, before the checkpoint card, add a fenced `interlock review-policy suggest --summary` line: print its output verbatim, nothing when it prints nothing, and `REVIEW POLICY SUGGEST UNAVAILABLE: <first line of its output>` on a non-zero exit, then continue. This depends on 2.6, whose flag set the CLI-argument tests hold this line to.
  - Add a test in `test/skills.test.mjs` pinning `wording`, `message`, `WORDING: not reported by this CLI`, `interlock review-policy suggest --summary` and `REVIEW POLICY SUGGEST UNAVAILABLE:`.
  - Add the new fenced line verbatim to `UNREAD_BY_NAME` (`test/spine/spec-meter.test.mjs:775-781`) under the bounded pin rule.

  Verify: `node --test test/skills.test.mjs test/spine/spec-meter.test.mjs test/spine/cli-arguments.test.mjs` passes.
- [x] 2.11 In `skills/settle/SKILL.md` §11, after the drift findings and before the archive line, add the fenced `interlock review-policy suggest --summary` line, with the same print, nothing-when-empty and `REVIEW POLICY SUGGEST UNAVAILABLE:` rule. This depends on 2.6.
  - Add a test in `test/skills.test.mjs` pinning the line and the unavailable token in the settle skill.
  - Add a guard test in `test/spine/settle-meter.test.mjs`: a pass whose summary line follows its drift line keeps the `endedAt` the drift line set, and the skill-lines pin passes with the line keyed as the existing `review-policy` kind.

  Verify: `node --test test/skills.test.mjs test/spine/settle-meter.test.mjs test/spine/cli-arguments.test.mjs` passes.
- [x] 2.12 Document the change:
  - `docs/07-cli-and-configuration.md`: `review-policy suggest` and its flags, the gate's `snapshot` key, the record's `findings`, and the validate `wording` field;
  - `docs/12-repository-review-policy.md`: the four triggers, the window, and that the owner writes `REVIEW.md`;
  - `docs/14-evals.md`: the three artifact-gate cases, with no count and no threshold value;
  - `docs/10-agentic-workflow-ship-and-spec.md:429`: no longer says no case touches `review-artifacts`;
  - `docs/16-upgrading.md`: the older-CLI rows from the design's rollback paragraph;
  - `CHANGELOG.md` under `[Unreleased]`.

  No numeric threshold is restated. Verify: `npm test` passes, and `grep -n "maxRegateReworkPercent\|minSuggestChanges\|staleCheckGates" docs/*.md` shows names only, never a value.

## Workflow follow-up

- Archive `brief-and-record-the-artifact-gate` before archiving this change (design §8, D27).
- After this ships, the first two real `--since` re-gates should be read for whether the `Changed since` block kept new findings inside the hunks.
- The first metered run of the three cases gives the gate's first recall reading. Record it beside the D1 trial's comparison of depths.
