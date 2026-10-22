## Why

`/interlock:review-code` checks its findings in one direction only. Independent skeptics try to refute every blocker and warning, so a false positive rarely reaches the human. Nothing looks the other way: a real finding a skeptic dismissed on a weak citation, survivors that are one root cause reported three times, or a changed file no dimension actually read. Dismissed findings are never reported (§5 forbids it), so a wrong dismissal is invisible by construction. The checkpoint advisor (`spec/checkpoint-advisor`) already proved the shape for spec artifacts: a CLI-assembled brief, a read-only stronger model, a CLI-checked draft, and a file nobody gates on. This change puts that shape after the review gate, where the dismissals are.

The owner decided two things up front (2026-10-22): the consult is opt-in behind `--advisor`, and it ships with its own labelled eval cases, so it is measured from the first day rather than after the checkpoint advisor's verdict.

## What Changes

- **A brief written by the review itself.** `interlock review --advisor-brief <change>` writes `.claude/metrics/review-advisor-brief-<change>-<stamp>.md` and an id index beside it, from the resolved review it already holds:
  - survivors as `S<n>`
  - dismissed findings as `D<n>`, joined to their skeptic verdicts (reasoning, evidence, votes) from the raw `--verdicts` input
  - quality and policy drops
  - per-dimension counts
  - the changed-file list

  The brief is bookkeeping. A failed write warns and never changes the review's exit code.
- **A new read-only agent, `interlock:review-advisor`.** Spawned once by review-code's new consult step with the brief path. It replies with a JSON draft of flags.
- **`interlock review-advisor <change> --check -|<draft>|--failed "<reason>"`.** Reads the draft (from stdin, persisting it itself), validates each flag against a closed kind enum and the brief's index, caps the count, and renders `openspec/changes/<change>/review-advisor.md` with a `## Dropped` table, or a did-not-run stanza. It exits 0 whenever the change resolves. The three kinds:

  | kind | means | targets |
  |---|---|---|
  | `dismissal-doubt` | a dismissal to re-read | one `D<n>` |
  | `shared-root-cause` | survivors that are one cause | two or more `S<n>` |
  | `uncovered` | a changed file no dimension engaged | a path in the changed list |
- **Raise-only by construction.** The file revives no finding and is read by no gate: not `interlock gate`, `autonomy`, `note derive`, `ready`, `validate` or `merge-confidence`. Tests pin byte-identical decisions with and without it.
- **Review-code gains `--advisor` and a `## 4a.` consult step**, and §5 reports the flags or why the consult did not run.
- **Review Range: about six eval cases.** Each is seeded from a real `fix(...)` commit: the pre-fix files, the change folder, and a findings and verdicts pair in which the real bug was dismissed on a weak citation, beside decoys. Graders:
  - a deterministic floor that fails a run whose check did not draft
  - the spawn
  - the check line
  - two judged graders: did a flag reach the seeded dismissal, and did flags merely restate survivors

  `interlock review-advisor --verdict --labels <evals dir>` tallies the human labels into `KEEP`, `KILL` or `INSUFFICIENT LABELS`, always exiting 0.
- **Shared advisor helpers.** The generic parts of the checkpoint advisor (fence quoting, the omitted section, the cut-and-overrun loop, table rendering, the did-not-run stanza, positional ids with validate-then-cap) move into shared modules. The checkpoint advisor's output does not change. Its verdict tally learns a case prefix and grader names as parameters.

Out of scope: `/interlock:mr` (its merge-confidence step takes no other review file), the ship `--strict` review, and `/interlock:review-artifacts`.

## Capabilities

### New Capabilities

- `review/findings-advisor`: the review-code consult. The brief flag on `interlock review`, the agent, draft validation and rendering, the did-not-run path, the verdict tally, the skill step, and what no gate reads.
- `evals/review-range`: the fixture-seeded cases, their graders, labels and deferrals, and the kill-criterion data they produce.

### Modified Capabilities

None. The checkpoint advisor's behaviour, output and verdict are unchanged. Its helpers move, and its tally gains defaulted parameters.

## Impact

- **CLI** (`bin/interlock`):
  - one new flag on `review`
  - one new subcommand, `review-advisor`
  - new rows in `interlock limits`

  The file has about 8 KB of headroom under its size pin, so dispatch stays one line per branch and logic lives in a new `lib/review-advisor-cli.mjs`.
- **Pure modules** (`lib/`):
  - new `review-advisor.mjs`, `review-advisor-cli.mjs`, `advisor-kit.mjs`, and `prompts/brief-kit.mjs`, with `prompts/review-advisor.mjs` registered in `prompts/index.mjs`
  - edits to `advisor.mjs`, `prompts/advisor.mjs` (use the shared helpers), `review-core.mjs` (export a verdict-matching helper), and `limits.mjs`
- **Skills and agents:** `skills/review-code/SKILL.md` gains `--advisor`, §4a and a §5 line. New `agents/review-advisor.md`.
- **Evals:** new `evals/review-range-*/` cases with fixtures, a scaffold script each, graders and deferral rows.
- **Docs:** docs/07 (the subcommand and flag), docs/14 (Review Range), and the review-code reference in docs/10.
- **Tests:**
  - new `test/spine/review-advisor.test.mjs` and `test/spine/review-advisor-brief.test.mjs`
  - additions to the cli, skills, plugin-agents, evals, artifacts, limits, prompts and spec-meter suites

  No dependency is added.
