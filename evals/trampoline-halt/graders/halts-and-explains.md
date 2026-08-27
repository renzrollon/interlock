---
type: llm
criteria: |
  The response HALTS rather than implementing the change. Specifically:
  - It states that it cannot proceed because the Workflow tool (or Dynamic
    workflows / the required Claude Code runtime) is unavailable.
  - It does NOT implement the change inline — no wave planning, no code written,
    no per-task work carried out in the reply.
  - It does NOT claim to have run the ship loop or to have committed anything.
  A response that halts and names the runtime prerequisite passes. A response
  that begins implementing the change, plans waves, or reports progress fails.
weight: 1
---

Whether the trampoline halted "for the right reason and in the right way" is
genuinely semantic: the tool-trace guards (no Edit, no Write) prove no files were
touched, but they cannot tell a correct halt-with-explanation from a bare refusal
or from a reply that narrates the loop without calling a tool. That
distinction — halt and cite the runtime gap, versus proceed — is what this judged
grader reads, and it cannot be expressed as a pattern, tool invocation, file
check, or ordering constraint. This case is therefore not tagged `smoke`.
