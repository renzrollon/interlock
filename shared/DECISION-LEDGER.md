# Decision Ledger — Continuity Contract

Durable record of every ambiguity a change hit and how it was settled. Lives
with the change so it survives `/clear`, prompt-cache expiry, and a handoff to
a different agent — and so a machine can read it.

**Path:** `openspec/changes/<change>/decisions.md`
Versioned with the change; committed alongside `proposal.md` / `design.md` /
`tasks.md`.

**Why a file and not chat:** a decision that exists only in chat does not
exist. The readiness gate answers one question — *is there anything left here
that only a human can decide?* — and it answers it by reading this file.

---

## Template (stable — tooling depends on the five columns)

```markdown
# Decisions — <change>

| id | question | class | resolution | evidence |
|----|----------|-------|------------|----------|
| D1 | Pin zod version? | needs_human | — | — |
| D2 | Use existing Session helper vs new | agent_resolved | Reuse lib/session.ts | explore brief §Critical Files |
```

- `id` — `D1`, `D2`, … unique within the change. Stable: never renumber, and
  never reuse an id for a different question.
- `question` — one line, answerable. Not a topic ("auth") but a decision
  ("store the session in a cookie or in Redis?").
- `class` — exactly `needs_human` or `agent_resolved`. Nothing else.
- `resolution` — what was decided, in words.
- `evidence` — where the answer came from.

Use `—` for a cell with no value. `-` and an empty cell mean the same thing.
Escape any literal `|` inside a cell as `\|`.

---

## The two classes

| Class | Meaning |
|-------|---------|
| `needs_human` | Product, policy, pricing, legal, security-posture, pinned-version, or tenancy-boundary judgement the repo cannot answer. **Stops continuity.** |
| `agent_resolved` | Answered from the repo, the explore brief, or a stated default — and written down. |

There is no third class. A row that is neither is a malformed row.

**Route to `needs_human` when in doubt.** A wrong `agent_resolved` ships an
unreviewed product decision; a needless `needs_human` costs one question.

---

## When to write a row

**Explore** — before the brief is finished:

- Every item under `## Pending Clarifications` gets a `needs_human` row.
- Every item under `## Assumptions Made` gets an `agent_resolved` row, with the
  evidence pointing at the brief section or the file that justified it.

**Spec** — while writing `proposal.md` / `design.md` / `tasks.md`:

- Every open question that surfaces mid-flight gets a row before it is acted
  on — never resolve an ambiguity silently in the design prose.
- Every `agent_resolved` decision must also appear as a written assumption in
  `design.md`, referenced by id (`D2`).
- Carry forward the rows explore wrote; do not start a fresh ledger.

**Answering a `needs_human` row:** edit the row in place — flip the class to
`agent_resolved`, write the human's answer into `resolution`, and cite the
human in `evidence` (for example `human decision 2026-08-12`). Do not delete
the row; the history of what needed a person is the point.

---

## The `agent_resolved` evidence requirement

`agent_resolved` is a **claim**, and it is audited.

`interlock ledger <change>` checks all three parts of the claim. A row is
**invalid** when it claims `agent_resolved` and any of these is true:

- `resolution` is empty (`—`, `-`, `n/a`, `tbd`, blank), or
- `evidence` is empty, or
- the row's `id` appears nowhere in the change's `design.md`.

An invalid row is treated as **unresolved** and blocks continuity exactly like
`needs_human`. Writing the word `agent_resolved` is not a decision; saying what
was decided and why is.

Good evidence is a pointer someone else can follow:

- `lib/session.ts:42` — the existing helper
- `explore brief §Critical Files`
- `openspec/specs/auth/spec.md §Scenario: expired token`
- `human decision 2026-08-12`

Not evidence: `obvious`, `standard practice`, `see above`, an empty cell. These
are matched as the **whole cell**, after casing, surrounding whitespace and a
trailing period are folded — so `Obvious.` is rejected the same way `obvious`
is, while `lib/session.ts:42 — the obvious existing helper` is real evidence and
is accepted.

**The `design.md` reference.** The id is matched as a token anywhere in
`design.md`, not as a heading: this contract does not say *where* in the design
a decision has to be recorded, only that it is. A `design.md` that is missing or
cannot be read makes every reference **unresolvable** — it is never treated as a
document that happens to contain every id.

---

## What blocks continuity

Continuity stops when **any** of these is true:

1. One or more valid `needs_human` rows remain.
2. One or more rows are invalid — bad class, missing id or question, wrong
   column count, or an unsubstantiated `agent_resolved`.

3. The ledger is **missing**, or present and unparseable.

A ledger that cannot be parsed is never reported as empty. An empty ledger
reads as "nothing needs a human", so unreadable rows are surfaced and blocking,
not dropped.

**An absent `decisions.md` is a failure of the audit, not an empty result.**
`interlock ledger` exits non-zero and says *missing* — distinguishably from
*present and empty*, and from *unparseable*. The likeliest way this audit fails
is that nobody wrote the file, so that is the case it refuses to pass. If a
change genuinely raised no ambiguity, write the ledger with its heading and no
rows: an empty ledger is a statement, an absent one is a silence.

---

## Presenting blocked rows

When decisions block, show **only** the blocking rows — id, question, and where
the artifacts are. Do not ask a human to re-read the whole spec; they are here
to answer questions, not to audit markdown.
