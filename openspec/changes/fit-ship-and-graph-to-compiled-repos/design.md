## Context

See `proposal.md` — Why, for the four issues and their reproductions. This section holds only the facts of the current code that shape the approach.

**Graph.** `buildGraph` (`lib/graph/graph/build.mjs:164-168`) hashes and then reads every walked file with no guard, so the first `EACCES` unwinds to the CLI's catch and exits 1. The reads are scattered across seven modules: five call sites are unguarded, five are guarded but silent, and one is an unguarded second read of a file already read (Decision 1 lists them). Extraction is a per-file contract — `extract(filePath, source)` returns `{ imports, exports, references }` — and `resolveImport` resolves a specifier against the set of walked *paths*. Two overlays (OpenSpec, memory) run after the per-file loop and return `{ nodes, edges }`.

**Handoffs.** `normalizeTaskResults` (`lib/waves.mjs:2251-2260`) rewrites a task that reported `ok:true` with an invalid packet to `ok:false`; `recordBatchResult` then pushes it onto `failures`, and the halt reads `failures.length` (`:2380`). Under `--isolate-waves` the lane fold is decided earlier, from the lane's own claim (`lib/run.mjs:2912`), so such a lane's writes are already folded into the shared tree by the time its task is recorded as failed. Two living requirements enshrine the current outcome: `waves` "Invalid or oversized packets fail closed" and the failure scenario of `ship-run` "A run's reported tallies SHALL be its recorded outcomes".

**Verify budget.** `LIMITS.interWaveVerifyBudgetMs` is 60 000. `planVerification` compares `elapsedMs >= budgetMs` and, past it, plans typecheck only. The run accumulates `verifyElapsedMs` on the manifest from the durations `interlock verify exec` records. `verifyStep` (`lib/run.mjs:1332`) passes no `budgetMs`, so every run uses the constant. `test/spine/verify.test.mjs:102`, `:455` and `:465-466` pin that `planVerification`, given a profile whose `unit.timeout_ms` is 120000 and no `budgetMs`, reports the published constant.

**Constraints that bind every decision below.** Zero runtime dependencies. Thresholds live in the CLI and are read at use (`ship/cap-authority`). Degradation is spoken. The implementer briefing is a frozen contract with byte-pinned fixtures (`implementer-prompts`). `hooks/mod.mjs` and its import closure stay Node-free and observe-only. A test that pins retired behaviour is rewritten only in the red wave, where `guard-tests` allows it.

## Goals / Non-Goals

**Goals:**

- An indexing command finishes on a tree it can only partly read, and says which part it could not.
- A C# + Bicep repository gets edges for its project boundaries, types, namespace imports, tests and module wiring, so `consumers`, `path` and `explain` answer for its code.
- A finished task with a malformed report is recorded as finished, and the run says the report was rejected everywhere it would have said the task failed.
- The checkpoints the per-run cap already allows run in full on a repository whose suite is slower than the published budget.
- No existing pin moves except the seven that assert the retired handoff outcome. (Amended by Decision 23: the implementer fixtures also move, by one sentence, deliberately.)

**Non-Goals:**

- **Scoping a checkpoint to the tests a wave touched** (issue #10, ask 2). Decision 19.
- **Re-asking an agent for a corrected packet** (issue #9, ask 2). Decision 13.
- **The per-run checkpoint cap and its placement.** Three checkpoints still go to the first three eligible wave boundaries. On the issue's ten-wave run this change makes those three run in full; the waves after them still reach final verification without a checkpoint between them. Spreading checkpoints across a long run is a separate decision about the cap, and this change does not take it.
- **The graph's own artifacts.** An unreadable `graph.json` still fails a query with exit 1: a query has no smaller answer to degrade to. Write failures under `.claude/graph/` are unchanged.
- **Drawing a rejected report.** The meter pane, the wave board and the handoff graph (`hooks/mod.mjs`, `lib/draw-plan.mjs`, `lib/draw-run.mjs`) draw such a task as done. The banner, the summary row, the receipt and the resume card carry the distinction.
- **C# precision beyond a line-oriented pass.** No project-membership edges, no project-wide scope for `global using`, no fully-qualified-name references, no nesting.
- **Other languages and formats.** `*.sln`, `*.props`, `*.targets`, `*.fsproj`, `*.bicepparam`.

## Decisions

### Graph: unreadable paths (#7)

**Decision 1 — One read function and one skip collector; a reader never prints.**

`lib/graph/paths.mjs` gains `readIndexed(absPath)`, which reads a file once and returns `{ ok: true, text, sha256 }` or `{ ok: false, code }`, and `createSkips(root)`, which returns a collector with `add(absPath, error, note)` and `list()`. The CLI command creates one collector, passes it to every reader, and prints what it holds when the command ends. `code` is `error.code`, or `UNKNOWN` when the error carries none.

The unit of work is the invariant "a path under the root may be unreadable", not the two lines the issue names. Every reader:

| Reader | Today | After |
|---|---|---|
| `graph/build.mjs:166-167` hash, then read, each source file | unguarded, two reads | `readIndexed`, skip |
| `graph/update.mjs:28` hash for staleness | unguarded | `readIndexed`, compared against recorded skips (Decision 4) |
| `extract/walk.mjs:73` `.gitignore`, `.interlockignore` | unguarded | skip, noted as "its patterns were not applied" |
| `extract/walk.mjs:138`, `:198` list a directory | guarded, silent | skip, spoken |
| `extract/walk.mjs:163` stat a `.json` for its size | guarded, silent | skip, spoken |
| `extract/openspec.mjs:26` | unguarded | `readIndexed`, skip |
| `extract/memory.mjs:30` | unguarded | `readIndexed`, skip |
| `retrieve/markdown.mjs:169` | guarded, silent | skip, spoken |
| `retrieve/docs-index.mjs:54`, `:58` read, then hash | guarded and silent, then an unguarded second read | `readIndexed`, skip, spoken |
| `extract/walk.mjs:185` stat a docs root | guarded | unchanged: an absent docs root is the ordinary case, not a skip |

Reading once also removes the window in which a file hashed and then unreadable would be half-recorded.

*Alternatives.* A `try`/`catch` at each call site is what two readers already have, and it is how they came to be silent. Catching at the top of the command and continuing cannot work: the loop that threw is gone.

**Decision 2 — Any error reading a path under the root is a skip, including a file that vanished.**

`EACCES`, `EPERM`, `EISDIR`, `ELOOP` and an `ENOENT` between the walk and the read are all the same event to the caller: this path contributed nothing. Classifying them would add a table nobody needs. A non-regular entry (a device node, a socket, a symlink) is not walked today and stays that way; it is not a skip, because nothing tried to read it.

**Decision 3 — One line per skip on stderr, a count on stdout, and the exit code does not move.**

```
GRAPH SKIPPED UNREADABLE: .mcp.json (EACCES)
GRAPH SKIPPED UNREADABLE: .gitignore (EACCES) — its patterns were not applied
```

The path is root-relative with forward slashes (`rel`). The `build` and `update` summary line gains ` skipped=<n>` only when `n > 0`, so a clean build prints what it printed before. stderr is where `GRAPH FROM MAIN CHECKOUT` already goes. There is no cap on the lines: an unreadable directory is one line for everything beneath it, and the manifest is the complete record either way.

When a build indexed nothing and skipped something, the language-coverage notice is replaced by one line saying that nothing under the root could be read. Printing the notice there would blame the language for a permissions problem.

**Decision 4 — The manifest records skips, and `update` compares readability as well as content.**

`manifest.json` gains `skipped: [{ path, code }]`, sorted by path. `updateGraph` rebuilds when a hash differs, a file was removed, or the set of skipped paths differs from the recorded one. A path skipped then and skipped now is not a change. Without the record, a file that can never be hashed would look changed on every run and `update` would rebuild forever. A manifest with no `skipped` key reads as an empty list. `GRAPH_REPORT.md` gains a "Not indexed (unreadable)" section when the list is non-empty. `update` prints the current skips whether or not it rebuilt.

### Graph: C# and Bicep (#8)

**Decision 5 — Three extractors behind the existing contract; path identity is normalized in the resolver.**

`extract/csproj.mjs`, `extract/csharp.mjs` and `extract/bicep.mjs` are dispatched by extension in `create-extractor.mjs`. `SOURCE_EXTS` gains `.cs`, `.csproj`, `.bicep`. `langOf` and `resolveImport` gain `csproj` and `bicep` resolvers, both path-relative to the importing file.

A project path is an identity compared in a `Set`, so it is normalized once, in `resolveImport`: backslashes become forward slashes and the result is `path.posix.normalize`d against the referencing project's directory. The extractor emits the `Include` value as written. A value holding `$(` resolves to `unresolved:`, the vocabulary the graph already has for an import it cannot place.

Bicep needs no builder change beyond its resolver. The builder already turns an import entry that names a symbol into a `references` edge to `symbol:<file>#<name>` and drops the edge when that symbol does not exist (`build.mjs:249-260`, `:310-314`). `storage.outputs.accountId` is therefore emitted as `{ from: './modules/storage.bicep', imported: 'accountId' }`: it becomes a reference when the module declares that output and nothing when it does not.

**Decision 6 — C# is linked in a pass after the per-file loop, and a namespace is one node.**

`using Acme.Core;` names a namespace, and a namespace is declared across many files, so it cannot be resolved against a set of paths. `extractCsharp` returns type declarations as `exports` (the loop turns them into symbols as it does for every language), no `imports`, and a `csharp` record: the namespaces the file declares with their lines, its `using` names with their lines, its identifiers with the line each first appears on, and its tests with their spans. A new pure module, `lib/graph/graph/link-csharp.mjs`, takes every such record and returns `{ nodes, edges }`, the shape the OpenSpec and memory overlays already return.

It produces:

- one `namespace:<Name>` node per declared namespace, and a `declares` edge to it from each declaring file, carrying that file's declaration line;
- an `imports` edge from each `using` to the namespace node, or to `external:<Name>` when the repository declares no namespace the name begins with. `global using`, `using static` and the alias form resolve to the longest declared namespace that prefixes the name;
- `references` edges, marked `INFERRED`, from a file to each type symbol it names as a whole identifier, where the type is declared in a namespace the file can see: the namespaces it declares, their enclosing namespaces, and the namespaces it imports. A file's own declarations are excluded.

A namespace is a node rather than a set of file-to-file edges for two reasons. A namespace declared in 300 files and imported by 1 000 would cost 300 000 edges as pairs and 1 300 as a node. And `findSeedNodes` returns the eight best label matches (`query.mjs:43`): were each declaration its own symbol, a namespace declared in nine files would crowd its own node out of `consumers <Namespace>`. This departs from the issue's wording, which asks for namespace declarations as symbol nodes; the line it wanted is on the `declares` edge.

`declares` is deliberately not one of the relations `consumers` follows (`query.mjs:111`). A file that declares a namespace is not a consumer of it.

A `using` is a directive only when it sits at file or namespace level and ends in `;` without a `(`, `var` or a declaration: `using var s = …;` and `using (…)` are statements.

*Known limits, stated in `skills/graph/SKILL.md` rather than left to be discovered.* A type named only by its fully-qualified name with no `using` is not seen. `global using` applies to the file that holds it, not to its project. A nested type is a symbol with no record of its nesting. A declaration-shaped line inside a verbatim or raw string literal is a false positive.

*Alternatives.* A real parser (Roslyn, tree-sitter) is a dependency, which the project rules out. Indentation or brace depth to tell top-level from nested types fails on the first brace inside a string.

**Decision 7 — A test is a node; what it touches is read from its span, not its braces.**

A method under one of a fixed table of attribute names — `Fact`, `Theory` (xUnit), `Test`, `TestCase` (NUnit), `TestMethod`, `DataTestMethod` (MSTest), each with or without arguments — becomes `test:<file>#<Type>.<Method>`, labelled `<Type>.<Method>`, where `<Type>` is the nearest type declaration above it. The signature is the first non-attribute line at or after the attribute, so `[InlineData(…)]` lines between a `[Theory]` and its method are stepped over and `[Fact] public void X()` on one line is read.

A test's span runs from its attribute line to the line before the next test attribute, or to the end of the file. Types named inside the span become `INFERRED` `references` edges from the test node. Types named outside every span — a field, a constructor — are credited to the file alone. `consumers <Type>` then names both, and prints a `consumer_test:` line for a test the way it prints `consumer_file:` for a file.

The span over-attributes: a helper method that sits between two tests is counted with the test above it. Counting braces would be exact on well-formed bodies and wrong, without saying so, on the first `"{"` in a string. An over-attribution marked `INFERRED` is the better failure.

The issue names `[Fact]` and `[Theory]`. The NUnit and MSTest names are four more entries in the same table and cost one fixture line each.

**Decision 8 — A project's `bin/` and `obj/` are skipped when the project file sits beside them.**

A .NET build writes generated sources under `obj/`, and the walker's ignore matcher does not read the `[Oo]bj/` character-class patterns a .NET `.gitignore` uses. `visit` already holds the directory's entries; a directory named `bin` or `obj` is skipped when those entries include a `*.csproj`. Adding either name to `DEFAULT_SKIP_DIRS` would stop indexing `bin/cli.js` in every JS repository, this one included.

**Decision 9 — Readers of node type and relation.**

| Reader | Effect of `namespace`, `test`, `declares` |
|---|---|
| `query.mjs:26` `findSeedNodes` | matches on label and id; generic |
| `query.mjs:111` `consumers` relations | unchanged: `imports`, `references`, `implements_spec` |
| `query.mjs:135` `consumer_file` line | add the `consumer_test` line beside it |
| `report.mjs:13`, `:19` hubs and modules | filter to `file`/`symbol` and `module`; unaffected |
| `build.mjs:347`, `cli.mjs:183-187` stats | count `file`, `symbol`, `module`; unaffected |
| `format.mjs:13` | prints `type=` generically |
| `cli.mjs` empty-graph notice | lists the new extensions |

`graph.json`'s `schema_version` stays 1: every addition is a new value of an existing field, and a reader that does not know `namespace` treats it as it treats `external`.

### Ship: rejected reports (#9)

**Decision 10 — The line between a failed task and a rejected report is the task's own claim.**

| Task reported | Packet | Recorded today | Recorded after |
|---|---|---|---|
| success | valid | done, packet stored | unchanged |
| success | missing, malformed or over budget | **failed**, counted, unticked | **done, report rejected**, uncounted, ticked |
| failure | any | failed with its own reason | unchanged |
| lane omitted an outcome | — | every task in the lane failed | unchanged |
| no result at all | — | failed (first task of a lane) | unchanged |

Three facts about the current code make this the right line rather than a relaxation.

1. *A packet's shape was never evidence of work.* A task is ticked today on its claim plus a well-formed packet. `auditHandoffEvidence`, the only check that looks at what a packet cites, is "recorded, never gated on" (`waves.mjs:2315`). Rejecting the shape tells us the report is unusable. It tells us nothing about the work, in either direction.
2. *The work is already in the tree.* The lane fold is decided from the lane's claim before the packet is validated. A task recorded as failed whose writes were folded is an unticked box over merged code, which is the re-dispatch hazard the resume card exists to warn about.
3. *The failure cap is not the correctness gate.* It exists because a run that has lost several tasks is not producing a coherent change. A rejected report loses a packet. Whether the work is sound is decided by final verification, which is unchanged and gates the commit.

*Alternatives.* Keeping such a task failed and merely not counting it is the issue's first ask read literally; the run would then commit with done work unticked and `tasks.md` contradicting the tree. Accepting more locator spellings (`path:31-73,89`) fixes one of the issue's three defects, needs a new normalizer for each malformation after it, and cannot help an over-budget packet or an empty `next`.

**Decision 11 — Rejected reports are a record of their own on the run state, and the halt does not read it.**

`normalizeTaskResults` returns `{ ok: true, handoff: null, reportRejected: <reason> }` for the second row above. `recordBatchResult` pushes the id onto `completed` and `{ id, wave, waveKind, reason }` onto `state.rejectedReports`, initializing the container when a state written earlier lacks it, as it already does for `handoffs`, `reportedPaths` and `evidenceAudits`. The halt check is not edited: it reads `failures`, and a rejected report is never put there.

`batchOutcomes` derives a batch's rejections from the tail of `rejectedReports`, the way it already derives outcomes from the tails of `completed` and `failures`, and returns `{ id, outcome: 'ok', reportRejected: <short reason> }`. Nothing per-batch is stored.

A state in which an earlier version recorded such a task as failed is read as written. Nothing is reclassified after the fact.

**Decision 12 — Every reader of the tally.**

The recorded meaning of "failed" narrows, and a new tally travels beside it. Readers that rebuild an object from a whitelist are the ones that would drop the new field without any test noticing.

| Reader | Change |
|---|---|
| `waves.mjs:2380` the halt | none — reads `failures` |
| `waves.mjs` `batchOutcomes` | carries `reportRejected` (Decision 11) |
| `waves.mjs` `summarize`, `formatRunState` | a count and a line, only when non-zero |
| `waves.mjs` `nextStep` | `previousRejectedReports`: `[{ taskId, reason, paths }]` for the immediately previous wave, from `rejectedReports` and `reportedPaths` |
| `run.mjs:2051` `recordedOutcomes` | **whitelist** — add `reportRejected` or it is dropped |
| `run.mjs:2075` `adjudicateBatches` | returns `rejected`; `overrides` is untouched, because claim and record now agree and `CLAIM OVERRIDDEN` would be false. A rejected packet was the only way `record-batch` recorded a claimed success as a failure, so after this change no real run raises that banner; the logic stays, pinned by its unit cases, for the next adjudication that can disagree with a claim |
| `run.mjs:3060` `manifest.waves` rows | `reportRejected: [ids]` |
| `run.mjs:3094` step `recorded` | `reportRejected: [ids]`; `RELAY_STEP_FIELDS` already carries `recorded` whole |
| `run.mjs:1115` `PASS_THROUGH`, `decorate` | carry `previousRejectedReports` to the briefing |
| `prompts/implementer.mjs` | a block, rendered only when the list is non-empty |
| `receipt.mjs:178-183` receipt wave rows | **whitelist** — add `reportRejected` |
| `receipt.mjs` summary | one new row; the `wave N (kind): X ok, Y failed` rows are not edited (`ship/close-summary`) |
| `resume-card.mjs:288` | names rejected reports when the run had any |
| `outcomes.mjs:179`, `run-log.mjs:220`, `:1007` | **whitelists** — carry the field; absent reads as unobserved, not zero |
| `bin/interlock` `wave-state record-batch` | prints `batchOutcomes`; carries automatically |
| `hooks/mod.mjs:1570`, `draw-plan.mjs:115`, `draw-run.mjs:254` | none (Non-Goals) |

The banner, raised once per batch that held any:

```
HANDOFF REJECTED: 5.3 — evidence entry "src/…/DeviceMetricSource.cs:31-73,89" is not a locator (…); 8.1 — handoff is 3562 characters; the cap is 2000 — recorded as done and not counted toward the task-failure cap; the next wave is told these tasks filed no usable report
```

The summary row:

```
  handoff reports rejected: 5.3, 8.1, 9.2, 9.4
```

The next wave's briefing, after the validated packets and only when a previous-wave report was rejected:

```
NO VALIDATED REPORT (the packet was rejected; read the paths, assume nothing):
- [1.2] rejected: handoff is 3562 characters; the cap is 2000 — reported touching: src/a.cs
```

It carries the reason and the reported paths. It carries no text of the rejected packet: an over-budget summary handed on as a "notice" would be the truncation-by-another-name the schema forbids. With an empty list the assembler renders nothing, so every existing implementer fixture stays byte-identical.

**Decision 13 — No re-ask in this change.**

The issue's second ask is to re-ask the same agent once with the validation error. On the Workflow host an agent cannot be continued, so the only "same agent" form is a self-check: a `wave-state check-handoff` command that the implementer briefing tells the agent to run before it returns. That is a line added to every implementer briefing, and the briefing is a frozen contract whose single-task fixtures `implementer-prompts` requires to stay unmodified. A fresh repair agent instead means a new step action, spawn kind, effort row and trajectory event for a job that recovers a packet, not a task.

Neither is needed to stop the halt, and the issue marks the ask optional. If rejected reports turn out to be frequent, the banner and the receipt field this change adds are what will show it, and the self-check is the follow-up.

### Verify budget (#10)

**Decision 14 — One function derives the budget; `planVerification` is not touched.**

`lib/verify.mjs` gains:

```
interWaveVerifyBudget(profile) -> { ms, source: 'profile' | 'published', timeoutMs: number | null }
ms = max(LIMITS.interWaveVerifyBudgetMs,
         min(LIMITS.interWaveVerifications * unit.timeout_ms, Number.MAX_SAFE_INTEGER))
```

when `unit.timeout_ms` is a positive integer, and the published constant otherwise. `timeoutMs` is the profile's value when it is usable and `null` when it is not, so a caller can tell a budget left at the floor because the profile said nothing from one left there because the profile's own allowance is small. Both factors are read from `LIMITS` at use.

`planVerification` keeps its signature and its default. Its callers pass `budgetMs`. Putting the derivation inside it would move the three existing pins named under Context, which assert that a profile with a `timeout_ms` and no `budgetMs` reports the published constant, and those pins describe a caller that stated no budget, which is still true.

*Why multiply by the cap.* The budget is cumulative across a run, and a run may spend at most `interWaveVerifications` checkpoints. `unit.timeout_ms` is the profile's allowance for one suite run. The product is the allowance for the checkpoints the cap already permits.

*Why a floor.* With it, the only thing a profile can do to the budget is raise it, and the only effect of raising it is that later checkpoints run the suite instead of dropping to typecheck. A profile cannot be edited into less verification. The checkpoint cap bounds the cost of an inflated value: at most `interWaveVerifications` full checkpoints.

*Alternatives.* A budget calibrated from the run's own first checkpoint needs no profile, but it is a threshold computed mid-run from a file the verify agent's tree can write. A new explicit profile field (the issue's third ask) adds schema for something `unit.timeout_ms` already is: a human-committed, per-repository value in `profile.json`.

**Decision 15 — Readers of the budget.**

| Reader | Change |
|---|---|
| `verify.mjs:221` `planVerification` default | none |
| `run.mjs` `settleStateHome` (`:2415`, where `testProfilePath` is recorded) | derive once; store `manifest.verifyBudget = { ms, source, timeoutMs }` |
| `run.mjs:1332` `verifyStep` | pass `budgetMs` from the manifest; a manifest without the field passes nothing and gets the published default |
| `bin/interlock:2574-2577` `verify plan` | with `--context inter-wave`, a profile and no `--budget-ms`: derive, and print `budgetSource` beside `budgetMs` |
| `bin/interlock:655` help text | says the default is derived for the inter-wave context |
| `limits.mjs:562` the limits row | relabelled `inter-wave verify budget (floor)`; the `--json` key is unchanged |
| `receipt.mjs`, `run-log.mjs` | carry `verifyBudget` |

**Decision 16 — Fixed at run start.**

The budget is derived where the run locates its profile and is not read again. A run is then a record with one budget on it, and an agent working in the tree cannot move a threshold of the run it is part of, in either direction. A run resumed from a manifest written before the field existed uses the published constant and says nothing new.

**Decision 17 — A budget left at the floor says why it ran out.**

When a checkpoint is reduced for `verify-budget-exceeded` and the run's profile carried no usable `unit.timeout_ms` (`verifyBudget.timeoutMs` is `null`), the run raises, once:

```
VERIFY BUDGET AT THE PUBLISHED FLOOR: the test profile carries no unit.timeout_ms, so the inter-wave budget was not raised to fit this suite — run /interlock:fix-tests --reconfigure to record one
```

`manifest.verifyBudgetFloorSpoken` keeps it to once. This is the one case where the run can name the cause and the remedy, and without it the reader sees the same `VERIFICATION SKIPPED` line the issue reported. A budget at the floor because the profile's own allowance is small raises nothing: that profile had its say, and the banner's sentence would be false.

**Decision 18 — `/interlock:fix-tests` records `unit.timeout_ms` from a measured run.**

`skills/fix-tests/SKILL.md` does not mention `timeout_ms` today, so profiles carry the schema's example value or none (this repository's has none). The skill gains one instruction: after a green full unit run, write `unit.timeout_ms` as that run's wall time rounded up, and never write a value below a wall time it has measured. No multiplier is stated in prose. `shared/TEST-PROFILE.md` names the inter-wave budget as a second reader of the field. Both are pinned by token in `test/skills.test.mjs`, because an instruction nothing asserts stops running.

**Decision 19 — Checkpoints are not scoped to the tests a wave touched.**

1. With the budget fitted to the suite, the three checkpoints the cap allows run in full. The reported defect is closed without narrowing any checkpoint.
2. A checkpoint scoped to the tests a wave *touched* would not have caught the regression the issue itself reports: two existing count-pinning tests, broken by the change, that the wave did not edit. Only the full suite, or selection by what the wave's files are *consumed by*, catches those.
3. Selection by consumers needs the C# test nodes and reference edges this change adds, and `single_file` is prose in `TEST-PROFILE.md` ("path implied, or template"), not a contract the planner can substitute into. `dotnet test` takes a project, not a file. Both have to be settled before the planner may build a command, and `planVerification` never synthesizes one.

### Review follow-ups

A review of the first commit of this change found five places where it did not meet its own specs or told a reader something false. They are decided here rather than folded into the decisions above, so the record shows what the run shipped and what was corrected after it.

**Decision 20 — A rejected report hands on no more than a valid packet may.**

Decision 12 said the next wave's notice "carries no text of the rejected packet". Two paths broke that. `validateHandoff` quoted the offending value whole in four of its messages (a wrong `schema`, `taskId` or `status`, and an evidence entry that is not a locator), one of them unescaped; and the notice listed every string the task reported as a path, with no check and no limit. The banner path was already bounded by `shortReason`; the run state and the briefing were not. A task whose packet was rejected for being too long could therefore hand the next wave more text than a task whose packet was accepted.

- The validator quotes an agent-supplied value JSON-escaped and clipped, so the reason is one line and a short diagnostic. A short value is quoted exactly as before.
- The reason is bounded where it is stored (`recordBatchResult`), through the same `shortReason` the banner uses, so every reader of `rejectedReports` holds the same short reason.
- The paths are listed only while each is a single line and the list fits `LIMITS.maxHandoffChars`, read at use. What is left out is counted as `pathsOmitted` and the briefing says `(+N more not listed)`. The key is present only when something was left out, so a report that fits is the step and the prompt it always was. `reportedPaths` on the run state is not touched: it is the evidence audit's input and stays whole.

*Alternative.* Removing the quoted value from the reason entirely. The issue's own banner example quotes the malformed locator, and that quote is what tells a reader which agent habit to fix; a clipped quote keeps it.

**Decision 21 — The banner says who was told, and the review is told.**

`rejectedBanner` ended every banner with "the next wave is told these tasks filed no usable report". On the last wave there is no next wave, and no later stage received the ids or the paths. The clause is now chosen from the run's own shape, at the one place a batch is recorded:

| A later wave exists | Run | Clause |
|---|---|---|
| yes | any | the next wave is told (unchanged) |
| no | `--review` / `--strict` | no later wave remains; the review is told instead; final verification still gates the commit |
| no | default | no later wave remains; final verification is the only check on this work |
| no | `--apply-only` | no later wave remains and the run ends here; nothing in this run checks this work |

`reviewStep` hands `assembleReviewPrompt` every rejected report of the run (`runRejectedReports`), bounded as in Decision 20, in an `UNVALIDATED REPORTS` block framed as quoted run data the way the policy block is: where to look, not a finding and not an instruction. The whole run's, not the last wave's alone, because the review reads the whole diff. An empty list renders nothing, so every existing review prompt is byte-identical.

A rejected report on the last wave still does not stop the commit. Decision 10's argument holds there as it does anywhere: the packet's shape is not evidence about the work, and final verification gates the commit. What changes is that the run no longer claims a reader it does not have. *Alternative considered and declined:* halting before the commit on a last-wave rejection, which would reintroduce issue #9's halt at exactly one wave.

**Decision 22 — The floor banner belongs to the reduction, not to an empty plan.**

Decision 17 says the banner is raised "when a checkpoint is reduced". The implementation raised it only where the plan came out empty. Typecheck is the one check that survives a spent budget, so a profile that names a typecheck command never produces an empty plan: its checkpoint is cut to typecheck alone, the suite is dropped, and the banner never fired. Its test used a profile with no typecheck command. The condition is now "a check was skipped for the spent budget", evaluated before the branch on an empty plan, and raised in both branches, still once per run.

**Decision 23 — The briefing's over-cap sentence is corrected.**

The implementer briefing said a packet over the cap "fails the task". After Decision 10 that is false. Decision 13 left the briefing alone because `implementer-prompts` required the single-task fixtures to stay unmodified, and that was the right call for adding a line; it is the wrong call for leaving a false sentence in every implementer's briefing. The sentence now says the packet is rejected whole, is never truncated, and leaves the task recorded as having filed no usable report. The 15 implementer fixtures and the 4 eval cases that quote the sentence change with it, and `implementer-prompts` is modified to say what the pin is for: drift, not the wording forever.

*Cost, accepted.* Every implementer prompt changes by that sentence, so a Workflow run resumed across this upgrade re-runs lanes it had finished: the replay cache is keyed on the prompt.

**Decision 24 — A query says when its graph is partial.**

Decision 3 keeps the exit code at 0 on a skip, and the Non-Goals leave queries alone. That left a reader the change did not account for. `skills/bootstrap` branches on the exit code of `interlock-graph build` and had no branch for a partial graph; and a query — run later, often by an agent that never saw the build — answered from a partial graph in silence, which `GRAPH FROM MAIN CHECKOUT` already established is not how this CLI treats a degraded graph.

- `query`, `consumers`, `path`, `explain` and `context` print one `GRAPH PARTIAL` line on stderr, with the count, from the manifest beside the graph actually read. stdout and the exit code do not move. A manifest with no skips, with no `skipped` key, or that cannot be parsed prints nothing: a query that never needed the manifest does not start failing on it.
- `skills/bootstrap/SKILL.md` branches on `skipped=` in the summary line and on the nothing-readable notice, and carries `GRAPH PARTIAL` to its report.

*Alternative declined.* A `--strict` flag making `build` and `update` exit non-zero on any skip. Nothing in the repository would pass it, and the summary line already carries the fact a script needs.

**Decision 25 — This repository's own graph ignores its graph fixtures.**

Indexing `.cs` made `test/graph/fixtures/mini-dotnet/` part of this repository's graph, and the OpenSpec overlay links any capitalised word of prose to a symbol of the same name. `Cache`, `Probe`, `Reading` and `Dashboard` are fixture type names and ordinary words in the specs: 86 spec-to-fixture edges, against 5 before. A root `.interlockignore` names `test/graph/fixtures/`. The tests copy fixtures to temp roots and are unaffected; the file is not in the published package. The overlay's matcher is unchanged.

Also corrected, with no decision to take: `/interlock:fix-tests` now says the recorded `unit.timeout_ms` is whole milliseconds and an integer (a non-integer aborts verification planning, and a value written in seconds leaves the budget on the floor with the floor banner suppressed); the `record-batch` help, which still said a bad packet is "recorded as failed"; `docs/04`'s "roughly a minute"; and `ship/completion-gate`, whose failure scenario used a rejected packet as its example and had no delta here.

**Left as designed.** The budget is the checkpoint cap times one suite run's allowance, with no headroom: typecheck, lint and a repair re-run are charged to it, so a late checkpoint can still drop to typecheck, and says so as `VERIFICATION SKIPPED`. Giving it headroom is a threshold decision and is not taken here.

## Risks / Trade-offs

- **[An agent that returns a bare `ok:true` is ticked]** → It was already ticked on `ok:true` plus a well-formed packet, and well-formedness is not evidence. The rejection is bannered, tallied and on the receipt, so a reader knows exactly which ticks rest on a claim with no usable report. Final verification gates the commit.
- **[A run that used to halt now continues, spends more, and may halt later at final verification]** → That is the intended trade. It reaches the stage that can actually tell whether the work is sound.
- **[Inferred C# references are approximate]** → Every one is marked `INFERRED`; the limits are listed in the graph skill; the implementer briefing already says to grep when the graph does not answer.
- **[Edge count on a large solution]** → One node per namespace; one reference edge per (file, type) and per (test, type), deduplicated.
- **[A declaration-shaped line in a string literal becomes a symbol]** → Accepted and documented. The cost is a spurious node, never a missing one.
- **[`unit.timeout_ms` is the schema example, not a measurement]** → Decision 18, and the floor banner when there is none. With the example value of 120000 and the issue's own timings (at most 175s a checkpoint), the third checkpoint starts at 350s of a 360s budget, so all three run in full where one did.
- **[A raised budget lengthens a run]** → Bounded by the unchanged checkpoint cap times the profile's own allowance for one suite run.
- **[A tree of thousands of individually unreadable files prints thousands of lines]** → A directory is one line; the sandbox case is a handful of files; the manifest is the record.
- **[Seven tests pin the retired outcome]** → Six are named in `tasks.md` and rewritten in the red wave to assert the new outcome with the same inputs. The seventh, `test/workflows.test.mjs:2457`, was missed by the sweep, turned final verification red, and was rewritten by hand on the same rule after the run halted. None is deleted.
- **[A reader outside this repository equates "invalid packet" with a failed task]** → The outcome corpus and the trajectory gain a field and lose nothing. A record written before the field existed reads it as unobserved.

## Migration Plan

Every addition is optional on read, so there is no migration step.

- A run state without `rejectedReports`, a run manifest without `verifyBudget`, a graph manifest without `skipped`, and a receipt without `reportRejected` each read as they did.
- A state written by this version and read by an earlier one shows a rejected-report task as completed and ignores the record.
- `graph.json` is rebuilt by `interlock-graph build`; nothing reads an old graph differently.
- Rollback is reverting the commit. No stored file needs repair afterwards.

The change in recorded outcome is called out as breaking in `CHANGELOG.md`, with the banner and the summary row a reader should now look for.

## Open Questions

None that change the specs, the approach or the tasks. Deferred, each visible in what this change records:

- Whether checkpoints should be spread across a long run instead of spent on its first three boundaries.
- Whether rejected reports are frequent enough to warrant the packet self-check (Decision 13).
- Graph-driven test selection for checkpoints, once the C# test nodes have been used on a real solution.
