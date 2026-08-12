---
name: graph
description: Build and query a local, deterministic codebase knowledge graph (imports, symbols, OpenSpec specs, memory) so agents navigate with token-budgeted subgraphs instead of re-grepping. Use when indexing a repo, finding who consumes a symbol, tracing how one module reaches another, or before a deep explore or review sweep.
license: MIT
compatibility: Requires Node.js >= 18. The interlock-graph CLI ships with this plugin and is on PATH automatically.
allowed-tools: Bash(interlock-graph *) Read Grep Glob
metadata:
  type: discovery
  autonomy_level: L2
  outputs:
    - .claude/graph/graph.json
    - .claude/graph/GRAPH_REPORT.md
    - .claude/graph/docs-index.json
---

Build and query a **local, deterministic** codebase knowledge graph. No vector store, no external service, no network.

**What gets indexed:** JS/TS, Python (`.py`/`.pyi`), shell (`.sh`/`.bash`), and curated small config JSON (`package.json`, `tsconfig*.json` — not lockfiles). Markdown stays on the bounded-retrieval path (`DOCS_DIGEST.md` / `context` / `docs`) plus the OpenSpec overlay — never dump every `*.md` into `graph.json`.

Languages outside that set (Go, Rust, Java, Ruby) are **not** structurally indexed: you still get the docs and OpenSpec overlays, but no import/symbol edges. Say so plainly rather than implying the graph is complete.

**Artifacts, all project-local under `.claude/graph/`:**

| Path | Role |
|------|------|
| `graph.json` | Node-link graph — the query source of truth |
| `GRAPH_REPORT.md` | Cheap bootstrap: hubs, modules, inferred edges |
| `docs-index.json` | Deterministic docs TOC + content hashes |
| `DOCS_DIGEST.md` | Agent-only prose bootstrap (written by `/interlock:docs-digest`) |
| `manifest.json` | File hashes powering incremental `update` |

Add `.claude/graph/` to `.gitignore` — these are generated per-checkout and should never be committed.

---

## The CLI

`interlock-graph` is on PATH whenever this plugin is enabled. Do not probe for it, do not build a fallback path, do not shell out to `node` with an absolute path.

```bash
interlock-graph --help      # full subcommand list
interlock-graph which       # print the resolved CLI path, if you need to report it
```

---

## Modes

### Build — when the graph is missing, or the user asks to index

```bash
interlock-graph build .
```

Then read `.claude/graph/GRAPH_REPORT.md` and summarize the top hub nodes and module boundaries. **Do not rebuild on every query.** If `graph.json` already exists, query it or update it.

### Update — after merges, or when paths look stale

```bash
interlock-graph update .
```

No-ops when file hashes still match `manifest.json`.

### Query — the default mode

For "where is X", "what connects to Y", "how does A reach B", "who uses Z":

1. Expand the user's wording into graph vocabulary (use labels from a prior `query` or from `GRAPH_REPORT.md`).
2. Run the matching subcommand:

```bash
interlock-graph query "<tokens>" --budget 1500
interlock-graph consumers <symbol-or-file>
interlock-graph path <A> <B>
interlock-graph explain <node>
```

3. Answer from the returned subgraph. Cite `source_file:source_location`.
4. Only then reach for Grep/Read to cover what the graph structurally cannot see: dynamic imports, string-keyed lookups, generated code, reflection.

### Docs and context — bounded prose retrieval

Never read all of `docs/*.md` upfront.

1. **Prose bootstrap** — if `.claude/graph/DOCS_DIGEST.md` exists, read it once. Rebuild with `/interlock:docs-digest` when it is missing or stale.
2. **Rebuild the deterministic TOC** the digest is derived from:

```bash
interlock-graph docs-index . --write
```

3. **Task-specific excerpts:**

```bash
interlock-graph context "<task tokens>" --budget 2000 --changed path/a.ts,path/b.ts
interlock-graph docs "<domain terms>" --budget 800 --dirs docs,openspec/specs
```

`context` combines a structural subgraph (~45% of budget) with ranked Markdown sections (~55%). Sections cite `file — heading (Lstart-Lend)`.

---

## Arguments

This skill takes free text, treated as a query. Two forms are recognized ahead of that:

| Input | Action |
|-------|--------|
| "index the repo" / "build the graph" / "rebuild" | `build .`, summarize the report, stop |
| "update the graph" | `update .`, report what changed, stop |
| anything else | Query mode |

Note these map to CLI **subcommands**, not flags. There is no `--rebuild` or `--consumers` flag; `interlock-graph --rebuild` is an error.

---

## When other skills call this

| Situation | Command |
|-----------|---------|
| Session explore / architecture mapping | Read `GRAPH_REPORT.md`, then `query` per subsystem |
| Domain prose bootstrap | Read `DOCS_DIGEST.md`; rebuild via `/interlock:docs-digest` if stale |
| Invariant sweep, structural layer | `consumers <field-or-symbol>` first, then grep for string-keyed readers |
| explain-code "called by" / "calls into" | `explain` / `consumers` / `path` |
| Brownfield onboarding | `build`, then seed the architecture doc from report hubs and modules |

Follow `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md` and `${CLAUDE_PLUGIN_ROOT}/shared/INVARIANT-SWEEP.md`.

---

## Stance

- **Graph first, files second.** The graph is an index, not a substitute for reading real code when you implement or verify semantics.
- **Confidence matters.** Prefer `EXTRACTED` edges. Treat `INFERRED` edges (OpenSpec, memory overlays) as hints to verify, not facts.
- **Never invent nodes.** If the CLI reports no match, say so and fall back to grep. Do not synthesize a plausible-looking path.
- **Read-only by default.** `build` and `update` write only under `.claude/graph/`.
