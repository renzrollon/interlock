# Design

## Context

See proposal.md (Why) and the explore brief `.claude/handoff/explore-prove-the-review-covered-the-diff-20261028-223500.md` for the evidence. The shape of the defect, as the code has it today:

- **Recall is never measured.** The skeptics (two per blocker/warning) attack false positives; nothing attacks false negatives. Every review signal is a universal over `surviving[]` and is vacuously green on an empty list (`lib/merge-confidence.mjs:197-333`). `ran` means "dispatched with a rubric" (`lib/run.mjs:2100-2135`), and `readDimensionRecord` rebuilds the record from known keys only (`lib/review-core.mjs:591-623`), so nothing a reviewer says about what it read can survive into the record.
- **The orchestrator authors the prompts.** `skills/review-code/SKILL.md` §2–§3 tells the model to "use it verbatim", but the model writes scope notes, run rules and the skeptic framing itself. On PR #28 it wrote "Do not run npm test", and two dimensions answered after skipping their rubric's inputs.
- **The rubrics do not ask the questions that found the misses**, and blast radius is forbidden from raising B1 (an observer "inside the diff", judged per file).
- **Inputs degrade silently.** The domain cut starves by name order, with `partial` meaning two things across the CLI and a run. A stale graph makes the capability under change unselectable and blast radius empty. An archived change resolves to nothing on every read path.

Constraints:
- **Toolchain:** zero runtime dependencies.
- **Thresholds:** in `lib/limits.mjs`, published by `interlock limits`.
- **Guards:** fail open.
- **Degradation:** spoken, never silent.
- **Hooks module:** `hooks/mod.mjs` and its imports stay Node-free; the settle meter's `roleOf` lives in `lib/settle-meter.mjs`.
- **File size:** the package test caps every shipped file at 245,760 bytes (`test/spine/package.test.mjs:389-395`). `bin/interlock` is at 245,586 and `lib/run.mjs` at 241,819, so both may only shrink or barely grow.

## Goals / Non-Goals

**Goals:**
- A review that cannot show what it examined never reads as a clean review, in the PR comment or in the verdict.
- One deterministic place builds every review prompt; the orchestrator relays it.
- The default depth asks the lifecycle, measurement and stale-text questions, and blast radius sees unchanged readers.
- The same rules hold for `/interlock:settle --review`, a standalone `/interlock:review-code`, and `/interlock:ship`'s review step.
- The PR #28 miss is reproduced by tests that fail today, and graded as recall by an eval.

**Non-Goals:**
- Judging a reviewer's reasoning quality in the CLI. The ledger proves where it looked, not that it looked well; the recall eval is the quality check.
- A recall skeptic that hunts for missed findings. It costs one more model per review and is still a judgement; it is recorded as later work.
- A proof re-run inside the ship run (D24). The run's review step stays one worker's in-context fan-out: its briefing and the fix round's carry the same proof rules, measure line and ledger shape `review brief` prints, a clean re-review writes a ledger, and an unproven run review is one `REVIEW NOT PROVEN` banner and an amber `review.ran`, never a second spawn.
- Adding the hooks-kit suite (`claude plugin test`) to settle's verification plan (ledger D10).
- Changing the GitLab lines beyond keeping them in step; they stay marked not exercised.

## Decisions

### §1. Rubrics: an always-on `regression` dimension, and blast radius per hunk (D1, D11)

A new `skills/review-code/dimensions/regression.md` asks the questions that found M1–M4 and B1–B2: pair every start with every end path (in or out of the diff); name state left live and who reads it; name deleted or weakened tests; measure a living promise (width, size, count, duration) instead of reasoning about it; find text outside the changed lines that the change made untrue. It is always-on at both depths (D1, needs a human: one more agent per default review), so the strict set the ship run selects grows from four to five (`ship/run-program` is amended to read the published set rather than name four). It is a separate dimension rather than more bullets in `technical-lead`, because `technical-lead` already holds scope, contract and test sufficiency, and on PR #28 it reported reading only the code diff. A separate brief with its own ledger can be proven or not on its own.

`blast-radius.md` moves its boundary from the file to the changed hunk (D11): a reader in an unchanged line of a changed file is an outside observer. It must also list every reader and every end path of a changed lifecycle, with `path:line` and a count, and say whether the change is the only path. Additive plumbing still raises nothing. The changed line ranges come from the brief's CLI-computed scope (§4), so "outside the hunks" is a fact the reviewer is given, not one it derives.

Alternative rejected: run strict by default. Strict adds `architecture` and `qa`, neither of which asks the lifecycle or stale-text questions, at twice the agents.

### §2. The verdict reads proof, and a record without one is amber (D2)

Two different things were both called "partial". They are now two words, read two ways (D12):

- **`proof.unread`** is a reviewer that did not read an input its rubric calls for. It is evidence the review did not do its job, so it reads amber on `review.ran`, like `proof.unproven` (raised nothing, checked nothing) and `proof.uncited` (a changed source file no dimension cited). Each is named in the evidence. An input the CLI itself cut is not unread: a requirement the domain cap left out is `degraded`, recorded by the skill from `assembled.omitted`, and the prompt's proof rules say so, so a domain answer whose only gap is the cut stays out of `proof.unread`; `unread` is an input the prompt contained that the reviewer did not open.
- **`dimensions.degraded`** is a dimension that ran on a cut or stale input: `domain` when the cap left requirements out, `blast-radius` when the graph did not cover the diff. It is the CLI's own input degrading, not the reviewer failing, so it raises a flag (`domain-partial`, `blast-radius-partial`) and leaves the band alone, as `domain-skipped` does today. `readDimensionRecord` gains `degraded` as a validated key, refusing any name other than those two.

A review input with no proof, or no dimension record at all, is amber with the reason that it recorded neither. This replaces today's green with `dimensions-unrecorded` (D2, needs a human: verdicts change for every user whose record predates this). `review.blockers` and `review.warnings` keep their bands but say in their reason whether the proof holds, so a green "no surviving blocker among 0" never stands alone. The `dimensions-unrecorded` flag is retired; the two new flags join the closed `FLAGS` list with rows in `docs/15-merge-confidence.md`. The requirement "The review signals SHALL read the adjudicated review" is replaced by REMOVED plus ADDED under new names (OpenSpec 1.15 refuses a MODIFIED block that renames a scenario, and one scenario's outcome changes).

**Consequence for the test fixtures.** Of the 82 merge-confidence fixtures, 81 carry a review meant to read green, and none carries a proof, so D2 turns them amber. The red wave (task 1.1) gives every such fixture a proof that holds, mechanically. It does not loosen the reader. It also updates the three other pins that read the old shape: `test/spine/merge-delivery.test.mjs:682`, `test/spine/settle-cli.test.mjs:210` and the `FLAGS` list pin.

### §3. The proof is mechanical, and an unproven dimension is re-run under a published cap (D3, D8)

The dimension answer becomes `{ dimension, findings, coverage: { checked: [{ what, at }], unread: [{ input, reason }] } }`. `FINDING_SCHEMA` grows the optional `coverage`.

**Extraction and validation.**
- **Read before flattening.** The ledger travels inside each dimension's answer in `--findings`, and `flatten()` (`lib/review-core.mjs:50`) reduces that input to a flat finding list. So `coverage` is extracted per dimension before flattening.
- **Shape check only.** Each `at` is validated for the shape of a `path:line` or `path:start-end` token only. The evidence gate's own check (`lib/review-core.mjs:149-169`) also requires the path to be in the diff, which a ledger entry must not, because blast radius cites callers outside it.
- **A bad entry degrades instead of failing.** A malformed entry does not fail the review. `interlock review` prints `LEDGER REJECTED:` on standard error and records that dimension unproven with the fault, so the re-run picks it up. Nothing exits 1 on a reviewer's bad ledger (D14), so no skill or run path has to handle a missing record.

**What `lib/review-proof.mjs` computes.** It is a new pure module: a function of the ledgers, the findings, the ran dimensions and a changed-path list, with no I/O, so the PR #28 fixtures drive it directly. Its callers compute the list: `lib/review-cli.mjs` and the run take the union of `--changed` and git's list for `--base`, as `lib/merge-evidence.mjs:365-372` already does. It computes:

- `unproven`: ran dimensions with no finding and no `checked` entry (or a rejected ledger).
- `unread`: ran dimensions with any `unread` entry.
- `uncited`: changed coverable source files that no ran dimension's checked entry or finding cites. "Coverable" is `isCoverableSource` (`lib/artifacts.mjs:38`), the predicate `spec.coverage` already uses, so docs, tests and specs are not demanded. Given no changed list (neither `--changed` nor `--base`), the module returns `proof.proven` false with the reason "no diff given", so an omitted flag cannot read as proven.
- `proven`: all three empty and a diff given.

An answer with no `coverage` key is unproven ("coverage not recorded"), never a parse failure, so an older worker degrades to amber rather than to an error. The record carries `coverage` keyed by dimension and `proof` beside `dimensions`. `--carry` carries a dimension's ledger with its findings.

**The re-run answer.** `interlock review proof --review <file>` answers on one stream, in four ways (D23). The first line of standard output is the answer and the reasons follow on later lines; the settle meter keys that first line and the skill reads the dimension names from it, so there is no `--json` form:
- `re-run: <dimensions>`, exit 1, while the list is non-empty and the record's `proof.reruns` is below `LIMITS.maxProofReruns` (published, 1);
- `proven`, exit 0. The proven check wins: a record whose ledgers hold prints `proven` at the cap too, so the re-run that proves coverage on the last allowed attempt is never reported as capped;
- `PROOF CAP REACHED: <dimensions>`, exit 0, once `proof.reruns` has reached the cap with gaps left. A record with no `proof.reruns` counts 0, so an older draft is never read as capped;
- a broken input, exit 2, so it is never mistaken for a re-run.

The count lives in the record: `interlock review … --rerun-of <draft>` writes `proof.reruns` as the draft's count plus one when the write carries answers for a dimension (a re-run), and as the draft's count when it carries none (the promote write, below), so a first-pass proven review records 0, and the skill loops while the proof line exits 1 and never counts (D19). This follows the settle loop's own rule: the cap is the CLI's, and the skill never counts.

**What a re-run is.**
- **The run itself.** review-code records the first pass as a draft (`interlock review … --draft --out <draft>`, no `--metrics`). The draft goes beside the caller's `--out` as `<out>.draft.json`, or under `.claude/ship/review/` when no `--out` was given, and the settle meter draws a `--draft` line as a draft row, never as the round's record. Every flag of the final write but `--metrics` and `--out` is on every draft (`--base`, `--changed`, `--dimensions`, `--carry`), so a scoped settle review's carried ledgers count on the draft too, and a file a carried ledger still cites is never uncited. The draft carries `inputs: { answers, verdicts }`, the per-dimension answers and the verdicts it was written from, so the merge below needs no path the skill typed; the final record omits `inputs`. `review proof` reads the draft. A proven dimension is not run twice.
- **The merge is a CLI write (D22).** `interlock review --rerun-of <draft> --findings <re-run answers> --verdicts <re-run verdicts> --draft --out <next draft>` merges the re-run into the draft's inputs and resolves the whole again: a dimension the draft's proof named unproven or unread has its answer replaced, ledger included; a dimension re-run for uncited files alone has the new checked entries and the findings whose ids are new appended, and nothing of its first answer dropped, so a `regression` blocker survives an uncited-file re-run; the draft's verdicts are kept for every finding id they cover and the new verdicts appended, so every first-pass blocker and warning keeps the floor number of verdicts and the adversarial signal does not turn amber for want of a re-vote; a dimension the write does not name is untouched, carried or ran. The skeptics see only what is new: `interlock review brief --skeptics --findings <re-run answers> --rerun-of <draft> --json` prints prompts for the findings the draft holds no verdict for, so a finding the first pair judged is never re-voted. When the proof line exits 0, the final write is the promote write, `interlock review --rerun-of <last draft> --metrics --out <out>` with no `--findings` and no `--verdicts`: the same merged inputs, `proof.reruns` unchanged, `--metrics` written once. No step of this drops a first-pass finding, verdict, skip or degraded entry, and the skill composes no findings or verdicts file.
- **A ship fix round carries too.** `lib/run.mjs` re-reviews only `reReviewDimensions` (`:2026`), so its rewritten record carries every other dimension's ledger from the record before, under the stale-file rule. Without that, every strict run that remediates anything would read unproven.
- **Carried ledgers go stale.** A dimension carried from an earlier round keeps its ledger, but its entries on files changed since that record's head cover nothing, so a fixer's edit is always re-cited by someone.
- **The changed list is the union.** The changed files are the union of `--changed` and git's list for `--base`, as `lib/merge-evidence.mjs:365-372` already does, so a model-typed list that leaves a file out cannot narrow the proof.
- **Uncited files.** When the only gap is an uncited changed source file, the answer names `regression` with the files when `regression` ran in this review (D16), because it is always-on and not bound to a file kind; in a scoped review that did not run it (a settle fix round's `--dimensions`), it names the first ran dimension of that list instead, so no dimension outside the scope runs and `carryForward` (`lib/review-core.mjs:440`) never drops a carried dimension's survivors by putting it in `ran`. The brief re-lists the files to cite, and the re-run is an append (above).
- **One loop.** The re-run loop lives in review-code alone (D17). A re-run dimension's new findings go through the skeptics like the first pass's, the record is written once for the head, and `--metrics` is written once, for the final record. Settle, which runs review-code inside its loop, runs no proof line of its own, so nothing is re-run twice the cap.
- **Refutations outside the diff.** `regression` findings may name an unchanged caller outside the diff, as blast-radius findings do, so `evidencePathsFor` (`lib/review-core.mjs:167-171`) widens the accepted evidence paths to the finding's own file for `regression` too. Without that, such a finding could never be refuted.

Alternative rejected: count a dimension's tool calls or tokens as proof. That is a host detail the CLI cannot see from a settle session, and a busy reviewer can still read the wrong files.

### §4. The CLI assembles every review prompt (D7)

`lib/prompts/review-dimension.mjs` and `lib/prompts/review-skeptics.mjs` are registered in `lib/prompts/index.mjs`, so `prompt-integrity.test.mjs` enumerates them.

**The dimension prompt.** `interlock review brief --dimension <name>` prints it, in five parts:
1. the rubric file verbatim, opening `# Dimension: <name>`;
2. the scope the CLI computes from `--base`: changed files with changed line ranges, and the change's artifact paths, read from the archive when §6 applies;
3. quoted data blocks: `REVIEW.md` prose, using the framing of `renderPolicyBlock` in `lib/prompts/review.mjs:53-60`; `.claude/graph/REVIEW_CONTEXT.md` when present, otherwise a line saying there is none; and the domain text, for `domain` only;
4. the run-and-measure rules: the reviewer may run read-only commands, a single test file and the repository CLI, writes nothing (a reviewer that edits the tree it judges invalidates its review; the spawn's tool set is the host's, since a skill's `allowed-tools` governs the session that runs the skill and not an agent it spawns, so this line is the bound), and measures any size, width, count or duration it claims, recording a measurement it cannot take under `unread`; and the proof rules: list the changed source files, say each must be cited by some dimension, say an empty answer must still say what it checked, say an unread input is recorded, not hidden, and say a requirement the domain cap left out is `degraded`, recorded by the skill, never an `unread` entry. One exported function renders these rules, the measure line and the ledger emit shape, and the run's briefings call it too (below);
5. the emit shape with the ledger.

**The skeptic prompts.** `interlock review brief --skeptics --json` prints `{ prompts: [{ skeptic, findingIds, prompt }] }`, one entry per agent the depth's spawn shape calls for. They come as JSON (D13) so two prompts are never concatenated on one stream and misattributed. Each prompt opens with its published first sentence as a whole line, so `roleOf` (`lib/settle-meter.mjs:1109`) attributes both unchanged.

The two sentences live in a new import-free `lib/review-roles.mjs` that both the skeptic assembler and `lib/settle-meter.mjs` import. The assembler carries each skeptic's whole brief, today's blockquote text: refute or assess, the default when uncertain, the two score axes and the instruction not to inflate them. The direction matters: the settle meter must not import the assembler, whose imports reach `lib/findings.mjs` and `node:crypto`, outside the hooks module's Node-free walk. The skeptic blockquotes leave `skills/review-code/SKILL.md`, and the settle meter's role-source pin is amended to read the assembler instead of the skill (`hooks/settle-meter`).

**Ship's path and the skills.**
- **Ship (D24).** The run's `assembleReviewPrompt` and the fix round's `assembleRemediatePrompt` (`lib/prompts/remediate.mjs:134`) take the proof rules, the measure line and the ledger emit shape from the dimension assembler's one rendering function, so the run's worker is told what `review brief` tells a dimension agent. A clean re-review writes one ledger per re-reviewed dimension, `{ dimension, findings: [], coverage: { checked, unread } }`, never the bare `[]` the briefing asks for today: a bare `[]` is a ran dimension with no coverage, which is unproven, and every strict run that remediated anything would otherwise close `REVIEW NOT PROVEN`. `lib/run.mjs` computes the same proof from its worker's answer and runs no proof re-run (Non-Goals).
- **Relay wording.** The skills say "spawn with the printed prompt as its whole prompt", which is the settle fixer's wording, replacing the pinned "use it verbatim".
- **Meter kinds.** The new fenced `interlock review brief` and `interlock review proof` lines get kinds in the settle meter's keyed-line table, as the meter spec requires of every fenced `interlock` line.
- **One always-on list.** `ALWAYS_ON_DIMENSIONS` in `lib/prompts/dimensions.mjs` takes the strict set from a `lib/routing.mjs` export instead of keeping its own copy, so `lib/routing.mjs` stays the one reader of `REVIEW_DEPTH` (`test/spine/limits.test.mjs:854`).
- **`resolveReview` is unchanged.** `coverage` and `proof` are added by `reviewCommand` (`lib/review-cli.mjs`) around it, so its key-set snapshot (`test/spine/review-core.test.mjs:1049-1050`) holds.
- **The smoke inventory.** The new subcommands join `scripts/postinstall-smoke.mjs` `INVENTORY`, which `test/spine/cli-inventory.test.mjs` checks.

**Where the code goes.**
- **Out of `bin/interlock`.** The existing `review` case (about 4.3 KB, `bin/interlock:3794`) moves into a new `lib/review-cli.mjs` `reviewCommand`, dispatched the way `settleCommand` is (`bin/interlock:206`, `:4100`), and `review proof` and `review brief` live there. That frees `bin/interlock` rather than growing it. The handful of helpers the case uses that exist only in `bin/interlock` (input readers, `die`, the policy reader, the metrics writer) pass in through the `io` object, as `settleCommand(cliIo, …)` already receives them, or move to `lib/` where they are pure.
- **Out of `lib/run.mjs`.** The proof and the `REVIEW NOT PROVEN` banner text come from `lib/review-proof.mjs`, and the run only calls them.

### §5. Degraded inputs are spoken and move the verdict (D5, D6)

**Domain ordering (D6).** Selected capabilities sort by linked changed-file count, descending, then name, so the capability the diff changes most is cut last.
- **The cut lives on the assembled text.** It is the existing `assembled.omitted`, which already feeds the run banner and the `requirements-omitted` flag. It never goes on `selection.partial`, because `selection.partial` flows through `buildLivingChecklist` into the living checklist's `no-graph` flag (`lib/merge-confidence.mjs:703`), which would misreport a cut as a missing graph.
- **What the CLI reports.** The verb's `partial` is the selection's reason or the cut, whichever applies, worded exactly as `lib/run.mjs:1895-1910` already words the run banner, and it names any capability left with nothing. A review that ran `domain` on a cut text records `domain` under `degraded`: review-code writes that entry when `domain-context` reports a non-empty `omitted`.
- **All three callers.** Selection and assembly have three callers, and all three get the change: the CLI verb, `lib/merge-evidence.mjs:241`, and `lib/run.mjs:1838`.

**Graph-free selection.** When a changed source file is absent from the graph, the selection also takes capabilities whose living spec text cites it (`via: cited`), using the same path-mention scan the graph's OpenSpec extractor uses, and lists the file under `ungraphed`.

**Graph coverage (D5).**
- **The check.** A new `interlock-graph covers --changed` compares the given paths with `manifest.files` hashes. It exits 0 when covered, 1 when stale and 3 when there is no graph.
- **The update.** `review-code` runs `covers --update` before the fan-out. On exit 1 alone the CLI runs `interlock-graph update` once and checks again, so the retry count is the CLI's (D20). On exit 3 the skill prints `BLAST RADIUS SKIPPED` as today and builds nothing, which keeps the existing no-graph rule.
- **When it still fails.** If the graph still does not cover the diff, the skill prints `GRAPH STALE:`, runs blast radius on what it has, and records `blast-radius` under `degraded` with the files, which the verdict flags as `blast-radius-partial`.

Updating is chosen over refusing because the update is incremental and local, and a refusal would leave the user with no blast radius at all.

### §6. An archived change resolves read-only (D4)

`resolveChange(root, name, { archived: true })` tries the active change, then `openspec/changes/archive/<YYYY-MM-DD>-<name>/` (the latest date when several match), and returns `{ name, dir, archived: true }`.

**Who opts in.** Only the read paths:
- `buildChecklist` (`lib/conformance.mjs`);
- `gatherMergeEvidence` (`lib/merge-evidence.mjs:379`) and its artifact readers (`:253`, `:300`);
- the `domain-context` verb (`bin/interlock` ~3910, ~3950) and the `merge-confidence` verb (~3480);
- `settle conformance-brief`;
- `review brief`;
- `note-cli` (`lib/note-cli.mjs:67`).

Every one of them that joins `openspec/changes/<name>` (`inspectChange` in `lib/artifacts.mjs:267`, `readLedger`, the evidence templates) takes the resolved `dir` instead.

**Who keeps excluding the archive.** `listChanges`, the no-name default, `ready`, `run start`, `drift` and every writer keep the default, so an archive never becomes an active change.

**How settle finds it.** The settle skill derives the name when no active change resolves, and the classification is the CLI's (D21): it pipes `git diff --name-status -M <base>...HEAD`, read with no pathspec, into `interlock settle archived-change --name-status -`. A pathspec on the archive tree would hide the rename sources and report every file of a renamed directory as `A`. The verb treats an archive directory with any `R` path from `openspec/changes/<name>/` as a rename, an added `settle-summary.md` inside it included, prints the one archive directory whose every path is `A` as the change, and exits 1 naming the candidates when two qualify or none does. On PR #28 that is `draw-the-settle-and-spec-panes-as-cards`; `route-prose-spawns-by-role` and `agree-with-openspec-1-15` are `R100` renames, each with an added summary. The skill prints `CHANGE READ FROM ARCHIVE:`, and asks when the verb exits 1 naming two directories (D21). The tree check tolerates `settle-summary.md` in the archived directory. The staging line excludes it by reading its pathspecs from `interlock settle staging-pathspecs --nul` (D18), because a static line cannot spell a dated directory (`settle-loop` tree-check requirement, MODIFIED). The pathspecs are written to a file first, and the round fails on a non-zero exit or an empty file, because `git add -A --pathspec-from-file` reads an empty list as the whole tree (checked on git 2.54).

### §7. Pin the miss twice: deterministic fixtures first, a recall eval second (D9)

Section 1 of the tasks lands fixtures built from PR #28's own records:
- the four empty dimension answers;
- the changed files at `e177e7d`;
- the round-0 review record;
- the domain-context selection with `hooks/spec-meter` cut to nothing;
- the archived change.

Tests assert today's wrong answers turn right:
- the proof names four unproven dimensions and four uncited files;
- `review.ran` is amber and the verdict is not `MERGE`;
- the comment opens `REVIEW NOT PROVEN`;
- the cut sets `partial`;
- the archived change resolves.

They fail on the current code, which is the repro. The same section updates, by name, every existing pin whose meaning the specs change, and no other test.

`evals/review-recall-pr28/` grades a real review's recall with regex graders for M1, M2 and B1. Its scaffold fetches `251cebe` and `e177e7d` explicitly, because the eval job's clone is shallow and holds neither, and clones at `e177e7d`. Its `allowed_tools` are the read and run tools the review needs, in the set `test/evals.test.mjs` pins.
- **Suite.** It is a full-suite case, because one review costs more than the smoke cap.
- **Cost.** It runs in the full job (D15, needs a human). That job already runs every case under one `--max-cost-usd` read from `EVAL_CAPS.fullRunCostUsd`, and its share is already past that cap, an owner decision pending since 2026-10-21. The cap is not changed here; the case's own `max_turns` and timeout bound one run.
- **When it runs.** It is metered only where a credential exists. That is today's state for every metered job, and the structural gate still runs on every pull request.

## Risks / Trade-offs

- **[Verdicts move for every user: records without proof read `HUMAN`]** → Intended, and named in the CHANGELOG as a minor version with the reason and the one-line fix (re-run the review on this version). D2 lets the owner choose a softer path before ship.
- **[A reviewer fabricates `checked` entries to look proven]** → The CLI checks each entry's shape and counts coverage only against changed files, so a fabricated path to a file outside the diff covers nothing. Quality stays the eval's job, and the comment's coverage line makes thin coverage visible to a person.
- **[Cost: one more dimension at both depths, plus at most `maxProofReruns` re-runs per unproven dimension]** → Both are published numbers. The lean set stays smaller than strict, and re-runs are scoped to the unproven dimensions only.
- **[`roleOf` attribution breaks if an assembler puts a fixer- or worker-shaped first line ahead of the heading]** → A test classifies every printed dimension and skeptic prompt, under the amended meter requirement.
- **[`interlock-graph update` in a worktree writes the primary working tree's graph]** → Run it where `graphRootFor` resolves, and on failure take the spoken degraded path; never fail the review.
- **[Domain reordering changes which requirements a reviewer sees for an existing diff]** → The record lists the order with counts; a cut still says what it cut.
- **[Moving the `review` case out of `bin/interlock` could change its behaviour]** → The existing `review` tests in `test/spine/cli.test.mjs` run unchanged against the moved code before anything new is added to it.

## Migration Plan

1. Land §7's failing fixtures and the pin updates, then the implementation (proof, verdict, comment, briefs, domain, graph, archive, run, skills, eval), then docs. Ship as one minor version.
2. The CHANGELOG states every behaviour change, each in its own bullet:
   - a record without proof reads `HUMAN`, and should be re-reviewed on this version;
   - `regression` is a new always-on dimension at both depths, at one more agent per review, so a ship run selects five;
   - a rejected ledger is spoken as `LEDGER REJECTED:` and recorded unproven;
   - `dimensions-unrecorded` is retired, and `domain-partial` and `blast-radius-partial` are added;
   - the settle comment's clean sentence now requires proof, and `REVIEW NOT PROVEN` replaces it otherwise;
   - blast radius is judged per hunk;
   - an archived change is read from the archive;
   - the review re-runs unproven dimensions.
3. `docs/07` (around lines 149 and 200) and `docs/10` (around line 219) are updated where they describe the old behaviour.
4. Rollback: revert the change. Records written with `coverage` and `proof` still read under the old reader, which drops unknown keys, so no stored record becomes unreadable.

## Open Questions

- Whether a per-review recall skeptic is worth its cost at strict depth, measured against `evals/review-recall-pr28` once a credential exists.
