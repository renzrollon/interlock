---
name: docs-digest
description: Compress a repo's docs and OpenSpec specs into one token-dense, agent-only primer at .claude/graph/DOCS_DIGEST.md — the prose twin of GRAPH_REPORT.md. Use when docs context is too large to load, after substantial docs or spec edits, or when asked to rebuild or refresh the docs digest. Not for producing human-readable documentation.
license: MIT
compatibility: Requires Node.js >= 18. The interlock-graph CLI ships with this plugin and is on PATH automatically.
allowed-tools: Bash(interlock-graph *) Read Write
metadata:
  type: discovery
  outputs:
    - .claude/graph/docs-index.json
    - .claude/graph/DOCS_DIGEST.md
---

Produce **one agent-only primer** that lets a fresh agent understand this repo's documented domain without reading `docs/` end to end.

`GRAPH_REPORT.md` answers *what connects to what*. This answers *what this project means*. They are siblings, both under `.claude/graph/`.

**Inputs:** `docs/**` and `openspec/specs/**`, via the deterministic index.
**Output:** `.claude/graph/DOCS_DIGEST.md`, overwritten in place.
**Never indexed:** `openspec/changes/**`. Active change artifacts are read directly, not digested.

Run this when: the digest is missing or stale, docs or living specs changed substantially, or the user asks to rebuild it. **Do not run it per query** — interactive skills should read an existing fresh digest, not regenerate one.

---

## Execution

### 1. Index (deterministic — no model judgement)

```bash
interlock-graph docs-index . --write
```

Writes `.claude/graph/docs-index.json` covering `docs/` and `openspec/specs/`, with a `sha256` and heading spans per file.

If the index is empty, stop and report that: a repo with no `docs/` and no `openspec/specs/` has nothing to digest, and inventing one is worse than having none.

### 2. Staleness check

If `.claude/graph/DOCS_DIGEST.md` exists, compare its frontmatter `source_hashes` against each `files[].sha256` in the index. All match, and the user didn't force a refresh? Report fresh and stop.

Rebuild when: hashes mismatch, the digest is missing, or the user says rebuild / refresh / force.

### 3. Selective read — never concatenate the corpus

Read `.claude/graph/docs-index.json` in full. It is an inventory, not the corpus.

Then read **section spans only** (`offset`/`limit` from each entry's `startLine`/`endLine`), highest signal first. Rank the index entries yourself using these signals, in order:

1. **Entry points.** A file whose path or title matches `readme`, `architecture`, `overview`, `getting-started`, `contributing`, or `adr` — these state intent and structure.
2. **Inbound references.** Files linked to most often from other indexed files. The index records outbound links; invert them. A doc everything points at is load-bearing.
3. **Spec coverage.** Every `openspec/specs/*/spec.md` capability gets at least its title and requirement blurbs — the capability map is the single most useful thing in the digest.
4. **Breadth over depth.** Prefer one section from each of ten documents over ten sections from one. You are building a map, not a summary.

Drop first under token pressure: long analysis or research write-ups, changelogs, meeting notes, anything whose blurb already conveys the point, and peripheral spec capabilities. For those, use the index blurb instead of reading a span.

Rank what the repo actually contains. Do not assume any particular filename exists.

**Forbidden:** `find docs -exec cat`, reading every `docs/**/*.md` or `openspec/specs/**/*.md` end to end, reading anything under `openspec/changes/`, and writing output anywhere under `docs/` or `openspec/`.

### 4. Write the digest

Overwrite `.claude/graph/DOCS_DIGEST.md` with exactly this contract:

```markdown
---
audience: agent-only
target_tokens: 2500
generated_at: <ISO-8601>
source_hashes:
  <path>: <sha256>
  # one entry per indexed file
---
# docs-digest
## map
- <short-key> → <path>
## facts
- <dense telegraphic facts; ;-joined clauses fine>
## workflows
- <agent-relevant workflows and constraints>
## specs
- <capability> → key requirements / constraints (telegraphic, pointer-heavy)
## pointers
- <path>#<heading> Lstart-Lend
```

Omit `## specs` entirely when the index contains no `openspec/specs/` files.

**Style — this is read by agents, not people.** Telegraphic. Abbreviations fine. Lists and `→`. No tutorial tone, no narrative padding, no worked examples. Prefer a pointer over a paraphrase whenever the reader could drill down with `interlock-graph context` or a Read span.

**Budgets:** soft cap ~2500 tokens (`ceil(chars/4)`), hard stop ~3200. Drop lowest-priority content first. Never state a fact that isn't in the index or a span you actually read.

### 5. Report (≤10 lines)

Output path, token estimate, file count split by `docs/` vs `openspec/specs/`, fresh-vs-rebuilt, and a reminder that humans should keep reading `docs/` — this artifact is not for them.

---

## Relation to the graph skill

| Need | Use |
|------|-----|
| Prose bootstrap / domain primer | This digest (`DOCS_DIGEST.md`) |
| Structural bootstrap | `GRAPH_REPORT.md`, `interlock-graph query` |
| Task-specific cited excerpts | `interlock-graph context` / `docs` |
| Active change artifacts | Read `openspec/changes/<name>/` directly — **never** this digest |
| TOC and hashes for this skill | `interlock-graph docs-index` |

Follow `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md`.
