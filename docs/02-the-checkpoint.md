# The checkpoint

This page is a ten-minute reading procedure for the artifacts `/interlock:spec` leaves behind, and what to do when they are wrong.

`/interlock:spec` stops after writing specs. `/interlock:ship` starts from them and asks you nothing. Everything you are going to influence about this change, you influence here. That is the trade: one deliberate read, in exchange for an uninterrupted implementation run.

## What you are looking at

```
openspec/changes/<change-name>/
├── proposal.md      what and why
├── design.md        how, and which decisions were taken
├── tasks.md         the ordered work
└── specs/**         delta specs — behavior, in Given/When/Then
```

Read them in that order. It is cheapest to reject the change at `proposal.md` and most expensive to reject it at `specs/`.

## The ten-minute pass

| Minutes | File | The one question |
|---|---|---|
| 0–2 | `proposal.md` | Is this the change I asked for? |
| 2–5 | `design.md` | Would I have made these decisions? |
| 5–8 | `tasks.md` | Could someone else do this without asking me anything? |
| 8–10 | `specs/**` | Does this describe behavior I can verify? |

### `proposal.md` — is this the right change?

Read the summary and the scope. You are checking one thing: intent match. Silent scope expansion is the most common failure and the most expensive one — you asked for a flag and got a config subsystem.

**Looks wrong:** the change name describes something broader than your request; the proposal justifies work you did not ask for; a bug fix has grown a refactor; the "why" is a restatement of the "what".

### `design.md` — would I have decided this?

Skim the approach, then read the decisions closely. Every judgement call the agent made instead of asking you is recorded here, and this is your only chance to overrule one.

Check specifically:

- **Assumptions.** Each one is a place you were not consulted. Is each acceptable?
- **Reuse.** Does it build a new helper where one already exists in your repo?
- **Dependencies.** A named dependency must carry a version. `spec` is instructed to ask rather than guess a pin — an unpinned name is a signal the question got dropped.
- **Error handling.** Present, and matching how the rest of your codebase behaves.

**Looks wrong:** a new abstraction introduced for a single caller; a decision stated with no rationale; "we will handle X later" where X is the actual hard part; a pattern that contradicts `openspec/initial-architecture.md`.

### `tasks.md` — is this implementable?

Tasks feed the wave planner directly, so vagueness here becomes vagueness in the code. Read for actionability, not completeness of prose.

- Each task names the files or modules it touches.
- Dependencies come before dependents.
- Feature tasks have paired test tasks.
- A bug fix lands the **failing repro test as task 1**, and later tasks stay on the root cause.
- If the change transforms a shared value — a normalized identity, a cache or dedup key, a canonicalized field — there is a task for **every** consumer of it, not just the one that motivated the change.

**Looks wrong:** "update accordingly", "handle edge cases", "refactor as needed", "etc." Those phrases mean the decision was deferred to an implementer who will not have you available. One call site fixed and its siblings left reading the raw value is the same bug surviving its own fix.

### `specs/**` — can this be verified?

Delta specs are the acceptance criteria. Each requirement should carry concrete `Given/When/Then` scenarios.

- Scenarios describe **behavior**, not implementation.
- `ADDED` / `MODIFIED` / `REMOVED` sections are used for what they say.
- Edge cases appear: empty, error, loading, boundary, permission denied.
- Every scenario could plausibly become an automated test.

**Looks wrong:** "should work correctly"; a scenario that names a function instead of an observable outcome; a happy path with no failure path.

## Two cheap machine checks

Neither replaces reading, but both are fast and catch structural problems before you spend attention on content:

```bash
openspec validate                  # schema conformance
interlock validate <change-name>    # all three artifacts present, non-empty, real checkbox tasks
```

`interlock validate` exits non-zero when the change is not implementable. `/interlock:ship` runs it first and refuses to start on a failure, so a red result here is a hard stop either way.

## When it looks wrong

**Wrong idea — the proposal is not your change.** Re-run `/interlock:spec` with a sharper intent. State the boundary explicitly, including what is out of scope:

```bash
/interlock:spec add a --json flag to the report command — output shape only, no changes to the report query or its caching
```

**Right idea, wrong approach.** Say what you want instead and re-spec. The explore brief from the first run is reused, so the second pass is much faster than the first.

**Right idea, small gaps.** Edit `design.md` or `tasks.md` yourself. They are plain markdown and `ship` reads whatever is on disk. Adding a missing consumer task or pinning a version by hand is faster than a full re-spec. Re-run `interlock validate <change-name>` afterwards.

**Blockers were reported.** `spec` halts and shows them rather than fixing and continuing, because a blocker at this gate means the spec was wrong and you should see that. Fix the cause, not the report.

## When it looks right

```bash
/interlock:ship
```

From here on it does not ask you anything until it is done or it halts.

## There is an opt-out

`/interlock:spec --continue` runs a machine gate after the artifact review and, if it passes, invokes `ship` without stopping here. It is opt-in, fail-closed, and refuses to continue on anything above a narrow blast radius or with any decision still marked as needing a person.

What it cannot do is the thing this page is about. Every check it runs asks whether the change is implementable; none of them asks whether it is the change you wanted. [**05 — Continuity**](./05-continuity.md) is the full account, including when it is a reasonable trade and when it is not.

## Next

[**03 — OpenSpec vs Interlock**](./03-openspec-vs-interlock.md) — what each layer owns, and when stock OpenSpec is all you need.
