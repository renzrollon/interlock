# Tasks

Test-first. Section 1 writes failing tests, one checkbox per test file or pair of files. Each test file is owned by the one section-2 task that turns it green, which runs it in its own Verify. No section-2 task runs another task's section-1 file.

**Guards.** A test marked *(guard)* pins behaviour that already holds and must keep holding through the change, such as an unknown heading staying ignored or `--depth` winning over a caller. It passes before section 2 runs. Every other new test fails until its owner lands, so each section-1 Verify reads "fails on the new tests, guards aside".

**Bounded pin rule.** An assertion that pins a meaning the delta specs change is updated in the task that changes that meaning, never during a remediation stage (the test guard denies test edits there). The update names the assertion and the requirement it now pins. The pins known today:

| Pin | Task that updates it |
|---|---|
| `test/spine/review-policy.test.mjs:56`: the empty policy's whole-object `deepEqual` | 2.1 |
| `test/spine/limits.test.mjs:993-1000`: the routing-table reader pin | 2.2 |
| `test/spine/metrics.test.mjs:44`: the payload's keys | 2.5 |
| `test/skills.test.mjs:2911-2941`: the review-artifacts `--since` and Output section tokens | 3.1 |
| `test/skills.test.mjs:2943-2967`: the review-artifacts Depth tokens | 3.1 |
| `test/skills.test.mjs:3104-3108`: the `decisions.md` read, which follows its text into `rubric.md` | 3.1 |
| `test/spine/spec-meter.test.mjs:775-781`: `UNREAD_BY_NAME`, which gains the brief line and each changed routing line, verbatim | 3.1 |
| `test/skills.test.mjs:2968-2973`: spec §5's gate line | 3.2 |
| `test/skills.test.mjs:2672-2680`: spec §1b's spawn sentence | 3.2 |

These stay as they are. `test/spine/review-policy.test.mjs:691` and `test/spine/cli.test.mjs:4267` read a policy without the new fields, and neither compares a whole object. `test/skills.test.mjs:3110-3145` reads the Depth section's typed-spawn tokens, which 3.1 keeps (design §8). `test/skills.test.mjs:867` holds the gate line to ending in `--json`, which the new line does.

A pin found later is handled the same way.

**Shared files.** `cli/interlock` has 3,257 bytes before the headroom pin's zone (design §9). Every task that edits it adds usage lines and dispatch only, and runs `node --test test/spine/package.test.mjs`. The flag sets go in `lib/cli-flags.mjs`.

## 1. Failing tests first

- [x] 1.1 Add failing tests for spec `review/policy-file`'s four new requirements. In `test/spine/review-policy.test.mjs`:
  - `parseReviewPolicy` returns `artifactLenses` and `artifactChecks` from `## Artifact Review Lenses` / `## Artifact Checks` in file order;
  - a threshold-shaped item and a section with no list items each become a problem;
  - a check ending in `?` and one naming `lib/*.mjs` are read as written, with no problem;
  - `## Artifact Lenses` and `## Artifacts Checks` each become a problem naming both known headings; `## Notes` and `## Artifact checks rationale` stay ignored *(guards)*;
  - in a new test beside the one at `:601`, `sectionOfProblem` answers `'artifact'` for every problem the two sections and a misnamed heading report, as is and labelled `(origin/main)`;
  - a policy holding `## Counts as Source` with `- skills/` and an `## Artifact Lenses` heading reports the heading's problem, and `proofSourcePaths` still answers `["skills"]`; `- skills/**` under `## Counts as Source` still answers `null` *(guard)*;
  - `composePolicy` takes both fields from `base`, not `working`;
  - `formatReviewPolicy` prints the lens names and the check count;
  - the shipped `REVIEW.template.md` holds both artifact headings, parses with no problem, and declares neither list.

  In `test/spine/cli.test.mjs`, add a failing test: `review-policy --base <ref> --json` reads `artifactChecks` from the ref, and reports `differsFromBase` when the working copy adds a check. In `test/spine/merge-confidence.test.mjs`, add a failing test: a base `REVIEW.md` holding `## Always Human Review` and an `## Artifact Lenses` heading gives the `policy.humanPaths` signal the band it gives without the heading, and its problems do not name the heading, while the policy parsed at that base does report it.

  Owned by 2.1. Verify: `node --test test/spine/review-policy.test.mjs test/spine/cli.test.mjs test/spine/merge-confidence.test.mjs` fails on the new tests, guards aside.
- [x] 1.2 In `test/spine/routing.test.mjs`, add failing tests for spec `spawn-routing`'s modified `interlock routing <role>` requirement:
  - `resolveRouting('artifact-reviewer', {}, { caller: 'spec' })` answers `depth: 'strict'`, `caller: 'spec'`;
  - `depth: 'lean'` wins over the caller *(guard for the depth; the `caller` field is new)*;
  - `review-dimension` with `caller: 'spec'` answers the published default depth *(guard for the depth)*;
  - an unknown caller, and a caller with no role (`listRouting` with `caller`), throw `RoutingError` of kind `caller` naming `spec`;
  - `formatRouting` prints the caller;
  - `interlock routing artifact-reviewer --caller ship --json` exits non-zero with empty stdout;
  - `interlock limits --json` carries `callerDepth`, and the text carries its row.

  In `test/spine/limits.test.mjs`, add `CALLER_DEPTH` to the reader pin at `:993` (only `lib/routing.mjs` indexes it). Owned by 2.2. Verify: both files fail on the new tests, guards aside.
- [x] 1.3 Create `test/spine/artifact-lenses.test.mjs` with failing tests for spec `spec/artifact-review-brief`'s lens requirements:
  - `selectLenses` honours the order flag → policy → detected → none, with sources `--lens`, `REVIEW.md at HEAD` and `detected: <marker>`;
  - a source of unknown names alone selects none and never falls through;
  - unknown names are returned under `unknown`, and names past an injected `cap` under `capped`, in source order;
  - `detectLenses` maps each of the three harness markers and the UI dependency or tracked-file signals, in the fixed order, and returns `partial` when `uiFiles` is an error.

  Owned by 2.3. Verify: `node --test test/spine/artifact-lenses.test.mjs` fails, since the module does not exist yet.
- [x] 1.4 In `test/spine/metrics.test.mjs`, add failing tests for spec `review/metrics-emission`'s two new requirements:
  - `writeReviewMetrics` writes `stage`, `depth`, `reviewer` and `lenses`, each `null` when absent or outside its vocabulary;
  - `recordFieldsOf` maps `--lenses none` to `[]`, and warns and answers `null` for an unknown value, a flag with no value, an empty value, `none,agentic-harness` and `Bad Name`;
  - `interlock gate … --metrics x --stage artifacts --depth strict --reviewer agent --lenses agentic-harness --json` records all four, and `--reviewer human` records `null` with the same `passed` and exit code;
  - a gate line with no recording flags records four `null`s;
  - a findings file where one finding carries `check` gates the same as without it *(guard)*;
  - `interlock review --metrics` from a dimension record with `depth: 'lean'` records `stage: 'code'`, `reviewer: 'agent'`, `depth: 'lean'`, and from one with no `depth` records `depth: null`.

  In `test/spine/run.test.mjs`, add one failing test: the ship run's review step's metrics record carries `stage: 'code'`, `reviewer: 'agent'`, `depth: 'strict'`. Owned by 2.5. Verify: `node --test test/spine/metrics.test.mjs` fails on the new tests, guards aside, and `node --test --test-name-pattern "review step.*metrics" test/spine/run.test.mjs` fails on the new one.
- [x] 1.5 In `test/spine/report.test.mjs` and `test/spine/report-html.test.mjs`, add failing tests for spec `report/indicators`'s new requirement:
  - a corpus of two `artifacts` records (`strict`/`agent`, `lean`/`session`), one `code` record and one record with no `stage` yields `fromMetrics.byStage` with `artifacts`, `code` and `unrecorded` groups, each `{ files, counts, byReader }`, and the `byReader` split;
  - the existing totals equal the sum over the groups;
  - an empty corpus yields `byStage: {}` and no group line;
  - a record with `depth: null`, `reviewer: 'session'` is counted under `unrecorded/session`, and one with `stage: 'design'` under `unrecorded`;
  - the text and the HTML name the same groups with the same counts;
  - `report-html` renders a report object that has no `fromMetrics.byStage`, as the objects built at `test/spine/report-html.test.mjs:350` have, with no group and no error *(guard)*.

  Owned by 2.6. Verify: both files fail on the new tests, guards aside.
- [x] 1.6 Create `test/spine/artifact-brief.test.mjs` with failing tests for spec `spec/artifact-review-brief`, against `assembleArtifactPrompt` and the CLI. CLI cases run in a temporary git repository holding a committed `REVIEW.md`, `.claude-plugin/plugin.json`, a change under `openspec/changes/`, and the plugin's own bundled files. A case that needs a bundled file missing runs a copy of the plugin, because the CLI's plugin root is its own location (design, Context). The copy holds `cli/`, `lib/`, `shared/`, `skills/` and `package.json` in a temporary directory, with the file removed, as `test/spine/run.test.mjs:890-891` copies one.

  - **Order and parts:** the opening block, then paths, the base rubric with its blocker definition last, the lens, data blocks, rules, emit shape. `ARTIFACT BRIEF:` comes first, and the opening block ends at the first blank line.
  - **The data checks:** `INVARIANT-SWEEP.md` is named by absolute path; the checks are numbered `review-md.<n>`; an instruction-shaped check stays inside its neutralised frame; a present `REVIEW_CONTEXT.md` is quoted whole.
  - **The living requirements:** they appear inside one frame whose lead names the artifacts, with no `\"\"\"` in the brief. `assembleDomainContext` with no `subject` keeps today's "Judge the diff" lead *(guard)*. Requirements cut at the domain cap are counted. A change whose delta modifies every selected requirement says none was quoted, and with no graph the line says the graph was absent.
  - **Exit 1 with empty stdout** for an unresolved change, a missing bundled rubric (the plugin copy), a missing `--since` file, `--artifacts` with no value, and `--artifacts` beside `--dimension`.
  - **Lens choice:** `--lens agentic-harness,mobile` prints `LENS UNKNOWN: mobile`; more known lenses than `LIMITS.maxArtifactLenses` print `LENS CAPPED:`; a non-git root holding `hooks/hooks.json` prints `LENS DETECTION PARTIAL:`; a working-tree lens edit is not read, and the policy line says `REVIEW.md` differs from HEAD.
  - **The checks cap:** `LIMITS.maxArtifactLenses` and `LIMITS.maxArtifactChecks` are positive integers; a list of `LIMITS.maxArtifactChecks` checks is quoted whole; two more are left out in file order and counted on the policy line.
  - **Policy problems:** an `## Artifact Lenses` heading at HEAD prints one `REVIEW POLICY PROBLEM:` line.
  - **Degraded inputs:** a repository with no commit says the artifact sections were not read, and prints no "could not be read" problem; no `REVIEW_CONTEXT.md` and no matched notes each say none; an unparseable `docs/notes/compound.md` says unreadable and exits 0; a change with no `tasks.md` names it missing and still prints; `decisions.md` is in the scope when present.
  - **Re-gate:** `--since` adds `RE-GATE:` and the re-gate rules.
  - **The run rules and the emit shape:** the emit shape names `check`, and the run rules say a session that is the reader writes the findings file from the reply object in the skill's own step.

  Owned by 2.7. Verify: `node --test test/spine/artifact-brief.test.mjs` fails on the new tests, guards aside, since the command does not exist yet.

## 2. The CLI and the bundled rubric (make §1 green)

- [x] 2.1 Parse the two artifact headings (make §1 green: 1.1). In `lib/review-core.mjs`:
  - add `artifactLenses` and `artifactChecks` to `EMPTY_POLICY`;
  - parse both headings as `- ` lists with a list reader of their own, as design §3 specifies: the path lists' structure rules, every problem naming the section's label in quotes, `BAND_KEY_LINE` items refused, no path canonicalization and no pattern refusal;
  - report a misnamed artifact heading by the two tests of design §3 (D29), naming the two known headings;
  - add the `artifact` entry to `PROBLEM_SECTIONS`, so `sectionOfProblem` answers `'artifact'`, and leave `proofSourcePaths`'s rule as it is;
  - have `composePolicy` take both fields from `base`;
  - have `formatReviewPolicy` print them.

  In `lib/merge-evidence.mjs`, have `reviewPolicyAtBase` drop `'artifact'` problems beside `'exclusions'` and `'source'` (design §3, D27). Update the pin at `test/spine/review-policy.test.mjs:56` under the bounded rule. Update the `review-policy` usage line in `cli/interlock`. Add both headings, shipped empty, to `skills/review-code/REVIEW.template.md`, and document them in `docs/12-repository-review-policy.md` and the printed fields in `docs/07-cli-and-configuration.md`. Verify: `node --test test/spine/review-policy.test.mjs test/spine/cli.test.mjs test/spine/merge-confidence.test.mjs test/spine/review-proof.test.mjs test/spine/package.test.mjs` passes.
- [x] 2.2 Route by caller (make §1 green: 1.2).
  - **`lib/limits.mjs`:** add a frozen `CALLER_DEPTH = { 'artifact-reviewer': { spec: 'strict' } }` with its doc comment, and its row in the `interlock limits` text. The two artifact caps are not added here: they land with their reader in 2.7, because the cap-authority sweep (`test/spine/limits.test.mjs:243-315`) refuses a published cap that nothing reads.
  - **`lib/routing.mjs`:** `resolveRouting` takes `caller` (resolved in the order of design §5), throws `RoutingError` kind `caller`, and returns `caller`; `listRouting` refuses `caller`; `formatRouting` prints it.
  - **Wiring:** add `caller` to `routing` in `lib/cli-flags.mjs`. In `cli/interlock`, pass `flags.caller` in the `routing` case, emit `callerDepth` beside `routing` in `limits --json`, and update the routing usage line.
  - **Docs:** `docs/07-cli-and-configuration.md` (routing, limits rows).

  Verify: `node --test test/spine/routing.test.mjs test/spine/limits.test.mjs test/spine/cli-arguments.test.mjs test/spine/package.test.mjs` passes.
- [x] 2.3 Select and detect lenses (make §1 green: 1.3). Create `lib/artifact-lenses.mjs` (pure) exporting `selectLenses` and `detectLenses` as design §2 specifies, with the UI-framework dependency names as a frozen exported list. Verify: `node --test test/spine/artifact-lenses.test.mjs` passes.
- [x] 2.4 Write the bundled rubric and lenses. Create `skills/review-artifacts/rubric.md`, `re-gate.md`, `lenses/agentic-harness.md` and `lenses/web-ui.md` with the content design §8 lists:
  - the reworked Architecture and QA questions, including "every task states how it is verified";
  - the invariant check with `interlock-graph consumers`, the decision-ledger rule, and "What a blocker is" as the rubric's last section, with the bounded pin rule and the sentence that it decides every finding's severity, a lens's included;
  - the three `--since` steps unchanged;
  - the harness lens's perspective, three walks, table and twelve numbered questions;
  - the UI lines in `web-ui` only;
  - each lens closing on the line that its findings take their severity from the base rubric's blocker definition.

  Restate no cap value and write no role line. Create `test/spine/artifact-rubric.test.mjs` pinning, by token, every scenario of spec `spec/artifact-review-brief`'s rubric and lens requirements: the questions' tokens; the blocker definition as the rubric's last `##` section; no "pair a test task" line; accessibility and loading only in `web-ui`; questions 1–12 with their topic tokens; each lens's severity line; no "You are" opening; no digit after a cap name. `skills/review-artifacts/SKILL.md` keeps its old sections until 3.1. Verify: `node --test test/spine/artifact-rubric.test.mjs test/spine/package.test.mjs` passes, and `npm run validate` passes.
- [x] 2.5 Record what ran (make §1 green: 1.4).
  - **`lib/metrics.mjs`:** `writeReviewMetrics` copies `stage`, `depth`, `reviewer` and `lenses` by name with the vocabularies of design §6, writing `null` otherwise. Export the vocabularies and `recordFieldsOf(flags, warn)`, with the `--lenses` shape rule of design §6. Keep the schema id `interlock.review-metrics/1` and update the header's "counts, not content" paragraph to name the four enumerations.
  - **Gate wiring:** in `cli/interlock`, pass `recordFieldsOf(flags, warn)` in the `gate` case and update the gate usage line; add `stage`, `depth`, `reviewer` and `lenses` to `gate` in `lib/cli-flags.mjs`.
  - **The two code-review writers:** in `cli/interlock:2451`, let `writeReviewMetrics` take the fields; in `lib/review-cli.mjs` `reviewRecord`, record `stage: 'code'`, `reviewer: 'agent'` and the dimension record's `depth` or `null`; in `lib/run.mjs:2075`, record `stage: 'code'`, `reviewer: 'agent'`, `depth: 'strict'`.
  - **Pins and docs:** update the pin at `test/spine/metrics.test.mjs:44` under the bounded rule. Document the flags in `docs/07-cli-and-configuration.md` and the record's fields in `docs/11-the-indicators.md`.

  Verify: `node --test test/spine/metrics.test.mjs test/spine/cli-arguments.test.mjs test/spine/checkpoint-cli.test.mjs test/spine/package.test.mjs` passes, and so does `node --test --test-name-pattern "review step.*metrics" test/spine/run.test.mjs`.
- [x] 2.6 Split the report's review figures (make §1 green: 1.5). This depends on 2.5 (the vocabularies it imports). In `lib/report.mjs`:
  - `digestMetrics` carries `stage`, `depth` and `reviewer` onto each recognized entry, `null` when absent or outside the vocabularies imported from `lib/metrics.mjs`; it does not carry `lenses`;
  - `reviewFindingsOf` adds `fromMetrics.byStage` in the shape of design §7, with its `byReader` split and `unrecorded` groups;
  - `formatReport` prints one line per group.

  In `lib/report-html.mjs`, render the same groups with no colour and no threshold, and no group when `fromMetrics.byStage` is absent. Document the split in `docs/11-the-indicators.md`. Verify: `node --test test/spine/report.test.mjs test/spine/report-html.test.mjs test/spine/eval-history.test.mjs` passes.
- [x] 2.7 Print the artifact brief (make §1 green: 1.6). This depends on 2.1 (`artifactLenses`, `artifactChecks`), 2.2 (`limits.mjs`, edited by both), 2.3 (`selectLenses`, `detectLenses`) and 2.4 (the bundled files it reads).
  - **The caps:** add `maxArtifactLenses: 3` and `maxArtifactChecks: 12` to `LIMITS` in `lib/limits.mjs`, with doc comments (the D7 recommendation, which the owner may replace) and their two rows in the `interlock limits` text. `briefArtifacts` is their reader.
  - **The assembler:** create `lib/prompts/artifact-review.mjs` with the pure `assembleArtifactPrompt`, building the opening block and parts in design §1's order. Share the `quoted`/`escapeFrame` framing with `lib/prompts/review-dimension.mjs`, so the dimension prompts stay byte-identical. Insert the living-requirements text as `domainContextOut` frames it, never through `quoted`.
  - **Registration:** register `artifact-review.mjs` in `PROMPTS` in `lib/prompts/index.mjs`, with the two sample inputs design §1 names, and add any shared framing module to `NON_ASSEMBLER_MODULES`.
  - **The domain lead:** in `lib/prompts/domain-context.mjs`, give `assembleDomainContext` the optional `subject` of design §4 (D28), default `'diff'` byte-identical, and pass it through `domainContextOut` in `lib/review-cli.mjs`.
  - **The command:** in `lib/review-cli.mjs`, add `briefArtifacts`, dispatched from the `review brief` verb on `--artifacts` before the other two modes, with the refusals of design §1. It does the I/O of design §1–§4:
    - `io.headShaOf(root)`, then `reviewPolicyAt(root, 'HEAD')` or, with no commit, `reviewPolicyAt(root, null)`;
    - `specMentionedPaths(tasks.md)` into `domainContextOut` and `matchNotes`, with the notes table's parse failure as a line, never an exit;
    - `decisions.md` by its own existence check;
    - detection;
    - the bundled files from `pluginRoot`.
  - **Wiring and docs:** add `artifacts`, `lens` and `since` to `review brief` in `lib/cli-flags.mjs`; add the usage line in `cli/interlock`; document the command and the two caps in `docs/07-cli-and-configuration.md`.

  Verify: `node --test test/spine/artifact-brief.test.mjs test/spine/prompts.test.mjs test/spine/prompt-integrity.test.mjs test/spine/domain-context.test.mjs test/spine/limits.test.mjs test/spine/cli-arguments.test.mjs test/spine/cli-inventory.test.mjs test/spine/package.test.mjs` passes.

## 3. The skills read the brief and record the gate

- [x] 3.1 Rewire `skills/review-artifacts/SKILL.md`.
  - **Front matter:** `argument-hint` gains `--lean`, `--caller spec` and `--lens <a,b>`. `allowed-tools` drops `Bash(openspec *)` and adds `Bash(interlock-graph *)`.
  - **Remove** these, all of which now live in the bundled files: the Reviewer 1, Reviewer 2 and Invariant check sections; the stack-detection line; the artifact-read paragraph's `decisions.md` rule (`:24`); the strict prompt's section list; and the Output section's blocker definition.
  - **The Depth section:** add `--caller spec` and `--lean` to the routing line. When both depth flags are given, it runs strict and says it ignored `--lean`. Keep the typed-spawn tokens `test/skills.test.mjs:3110-3145` reads.
  - **The brief line:** add the `interlock review brief --artifacts <change>` fenced line, with the instruction to print the opening block (every line before the first blank line) verbatim.
  - **Reading the brief:** lean reads the brief, composes the reply object its run rules name, and writes the findings file from it; strict relays the brief verbatim as the one Agent call's prompt, naming `interlock:reviewer`.
  - **The fallbacks:** `ARTIFACT BRIEF UNAVAILABLE:` leads to the inline read of `${CLAUDE_SKILL_DIR}/rubric.md`, plus `re-gate.md` under `--since`, gated with `--reviewer session --lenses none`. `STRICT REVIEW UNREAD:` and `STRICT REVIEWER UNAVAILABLE:` read inline against the printed brief.
  - **The gate line:** `--stage artifacts --depth <depth> --reviewer <session|agent> --lenses <names|none>`. When the output has no `passed`, print `GATE UNAVAILABLE:`. Rerun once without the four flags only when the output carries `unknownFlag`. Any other output with no verdict stops the gate, as design §6 specifies.
  - **The `--since` section** keeps the person's-call framing.
  - **The Output section** gains a SUGGESTION line.

  **Pins:** update the pins at `test/skills.test.mjs:2911-2941`, `:2943-2967` and `:3104-3108` under the bounded rule. Each assertion follows its text to the bundled file, or is rewritten for the new line, naming the requirement it now pins. Add every new or changed fenced `interlock` line of the skill, the brief line among them, to `UNREAD_BY_NAME` at `test/spine/spec-meter.test.mjs:775-781`, verbatim, with a comment naming this change's design §1. Add token pins for:
  - the brief line, `opening block`, `first blank line`, `ARTIFACT BRIEF UNAVAILABLE:`, `GATE UNAVAILABLE:` and `unknownFlag`;
  - `--caller spec`, `--lean`, and the gate line's `--stage artifacts` and `--reviewer` (spec `spec/machine-readable-gate-lines`);
  - the `allowed-tools` grants;
  - the absence of a `## Reviewer 1` heading.

  Verify: `node --test test/skills.test.mjs test/spine/cli-inventory.test.mjs test/spine/spec-meter.test.mjs` passes.
- [x] 3.2 Rewire `skills/spec/SKILL.md`, `shared/TOOL-ECONOMY.md` and `REVIEW.md`. This depends on 3.1, which edits `test/skills.test.mjs` first.
  - **Spec:** the flags table and `argument-hint` gain `--lean` and `--lens <a,b>`. §1b's spawn sentence names the artifact gate's reviewer beside explore's investigators, each routed by role. §5's gate line becomes `/interlock:review-artifacts <name> --caller spec`, with `--strict`, `--lean` and `--lens` passed through. §5 says that a gate with no verdict (`GATE UNAVAILABLE:` and no rerun verdict) writes no `interlock autonomy` line and stops at the checkpoint.
  - **Elsewhere:** update `shared/TOOL-ECONOMY.md`'s `artifact-reviewer` line, and rewrite `REVIEW.md:31` (prose now reaches the artifact gate; the path lists stay code-review only).
  - **Pins:** update the pins at `test/skills.test.mjs:2968-2973` and `:2672-2680` under the bounded rule. Add token pins for `--caller spec` on §5's gate line and for the no-verdict sentence.

  Verify: `node --test test/skills.test.mjs test/spine/spec-meter.test.mjs` passes.
- [x] 3.3 Document the flow.
  - **`docs/10-agentic-workflow-ship-and-spec.md`:** step 9 describes the brief, the lenses, spec's routed reader by default, `--lean` and the record, and the line-338 row says the spec gate's reader now runs as a subagent by default.
  - **`docs/16-upgrading.md`:** add rows for a newer skill on an older `interlock`: `ARTIFACT BRIEF UNAVAILABLE`, `ROUTING UNAVAILABLE` and `GATE UNAVAILABLE`, each with what degrades.
  - **`CHANGELOG.md`:** an `[Unreleased]` entry naming the default-depth change for `/interlock:spec`.

  Verify: `node --test test/retired-names.test.mjs` passes, and `grep -n "inert for" REVIEW.md docs/12-repository-review-policy.md` finds no claim that `REVIEW.md` is inert for the artifact gate's prose.

## 4. Integration check

- [x] 4.1 Run the whole suite and the plugin check, and the brief against this change.
  - `npm test` (output redirected under `$TMPDIR`, never under the repository) and `npm run validate` pass.
  - `node cli/interlock review brief --artifacts brief-and-record-the-artifact-gate | sed -n '1,/^$/p'` prints an opening block whose `REVIEW LENSES:` line reads `agentic-harness (detected: .claude-plugin/plugin.json)`.
  - `node cli/interlock routing artifact-reviewer --caller spec --json` prints `"depth": "strict"`.
  - `wc -c cli/interlock` is below 245,760.
