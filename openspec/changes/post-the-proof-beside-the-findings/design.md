# Design

## Context

See `proposal.md` for the motivation. What shapes the approach:

- **A settle pass writes its evidence to files, and most of them are passed to nothing.** Under `.claude/ship/settle/`: `plan.json` (each step's kind and command, each skipped kind and its reason), `results.json` (exit code and counts per kind), `verify.json` (the judged verdict, bound to a head), `coverage.json`, `handoff.json` (the confirmation) and `review-r<n>.json`. `.claude/ship/pipeline.json` holds the platform's checks with a `sha`. The verdict reads five of them and prints one-line reasons.
- **The loop may post only what the CLI rendered** (`openspec/specs/review/settle-loop/spec.md:392-394`). `interlock settle comment` already has the machinery a second renderer needs: a head check (`requireHead`, `lib/settle-cli.mjs:241-248`), `inertSpan` for text the renderer did not write, and a fence no line can close (`fenced`, `lib/settle-cli.mjs:264-268`).
- **`results.json` is typed by the session.** `skills/settle/SKILL.md:439` tells it to write one `{ kind, exitCode }` entry per step "with the counts you can read". `interlock verify exec`, which runs the command, records `{ kind, exitCode, durationMs, command, at }` itself (`cli/interlock:4344-4349`), but to `.claude/ship/verify-timings.jsonl`, a file a ship run reads and removes (`lib/run.mjs:2493-2511`) and no settle pass clears.
- **The confirmation is five counts and a paragraph.** The briefing asks for nothing else (`lib/settle-cli.mjs:1096-1102`), and `readDeltaConformance` reads the two scenario counts as given (`lib/merge-confidence.mjs:720-736`).
- **One module already defines what a citation is**: `lib/locators.mjs`, shared by the review's skeptics and the wave handoff. It checks shape and path membership and deliberately never the line.
- **One module already says which changed paths are a screen.** `classifySurface` in `lib/surface.mjs` places every changed path in `UI-TESTABLE`, `UI-INDIRECT` or `NOT-UI-TESTABLE` by extension and directory name, with no setup. It was written because "this question used to be answered twice, in English prose, by two skills that disagreed" (`lib/surface.mjs:3-11`), and the manual test plan, the devops trigger and the ship handoff all read it. The explore brief looked for UI-path detection in four other files and did not find this one.
- **OpenSpec 2.0 warns on an added requirement whose description passes 500 characters**, so the new capability is written as nineteen small requirements, not three large ones.

## Goals / Non-Goals

**Goals:**

- One comment per pass, bound to the commit it assessed, that a person can approve from: the command, what it returned, the platform's checks, the scenarios confirmed and how, and what none of it would catch.
- Every figure in it is either one the CLI observed or one it marks as the session's.
- A confirmation counts only when it points at something that exists, and the verdict and the comment read the same checked counts.
- The comment cannot fail to post for its size, and never drops a row without saying so.

**Non-Goals:**

- No verdict, score, band or label in the comment, and no change to the merge-confidence block or its signals (D16).
- No screenshot is taken, uploaded or committed (D5), and no new list says which paths are a screen (D6).
- `interlock verify judge` still reads the results the session wrote; this change makes a disagreement visible and does not make the judge refuse one (D14).
- The ship run's own handoff keeps its five counts (D18), and the ship receipt does not feed the comment.
- The settle meter draws neither new command (D17).
- `--confidence-comment` stays as it is: opt-in (D20).
- The manual test plan stays its own optional comment; the validation comment does not parse it (D24).

## Decisions

### The comment is rendered, head-bound, and named for what it is (D1, D2, D8)

**D1.** The CLI renders the whole comment; the skill pipes it to the platform and types none of it. A model-written proof would repeat the weakness of today's `## Testing` and contradict the living requirement that the loop posts only CLI-rendered text.

**D2.** The comment is bound to `--head`. The verification verdict is the one required record, and a verdict that records another head, or none, is refused: exit 1, nothing printed, as `comment` refuses a review for another commit. Every optional record that carries a commit (`pipeline.sha`, `handoff.head`, `review.head`) is compared too, but a mismatch there does not refuse the comment: its section says the record describes another commit and shows nothing from it, and the gap section says so again. One stale optional record should cost its own section, not the whole comment.

**D8.** The command is `interlock settle validation`, not the brief's `interlock settle proof`. "Proof" already names the review's coverage proof: `interlock review proof` (`openspec/specs/review/review-proof/spec.md:143`), `proof.proven` and the findings comment's `REVIEW NOT PROVEN:` line (`lib/settle-cli.mjs:290-291`). A second `proof` in the same skill, one paragraph away from "review-code's proof re-run", would be read as the first. The command is named for the comment it renders, as `comment` and `replies` are.

*Alternative considered:* widen the confidence block to carry commands and output. Rejected in the brief (option A): the block states bands and reasons, and it is embedded in the description, where a forty-row table does not belong.

### What the comment reads, and what it refuses to claim (D4, D13, D14, D16, D23, D28)

**D13.** Exit codes and durations come from a new `--record <file>` on `interlock verify exec`. The settle skill's final verification names `.claude/ship/settle/exec.jsonl`; that directory is cleared at the start of each pass and only the final verification writes the file, so every line in it was appended by this pass's final verification on the pushed head. The renderer joins a plan step to the last record line with the same `kind` and `command`. `--summary` takes the same `--exec`, so the three lines under `## Testing` show the code the comment's row shows, with the same `session-recorded` and `RESULT DISAGREES:` marks. Without it a reader would see the session's exit code in the description and the observed one in the comment. The verdict's own copy of an exit code is shown by neither form. A disagreement or a halt changes no exit code of the command: it exits 0, because the comment that says so has to be posted.

*Alternative considered:* read the existing `.claude/ship/verify-timings.jsonl`. Rejected: it is shared with ship runs, which remove it mid-run, it also holds the fix rounds' entries, and nothing clears it between passes, so a line in it cannot be tied to this pass.

*Alternative considered:* show `results.json` alone. Rejected: the comment would then be CLI-rendered text of numbers the session typed, which is one step from what `## Testing` is today.

The counts (total, passed, failed, skipped) stay the judged verdict's, which come from `results.json`: only the runner's own output holds them, and no command of ours parses a runner's output. The exit code is the part the CLI can observe, so that is the part the comment checks, and the counts column is headed `as the session read them`. When the two exit codes differ the row shows the observed one and a `RESULT DISAGREES:` line names both.

The record holds one line per run. When a step has more than one, the row says how many runs there were, and an earlier run that exited non-zero is named in a `RE-RUN:` line and as a gap item: a suite re-run until it went green is something a person approving should see, and showing only the last line would hide it. A plan with no step, which is every pass in a project with no test profile, renders the kinds not run and says no command ran.

A duration is cut down, never rounded up: `1m 42s` for 102,300 ms and `8.3s` for 8,349 ms, so a run never reads longer than it took, and 59,960 ms reads `59.9s` and not a sixty-second form.

**D14.** `verify judge` does not read the exec record in this change. The judge is the ship run's judge too (`lib/verify.mjs:846-963`), and a judge that refuses a disagreeing result changes every ship run's verification, which is a change of its own. Until then a pass can read green on the verdict and carry `RESULT DISAGREES:` in its comment. That is a true alarm, said in the one place a person approving will read. See Open Questions.

**D4.** No test output is printed. A red unit verdict lists the failing test names its clusters hold; the cluster's representative failure text is never printed. A results entry's spill locator is shown, so a person can open the log.

**D16.** The comment does not read the verdict. Each gap item comes from the record that holds the gap: the plan's skipped kinds, the pipeline input, the checked handoff, the review record's `dimensions` and `proof`, the coverage record's `unreportedFiles`, the profile. Reading the verdict's flags would restate a second surface's words and pull band names into a comment that must state none.

**D28.** A check the caller excluded is said, not counted. The pipeline input drops an excluded name from `checks` and lists it under `excluded` (`lib/pipeline.mjs:187-211`), and the verdict's reader gives each as evidence (`lib/merge-confidence.mjs:625-627`). The comment names each in one line opening `Excluded by the caller:`, counts it in no figure, draws no row for it, and lists it as a gap item: a check somebody chose not to count is what the section on gaps is for.

**D23.** The worker's `detail` paragraph is shown, fenced, inside the collapsed block of confirmed rows, labelled as the worker's words. It is the only place a worker says what it looked at for an unconfirmed row, and dropping it would lose that. It is worker-written text, so it gets the fence the findings comment gives a reviewer's description. When no row is confirmed the block is still drawn, reading `0 confirmed`, so the paragraph is not lost with the rows. The first line's totals count the handoff's rows; a living requirement the size bound left out has no row, so it is in neither total and has a line of its own.

### The confirmation is cited, and one CLI step checks it before anything reads it (D3, D9, D10, D11, D12, D22)

**D3.** The cited handoff ships here and not in a change of its own: the adherence section has only five self-reported counts to show without it.

**D9.** The citation rule runs in its own command, `interlock settle handoff-check`, after the worker replies and before the assessment, and writes the handoff both the verdict and the comment read.

*Alternative considered:* apply the rule only when rendering the comment. Rejected: the comment would say "C7 unconfirmed" while the confidence block, on the same pull request, read the worker's own count and said "none unconfirmed".

*Alternative considered:* teach `readDeltaConformance` to check citations. Rejected: checking a citation needs the working tree, and `lib/merge-confidence.mjs` is a pure reader whose inputs are gathered by the entry file; the checked counts in the handoff reach it with no change to the verdict's code.

**D10. What makes a citation resolve.** A row reads `confirmed` only when the worker said so and its `cite`

1. has the shape `path:line` or `path:start-end` (a trailing `:column` and a leading `./` are accepted, as the evidence gate accepts them),
2. names a file that exists in the working tree, inside the repository,
3. names a line that file has, and
4. lies neither under `openspec/specs/` nor in the change's own directory.

This departs from the brief, which said "a `path:line` in the diff or the specs". Both halves of that rule misfire for a confirmation:

- *"In the diff"* refuses true confirmations. Many scenarios are about what did not change ("without the flag nothing of the loop runs", `openspec/specs/review/settle-loop/spec.md:28-33`), and a living requirement the change still honours is usually honoured by code the change did not touch. `lib/locators.mjs:13-15` chose path membership for refutations because there it "cannot produce a false rejection"; for confirmations it can.
- *"Or the specs"* accepts everything. The briefing hands the worker each entry's own spec file and line (`lib/settle-cli.mjs:1024-1025`), so a worker can cite that line for every row without opening a source file.

The rule above is still mechanical: a shape check and three reads of the file system, no judgement. It cannot tell a relevant citation from an irrelevant one, and it does not try; what it removes is the confirmation with nothing behind it, the invented path, and the question cited as its own answer. The line check is safe here where `lib/locators.mjs` avoids it, because the check runs on the head the confirmation describes, in a tree the loop has just checked clean. The path half goes through the shared `canonicalizePath`; the anchoring is this module's own, as `lib/locators.mjs:23-28` says each surface's must be.

A citation into an archived change (`openspec/changes/archive/…`) is accepted: a scenario can be about an archived file, and rule 4 names only the living specs and the change's own directory.

**D11.** The check reads the ids from a record the briefing kept (`conformance-brief --out`), not from a second gather. `remediate-brief --out` and `fixer-result --brief` already work this way, "so the deferrals are decided once, by the briefing, and never worked out again after the fixer ran" (`lib/settle-cli.mjs:5-8`). A second gather could list different living requirements if the graph changed between the two calls, and the worker's rows would then be judged against ids it was never asked.

**D12.** The skill writes the worker's reply to `.claude/ship/settle/handoff-reply.json`, and the check writes `.claude/ship/settle/handoff.json`. The second path is unchanged on purpose: the three assessment lines in the skill (`skills/settle/SKILL.md:511,541,693`), the table in `docs/15-merge-confidence.md` and the verdict's `--handoff` keep their argument. `conformance-brief`'s `resultPath` default moves to the reply path, since that is still "the file the caller writes that reply to".

**D22.** The check copies the reply's `head` and does not refuse a reply for another commit. The living requirement already says the reply "is written as it came" and "the assessment, which refuses a handoff for another head, is what says so" (`openspec/specs/review/settle-loop/spec.md:750-755`); a second refusal here would leave the verdict saying "no handoff" when the true statement is "a handoff for another commit".

### Where the comment goes in the pass, and what the description says (D7, D20, D21, D25, D26, D27)

**D7.** The owner answered on 2026-11-23: every pass. With `--review` the comment is posted on every pass, with no flag of its own. A comment that cannot be rendered or posted prints `VALIDATION NOT POSTED:` and the pass carries on.

**D25.** It is posted in a new §6d, after the assessment and before the description is composed, so the pointer is published only after the thing it points at exists. Every record the comment reads is written by then; the pipeline input, in §6a, is the last. This design first posted it in a §9d, after the labels, when `## Testing` had already been published naming it. A post the platform refused, or a pass interrupted between the two steps, then left a description naming a comment nobody could find. Posting first needs no repair step: when the comment is not posted, because the render or the post failed, the summary line §7 runs carries `--unposted`, and `- Proof:` reads `not posted` for the commit.

*Alternative considered:* keep the post last and publish the description a second time when it fails. Rejected: a recovery step that runs only on a rare failure is a prose instruction nothing exercises, the living requirement already bounds a republish to one (`openspec/specs/review/pull-request-description/spec.md:77`), and an interrupted pass would still leave the pointer with nothing behind it.

**D26.** Each pass posts its own comment and edits or removes none, as the review round comments are left. Two passes on one commit therefore leave two comments under the same heading. The heading stays `## Validation — <sha>`, with no pass number and no time: the renderer is pure and the same records give the same bytes, the platform dates every comment, and `- Proof:` names the `latest` comment for the commit.

*Alternative considered:* a time or a pass counter in the heading. Rejected: the renderer would need a clock, or a counter no record holds, and the byte-for-byte scenario would go.

**D27.** A pass renders only from records it wrote. `.claude/ship/settle/` is cleared when a loop starts, but a loop that does not start leaves an earlier pass's files where they were (`skills/settle/SKILL.md:167`), and a loop that stops early writes no verdict. In both cases §6d posts nothing and prints `VALIDATION NOT POSTED:` with that reason, and §7 runs no summary and prints `TESTING SUMMARY UNAVAILABLE:`. Without this rule a second pass on the same commit could post the first pass's proof again as its own. `--changed` is the list §5e reads again after the rounds (`skills/settle/SKILL.md:416`), the one the confirmation, the verification plan and the assessment are passed, so a screen a fix round added is listed.

**D20.** The brief's D7 also said to "retire the duplicate confidence comment's default use". There is none to retire: §9c posts the block only with `--confidence-comment` (`skills/settle/SKILL.md:687-698`). It is left alone.

**D21.** `## Testing` under `--review` is the three lines `interlock settle validation --summary` prints, copied as printed in §7. The one line the skill may add is the living `Manual UI test plan: see PR comment.` when a plan is posted (`skills/settle/SKILL.md:585-591`); it adds, changes or removes no other. Without `--review` no record exists (`openspec/specs/review/settle-loop/spec.md:10`), so the section stays the hand-written three bullets. A summary that cannot be printed says `TESTING SUMMARY UNAVAILABLE:` and falls back to the same hand-written form; it never stops the description from being published.

### Screens (D5, D6, D19, D24)

**D5.** The owner answered on 2026-11-23: a person uploading is the default. The comment lists the changed paths that are a screen under `### Visual check owed`, says no screen was looked at and no image is attached, and a person who has looked adds images to the thread. Nothing is uploaded or committed.

The owner also asked whether the settle skill could take the screenshots during a local e2e run, or whether that needs another skill. It needs neither a new skill nor this change, and it is not in this change:

- *Capturing.* Interlock drives no browser. A project's own e2e suite can save screenshots, but a settle pass never asks for e2e: the final verification is planned without `--e2e`, so the plan skips it as `e2e-not-requested` (`lib/verify.mjs:360-367`), and `skills/settle/SKILL.md` does not mention e2e at all. Running it would need a flag on the settle skill and a profile key saying where the run leaves its images.
- *Publishing.* This is the wall. The explore brief found that `gh pr comment` and `glab mr note` cannot attach a local file, that GitHub has no upload endpoint for a comment, and that GitLab has one nobody here has exercised; this spec run did not re-test that. Committing the images puts them in the diff under review.

So the honest next step is small and separate: when a pass ran e2e and the profile names where its images land, the comment says how many there are and where, so the person uploading knows what to drag in. That is its own brief (see Open Questions), because it changes the e2e opt-in, which this change does not touch.

**D6.** A path is a screen when `classifySurface` classes it `UI-TESTABLE`. The owner was unsure on 2026-11-23 and said what it is for: other projects that use Interlock. That aim settles it. The classifier needs no setup in any project, it is already the one answer the manual test plan and the devops trigger share, and a second list would bring back the two-answers problem `lib/surface.mjs` was written to end. The section also gives the count of `UI-INDIRECT` paths, state and data code that reaches a screen only through it, without listing them.

*Rejected: a `ui_paths` list in the test profile*, which this design carried until the owner's answer. It would be a second definition of the same thing, no project's profile holds it today, and every project would see a gap line until someone ran `/interlock:fix-tests` again.

*Rejected: the manual-test-plan skill's judgement per run.* That skill already defers to the classifier (`skills/manual-test-plan/SKILL.md:41`).

**D19** is withdrawn with the list it was about: there are no `ui_paths` entries to match. The classifier matches by extension and directory name (`lib/surface.mjs:30-32`).

**D24.** The section lists paths, not the manual test plan's cases. The plan is an optional comment of its own (`skills/settle/SKILL.md:702-708`), nothing parses its cases, and a count of cases the reader cannot see in this comment adds nothing. This narrows the brief's wording of D5 (a), which had the comment list "the UI paths and the manual test plan's cases".

### The bound (D15)

**D15.** The owner left the value to this spec on 2026-11-23 and asked why a comment would need 60,000 characters. It does not. That figure was the platform's ceiling less some headroom, not what a comment takes: by estimate, at about 130 characters a row, the records of PR #42 (one command, twelve checks, thirty-three confirmed rows, a dozen gaps) come to roughly 8,000 characters, and this change's own 113 scenarios to roughly 18,000, near enough to the bound that its own comment may lose a few confirmed rows, with their count. Neither figure is measured: no renderer exists yet. The bound is `LIMITS.maxValidationCommentChars` at 20,000 characters, published by `interlock limits` and named in no skill. That holds about a hundred confirmed rows beside everything else; past it the confirmed rows, which are collapsed and the least useful, are the first to go, with their count. It is far under what GitHub refuses (its message names 65,536 characters; GitHub documents no limit). GitLab's limit was not checked: its lines are not exercised, and a post the platform refuses says `VALIDATION NOT POSTED:`.

The cut is deterministic and loses the least useful rows first: confirmed rows, passing and skipped checks, the worker's `detail`, failing test names, visual paths, unconfirmed rows, failing and pending checks, and gap items last. Rows go last first within a block. Each block that lost rows says how many, each section's first line keeps the count of the whole list, and the last line opens `CUT:`. Every list whose length the pull request decides is in that order. What is never cut is the headings, each section's first line, the commands table, and the lines after it: `RESULT DISAGREES:`, `RE-RUN:`, the line saying whether the verification halted, and a spill locator's line, of which there is at most one per kind. The table has at most one row per verification kind, each cell an inert span capped at 240 characters by `inertSpan`; that is a few thousand characters, so the bound holds. The gap list repeats a marker line as an item, and that copy is a gap item like any other: it goes with them, last, and the gap section then says how many items it lost.

Changing the value later is one number in `lib/limits.mjs`; no requirement and no test names it.

### What is left alone (D17, D18)

**D17.** `lib/settle-meter.mjs` keys neither new command, so neither draws a row or opens a section, exactly as the two description lines do not (`lib/settle-meter.mjs:117-127`, pinned at `test/spine/settle-meter.test.mjs:1752-1772`). The conformance briefing's first line is unchanged, so the worker is still attributed. A row for the check or the post is a later change to the meter's own spec.

**D18.** The ship run's handoff is a different, schema-bound result (`lib/prompts/schemas.mjs:196`, read at `lib/run.mjs:4153` and `lib/receipt.mjs:466`). It keeps its five counts. After this change the settle confirmation is cited and the strict tail's is not; that difference is named here so nobody takes it for an oversight.

### Shapes the tests and the implementation share

The record `conformance-brief --out` keeps, which is also what `--json` prints:

```json
{ "change": "<name>", "dir": "openspec/changes/<name>", "head": "<sha>", "resultPath": ".claude/ship/settle/handoff-reply.json",
  "scenarios": [{ "id": "C1", "artifact": "specs/<capability>/spec.md", "line": 12, "title": "…", "body": "…" }],
  "living": { "skipped": null, "partial": null, "omitted": [{ "capability": "…", "heading": "…" }],
              "requirements": [{ "id": "L1", "capability": "…", "artifact": "openspec/specs/<capability>/spec.md", "line": 40, "title": "…" }] },
  "briefing": "…" }
```

A scenario's `artifact` is relative to `dir`; a living requirement's is relative to the repository root.

The worker's reply, written as returned to `handoff-reply.json`:

```json
{ "ok": true, "scenariosChecked": 3, "scenariosUnconfirmed": 0, "requirementsChecked": 2, "requirementsUnconfirmed": 0,
  "detail": "…", "head": "<sha>",
  "rows": [{ "id": "C1", "status": "confirmed", "cite": "lib/a.mjs:12-40" }, { "id": "L1", "status": "unconfirmed", "cite": "lib/b.mjs:7" }] }
```

The checked handoff, written by `handoff-check` to `handoff.json`:

```json
{ "ok": true, "checked": true, "head": "<sha>", "detail": "…",
  "scenariosChecked": 3, "scenariosUnconfirmed": 1, "requirementsChecked": 2, "requirementsUnconfirmed": 1,
  "claimed": { "scenariosChecked": 3, "scenariosUnconfirmed": 0, "requirementsChecked": 2, "requirementsUnconfirmed": 0 },
  "rows": [{ "id": "C1", "kind": "scenario", "title": "…", "artifact": "…", "line": 12,
             "claimed": "confirmed", "status": "confirmed", "cite": "lib/a.mjs:12-40", "reason": null }],
  "living": { "skipped": null, "partial": null, "omitted": 0 },
  "unknownRows": [] }
```

`reason` is one of `no row`, `more than one row`, `not confirmed by the worker`, `no citation`, `cited file not found`, `cited line not in the file`, `the citation is the requirement's own text`, or `null` on a confirmed row.

One line of the exec record:

```json
{ "kind": "unit", "command": "npm test", "exitCode": 0, "durationMs": 102300, "at": "2026-11-23T08:00:00.000Z" }
```

The comment's skeleton:

```markdown
## Validation — <sha>

### Commands run
| Kind | Command | Exit | Duration | Result |
…
Final verification: no halt.

### Platform checks
12 checks on this commit: 11 passed, 1 skipped; 5 required.
Excluded by the caller: `e2e (nightly)`
<details><summary>12 checks</summary> … </details>

### Spec adherence
29 of 29 scenarios and 4 of 4 living requirements confirmed with a citation; none unconfirmed.
<details><summary>33 confirmed</summary> … </details>

### What these checks would not catch
- typecheck did not run: no-detectable-command
…

### Visual check owed
…
```

The three lines `--summary` prints, the third as it reads with `--unposted` shown after it:

```markdown
- Ran: unit `npm test` exit 0, 4948 tests: 4943 passed, 0 failed, 5 skipped
- Not run: typecheck, lint, e2e, coverage
- Proof: the latest `Validation — <sha>` comment on this pull request
- Proof: not posted for <sha>
```

The exact sentences are the renderer's; the tests pin the headings, the fixed prefixes and marks (`RESULT DISAGREES:`, `RE-RUN:`, `CUT:`, `Excluded by the caller:`, `session-recorded`, `as the session read them`, `not posted`, `latest`, `No gap is recorded in these records.`) and the order, not the prose between them.

**Module layout.** Two new pure modules, one concern each, neither importing a `node:` module: `lib/settle-handoff.mjs` (the citation rule; the caller hands it a function that answers "does this path exist, and how many lines has it") and `lib/settle-validation.mjs` (the renderer and its summary; the caller hands it the parsed records, and it calls `classifySurface` from `lib/surface.mjs`, itself pure, for the visual section). `lib/settle-cli.mjs` does the reading and writing and holds the two subcommands. `cli/interlock` changes only for `--record`.

## Risks / Trade-offs

- **A conformance signal that read green can read amber.** A worker that confirms a row and cites nothing, or cites the spec, is now counted unconfirmed. → That is the change's purpose. The briefing says in words what a citation must be, the check prints `CONFIRMATION NOT CITED:` with each id and reason, and the worker's own counts stay in the file under `claimed`.
- **A true confirmation with a sloppy citation is refused.** A worker that cites a line past the end of a file, or a bare file name, loses the row. → The reason is printed per row and shown in the comment, so a person can see it was the citation and not the behaviour. The rule has no path-membership half, which is the half that would refuse the most true confirmations.
- **A citation that resolves can still be irrelevant.** → Stated in D10: the rule is mechanical on purpose. A semantic check would hand the judgement to another model.
- **The verdict can read green while the comment says `RESULT DISAGREES:`.** → D14. The line after the commands table is a marker: it is never cut and never collapsed. Its copy in the gap list is cut last, with the other gap items (D15).
- **The skill could write `handoff.json` by habit and skip the check.** → The skill suite pins the check's line between the briefing's and the verification's, and the requirement says the skill writes that file by no other means. A handoff without `checked: true` renders as `not checked` and is a gap item, so a skipped check is visible on the pull request.
- **Longer skill, more steps per pass.** Three added lines run per pass (the check, the summary, the post) and none spawns an agent. → Each can fail without stopping the pass.
- **The classifier knows web front ends and little else.** Its tables hold `tsx`, `jsx`, `vue`, `svelte`, style files and five directory names; a plain `.html` page, a server template or a native screen is not `UI-TESTABLE`, so a pull request that changes only those gets no visual section and nothing says one was owed. → Named here, not solved here. Widening `lib/surface.mjs` fixes it for the comment, the manual test plan and the devops trigger at once, and is a change to that module's own rules.
- **In a front-end project the section appears on most pull requests.** → It lists paths and attaches nothing, it sits last, and its paths are cut before any unconfirmed row, failing check or gap item.
- **`cli/interlock` is near its shipped-file size bound.** → The `--record` append is a few lines beside the existing timing append; if the size test fails, move code out of the entry file, never raise the bound.

## Migration Plan

Nothing stored changes shape for a reader that exists today. `handoff.json` gains keys the verdict ignores, and its two counts are now the checked ones.

1. Ship the CLI and the skill together, as the plugin always does: the skill's new lines call commands the same version carries.
2. A pass run with the previous skill against the new CLI still works: it writes the worker's reply straight to `handoff.json` with no `checked` key, and the verdict reads it as it does today.
3. Rollback is a revert of the change's commit. A comment already posted stays on its pull request and stays true, since it names its commit.

## Open Questions

- Should `interlock verify judge` take the exec record and refuse a results entry whose exit code disagrees? It would close the gap D14 leaves open, for ship runs too. It does not change this change's specs or tasks.
- Should the ship run's strict-tail handoff ask for cited rows as well (D18)? Same rule, different result schema.
- Should the settle meter draw the check and the posted comment (D17)?
- Should a pass be able to run the project's e2e suite and have the comment say how many screenshots it left and where (D5)? It needs a flag on the settle skill, a profile key for the images' directory, and a decision on the e2e opt-in. A brief of its own.
- Should `lib/surface.mjs` learn plain HTML, server templates and native screens (D6)?
