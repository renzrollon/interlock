---
type: file_exists
path: openspec/changes/collapse-singleton-waves/advisor.md
weight: 1
---

The consult's deterministic floor: `interlock advisor --check` renders
`openspec/changes/collapse-singleton-waves/advisor.md`, whether the consult drafted questions or did not run.
The harness counts only files created during the run, which the CLI-written
file is. Absent, the run either was not seeded (no --scaffold) or never reached
the check line.
