---
type: llm
criteria: |
  The response RECONNOITRES the question asked — it investigates how model
  credentials are handled in this codebase and works toward an answer about the
  blast radius (naming files, tracing readers, or launching a reconnaissance
  that will do so). It does NOT stop at building or refreshing a codebase index
  as the deliverable: a response whose substance is "I have built/indexed the
  knowledge graph" — reporting the index, its node counts, or where it was
  written, without going on to answer what was asked — fails.
  Using the graph as a means to locate is fine and expected; delivering the
  graph in place of the exploration is the failure.
weight: 1
---

The scored dimension, and the reason this case needs a judge rather than a tool
bound. The skill-invocation graders beside it are `arm: with-only` indicators, so
the score rests on the outcome: did the request reach reconnaissance, or stop at
index-building?

The part that could not be expressed deterministically is exactly the boundary
between the two destinations. `skills/explore/SKILL.md:37-45` tells `explore` to
run `interlock-graph query` / `consumers` / `path`, and to build the graph once
when it is missing — so `interlock-graph` in the tool trace is consistent with
`explore` doing its job AND with `graph` doing its job, and no `tool_used` bound
separates them. What separates them is whether the reply answers the question or
delivers an index, which is a judgement about the response, not a pattern, a tool
invocation, a file check, or an ordering constraint.

Its twin `skill-routing` expresses the mirror dimension the same way, for the
same reason. This case is therefore not tagged `smoke`, and this grader is named
in `evals/CALIBRATION-DEFERRALS.md` until a transcript exists to label.
