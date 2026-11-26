# Design

## Context

See `proposal.md` (Why) for the motivation. The explore brief, `.claude/handoff/explore-scope-suggest-and-evaluate-the-artifact-gate-20261125-163050.md`, holds the evidence. The 2026-11-25 report it builds on is local and gitignored, so the figures this design depends on are restated here. This change is items 3–6 of the report's §9.4 split, done as one change at the owner's request (D1). It stays inside the published width caps: 6 delta capabilities and 20 tasks.

**What the previous change gives.** `brief-and-record-the-artifact-gate` is committed (`fe07cea`) but not archived (D27). It gave:

- `interlock review brief --artifacts <change> [--since <file>]`, handled by `briefArtifacts` in `lib/review-cli.mjs:526-715`;
- the record fields `stage`, `depth`, `reviewer` and `lenses` (`lib/metrics.mjs`);
- the optional `check` tag in the emit shape;
- `REVIEW.md` `## Artifact Checks`, read from HEAD and numbered `review-md.<n>` in file order.

**The gate.**

- `case 'gate'` (`cli/interlock:3385-3436`) reads `--findings` (a path or `-`), runs `evaluateGate` (`lib/findings.mjs:345-405`), and writes a record only under `--metrics <change>`, into `corpusHome(root, flags).home/.claude/metrics`. It never resolves the change's directory.
- The skill's gate line passes `--metrics <change> --stage artifacts` (`skills/review-artifacts/SKILL.md:106`).
- A malformed finding is never counted, and `passed` needs none outstanding. `line` is never validated, and no `passage` field exists. `flatten` copies the file's top-level `dimension` onto each finding (`:156-175`).
- Review-code also calls the gate (`skills/review-code/SKILL.md:217,337`).
- `record()` treats `blockers: 0` as a clean run (`lib/autonomy.mjs:119-134`).

**`.claude/metrics/` has three readers, and git does not track it** (`.gitignore:22`):

- `digestMetrics` (`lib/report.mjs:313-375`) parses each top-level `*.json` file;
- `newestFindingsFile` (`lib/checkpoint-cli.mjs:35-47`) uses an anchored name regex;
- the spec meter matches a path regex (`lib/spec-meter.mjs:423`).

**`--since` today.** `briefArtifacts` only checks that the `--since` file exists. The bundled `skills/review-artifacts/re-gate.md` then tells the reader to `git diff` the change and read untracked files whole. A change is uncommitted at gate time, so `git status` reports `?? openspec/changes/<change>/` and `git diff` prints nothing (probed for the report), and the re-gate reads everything.

**The evidence `review-policy suggest` can read.**

- Code-review and settle findings are not kept. Settle's records are transient, under `.claude/ship/settle/`. The one durable trace of an escape is `docs/notes/compound.md` (`lib/notes.mjs:22-25`), whose `rule` is the finding's suggestion copied as-is (`deriveNotes`, `:246-270`).
- Findings files carry severities but no reader. Records carry the reader but no severity and no findings path, and their time stamps use another format.
- 53 archived ledgers hold 845 rows, and 85 of them cite a human decision or the owner.

**The size budget.** `cli/interlock` is 243,355 bytes, and the headroom pin fails above 245,760 (`test/spine/package.test.mjs:392,398,435-445`). That leaves 2,405 bytes.

**Evals.**

- The template is `evals/review-recall-pr28`: a scaffold fetches 40-hex shas from origin, and regex graders check file plus keyword.
- `evals promote` already reads pass^k (`lib/evals-promote.mjs:165-190`).
- One cost ceiling bounds the whole full job (`EVAL_CAPS`, `lib/limits.mjs:403-408`; `.github/workflows/evals.yml`).
- With no credential, metered jobs skip and the run is still green.
- Of 33 blocker-bearing findings files, about one has its pre-fix artifacts in git. `4966355` holds `add-merge-confidence-gate` as its 2026-10-12 gate read it, and the blocker "All-green MERGE is required and forbidden" is visible at `specs/review/merge-confidence/spec.md:9` against `:142`.

## Goals / Non-Goals

**Goals:**

- A re-gate that reads only what changed since the earlier gate, committed or not, says how much changed, and falls back aloud.
- An exact join between who read a change and what they found, so later readers of the corpus need no guesswork.
- A read-only list of `REVIEW.md` candidates, each with evidence, surfaced where a person already looks.
- The first model-in-the-loop measure of the gate's recall, and of one known false blocker.
- A deterministic wording check that reaches the author before the gate.
- A blocker a person can check.

**Non-Goals:**

- No automatic re-gate, and no second gate in a spec run. The rework bound prints a line and widens nothing (D9).
- No command that turns a snapshot and its findings into an eval case. This change starts writing the snapshots such a command needs; the command is a follow-up.
- No check that a cited `passage` really occurs in its file (D21).
- No change to code-review findings or skeptic verdicts. That is the open brief `put-a-failure-scenario-on-every-finding` (D2).
- No edit to `REVIEW.md`. The owner writes it (report D4).
- No cost-ceiling change for evals (D24).
- No change to the lenses, the base rubric or the brief's other parts.

## Decisions

The ledger ids in `decisions.md` are cited inline. D1–D3 were carried from the explore brief.

### 1. The snapshot (D4, D5, D6)

**Who writes it (D4).** `interlock gate` writes the snapshot, and only when it is given `--stage artifacts`, `--metrics <change>` and a `--findings` path. That is the skill's gate line as it stands, so the snapshot needs no new flag, and the skill's `unknownFlag` rerun, which drops the four recording flags, is unchanged. An older gate given the same line writes no snapshot, and a later `--since` then falls back aloud (§2).

- *Alternative rejected:* writing it from the brief. The brief prints the state the reader reads, but it runs before the session names the findings file, so it cannot write the snapshot under that name.
- *Alternative rejected:* a `--snapshot` flag. It adds a sixth flag to the set the fallback must drop, for no gain.

**The change directory.** The gate takes `openspec/changes/<metrics name>/` as given, never fuzzy-resolved: the record's change is the name the line passed (`review/metrics-emission`, "never to an inferred one"). A directory that does not exist gives `snapshot.written: false` with the reason.

**What it holds (D5).** It covers `proposal.md`, `design.md`, `tasks.md`, `decisions.md` when present, and every `.md` under `specs/`, which is the set the brief scopes. The file is JSON:

```json
{ "schema": "interlock.artifact-snapshot/1", "change": "x",
  "findings": "review-artifacts-x-20261125-120000.json", "takenAt": "<ISO>",
  "files": [{ "path": "design.md", "sha256": "<hex>", "text": "<whole file>" }] }
```

Each file's text is copied, not only its hash, because the brief has to print the hunks, and a hash can only say that a file changed.

**Where it lives (D5).** It is written to `join(dirname(findings), 'snapshots', basename(findings))`. All three readers of the metrics directory miss a subdirectory: `digestMetrics` lists top-level `*.json` names, and the other two match anchored names. So the report's counts and the checkpoint's newest findings file are unchanged.

- *Alternative rejected:* a sibling named `….snapshot.json`. The report would list it as `unrecognized`, and it would inflate the report's total.

**A failed write (D6).** It prints one standard-error warning, and sets `snapshot: { written: false, path, reason }` in the JSON. The verdict, the exit code and every other field are untouched. This follows the review-metrics rule ("report their own write failures and never touch the exit code", `.claude/CLAUDE.md`): a snapshot is bookkeeping for a later re-gate, and the gate's verdict does not depend on it. The JSON carries no `snapshot` field when the conditions for writing one were not met, so a code-review gate line's output is byte-for-byte what it was.

**Code.** The pure parts live in `lib/artifact-snapshot.mjs` (new): building the payload, validating a payload read back, and comparing it with the current files. So does one I/O helper, `snapshotForGate(root, flags)`, which checks the conditions, reads the files and writes the file. The `gate` case adds only that call and its JSON key (D26).

### 2. The scoped re-gate (D7, D8, D9, D10, D28, D31)

**The diff (D10).** `lib/line-diff.mjs` (new, pure, stdlib only) compares two line arrays with a longest-common-subsequence diff. It trims the common head and tail first, so a typical edit compares only the changed middle. It returns hunks, each with up to two unchanged lines of context on either side, and merges hunks whose contexts touch. Every hunk names the range of its changed lines in the current file and in the snapshot (D31). Its context lines are printed, marked as unchanged, and fall outside both ranges, so an edit of lines 40–44 names 40–44 while printing 38–46. A side with no changed lines, such as a pure removal, names the line it follows: `after line <n>`, or `before line 1`. No diff exists in `lib/` today: the only hunk code parses `git diff -U0` output (`lib/review-scope.mjs`), and the repository takes no dependency.

**What the brief does under `--since`.** `briefArtifacts` reads `snapshots/<basename of --since>` beside the `--since` file:

- **It is readable and names the same change.** The brief compares each snapshot file with the current one:
  - a file present in both is diffed;
  - a file only in the change is added, and its whole text is one hunk;
  - a file only in the snapshot is removed, and is named.

  The opening block's line becomes `RE-GATE: since <file>; <share>% rework (<a> line(s) added, <r> removed; <k> of <n> file(s) changed)`. With nothing changed, it becomes `RE-GATE: since <file>; nothing changed since that gate`. A data block, `Changed since <file>`, is the first of the quoted data blocks (D28): it follows the re-gate rules and every selected lens, and precedes the `REVIEW.md` prose. That keeps the part order `spec/artifact-review-brief` requires, where every data block follows the lenses, and `test/spine/artifact-brief.test.mjs:280` ("every data block follows the lens") passes unchanged. It lists each changed file's hunks, framed by the same `quoted` helper and `escapeFrame` as every other data block, then the added and removed files, then the unchanged files by name.
- **It is absent, unparseable, of another schema, or of another change (D7).** The line becomes `RE-GATE: since <file>; <no snapshot beside it | snapshot unreadable — <reason> | snapshot is of <other change>>; the re-gate rules' git scoping applies`. No `Changed since` block is printed, and the brief exits 0. Git scoping is right for a committed change, and it is today's behaviour, so an older findings file re-gates as it would have yesterday.

**The rework share (D8).** It is `round(100 × max(added, removed) / max(linesBefore, linesAfter))`, summed over the change's files, and 0 when both totals are 0.

- Rewriting 10 lines of a 100-line change reads 10%.
- Appending 10 lines reads 9%.
- Deleting everything reads 100%.

*Alternative rejected:* `(added + removed) / (before + after)`. It halves an append, and reads 10 appended lines as 5%.

**The bound (D9).** `LIMITS.maxRegateReworkPercent` is read by `briefArtifacts`, the only reader, as the cap-authority sweep requires (`test/spine/limits.test.mjs:243-315`). Over it, the opening block adds:

```
RE-GATE REWORK: <share>% of the change differs from the snapshot of <file>, over the <bound>% bound; a full gate is the owner's call
```

Nothing else changes: the brief still carries the scoped rules and the hunks. Fagan re-inspected everything past 5% (report [S5]), but here the one-gate rule (`skills/spec/SKILL.md` §5) holds. A full gate is a person's call, and the line hands them the figure. The value is the owner's (D3).

**The re-gate rules.** `skills/review-artifacts/re-gate.md` step 2 becomes two branches. When the brief carries a `Changed since` block, those hunks are what changed, and a new finding is raised only in a changed hunk. When the `RE-GATE:` line says no snapshot could be used, the existing `git diff -- openspec/changes/<change>/` and untracked-file text applies. Step 1 (re-check each earlier blocker) and step 3 are unchanged, and the pinned tokens `Re-check each earlier blocker` and `changed hunk` stay.

**Registration.** `assembleArtifactPrompt` gains an optional `changedSince` input, holding the line, the hunks and the file lists. Its block goes at the head of the data-block list, ahead of the policy block, and the module's part-order comment names it in part 6. `lib/prompts/index.mjs` gains a third sample input with a `changedSince`, so `test/spine/prompt-integrity.test.mjs` assembles it.

### 3. The record names its findings file (D11)

`recordFieldsOf(flags, warn, root)` adds `findings`, which is `flags.findings` made relative to `root` with `/` separators when it names a file inside `root`, and `null` otherwise (`-`, outside the root, or no flag). `writeReviewMetrics` copies it by name, like the other four. `interlock review --metrics` and the ship run's review step write `findings: null`.

The schema id stays `interlock.review-metrics/1`, for the reason the previous change kept it (its D6): the field is additive, and an older reader ignores it. A path is metadata, not finding text, so the module's "counts, not content" header still holds.

- *Alternative rejected:* joining by change and nearest time. Findings files are stamped in local `YYYYMMDD-HHMMSS` and records in ISO UTC, so a near-time join is a guess. Two gates of one change minutes apart, which is the T2 pattern, are exactly where it would guess wrong.

### 4. `interlock review-policy suggest` (D12–D17, D26, D30, D32)

**Code (D26).**

- `lib/review-policy-suggest.mjs` (new, pure) takes plain inputs and the caps, and returns `{ window, candidates, stale, unquoted, sources }`. It also formats the text and the summary line.
- `lib/review-policy-cli.mjs` (new) does the I/O.
- `case 'review-policy'` delegates when `positional[1] === 'suggest'`, as `note` delegates to `noteCommand` (`lib/note-cli.mjs:22-88`). `lib/cli-flags.mjs` gains `'review-policy suggest': ['all', 'summary']`, and the smoke inventory (`test/spine/cli-inventory.test.mjs:481-502`) gains the verb.

**The window (D16).** The window opens at `git log -1 --format=%cI HEAD -- REVIEW.md`.

- Compound-note rows and archived ledgers carry a day, and count when that day is on or after the window's day. Records carry a time, and count when it is at or after the window's time.
- With `--all`, no such commit, or no commit at all, the window is open, and the output says which.
- Revising `REVIEW.md` is the owner acting on the evidence, so the list shrinks when the owner acts.
- `review-md.<n>` numbering follows file order (previous change, D19). A window that resets on every `REVIEW.md` commit never counts a tag across a renumbering.
- *Alternative rejected:* no window. The 85 owner rulings already archived would make the checkpoint line permanent.

**The sources.** Each has a status line, and each degrades aloud:

- `docs/notes/compound.md`, through `parseNotes`. It reports absent, unreadable rows, or the rows read.
- Review-metrics records, from the same corpus home `interlock report` reads, with `stage: 'artifacts'`, each joined to the findings file its `findings` names (§3). Records that name no findings file and findings files that cannot be read are counted, never joined another way.
- `openspec/changes/archive/<date>-<change>/decisions.md`, through `parseLedger`. The directory's date dates the rows.
- `REVIEW.md`'s Artifact Checks at HEAD, through `reviewPolicyAt(root, 'HEAD')`. With no commit, they are not read, and the line says so, as the brief's line does.

**The triggers:**

| Trigger | Candidate when | Evidence printed |
|---|---|---|
| T1 (D12) | compound-note rows for one canonical `file` come from at least `minSuggestChanges` distinct changes | each row's id, date, change and rule |
| T2 (D13, D32) | for one change, a joined gate that passed is followed by the next joined gate of that change holding a blocker, and the two readers' `depth` or `reviewer` differ, both recorded. One candidate per change, however many such pairs it holds | every qualifying pair, in gate order: both findings files, both readers, the later blocker titles |
| T3 (D14) | blockers carrying one `check` tag come from at least `minSuggestChanges` distinct changes | each change, findings file and blocker title |
| T4 (D15) | an archived ledger row's evidence holds `human decision` (case-insensitive) | change, id, question, resolution |
| stale (D30) | `review-md.<n>` is within `maxArtifactChecks`, the window holds at least `staleCheckGates` joined gates, and no finding of theirs, at any severity, carries that tag | the check's number, text and the gates read |
| unquoted (D30) | `review-md.<n>` is past `maxArtifactChecks`, so no brief quoted it | the check's number and text |

Each choice in the table:

- **T1 groups by file, not by rule (D12).** A rule is a finding's suggestion copied as-is, so two rows almost never share a rule's text. A file that escapes the spec in several changes is the signal code can see.
- **T2 decides "passed" by running `evaluateGate`** over the joined findings file, with the default band and no dismissals.
- **Stale reads only the checks a brief quotes (D30).** The brief quotes `review-md.1` to `review-md.<maxArtifactChecks>`. A check past the cap was never shown to a reader, so its silence says nothing, and calling it stale would be true by construction. It is listed under `unquoted` instead. The summary leaves `unquoted` out, because the brief's policy line already counts the checks it left out.
- **T4 reads the human-decision cite (D15)** that `shared/DECISION-LEDGER.md` prescribes for an answered row ("cite the human in evidence (for example `human decision 2026-08-12`)"). Whether a ruling applies beyond its change is the owner's reading of the list.
  - *Alternative rejected:* a heuristic over normative words. It is noisy.
  - *Alternative rejected:* a new ledger tag. It would change a shared contract.

**The caps (D3).** `LIMITS.minSuggestChanges` and `LIMITS.staleCheckGates` land with their reader, `lib/review-policy-cli.mjs`, which passes them to the pure module. It passes `LIMITS.maxArtifactChecks` too, as a second reader of that cap; the cap-authority sweep asks each cap for a reader, not a sole one.

**The output.** The text output opens with:

```
REVIEW POLICY SUGGEST: <c> candidate(s), <s> stale — evidence since <date> (REVIEW.md at <sha7>)
```

That line is followed by one block per candidate, the stale list, the unquoted list, and one status line per source. `--json` returns the object. `--summary` prints `REVIEW.md candidates: <c+s> — interlock review-policy suggest` when that sum is above 0, and nothing otherwise. The command exits 0 in every case except a usage error.

**Print sites (D17).** The spec skill's §6 hand-off and the settle skill's §11 close each run `interlock review-policy suggest --summary` and print its output verbatim. On a non-zero exit, including an older CLI refusing `--summary`, they print `REVIEW POLICY SUGGEST UNAVAILABLE: <first line>` and go on.

- *Alternative rejected:* putting the count in the checkpoint card. The card is drawn Node-free by the spec meter from the fields it holds (`hooks/spec-meter`, "SHALL read no artifact"), and `interlock checkpoint` is specified to read "the change's own files" (`spec/checkpoint-card`). A repository-wide read in either would change both requirements, and settle has no card.

**The meters (D25).** The spec meter does not key the new fenced spec line, so it joins `UNREAD_BY_NAME` (`test/spine/spec-meter.test.mjs:775-781`), as the previous change's routing lines did. The settle meter keys any `interlock review-policy` stage as its existing `review-policy` kind, a bare row (`lib/settle-meter.mjs` `WORD_KINDS`, `BARE_WORDS`), so its skill-lines pin passes with no new kind. A guard test pins that a summary line after the drift line leaves the pass's `endedAt` as the drift line set it.

### 5. The wording lint (D18, D19, D35)

**The corpus run, the owner's precondition (D19).** The seven phrases were counted over 97 living spec files and 330 archived delta spec files. There was one hit, `etc.` inside backticks in a scenario that quotes it as a banned phrase (`openspec/specs/spec/task-granularity/spec.md:55`, and its archived twin), which is a false positive. Of 22 wider candidate words, the few hits (`sufficient`, `fast`, `as needed`, `as required`) were each legitimate: a negated assertion, a test-input literal, a flag name. The list is therefore the report's seven, unwidened. The lint skips backtick spans and double-quoted text, which removes the one false positive, and skips headings, fences and `## REMOVED`/`## RENAMED` blocks. Archived proposals, designs and tasks were not scanned, because the lint does not read them.

**Where it runs (D18).** `lib/requirement-wording.mjs` (new, pure) exports the frozen list, each phrase with its reason, and `lintWording(path, text)`, which returns `{ file, line, phrase, reason, message }` entries. Line numbers come from splitting the file's own lines, because `parseSpec` keeps no per-line body (`lib/spec-text.mjs:144-257`). `inspectChange` (`lib/artifacts.mjs:438-497`) runs it over the delta spec files it already lists, and returns `wording`. `formatInspection` prints each `message`. `ready` and `problems` are never touched, as `width` never touches them. The spec skill's §4 prints the messages after the validate line, and prints `WORDING: not reported by this CLI` when the field is absent, as it does for `width`.

**Text a MODIFIED block keeps (D35).** A MODIFIED block restates the whole requirement, so a vague phrase already in the living text is flagged in every change that modifies that requirement. That is on purpose: the MODIFIED text is what the living spec reads after archive, so the phrase is still a defect there, the author is already rewriting that requirement, and the entry never blocks.

*Alternative rejected:* the report's "warnings into the findings file". The CLI does not write that file, because the session does (`skills/review-artifacts/SKILL.md` emit section). Merging CLI hits into the gate's input would also put a deterministic source inside the reader's counts, which the previous change splits by depth and reader so the D1 trial can compare them. The wording check belongs before the gate, where the author can still fix it.

### 6. Cited blockers (D2, D20, D21, D29)

**The rule.** In `evaluateGate`'s severity loop (`lib/findings.mjs:364`), a finding whose resolved severity is `blocker` and whose `dimension` is `artifacts` is checked for a citation. It is cited when `Number(f.line)` is an integer of at least 1, or when `f.passage` is a non-empty string after trimming. An uncited one goes to `malformed` with `cause: 'citation'` and the reason `an artifact blocker names neither a line nor a passage, so a person cannot check it`, and is not counted (D20). The existing severity entry gains `cause: 'severity'`. Findings without that dimension are untouched, so review-code's gate lines behave as before (D2).

**The autonomy count.** `autonomyOutcome.blockers` counts the cited blockers plus the uncited artifact blockers (D20). Without that, a gate failed only by an uncited blocker would hand `--blockers 0` to `interlock autonomy record`, which counts zero as a clean run (`lib/autonomy.mjs:119-134`). A malformed severity is still not counted, as today.

**Readiness names the cause (D29).** `readFindings` in `lib/ready.mjs` keeps the causes of the gate's `malformed` entries, and the `REVIEW_FINDINGS_MALFORMED` reason names each one it saw: a severity outside the defined set, an artifact blocker that cites no line or passage, or both. Today's reason names the severity alone, so it would misreport an uncited blocker. The verdict is unchanged, because any malformed finding already blocks readiness.

- *Alternative rejected:* keeping the blocker and adding an `uncited` list. It is simpler, but the claim stays verdict-grade with nothing to check, which is what R9 exists to stop. Both options hold the gate, so neither can pass what the old gate blocked.

**Presence only (D21).** The gate checks that a citation exists. It does not check that a `passage` occurs in its file, because the gate reads no repository file today.

**The emit contract.** The brief's emit shape (`lib/prompts/artifact-review.mjs`) and the skill's emit section both name `passage`, "a short verbatim quotation of the artifact text the finding is about". Both say that a blocker carries a `line` or a `passage`, and that an uncited blocker is reported as malformed. The skill's sentence "`line` and `suggestion` are optional" becomes "`line`, `passage` and `suggestion` are optional, but a blocker carries a `line` or a `passage`".

### 7. The gate evals (D22, D23, D24, D33, D34)

Each case has `case.yaml`, `scaffold.sh` and `graders/*.md`. They follow `review-recall-pr28`: provenance, `exercises: ["skills/review-artifacts/SKILL.md", "lib/prompts/artifact-review.mjs"]`, no smoke tag, `max_turns` and `timeout_seconds`, `allowed_tools: [Skill, Agent, Bash, Read, Write, Glob, Grep]`, and regex graders only.

| Case | Workspace (40-hex shas, fetched from origin) | Graders |
|---|---|---|
| `artifact-gate-recall-merge-verdict` | detached at `496635588f0d11ae9505970b12313d2542f4a1a9`, where `add-merge-confidence-gate` is an active change | one per known blocker of the 2026-10-12 gate: the all-green `MERGE` contradiction (`spec.md:9` against `:142`), a blocking kind with no result read as both unobserved and amber (`:103`), `conformance.delta` with no requirement (`:269`), and the failed final typecheck that never reaches the suite signal (`design.md:85`). All four were confirmed in the `4966355` tree (D33) |
| `artifact-gate-recall-shared-writer` | detached at `234906b4861c7ef58a07fbdcc164085568bcaf1d`, with `openspec/changes/bound-the-reviewers-by-agent-type/` restored from `21f7a1b72fa6debc590dc37eb780fb1a98358411`, plus the case's `seed.patch`. The patch adds to `design.md` a step where parallel lanes each read, modify and rewrite one shared JSON file | one: a blocker naming that file and a concurrent writer or a lost update |
| `artifact-gate-clean-pin-list` | the same two shas with no patch. That change passed its one gate (2026-11-19), and its `tasks.md:3` states the bounded pin rule and calls its pin list incomplete | one: fails on a blocker whose title or text is about the pin list |

- **Why three (D22).** One real failure is all that git holds. The seeded case covers class D, harness hazards, which is the class the agentic-harness lens exists for and the largest class among the 54 blockers. The pin-list case encodes the one false-blocker class the corpus has. All three share two base commits, so the scaffolds are cheap.
- **A narrow negative grader.** A fresh reader of any change can find a real blocker, and failing the clean case on any blocker would make it flaky. The clean case fails only on the false blocker it encodes, and says why in its grader's prose.
- **Anchoring it (D34).** The pattern opens with `(?<![\s\S])`, which holds only at the start of the text with or without a multiline flag. An unanchored negative lookahead always matches at the end of the text, and a `^` under a multiline flag matches at every line. The pattern then requires the review's `SUMMARY:` line and refuses a pin-list blocker, so an output that never reviewed cannot pass.
- **Grading (D33).** Each grader has weight 1, as all 27 graders in the suite do. The spec asserts what each grader decides. How the harness turns grader scores into a trial pass is the harness's rule, and this change sets none. A recall reading reads each grader's result, so a missed contradiction shows whatever the other graders score.
- **The depth (D23).** Each prompt runs `/interlock:review-artifacts <change> --caller spec`, so the gate runs at the depth the CLI's caller table gives spec's own gate (previous change, §5). The prompt asks the model to report every finding with its severity, file and line, as `review-recall-pr28` does, and to end with the review's `SUMMARY:` line.
- **Cost (D24).** No ceiling changes. Each case is full-suite only, and the full job runs only when started by hand with a credential. The cases add metered trials under the one `fullRunCostUsd` ceiling, a value the owner already holds open. pass^k is the existing promotion reading. `docs/14-evals.md` names the cases and gives no count, and `docs/10-agentic-workflow-ship-and-spec.md:429` stops saying that no case touches `review-artifacts`.

### 8. Dependencies and order (D27)

- **Archive `brief-and-record-the-artifact-gate` before this change.** Every delta here is ADDED-only, so either archive order leaves the living specs consistent. But this change's requirements cite that change's brief, record fields and `check` tag. Not one requirement here MODIFIES a requirement that only exists in that change, because `openspec validate` would not find it, and a later archive would revert it.
- **Within this change**, tasks.md orders the work:
  - the pure modules first;
  - the gate's `findings` field before the suggest command's join test, which records through `interlock gate` (a `dependsOn` edge, since the files differ);
  - the skills after both commands exist.
- **R8's precondition** was met by the corpus run in §5.
- **R9 and the open brief** `put-a-failure-scenario-on-every-finding` both edit `lib/findings.mjs`, so whichever lands second rebases. The open brief's D1 (demote or report a code finding) is not decided here.

### 9. The byte budget (D26)

`cli/interlock` gains:

- the `snapshotForGate` call and its JSON key in the `gate` case;
- the `root` argument to `recordFieldsOf`;
- the `suggest` delegation and its import;
- the usage and help lines for `review-policy suggest [--all] [--summary]`.

The target is under 800 of the 2,405 bytes left. Every handler body lives in `lib/`. Each task that edits `cli/interlock` runs `node --test test/spine/package.test.mjs`.

## Risks / Trade-offs

- [Snapshots accumulate in `.claude/metrics/snapshots/`, one per artifact gate, each the size of a change's artifacts, tens of kilobytes] → that directory is gitignored and local, as the findings files are. Nothing reads old snapshots except a `--since` naming their findings file.
- [The rework share counts lines, so reflowing a paragraph reads as rework] → it is advice for a person, and the hunks show what moved.
- [`review-policy suggest` reads every record and archived ledger on each call, and the spec and settle skills call it once per run] → the corpus is local and small (183 files, 53 ledgers today). A cap is a later, measured decision.
- [T4 lists every owner ruling archived since the last `REVIEW.md` change, most of which are local to their change] → the owner reads and dismisses them by revising `REVIEW.md` or by leaving it alone. The count is a line at the hand-off, never a gate.
- [The R8 lint has no proven true positive in this repository] → it is advice that never blocks, it costs one regex pass per delta file, and its value is for consumer repositories. The owner may cut it at the checkpoint.
- [The eval cases add metered trials to a full job whose ceiling is already tight] → they are full-suite only, they run by hand, and no ceiling moves. If the ceiling stops a run, triage reads it as no signal, never as a regression.
- [The seeded case's patch must apply to the restored change] → the scaffold applies it with `git apply --check` first, and fails naming the patch if it does not apply.
- [An uncited blocker now reads `malformed`, a word the skill already tells the session to report] → the reason names the missing citation, and the skill's emit contract says a blocker needs one.

**Rolling it out and back.** It ships as one commit. Rolling back is a revert of that commit: the snapshot writer, the brief's diff, the record's `findings`, the suggest command, the lint and the citation rule leave together. Records already written with `findings`, and snapshots already on disk, stay readable by the reverted code, which ignores both. An older `interlock` with the newer skills degrades aloud. `--since` falls back to git scoping, `review-policy suggest --summary` prints the unavailable line, the validate line prints `WORDING: not reported by this CLI`, and an uncited blocker is a blocker again. `docs/16-upgrading.md` gains those rows.

## Open Questions

None. D3 was answered on 2026-11-25: the recommended 20, 2 and 10.
