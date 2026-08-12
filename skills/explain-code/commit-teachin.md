# Commit teach-in — explain-code

Teach what changed and why — not a code review.

## Scope

Every source file touched in the commit range (skip binaries/lockfiles; cap ~25). Skip tests unless they are the only files and the user asked about them.

## Steps

1. Retrieve domain context on demand — Read `.claude/graph/DOCS_DIGEST.md` if present; then `interlock-graph context` / `docs` as needed (`${CLAUDE_PLUGIN_ROOT}/shared/TOOL-ECONOMY.md` Rule 0.5).
2. Resolve range: default `HEAD~1..HEAD`; `--commits N` → `HEAD~N..HEAD`; or an explicit hash/range from the user.
3. Gather:
```bash
git log -1 --format='%H%n%s%n%b'   # or log for the range
git diff --stat "$FROM" "$TO"
git diff --name-status "$FROM" "$TO"
git diff "$FROM" "$TO" -- <each source file>   # cap hunks ~300 lines/file
```
4. **Blast radius per file** — files that reference the import-specifier stem (basename without extension). For generic stems (`index`, `route`, `page`, `layout`, `config`, `types`, `utils`, `constants`, `main`, `mod`, `SKILL`, `README`, `PROMPT`) qualify with parent directory. Prefer `rg -l` / `git grep -l`; exclude self. Optional: `interlock-graph consumers <symbol>` when the graph exists. Name-match may false-positive — note incidental hits.
5. For each changed source file, fill the **Change Context** block (required). Optionally add function breakdown only for complex new/changed logic a beginner needs.
6. Write Commit Summary, Per-File Explanation, Change Flow, and Beginner Takeaway; write to the output path resolved in `SKILL.md`:
   - Scoped to an OpenSpec change (name passed, or an active change resolves via `openspec status --json`) → `openspec/changes/<change-name>/code-explanation.md`, alongside `manual-test-plan.md`
   - No change context → `docs/CODE_EXPLANATION.md`
   - Per-change output is deliberate: one shared `docs/` file would overwrite the previous change's explanation and permanently mark `.claude/graph/DOCS_DIGEST.md` stale via its `source_hashes`.

## Change Context (required)

### Change Context (required in commit teach-in)

Use this block for every changed source file in commit mode. Status = Added / Modified / Deleted / Renamed from `git diff --name-status`.

```markdown
#### `path/to/file.ext` — <Added | Modified | Deleted | Renamed>

**Why this file needed to change:**
Plain-language reason this file was part of the commit. Tie it back to the commit's
goal — what would be incomplete without touching this file?

**What changed:**
- Bullet the concrete edits from the diff (new function, changed signature, added
  field, deleted branch…). Skip boilerplate (import reordering, whitespace).
- Explain any TypeScript / React / Next.js concept a beginner wouldn't know,
  in one short aside each.

**Blast radius:**
- Who is affected downstream, based on the referencing files gathered for this path.
- Rate it: **Isolated** (self-contained), **Local** (a few callers in one area),
  or **Wide** (shared util/type/config touched by many files).
- Name the specific files most likely to feel the change and how.

**If this file had been left out:**
- What would break, fail to compile, or behave wrong if this file's change were
  missing from the commit but every other file's change shipped?
- Be concrete: name the type error, runtime failure, broken flow, or silent bug.
- If the file is genuinely independent (nothing else depends on the change),
  say so plainly — "nothing would break; this change is self-contained."
```

Rules for Change Context:
- Teach, don't judge. No code-review verdicts, no "should have" critiques.
- Ground every claim in the diff and blast-radius data — do **not** invent callers, functions, or failure modes you can't see.
- Be concise but complete — every changed source file gets its own block.

## Output Format

### Commit teach-in

Match the explain-code loop structure (no review verdicts):

```markdown
# Code Explanation: commit <short-hash> — <subject>

## Commit Summary

One or two sentences, in plain language: what does this commit accomplish and why?
Reference the commit subject but translate any jargon for a beginner.

---

## Per-File Explanation

[One Change Context block per changed source file — see above]

---

## Change Flow

If the commit spans multiple layers (e.g. type → data layer → component → route),
draw the dependency order as a short chain:

`types/batch.ts (new field)` → `lib/db.ts (reads field)` → `app/api/.../route.ts` → `components/BatchCard.tsx`

One line per chain. Write `(single-layer — no cross-layer flow)` if N/A.

---

## Beginner Takeaway

One sentence naming the single most important concept a beginner should learn
from studying this commit (e.g. "shared types are a coupling point — changing one
field ripples through every consumer").
```

If there are no commits to explain: write only `No commits to explain yet.` and stop.

## Tone & Style

## Tone & Style

- **Friendly, encouraging, zero condescension** — "we" language, like a senior sitting next to you
- **Skip the obvious** — don't explain what `const x = 5` does
- **Explain the non-obvious** — why this pattern? why server vs client? why does this call SQS here?
- **Name every external service call** — never skip an infra interaction, these are critical for understanding the system
- **Use analogies** — "Think of SQS like a to-do list for a background worker — we drop a note saying 'process this batch', and a separate service picks it up later"
- **Show the full journey** — from user action → through the code → to the database/service → back to the UI
- **Keep it scannable** — headers, bullet points, tables, code blocks. No walls of text.

---

## What NOT to Do

- Don't review or critique the code
- Don't suggest improvements (unless asked)
- Don't explain import statements, simple variable declarations, or trivial types
- Don't explain test files
- Don't use jargon without defining it on first use
- Don't be condescending ("as you probably know" / "this is simple")
- Don't explain node_modules or third-party library internals (just say what the library does)
- Don't skip infrastructure calls — every DB query, S3 operation, SQS message, and auth check must appear in the flow
- Don't use subagents or workflows — this skill requires sequential understanding across files
- In commit teach-in, don't skip Change Context fields — every changed source file needs Why / What / Blast radius / If left out
- Don't invent blast-radius callers or breakage modes not evidenced by the diff or reference search

- In commit teach-in, don't skip Change Context fields — every changed source file needs Why / What / Blast radius / If left out
- Don't invent blast-radius callers or breakage modes not evidenced by the diff or reference search
