---
type: tool_used
tool: Bash
input_match: interlock advisor .* --check
min: 1
weight: 1
---

The CLI bracket that owns the file: `interlock advisor "label-and-harden-the-merge-verdict" --check
<draft> --json`, or its `--check --failed` form. A run that drafted
questions in its own prose and wrote advisor.md with the Write tool never runs
this line and fails here, whatever the judged graders say.
