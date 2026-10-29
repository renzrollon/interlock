# Spec Delta

## ADDED Requirements

### Requirement: The graph SHALL report which changed files it does not hold or holds at another content

`interlock-graph covers --changed <files|->` SHALL print, for the given paths, which source files the graph's manifest does not list (`absent`) and which it lists with a content hash other than the file's current one (`changed`), with the graph's build time, and SHALL exit 1 when either list is non-empty. With no graph it SHALL say so and exit 3. With `--update` it SHALL, on exit 1 alone, run `interlock-graph update` one time and check again, so the retry is the CLI's and no skill counts it.

#### Scenario: Happy path — a graph that holds every changed file

- **GIVEN** a graph built after the last edit to each given path
- **WHEN** `interlock-graph covers --changed lib/a.mjs lib/b.mjs` runs
- **THEN** both lists are empty and it exits 0

#### Scenario: Failure — the PR #28 graph lacks the settle meter

- **GIVEN** a graph built on 2026-10-10 and the changed path `lib/settle-meter.mjs`, created after it
- **WHEN** the command runs
- **THEN** `lib/settle-meter.mjs` is listed under `absent`, the build time is printed, and it exits 1

### Requirement: A review SHALL update a graph that does not cover the diff, and record blast radius as partial when it cannot

Before the dimension fan-out, `review-code` SHALL run `interlock-graph covers --update` over the changed files. On exit 3 (no graph) it SHALL print `BLAST RADIUS SKIPPED` as today and build nothing. When it still exits 1, the skill SHALL print `GRAPH STALE: <files>`, run blast radius on the graph it has, and record `blast-radius` under the dimension record's `degraded` with the files as its reason, which the merge verdict flags `blast-radius-partial`.

#### Scenario: Happy path — an update closes the gap

- **GIVEN** a stale graph that `interlock-graph update` brings up to date
- **WHEN** the review starts
- **THEN** the coverage check exits 0 after the update, and blast radius runs on the updated graph with nothing recorded under `degraded`

#### Scenario: Failure — the update fails

- **GIVEN** a graph that `interlock-graph update` cannot update, and separately no graph at all
- **WHEN** the review starts
- **THEN** it prints `GRAPH STALE:` naming the uncovered files, the dimension record carries `blast-radius` under `degraded` with those files, and the verdict carries the `blast-radius-partial` flag
- **AND** with no graph, `covers` exits 3, no update runs, and the skill prints `BLAST RADIUS SKIPPED`
