# OpenSpec vs Interlock

This page explains which layer owns what, so you know when to reach for a stock `/openspec-*` skill and when to reach for Interlock.

Interlock **composes** [OpenSpec](https://github.com/Fission-AI/OpenSpec). It does not replace it, wrap it, or fork it. If you uninstall Interlock tomorrow, your `openspec/` directory is still a valid OpenSpec project and the stock skills still work on it.

## Who owns what

| Layer | Owns |
|---|---|
| **OpenSpec** | The artifact formats, their templates and ordering, schema validation, the change lifecycle, archive |
| **Interlock** | What happens *around* those artifacts — exploration, gates, parallel execution, review, verification, commit |

Everything in `openspec/` is OpenSpec's. Interlock writes into it through the CLI and reads it back the same way.

## What the stock skills do

`openspec init` installs its own Claude Code skills — `/openspec-propose`, `/openspec-explore`, `/openspec-apply-change`, and the archive and sync helpers. They are a complete, self-contained loop: describe a change, get proposal + design + tasks + delta specs, implement the tasks, archive when done.

They are namespaced separately from Interlock's, so both sets coexist. `/openspec-propose` and `/interlock:spec` are both available in the same session, on the same repo, over the same artifacts.

## When plain OpenSpec is the right call

| Situation | Use |
|---|---|
| One-line change, obvious implementation | `/openspec-propose`, then implement it yourself |
| You already know exactly what to build and want the artifact scaffold only | `/openspec-propose` |
| You want to hand-write or hand-edit artifacts | The `openspec` CLI directly |
| Archiving a merged change | `openspec archive <change-name>` — Interlock never archives for you; it only notices when you have not (`interlock drift`) |
| Listing, viewing, validating | `openspec list`, `openspec show`, `openspec validate` |

There is no penalty for mixing. A change proposed by `/openspec-propose` can be shipped by `/interlock:ship`, because `ship` reads artifacts from disk and does not care who wrote them — as long as `interlock validate` passes.

## What Interlock adds on top

| Addition | Where |
|---|---|
| Parallel exploration with a durable brief on disk, reused across runs | before `spec` |
| Evidence gate — a bug fix needs real error output and a repro before any artifact is created | in `spec` |
| Invariant sweep — every consumer of a changed shared value gets its own task | in `spec`, enforced at the artifact review |
| Artifact review before code exists | end of `spec` |
| The human checkpoint as the product's one deliberate stop | between `spec` and `ship` |
| Dependency-ordered wave execution with parallel subagents and context isolation | `ship` |
| Adversarially verified diff review — two skeptics try to refute every finding | `ship` |
| Deterministic decisions in code rather than prose: `interlock waves`, `surface`, `gate`, `validate` | throughout |
| Repo onboarding for brownfield projects, plus a local code knowledge graph | `bootstrap` |
| Spec-drift detection — completed changes never archived, and living specs older than the code they describe | `interlock drift`, surfaced in `spec` and `mr` |

The honest framing: OpenSpec gives you good artifacts. Interlock gives you a loop that produces them under gates and then executes them without you.

## Spec drift, and who owns it

OpenSpec is **spec-anchored**: `openspec archive` merges a completed change's delta specs into `openspec/specs/`, so the living specs keep describing what the code actually does. That mechanism is OpenSpec's and Interlock does not replace it.

What Interlock adds is noticing when it has not run. The failure is quiet and entirely ordinary: `ship` commits, the MR merges, nobody archives, and every later run reads living specs that describe a codebase that has moved on. `interlock drift` reports two things:

- **Unarchived changes** — every task ticked, but the change still sits in `openspec/changes/`. Read off the filesystem, so this one is certain.
- **Stale living specs** — a spec under `openspec/specs/` whose linked files have newer commits. Derived from the graph's `implements_spec` edges, which are `INFERRED` from path mentions in prose rather than parsed from a contract, so this one is a hint.

**Neither blocks.** `drift` exits 0 whatever it finds. Every other gating subcommand exits non-zero when it blocks, so this is the exception worth remembering — a blocking gate built on inferred edges would be wrong often enough to get switched off, and a gate everyone disables protects nothing. Archiving rewrites the living specs, which is a decision for whoever merged the change, not for a tool that noticed a date.

## Why `/interlock:spec` drives the CLI instead of forking the skills

The obvious shortcut would be to copy `openspec-propose` into Interlock and edit it. Interlock deliberately does not.

`/interlock:spec` calls the CLI directly:

```bash
openspec new change "<name>"
openspec status --change "<name>" --json
openspec instructions <artifact-id> --change "<name>" --json
openspec validate
```

`openspec status` reports which artifacts are required, which are ready, and where they belong on disk. `openspec instructions` returns the context, rules and template for each artifact. Interlock fills those templates and writes to the paths OpenSpec resolves.

Three reasons this is the boundary:

1. **The CLI is the stable contract.** Its JSON output is versioned surface. A forked markdown skill is a copy of an implementation detail, and it goes stale the moment OpenSpec changes a template.
2. **Upgrades are free.** New artifact types, changed ordering, revised templates — Interlock picks them up on the next `openspec` release without a single edit.
3. **Your artifacts stay portable.** Nothing Interlock writes is Interlock-shaped. Any OpenSpec tool can read it, including the stock skills and a human with an editor.

The same principle applies inside Interlock itself: anything a computer can decide correctly lives in the `interlock` CLI rather than in prose. Judgement — classification, implementation, review, synthesis — stays with the model.

## Rule of thumb

Use the stock skills when you want artifacts. Use Interlock when you want gates and an execution run. Both write the same files.

## Next

[**04 — When it stops**](./04-when-it-stops.md) — reading the halts and the warnings.
