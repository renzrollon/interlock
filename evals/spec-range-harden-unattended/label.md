# Spec Range label: spec-range-harden-unattended

change: harden-unattended-ship-runs
row: D6
source: openspec/changes/archive/2026-09-07-harden-unattended-ship-runs/decisions.md:10
question: Include the spec-checkpoint push (`skills/spec` §6 calls `interlock notify checkpoint <change>`, pinned in `test/skills.test.mjs`) in this change, or keep it ship-only?

The question a human had to answer for this change, copied from the archived
decision ledger. The fixture leaves that ledger out, so the advisor sees the
artifacts the human saw and not the answer. `graders/matches-label.md` judges
whether the rendered advisor.md asks this question or one whose answer would
settle it.
