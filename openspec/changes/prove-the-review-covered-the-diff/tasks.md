# Tasks

## 1. Failing tests first

- [x] 1.1 Land the PR #28 repro as failing tests, and update every existing pin whose meaning the delta specs change, in one pass.

  **Fixtures.** Add under `test/fixtures/review-proof/pr28/`:
  - the four round-0 dimension answers (`{ "findings": [] }`, no coverage);
  - the changed-file list at `e177e7d` against `251cebe`;
  - the round-0 review record (head `e177e7d`);
  - a domain-context input whose selected capabilities exceed the cap so every `hooks/spec-meter` requirement is cut.

  **New failing assertions.**
  - `test/spine/review-proof.test.mjs` (new):
    - **The PR #28 proof:** it names the four dimensions unproven and `lib/settle-meter.mjs`, `lib/spec-meter.mjs`, `lib/meter-palette.mjs` and `hooks/mod.mjs` uncited.
    - **What counts:** an unread input lands in `proof.unread`; a cited path outside the diff covers nothing; a carried ledger's entry on a file changed since its head covers nothing; `--changed` is unioned with git's list; neither `--changed` nor `--base` is not proven; a malformed ledger is `LEDGER REJECTED:` and unproven, exit 0.
    - **The re-run answer:** `review proof` exits 1 with a first line `re-run: <dimensions>`, 0 with a first line `proven`, 0 with a first line `PROOF CAP REACHED: <dimensions>` once the record's `proof.reruns` has reached the published cap with gaps left, and 2 on a broken file; `proven` wins at the cap; a record with no `proof.reruns` reads 0; an uncited-only record re-runs `regression` naming the files when `regression` ran, and the first ran dimension of a scoped review's `--dimensions` when it did not.
    - **The merge:** a `--rerun-of` write replaces the answer of a dimension the draft named unproven or unread, appends to one re-run for uncited files alone so a `regression` blocker of the draft survives it, keeps every verdict of the draft so each first-pass blocker and warning keeps `minVerdictsPerFinding` verdicts, raises `proof.reruns` by one only when the write carries answers, and leaves it unchanged on the promote write (no `--findings`); a draft carries `inputs`, the final record does not; a scoped draft written with `--carry` counts the carried ledgers.
  - `test/spine/cli.test.mjs`:
    - **The record:** `review` keeps `coverage` and writes `proof`; a `degraded` entry for a dimension other than `domain` or `blast-radius` is refused.
    - **The dimension prompt:** `review brief --dimension regression` prints the rubric, a `# Dimension: regression` line, the changed ranges, the proof rules and the ledger shape; it says the reviewer writes nothing, and that a requirement the cap left out is `degraded`, not `unread`; an unknown name exits 1 listing the bundled names; no printed prompt says not to run tests.
    - **The skeptic prompts:** `review brief --skeptics --json` prints `prompts` entries carrying each skeptic's whole brief, prints `{ "prompts": [] }` with nothing to judge, exits 1 without `--json`, and with `--rerun-of <draft>` drops the finding ids the draft holds verdicts for.
  - `test/spine/review-core.test.mjs`: a `regression` finding outside the diff is refuted by a citation of its own file, and the `architecture` case at :509 still is not.
  - `test/spine/merge-confidence.test.mjs`:
    - new fixtures `review-unproven-pr28`, `review-unread`, `review-uncited`, `review-no-proof`, `review-domain-degraded` and `review-blast-degraded`, each with an `EXPECT` row;
    - the ran signal is amber for the first four (needing more evidence; verdict not `MERGE`) and green with `domain-partial` / `blast-radius-partial` for the last two.
  - `test/spine/settle-cli.test.mjs`:
    - **Comment:** the PR #28 record prints `REVIEW NOT PROVEN` naming the four dimensions and four files, and never `raised no surviving finding`; an unproven record with findings ends with a `REVIEW NOT PROVEN:` line; a proven empty record keeps the clean paragraph plus the coverage line; `--json` carries `proof`.
    - **Tree check:** `tree-check` tolerates an archived change's `settle-summary.md`.
    - **Staging:** `staging-pathspecs --nul` prints `.` and the `:(exclude)` paths, the archived summary's included, and keeps `toleratedPaths(name)`'s one-argument form (`test/spine/settle-cli.test.mjs:1059`).
    - **Archived change:** `archived-change --name-status -` on the PR #28 name-status (`git diff --name-status -M 251cebe...e177e7d`: two `R100` directories each with an added `settle-summary.md`, one directory whose every path is `A`) prints `draw-the-settle-and-spec-panes-as-cards`; with two all-`A` directories it exits 1 naming both; with none it exits 1.
  - `test/spine/domain-context.test.mjs` and `test/spine/cli.test.mjs`:
    - **The cut:** it sets `partial` naming `hooks/spec-meter` and citing `maxDomainSpecChars`; the human output prints `DOMAIN REVIEW PARTIAL`; the living checklist gets no `no-graph` flag from it.
    - **Selection:** capabilities order by linked count; an ungraphed `lib/settle-meter.mjs` selects `hooks/settle-meter` `via: cited`.
  - A new `test/spine/domain-agreement.test.mjs`: run, CLI and merge evidence select alike; a cut gives the living checklist no `no-graph` flag.
  - `test/spine/artifacts.test.mjs`:
    - an archived change resolves read-only with `archived: true` and its `dir`;
    - `listChanges`, the no-name default, `drift`'s unarchived list and `ready` still exclude it.
  - A new `test/graph/covers.test.mjs`: `interlock-graph covers` lists `lib/settle-meter.mjs` absent from a graph built before it and exits 1; with no graph it exits 3 and `--update` builds nothing.
  - `test/spine/settle-meter.test.mjs`:
    - `roleOf` classifies every prompt the dimension and skeptic assemblers return, called directly, not through the CLI;
    - the `review brief`, `review proof`, `settle staging-pathspecs` and `settle archived-change` lines are their own kinds, never review records;
    - an unproven record's review row reads `not proven`;
    - a `--draft` line is a draft row, not the round's record.
  - `test/spine/run.test.mjs`: a strict close over an unproven review carries one `REVIEW NOT PROVEN` banner; a fix round that re-reviews one dimension carries the others' ledgers; a strict fix round that re-reviews only `technical-lead`, whose worker answers with no finding and a ledger citing the files the fix changed, closes with no `REVIEW NOT PROVEN` banner.
  - `test/spine/prompts.test.mjs`: the review and remediation briefings carry the proof rules and the measure line as `review brief` prints them, and the remediation briefing asks a clean re-review for one ledger per re-reviewed dimension.
  - `test/skills.test.mjs`:
    - **The briefs:** the `regression.md` tokens, and the per-hunk blast-radius tokens (`outside the changed hunks`, `every end path`, `every reader`, `only path`).
    - **The review skill:** its `interlock review brief` and `interlock review proof` lines, with the proof line after the skeptic line, and no blockquoted skeptic brief.
    - **The settle skill:** it holds no `review proof` line; its staging line reads a pathspec file written by `staging-pathspecs` and fails the round when that file is empty; its §2 pipes a `git diff --name-status -M` line with no pathspec into `interlock settle archived-change`, and classifies no name-status line in prose.

  **Existing pins rewritten, each for the requirement that changes it, and no other test edited.**
  - `test/spine/merge-confidence.test.mjs` (merge-confidence ADDED and MODIFIED):
    - give every fixture in `test/fixtures/merge-confidence/` whose review is meant to read green a proof that holds and ledgers, mechanically, in one script (D2: 81 of 82 fixtures);
    - `:296` drops `dimensions-unrecorded` from the `FLAGS` pin and adds `domain-partial` and `blast-radius-partial`;
    - `:356` makes the `review-no-dimensions` `EXPECT` row amber;
    - `:622-628` now asserts a record with no dimension record reads amber, not the `dimensions-unrecorded` flag;
    - the "lean record is named and green" case gains a proof.
  - `test/spine/merge-delivery.test.mjs:682`: its `MERGE` input gains a proof that holds.
  - `test/spine/cli.test.mjs:3248-3279`: the review-to-merge-confidence round trip passes per-dimension answers with ledgers and `--base` (and `--changed`), so its proof holds and it still reads green (merge-confidence MODIFIED head-binding).
  - `test/spine/settle-cli.test.mjs`:
    - `:187` adds `proof` to the `--json` key set;
    - `:210` makes the nothing-survived case carry a proof and the coverage line;
    - `:32` and `:110` add `staging-pathspecs` and `archived-change` to the `SUBCOMMANDS` list (settle-loop MODIFIED and ADDED).
  - `test/spine/run.test.mjs`:
    - `:756`, `:6437`, `:6622`, `:6719` and `:6746`: the four always-on dimensions become the published strict set with `regression` (ship/run-program MODIFIED);
    - `:7330`: the strict close's fake review worker answers with ledgers, so `review.ran` stays green (review-proof, the run's review step).
  - `test/skills.test.mjs`:
    - `outside the diff` and the "inside the diff is not a finding" tokens at :1265-1345 become the per-hunk tokens (blast-radius-dimension REMOVED);
    - `list the eight` at :1216 and :1288 becomes `list the nine`;
    - the dimension-record key list gains `degraded` (blast-radius-dimension MODIFIED);
    - `use it verbatim` at :2323 becomes the relay wording (review-briefs);
    - the §3 skeptic tokens at :2206-2236 are read from the skeptic assembler's prompts, not the skill (review-depth MODIFIED);
    - `SETTLE_STAGE` at :1350, :1523 and :1553-1569, the `STAGE` literal and its `shipped.includes` precondition at :1969-1971, and the doctored staging cases at :2000, :2013, :2014 and :2018 match the `staging-pathspecs` file and `--pathspec-from-file` line instead of the literal `git add -A -- . ':(exclude)…'` line (settle-loop tree-check MODIFIED);
    - the review-code §2 anchors stay: the emit fence (:907-917, :1232-1234), `Spawn one agent per dimension` (:1227, :2214), and the `in review.dimensions` table rows (:2220).
  - `test/spine/settle-meter.test.mjs`:
    - the count of 8 bundled briefs at :1485 becomes 9;
    - the skeptic sentences at :1495-1509 are read from `lib/review-roles.mjs`, not review-code's blockquotes (hooks/settle-meter MODIFIED);
    - the routing fixture at :115, and `test/mod/settle-meter.test.ts:85`, list `regression` in `review.dimensions` where a test compares them with the published table;
    - M15's collectors at :1800-1810 also read `interlock-graph` lines, so the `interlock-graph covers` kind is covered (hooks/settle-meter MODIFIED keyed lines).
  - `test/evals.test.mjs:88-100` and `:207-220`: `EXPECTED_CASES` gains `review-recall-pr28` (evals/case-suite ADDED).
  - `test/spine/prompts.test.mjs:799-802` and `:805-822`: the review briefing's and the remediation briefing's "write `[]`" instructions now ask for the ledger shape, one ledger per dimension, because a bare `[]` is a ran dimension with no coverage, which is unproven (review-proof, the run's review step).

  **A pin found later.** Any other existing assertion found to pin a meaning these delta specs change is updated in the section-2 task that changes that meaning. It is never edited during a remediation stage, and that task's report names the assertion and the requirement. Every other test stays untouched.

  Run `npm test` (output redirected under `$TMPDIR`) and confirm each new assertion fails for the reason it names, not for a missing import, and that only the pins listed here moved.

## 2. Proof, prompts, inputs, run and skills (make §1 green)

- [x] 2.1 Add `skills/review-code/dimensions/regression.md`. It covers:
  - lifecycle start and end, with every end path;
  - state left live and who reads it;
  - deleted or weakened tests;
  - measure-what-you-claim;
  - text outside the changed lines made untrue.

  Rewrite `skills/review-code/dimensions/blast-radius.md` for the per-hunk boundary and the enumerated readers and end paths, each with `path:line` and a count. Verify: `node --test --test-name-pattern 'regression|blast-radius brief' test/skills.test.mjs` passes.
- [x] 2.2 Shared definitions.
  - Add the import-free `lib/review-roles.mjs`, holding the two skeptic opening sentences.
  - In `lib/limits.mjs`, add `regression` to `REVIEW_DEPTH.lean.dimensions` and `REVIEW_DEPTH.strict.dimensions` (D1), and add `maxProofReruns` with its printed row.
  - In `lib/routing.mjs`, export the strict always-on set.
  - Make `ALWAYS_ON_DIMENSIONS` in `lib/prompts/dimensions.mjs` take that export, keeping `lib/routing.mjs` the one reader of `REVIEW_DEPTH`.

  dependsOn 2.1. Verify: `node bin/interlock routing --json` lists `regression` at both depths, `node bin/interlock limits` prints `maxProofReruns`, and `node --test test/spine/prompts.test.mjs` passes, along with the depth-table and single-reader cases of `test/spine/limits.test.mjs`. The cap-authority sweep passes once 2.3 reads the cap.
- [x] 2.3 Add `lib/review-proof.mjs`, a pure module with no I/O that takes the ledgers, the findings, the ran dimensions and a changed-path list its callers computed, and extend `FINDING_SCHEMA` in `lib/findings.mjs` with the optional `coverage`. The module covers:
  - ledger validation, `path:line` / `path:start-end` token shape only, rejecting an entry as `LEDGER REJECTED:` + unproven;
  - `unproven`, `unread`, `uncited` (via `isCoverableSource`, `lib/artifacts.mjs:38`; carried entries on files changed since their head cover nothing) and `proven`; an empty or absent changed list is `proven: false` with the reason `no diff given`;
  - the `review proof` decision and its first line: `re-run: <dimensions>` (the uncited-only target is `regression` when it ran, else the first ran dimension of the review's `--dimensions`), `proven` (which wins at the cap), `PROOF CAP REACHED: <dimensions>` when the record's `proof.reruns` (0 when absent) has reached `LIMITS.maxProofReruns` with gaps left, and exit 2 on a broken input;
  - the `--rerun-of` merge: replace an unproven or unread dimension's answer, append to one re-run for uncited files alone, keep the draft's verdicts and append the new ones, raise `proof.reruns` only when the write carries answers, and drop the finding ids the draft holds verdicts for from a skeptic brief;
  - the `REVIEW NOT PROVEN` banner text.

  dependsOn 2.2. Verify: `node --test test/spine/review-proof.test.mjs` passes, and so does the cap-authority sweep in `test/spine/limits.test.mjs`.
- [x] 2.4 In `lib/review-core.mjs`:
  - widen `evidencePathsFor` (`:167-171`) to the finding's own file for `regression`, as for `blast-radius`;
  - add `degraded` to `readDimensionRecord` as a validated key (names `domain` and `blast-radius` only);
  - carry a carried dimension's ledger and head in `carryForward`.

  `resolveReview`'s return is unchanged. Verify: `node --test test/spine/review-core.test.mjs` passes, its key-set snapshot at :1049-1050 included.
- [x] 2.5 In `lib/merge-confidence.mjs`:
  - `review.ran` reads amber, needing more evidence, for unproven, unread, uncited, no-proof and no-dimension-record inputs, naming each;
  - `degraded` entries add `domain-partial` / `blast-radius-partial` without moving the band;
  - `review.blockers` and `review.warnings` name the proof in their reasons;
  - retire `dimensions-unrecorded` and add the two flags to `FLAGS`;
  - in `docs/15-merge-confidence.md`, write the ran-signal rows, the proof, and flag rows for `domain-partial` and `blast-radius-partial`, and retire `dimensions-unrecorded`.

  dependsOn 2.3. Verify: `node --test test/spine/merge-delivery.test.mjs` passes, and `node --test --test-name-pattern 'fixture|review|flag|docs/15' test/spine/merge-confidence.test.mjs` passes.
- [x] 2.6 In `lib/prompts/domain-context.mjs`:
  - order selected capabilities by linked changed-file count, then name;
  - keep a cut on the existing `assembled.omitted` (never on `selection.partial`), and name a capability left with nothing;
  - select `via: cited` for an ungraphed changed file, using the OpenSpec extractor's path-mention scan, and record `ungraphed`.

  Verify: `node --test test/spine/domain-context.test.mjs` passes (the cross-caller agreement lives in `test/spine/domain-agreement.test.mjs`, verified at 2.14).
- [x] 2.7 In `lib/artifacts.mjs`, add `resolveChange(root, name, { archived: true })` (latest dated archive match, `{ name, dir, archived }`), and make `inspectChange` accept a resolved `dir`. Opt in `lib/conformance.mjs` `buildChecklist` and `lib/note-cli.mjs` (`:67`), passing the resolved `dir` to every reader that joins `openspec/changes/<name>`. Verify: `node --test test/spine/artifacts.test.mjs` passes.
- [x] 2.8 In `lib/merge-evidence.mjs`:
  - `gatherMergeEvidence` (`:379`) and its artifact and ledger readers (`:253`, `:300`) resolve an archived change through 2.7's option;
  - the living-list selection (`:241`) takes the domain ordering, `assembled.omitted` and `via: cited` from 2.6, without turning a cut into `no-graph`.

  dependsOn 2.6, 2.7. Verify: `node --test --test-name-pattern 'archiv|living' test/spine/merge-confidence.test.mjs` passes.
- [x] 2.9 In `lib/settle-cli.mjs`:
  - `commentCommand` renders the coverage line on a proven record and a `REVIEW NOT PROVEN` paragraph or closing line otherwise, plus `proof` in `--json`;
  - `tree-check` tolerates `settle-summary.md` in an archived change's directory;
  - `conformance-brief` prints `CHANGE READ FROM ARCHIVE:`;
  - a new `staging-pathspecs --change <c> --nul` subcommand prints `.` and one `:(exclude)` per tolerated path, with its flags in `lib/cli-flags.mjs` and its entry in `scripts/postinstall-smoke.mjs` `INVENTORY`; `toleratedPaths(name)` keeps its one-argument form, and the archived directory comes as an optional second argument;
  - a new `archived-change --name-status <file|->` subcommand reads `git diff --name-status -M <base>...HEAD` output, treats an archive directory with any `R` path from `openspec/changes/<name>/` as a rename (its added `settle-summary.md` included), prints the one archive directory whose every path is `A` as `{ change, dir, renamed }` with `--json` and as the change name without, and exits 1 naming the candidates when two qualify or none does; flags in `lib/cli-flags.mjs`, entry in `INVENTORY`.

  dependsOn 2.3, 2.7. Verify: `node --test test/spine/settle-cli.test.mjs test/spine/cli-inventory.test.mjs` passes.
- [x] 2.10 Add `interlock-graph covers --changed <files|->` in `lib/graph/`. It compares against `manifest.files` hashes and prints `absent`, `changed` and the build time. It exits 1 when either list is non-empty and 3 when there is no graph. With `--update` it runs `interlock-graph update` once on exit 1 alone, then checks again. Verify: `node --test test/graph/covers.test.mjs` passes.
- [x] 2.11 Add `lib/prompts/review-dimension.mjs` and `lib/prompts/review-skeptics.mjs` and register both in `lib/prompts/index.mjs`.
  - The dimension prompt is the rubric verbatim, then the CLI scope with changed line ranges and the archived change's paths when it applies, then the quoted `REVIEW.md` / `REVIEW_CONTEXT.md` / domain blocks with delimiter neutralising, then the run-and-measure and proof rules (the write-nothing line and the line that a requirement the cap left out is `degraded`, not `unread`, among them), then the ledger emit shape. One exported function renders the rules, the measure line and the emit shape, and 2.14's run briefings call it.
  - The skeptic prompts are `{ prompts: [{ skeptic, findingIds, prompt }] }`. Each opens with its sentence from `lib/review-roles.mjs` and carries:
    - that skeptic's whole brief: refute or assess, the default when uncertain, the score axes and the instruction not to inflate them;
    - the depth's spawn-shape instructions: per-review (`grouped by file`, `one verdict per finding`, `overlapping`, `judged once`) or per-finding (`run it or read it`, `evidence`);
    - the evidence rule;
    - with `--rerun-of <draft>`, only the finding ids the draft holds no verdict for.

  dependsOn 2.1, 2.2, 2.6, 2.7. Verify: `node --test test/spine/prompt-integrity.test.mjs test/spine/prompts.test.mjs` passes.
- [x] 2.12 In `lib/settle-meter.mjs`, give the `interlock review brief`, `interlock review proof`, `interlock settle staging-pathspecs`, `interlock settle archived-change` and `interlock-graph covers` lines their own kinds, never the review record kind. Draw `not proven` with the proof counts on the review row, and import the skeptic role sentences from `lib/review-roles.mjs`, never from the assembler. dependsOn 2.2, 2.9, 2.11. Verify: `node --test test/spine/mod-pins.test.mjs` passes, and `node --test --test-name-pattern 'roleOf|not proven|own kind|draft' test/spine/settle-meter.test.mjs` passes. The roleOf cases call the assemblers directly, not the 2.13 CLI.
- [x] 2.13 Move the `review` case out of `bin/interlock` (`:3794`, about 4.3 KB) into a new `lib/review-cli.mjs` `reviewCommand`, dispatched like `settleCommand` (`bin/interlock:206`, `:4100`). Pass in the bin-only helpers it uses (input readers, `die`, the policy reader, the metrics writer) through the `io` object, or move the pure ones to `lib/`. Run the existing `review` tests unchanged against the moved code first, then:
  - add `coverage` extraction from the `--findings` answers before `flatten()` and the `proof` write, around an unchanged `resolveReview`; compute the changed list as the union of `--changed` and git's list for `--base`, as `lib/merge-evidence.mjs:365-372` does, and pass it to `lib/review-proof.mjs`;
  - add `review proof` and `review brief --dimension|--skeptics`, with flags in `lib/cli-flags.mjs`, usage/help lines, and entries in `scripts/postinstall-smoke.mjs` `INVENTORY`;
  - make `domain-context` print `DOMAIN REVIEW PARTIAL` from `omitted` and `CHANGE READ FROM ARCHIVE:`, and make `merge-confidence` resolve archived changes by name (`bin/interlock` ~3480, ~3910, ~3950).

  `interlock review` takes `--draft` (the record carries `inputs: { answers, verdicts }`) and `--rerun-of <draft>` (the CLI merge of 2.3, `proof.reruns` raised only when the write carries answers; without `--findings` the draft is promoted unchanged), and `review proof` prints its first line with no `--json` form. `bin/interlock` must end smaller than its 245,586 bytes. dependsOn 2.3, 2.4, 2.7, 2.8, 2.9, 2.11. Verify: `node --test test/spine/cli.test.mjs test/spine/package.test.mjs test/spine/cli-inventory.test.mjs test/spine/postinstall-smoke.test.mjs` passes, and `wc -c bin/interlock` is below 245,586.
- [x] 2.14 In `lib/run.mjs`:
  - the run's review worker answers with ledgers: `assembleReviewPrompt` (`lib/prompts/review.mjs`) and `assembleRemediatePrompt` (`lib/prompts/remediate.mjs:134`) render the proof rules, the measure line and the ledger emit shape through 2.11's exported function, and the remediation briefing asks a clean re-review for one ledger per re-reviewed dimension, `{ dimension, findings: [], coverage: { checked, unread } }`, never a bare `[]`; the run runs no proof re-run (design Non-Goals, D24);
  - `dimensionRecord` and the written review record carry `proof` and `degraded` from `lib/review-proof.mjs`;
  - the domain selection (`:1838`) takes 2.6's ordering and `via: cited`, and `DOMAIN REVIEW PARTIAL` and `degraded` read `assembled.omitted`;
  - the run selects the published strict set, `regression` included;
  - a fix round's re-review (`:2026`) carries the ledger of every dimension it did not re-run from the record before, under the stale-file rule;
  - an unproven review pushes one `REVIEW NOT PROVEN` banner into the close's `degradations` (compound note N2).

  The logic lives in `lib/review-proof.mjs` and the domain module; `lib/run.mjs` (241,819 bytes against the 245,760 cap) only calls it. dependsOn 2.2, 2.3, 2.6, 2.8, 2.11, 2.13. Verify: `node --test test/spine/run.test.mjs test/spine/prompts.test.mjs test/spine/package.test.mjs test/spine/domain-agreement.test.mjs` passes.
- [x] 2.15 Rewrite `skills/review-code/SKILL.md`:
  - **§1:** run `interlock-graph covers --update`; on exit 3 print `BLAST RADIUS SKIPPED` as today; on exit 1 print `GRAPH STALE:` and record `blast-radius` under `degraded`.
  - **§2:** spawn every dimension with `interlock review brief --dimension <name>` as its whole prompt, list nine names, and record `domain` under `degraded` when `domain-context` reports `omitted`.
  - **§3, skeptics:** spawn each entry of `interlock review brief --skeptics --json`, and remove the skeptic blockquotes.
  - **§3, proof re-run:**
    1. record a draft (`interlock review … --draft --out <draft>`, no `--metrics`, every other flag of the final write on it, `--dimensions` and `--carry` included; `<out>.draft.json`, or under `.claude/ship/review/` when no `--out` was given);
    2. while `interlock review proof --review <draft>` exits 1: read the dimensions from its first line (`re-run: <dimensions>`), re-run each with its brief, put the re-run answers alone through `interlock review brief --skeptics --findings <re-run answers> --rerun-of <draft> --json`, and write the next draft with `interlock review --rerun-of <draft> --findings <re-run answers> --verdicts <re-run verdicts> --draft --out <next draft>`; the CLI merges, and the skill composes no findings or verdicts file;
    3. when the proof line exits 0, promote the last draft: `interlock review --rerun-of <last draft> --metrics --out <out>`, with no `--findings` and no `--verdicts`.
  - **Throughout:** write no rubric, scope, run rule, count or skeptic text of its own. Keep the §2 emit fence, `Spawn one agent per dimension`, and the `in review.dimensions` table rows. Keep `specGap` out of `regression.md`. The dimension and skeptic spawns are routed as today; the printed prompt's write-nothing and run rules bound the agent, since this skill's `allowed-tools` do not reach an agent it spawns.

  dependsOn 2.1, 2.10, 2.12, 2.13. Verify: `node --test --test-name-pattern 'review-code|blast-radius|skeptic|dimension|specGap' test/skills.test.mjs` passes, and so does `node --test --test-name-pattern 'roleOf' test/spine/settle-meter.test.mjs`.
- [x] 2.16 Update `skills/settle/SKILL.md`:
  - **§2:** when no active change resolves, pipe `git diff --name-status -M <base>...HEAD` (no pathspec) into `interlock settle archived-change --name-status - --json`, take its `change`, print `CHANGE READ FROM ARCHIVE:`, and ask when it exits 1 naming two candidates; classify no name-status line in prose.
  - **§5a and §5c:** post each comment from the record review-code wrote after its own proof re-run, and run no `review proof` line.
  - **Staging:** write the pathspecs with `interlock settle staging-pathspecs --change <change> --nul > .claude/ship/settle/pathspecs-r<r>`, then `test -s` that file; stage with `git add -A --pathspec-from-file=.claude/ship/settle/pathspecs-r<r> --pathspec-file-nul` only when it is non-empty; otherwise print `ROUND FAILED:` and stop early.
  - **§8:** write the summary into the archived directory when the change is read from the archive.

  dependsOn 2.9, 2.13, 2.15. Verify: `node --test --test-name-pattern 'settle' test/skills.test.mjs` passes, and so does `node --test test/spine/settle-meter.test.mjs`.
- [x] 2.17 Add `evals/review-recall-pr28/`:
  - `case.yaml`: schema version, provenance citing PR #28 and comments 6471123715, 6471559316 and 6471618730, full-suite tags (D15), the `allowed_tools` the review needs within the set `test/evals.test.mjs` pins, and `max_turns` and a timeout that bound one run;
  - a scaffold that fetches `251cebe` and `e177e7d` (the eval job's clone is shallow) and clones at `e177e7d`;
  - deterministic regex graders for M1 (the drift line is a settle run's only end), M2 (rows cut at the card floor) and B1 (`settleWatching` readers after any load).

  Verify: `node --test test/evals.test.mjs` passes.

## 3. Documentation and the full check

- [x] 3.1 Update the documentation, restating no threshold value.
  - `docs/07-cli-and-configuration.md`, around 149 and 200: `review proof` (its first line), `review brief`, `review --draft` and `--rerun-of`, `settle staging-pathspecs`, `settle archived-change`, `interlock-graph covers`, archived reading, and `.claude/graph/REVIEW_CONTEXT.md` as an optional input (quoted as data when present, and its absence said, not an error).
  - `docs/10`, around 219: five always-on dimensions.
  - `README.md`: the dimension list.
  - `CHANGELOG.md` `[Unreleased]`, one bullet each:
    - a record without proof reads `HUMAN`, and should be re-reviewed;
    - `interlock-graph covers` exits 3 with no graph;
    - `regression` is always-on at both depths, so a ship run selects five;
    - `LEDGER REJECTED:`;
    - `dimensions-unrecorded` is retired, and `domain-partial` and `blast-radius-partial` are new;
    - the settle comment's `REVIEW NOT PROVEN` and coverage line;
    - blast radius is judged per hunk;
    - an archived change is read from the archive;
    - review-code re-runs unproven dimensions;
    - the staging line reads `staging-pathspecs`;
    - the settle loop resolves an archived change through `settle archived-change`.

  Verify: `node --test test/retired-names.test.mjs` passes.
- [x] 3.2 Run the full check and paste the output: `npm test` (output under `$TMPDIR`), `npm run validate`, and `openspec validate prove-the-review-covered-the-diff` on OpenSpec 1.15.0. Then confirm the repro end to end: `node --test --test-name-pattern 'pr28' test/spine/merge-confidence.test.mjs test/spine/settle-cli.test.mjs test/spine/review-proof.test.mjs` passes, and those tests read `review.ran` amber naming the four dimensions.

## Workflow follow-up

- After merge, re-run `/interlock:settle --review` on PR #28's branch (or its successor) on the new version and compare its findings with comments 6471559316 and 6471618730.
- Once a model credential exists, run `evals/review-recall-pr28` and record its score; use it to decide whether a per-review recall skeptic is worth adding at strict depth (design Open Questions).
