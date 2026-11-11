# Design

## Context

See `proposal.md` for the motivation and the recorded passes.

Three functions in `lib/review-proof.mjs` hold the behaviour:

- `rerunTargets` (`:223-230`) names every dimension that is unproven **or** has an `unread` entry, plus one target for uncited files.
- `proofAnswer` (`:258-275`) turns that list into the answer: `re-run:` (exit 1) under the cap, `PROOF CAP REACHED:` (exit 0) at it, and exit 2 when the proof does not hold and the list is empty.
- `mergeRerun` (`:308-349`) replaces the ledger of every dimension the draft named unproven **or** unread, and appends for any other re-run dimension.

An `unread` entry is free text, `{ input, reason }`. The CLI cannot tell "the brief allows one test file" from "I skipped this file".

The re-run's prompt is the first pass's prompt. `briefDimension` (`lib/review-cli.mjs:301-347`) has no re-run input, so a re-run for one uncited file reads the whole diff again.

Constraints that shape the approach:

- The settle meter attributes a spawn by the first line of its prompt, and relays the first line of `interlock review proof` as printed (`lib/settle-meter.mjs:865-867`).
- The ship run records a proof and runs no re-run (`lib/review-proof.mjs:419-456`). It assembles its dimension prompts itself and never passes `--rerun-of`.
- `computeProof` decides `proof.proven`. Every reader of the verdict depends on it: the `review.ran` band, the settle comment, the meter's review row.

## Goals / Non-Goals

**Goals:**

- A declared `unread` input costs no second reviewer and no second skeptic.
- A record whose only gap is `unread` inputs gets an answer that reads as an answer, not as a broken record.
- A re-run that is still warranted reads only what it must.

**Non-Goals:**

- Changing what makes a proof hold. `computeProof` is not edited.
- Changing a cap. `maxProofReruns` stays at its published value.
- The fix round's whole-PR re-review, the loop's scale line, and how answers reach the session. Those are the two sibling briefs.
- Deciding whether some `unread` entries should stop counting against the proof. See Open Questions.

## Decisions

### D1 — No `unread` entry names a re-run

`rerunTargets` returns the unproven dimensions and the uncited target, in the order they ran. It no longer reads `proof.unread`.

Why: in seven recorded passes every re-run was asked for `unread` entries alone, and none made the proof hold. A fresh reviewer under the same brief closes a few entries and declares others.

Alternatives considered:

- *A reviewer-declared `kind` on each entry, with only a `skipped` kind re-run.* Rejected. A model's label would decide whether a spawn happens, and most dimensions on the dial pass would still carry one entry of the other kind.
- *Lower `maxProofReruns` to 0.* Rejected. It would also stop the re-run of a dimension that returned no ledger, which is the failure the proof exists for.

The case this gives up is a reviewer that skipped a changed source file and said so. If no other dimension cited that file, it is still re-run for, through `uncited`.

### D2 — A declared `unread` input still fails the proof

`computeProof`, `gapLines` and `proof.unread` are untouched. `proof.proven` stays false, `review.ran` stays amber, and the settle comment still ends with its `REVIEW NOT PROVEN:` line.

### D3 — An unread-only record answers `PROOF LEFT UNREAD: <dimensions>` and exits 0

`proofAnswer` checks in this order:

1. The proof holds: `proven`, exit 0.
2. The re-run list is not empty: `re-run: <list>` and exit 1 under the cap, `PROOF CAP REACHED: <list>` and exit 0 at it.
3. The re-run list is empty, `proof.unread` is not, and the proof's reason is not `no diff given` or `no dimension ran` (a proof that carries no reason, as an older or hand-made record may, takes this step): `PROOF LEFT UNREAD: <dimensions with unread entries>`, exit 0.
4. Otherwise exit 2, as today.

The reason lines follow the first line in every answer for a proof that does not hold, so step 2 still lists the `unread` entries of dimensions it does not name.

Step 3 does not read `proof.reruns`. After a re-run for an unproven dimension, a draft left with `unread` entries alone answers `PROOF LEFT UNREAD`, not `PROOF CAP REACHED`: the cap stopped nothing.

Alternative considered: let the unread-only record fall to exit 2. Rejected. The skill prints exit 2 as `PROOF UNANSWERED`, which reads as a record the CLI could not judge.

### D7 — A record with no diff still exits 2

When the proof's reason is `no diff given` or `no dimension ran`, `unread` entries are not the only gap: the proof was never computed against a diff. That record keeps the exit 2 answer and its message.

### D4 — A warranted re-run is narrowed through `--rerun-of` on the dimension brief

`interlock review brief --dimension <name> … --rerun-of <draft>` reads the draft's proof and prints one of three things:

| the draft's proof says | the brief prints |
|---|---|
| `<name>` is unproven | the whole prompt, byte for byte what it prints without the flag |
| `<name>` is on the re-run list for uncited files alone | a prompt whose scope and must-cite list hold only the uncited files |
| `<name>` is not on the re-run list | nothing; exit 1 with the reason on standard error |

The narrowed prompt is built by the same `assembleDimensionPrompt`. `briefDimension` filters `changed` to the draft's `proof.uncited` paths and passes a flag that adds one `RE-RUN FOR UNCITED FILES:` line to the scope block. `changedSources` is the same filtered list. Nothing else in the prompt changes.

When none of the draft's uncited files is in the changed list the brief computed, there is nothing to scope to. The brief exits 1 and says so. That list is git's diff of `<base>...HEAD` unioned with `--changed` (`lib/review-cli.mjs:289-298`, `lib/review-scope.mjs:24-25`), so leaving a file out of `--changed` does not take it out of the list while git's diff still names it.

The brief does not read the cap. `proofAnswer` is the one place that counts re-runs, and the skill asks for a re-run prompt only after the proof line exits 1.

Alternative considered: a separate `interlock review brief --rerun` subcommand. Rejected. `--rerun-of <draft>` is already the flag the skeptics brief and the merge take, and it means the same thing in all three.

### D8 — The re-run brief refuses a dimension the draft names no re-run for

Printing the whole prompt for such a dimension would rebuild the leak from one skill slip. Printing nothing with exit 0 would be a silent fall-back. Exit 1 with the reason is the spoken form. The same answer covers a file that does not parse and a record that carries no `proof`. A promoted record carries a proof, so it is read as a draft would be.

### D9 — The narrowed prompt keeps its first line

The prompt opens with the bundled rubric, whose first line is `# Dimension: <name>`. The new line goes inside the scope block, after the rubric. The settle meter therefore attributes a narrowed re-run to its dimension as it does the first pass, and no meter code changes.

### D10 — A dimension that is both unproven and the uncited target gets the whole prompt

Nothing of an unproven dimension is covered, so there is no first-pass ledger to keep. It is re-run whole and its ledger is replaced.

### D11 — `interlock review --rerun-of` replaces the ledger of an unproven dimension only

`mergeRerun` builds its replace set from `proof.unproven` alone. Every other dimension a re-run names keeps its first ledger and gains the re-run's `checked` and `unread` entries.

Two consequences:

- A re-run narrowed to the uncited files cannot drop the first pass's `checked` entries for the rest of the diff.
- A hand-run re-run of a dimension that only had `unread` entries does not clear them. The CLI cannot match a re-run's ledger to the entry it would close, and a clean re-run erasing a declared gap is the outcome D2 rules out.

The `--rerun-of` write stays ungated: it merges whatever answers it is given, as today (`lib/review-cli.mjs:172`).

### D5 — `maxProofReruns` does not change

Only its comment in `lib/limits.mjs` changes, to say which gaps the count applies to.

### D6 — One change of an epic of three

This change is the proof re-run. The siblings are `re-review-only-the-fix-round` and `say-the-review-loop-scale-up-front`. Their explore briefs are in `.claude/handoff/`, timestamp `20261111-172434`. No sibling depends on this change's code.

### The skill's prose

`skills/review-code/SKILL.md` §3 changes in three places:

- On exit 1 it prints the `re-run:` line before it spawns anything, so the person sees what is about to run.
- Each re-run's prompt comes from `interlock review brief --dimension <name> … --rerun-of <draft>`. When that line exits 1, the skill prints `RE-RUN REFUSED: <its standard-error line>` and spawns nothing for that dimension.
- When no dimension the `re-run:` line named got a prompt, there is no re-run answer to write, so `proof.reruns` would not move and the proof line would print the same `re-run:` line again. The skill does not run the proof line again; it promotes the last draft, as it does after an exit 2. When at least one dimension got a prompt, the loop goes on as before and the CLI's count bounds it.
- The exit-0 answers it promotes on are `proven`, `PROOF CAP REACHED: <dimensions>` and `PROOF LEFT UNREAD: <dimensions>`. It prints the last two.

`skills/settle/SKILL.md` runs no proof line. Its one sentence on a record left unproven gains the `unread` case.

Each new instruction is pinned in `test/skills.test.mjs` by token: `PROOF LEFT UNREAD`, `RE-RUN REFUSED`, and a fenced `interlock review brief --dimension` line that carries `--rerun-of <draft>`.

## Risks / Trade-offs

- [A reviewer that skims and declares it is no longer re-run] → The gap stays on the record and in the comment. A changed source file nobody cited is still re-run for.
- [The uncited-only path has never been observed: all seven recorded passes had 0 uncited files] → It is specified from the code and covered by fixtures, not by a recorded pass. The first real pass that takes it should be read.
- [A record carries fewer findings than before, because the second set of reviewers no longer runs] → Intended. On the recorded passes the second set roughly doubled the survivors without closing the proof.
- [`proof.proven` is rarely reachable while reviewers declare structural `unread` entries, so `review.ran` reads amber on most passes] → Unchanged by this change, and now visible on the first proof call instead of after a re-run.
- [An older skill with a newer CLI] → The old prose loops while the proof line exits 1 and promotes on exit 0. `PROOF LEFT UNREAD` exits 0, so it promotes; it does not print the line. A newer skill with an older CLI passes `--rerun-of` to a brief that does not read it and gets the whole prompt, which is today's behaviour.
- [To undo] → Revert the commit. No stored record changes shape: `proof` keeps its fields, and a draft written before this change answers under the new rules.

## Open Questions

- Should an `unread` entry of a structural kind (a brief limit, another dimension's remit, an outside system) stop counting against the proof? That is a policy question about `review.ran`, and this change does not open it. Answering it later changes neither these specs nor these tasks.
