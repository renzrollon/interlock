// The checkpoint consult's spawn as it crossed a hooks module on Claude Code
// 2.1.306, captured headless by scripts/advisor-e2e.mjs on 2026-10-21: the one Agent call the
// spec skill's step 5a makes, typed interlock:advisor, and what the engine
// resolved for it. The spec meter's consult counter keys on exactly these two
// fields (hooks/mod.mjs noteSpawn): the subagentType and a string model.
//
// An importable module rather than JSON because `claude plugin test` runs the
// mod's tests with no filesystem. The scrubbed capture is
// agent-spawn-advisor.json beside this file; test/spine/mod-pins.test.mjs pins
// that the two are the same.

/** agent-spawn-advisor.json */
export const SPAWN_ADVISOR = {
  "input": {
    "tool_use_id": "toolu_01Jv44Xt4JWC7EGVHFSrDqoT",
    "prompt": ".claude/metrics/advisor-brief-collapse-singleton-waves-20261021-064310.md",
    "description": "Checkpoint advisor consult",
    "subagentType": "interlock:advisor",
    "provider": {
      "plugin": "interlock@inline",
      "tier": "user"
    },
    "parentModel": "claude-opus-5-5",
    "permissionMode": "auto",
    "background": false,
    "fork": false
  },
  "resolved": {
    "model": "claude-opus-5-5",
    "agentId": "a29c139c8cc08a85c"
  }
}
