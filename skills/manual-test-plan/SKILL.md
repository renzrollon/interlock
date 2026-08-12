---
name: manual-test-plan
description: Produce an expert-QA manual UI test plan from an OpenSpec change plus a git commit range — every touched file accounted for, spec scenarios and tasks mapped to numbered test cases, and non-UI-testable changes flagged rather than dropped. Use when asked for a manual test plan, QA checklist, or UI verification plan after implementing and before opening an MR.
license: MIT
compatibility: Requires git. Optional openspec CLI for change scoping. Node.js >= 18 for the bundled interlock CLI.
argument-hint: "[change-name] [commit-range]"
allowed-tools: Bash(git *) Bash(interlock *) Bash(interlock-graph *) Bash(openspec *) Read Write Grep Glob
metadata:
  type: generation
  autonomy_level: L2
  outputs:
    - openspec/changes/<change>/manual-test-plan.md
---

Produce a precise, executable **manual UI test plan** from an OpenSpec change and a git commit range.

Write for a junior tester who will not read the code: exact navigation paths, exact expected results, explicit pass/fail criteria. If a step needs someone to already know how the feature works, rewrite it.

---

## 1. Resolve scope

```bash
interlock changes                                  # active changes
git log --oneline "$FROM".."$TO"
git diff --stat "$FROM" "$TO"
git diff --name-status "$FROM" "$TO"
git diff "$FROM" "$TO" -- <source files>          # cap ~40; skip lockfiles and binaries
```

Default range: the merge base against the default branch. Read `proposal.md`, `design.md`, `tasks.md`, and `specs/**/*.md` for the change when one resolves.

Optional context — do **not** preload all of `docs/`:
- `.claude/graph/DOCS_DIGEST.md` if present
- `interlock-graph context "<change> routes components forms" --budget 2000`

---

## 2. Classify the surface — deterministically

```bash
interlock surface --changed <files> --json
```

This returns the tri-state per file, and it is authoritative. **Do not re-derive the classification in prose**; the whole reason it is a CLI is that this question used to get two different answers on the same diff.

| Class | Meaning |
|---|---|
| `UI-TESTABLE` | Directly user-visible — pages, components, forms, navigation, copy, layout, client validation, loading and error states |
| `UI-INDIRECT` | Reachable only through UI side effects — API routes the UI calls, server actions, data shaping that changes what is displayed |
| `NOT-UI-TESTABLE` | Backend, infra, docs, tests, config, tooling with no user-visible effect |

If `needsManualTestPlan` is false, say so and stop. A backend-only change does not get a UI test plan, and writing one anyway teaches the reader to ignore these documents.

---

## 3. Analyze

1. **Inventory** every changed file from `--name-status`.
2. **Map specs and tasks to cases.** Spec scenarios and unchecked `tasks.md` items are the backbone; findings visible only in the diff become additional cases.
3. **Cover the whole surface.** Every `UI-TESTABLE` and `UI-INDIRECT` file appears in at least one test case (or is explicitly deferred to a shared flow). Every `NOT-UI-TESTABLE` file appears in the Non-UI table. **Never silently drop a changed file** — an unmentioned file reads as "tested" when it wasn't.

---

## 4. Write the plan

Write to `openspec/changes/<change-name>/manual-test-plan.md`. If nothing scopes it, write `./manual-test-plan.md` and say so.

Output **exactly** this structure — no preamble, no sign-off inside the file:

```markdown
# Manual UI Test Plan — <change-name or "unscoped">

**Scope:** <N commits / merge-base vs base> · HEAD `<short-hash>` · <branch>
**Intent:** <1–2 sentences from proposal.md, or inferred from commit subjects>
**Persona:** Expert QA — assume a clean session unless a case says otherwise
**Environment prep:** <accounts, feature flags, seed data, base URL — or "none">

---

## Coverage Matrix

| File | Status | Class | Covered by |
|------|--------|-------|------------|
| path/to/file | M/A/D/R | UI-TESTABLE / UI-INDIRECT / NOT-UI-TESTABLE | TC-01, TC-03 / — see Non-UI |

Every changed source file in the range MUST appear here.

---

## Test Cases

### TC-01 — <short title>
- **Priority:** P0 (blocks ship) / P1 (core flow) / P2 (edge / polish)
- **Traces to:** <spec scenario / task id / diff observation>
- **Covers files:** `path/a`, `path/b`
- **Preconditions:** …
- **Steps:**
  1. …
  2. …
- **Expected:** …
- **Pass / Fail:** Pass if … · Fail if …

### Happy path
TC ids proving the primary journey works end to end.

### Edge / negative
TC ids for validation errors, empty states, permissions, failure UX.

### Regression watch
TC ids for adjacent UI that tends to break when this area changes.

---

## Non-UI Changes (not manually testable in the UI)

| File | Why not UI-testable | Suggested verification |
|------|---------------------|------------------------|
| path/to/x | pure utility / infra / docs-only | unit test / CI job / manual CLI invoke / N/A |
```

Group assertions into one case when they share a navigation path; split them when the outcomes differ.
