# Design

## Context

See `proposal.md` (Why) for the motivation, and `.docs/REVIEW-ARTIFACTS-REVISIT-2026-11-25.md` for the measured corpus and the sources. That report is local and gitignored, so the figures this change relies on are restated in `proposal.md` and here, and a citation of it names a section a reader in another clone cannot open. This change is items 1 and 2 of the report's §9.4 split, combined into one change at the owner's request (D25). It stays inside the published width caps: 7 delta capabilities and 17 tasks. This section holds only the facts the approach depends on.

- **The gate today** (`skills/review-artifacts/SKILL.md`):
  - The rubric is prose in the skill (`:83-130`), and the blocker definition is in its Output section (`:153`).
  - The strict prompt is that prose plus a stack note (`:50-57`). So today's strict reviewer is never handed the blocker definition or the `decisions.md` rule (`:24`).
  - `allowed-tools` grants `Bash(openspec *)`, which the body never runs (pinned as such at `test/skills.test.mjs:680`), and lacks `Bash(interlock-graph *)`.
- **Routing.** The default depth is one shared value, `REVIEW_DEPTH.default` (`lib/limits.mjs:688`), read by `depthOf` (`lib/routing.mjs:46-55`) for every role. Review-code reads the same default, so flipping it would change review-code too.
- **Review-code already has a CLI-built brief.**
  - `briefDimension` (`lib/review-cli.mjs:372-452`) reads the bundled rubric, the policy, `.claude/graph/REVIEW_CONTEXT.md` and the domain text, and `assembleDimensionPrompt` (`lib/prompts/review-dimension.mjs:248-321`) frames them with `quoted` and `escapeFrame`.
  - `domainContextOut` (`lib/review-cli.mjs:481-585`) selects living requirements for a path list with a cap and a stated `partial`/`omitted`.
  - `specMentionedPaths` (`lib/spec-text.mjs:72`) extracts the paths a `tasks.md` names, as `note match` already does (`lib/note-cli.mjs:71`).
- **`REVIEW.md` parsing.** `parseReviewPolicy` ignores unknown headings (`lib/review-core.mjs:1061`). `composePolicy` takes the path lists from the base and the prose from the working tree (`:1243-1261`), and `reviewPolicyAt(root, base)` wires that (`cli/interlock:2617`). `parsePathList` refuses an item holding `*` or `?` as a pattern (`lib/review-core.mjs:1201-1208`), which a check written as a question would trip.
- **Policy problems are classed by section, and a section-less one costs two other signals.** `sectionOfProblem` (`lib/review-core.mjs:908-914`) finds the quoted section label in a problem's wording and answers `null` for any other problem. `proofSourcePaths` (`:926-933`, read by `lib/review-cli.mjs:286` and `lib/run.mjs:2055`) drops the counts-as-source list on a `null` or `'source'` problem, so the proof of coverage degrades. The merge verdict's `reviewPolicyAtBase` (`lib/merge-evidence.mjs:214-218`) keeps every problem that is not `'exclusions'` or `'source'` as a human-paths problem. A new problem with no section therefore degrades both.
- **No commit.** In a repository with no commit, `reviewPolicyAt(root, 'HEAD')` adds a `could not be read` problem and reports the copies as differing (`cli/interlock:2592-2627`). `io.headShaOf(root)` (`cli/interlock:2978`) answers `null` there.
- **The domain text arrives framed.** `assembleDomainContext` returns its text inside its own `"""` frame with `escapeFrame` applied, under a lead written for a diff ("Judge the diff against them as the dimension's rubric directs", `lib/prompts/domain-context.mjs:360-366`). `assembleDimensionPrompt` inserts it as it is (`lib/prompts/review-dimension.mjs:298`). It leaves out every living requirement the change's delta modifies or removes, and answers `skipped` with no text when none is left (`:264-279`).
- **`note match` exits on a table it cannot parse** (`lib/note-cli.mjs:69-71`). `inspectChange` lists only `proposal.md`, `design.md` and `tasks.md` under `present` (`lib/artifacts.mjs:420-465`), never `decisions.md`.
- **Metrics.** `writeReviewMetrics` copies four counts by name (`lib/metrics.mjs:66-99`). It is called from three places: the gate (`cli/interlock:3398-3412`), `interlock review --metrics` (`lib/review-cli.mjs:296-301`) and a ship run's review step (`lib/run.mjs:2075`). The report recognizes a record by an exact schema match (`lib/report.mjs:347`).
- **Findings keep extra fields.** `evaluateGate` keeps each finding object as given (`lib/findings.mjs:375-378`).
- **The flag table refuses unknown flags before anything runs.** `lib/cli-flags.mjs` holds each command's accepted flags. Probed 2026-11-25: `interlock gate --findings f.json --stage artifacts --json` on 1.20.0 exits 2 and prints `{ "error": "unknown flag --stage for interlock gate (CLI 1.20.0)", "unknownFlag": "--stage", … }`, with no `passed`.
- **File-size budget.** `cli/interlock` is 242,503 bytes. The headroom pin warns above 262,144 − 16,384 = 245,760 (`test/spine/package.test.mjs:398,438-445`), which leaves 3,257 bytes.
- **Suites that enumerate.** Three existing tests fail on an addition they cannot account for:
  - `test/spine/prompt-integrity.test.mjs:48-60` fails on a module under `lib/prompts/` that is in neither `PROMPTS` nor `NON_ASSEMBLER_MODULES` (`lib/prompts/index.mjs`).
  - The cap-authority sweep (`test/spine/limits.test.mjs:243-315`) fails on a `LIMITS` key that no file under `lib/` (other than `lib/limits.mjs`), `cli/` or `workflows/` names as `LIMITS.<cap>`.
  - `test/spine/spec-meter.test.mjs:775-791` fails on a fenced `openspec` or `interlock` line in the spec and review-artifacts skills that is neither a `KEYED_LINES` kind nor listed verbatim in `UNREAD_BY_NAME`.
- **The CLI's plugin root is its own location** (`PLUGIN_ROOT` from `lib/doctor.mjs`, passed as `io.pluginRoot` at `cli/interlock:2450`). A test of a missing bundled file therefore runs a copy of the plugin, as `test/spine/run.test.mjs:890-891` does.
- **The gate's failures** (probed 2026-11-25 on 1.20.0): `interlock gate --findings <missing file> --json` and a findings file that is not JSON both exit 1 with empty standard output and the reason on standard error. Neither carries `passed`, and neither carries `unknownFlag`.

## Goals / Non-Goals

**Goals:**

- One brief, printed by the CLI, that the lean session and the strict reviewer both read, holding the rubric, the lenses, the blocker definition, the decision-ledger rule and the project's review context.
- Lens choice in a fixed order with printed provenance, an unknown name that fails open, and a published cap.
- `REVIEW.md` governs the artifact gate through two known headings read from the base.
- Spec's own gate uses the routed independent reader by default, and every gate records its stage, depth, reader and lenses.
- `interlock report` can tell artifact gates from code reviews, and a lean read from a strict one.

**Non-Goals:**

- No change to review-code's default depth, its dimension briefs or its skeptics.
- No refutation stage on artifact findings (report §5 G6: 5 of 851 code-review findings were dismissed).
- No second gate in a spec run. One gate per run and the owner-called `--since` re-gate stay as they are.
- `--since` still scopes by `git diff`/`git status`. The uncommitted-change gap (report G4) is change 3 of the §9.4 split.
- Nothing reads the `check` tag yet. `interlock review-policy suggest` and triggers T1–T4 are change 4.
- No gate eval cases (R6), no wording lint (R8), and no "a blocker must cite a passage" rule (R9).
- No other vendor's reader inside the plugin (D3). `external` is reserved for the owner's standalone skill.
- No `## Artifact Checks` lines are written into this repository's `REVIEW.md` (D18).
- The journeys epic's proposed edits to Reviewer 2 and the Invariant check are not made here. A lens file is the slot that work can use later.
- No eval change and no change to `lib/spec-meter.mjs` for the spec path. The new brief line and the changed routing lines are not keyed lines (`KEYED_LINES`, `lib/spec-meter.mjs:42-54`). Task 3.1 lists each of them verbatim in the meter test's `UNREAD_BY_NAME` (`test/spine/spec-meter.test.mjs:775-781`), which is how today's two routing lines pass.

## Decisions

The ledger ids in `decisions.md` are cited inline. D1–D4 are the owner's answers of 2026-11-25 (report §8–§9) and are not reopened here.

### 1. The brief command (D10, D12, D13, D26)

`interlock review brief --artifacts <change> [--lens <a,b>] [--since <file>]` is a third mode of the existing `review brief` verb. `reviewCommand` in `lib/review-cli.mjs` dispatches it to a new `briefArtifacts(io, root, flags, pluginRoot)`, so `cli/interlock` gains no handler code (D12). `briefArtifacts` does all the I/O and hands plain data to a pure assembler, `assembleArtifactPrompt` in `lib/prompts/artifact-review.mjs`, the same split as `briefDimension` and `assembleDimensionPrompt`. It does this I/O:

- resolves the active change with `resolveChange` and `inspectChange`, and lists `decisions.md` by its own existence check, because `inspectChange` does not;
- reads the bundled files from `pluginRoot`;
- runs the lens selection (§2) and reads the policy (§3);
- reads `REVIEW_CONTEXT.md`;
- calls `domainContextOut` with the tasks' paths (§4);
- calls `matchNotes` on the same paths.

**Dispatch.** `reviewCommand` checks `--artifacts` before `--skeptics` and `--dimension`. `--artifacts` with no change name, or beside `--dimension` or `--skeptics`, exits non-zero naming the conflict, so one invocation never prints one kind of brief while asked for another.

**What it prints, in order:**

1. **The opening block** (D13). These status lines end at the first blank line, and every input has one, degraded or not:

   ```
   ARTIFACT BRIEF: <change> — <n> artifact file(s)
   REVIEW LENSES: agentic-harness (detected: .claude-plugin/plugin.json)
   REVIEW POLICY: prose from the working tree; artifact sections from HEAD (2 checks)
   REVIEW CONTEXT: .claude/graph/REVIEW_CONTEXT.md
   LIVING REQUIREMENTS: 4 capabilities from the working tree; 1 requirement left out to fit the cap
   COMPOUND NOTES: 3 rows
   ```

   These lines are added only when they apply: `LENS UNKNOWN:`, `LENS CAPPED:`, `LENS DETECTION PARTIAL:`, `REVIEW POLICY PROBLEM:` (one per problem) and `RE-GATE: since <file>`.

   Each status line has a degraded form, and none of them stops the brief:

   | Line | Degraded forms |
   |---|---|
   | `ARTIFACT BRIEF:` | `…; missing: tasks.md` when a required artifact is absent. The scope then lists what is present. |
   | `REVIEW POLICY:` | `no REVIEW.md`; `artifact sections not read: HEAD names no commit` (§3); `REVIEW.md differs from HEAD`; `<k> check(s) left out to fit the cap` (§2) |
   | `REVIEW CONTEXT:` | `none — .claude/graph/REVIEW_CONTEXT.md is absent`; `unreadable — <reason>` |
   | `LIVING REQUIREMENTS:` | the forms §4 lists |
   | `COMPOUND NOTES:` | `none matched`; `none — tasks.md names no path`; `none — no compound notes file`; `unreadable — <reason>`; `<n> rows; <k> omitted over the cap; <u> rows unreadable` |

   A degraded input prints no data block of its own, so no empty frame is quoted.
2. **The scope.** The artifact paths, `decisions.md` included when present.
3. **The bundled base rubric** (`skills/review-artifacts/rubric.md`), verbatim. It carries the Architecture and QA questions, the invariant check and the decision-ledger rule, and it ends with the blocker definition (D26). The invariant sweep is named by `join(pluginRoot, 'shared', 'INVARIANT-SWEEP.md')`, never by `${CLAUDE_PLUGIN_ROOT}`, which a spawned reader cannot expand.
4. **The re-gate rules** (`skills/review-artifacts/re-gate.md`), verbatim, under `--since`.
5. **Each selected lens** (`skills/review-artifacts/lenses/<name>.md`), verbatim, in selection order.
6. **The quoted data blocks** (§3, §4). The `REVIEW.md` prose, the checks, `REVIEW_CONTEXT.md` and the compound notes are each framed by the same `quoted` helper and `escapeFrame` as the dimension briefs. Both helpers are exported from `lib/prompts/review-dimension.mjs`, or moved into a small shared module under `lib/prompts/` that joins `NON_ASSEMBLER_MODULES`, so there is one framing rule. The living requirements are the exception. `domainContextOut` returns them already framed, so the brief inserts that text as it is and never passes it through `quoted` a second time, as `assembleDimensionPrompt` does (§4, D28).
7. **The run rules and the emit shape.** The reviewer may read files and run read-only commands (`git diff`, `git status`, `interlock-graph consumers`), writes no file, and replies with one JSON object and nothing else. The emit shape names the optional `check` (D19). The rules address the reader. At strict that is the spawned reviewer. At lean it is the session, for its read: it composes the reply object the rules describe, and then the skill's own steps write the findings file from that object and run the gate line. The brief says so in one sentence, so a lean session is never told both to write no file and to write the findings file.

**So the whole order is:** opening block, scope, base rubric (its blocker definition last), re-gate rules, lenses, data blocks, run rules and emit shape. The blocker definition stays inside `rubric.md` so that the inline fallback, which reads `rubric.md` alone (spec `spec/artifact-gate-depth`), still has it. It says that it governs every finding, a lens's findings included, and each lens file closes by deferring to it, as the report's draft already does ("Severity follows the gate's existing definition") (D26).

**Registration.** `lib/prompts/artifact-review.mjs` is registered in `PROMPTS` (`lib/prompts/index.mjs`) with two sample inputs that name `demo-change`: a brief with a lens, two checks and every input present, and a brief with every input degraded. `test/spine/prompt-integrity.test.mjs` then assembles and checks it like every other assembler.

**Exit codes.** The command exits 1 with nothing on stdout in five cases: the change does not resolve; a bundled file it needs is missing; the `--since` file does not exist; `--artifacts` has no value; or `--artifacts` is given beside `--dimension` or `--skeptics`. Every other degraded input is a line in the opening block and never an exit (spec `spec/artifact-review-brief`, "The opening block SHALL name every input"). This includes a change with no `tasks.md`: its paths are empty, so only the declared capabilities are selected, no note matches, and both lines say why.

**Why print and relay (D10).** Review-code relays nine printed briefs this way already, and `review/review-briefs` requires the review skills to "relay the printed prompts and add nothing".

- *Alternative rejected:* delivery by reference, where the CLI writes a file and the agent reads it. It saves the session's output tokens. But it adds a file that two gates of one change could both write, and a second delivery contract beside review-code's.

**Why one opening block (D13).** The skill gets one instruction ("print every line before the first blank line, verbatim") instead of one pinned token per status line.

- *Alternative rejected:* status lines on stderr. The Bash tool returns stderr and stdout together, so the session could not separate them from the prompt it must relay.
- *Alternative rejected:* `--json` with `prompt` and `banners` fields. That is a 40 KB JSON string the session must unescape before relaying it.

### 2. Lens selection and detection (D2, D20, D22, D7)

`lib/artifact-lenses.mjs` (new, pure) exports two functions:

- `selectLenses({ flag, policyLenses, detected, bundled, cap })` returns `{ lenses: [{ name, source }], unknown: [], capped: [] }`.
- `detectLenses({ has, packageJson, uiFiles })` returns `{ detected: [{ name, marker }], partial: string|null }`.

`briefArtifacts` supplies the I/O to them:

- `has(path)` is an `existsSync` at the repository root.
- The `skills/*/SKILL.md` marker is one `readdirSync` of `skills/`.
- `packageJson` is the parsed root `package.json`, or `null`.
- `uiFiles` is `git ls-files -- '*.tsx' '*.jsx' '*.vue' '*.svelte'`, or an error string when git cannot list.

**The order is fixed by D2.** `--lens`, then `REVIEW.md` at HEAD, then detection, then none. The first source that names any lens wins, even when every name it gives is unknown (D22). A typed `--lens mobile` does not quietly become the detected set: it selects none and prints `LENS UNKNOWN: mobile`. The base rubric is in the brief whatever this selects.

**Detection markers (D20).** `agentic-harness` is selected by `.claude-plugin/plugin.json`, `hooks/hooks.json`, or any `skills/<name>/SKILL.md`, and the first marker found is the one printed. `web-ui` is selected by a root `package.json` whose `dependencies`, `devDependencies` or `peerDependencies` name `react`, `vue`, `svelte`, `@angular/core`, `solid-js` or `preact`, or by a tracked `.tsx`/`.jsx`/`.vue`/`.svelte` file. Detected lenses come in that fixed order.

**Lens names** are the filenames under `skills/review-artifacts/lenses/`. That is the one list, as the dimension names are the rubric filenames (`skills/review-code/SKILL.md:94`).

**The caps (D7)** are `LIMITS.maxArtifactLenses` and `LIMITS.maxArtifactChecks`. Lenses past the cap are left out in source order and named on one `LENS CAPPED:` line. Checks past the cap are left out in file order and counted on the policy line, and the quoted ones keep their numbers `review-md.1` to `review-md.<cap>` (spec `spec/artifact-review-brief`, "The number of Artifact Checks quoted SHALL be capped by the CLI"). The values are an owner decision (D7); the recommendation is 3 and 12. Neither number appears in any skill or lens file. Both caps land in task 2.7, together with their one reader, `briefArtifacts`, so the cap-authority sweep never sees a published cap that nothing reads.

### 3. `REVIEW.md` for the artifact gate (D4, D23, D18, D27, D29)

`parseReviewPolicy` learns two headings, `artifact review lenses` and `artifact checks` (normalized), returned as `artifactLenses: string[]` and `artifactChecks: string[]`.

- Both are lists of `- ` items, parsed by a list reader of their own with the path lists' structure rules: a code fence or content with no items declares nothing, and text mixed with items is reported. The items are not canonicalized as paths and are not refused as patterns, so a check may end in `?` or name a glob.
- A `BAND_KEY_LINE` item is a problem and is never read (the existing refusal, `lib/review-core.mjs:1194-1200`).
- Every problem either section reports names the section's label in quotes (`"Artifact Review Lenses"`, `"Artifact Checks"`), as the path-list problems do.
- **A misnamed artifact heading (D29)** is an unknown heading that meets two tests. First, its normalized words hold `artifact` or `artifacts` together with one of `lens`, `lenses`, `check`, `checks` or `review`. Second, its last word is not `rationale`. Such a heading adds one problem, which quotes the heading and both known ones, and declares nothing. So `## Artifact Lenses` and `## Artifacts Checks` are reported, while `## Artifact checks rationale` is ignored, as `REVIEW.md`'s own `## Always-human rationale` is. Every other unknown heading is still ignored, as `:1061` intends.

**Problem sections (D27).** `PROBLEM_SECTIONS` gains an `artifact` entry, and `sectionOfProblem` answers `'artifact'` for every problem the two sections and the misnamed-heading rule produce. Neither reader of a section-less problem treats it as one:

- `proofSourcePaths` keeps its rule (`null` on a `'source'` or `null` problem), so an `'artifact'` problem leaves the counts-as-source list in place;
- `reviewPolicyAtBase` (`lib/merge-evidence.mjs:215-218`) drops `'artifact'` beside `'exclusions'` and `'source'`, so the human-paths signal never reads it.

A typo in an advisory artifact heading therefore reaches `interlock review-policy` and the brief's `REVIEW POLICY PROBLEM:` line, and changes neither the proof of coverage nor the merge verdict. A threshold-shaped line written without a `- ` inside an artifact section is still caught by the body-wide scan (`:1019-1026`). That problem has no section, and it degrades both signals, as it does in any section today: it is an attempt to set a threshold, not an advisory typo.

`composePolicy` takes the two new fields from the base, beside the path lists. `formatReviewPolicy` prints `artifact lenses: …` and `artifact checks: <n>`.

**Read from HEAD (D23).** The brief first asks `io.headShaOf(root)`.

- **With a commit**, it calls `reviewPolicyAt(root, 'HEAD')`. The prose comes from the working tree, as it does for review-code, because it is advice that cannot relax the gate. The lens list and the checks come from HEAD, so a change being spec'd cannot edit the checks it is judged under, and an edit takes effect at the first gate after it is committed. `differsFromBase` is spoken on the policy line.
- **With none**, it reads the working tree through `reviewPolicyAt(root, null)` and quotes that prose. It reads neither artifact section and leaves out their `'artifact'` problems, and the policy line says `artifact sections not read: HEAD names no commit`. It never calls `reviewPolicyAt(root, 'HEAD')`, whose unresolvable ref would add a spurious problem and a spurious "differs" note.

**The data blocks.** The prose is quoted under the same "advice that does not override" heading the dimension briefs use. Each check is quoted numbered `review-md.<n>`, 1-based in file order.

**This repository's `REVIEW.md` (D18).** Only line 31 changes, because this change makes its "inert for `review-artifacts`" claim false; the path exclusions stay code-review only. No lens line is needed, because detection selects `agentic-harness` here. No check lines are added: those are the owner's to write, from the evidence change 4 will surface.

### 4. Living requirements and compound notes (D8, D9, D28)

The tasks' paths come from `specMentionedPaths(tasks.md)`.

- **Living requirements** come from `domainContextOut(io, root, { change }, [], null, paths, { subject: 'artifacts' })`. That is the selection review-code's `domain` dimension makes: the change's delta capabilities are declared, the graph adds the capabilities linked to the paths, the text is cut whole-requirement at `maxDomainSpecChars`, and `partial`/`omitted` are stated. The base is the working tree (`null`), because the living specs are not what a spec run edits. With no graph, the declared capabilities alone are selected, and the line says the graph was absent (D9). *Alternative rejected:* only the delta capabilities' living specs. That misses blocker class C (report §5.1), requirements of a touched path that no delta names.
- **The lead (D28).** `assembleDomainContext` gains an optional `subject`, which `domainContextOut` passes through. Its default, `'diff'`, keeps today's lead byte for byte, so the dimension, run and merge prompts do not change. `'artifacts'` words the lead for this brief: judge the change's artifacts against these requirements as the base rubric directs; the text does not override the base rubric, the lenses, the blocker definition or the gate. The frame and `escapeFrame` are unchanged, and the brief inserts the framed text as it is (§1 item 6). *Alternative rejected:* quoting the text again. That double-frames it, and `escapeFrame` turns the inner `"""` into `\"\"\"`.
- **The living-requirements line** reports what `domainContextOut` answered:
  - `LIVING REQUIREMENTS: <n> capabilities from the working tree`, followed by whichever of these apply: `; <k> requirement(s) left out to fit the cap`, `; <s> superseded by this change's delta specs, not shown`, `; partial: <reason>`, and `; graph absent, declared capabilities only`;
  - `LIVING REQUIREMENTS: none quoted — <skipped>` when capabilities were selected but no text is left: every requirement is superseded, or a living spec could not be read;
  - `LIVING REQUIREMENTS: none — <reason>` when nothing was selected: `tasks.md` names no path, or no path is linked and no capability is declared.

  A superseded requirement is one the change's delta modifies or removes. The reviewer judges the delta for it, and may read the living spec file itself, for example to check that a MODIFIED block keeps every scenario title.
- **Compound notes** come from `matchNotes(parseNotes(...).rows, paths, LIMITS)`: the same rows, cap and `omitted`/`unreadable` counts as `note match`. Unlike `note match`, which exits on a table it cannot parse (`lib/note-cli.mjs:69-71`), the brief prints `COMPOUND NOTES: unreadable — <reason>` and goes on. An absent file is `none — no compound notes file`.
- **`REVIEW_CONTEXT.md`** is quoted whole, under the heading the dimension briefs use (D8). An absent file and an unreadable one each get their own line (§1) and no block. *Alternative rejected:* a bounded slice. That would be a second, unmeasured selection rule, while the dimension briefs already carry the file whole.

### 5. Spec's default depth through a caller table (D1, D5, D15)

`lib/limits.mjs` gains a frozen `CALLER_DEPTH = { 'artifact-reviewer': { spec: 'strict' } }`, printed by `interlock limits` and emitted as `callerDepth`. `resolveRouting(role, env, { depth, caller })` resolves the depth in this order:

1. `depth` when given;
2. else `CALLER_DEPTH[role]?.[caller]`;
3. else `REVIEW_DEPTH.default`.

An unknown caller, or `--caller` with no role, throws a `RoutingError` of kind `caller` naming the known callers. The answer carries `caller`, and `formatRouting` prints `routing artifact-reviewer (strict, caller spec): …`. The reader pin over the routing tables (`test/spine/limits.test.mjs:993`) gains `CALLER_DEPTH`, so `lib/routing.mjs` stays its only reader.

**The skills.**

- `/interlock:spec` always passes `--caller spec` to its gate, and passes `--strict`, `--lean` and `--lens` through.
- `/interlock:review-artifacts` forwards `--caller spec` to its routing line. Under `--strict` it adds `--depth strict`, and under `--lean` it adds `--depth lean`. Both given: it runs strict and says it ignored `--lean` (D15).
- A standalone gate with no flags answers the published default (`lean`), so the session reads artifacts it most likely did not write.

**Alternatives rejected:**

- *Flip `REVIEW_DEPTH.default`.* That changes review-code too.
- *Have spec pass `--strict` every time.* That puts the depth decision in prose, which "the skill SHALL name no default depth" forbids, and leaves `interlock limits` unable to say what the default is.
- *Let review-artifacts infer its caller.* That is a model judgement where a flag is plain text.

**Why `--lean` (D15).** The trial D1 asks for is measured by comparing depths (report R5: "Measure with R3 over the next ten spec runs"). So the person needs a way to run the other depth.

### 6. The record says what ran (D6, D16, D17, D19)

`writeReviewMetrics(root, { change, counts, stage, depth, reviewer, lenses })` copies four new keys by name, each validated against its vocabulary:

| Key | Vocabulary |
|---|---|
| `stage` | `artifacts`, `code` |
| `depth` | the `REVIEW_DEPTHS` |
| `reviewer` | `session`, `agent`, `external` |
| `lenses` | an array of lens-shaped names (`[a-z0-9][a-z0-9-]*`) |

Anything else is written as `null`. The module header's "counts, not content" still holds: these are enumerations and lens names, not finding text. The vocabularies are exported from `lib/metrics.mjs`, and `lib/report.mjs` imports them (§7), so the writer and the reader cannot drift.

**Which writer records what:**

- **The gate.** A new helper, `recordFieldsOf(flags, warn)` in `lib/metrics.mjs`, reads `--stage`, `--depth`, `--reviewer` and `--lenses`, and the gate passes its result through (D12: about 150 bytes in `cli/interlock`). An absent flag is `null`. An unknown value, an empty one, or a flag given with no value is warned, naming the flag and the known values, and recorded as `null`. `--lenses` takes `none` or a comma-separated list of lens-shaped names: `none` alone is `[]`, and `none` beside a name, an empty element or an element of another shape makes the whole value `null`. The names are not checked against the bundled lenses, because `lib/metrics.mjs` reads no plugin file. The shape check is what keeps the record to names, never text.
- **`interlock review --metrics`.** It records `stage: 'code'`, `reviewer: 'agent'`, and `depth` from the dimension record's optional `depth` (`lib/review-core.mjs:614-616`), or `null` when that record has none.
- **A ship run's review step.** It records `stage: 'code'`, `reviewer: 'agent'` and `depth: 'strict'`, the depth its review always runs at (`lib/routing.mjs:35`, `STRICT_ALWAYS_ON_DIMENSIONS`).

**The schema id stays `interlock.review-metrics/1` (D6).** *Alternative rejected:* a bump to `/2` with the recognizer accepting both. An older installed plugin's `interlock report` would then class every new record as unrecognized, and its review indicators would read unobserved. The new keys are additive, and an older reader ignores them. A record with no `stage` reads `unrecorded` whether an older writer wrote it or a newer one was not told, which is the same honest answer either way.

**Stage is a flag, never inferred (D16).** It is not read from the findings' `dimension` or from the file name. `review/metrics-emission` already forbids inferring the change name from the path, and a code review could call `gate --metrics` later.

**Bad values never move a verdict (D17).** An unknown value is a warning and a `null`, never a refusal: "Emission cannot change a verdict, an exit status, or machine-readable output". This differs on purpose from `--metrics` with no value, which is refused. That flag names the change, and without it no record is written at all.

**The `check` tag (D19).** It is `<lens>.<n>` (the lens file's own question number) or `review-md.<n>` (the brief's numbering of the quoted checks). Base-rubric findings carry none. It lives in the findings file only. Nothing in this change reads it, and change 4 will.

**The skill's gate line:**

```
interlock gate --findings .claude/metrics/review-artifacts-<change>-<ts>.json --metrics <change> --stage artifacts --depth <depth> --reviewer <session|agent> --lenses <names|none> --json
```

The flags are filled in like this:

- `--depth` is dropped when no `GATE DEPTH:` line was printed (routing failed without `--strict`).
- `--reviewer agent` means the strict reviewer's findings are the input. Every inline read, the fallbacks included, is `session`.
- `--lenses` is the list the brief's `REVIEW LENSES:` line names, or `none`. Under `ARTIFACT BRIEF UNAVAILABLE` it is `none`, because the inline read on `rubric.md` reads no lens file: that is an observed empty list, not an absent one.
- **A gate whose output has no `passed` gave no verdict (D14).** What the skill does next depends on why:
  - *The output carries `unknownFlag`*: an older `interlock` on PATH refused a recording flag, exiting 2, as probed above. The skill prints `GATE UNAVAILABLE: <error>`, reruns the line once without the four recording flags, and reads the verdict from the rerun. A refusal must not read as a blocked gate.
  - *Any other output with no `passed`*, such as an unreadable findings file (exit 1, empty standard output), or a rerun that has no `passed` either: the skill prints `GATE UNAVAILABLE: <first line of the output>` and runs no further gate line. It reports that the gate gave no verdict and stops as it does on a blocker. There is no `autonomyOutcome.blockers` to read, so the spec skill writes no `interlock autonomy` line, and it stops at the checkpoint saying the gate gave no verdict. A rerun cannot repair a file the gate could not read, so it is not attempted.

### 7. The report split (D6)

`digestMetrics` (`lib/report.mjs:323-372`) carries `stage`, `depth` and `reviewer` onto each recognized entry, with `null` when absent or outside the vocabularies it imports from `lib/metrics.mjs`. It does not carry `lenses`: nothing in this change reads them, and the record keeps them for change 4. `reviewFindingsOf` adds `fromMetrics.byStage`, an object keyed by the stage name or `unrecorded`. Each entry is `{ files, counts, byReader }`:

- `counts` holds the four counts, in the shape of `fromMetrics.counts`;
- `byReader` is keyed `<depth>/<reviewer>`, with `unrecorded` standing in for a missing half (so `depth: null, reviewer: 'session'` reads `unrecorded/session`), and each of its entries is `{ files, counts }`.

A value on disk outside a vocabulary reads `unrecorded`, like a missing one. An empty corpus gives `byStage: {}`. The existing totals are untouched, and the spec pins that they equal the sum over the groups. `lib/report-html.mjs` renders no group when `fromMetrics.byStage` is absent, as in a report object built before this change (`test/spine/report-html.test.mjs:350` builds such objects). `formatReport` prints one indented line per group under `review findings`, and `lib/report-html.mjs` renders the same groups beside the existing review row, as `report/html-surface` requires ("The three surfaces cannot disagree about a value"). No group is coloured and no group carries a threshold.

### 8. The rubric files (D21, D11, D24)

All four files are new, beside the skill:

- **`skills/review-artifacts/rubric.md`** is the base rubric. It holds:
  - **Architecture:** structure and ownership in this project's patterns; data flow; what happens on failure; consistency with the project's docs; Non-Goals, alternatives considered and the rollback story, asked for as content and never as new headings (a `## Migration Plan` heading raises `interlock risk`); simpler alternatives; proportionality.
  - **QA, as a procedure.** First list the tests the scenarios imply, then judge:
    - each GIVEN produces its THEN, and each THEN is observable (an exit code, a file, stdout, a record);
    - no scenario contradicts another or a requirement in force;
    - traceability both ways;
    - omissions ("exactly, and only, this?");
    - one term, one meaning;
    - edge cases: empty, absent, malformed, boundary, error, concurrent, interrupted, re-run;
    - every task states its own verification (this replaces `SKILL.md:114`, which contradicts OpenSpec 2.0's schema);
    - ordering, the same-file staircase, and sections as waves;
    - delta-spec quality, with MODIFIED keeping every living scenario title.
  - **The invariant check**, with `interlock-graph consumers <symbol>` for each shared value `design.md` names when the graph exists.
  - **The decision-ledger rule**, moved from `SKILL.md:24`.
  - A question that does not apply to this change is skipped, not answered with a finding.
  - **"What a blocker is"**, moved from `SKILL.md:153`, bounded pin rule included. It is the file's last section, and it says that it decides the severity of every finding, a lens's findings included (D26).
- **`skills/review-artifacts/re-gate.md`** holds the three `--since` steps, moved from `SKILL.md:67-79` unchanged.
- **`skills/review-artifacts/lenses/agentic-harness.md`** is the report's §6 draft (perspective, three walks, the premortem table, twelve numbered questions), with one wording edit. Question 5 asks whether a step run twice gives "the same result", avoiding a word `interlock risk` reads as critical. It restates no number and opens with no role line. It keeps the draft's closing line that severity follows the blocker definition, now pointing at `rubric.md`. `web-ui` closes with the same line.
- **`skills/review-artifacts/lenses/web-ui.md`** takes the accessibility line and the loading, permission-denied and boundary-state lines from the old Reviewer 1 and Reviewer 2, and adds keyboard and focus order and the responsive states a UI change must name.

**What the skill keeps (D24).** The flow: resolve the change, depth and routing, the brief line, relay or inline read, the three fallbacks, the Output block (now with a SUGGESTION line), the emit file and the gate line. Its `allowed-tools` drop `Bash(openspec *)` and add `Bash(interlock-graph *)` (D11). The existing pins in `test/skills.test.mjs` that name moved text are updated in the task that moves it, under the bounded pin rule:

- the Depth section's `verbatim` and `writes no file`;
- the Output section's `fail its own verification`, `bounded pin rule` and `never a blocker`;
- the `--since` section's `Re-check each earlier blocker` and `changed hunk`;
- the artifact-read paragraph's `decisions.md` tokens (`test/skills.test.mjs:3104-3108`), which follow the decision-ledger rule into `rubric.md`.

Each updated assertion names the requirement it now pins and the file the text now lives in. The Depth section keeps the typed-spawn tokens that `test/skills.test.mjs:3110-3145` reads (`interlock:reviewer`, `` `subagent_type` ``, `writes-no-file`, `second bound`, `never the type`, `STRICT REVIEWER UNAVAILABLE:`), so those pins stay as they are. The writes-no-file line now lives in the printed brief, and the skill still names it as the second bound.

### 9. The byte budget (D12)

`cli/interlock` gains only:

- usage lines for `review brief --artifacts`, `routing --caller` and the gate's four flags;
- the `caller` pass-through in the `routing` case;
- the `recordFieldsOf` call in the `gate` case.

The target is about 800 bytes, well inside the 3,257 left. Every handler body lives in `lib/`. Each task that edits `cli/interlock` verifies with `node --test test/spine/package.test.mjs`, and the flag sets go in `lib/cli-flags.mjs` (`gate`, `routing`, `review brief`), which `test/spine/cli-arguments.test.mjs` and `test/spine/cli-inventory.test.mjs` hold to the usage lines and to every flag a shipped skill passes.

## Risks / Trade-offs

- [Every default spec run now spawns one reviewer, which reads about 10–15K tokens of brief plus the artifacts] → D1 accepted the cost. The record (stage, depth, reader) and the spec meter's spawn count measure it. `--lean` opts out per run.
- [The session relays a long brief verbatim and may cut it] → this is the same pattern review-code runs nine times per review. The opening block comes first, so a cut brief still says what it held. Change 5 (gate evals) is where recall under the relay gets measured.
- [Detection picks `agentic-harness` in a repository that has a `skills/` directory but is not a plugin] → provenance is printed, and `--lens` or a `REVIEW.md` lens list overrides it.
- [An older `interlock` on PATH with a newer skill] → each new command degrades aloud (D14): `ARTIFACT BRIEF UNAVAILABLE` leads to the inline read on `rubric.md`; `ROUTING UNAVAILABLE` leads to the inline read without a depth line; `GATE UNAVAILABLE` after an `unknownFlag` refusal leads to one rerun without the recording flags. `docs/16-upgrading.md` gains the rows.
- [The lean session's context grows by the brief] → it is the same text the strict reviewer reads, and it replaces the rubric prose the skill carried.
- [`REVIEW_CONTEXT.md` is quoted whole] → this matches the dimension briefs. Any cap on it is a later, measured decision.
- [The REMOVED block's required `**Migration**:` line and the design's mention of rollback raise `interlock risk` to `high`] → this is expected for a change with a design (memory: artifact prose trips the risk classifier). No critical-list word appears in these artifacts.

**Rolling it out and back.** It ships as one commit. Rolling back is a revert of that commit: the brief command, the bundled files, the caller table and the record fields leave together. Records already written with the four new keys stay readable by the reverted reader, because the keys are additive (D6). Without a revert, `/interlock:spec --lean` restores the old inline default per run.

## Open Questions

- D7 (the two cap values) is the owner's. The implementation uses the recommended 3 and 12 unless the owner answers otherwise before ship. A different answer changes two constants and nothing else.
