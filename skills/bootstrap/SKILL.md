---
name: bootstrap
description: Onboard a brownfield project into OpenSpec — analyze the existing codebase with parallel explorer agents, write an initial architecture document, then generate one spec per discovered feature describing what is already built. Use when adopting spec-driven development on a repo that has code but no specs.
license: MIT
compatibility: Requires the openspec CLI. Node.js >= 18 for the bundled interlock-graph CLI.
argument-hint: "[--quick] [--scope <path>]"
allowed-tools: Bash(openspec *) Bash(interlock-graph *) Agent Read Write Glob Grep
metadata:
  type: discovery
  autonomy_level: L2
  outputs:
    - openspec/initial-architecture.md
    - openspec/specs/<feature>/spec.md
---

Document what a codebase **already is**, in OpenSpec form, so that every later change has something to change *from*.

This is archaeology, not design. Every spec you write describes behavior that exists in the code today. If you cannot point at the code that implements a requirement, it does not belong in the spec.

| Flag | Effect |
|------|--------|
| `--quick` | Sequential, single-context. For small repos (< ~50 source files). |
| `--scope <path>` | Restrict the whole run to a subdirectory. |
| *(none)* | Full parallel run. |

---

## 0. Pre-flight

```bash
# Initialize OpenSpec if this repo has never been initialized.
# `openspec init` creates openspec/config.yaml, so its absence is the real signal.
test -f openspec/config.yaml || openspec init --tools claude

# Build the structural graph once — it seeds every explorer below.
# Never swallow the outcome: stderr stays visible, and both failure modes
# (build errored / nothing indexable) get a banner.
graph_log=$(interlock-graph build .)
graph_status=$?
printf '%s\n' "$graph_log"
if [ "$graph_status" -ne 0 ]; then
  echo "GRAPH UNAVAILABLE: build errored (exit $graph_status) — explorers fall back to grep and will be slower"
elif printf '%s' "$graph_log" | grep -q 'nodes=0'; then
  echo "GRAPH UNAVAILABLE: nothing indexable found — explorers fall back to grep and will be slower"
fi
```

**A graph failure is not a stop.** Bootstrap works without it — docs and OpenSpec indexing still happen — so print the banner, carry it to the final report, and continue with degraded expectations: the explorers grep instead of following edges, and they are slower for it.

`nodes=0` is the ordinary case for a repo the graph doesn't structurally index (Go, Rust, Java, Ruby — structural indexing covers JavaScript/TypeScript, Python and shell). Say which of the two reasons applied rather than presenting either as a defect.

When the build did produce a graph, **read `.claude/graph/GRAPH_REPORT.md` before spawning anything**. Its hub nodes and module boundaries tell the explorers where to look, so they don't rediscover the tree from scratch.

Then check whether `openspec/specs/` already has content. If it does:

> "This project already has N specs. Bootstrap will ADD specs for undocumented features but will never overwrite an existing one. Continue?"

---

## 1. DISCOVER — parallel exploration

Spawn five explorer subagents via the Agent tool (`subagent_type: "Explore"`), or run them in sequence under `--quick`. Each returns structured JSON.

**Before writing the prompts, establish the stack.** Read the dependency manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `Gemfile`, …) and the top-level layout. Then phrase each prompt in that stack's vocabulary. The categories below are universal; examples in your head are *illustrative only* — replace them with the frameworks this repo actually uses. Asking a Go service about React hooks wastes a whole agent.

Shared skeleton — fill `{role}`, `{task}`, `{schema}` from the table:

```
You are the {role} explorer for this repo. Phrase findings in this stack's vocabulary.
{task}
Prefer GRAPH_REPORT.md / interlock-graph when a graph exists; otherwise grep.
Return JSON only: {schema}
```

| Role | Task | JSON schema |
|------|------|-------------|
| Structure Mapper | Map layout. Prefer GRAPH_REPORT modules/hubs, then verify on disk. Report organization (feature/layer/hybrid), entry points and routes, naming conventions, key config files, monorepo yes/no. | `{ organization, entryPoints[], conventions[], configFiles[], monorepo }` |
| Dependency & Data Model Analyzer | Prefer `interlock-graph query` / `path`. Report third-party deps by role, internal layer imports, persistence schema/models, entity relationships, outbound integrations. | `{ dependencies[], internalLayers[], dataModels[], entityRelationships[], integrations[] }` |
| Pattern Extractor | Recurring composition (components/handlers/services), state/lifecycle, errors, auth, data fetch/mutate, testing, code style. | `{ compositionPatterns[], stateManagement, errorHandling, auth, dataFlow, testing, codeStyle }` |
| Interface Scanner | External surface: endpoints and protocol, mutations, schemas/validators, public exports/SDK, realtime/streaming, CLI. | `{ endpoints[], mutations[], schemas[], publicExports[], realtime[], cli[] }` |
| Infrastructure & Config Reader | Build/task-runner entry points, env vars referenced in code, CI/CD, deploy target, lint/format, typecheck/static analysis. | `{ buildSystem, tasks[], envVars[], cicd, deployment, linting, staticAnalysis }` |

Cap: 8 agents in this phase.

---

## 2. SYNTHESIZE — the architecture document

One synthesis pass reads all five outputs and writes `openspec/initial-architecture.md`:

```markdown
# Initial Architecture

> Auto-generated by /interlock:bootstrap on {date}.
> Point-in-time snapshot, not a living document.

## Stack & Infrastructure
## Project Organization
## Architecture Overview          <- ASCII diagram, subsystem boundaries, data flow
## Data Model
## Subsystems & Features          <- table: subsystem | location | responsibility | patterns
## Established Patterns           <- composition, data flow, state, errors, auth, testing
## Interface Surface
## Design Decisions (Inferred)
- [EXTRACTED]  stated outright in comments or docs
- [INFERRED]   deduced from a consistent pattern
- [AMBIGUOUS]  unclear — several patterns coexist
## Gaps & Risks                   <- incomplete work, conflicting patterns, hazards
```

Tag every design decision with its confidence. An `[INFERRED]` decision that turns out wrong is recoverable; one presented as fact is not.

---

## 3. IDENTIFY FEATURES — boundary detection

From the synthesis, pick the units that each deserve a spec:

- **Entry-point based** — each major route group, command, or consumer
- **Domain based** — each data model with a full lifecycle
- **Capability based** — cross-cutting concerns (auth, observability, error handling)
- **Module based** — feature directories and barrel exports

Present the list for confirmation before generating:

```
Discovered N features to spec:
1. authentication — login, register, session management
2. task-crud      — create, read, update, delete tasks
3. app-shell      — layout, navigation, route protection

Generate specs for all, or select specific ones?
```

---

## 4. SPEC GENERATION — one agent per feature

For each confirmed feature, spawn a subagent (cap: 12).

> You are writing an OpenSpec spec for an **existing** feature. Document what IS built, not what SHOULD be.
> Feature: `{name}`. Architecture context: `{relevant section}`. Source files: `{paths}`.
> Read the implementation. Write requirements in the repo's OpenSpec spec format, each one traceable to code. Where behavior is genuinely unclear, mark it rather than guessing.

Write to `openspec/specs/<feature>/spec.md`. **Never overwrite an existing spec file.** If one exists, skip it and report the skip.

Then validate:

```bash
openspec validate
```

---

## 5. UPDATE PROJECT CONTEXT

Fill in the project context in `openspec/config.yaml` with what was discovered — stack, architecture summary, conventions, domain — so later `openspec instructions` calls carry it. Merge into the existing file; never clobber unrelated keys a user has set.

---

## 6. REPORT

- Any `GRAPH UNAVAILABLE: <reason> — explorers fall back to grep and will be slower` banner from pre-flight, repeated verbatim. If the graph built, say so in one line instead — a report that mentions neither reads like a graph-backed run that never happened.
- Architecture doc path and what it covers
- Specs created, and specs skipped because they already existed
- Features deliberately not specced, with the reason
- `openspec validate` result
- Suggested next step: `/interlock:docs-digest` to build the agent prose primer

---

## Guardrails

- **Never overwrite an existing spec.** Add only.
- **Never modify source code.** This skill is read-only outside `openspec/` and `.claude/graph/`.
- Respect `.gitignore`; skip vendored and generated trees.
- Max 8 explorer agents in phase 1, 12 spec agents in phase 4.
- **Idempotent.** Re-running adds newly-discovered features and leaves everything else alone.
- If a feature's behavior can't be determined from the code, say so in the spec rather than inventing a requirement.

Follow `${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md`.
