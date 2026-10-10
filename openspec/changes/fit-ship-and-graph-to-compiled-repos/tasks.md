## 1. Failing tests first (TDD, red)

Every test edit in this change happens in this section. Each task ends by running its file and recording that it is red for the reason stated. No task here touches `lib/`, `bin/`, `skills/`, `shared/` or `docs/`.

- [x] 1.1 Create the two graph fixtures. No test file yet.
  - `test/graph/fixtures/mini-dotnet/`:
    - `src/Core/Core.csproj` (no references); `src/App/App.csproj` with `<ProjectReference Include="..\Core\Core.csproj" />`; `src/Api/Api.csproj` with `<ProjectReference Include="../Core/Core.csproj" />` and `<ProjectReference Include="$(RepoRoot)src\Gone\Gone.csproj" />`; `tests/Core.Tests/Core.Tests.csproj` referencing `..\..\src\Core\Core.csproj`.
    - `src/Core/DeviceMetricSource.cs`: line 1 `namespace Acme.Core;`, line 5 `public sealed class DeviceMetricSource`. Also the lines `// public class Ghost` and, inside a block comment, ` * class Ghost`.
    - `src/Core/Shapes.cs`: a block-scoped `namespace Acme.Core` with its `{` on the next line, holding `public readonly record struct Reading(double Value)`, `internal enum Unit`, `public interface IMetricSource`, `public class Cache<T>`. `src/Core/Cache.Extra.cs`: `namespace Acme.Core;` and `public partial class Cache<T>`.
    - `src/Core/Sensors/Probe.cs`: `namespace Acme.Core.Sensors;`, no `using`, naming `DeviceMetricSource` and `DeviceMetricSourceFactory`.
    - `src/App/Dashboard.cs`: `using Acme.Core;`, `using System.Text;`, `global using Acme.Core;`, `using static Acme.Core.Units;`, `using Metrics = Acme.Core.Metrics;`, a method holding `using var stream = Open();`, and a use of `DeviceMetricSource`.
    - `src/Api/Orphan.cs`: `namespace Acme.Api;`, no `using` of `Acme.Core`, naming `DeviceMetricSource`.
    - `tests/Core.Tests/DeviceMetricSourceTests.cs`: `using Acme.Core;`, `public class DeviceMetricSourceTests`, a field `private readonly IMetricSource _shared;` above every test, then `[Fact]` over `public void Reads_metric()` whose body names `DeviceMetricSource`; `[Theory]` + two `[InlineData(...)]` lines + `public void Scales(double v)`; `[Fact(Skip = "flaky")] public async Task Skipped()` on one line; `[Obsolete] public void Old()`; `[Test] public void Nunit_style()`; `[TestMethod] public void Mstest_style()`; and `public void Helper()` with no attribute.
    - `src/App/obj/Debug/net10.0/App.AssemblyInfo.cs`, `src/App/bin/Debug/App.Generated.cs`, and `src/App/Models/obj/Thing.cs` (no project file in `src/App/Models/`).
  - `test/graph/fixtures/mini-bicep/`: `infra/main.bicep` with `module storage './modules/storage.bicep' = {`, `module a './a.bicep' = if (deploy) {`, `module b '../shared/b.bicep' = [for n in names: {`, `module shared 'br:acme.azurecr.io/bicep/shared:v1' = {`, `output id string = storage.outputs.accountId`, `output gone string = storage.outputs.missing`, and `@description('the sku')` directly above `param sku string`; `infra/modules/storage.bicep` with `param location string`, `var prefix = 'st'`, `resource account 'Microsoft.Storage/storageAccounts@2023-01-01' = {`, `output accountId string = account.id`; `infra/a.bicep` and `shared/b.bicep`, each holding one `param`.
  - Confirm `git check-ignore` matches none of the files under either fixture, the `obj/` and `bin/` ones included.

- [x] 1.2 Write `test/graph/unreadable.test.mjs`. Each case copies `test/graph/fixtures/mini-app` to a temp dir (the `copyDir` idiom of `build-query.test.mjs`) and denies reading with `fs.chmodSync(p, 0o000)`, restoring the mode in `after`. A helper `permissionsEnforced()` writes a file, sets mode `000`, and tries to read it; every `chmod`-dependent case calls `t.skip('this user can read a mode-000 file')` when it returns false. The `readIndexed` cases use a directory path and need no permissions. Cases drive `bin/interlock-graph` through `spawnSync` and assert on status, stdout and stderr:
  - **Build finishes:** with a `.mcp.json` the case writes and then makes unreadable, `build .` exits 0; `graph.json` holds file nodes for the fixture's sources and none for `.mcp.json`; stderr has exactly one line containing `GRAPH SKIPPED UNREADABLE`, `.mcp.json` and `EACCES`; the stdout summary line contains `skipped=1`.
  - **Clean tree:** with nothing unreadable, stderr is empty and the summary line does not contain `skipped=`.
  - **Directory:** an unreadable `vault/` holding `x.mjs` is one stderr line naming `vault`, and no node has a `source_file` under `vault/`.
  - **Ignore file:** an unreadable `.gitignore` naming `generated/`, with `generated/g.mjs` present: exit 0, one line naming `.gitignore` and containing `its patterns were not applied`, and `generated/g.mjs` is a file node.
  - **Nothing readable:** every source file unreadable: exit 0, the summary shows `files=0`, each path is named, and stdout does not contain `are not structurally indexed yet`.
  - **Manifest and report:** `manifest.json` `skipped` deep-equals `[{ path: '.mcp.json', code: 'EACCES' }]` and `files` has no `.mcp.json` key; `GRAPH_REPORT.md` contains `.mcp.json` under a heading containing `Not indexed`. On a clean tree `skipped` is `[]` and the report has no such heading.
  - **Old manifest:** delete the `skipped` key from a written manifest, run `update .`: exit 0 and stdout contains `up to date`.
  - **Update, still unreadable:** after a build that skipped `.mcp.json`, `update .` prints `up to date`, leaves `graph.json`'s `built_at` unchanged, and stderr names `.mcp.json`.
  - **Update, became unreadable:** deny a source file that was indexed: `update .` exits 0, stdout starts `Updated graph`, the file's node is gone, stderr names it.
  - **Update, became readable:** restore a skipped source file: `update .` rebuilds, the file is a node, stderr does not name it.
  - **Prose retrieval:** an unreadable `docs/internal.md` beside a readable `docs/guide.md`: `docs-index .` and `docs "guide"` each exit as they do without it and each name `docs/internal.md` on stderr.
  - **A path with a space and a non-ASCII character:** an unreadable `docs/My Notes ü.md` is named whole on one line, with forward slashes.
  - **`readIndexed`:** imported from `lib/graph/paths.mjs`; a readable file returns `{ ok: true, text, sha256 }` with `sha256` equal to `createHash('sha256')` of its bytes; a directory path returns `{ ok: false, code: 'EISDIR' }`; `createSkips(root).add(abs, {})` lists the path with code `UNKNOWN`.

  Run `node --test test/graph/unreadable.test.mjs` and record that it fails, on the `EACCES` exit 1 and the missing `readIndexed` export. (spec: graph/unreadable-paths — all four requirements)

- [x] 1.3 Write `test/graph/dotnet-bicep.test.mjs`. Build each fixture in a temp copy with `buildGraph` + `writeGraphArtifacts` + `loadGraph`, and query through `consumers` and `explain` from `lib/graph/graph/query.mjs`. Cases:
  - **Project references:** `consumers(graph, 'src/Core/Core.csproj')` names `src/App/App.csproj`, `src/Api/Api.csproj` and `tests/Core.Tests/Core.Tests.csproj` on `imports` edges marked `EXTRACTED`; the graph holds exactly one node whose id is `file:src/Core/Core.csproj`; the `$(RepoRoot)` reference has an `unresolved:` target and no `file:` target.
  - **Types:** symbols `DeviceMetricSource` (in `src/Core/DeviceMetricSource.cs`, `source_location` `L5`), `Reading`, `Unit`, `IMetricSource`, and `Cache` in both `Shapes.cs` and `Cache.Extra.cs`; no node labelled `Ghost`; no symbol labelled `Cache<T>`.
  - **Namespaces:** exactly one node with id `namespace:Acme.Core`; a `declares` edge to it from each of the three files that declare it, the one from `DeviceMetricSource.cs` at `L1`; `consumers(graph, 'Acme.Core')` names `src/App/Dashboard.cs` on an `imports` edge and names no file through `declares`.
  - **Using forms:** `Dashboard.cs` has an edge to `external:System.Text` and no `unresolved:` target; its `global using`, `using static` and alias directives each resolve to `namespace:Acme.Core`; no edge from it has a target containing `stream` or `Open`.
  - **Inferred references:** `consumers(graph, 'DeviceMetricSource')` names `src/App/Dashboard.cs` and `src/Core/Sensors/Probe.cs` on `references` edges marked `INFERRED`; it names neither `src/Api/Orphan.cs` nor `src/Core/DeviceMetricSource.cs`; no symbol labelled `DeviceMetricSourceFactory` exists and `Probe.cs` has exactly one `references` edge to a `DeviceMetricSource` symbol.
  - **Tests:** nodes of type `test` labelled `DeviceMetricSourceTests.Reads_metric`, `.Scales`, `.Skipped`, `.Nunit_style` and `.Mstest_style`, each with a `source_location`; none for `Old` or `Helper`; `consumers(graph, 'DeviceMetricSource')` output contains `consumer_test:` and `Reads_metric`; the file references `IMetricSource` and no test node does.
  - **Build output:** no node's `source_file` starts with `src/App/obj/` or `src/App/bin/`; `src/App/Models/obj/Thing.cs` is a file node. In a second temp tree holding only `bin/cli.js`, `bin/cli.js` is a file node.
  - **Bicep:** `infra/main.bicep` imports `infra/modules/storage.bicep`, `infra/a.bicep` and `shared/b.bicep`; the `br:` module's target is `external:`; symbols `location`, `prefix`, `account`, `accountId` belong to `infra/modules/storage.bicep`; `sku` is a symbol whose line is the `param` line, not the decorator line; `consumers(graph, 'accountId')` names `infra/main.bicep`; no edge has a target ending `#missing`.
  - **Stated coverage:** `spawnSync` of `bin/interlock-graph build` on a temp tree holding only `main.go`: exit 0, stdout contains `.cs`, `.csproj`, `.bicep` and `not structurally indexed`. On a tree holding only `infra/main.bicep`: stdout contains `files=1` and not `not structurally indexed`.
  - **Extractor units:** `extractCsproj`, `extractCsharp`, `extractBicep` imported from `lib/graph/extract/`: `extractCsharp` on a file-scoped and a block-scoped source returns the same `csharp.namespaces` names; `resolveImport('src/App/App.csproj', '..\\Core\\Core.csproj', index)` and the forward-slash spelling return the same `id`.

  Run `node --test test/graph/dotnet-bicep.test.mjs` and record that it fails, on the missing extractor modules. (spec: graph/csharp-and-bicep — all eight requirements)

- [x] 1.4 In `test/spine/waves.test.mjs`, rewrite the cases that pin the retired outcome and add the new ones. Keep each rewritten case's inputs; change what it asserts.
  - `:1756` 'record-batch fails a task that claims success without a handoff' → the task is in `completed`, `failures` is empty, `rejectedReports[0]` names the id with a reason matching `/handoff must be an object/`. Retitle it to say what it now asserts.
  - `:1767` 'an invalid packet fails the task and counts toward the failure halt' → `LIMITS.taskFailureHalt + 1` such tasks leave `halt` null, `failures` empty, and that many `rejectedReports`.
  - `:1788` 'an over-budget packet fails the task rather than being trimmed' → the task is completed, `handoffs` has no key for it, `rejectedReports[0].reason` matches `/the cap is/`. The never-trimmed assertion stays.
  - The `batchOutcomes` case asserting `outcomes[1].reason` at `:1855` → `outcomes[1]` is `{ id, outcome: 'ok', reportRejected }` with `reportRejected` matching `/status/`.
  - `:2216` 'an over-budget packet still fails closed, with no verdict stored for it' → the packet is not stored, `evidenceAudits` has no key for the task, and the task is completed with a rejected report.
  - New, **the issue's run:** three `ok:true` tasks carrying an evidence entry `src/DeviceMetricSource.cs:31-73,89`, a 3562-character summary, and an empty `next`: no halt, three completed, three rejected reports with three distinct reasons, `failures.length === 0`.
  - New, **real failures still halt:** `LIMITS.taskFailureHalt` `ok:false` tasks plus four rejected reports do not halt; one more `ok:false` halts with `kind === 'task-failures'` and a reason naming `LIMITS.taskFailureHalt + 1`.
  - New, **a failed task keeps its reason:** `ok:false` with `error: 'could not resolve the build'` and no handoff is in `failures` with that error and has no rejected report.
  - New, **the boundary:** a packet whose counted characters equal `LIMITS.maxHandoffChars` is stored unchanged; one character more is rejected.
  - New, **an older state:** a state with no `rejectedReports` key and two `failures` whose errors start `invalid handoff:` records a further batch: the key is initialized, the two failures are still there and still counted.
  - New, **the next wave is told:** after wave 1 with task `1.2` rejected and `filesChanged: ['src/a.cs']`, `nextStep` for wave 2 carries `previousRejectedReports` deep-equal to `[{ taskId: '1.2', reason: <the reason>, paths: ['src/a.cs'] }]`; the rejected packet's summary string appears nowhere in `JSON.stringify(step)`; `nextStep` for wave 3 carries no `previousRejectedReports` key.
  - New, **`formatRunState`:** contains `report(s) rejected` when there is one and does not when there is none.
  - Leave `:2367` (`exactly LIMITS.taskFailureHalt task failures continue; one more halts`) and `:2395` untouched; they must still pass.

  Run `node --test test/spine/waves.test.mjs` and record which cases fail. (spec: waves — A rejected packet SHALL fail closed without failing a task that reported success; A rejected report SHALL NOT count toward the task-failure halt; The next wave SHALL be told which previous-wave tasks filed no usable report; A recorded batch SHALL report its per-task outcomes to its caller; Per-task handoff is a fixed schema; Retaining paths and verdicts SHALL NOT add a way for a run to stop)

- [x] 1.5 In `test/spine/verify.test.mjs` add cases for `interWaveVerifyBudget`, imported from `lib/verify.mjs`:
  - a profile with `unit.timeout_ms: 120000` returns `{ ms: LIMITS.interWaveVerifications * 120000, source: 'profile', timeoutMs: 120000 }`;
  - `timeout_ms: 1` returns `{ ms: LIMITS.interWaveVerifyBudgetMs, source: 'published', timeoutMs: 1 }`;
  - a `null` profile, and `timeout_ms` absent, `null`, `0`, `-5`, each return `{ ms: LIMITS.interWaveVerifyBudgetMs, source: 'published', timeoutMs: null }`;
  - `timeout_ms: Number.MAX_SAFE_INTEGER` returns `ms === Number.MAX_SAFE_INTEGER` and `Number.isSafeInteger(ms)`;
  - `planVerification(profile(), { context: 'inter-wave', elapsedMs: 160000, budgetMs: interWaveVerifyBudget(profile()).ms })` still plans the `unit` step.
  - Do not edit the cases at `:102`, `:455` and `:465-466`. They assert `planVerification`'s own default and must still pass unchanged.

  Run `node --test test/spine/verify.test.mjs` and record that it fails on the missing export. (spec: verify — The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant)

- [x] 1.6 In `test/spine/run.test.mjs` add cases, using the file's existing run harness:
  - **Record-batch, rejected report:** a batch of two `ok:true` results, one with a 3562-character summary. The returned step's `banners` contain one string with `HANDOFF REJECTED`, the task id and `the cap is`; no banner contains `CLAIM OVERRIDDEN`; the task's box is ticked in the fixture `tasks.md`; the last `manifest.waves` row has `failed: 0` and `reportRejected: [<id>]`; `step.recorded.reportRejected` deep-equals `[<id>]`.
  - **The next wave's briefing:** the first step of the next wave has a spawn whose `prompt` contains `NO VALIDATED REPORT`, the task id and a reported path, and does not contain the rejected summary's text.
  - **Budget at start:** `runStart` against a root whose profile has `unit.timeout_ms: 120000` writes `manifest.verifyBudget` deep-equal to `{ ms: LIMITS.interWaveVerifications * 120000, source: 'profile', timeoutMs: 120000 }`; with no `timeout_ms`, `{ ms: LIMITS.interWaveVerifyBudgetMs, source: 'published', timeoutMs: null }`.
  - **Budget applied:** with `verifyElapsedMs: 160000` and the profile budget on the manifest, the inter-wave verify step's `vplan-inter-wave.json` holds a `unit` step. With `verifyBudget` deleted from the manifest and the same elapsed time, it does not.
  - **Fixed at start:** rewrite the profile's `timeout_ms` to `1` and then to `900000` after `runStart`; each later verify step's plan reports the `budgetMs` recorded at start.
  - **The floor banner, once:** with `verifyBudget.timeoutMs` `null` and `verifyElapsedMs` at the constant, the step's banners include one containing `VERIFY BUDGET AT THE PUBLISHED FLOOR` and `/interlock:fix-tests --reconfigure`; a second reduced checkpoint in the same run does not add it again. It is not raised when the budget is at the floor with `timeoutMs: 1`, and never when the source is `profile`.
  - Leave the cases at `:2738` and `:3452` untouched.

  Run `node --test test/spine/run.test.mjs` and record which cases fail. (spec: verify — A run SHALL fix its inter-wave verify budget at start and SHALL report it; waves — The next wave SHALL be told which previous-wave tasks filed no usable report; ship-run — A run's reported tallies SHALL be its recorded outcomes)

- [x] 1.7 In `test/spine/cli.test.mjs`:
  - Rewrite the case asserting `step.recorded[1].reason` at `:1451`: `recorded[1]` has `outcome: 'ok'` and a `reportRejected` matching `/status/`.
  - New: `verify plan --profile <a profile with unit.timeout_ms 120000> --context inter-wave --elapsed-ms 160000 --json` reports `budgetMs === LIMITS.interWaveVerifications * 120000`, `budgetSource === 'profile'`, and a `unit` step.
  - New: the same with a profile whose `timeout_ms` is `1` and `--elapsed-ms` equal to `LIMITS.interWaveVerifyBudgetMs` reports the published budget, `budgetSource === 'published'`, and no `unit` step.
  - New: `--budget-ms 5000` reports `budgetMs === 5000` whatever the profile holds.
  - New: `verify plan --profile <same> --json` with no `--context` reports the published budget.

  Run `node --test test/spine/cli.test.mjs` and record which cases fail. (spec: verify — The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant; waves — A recorded batch SHALL report its per-task outcomes to its caller)

- [x] 1.8 In `test/workflows.test.mjs`, beside the existing `recordedOutcomes` and `adjudicateBatches` cases (`:4003`):
  - `recordedOutcomes([{ id: '1.1', outcome: 'ok', reportRejected: 'the cap is 2000' }])` returns an entry that still carries `reportRejected`;
  - `adjudicateBatches` over a claim `{ id: '1.1', ok: true }` with that verdict returns `tickIds: ['1.1']`, `overrides: []`, and `rejected` deep-equal to `[{ id: '1.1', reason: 'the cap is 2000' }]`; its `waves[0]` has `failed: 0` and `reportRejected: ['1.1']`;
  - `RELAY_STEP_FIELDS` includes `recorded`, and `relayStep` on a Workflow-host manifest keeps `recorded.reportRejected`.

  Run `node --test test/workflows.test.mjs` and record which cases fail. (spec: waves — A recorded batch SHALL report its per-task outcomes to its caller)

- [x] 1.9 In `test/spine/implementer-prompt.test.mjs` add: `assembleImplementerPrompt` with `previousRejectedReports: [{ taskId: '1.2', reason: 'handoff is 3562 characters; the cap is 2000', paths: ['src/a.cs'] }]` contains `NO VALIDATED REPORT`, `[1.2]`, the reason and `src/a.cs`, after the `PREVIOUS WAVE` block when both are present; with `previousRejectedReports: []` and with the key absent, the output is strictly equal to the output without the key. Do not touch any file under `test/fixtures/prompts/`; every existing fixture case must still pass. Run `node --test test/spine/implementer-prompt.test.mjs` and record that the new case fails. (spec: waves — The next wave SHALL be told which previous-wave tasks filed no usable report)

- [x] 1.10 In `test/spine/receipt.test.mjs` and `test/spine/resume-card.test.mjs`:
  - receipt: a summary whose wave row has `reportRejected: ['5.3', '8.1']` yields receipt `waves[0].reportRejected` equal to it; the rendered summary contains a line matching `/handoff reports rejected: 5\.3, 8\.1/`; the `wave N (kind): X ok, Y failed` line is byte-identical to the same summary rendered without the field; a summary with no rejected report has no such line; `verifyBudget: { ms, source }` on the summary is carried to the receipt.
  - resume card: a halted run with a rejected report names the task ids under a line containing `handoff reports rejected`; a run with none states nothing about them.

  Run both files and record which cases fail. (spec: ship-run — A run's reported tallies SHALL be its recorded outcomes; verify — A run SHALL fix its inter-wave verify budget at start and SHALL report it)

- [x] 1.11 In `test/spine/outcomes.test.mjs` and `test/spine/run-log.test.mjs`:
  - outcomes: a wave row with `reportRejected: ['5.3']` is carried into the outcome row; a row without the key carries no `reportRejected` key, never `[]` and never `0`. (As first written this said `null`; the pins at `outcomes.test.mjs:334` and `run-log.test.mjs:628`, `:674` require the key to be absent, and the code follows them.)
  - run-log: a receipt wave with `reportRejected: ['5.3']` normalizes to a count of 1 and `run-log show` prints `1 report(s) rejected` on that wave's line; a receipt wave without the key carries no such key and its shown line is byte-identical to today's; `verifyBudget` is carried.

  Run both files and record which cases fail. (spec: ship-run — A run's reported tallies SHALL be its recorded outcomes)

- [x] 1.12 In `test/spine/limits.test.mjs`: `formatLimits()` contains the row label `inter-wave verify budget (floor)` followed by `LIMITS.interWaveVerifyBudgetMs / 1000` and `s`; the `--json` form still carries the key it carried before for that row; `lib/verify.mjs` contains both `LIMITS.interWaveVerifyBudgetMs` and `LIMITS.interWaveVerifications` inside `interWaveVerifyBudget`, and no numeric literal for either. Run the file and record that it fails on the label. (spec: verify — The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant)

- [x] 1.13 In `test/skills.test.mjs` add token pins, each asserting tokens and not sentences:
  - `skills/graph/SKILL.md` contains `.cs`, `.csproj`, `.bicep`, `INFERRED` and `GRAPH SKIPPED UNREADABLE`;
  - `skills/fix-tests/SKILL.md` contains `timeout_ms`;
  - `shared/TEST-PROFILE.md` contains `timeout_ms` and `inter-wave` within the same table row or paragraph.

  Run `node --test test/skills.test.mjs` and record that the three pins fail.

## 2. Core modules (make §1 green)

The tasks in this section touch disjoint files and do not need each other.

- [x] 2.1 `lib/graph/paths.mjs` and `lib/graph/extract/walk.mjs` (design Decisions 1, 2, 8).
  - `paths.mjs`: add `readIndexed(absPath)` returning `{ ok: true, text, sha256 }` from one read, or `{ ok: false, code }` with `code = error.code || 'UNKNOWN'`; add `createSkips(root)` returning `{ add(absPath, errorOrCode, note), list() }`, where `list()` is `[{ path, code, note? }]` with root-relative forward-slash paths, sorted by path, one entry per path; add `SKIP_MARKER = 'GRAPH SKIPPED UNREADABLE'` and `formatSkip(entry)` producing `GRAPH SKIPPED UNREADABLE: <path> (<code>)` plus ` — <note>` when there is one. Keep `sha256File` for now; task 3.1 removes it once it has no caller.
  - `walk.mjs`: `walkSourceFiles(root, { extraSkip, skips })` and `walkMarkdown(root, subdirs, { skips })` take an optional collector. With one, a failed `readdirSync`, the `.json` `statSync`, and an unreadable `.gitignore` / `.interlockignore` each call `skips.add(...)`, the ignore files with the note `its patterns were not applied`. Without one, behaviour is exactly today's. Add `.cs`, `.csproj`, `.bicep` to `SOURCE_EXTS`. In `visit`, skip a directory named `bin` or `obj` when the entries of the directory being visited include a file ending `.csproj`.

  (spec: graph/unreadable-paths — An indexing command SHALL skip a path it cannot read and finish; graph/csharp-and-bicep — A project's build output SHALL NOT be indexed)

- [x] 2.2 New extractors `lib/graph/extract/csproj.mjs`, `lib/graph/extract/csharp.mjs`, `lib/graph/extract/bicep.mjs` (design Decisions 5, 6, 7). Regex only; each exports one function with the signature `(filePath, source)` and returns `{ filePath, imports, exports, references }` in the shape `extract/python.mjs` returns.
  - `extractCsproj`: one `imports` entry per `<ProjectReference Include="…">`, double- or single-quoted, with `from` the attribute value as written and `confidence: 'EXTRACTED'`.
  - `extractBicep`: an `imports` entry per `module <name> '<target>' =` (the `if (…)` and `[for … :` forms included) with `from` as written; `exports` for `param`, `var`, `resource`, `output` with the keyword as `kind` and the keyword's line; for each `<name>.outputs.<x>` where `<name>` is a module declared in the file, an `imports` entry `{ from: <that module's target>, imported: '<x>', confidence: 'INFERRED' }`.
  - `extractCsharp`: `imports: []`; `exports` for `class`, `record` (optionally `record class` / `record struct`), `struct`, `interface`, `enum` declarations after any run of modifiers, named without type parameters, skipping lines whose first non-space characters are `//` or `*`; plus a `csharp` field: `namespaces: [{ name, line }]` for the file-scoped and block-scoped forms; `usings: [{ name, line }]` for `using X;`, `global using X;`, `using static X.Y;` (name `X.Y`) and `using A = X.Y;` (name `X.Y`), and nothing for a `using` followed by `var`, `(` or a declaration; `types: [{ name, line, namespace }]` with `namespace` the nearest namespace declared above the type, or `''`; `identifiers`, an object from each identifier to the ascending list of lines it appears on; `tests: [{ type, name, line, start, end }]` for a method under `Fact`, `Theory`, `Test`, `TestCase`, `TestMethod` or `DataTestMethod` (with or without arguments), where `type` is the nearest type declared above, `line` is the signature line, `start` is the attribute line and `end` is the line before the next test attribute or the last line of the file.

  (spec: graph/csharp-and-bicep — A C# project reference SHALL be a project-to-project edge; C# type declarations SHALL be symbol nodes carrying their line; A using directive SHALL resolve against the namespaces the repository declares; A C# test method SHALL be a test node that consumers can name; Bicep modules, declarations and output references SHALL be indexed)

- [x] 2.3 New pure module `lib/graph/graph/link-csharp.mjs` (design Decisions 6, 7). No `node:` import. `linkCsharp(records)` takes the `extractCsharp` results and returns `{ nodes, edges }`:
  - one node `{ id: 'namespace:<Name>', type: 'namespace', label: '<Name>' }` per declared namespace, with `source_file` and `source_location` from its first declaring file in path order;
  - a `declares` edge, `EXTRACTED`, from `file:<path>` to the namespace node for each declaration, at that declaration's line;
  - for each `using`, an `imports` edge, `EXTRACTED`, to the longest declared namespace equal to or prefixing the name at a `.` boundary, else to `external:<name>`;
  - one node `{ id: 'test:<path>#<Type>.<Method>', type: 'test', label: '<Type>.<Method>' }` per test and an `exports` edge to it from its file;
  - `references` edges, `INFERRED`, weight 0.5, deduplicated: from a file to `symbol:<declFile>#<Type>` for each identifier it holds that names a type declared in a namespace the file can see (declared, each dot-prefix of those, imported), excluding types the file itself declares; and from a test node to the same symbols for identifiers with a line inside the test's `[start, end]`.

  (spec: graph/csharp-and-bicep — A using directive SHALL resolve against the namespaces the repository declares; A type a file names from a namespace it can see SHALL be an inferred reference; A C# test method SHALL be a test node that consumers can name)

- [x] 2.4 `lib/waves.mjs` (design Decisions 10, 11, 12).
  - `normalizeTaskResults`: for `t.ok === true` with an invalid packet, return `{ id, ok: true, error, filesChanged, handoff: null, reportRejected: checked.error }` in place of the `ok:false` rewrite. The `!t.ok` branch is unchanged.
  - `recordBatchResult`: initialize `next.rejectedReports` to `[]` when absent, beside the three existing guards; push `{ id, wave: wave.group, waveKind: wave.kind, reason }` for each such task. Do not edit the halt check.
  - `batchOutcomes`: derive this batch's rejections from the tail of `rejectedReports` and return `{ id, outcome: OUTCOME_OK, reportRejected: shortReason(reason) }` for them.
  - Add `previousWaveRejectedReports(state, waveIndex)` beside `previousWaveHandoffs`, returning `[{ taskId, reason, paths }]` for the immediately previous wave from `rejectedReports` and `reportedPaths`; `nextStep` sets `previousRejectedReports` on the step only when the list is non-empty.
  - `summarize` gains `reportsRejected`; `formatRunState` appends `, <n> report(s) rejected` to the run line only when `n > 0`.
  - Update the block comment above `HANDOFF_SCHEMA` (`:1585-1592`) and the one above `OUTCOME_OK` (`:2396-2401`), which say a bad packet fails its task.

  (spec: waves — A rejected packet SHALL fail closed without failing a task that reported success; A rejected report SHALL NOT count toward the task-failure halt; The next wave SHALL be told which previous-wave tasks filed no usable report; A recorded batch SHALL report its per-task outcomes to its caller)

- [x] 2.5 `lib/verify.mjs` and `lib/limits.mjs` (design Decision 14). Add `export function interWaveVerifyBudget(profile)` to `verify.mjs` as the design states it, reading both factors from `LIMITS`, with no numeric literal for either. Do not change `planVerification`. In `limits.mjs`, relabel the row at `:562` to `inter-wave verify budget (floor)`, leaving its value and its `--json` key as they are, and extend the comment above `interWaveVerifyBudgetMs` to say what raises it. (spec: verify — The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant)

- [x] 2.6 `lib/prompts/implementer.mjs` (design Decision 12). `assembleImplementerPrompt` accepts `previousRejectedReports`. When it is a non-empty array, render, after the `PREVIOUS WAVE` block, a block headed `NO VALIDATED REPORT (the packet was rejected; read the paths, assume nothing):` with one line per entry, `- [<taskId>] rejected: <reason> — reported touching: <paths joined by ', '>`, or `— reported no paths` when the list is empty. When it is empty or absent, render nothing, so the existing fixtures stay byte-identical. (spec: waves — The next wave SHALL be told which previous-wave tasks filed no usable report)

- [x] 2.7 `lib/receipt.mjs` and `lib/resume-card.mjs` (design Decisions 12, 15).
  - `receipt.mjs`: add `reportRejected: wave.reportRejected` to the receipt's wave rows (`:178-183`); carry `summary.verifyBudget` onto the receipt; in the rendered summary, after the wave rows and without editing them, add `  handoff reports rejected: <ids joined by ', '>` when any wave row holds one.
  - `resume-card.mjs`: when the run recorded rejected reports, add a line containing `handoff reports rejected` and the ids, saying they were recorded as done.

  (spec: ship-run — A run's reported tallies SHALL be its recorded outcomes; verify — A run SHALL fix its inter-wave verify budget at start and SHALL report it)

- [x] 2.8 `lib/outcomes.mjs` and `lib/run-log.mjs` (design Decision 12). Both rebuild a wave row from a whitelist.
  - `outcomes.mjs:179`: carry `reportRejected` through `nullableStringArray`, only when the row holds the key. Do not coerce it to `[]`.
  - `run-log.mjs:220`: normalize `reportRejected` to a count through `nullableCount`, only when the receipt wave holds the key; carry `verifyBudget`. At `:1007`, append `, <n> report(s) rejected` only when the count is a number greater than zero, so a receipt without the field shows the line it shows today.

  (spec: ship-run — A run's reported tallies SHALL be its recorded outcomes)

## 3. Wiring (needs §2)

- [x] 3.1 `lib/graph/graph/build.mjs`, `lib/graph/graph/update.mjs`, `lib/graph/extract/create-extractor.mjs` (design Decisions 1, 4, 5, 6).
  - `create-extractor.mjs`: dispatch `.csproj`, `.cs`, `.bicep` to the three extractors, adding `csproj`, `csharp`, `bicep` to the modes.
  - `build.mjs`: `buildGraph(root, { fileFilter, skips })`. Pass `skips` to `walkSourceFiles`. In the loop, call `readIndexed`; on `ok:false` call `skips.add` and `continue`, leaving the path out of `hashes` and out of `fileIndex`. Extend `langOf` with `csharp`, `csproj`, `bicep`; add `resolveCsprojImport` (replace `\` with `/`, resolve against the referencing project's directory, `unresolved:` when the value contains `$(` or names no file) and `resolveBicepImport` (relative to the file; `external:` for a `br:` or `ts:` target). Collect every `extracted.csharp` record, call `linkCsharp` after the loop, and add its nodes and edges before the dangling-edge filter. Pass `{ skips }` as a trailing argument to `extractOpenspec` and `extractMemory`. Return `skipped: skips.list()`; `writeGraphArtifacts` writes it to the manifest as `skipped: [{ path, code }]`. `stats` is unchanged.
  - `update.mjs`: `updateGraph(root, { skips })`. Hash through `readIndexed`; treat a manifest without `skipped` as `[]`; rebuild when a hash differs, a file was removed, or the set of currently unreadable paths differs from the recorded set; otherwise return `updated: false` with the current skips so the caller can print them.
  - Delete `sha256File` from `paths.mjs` once `grep -rn sha256File lib` returns nothing.

  (spec: graph/unreadable-paths — all four requirements; graph/csharp-and-bicep — A C# project reference SHALL be a project-to-project edge; A using directive SHALL resolve against the namespaces the repository declares)

- [x] 3.2 `lib/graph/extract/openspec.mjs`, `lib/graph/extract/memory.mjs`, `lib/graph/retrieve/markdown.mjs`, `lib/graph/retrieve/docs-index.mjs`, `lib/graph/retrieve/context.mjs` (design Decision 1). `context.mjs` reads no file itself; `retrieveContext` only passes the option through to `retrieveMarkdownSections`. Each takes a trailing `{ skips }` option, passes it to `walkMarkdown`, reads through `readIndexed`, and calls `skips.add` where it reads a file it cannot read: in place of the unguarded reads at `openspec.mjs:26` and `memory.mjs:30`, and in place of the silent `continue` at `markdown.mjs:169` and `docs-index.mjs:54`. `docs-index.mjs` takes its `sha256` from the same read. With no collector passed, each behaves as it does today except that the two unguarded readers no longer throw. (spec: graph/unreadable-paths — An indexing command SHALL skip a path it cannot read and finish; Every skipped path SHALL be named with its error code)

- [x] 3.3 `lib/graph/cli.mjs`, `lib/graph/graph/report.mjs`, `lib/graph/graph/query.mjs` (design Decisions 3, 4, 7, 9).
  - `cli.mjs`: create one `createSkips(root)` per command for `build`, `update`, `docs`, `docs-index` and `context`; pass it down; after the command's stdout, write `formatSkip(entry)` plus a newline to stderr for each entry. Append ` skipped=<n>` to the `build` and `update` summary lines when `n > 0`. `update` prints the skips when it did not rebuild too. In the empty-graph branch, list `.cs .csproj .bicep` among the indexed extensions, and when `files === 0` and skips exist print one line saying nothing under the root could be read in place of the language notice. Exit codes do not change.
  - `report.mjs`: `writeReport` takes the skipped list and adds a `## Not indexed (unreadable)` section, one `- <path> (<code>)` per entry, only when the list is non-empty.
  - `query.mjs`: in `consumers`, beside the `consumer_file` line, print `    consumer_test: <source_file>:<source_location> <label>` when the edge's source node has type `test`.

  (spec: graph/unreadable-paths — Every skipped path SHALL be named with its error code; Skips SHALL be recorded beside the graph; graph/csharp-and-bicep — A C# test method SHALL be a test node that consumers can name; Stated language coverage SHALL match what is indexed)

- [x] 3.4 `lib/run.mjs` (design Decisions 12, 15, 16, 17). One file, both concerns.
  - Rejected reports: `recordedOutcomes` carries `reportRejected` when it is a non-empty string; `adjudicateBatches` returns `rejected: [{ id, reason }]` and puts `reportRejected: [ids]` on each `waves` entry, leaving `overrides` as it is; `runRecordBatch` pushes one `HANDOFF REJECTED: …` banner per batch that holds any, in the wording of design Decision 12, adds `reportRejected` to the `manifest.waves` row and to `recordedStep.recorded`; add `previousRejectedReports` to `PASS_THROUGH` and pass it from `decorate` to `assembleImplementerPrompt`; carry the wave rows' `reportRejected` into the summary `runClose` builds.
  - Verify budget: in `settleStateHome`, after `testProfilePath` is set, read the profile and store `manifest.verifyBudget = { ms, source, timeoutMs }` from `interWaveVerifyBudget`; in `verifyStep`, for the inter-wave context, set `opts.budgetMs` from `manifest.verifyBudget.ms` when it is a positive integer and leave it unset otherwise; when the plan is budget-exceeded, `manifest.verifyBudget.timeoutMs` is `null` and `manifest.verifyBudgetFloorSpoken` is not set, push the `VERIFY BUDGET AT THE PUBLISHED FLOOR` banner of design Decision 17 and set the flag; carry `verifyBudget` into the close summary.

  (spec: waves — A recorded batch SHALL report its per-task outcomes to its caller; The next wave SHALL be told which previous-wave tasks filed no usable report; ship-run — A run's reported tallies SHALL be its recorded outcomes; verify — A run SHALL fix its inter-wave verify budget at start and SHALL report it)

- [x] 3.5 `bin/interlock` (design Decision 15). In the `verify plan` handler (`:2574-2577`): when `--context` is `inter-wave`, a profile was read and `--budget-ms` was not given, set `opts.budgetMs` from `interWaveVerifyBudget(profile).ms`; print `budgetSource` beside `budgetMs` in the JSON (`profile`, `published`, or `flag` when `--budget-ms` was given). Update the `--budget-ms` help line at `:655` to say the inter-wave default is derived from the profile and floored at the published budget, without stating either number. Add a line under the `wave-state record-batch` help near `:769` saying a rejected packet is reported as `reportRejected` on a succeeded outcome. (spec: verify — The inter-wave verify budget SHALL be derived from the test profile and floored at the published constant)

## 4. Shipped prose, docs and release notes (needs §1–§3 green)

- [x] 4.1 `skills/graph/SKILL.md`, `skills/fix-tests/SKILL.md`, `shared/TEST-PROFILE.md`.
  - Graph skill: add C# (`.cs`, `.csproj`) and Bicep (`.bicep`) to "What gets indexed"; say that C# type references and test links are `INFERRED`, and list the four known limits from design Decision 6; say a build names what it could not read with `GRAPH SKIPPED UNREADABLE` and still finishes. Remove nothing from the sentence about languages outside the set except the ones now covered.
  - fix-tests skill: after a green full unit run, record `unit.timeout_ms` as that run's wall time rounded up, and never write a value below a wall time measured. State no multiplier and no number.
  - `TEST-PROFILE.md`: in the `timeout_ms` row, add that the inter-wave verify budget is derived from `unit.timeout_ms` and that `interlock verify plan --context inter-wave --json` prints the result.

  (the pins of task 1.13 go green here)

- [x] 4.2 `docs/04-when-it-stops.md`, `docs/06-why-it-works.md`, `docs/07-cli-and-configuration.md`, `docs/10-agentic-workflow-ship-and-spec.md`.
  - `docs/04`: add sections for `HANDOFF REJECTED`, `VERIFY BUDGET AT THE PUBLISHED FLOOR` and `GRAPH SKIPPED UNREADABLE`, each saying what raised it and what to do; correct the language-coverage paragraph at `:254-256`; at `:195`, where leftover boxes are described, add that a rejected handoff packet no longer leaves a box unticked.
  - `docs/06`: correct the language sentence at `:323`; at `:198`, add that the budget is derived from the profile and floored.
  - `docs/07`: correct the language paragraph at `:216`; note `budgetSource` under `verify plan`.
  - `docs/10`: correct the graph bullet at `:297` and the inter-wave bullet at `:165`.
  - State no numeric threshold anywhere; name the `interlock limits` row instead.
  - Do not hand-edit `docs/assets/DESIGN-PROMPT.md` or anything under `site/`. Both hold a pasted `interlock limits` table with the old row label; they are regenerated, not relabelled, and that is not part of this change.

- [x] 4.3 `CHANGELOG.md`, under `## [Unreleased]`: one entry per issue, in the file's existing voice, naming issues #7, #8, #9 and #10. Mark the #9 entry **Breaking** for the recorded outcome and say what a reader should now look for (`HANDOFF REJECTED`, the `handoff reports rejected` row, `reportRejected` on the receipt). Say what this change did not do: checkpoint scoping, the re-ask, checkpoint placement.

- [x] 4.4 Run `npm test` and `npm run validate` and paste both outputs. Run the three reproductions from `proposal.md` again and record the new result of each: `interlock-graph build` over a tree holding an unreadable `.mcp.json` exits 0 and names it; three green tasks with the issue's three packet defects do not halt; a second checkpoint after 160 seconds of checks, against a profile with `unit.timeout_ms: 120000`, still plans `unit`.
