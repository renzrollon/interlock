## 1. Failing tests first

- [x] 1.1 Write `test/spine/review-advisor.test.mjs` against the not-yet-existing `lib/review-advisor.mjs` and `lib/advisor-kit.mjs`:
  - **ids and checks.** `checkFlags(draft, index, limits)` numbers kept flags `F<n>` by draft position, ignores any id the draft carries, validates first and caps second. Drop reasons:
    - `unknown kind`
    - `missing field` (empty `why` or `check`)
    - `no such dismissal` for a `D<n>` absent from the index
    - `needs two or more survivors` for a `shared-root-cause` with fewer than two distinct `S<n>`
    - `path not changed` for an `uncovered` path outside the changed list, compared through `canonicalizePath`
    - `over cap` beyond `LIMITS.maxReviewAdvisorFlags`
  - **ordering.** A draft whose first flag is invalid, followed by more valid flags than the cap, keeps the first cap-many valid ones.
  - **empty and malformed drafts.** An empty `flags` array is `drafted`, with the tables reading `none`. A non-object draft is did-not-run with `draft is not a JSON object`, and a non-array `flags` is did-not-run with `flags is not an array`.
  - **rendering.** `renderReviewAdvisor(result, { change, stamp, briefPath, index })` reads no clock. It writes the status line, `## Flags` (id, kind, targets with their finding titles or paths, why, check), `## Dropped` and a closing line saying no gate reads the file. A literal `|` in `why` is escaped.
  - **did-not-run.** The did-not-run stanza carries its reason, and `no reason given` for an empty one.
  - **module purity.** `lib/review-advisor.mjs` and `lib/advisor-kit.mjs` contain no `Date.now`/`new Date`.
  - **verdict tally.** `verdictFromLabels(dir, LIMITS, { prefix: 'review-range-', graders: ['matches-label', 'repeats-survivor'], … })` counts only `review-range-*` cases. With no options it returns what it returned before this change on a tree holding both families.
- [x] 1.2 Write `test/spine/review-advisor-brief.test.mjs` against the not-yet-existing `lib/prompts/review-advisor.mjs` and `lib/prompts/brief-kit.mjs`:
  - **ids.** The assembler lists survivors `S<n>` and dismissals `D<n>` in input order. Under each dismissal it prints every matched verdict's `isReal`, `reasoning`, `evidence` and `refinedSeverity`, and the vote counts.
  - **other sections.** It lists quality drops, and policy drops with `excludedBy`. It prints per-dimension counts, the changed paths, the cap, the three kinds with their targets, the reply shape, and the raise-only instruction.
  - **quoting.** It quotes finding text as data, with a fence longer than any backtick run inside.
  - **cuts.** Under `LIMITS.maxReviewAdvisorBriefChars` it cuts policy drops, then quality drops, names them under `## Omitted`, and never cuts survivors, dismissals or instructions. When those alone exceed the cap, it adds `cap exceeded by <n> chars` and `overrun: <n>`.
  - **determinism.** The same input yields the same bytes.
  - **index.** `indexOf(input)` returns `{ change, stamp, survivors, dismissed, changed }`.
  - **purity.** Neither file imports `node:` or reads a clock.
  - **registry.** `lib/prompts/brief-kit.mjs` is in `NON_ASSEMBLER_MODULES`, and the review-advisor assembler is registered in `PROMPTS` with its inputs.
- [x] 1.3 Extend `test/spine/review-core.test.mjs`. `verdictsFor(finding, verdicts)` returns the file-qualified verdict set when one exists, else the title-only set, else `[]`, with the file trimmed. For the same input, `resolveReview`'s output is deep-equal to its output before the export.
- [x] 1.4 Extend `test/spine/cli.test.mjs`.
  - **`interlock review --advisor-brief <change> --json`.**
    - On a fixture with one dismissal, it writes `.claude/metrics/review-advisor-brief-<change>-*.md` and the `.json` index, and prints `advisorBrief: { written: true, path, index, chars, omitted, overrun }`.
    - When `.claude/metrics` cannot be written, it warns `advisor brief not written:`, sets `written: false` with a `reason`, and keeps the exit code of the same review without the flag. An unresolved change behaves the same way.
    - Without the flag there is no `advisorBrief` key.
  - **`interlock review-advisor <change> --check - --json`.**
    - Fed a valid draft on stdin, it prints `{ step: "check", change, status: "drafted", flags: [{ id, kind }], dropped, draft, path }`, persists the draft under `.claude/metrics/review-advisor-<change>-*.json`, and writes `openspec/changes/<change>/review-advisor.md`.
    - Non-JSON stdin gives `status: "did-not-run"` and exit 0.
    - No index gives did-not-run with `no brief index for <change>`.
  - **`--check --failed "<reason>"`.** Exits 0 with did-not-run.
  - **unresolved change.** Exits non-zero with `error` and `candidates`.
  - **`--verdict --labels <dir> --json`.** Prints `{ step: "verdict", verdict, labelled, matches, repeats, caps, problems }` and exits 0.
  - **checkpoint verdict.** `interlock advisor --verdict` output is unchanged.
  - **usage.** `--help` lists `interlock review-advisor` and `--advisor-brief`.
  - **limits.** `interlock limits` and `--json` carry the four new caps.
- [x] 1.5 Extend the pins in other suites:
  - **`test/spine/artifacts.test.mjs`.** Modelled on its advisor block: the decisions of `gate`, `autonomy record`, `note derive`, `ready`, `validate`, `ledger` and `merge-confidence` are byte-identical with and without a drafted `review-advisor.md`, and none names it.
  - **`test/spine/spec-meter.test.mjs`.** `lineKind` gives no `advisor` kind for `interlock review-advisor x --check - --json`, and `writeOf` files `.claude/metrics/review-advisor-x-20261022-101010.json` as no draft.
  - **`test/spine/plugin-agents.test.mjs`.** `agents/review-advisor.md` has `name: review-advisor`, `model: opus`, tools `Read` only, the six disallowed names, no `effort`, a one-line description containing `consult step` and `brief`, and no `Never invoke`.
  - **`test/skills.test.mjs`.** Review-code's flag table names `--advisor`. A `## 4a.` section carries, after `interlock note derive` and before `## 5. `, in this order:
    1. `--advisor-brief`
    2. `subagent_type: "interlock:review-advisor"`
    3. a fenced `interlock review-advisor "<change>" --check - --json`
    4. a fenced `--check --failed`

    The tokens `never retried` and `no change folder` are present. §5 names `review-advisor.md`. The review line keeps `--metrics` and `--base`, and no file under `skills/` contains `opus`.

  Then run `npm test` and confirm every new assertion is red against the current tree, while the existing checkpoint-advisor assertions stay green.
- [x] 1.6 Extend `test/evals.test.mjs`:
  - **Case names.** `EXPECTED_CASES` gains `review-range-briefing-label-path`, `review-range-doctor-openspec-probe`, `review-range-preflight-closer`, `review-range-advisor-check-exits`, `review-range-notes-path-skipped` and `review-range-halt-card-band`.
  - **Per-case block.** A Review Range block asserts, per case:
    - **case.yaml:** `runs: 1`, `provenance` naming the fix sha, and `exercises` naming `agents/review-advisor.md` and `skills/review-code/SKILL.md`. `allowed_tools` is `[Agent, Bash, Glob, Grep, Read]` with no `Write`. There is no smoke tag, and an executable `fixture.sh` is present.
    - **fixture:** holds `review/findings.json`, `review/verdicts.json` and `openspec/changes/<slug>/proposal.md`, and no `review-advisor.md`.
    - **label.md:** carries `fix:`, `introduced:`, `file:`, `dismissed:` and `bug:`.
    - **live review:** running `interlock review` over the fixture's files places the `dismissed:` title in `dismissed` and leaves at least one survivor.
    - **the fix is absent:** the fixture's copy of `file:` differs from `git show <fix>:<path>`. When git history is absent, skip this check with a reason.
    - **graders:** the five are `check-drafted` (`regex`, pattern requiring `"step": "check"` and `"status": "drafted"`), `consult-spawned` (`tool_used`, `interlock:review-advisor`, `arm: with-only`, `max: 1`), `check-ran` (`tool_used`, `review-advisor` and `--check`), `matches-label` (`llm`, focus file `openspec/changes/<slug>/review-advisor.md`, the `dismissed:` title in its body) and `repeats-survivor` (`llm`, focus trace).
  - **Docs.** `docs/14-evals.md` has a Review Range section carrying `interlock review-advisor --verdict` and `interlock limits`, and none of the new cap names or values.

## 2. Pure modules and caps (make §1 green)

- [x] 2.1 `lib/limits.mjs`: add `maxReviewAdvisorFlags: 10`, `maxReviewAdvisorBriefChars: 160_000`, `reviewAdvisorVerdictMinLabels: 6` and `reviewAdvisorKeepMinMatches: 2` (D14, values pending owner confirmation at the checkpoint). Give each a JSDoc naming its reader, and add one `formatLimits` row per cap.
- [x] 2.2 Lift the shared helpers. Create:
  - `lib/prompts/brief-kit.mjs`: `oneLine`, `quote`, the `## Omitted` renderer, and `fitSections(sections, cutOrder, cap, render)`, the cut-and-overrun loop. Add it to `NON_ASSEMBLER_MODULES` in `lib/prompts/index.mjs`.
  - `lib/advisor-kit.mjs`: `table`, `didNotRunStanza(reason, { title, closing, status })`, and `keepThenCap(items, validate, cap)`, which returns kept items with positional ids and dropped items with reasons.

  Rewrite `lib/prompts/advisor.mjs` and `lib/advisor.mjs` to import them, and give `verdictFromLabels` the `{ prefix, graders, minLabels, keepMin, repeatMax }` options defaulting to today's values. The existing advisor assertions in `test/spine/advisor.test.mjs`, `test/spine/advisor-brief.test.mjs` and `test/spine/prompts.test.mjs` pass unedited.
- [x] 2.3 `lib/review-core.mjs`: export `verdictsFor(finding, verdicts)` built on `matchKeys`/`verdictKey`, leave `resolveReview`'s output unchanged, and correct the stale docstring about verdicts carrying no file.
- [x] 2.4 Create `lib/review-advisor.mjs`. It depends on 2.2 for `advisor-kit` and on 2.1 for the caps. It holds:
  - `FLAG_KINDS`
  - `checkFlags(draft, index, limits)`, using `keepThenCap` and `canonicalizePath` from `lib/risk.mjs`
  - `renderReviewAdvisor(result, { change, stamp, briefPath, index })` and `reviewAdvisorDidNotRun(reason, { change, stamp })`
  - `reviewVerdict(evalsDir, limits)`, which calls `verdictFromLabels` with the Review Range prefix, graders and caps
- [x] 2.5 Create `lib/prompts/review-advisor.mjs`. It depends on 2.2 for `brief-kit` and on 2.3 for `verdictsFor`. It holds:
  - `assembleReviewAdvisorBrief(input)`, whose input is the resolved buckets, the raw verdicts, the changed paths, the caps, and the stamp and paths chosen by the caller
  - `indexOf(input)`

  Register it in `PROMPTS` in `lib/prompts/index.mjs` with its inputs.

## 3. CLI, agent, skill and docs (make §1 green)

- [x] 3.1 Create `lib/review-advisor-cli.mjs`, modelled on `lib/advisor-cli.mjs`:
  - **`reviewAdvisorBrief(io, root, change, result, verdicts, changedPaths, flags)`.** Resolves the change, chooses the stamp, and writes the `.md` brief and the `.json` index under `<root>/.claude/metrics/`. On any failure it returns `{ written: false, reason }`.
  - **`reviewAdvisorCheck(io, root, change, flags, json)`.** Supports `--check -`: it reads stdin and persists it to `.claude/metrics/review-advisor-<change>-<stamp>.json` (a persist failure omits `draft` and continues). It supports `--check <file>` and `--check --failed`, reads the newest index by stamp, writes `openspec/changes/<change>/review-advisor.md`, and exits 0 whenever the change resolves.
  - **`reviewAdvisorVerdict(io, root, flags, json)`.**

  In `bin/interlock`:
  - after the `--metrics` block in `case 'review'`, add one call when `flags['advisor-brief']` is set, plus a `warn` on `written: false` and the `advisorBrief` field in the emit
  - add `case 'review-advisor':` with one-line dispatch
  - add USAGE lines

  Confirm `bin/interlock` stays under the headroom pin in `test/spine/package.test.mjs`.
- [x] 3.2 Create `agents/review-advisor.md` with:
  - frontmatter `name: review-advisor`, `model: opus`, `tools: Read`, `disallowedTools: Skill, Agent, Bash, Write, Edit, mcp__*`
  - a one-line description: spawned by the review-code skill's consult step with the path of a CLI-assembled brief, replies with the JSON the brief specifies, not useful without a brief
  - a body saying: read the one brief path and nothing else; reply with the JSON object only; target each flag at ids or paths the brief lists; stay within the stated cap; raise and never decide
- [x] 3.3 `skills/review-code/SKILL.md`:
  - add `--advisor` to the flag table
  - insert `## 4a. Consult: the review-findings advisor` after §4's note-derive line and before `## 5. `. Run it only with `--advisor` and a resolved change, else say `did not run: no change folder`. Its steps:
    1. add `--advisor-brief <change>` to the review line
    2. read `advisorBrief.path`
    3. make one Agent call with `subagent_type: "interlock:review-advisor"` whose prompt names that path only
    4. pipe the reply to the fenced `interlock review-advisor "<change>" --check - --json`
    5. on `written: false`, an errored spawn or no reply, use the fenced `interlock review-advisor "<change>" --check --failed "<reason>" --json` instead
  - state that the consult is never retried, reads no other file and never changes the gate's verdict
  - in §5, report the flag ids and kinds and the `review-advisor.md` path, or `did not run` with the reason
  - name no model and no cap
- [x] 3.4 Docs and changelog:
  - `docs/07-cli-and-configuration.md` documents `interlock review --advisor-brief` and `interlock review-advisor`
  - `docs/10-agentic-workflow-ship-and-spec.md` mentions the opt-in consult where it describes review-code
  - `CHANGELOG.md` gains an entry under `## [Unreleased]`

## 4. Review Range cases (make §1 green)

- [x] 4.1 Author `evals/review-range-advisor-check-exits/` in full as the template:
  - **`case.yaml`.**
    - `schema_version`, `name`, and `provenance` naming `133aa8a` and `590ebae`
    - `exercises: [agents/review-advisor.md, skills/review-code/SKILL.md]`, `runs: 1`, `context.scaffold_script: fixture.sh`
    - a prompt running the review line with `--advisor-brief advisor-check-exits` over `review/findings.json`, `review/verdicts.json` and the changed file, then one spawn, then `--check -`, then a report of the check JSON
    - `allowed_tools: [Agent, Bash, Read, Glob, Grep]` and no smoke tag
  - **`fixture.sh`.**
  - **`fixture/`.**
    - `bin/interlock` as of `590ebae`
    - `openspec/changes/advisor-check-exits/proposal.md`, from the commit's intent
    - `review/findings.json`: the real bug (`advisor --check` exits non-zero instead of recording did-not-run), a decoy, and a survivor
    - `review/verdicts.json`: two skeptics dismiss the real bug citing a resolvable but irrelevant `bin/interlock:<line>`, both dismiss the decoy correctly, and the survivor keeps its real votes
  - **`label.md`.**
  - **The five graders.**

  Confirm with `node bin/interlock review … --json` that the labelled title lands in `dismissed`. No live eval run here; the first paid run is the owner's step.
- [x] 4.2 Author the other five cases from 4.1's template (depends on 4.1): `briefing-label-path` (`be8a234`), `doctor-openspec-probe` (`cb6313a`), `preflight-closer` (`cb6313a`), `notes-path-skipped` (`133aa8a`) and `halt-card-band` (`29ede89`), each with the file and line the design's table names.
  - Add one `## Deferred` row per judged grader (twelve) to `evals/CALIBRATION-DEFERRALS.md`. Each row says the case has never run, and expires on the first run that produces transcripts.
  - Add the Review Range section to `docs/14-evals.md`: what the cases plant and grade, that `--scaffold` is required, that labels under `evals/review-range-*/calibration/` are what `interlock review-advisor --verdict` reads, and that the caps live in `interlock limits`. It states no threshold value and no case count.
