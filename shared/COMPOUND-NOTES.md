# Compound Notes — Contract

A note is something a review found that the spec never said: a requirement
neither the living specs nor the change's delta specs stated. The table keeps
one row per surprise so the next spec that touches the same file is shown it.
Nothing gates on this file.

**Path:** `docs/notes/compound.md` (the constant `NOTES_PATH` in
`lib/notes.mjs`). Committed with the repository, not with a change.

---

## Template (stable — tooling depends on the seven columns)

```markdown
# Compound notes

| id | date | change | file | surprise | rule | source |
|----|------|--------|------|----------|------|--------|
| N1 | 2026-10-19 | add-x | lib/a.mjs | A sibling reader was missed. | Name every reader of the raw form. | .claude/metrics/review-code-add-x.json |
```

- `id` — `N1`, `N2`, … unique in the table. Assigned by the writer, one past
  the highest present; never renumbered, never reused.
- `date` — ISO date the row was written.
- `change` — the OpenSpec change whose review found it.
- `file` — the repository-relative path the finding was about. Retrieval joins
  on this column.
- `surprise` — what the review found, one line (the finding's title).
- `rule` — what the next spec should say. The finding's `suggestion`, else the
  first sentence of its `description`, stored as-is for a person to reword.
- `source` — where the finding came from: a run id or a metrics path.

Use `—` for an empty cell. Escape a literal `|` inside a cell as `\|`. A cell
is one line; a newline collapses to a space.

A row with a missing `id`, `file` or `rule`, a repeated `id`, or other than
seven cells is a problem: it is reported with its line number, never read as a
note and never silently dropped.

---

## The two writers

1. `/interlock:review-code` §4 runs `interlock note derive` after the gate, over
   the surviving findings.
2. The ship loop's review adjudication appends the same rows after it writes the
   review metrics.

A finding becomes a row only when its `specGap` is exactly `true`; only the
domain and technical-lead reviewers set it. Both writers are non-fatal: a failed
append prints `COMPOUND NOTES NOT WRITTEN: <reason>` and the run goes on. A row
whose change, file and rule are already present is skipped.

## Retrieval

`interlock note match <change>` and the advisor brief return the rows whose
`file`, canonicalised with `canonicalizePath`, is a path the change's
`tasks.md` names (`specMentionedPaths`), in table order, cut whole at
`LIMITS.maxAdvisorNoteRows` with the omitted count named.

## A machine appends and never edits

The writers only add rows at the end. A person edits, rewords or deletes a row
by hand; no tool rewrites an existing line, so a row the parser could not read
survives every append untouched.
