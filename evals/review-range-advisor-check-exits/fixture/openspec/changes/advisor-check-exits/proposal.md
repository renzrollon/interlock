## Why

The spec flow ends at a human checkpoint, and nothing reads the whole change as the person about to review it would. A stronger-model consult at that checkpoint can name the product question no artifact answers yet. The consult is advice: the spec run must reach the checkpoint whether or not it ran, so a consult that fails is written down as one that did not run rather than stopping the run.

## What Changes

- `interlock advisor <change> --brief` assembles a bounded brief from the change folder and the review's findings, under `.claude/metrics/`.
- `interlock advisor <change> --check <draft|->` validates the consult's JSON draft by code against caps and a closed enum, and renders `openspec/changes/<change>/advisor.md`. It is advice, never a gate.
- `interlock advisor <change> --check --failed "<reason>"` writes `advisor.md` as a consult that did not run.
- `interlock advisor --verdict` tallies the Spec Range human labels into `KEEP`, `KILL` or `INSUFFICIENT LABELS`.
- The diff under review is `bin/interlock`, where the three lines dispatch to `advisorBrief`, `advisorCheck` and `advisorVerdict`.

## Impact

- `bin/interlock`: the `advisor` case in `main` and the three handlers.
