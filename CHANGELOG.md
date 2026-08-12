# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-08-12

Initial release. SpecFlow is a Claude Code plugin that layers autonomous
spec-driven orchestration on top of the OpenSpec CLI.

### Added

**Distribution**
- Claude Code plugin with a single-plugin marketplace — installs in two commands.
- `bin/` executables (`specflow`, `specflow-graph`) join the Bash tool's `PATH`
  automatically when the plugin is enabled.

**The deterministic spine (`specflow`)**
- `waves` — plans execution waves from classified tasks: orders groups, clamps
  over-eager model assignments, defers test tasks, and **caps parallel fan-out**
  (default 8).
- `surface` — classifies changed files as UI-TESTABLE / UI-INDIRECT /
  NOT-UI-TESTABLE, and decides whether a manual test plan or devops review is
  warranted.
- `gate` — decides whether a review blocks, and partitions findings per file for
  parallel remediation. Exits non-zero when blocked.
- `validate` / `changes` — OpenSpec change readiness and discovery.
- `autonomy` — the L2→L3 earned-autonomy ladder with transitive blame.

**The code graph (`specflow-graph`)**
- Local, deterministic import/symbol graph with OpenSpec and memory overlays.
  Zero dependencies, no network, no vector store.
- Token-budgeted retrieval: `query`, `consumers`, `path`, `explain`, `context`,
  `docs`, `docs-index`.

**Skills**
- Onboarding: `graph`, `docs-digest`, `bootstrap`.
- Loop: `explore`, `spec`, `ship`, `mr`.
- Supporting: `review-code`, `review-artifacts`, `manual-test-plan`,
  `explain-code`, `commit`, `fix-tests`, `dispatch`.

**Guardrails enforced by the harness rather than by prose**
- `ship` sets `disallowed-tools: AskUserQuestion` — its zero-touch contract is
  structural, not aspirational.
- `ship`, `commit` and `mr` set `disable-model-invocation: true`, so Claude
  cannot decide on its own to commit or open a merge request.

**Testing**
- 171 tests, no dependencies. Covers the spine, the graph, and structural
  validation of every skill (frontmatter fields, description budget, and whether
  every bundled-file reference resolves).
- CI validates the plugin manifests with `claude plugin validate --strict` and
  smoke-tests the CLIs as executables.

### Notes

- SpecFlow **composes** OpenSpec rather than forking its skills. `/specflow:spec`
  drives the `openspec` CLI directly, so it does not drift when OpenSpec
  releases. Stock `openspec-*` skills remain available alongside it.
- Structural graph indexing covers JavaScript/TypeScript, Python and shell. Other
  languages get docs and spec indexing plus the full workflow, but no
  import/symbol edges — the skills state this rather than implying completeness.
- The autonomy ladder ships opt-in until it has accumulated real run data.

[0.1.0]: https://github.com/renzrollon/specflow/releases/tag/v0.1.0
