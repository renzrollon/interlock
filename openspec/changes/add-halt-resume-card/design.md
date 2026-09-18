## Context

See `proposal.md` — Why. The constraints that fix the shape, each verified against the code:

- `runClose` in `lib/run.mjs` already holds every fact the card needs by the time it prints: `manifest.change`, `manifest.runId`, `manifest.plan` (`{reused, status, reason}`, or `null` when the run ended before the reuse check reported), `manifest.waves`, the computed `leftoverTaskIds`, `absRoot`, the `slug` from `projectSlug(absRoot)`, and the `degradations` array that `degradationLines()` seeded and three later steps push onto. Nothing has to be re-read from disk.
- `formatRunSummary` in `lib/receipt.mjs` is import-free by design: every field arrives as a defaulted parameter. A new field has to keep that property.
- `.claude/handoff/` is already in `.gitignore`. `.claude/ship/` is the run's own corpus and is the wrong neighbourhood for a file meant for a person.
- Corpus-loss semantics differ deliberately by corpus (`CLAUDE.md`): the run trajectory and the spill are `fatal: true`; the outcome corpus and review metrics report their own write failures and never touch the exit code. A new artifact has to pick a side and say which.
- Thresholds live in the CLI. A cap the card obeys is a `LIMITS` entry published by `interlock limits`, never a literal in the card's prose or in a spec.
- Plan reuse reads `.claude/ship/plan-fingerprint.json` and `.claude/ship/plan.json` and recomputes the fingerprint at the next `run start` (`lib/plan-fingerprint.mjs`). `.claude/ship/state.json` — the wave cursor and handoff packets — is single-file and replaced at wave 0 by the next run.
- The change name reaches the close from a branch, a directory or a model, and the run id from the manifest. Both are untrusted as path components.

## Goals / Non-Goals

**Goals:**

- One file, written once, at the close of a halted run, that a reader with none of this session's context can act on: why it stopped, which run to read, what is left, and what the next run will and will not do.
- A pure formatter so every fact is passed in and none is inferred, and one impure writer that cannot throw.
- Bounded output whose truncation is always stated.
- A summary row that points at the card, and only when the card exists.

**Non-Goals:**

- Mid-run resume. The wave cursor and the previous wave's handoff packets are not restored.
- `resumeFromRunId`, a replay cache, or any host-level relaunch.
- A consumer. Nothing reads the card back — not the loop, not dispatch, not plan reuse, not a skill.
- A prediction of the next run's reuse verdict.
- A card on a clean run, a second card per run, a card per halt attempt, or a timestamped pile of them.
- Any change to what halts a run, to the exit code, or to the reuse decision.

## Decisions

### D1 — Its own module, pure formatter plus one impure writer

`lib/resume-card.mjs` owns the whole card: `resumeCardPath`, `formatResumeCard` (pure), `writeResumeCard` (the only function that touches disk), and the three exported constants `HANDOFF_DIR`, `RESUME_CARD_SCHEMA`, `NO_RUN_ID`.

`formatResumeCard` reads nothing and infers nothing: every fact is a parameter. That is what makes the body testable without a scratch root and what makes "it never predicts a future run" enforceable — a function with no disk access cannot consult a fingerprint it would then have to guess about.

*Alternative considered:* extend `lib/receipt.mjs`. Rejected — that module is deliberately import-free and formats a terminal summary; the card needs `LIMITS` for its cap and `node:fs` for its write, and adding either would make the summary formatter depend on the filesystem. *Alternative:* write the card from `workflows/ship.js`. Rejected — the default host cannot write files at all, so only the CLI can, and the loop decision belongs in `lib/run.mjs` either way.

### D2 — `.claude/handoff/ship-<change>-<runId>.md`, with both components reduced to safe segments

One card per change per run. A second close of the same run overwrites its own card, which is correct: the card describes the run's final state, and two cards for one run would only ask a reader which is current.

`segment()` maps anything outside `[A-Za-z0-9._-]` to `-`, collapses any run of two or more dots to `-`, strips leading and trailing dots and dashes, and truncates. Dropping separators alone would already make traversal impossible — `a/b/../c` becomes `a-b-..-c`, which cannot escape anything — but a filename carrying a literal `..` invites the next reader to decide it is fine somewhere else, so the dot run collapses too.

A run that halted before `adoptPlan` has no run id. The filename uses the literal `no-run-id` rather than a timestamp: a clock-derived name would accumulate one file per failed invocation, and what a reader wants is the latest state of this change, not a pile of them. The card's body states the absence in the `run:` row rather than printing a blank, matching the summary's existing `run: none — the run halted before a plan was adopted` row.

*Alternative considered:* `.claude/ship/handoff/`. Rejected — `.claude/ship/` is the run corpus that `interlock report` reads; a prose file for a person sitting inside it invites a reader to treat it as a record the CLI consumes.

### D3 — Only on a halt

`runClose` writes the card only when `haltReason` is set. A clean close has nothing to resume, and its summary already ends in the archive reminder — a card there would be a second, staler copy of a change that is finished.

### D4 — Written last, so the card carries every banner the close raised

The call sits after the reconstructability and autonomy banners, immediately before `writeManifest`. A card that listed the banners raised before it was assembled, but not the ones the same close raised afterwards, would be a partial record of exactly the section a reader consults first.

### D5 — Loss is the outcome-corpus class, not the trajectory's

`writeResumeCard` catches everything and returns `{written, path, reason}`. The caller pushes `RESUME CARD NOT WRITTEN: <reason>` onto `degradations` and leaves the exit code alone, and the summary's `resume card:` row is then absent.

This is a deliberate choice against the trajectory's `fatal: true`, and the reason is what the card *is*: a pointer to records that were already written. A run whose trajectory append failed is a run nobody can reconstruct, which defeats the file's reason to exist. A run whose card failed has lost a convenience while every underlying record — trajectory, receipt, plan, tasks — is still on disk. Making it fatal would also mean a read-only checkout or a full disk could change *how a run halted*, which is the one thing a post-halt artifact must never do.

The failure is spoken, not swallowed: the banner is the whole point. A card that vanished silently would leave the summary's missing row indistinguishable from a clean run's.

*Alternative considered:* let the write throw and let `runClose` catch it. Rejected — a never-throws contract stated in the module is checkable by a test; a caller-side try/catch is a convention the next caller can forget.

### D6 — The card is a record, and says so in the file

Nothing reads the card back. The file states that about itself, names the plan fingerprint as the thing that actually decides reuse, and carries the same `Do not start another ship run unless the user asks.` instruction the summary ends with.

This is not decoration. The realistic reader of a file called a resume card is a model in a later session, and a markdown artifact that looks like a handoff is exactly the input that gets read as an instruction to act. The sentence is the mitigation, and it is pinned by test tokens for the same reason every other load-bearing instruction is.

*Alternative considered:* have `/interlock:ship` read the card when one exists. Rejected — that is the whole hazard. It would make a hand-edited file able to change what a run does, and it would duplicate the reuse decision in a second place that can disagree with the fingerprint.

### D7 — Report the stored state and the rule; never predict the verdict

The plan section states this run's own verdict (`reused` / `rebuilt`, with the status and reason the manifest carries) or, when `manifest.plan` is `null`, that the run ended before the plan-reuse check reported — the same three-way distinction `formatRunSummary` already draws, and for the same reason: "we never found out" and "there was no prior plan" are different facts.

It then states whether a stored plan and fingerprint on disk name this change, and what the rule is — ticking a checkbox does not break the fingerprint; editing an artifact, or adding, removing, reordering or rewording a task does, and so does a different `--solo` / `--waves` / `--tdd` shape. It does not say the next run will reuse. The recomputation happens at the next `run start` against artifacts that may change in between, so a prediction would be wrong exactly when a reader was relying on it.

`planStored` is computed at the call site as a fingerprint having been resolved *and* `.claude/ship/plan.json` existing, so the sentence names two files that are both actually there.

### D8 — Every list bounded by `LIMITS.resumeCardListRows`, and the omission named

One cap covers all three lists — leftover task ids, wave tallies, degradation banners — because they are the same kind of thing: rows a person reads in one sitting. Three caps would be three numbers to tune with no evidence distinguishing them.

Over the cap, the card prints the first rows and then a line saying how many it left out and naming where the full list is: `openspec/changes/<change>/tasks.md` for tasks, `interlock run-log show <runId>` for waves, the printed summary for banners. Never a silent head. An oversized halt reason is clamped with a visible `(truncated)` marker rather than cut.

The cap is a `LIMITS` entry published by `formatLimits` as `resume card list rows (per list)`. Its value appears in no prose, no spec and no test literal — the tests derive their fixtures from `LIMITS.resumeCardListRows`.

### D9 — Absences stated, never printed as empty sections

Every section has a sentence for the empty case: every box ticked, no wave recorded, no banner raised, no stored plan naming this change, a halt with no recorded reason. A section heading over nothing reads as a fact the writer failed to gather; a sentence reads as the fact it is.

The `run-log show` commands are printed only when there is a run id to name. A card that printed `interlock run-log show` with nothing after it, or with `no-run-id`, would hand a reader a command that cannot work.

### D10 — One summary row, printed only when the card exists

`formatRunSummary` gains a defaulted `resumeCard` parameter and prints `  resume card: <repo-relative path>` after the identity and push rows, before the archive-reminder block and the closing line. The path is repo-relative because it is printed next to a `cwd:` row and is what a reader types.

Printed only when a card was actually written. A row naming a file that is not there is worse than no row, and the close that could not write one already says so in the degradation block. The module stays import-free: the row is a string the caller passes in, not a path the formatter derives.

### D11 — `.claude/handoff` joins the root-isolation corpora

`test/spine/root-isolation.test.mjs` guards the directories an unpinned test must never write into. The handoff directory is now one of them, for the same reason `.claude/ship` and `.claude/metrics` are: a card landing in the developer's live `.claude/` is indistinguishable, to a later reader, from a real run's.

## Risks / Trade-offs

- **A reader assumes the card is wired in** → the core hazard, and the reason D6 puts the disclaimer in the file rather than only in a spec. Residual: a reader who does not read the first paragraph. Mitigated further by the card never claiming to know what the next run will do, so acting on it wrongly requires ignoring two separate sentences.
- **The card goes stale the moment anyone edits an artifact** → accepted, and it is why D7 forbids a prediction. A stale card still names the halt reason, the run id and the leftover ids correctly; only the plan paragraph can age, and it is written as stored-state-plus-rule, which stays true.
- **A card exists for a run someone already fixed by hand** → accepted. It is overwritten by the next halt of the same run and ignored by everything else; nothing reconciles it, because nothing reads it.
- **One cap for three different lists** → a wave list and a leftover-id list have different natural lengths. Accepted rather than split: there is no evidence yet distinguishing them, and the repository's rule is that a cap is tuned from the corpus, not from intuition at authoring time.
- **Loss is not fatal, so a systematically unwritable tree loses every card silently to a reader who ignores banners** → the banner is the mitigation, and it is asserted. Making it fatal was rejected in D5 for a reason that does not weaken with repetition: the card must not change how a run halted.
- **Untrusted path components** → handled at the only place a path is built (D2), asserted directly by a test that feeds `../../etc/passwd` and `a/b/../c` and checks the result both starts with the handoff directory and contains no `..`.

## Migration Plan

Additive. There is nothing to migrate: no prior card exists, no schema moves, and no existing artifact changes shape. `RESUME_CARD_SCHEMA` is `interlock.resume-card/1` and is stamped in an HTML comment at the top of the card so an older one stays identifiable if the shape ever changes.

Rollback is a revert of `lib/resume-card.mjs`, the `runClose` block, the `resumeCard` parameter and row in `lib/receipt.mjs`, the cap in `lib/limits.mjs`, and the tests. Cards already written are inert markdown under an already-ignored directory; nothing reads them, so nothing breaks when the writer goes away.

## Open Questions

None. The halt-only trigger, the filename shape, the loss class, the single cap, and the refusal to predict a reuse verdict are decided above; leaving any of them open would change the spec or the task breakdown.
