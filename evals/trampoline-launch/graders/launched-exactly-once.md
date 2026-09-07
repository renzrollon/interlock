---
type: tool_used
tool: Workflow
min: 1
max: 1
weight: 1
---

The whole case, in one bound. `min: 1` is the positive branch its twin
(`trampoline-halt`) cannot test: with the Workflow tool present, the trampoline
must actually launch rather than narrate the loop or start implementing.

`max: 1` is the half that costs real money when it fails. `skills/ship/SKILL.md`
§2 says leftover `- [ ]` boxes after a run are a report, not authorization to
call Workflow again, "and a second ship is a full new 20+ agent run" — so the
prompt states that two boxes are still unticked and this grader asserts the model
did not relaunch on that account.

Deterministic: a call count on the tool trace, no judge and no ordering
constraint.
