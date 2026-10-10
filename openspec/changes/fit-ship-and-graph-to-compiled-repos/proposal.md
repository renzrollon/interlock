## Why

Four open issues, all filed from one field run on a .NET + Azure repository inside the Claude Code sandbox, still reproduce on 1.4.2. Together they mean that on a compiled-language repo the graph cannot be built, carries no code when it is, and a healthy ship run is halted by its own bookkeeping after going blind at the first checkpoint.

- **[#7](https://github.com/renzrollon/interlock/issues/7)** `interlock-graph build` exits 1 on the first file it cannot read. The sandbox masks `.mcp.json` and the settings files, so the graph can never be built from inside a sandboxed session, which is where a ship run wants it. Reproduced on 1.4.2: `interlock-graph: EACCES: permission denied, open '…/.mcp.json'`, exit 1.
- **[#8](https://github.com/renzrollon/interlock/issues/8)** The graph indexes JS/TS, Python, shell and config JSON. On a C# + Bicep repository `consumers`, `path` and `explain` return nothing for the code, and every implementer falls back to grep for the whole run.
- **[#9](https://github.com/renzrollon/interlock/issues/9)** A task that reported success with a malformed handoff packet is recorded as a failed task and counted toward `task failures tolerated`. Run `wf_ac5c7e4e-c74` halted two waves short of its commit on four such packets, with 14 finished tasks left unticked. Reproduced on 1.4.2 against `recordBatchResult`: three green tasks carrying the issue's three packet defects halt the run with `3 task failures accumulated across waves`.
- **[#10](https://github.com/renzrollon/interlock/issues/10)** The inter-wave verify budget is a 60s constant. A solution whose build takes 25–55s and whose unit suite takes two minutes spends it on the first checkpoint, and every later checkpoint drops to typecheck only. 1.3 stopped charging relay and agent time against the budget; it did not change the constant. Reproduced on 1.4.2 against `planVerification`: after one 160s checkpoint the second plans `typecheck` alone.

## What Changes

**Graph: an unreadable path is skipped and named (#7).**
- `interlock-graph build`, `update`, `docs`, `docs-index` and `context` no longer abort on a file, directory or ignore file they cannot read. Each is skipped, named on stderr with its error code, and the command finishes with exit 0.
- The skips are recorded in the graph manifest and in `GRAPH_REPORT.md`, so `update` neither rebuilds forever over a file it still cannot read nor misses the moment it becomes readable.
- Two readers that already skipped unreadable markdown did so silently. They now say so.

**Graph: C# and Bicep are structurally indexed (#8).**
- `*.csproj`: `<ProjectReference>` becomes a project-to-project edge.
- `*.cs`: type declarations become symbol nodes; each declared namespace becomes one namespace node; `using` becomes an import edge to a namespace node when the repository declares that namespace, and an external otherwise; test methods (`[Fact]`, `[Theory]`, and the NUnit and MSTest equivalents) become test nodes; type names a file uses from a namespace it can see become inferred reference edges, so `consumers <Type>` names the files and tests that touch it.
- `*.bicep`: `module` declarations become file-to-file edges; `param`, `var`, `resource` and `output` become symbol nodes; `<module>.outputs.<name>` becomes a reference to that output.
- A project's own `bin/` and `obj/` directories are not indexed.
- Line-oriented, regex only. No parser, no dependency.

**Ship: a rejected handoff packet is a rejected report, not a failed task (#9).**
- **BREAKING (recorded outcome):** a task that reported success with a missing, malformed or over-budget packet is recorded as done with a *rejected report*. It is ticked, it is not a task failure, and it does not count toward `task failures tolerated`. The packet itself still fails closed: it is never stored, never truncated and never handed on.
- The rejection is spoken everywhere a failure would have been: a `HANDOFF REJECTED` banner naming each task and reason, its own row in the close summary, its own field on the receipt, the outcome corpus and the resume card, and a notice in the next wave's briefing naming the tasks that filed no usable report and the paths they reported touching.
- A task that reported failure, a lane that omitted an outcome, and an agent that returned nothing are unchanged: each is still a task failure.

**Ship: the inter-wave verify budget fits the repository it runs in (#10).**
- The budget becomes `inter-wave verifications × unit.timeout_ms` from the test profile, floored at the published constant. A profile can raise the budget and can never lower it.
- It is derived once, at `run start`, recorded on the run and its receipt, and not re-read mid-run.
- A run that exceeds a budget still sitting at the published floor says why, and names `/interlock:fix-tests --reconfigure` as the fix.
- `/interlock:fix-tests` records `unit.timeout_ms` from a measured green run, so the value the budget reads is a measurement rather than the schema's example.
- The per-run checkpoint cap, its placement, and every other threshold are unchanged.

**Not in this change.** Scoping a checkpoint to the tests a wave touched (issue #10, ask 2) and re-asking an agent for a corrected packet (issue #9, ask 2). `design.md` gives the reason for each. Issue [#12](https://github.com/renzrollon/interlock/issues/12) is a third-party listing request, not a defect.

## Capabilities

### New Capabilities
- `graph/unreadable-paths`: what an indexing command does with a file, directory or ignore file it cannot read — skip, name, record, and keep `update` stable across the skip.
- `graph/csharp-and-bicep`: the nodes and edges structural indexing produces for C# project files, C# sources and Bicep files, and what each resolves to.

### Modified Capabilities
- `waves`: a rejected handoff packet no longer fails a task that reported success, and no longer counts toward the task-failure halt; the next wave is told which tasks filed no usable report; the per-task outcome report carries the rejection.
- `ship-run`: a run's reported tallies carry rejected reports as their own count, distinct from failures.
- `verify`: the inter-wave verify budget is derived from the test profile, floored at the published constant, fixed at run start and reported.

## Impact

- **Code.** `lib/graph/**` (walker, builder, updater, extractors, report, CLI), `lib/waves.mjs`, `lib/run.mjs`, `lib/verify.mjs`, `lib/limits.mjs`, `lib/receipt.mjs`, `lib/resume-card.mjs`, `lib/outcomes.mjs`, `lib/run-log.mjs`, `lib/prompts/implementer.mjs`, `bin/interlock`.
- **Shipped prose.** `skills/graph/SKILL.md` (language coverage), `skills/fix-tests/SKILL.md` (record `unit.timeout_ms`), `shared/TEST-PROFILE.md`. Each new instruction is pinned by token in `test/skills.test.mjs`.
- **Docs.** `docs/04-when-it-stops.md`, `docs/06-why-it-works.md`, `docs/07-cli-and-configuration.md`, `docs/10-agentic-workflow-ship-and-spec.md`, `CHANGELOG.md`.
- **Recorded data.** `graph.json` gains node types `namespace` and `test` and relation `declares`; `manifest.json` gains `skipped`. The run state gains `rejectedReports`; a recorded wave row, the receipt and the outcome row gain `reportRejected`; the run manifest and receipt gain the derived verify budget. Every addition is optional on read, so a state, manifest or trajectory written before this change reads as it did.
- **Behaviour a reader relied on.** A run that used to halt on rejected packets now continues to final verification and its commit. Final verification is unchanged and still gates the commit.
- **Existing tests.** Seven cases pin the retired outcome (a bad packet fails its task) and are rewritten to pin the new one: six in the red wave, and `test/workflows.test.mjs:2457`, which the sweep missed, by hand after the run. No other existing pin moves: `planVerification`'s default budget, the implementer-prompt fixtures and the hooks-module allow-list are untouched.
- **Dependencies.** None added.
