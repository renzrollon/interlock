---
type: llm
criteria: |
  The response moves to IMPLEMENT the already-reviewed, ready change — shipping
  it from tasks toward a commit (invoking or launching the ship workflow, or
  clearly proceeding to execute the tasks). It does NOT propose to re-specify,
  re-plan, or re-draft the change's proposal/design/specs as if it were new or
  unreviewed. A response that ships/implements passes; a response that starts a
  fresh specification or proposal pass fails.
weight: 1
---

The scored dimension. The skill-invocation graders are indicators (with-only),
so the case's actual score rests on the outcome: did the agent treat a
reviewed-and-ready change as something to implement, or as something to
re-specify? That is a judgement about intent that no single tool call or pattern
captures cleanly — the agent might reach the right outcome via dispatch, or
narrate it — so it is expressed as a judged grader, and the case is not `smoke`.
