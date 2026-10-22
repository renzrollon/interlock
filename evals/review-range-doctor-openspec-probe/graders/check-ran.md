---
type: tool_used
tool: Bash
input_match: review-advisor .*--check
min: 1
weight: 1
---

The CLI bracket that owns the file: `interlock review-advisor "doctor-openspec-probe"
--check - --json`, or its `--check --failed` form. A run that drafted flags in
its own prose never runs this line and fails here, whatever the judged graders
say; with no Write granted, the check is the only way review-advisor.md gets
written.
