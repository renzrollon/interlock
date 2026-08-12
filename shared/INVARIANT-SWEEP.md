# Invariant Sweep — The Unit of Work Is the Invariant, Not the File

Shared discipline for all interlock skills that plan, review, or apply changes touching **shared or derived state**. Companion to `CONTEXT-HYGIENE.md`.

## The problem

Every gate after exploration is scope-leashed by design — `/interlock:spec` sees only artifacts, `/interlock:review-code` / `/interlock:ship` see only the diff. That leash is correct for most changes and wrong for exactly one class: **a change that transforms a value read in more than one place.**

When a change normalizes, trims, encodes, or canonicalizes a value stored on shared/derived state, some code paths get updated and others don't. The updated paths are in the diff; the stale readers are not. A diff-scoped or artifact-scoped gate is **structurally blind** to the stale readers — it cannot see the bug, because the bug lives in a file the change never touched.

Concrete failure (the one that motivated this file): a dedup change lower-cased an email in the write path. Readers that still compared the **raw** email case-sensitively silently stopped matching. No BDD scenario forced enumeration of mixed-case consumers; no reviewer was licensed to leave the diff. Only an ad-hoc agent sweep — the one thing with no scope leash — caught it.

## The rule

**When a change alters an invariant on shared or derived state, the unit of work is the invariant, not the file.** The change is not complete, and the review is not complete, until *every reader of that value* has been enumerated and confirmed to read the canonical form.

Two halves, both mandatory:

1. **Normalize once at the boundary, not at each call site.** If a value must be transformed, the design MUST state where the single canonical transform lives, and assert every consumer reads the canonical form. Scattering the transform across call sites guarantees one gets missed.
2. **Sweep the consumers.** Enumerate every reader repo-wide — not just the diff. Any reader still consuming the raw/untransformed form, or comparing it case/format-sensitively, is part of the change, not opportunistic creep.

## When it fires

Fire the sweep when the change touches a value that is **stored on a shared object or derived and read elsewhere**. Signals:

- A session / JWT / token field, request context, or auth principal
- A cache key, map key, dedup key, or any identity used in a comparison, `Set`/`Map`, or `WHERE`/`===`
- A normalized form of user input: casing, trimming, encoding, Unicode normalization, ID/slug canonicalization
- Anything the design describes with "normalize", "canonical", "dedupe", "match", "lookup by"

If none of these apply — the change is genuinely local, one reader, no shared identity — the sweep does **not** fire, and the normal diff/artifact leash holds. Do not sweep every change; that defeats the leash's purpose.

## How to sweep

**Structural + semantic — two layers**:

1. **Structural (deterministic):** enumerate every reader of the value — the field name, its getter, the map/cache key, the comparison sites. Prefer the graph when present:
   ```bash
   interlock-graph consumers <field-or-symbol>
   ```
   Then `grep`/search the whole repo to catch **dynamic/stringly** readers the graph misses (bracket access, computed keys, SQL, codegen). Enumerate exhaustively. This is a mechanical enumeration, not a judgment call.
2. **Semantic (judgment):** for each reader found, decide — does it consume the **canonical** form, or the **raw** form? A reader on the raw form, or a case/format-sensitive comparison, is a defect.

**When fanning out** (e.g. in `/interlock:explore` Pattern 4): assign **one agent per layer** — data / API / business-logic / frontend / tests — and make the layers **disjoint** so findings merge without overlap or double-counting. Seed each agent with the relevant `interlock-graph consumers` / module slice from `GRAPH_REPORT.md` when the graph exists. Each agent enumerates readers in its layer only; you merge and flag the raw-form readers in synthesis.

## Severity

A reader consuming the raw form of a value the change canonicalized elsewhere is a **BLOCKER** — it is a live correctness bug with a data-dependent trigger (it fails only for the inputs that differ pre/post-transform, which is exactly the set no happy-path test exercises).

## Skill integration

- **interlock-graph** — `consumers` is the structural first pass when `.claude/graph/graph.json` exists.
- **/interlock:explore** — Pattern 4 (Impact Analysis) is the mandatory fan-out for this class. It MUST fire on the signals above regardless of how the user phrased the question.
- **/interlock:spec** — the BDD edge-case categories include casing/encoding/whitespace/Unicode; the design principle "normalize once at the boundary" is mandatory for identity/shared-value changes.
- **review-code** — the "breaking API contracts" check is widened from shape to semantic value: graph consumers then grep repo-wide for raw-form readers and flag them BLOCKER. This gate is the licensed exception to the diff leash.

When adding a new skill that plans or reviews changes to shared/derived state, wire it to this discipline.
