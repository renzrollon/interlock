# Tool Economy — Locate Before You Read, Batch Your Bash, Read State Don't Re-Derive It

Shared discipline for all interlock skills that investigate a codebase or
gather project state. Companion to `CONTEXT-HYGIENE.md` and `INVARIANT-SWEEP.md`.

## Rule 0 — Query the graph before you Grep (when it exists)

If `.claude/graph/graph.json` exists, treat it as the first locator for
structural questions — “where is X”, “who uses Y”, “how does A reach B”:

```bash
interlock-graph query "<tokens>" --budget 1500
interlock-graph consumers <symbol-or-file>
interlock-graph path <A> <B>
interlock-graph explain <node>
```

(`interlock-graph` is on PATH whenever this plugin is enabled — never probe for it.)

Read `.claude/graph/GRAPH_REPORT.md` once for hubs/modules when scoping a
fan-out. Then Grep/Read only for detail the graph lacks (dynamic imports,
stringly keys, generated code, languages outside the graph walk).

If the graph is missing and the session will do heavy exploration, prefer
`interlock-graph build .` (or `/interlock:graph rebuild`) once over repeated blind greps.
Do **not** rebuild on every query when the graph already exists — use
`interlock-graph update` after large merges.

## Rule 0.5 — Budgeted documentation retrieval (don't preload `docs/`)

Do **not** read all `docs/*.md` or concatenate OpenSpec markdown into context
upfront. Prefer the agent-only digest, then retrieve cited excerpts on demand.

**Digest-first ladder**

1. If `.claude/graph/DOCS_DIGEST.md` exists → Read it **once** as the default docs
   primer (bounded agent-only file; prose twin of `GRAPH_REPORT.md`). Do not also
   preload raw `docs/`.
2. Task-specific drill-down → budgeted retrieve:

```bash
interlock-graph context "<task tokens>" --budget 2000 --changed path/a.ts,path/b.ts
interlock-graph docs "<domain terms>" --budget 800
```

3. If digest missing/stale and the session needs domain prose → run `/interlock:docs-digest`
   (rebuilds via `interlock-graph docs-index` + compress), else proceed with `context` only.
4. Fallback when retrieve is empty (at most one query rewrite, then stop sprawl):
   - broaden terms once (`auth` → `authentication session`)
   - `grep` headings in `docs/` / `openspec/`, then Read spans
   - if graph missing: `docs` only, or read `docs/architecture.md` headings via grep

**Default budgets**

| Command | Budget | Role |
|---------|--------|------|
| `DOCS_DIGEST.md` | ~2500 soft / ~3200 hard | Agent-only prose bootstrap (via `/interlock:docs-digest`) |
| `context` | 2000 tokens | Combined structural + documentation bundle |
| `docs` | 800 tokens | Prose/domain context only |
| `query` / `consumers` | 1500 tokens | Structural navigation |
| `docs-index` | (index JSON) | Deterministic TOC/hashes for digest rebuild |

**Provenance** — every excerpt must cite `file:heading (Lstart-Lend)`.
Treat graph `INFERRED` edges as hints; verify with Read spans before claims.

**Authoritative artifact exception** — when implementing against an active OpenSpec
change, still read **all** of `proposal.md`, `design.md`, `tasks.md`, and delta
specs for that change first. Rule 0.5 replaces exploratory preload, not the
implementation contract leash (`/interlock:ship`).

**Batch gathers** — a non-interactive run that needs project prose should pull a
single bounded bundle via `interlock-graph context`, never `find docs -exec cat`.
If `context` fails, prefer `.claude/graph/DOCS_DIGEST.md` over reading the head
of an architecture doc.

## Rule 1 — Locate before you Read

Use `grep` / the Grep tool to find the file and line first, then Read with
`offset`/`limit` around the hit. Do **not** Read whole files sequentially to
discover where something lives. Read a file in full only once you know it's the
one you need. When Rule 0 applies, graph query/consumers counts as “locate.”

## Rule 2 — Batch and background your Bash

- **Independent read-only commands** go in one message (multiple tool calls) or
  joined with `;` — not `&&`. `&&` short-circuits: if an early command exits
  non-zero, the later ones never run and their output is silently lost. For a
  status sweep (`git branch`, `git status`, `git log`, `openspec status`) you
  want them all regardless, so batch them.
- **Reserve `&&` for dependency-ordered chains** where a later step is meaningless
  if an earlier one failed — e.g. `npm run typecheck && npm run lint && npm test
  && npm run build`.
- **Background the long-running.** Builds, full test suites, and installs run with
  `run_in_background` so you can continue other work while they execute.

## Rule 3 — Read state, don't re-derive it

At session start, current-task context comes from a few cheap, authoritative
sources — `git log --oneline`, `git status --short`, `openspec status --json`,
an open-task grep over `openspec/changes/*/tasks.md`, and the latest handoff.
Front-load these in one pass. Read them,
then act. Do not re-traverse the tree to reconstruct what they already tell you.

**Explore brief as Rule-3 state:** when `/interlock:spec` runs after explore
(especially after `/clear` or prompt-cache expiry), read the latest matching
`.claude/handoff/explore-*.md` first (see `EXPLORE-BRIEF.md`).
Prefer the brief’s recommendations over re-deriving discovery from the codebase
or chat. Reopen code only for gaps or contradictions. Writing that brief in
autonomous explore is how explore pays forward — spec should not re-pay.

## When NOT to apply

This targets *wasted* exploration, not legitimate reconnaissance:

- Genuine cross-subsystem investigation still warrants a fan-out
  (`/interlock:explore`). Rule 1 applies *within* each investigator; the
  decision to fan out is unchanged.
- The artifact leash still holds: when you're about to implement against a
  proposal/design/tasks set, read all of it first (see `/interlock:ship`).
  That is not the sprawl this file is about.
