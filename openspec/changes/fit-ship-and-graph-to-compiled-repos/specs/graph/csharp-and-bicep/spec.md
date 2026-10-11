## Purpose

Gives a .NET and Azure repository the structural graph a JS or Python repository already gets: project boundaries, declared types, namespace imports, tests and Bicep module wiring. Extraction is line-oriented, with no parser and no dependency, and every edge it infers rather than reads is marked as inferred.

## ADDED Requirements

### Requirement: A C# project reference SHALL be a project-to-project edge

A `ProjectReference` in a `*.csproj` file SHALL become an `imports` edge from that project file to the project file it names, marked `EXTRACTED`. The referenced path SHALL be resolved relative to the referencing project's directory, with backslash and forward-slash separators treated as the same separator. A reference that names no file in the repository, or whose path holds an MSBuild property, SHALL be recorded as an unresolved target; no edge to a file SHALL be invented for it.

#### Scenario: Happy path — a referenced project names its referencing project as a consumer

- **GIVEN** `src/App/App.csproj` containing `<ProjectReference Include="..\Core\Core.csproj" />`, and `src/Core/Core.csproj` present
- **WHEN** the graph is built and `interlock-graph consumers src/Core/Core.csproj` runs
- **THEN** the output names `src/App/App.csproj` through an `imports` edge marked `EXTRACTED`

#### Scenario: Failure — a reference that cannot be resolved invents no edge

- **GIVEN** a project file containing `<ProjectReference Include="$(RepoRoot)src\Gone\Gone.csproj" />`
- **WHEN** the graph is built
- **THEN** the build completes, the reference is recorded as an unresolved target, and no project file in the repository gains a consumer from it

#### Scenario: Edge case — two separator spellings resolve to one node

- **GIVEN** `src/App/App.csproj` referencing `..\Core\Core.csproj` and `src/Api/Api.csproj` referencing `../Core/Core.csproj`
- **WHEN** the graph is built and `interlock-graph consumers src/Core/Core.csproj` runs
- **THEN** both project files are named as consumers of the one `src/Core/Core.csproj` node

### Requirement: C# type declarations SHALL be symbol nodes carrying their line

A `class`, `record`, `struct`, `interface` or `enum` declaration in a `*.cs` file SHALL become a symbol node naming the declaring file and the declaration's line, marked `EXTRACTED`. A generic type SHALL be named without its type parameters. A declaration that sits on a comment line SHALL NOT become a symbol.

#### Scenario: Happy path — a declared type is found with its file and line

- **GIVEN** `src/Core/DeviceMetricSource.cs` whose line 1 is `namespace Acme.Core;` and whose line 5 is `public sealed class DeviceMetricSource`
- **WHEN** the graph is built and `interlock-graph explain DeviceMetricSource` runs
- **THEN** the output names `src/Core/DeviceMetricSource.cs` at line 5

#### Scenario: Failure — a commented-out declaration is not a symbol

- **GIVEN** a file whose only mentions of `Ghost` are the lines `// public class Ghost` and ` * class Ghost` inside a block comment
- **WHEN** the graph is built
- **THEN** the graph holds no symbol named `Ghost`

#### Scenario: Edge case — the declaration forms the language allows are all read

- **GIVEN** a file declaring a block-scoped namespace whose opening brace is on the following line, and within it `public readonly record struct Reading(double Value)`, `internal enum Unit`, `public interface IMetricSource` and `public class Cache<T>`, and a second file declaring `public partial class Cache<T>`
- **WHEN** the graph is built
- **THEN** the graph holds symbols `Reading`, `Unit`, `IMetricSource` and `Cache`, each at its own line
- **AND** `Cache` is a symbol in each of the two files that declare it

### Requirement: A using directive SHALL resolve against the namespaces the repository declares

Each namespace the repository's C# files declare, in the file-scoped or the block-scoped form, SHALL be one namespace node, linked from every file that declares it by a `declares` edge carrying the line of that file's declaration. A file-level `using` directive SHALL become an `imports` edge from its file to the namespace node when the repository declares that namespace, and to an external node otherwise. The `global using`, `using static` and alias forms SHALL resolve to the longest repository-declared namespace that the directive's name begins with. A `using` statement or declaration inside a member body SHALL NOT become an import.

A namespace is one node however many files declare it, so that a namespace declared in many files and imported by many files costs one edge per file rather than one edge per pair, and so that a query for the namespace finds one node rather than one per declaring file.

#### Scenario: Happy path — an imported namespace names its importers

- **GIVEN** `src/Core/DeviceMetricSource.cs` declaring `namespace Acme.Core;` and `src/App/Dashboard.cs` containing `using Acme.Core;`
- **WHEN** the graph is built and `interlock-graph consumers Acme.Core` runs
- **THEN** the output names `src/App/Dashboard.cs` through an `imports` edge to the `Acme.Core` namespace node
- **AND** `src/Core/DeviceMetricSource.cs` is linked to that node by a `declares` edge at the line of its `namespace` declaration
- **AND** the graph holds exactly one node for `Acme.Core`, however many files declare it

#### Scenario: Failure — a namespace the repository does not declare is external

- **GIVEN** a file containing `using System.Text;` in a repository that declares no `System.Text` namespace
- **WHEN** the graph is built
- **THEN** the directive resolves to an external node, not to an unresolved one, and no namespace node is created for it

#### Scenario: Edge case — the directive forms resolve to one namespace, and a using statement is not an import

- **GIVEN** a repository declaring `Acme.Core`, and a file containing `global using Acme.Core;`, `using static Acme.Core.Units;`, `using Metrics = Acme.Core.Metrics;`, and inside a method `using var stream = Open();`
- **WHEN** the graph is built
- **THEN** each of the three directives resolves to the `Acme.Core` namespace node
- **AND** the `using var` line produces no import

### Requirement: A type a file names from a namespace it can see SHALL be an inferred reference

When a C# file names, as a whole identifier, a type the repository declares in a namespace that file can see, the graph SHALL hold a `references` edge from the file to that type's symbol, marked `INFERRED`. A file can see the namespaces it declares, every enclosing namespace of those, and the namespaces its directives import. A file SHALL NOT be a consumer of a type it declares itself. No reference SHALL be inferred to a type in a namespace the file cannot see.

#### Scenario: Happy path — a file that uses a type is its consumer

- **GIVEN** `src/App/Dashboard.cs` containing `using Acme.Core;` and naming `DeviceMetricSource`, which `src/Core/DeviceMetricSource.cs` declares in `Acme.Core`
- **WHEN** the graph is built and `interlock-graph consumers DeviceMetricSource` runs
- **THEN** the output names `src/App/Dashboard.cs` through a `references` edge marked `INFERRED`

#### Scenario: Failure — a name from an invisible namespace is not a reference

- **GIVEN** a file that names `DeviceMetricSource` but neither declares nor imports `Acme.Core` or a namespace beneath it
- **WHEN** the graph is built
- **THEN** no `references` edge runs from that file to the `DeviceMetricSource` symbol

#### Scenario: Edge case — an enclosing namespace is visible, and a longer identifier is not a use

- **GIVEN** `src/Core/Sensors/Probe.cs` declaring `namespace Acme.Core.Sensors;` with no `using`, naming `DeviceMetricSource` and `DeviceMetricSourceFactory`, where only `DeviceMetricSource` is declared, in `Acme.Core`
- **WHEN** the graph is built
- **THEN** `src/Core/Sensors/Probe.cs` references the `DeviceMetricSource` symbol
- **AND** the occurrence of `DeviceMetricSourceFactory` is not counted as a use of `DeviceMetricSource`
- **AND** `src/Core/DeviceMetricSource.cs` is not listed as a consumer of the type it declares

### Requirement: A C# test method SHALL be a test node that consumers can name

A method carrying an xUnit `[Fact]` or `[Theory]`, an NUnit `[Test]` or `[TestCase]`, or an MSTest `[TestMethod]` or `[DataTestMethod]` attribute SHALL become a test node labelled with its enclosing type and its own name, naming its file and its line. A type named between a test's attribute and the next test's attribute, or the end of the file, SHALL become a `references` edge from that test node to the type's symbol, marked `INFERRED`, so that `interlock-graph consumers <Type>` names the tests that touch the type. A type named only outside every test's span SHALL be credited to the file and to no test. A method carrying no test attribute SHALL NOT become a test node.

#### Scenario: Happy path — consumers of a type names the test that touches it

- **GIVEN** `tests/Core.Tests/DeviceMetricSourceTests.cs` declaring `public class DeviceMetricSourceTests`, with `[Fact]` above `public void Reads_metric()` whose body names `DeviceMetricSource`
- **WHEN** the graph is built and `interlock-graph consumers DeviceMetricSource` runs
- **THEN** the output names the test `DeviceMetricSourceTests.Reads_metric` with its file and line

#### Scenario: Failure — an attribute that is not a test attribute makes no test node

- **GIVEN** a method carrying only `[Obsolete]`, and a method carrying no attribute
- **WHEN** the graph is built
- **THEN** neither method is a test node

#### Scenario: Edge case — attribute layouts are read, and shared setup is credited to the file

- **GIVEN** a test file in which one test is `[Theory]` followed by two `[InlineData(...)]` lines and then its signature, another is `[Fact(Skip = "flaky")] public async Task Skipped()` on one line, and the type under test is named only in a field declared above every test
- **WHEN** the graph is built
- **THEN** both methods are test nodes
- **AND** the file references the type under test, and neither test node does

### Requirement: Bicep modules, declarations and output references SHALL be indexed

A `module` declaration in a `*.bicep` file that names a local path SHALL become an `imports` edge from that file to the file it names, resolved relative to the declaring file and marked `EXTRACTED`; one that names a registry or template-spec reference SHALL resolve to an external node. `param`, `var`, `resource` and `output` declarations SHALL become symbol nodes carrying their line. An expression `<module>.outputs.<name>` SHALL become a `references` edge to the `<name>` output symbol of the file that module names, when that file declares it; when it does not, no edge SHALL be created.

#### Scenario: Happy path — a module, its declarations and an output reference are linked

- **GIVEN** `infra/main.bicep` containing `module storage './modules/storage.bicep' = {` and `output id string = storage.outputs.accountId`, and `infra/modules/storage.bicep` declaring `param location string`, `var prefix = 'st'`, a `resource account '…' = {` and `output accountId string = account.id`
- **WHEN** the graph is built and `interlock-graph consumers accountId` runs
- **THEN** `infra/main.bicep` imports `infra/modules/storage.bicep`
- **AND** `location`, `prefix`, `account` and `accountId` are symbols of `infra/modules/storage.bicep`, each at its line
- **AND** the output names `infra/main.bicep` as a consumer of `accountId`

#### Scenario: Failure — a registry module is external and a missing output makes no edge

- **GIVEN** a file containing `module shared 'br:acme.azurecr.io/bicep/shared:v1' = {`, and a reference `storage.outputs.missing` where the storage module's file declares no `missing` output
- **WHEN** the graph is built
- **THEN** the build completes, the registry module resolves to an external node, and no `references` edge is created for `missing`

#### Scenario: Edge case — conditional and looped modules, decorators and parent paths

- **GIVEN** a file containing `module a './a.bicep' = if (deploy) {`, `module b '../shared/b.bicep' = [for n in names: {`, and a `param sku string` directly below a `@description('…')` line
- **WHEN** the graph is built
- **THEN** the file imports `a.bicep` beside it and `b.bicep` under the sibling `shared` directory
- **AND** `sku` is a symbol at the line of its `param` keyword

### Requirement: A project's build output SHALL NOT be indexed

A directory named `bin` or `obj` SHALL be skipped when a `*.csproj` file sits in the same directory as it. A directory of either name with no project file beside it SHALL be walked as any other directory is.

This exists because a .NET build writes generated C# sources under `obj/`, and the ignore-file matcher does not read the character-class patterns a .NET `.gitignore` uses to exclude them.

#### Scenario: Happy path — generated sources under a project's obj directory are absent

- **GIVEN** `src/App/App.csproj` and `src/App/obj/Debug/net10.0/App.AssemblyInfo.cs`
- **WHEN** the graph is built
- **THEN** the graph holds no node for any path under `src/App/obj/`

#### Scenario: Failure — a bin directory with no project beside it is still indexed

- **GIVEN** a repository holding `bin/cli.js` and no `*.csproj` in its root
- **WHEN** the graph is built
- **THEN** `bin/cli.js` is a file node

#### Scenario: Edge case — only the directory beside the project file is skipped

- **GIVEN** `src/App/App.csproj` and `src/App/Models/obj/Thing.cs`, with no project file in `src/App/Models/`
- **WHEN** the graph is built
- **THEN** `src/App/Models/obj/Thing.cs` is a file node

### Requirement: Stated language coverage SHALL match what is indexed

The notice `interlock-graph build` prints when it indexed no source file SHALL list the C# source, C# project and Bicep extensions among the extensions structural indexing covers. A repository that holds only files of those kinds SHALL NOT receive that notice.

#### Scenario: Happy path — the notice lists the new extensions

- **GIVEN** a repository holding only Go source files
- **WHEN** `interlock-graph build .` runs
- **THEN** the notice names `.cs`, `.csproj` and `.bicep` among the indexed extensions

#### Scenario: Failure — an unsupported repository is still told so, and still exits 0

- **GIVEN** a repository holding only Go source files
- **WHEN** `interlock-graph build .` runs
- **THEN** the command exits 0 and the notice still states that the repository's language is not structurally indexed

#### Scenario: Edge case — a Bicep-only repository gets no notice

- **GIVEN** a repository holding only `infra/main.bicep`
- **WHEN** `interlock-graph build .` runs
- **THEN** one file is indexed and the notice is not printed
