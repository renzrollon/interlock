# graph/unreadable-paths Specification

## Purpose
Keeps one unreadable path from costing a repository its whole graph. An indexing command skips what it cannot read, names it, records it beside the graph, and stays stable across the skip.

## Requirements

### Requirement: An indexing command SHALL skip a path it cannot read and finish

`interlock-graph build`, `update`, `docs`, `docs-index` and `context` SHALL treat a file, a directory or an ignore file under the root that they cannot read as skipped. The command SHALL index everything else it would have indexed and SHALL exit with the code it would have exited with had the path not been there. No unreadable path under the root SHALL abort an indexing command.

A skipped file SHALL contribute no node and no edge. A skipped directory SHALL be skipped as one path, with nothing beneath it indexed. A skipped ignore file SHALL contribute no patterns, and the walk SHALL proceed as if that file were absent.

This exists because a sandbox routinely masks a handful of configuration files as unreadable, and a build that stops at the first of them leaves a sandboxed session with no graph at all.

#### Scenario: Happy path — a masked config file does not stop the build

- **GIVEN** a root holding two readable source files and a `.mcp.json` whose permissions deny reading
- **WHEN** `interlock-graph build .` runs
- **THEN** the command exits 0 and writes the graph
- **AND** both source files are file nodes in it, and `.mcp.json` is not

#### Scenario: Failure — a tree with nothing readable is reported as unreadable, not as unsupported

- **GIVEN** a root whose every indexable file denies reading
- **WHEN** `interlock-graph build .` runs
- **THEN** the command exits 0 with no file indexed and names each skipped path
- **AND** it does not print the notice that attributes an empty graph to language coverage

#### Scenario: Edge case — an unreadable directory is one skip

- **GIVEN** a root holding `src/a.mjs` and a directory `vault/` that denies listing and holds source files
- **WHEN** `interlock-graph build .` runs
- **THEN** `src/a.mjs` is indexed, nothing under `vault/` is, and `vault` is skipped as a single path

#### Scenario: Edge case — an unreadable ignore file is skipped and its patterns are not applied

- **GIVEN** a root whose `.gitignore` denies reading and names `generated/`
- **WHEN** `interlock-graph build .` runs
- **THEN** the command exits 0, `.gitignore` is skipped, and files under `generated/` are indexed because no pattern excluded them

#### Scenario: Edge case — prose retrieval skips an unreadable document

- **GIVEN** a docs directory holding `guide.md` and an `internal.md` that denies reading
- **WHEN** `interlock-graph docs-index .` and `interlock-graph docs "guide"` run
- **THEN** each returns what `guide.md` yields and exits as it would without `internal.md`
- **AND** each skips `internal.md`

### Requirement: Every skipped path SHALL be named with its error code

Each skipped path SHALL be named on standard error on a line of its own that carries a fixed marker, the path relative to the root with forward slashes, and the error code the read failed with. A read that failed without an error code SHALL still be named, with a stated placeholder in place of the code. A skipped ignore file SHALL additionally be said to have contributed no patterns.

When at least one path was skipped, the command's summary line on standard output SHALL carry the count. When none was skipped, standard output and standard error SHALL be what they were before this requirement existed.

#### Scenario: Happy path — the skip is one line naming the path and the code

- **GIVEN** a root in which `.mcp.json` denies reading
- **WHEN** `interlock-graph build .` runs
- **THEN** standard error holds one line containing `GRAPH SKIPPED UNREADABLE`, `.mcp.json` and `EACCES`
- **AND** the summary line on standard output contains `skipped=1`

#### Scenario: Failure — an error with no code is still named

- **GIVEN** a file whose read fails with an error that carries no error code
- **WHEN** an indexing command skips it
- **THEN** standard error names the path beside the placeholder `UNKNOWN` rather than omitting the line

#### Scenario: Edge case — a fully readable tree prints nothing new

- **GIVEN** a root in which every path is readable
- **WHEN** `interlock-graph build .` runs
- **THEN** standard error is empty and the summary line carries no `skipped=` field

#### Scenario: Edge case — a path with a space and a non-ASCII character is named whole

- **GIVEN** an unreadable file at `docs/My Notes ü.md`
- **WHEN** `interlock-graph docs-index .` skips it
- **THEN** one line names `docs/My Notes ü.md` exactly, on a single line, with forward slashes

### Requirement: Skips SHALL be recorded beside the graph

A build SHALL record every path it skipped, with its error code, in the graph manifest, apart from the files it indexed. The agent-facing graph report SHALL name the same paths in a section of their own. A manifest that carries no such record SHALL be read as one with no skips.

When nothing was skipped, the manifest's record SHALL be empty and the report SHALL carry no such section.

#### Scenario: Happy path — the manifest and the report name the skip

- **GIVEN** a build that skipped `.mcp.json` with `EACCES`
- **WHEN** the manifest and `GRAPH_REPORT.md` are read
- **THEN** the manifest lists `.mcp.json` with `EACCES` among its skipped paths and not among its indexed files
- **AND** the report names `.mcp.json` as not indexed because it was unreadable

#### Scenario: Failure — a manifest from an earlier version is not malformed

- **GIVEN** a manifest written before skips were recorded, holding only indexed files
- **WHEN** `interlock-graph update .` reads it
- **THEN** it is read as a manifest with no skips and the command proceeds

#### Scenario: Edge case — no skips leaves the report as it was

- **GIVEN** a root in which every path is readable
- **WHEN** `interlock-graph build .` runs
- **THEN** the manifest's skipped record is empty
- **AND** `GRAPH_REPORT.md` holds no section about unreadable paths

### Requirement: An update SHALL stay stable across a skip and SHALL notice a change in readability

`interlock-graph update` SHALL compare the paths it can read now against the indexed files, and the paths it cannot read now against the recorded skips. A path that was skipped and is still unreadable SHALL NOT by itself cause a rebuild. A path that was indexed and can no longer be read, and a path that was skipped and can now be read, SHALL each cause a rebuild. Whenever at least one path is skipped, the update SHALL name it, whether or not it rebuilt.

#### Scenario: Happy path — a still-unreadable file does not force a rebuild

- **GIVEN** a build that skipped `.mcp.json`, and nothing changed since
- **WHEN** `interlock-graph update .` runs
- **THEN** it reports the graph as up to date and does not rebuild
- **AND** it names `.mcp.json` as still skipped

#### Scenario: Failure — an indexed file that becomes unreadable drops out

- **GIVEN** a build that indexed `src/a.mjs`, after which `src/a.mjs` denies reading
- **WHEN** `interlock-graph update .` runs
- **THEN** it rebuilds and exits 0, the graph holds no node for `src/a.mjs`, and `src/a.mjs` is named as skipped

#### Scenario: Edge case — a skipped file that becomes readable is indexed

- **GIVEN** a build that skipped `src/b.mjs`, after which `src/b.mjs` allows reading
- **WHEN** `interlock-graph update .` runs
- **THEN** it rebuilds, `src/b.mjs` is a file node, and no line names it as skipped

### Requirement: A query SHALL say when its graph was built past skipped paths

`interlock-graph query`, `consumers`, `path`, `explain` and `context` SHALL print one line on standard error, carrying a fixed marker and the number of skipped paths, whenever the graph they answer from was built past paths it could not read. The count SHALL come from the skips recorded beside the graph that is actually read, so a query served from another checkout's graph reports that graph's skips. The line SHALL say that no result for a skipped path is evidence about it, and SHALL say where the paths are listed.

The line SHALL NOT change the command's standard output or its exit code. A query against a graph built with no skips, against one whose record carries no skips because it predates the record, and against one whose record cannot be read SHALL print nothing new and SHALL answer as it did before this requirement existed.

A build names each path it skips, once, to whoever ran the build. A query runs later, often in another session and by an agent that never saw the build, and answers from the graph alone. Because an indexing command no longer fails on an unreadable path, the exit code of the build does not tell that reader the graph is partial; without this line, "no consumers" for a file the build never read is indistinguishable from "no consumers".

#### Scenario: Happy path — every query command names the partial graph

- **GIVEN** a graph whose record beside it lists two skipped paths
- **WHEN** `query`, `consumers`, `path`, `explain` and `context` each run against it
- **THEN** each prints exactly one line on standard error containing `GRAPH PARTIAL` and the count 2
- **AND** none prints that line on standard output

#### Scenario: Failure — a record that cannot be read does not break a query

- **GIVEN** a graph beside a record that is not valid JSON
- **WHEN** `interlock-graph consumers <symbol>` runs
- **THEN** the command answers and exits as it would have before this requirement existed
- **AND** it prints no `GRAPH PARTIAL` line

#### Scenario: Edge case — a whole graph, and one from an earlier version, print nothing new

- **GIVEN** one graph built with no skips and one whose record was written before skips were recorded
- **WHEN** each query command runs against each
- **THEN** standard error holds no `GRAPH PARTIAL` line
- **AND** standard output and the exit code are identical to those of the same command against a graph whose record lists a skip
