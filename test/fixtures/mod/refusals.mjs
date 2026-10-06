// What a settings hook's `PreToolUse` deny leaves in a hooks module's
// `tool.call` result, as captured on Claude Code 2.1.291
// (speak-permission-prompts-and-guard-denials task 1.1, probe 2): the call
// resolves errored, and its `text` is the hook's reason behind an engine
// prefix naming the event and the tool. No classic event crosses the module.
//
// An importable module rather than JSON because `claude plugin test` runs the
// mod's tests with no filesystem. The scrubbed capture is the JSON file beside
// this one; test/spine/mod-pins.test.mjs pins that the two are the same and
// that `denyText` rebuilds the captured text from its reason.

export const DENIED_BY_GUARD = {
  "command": "echo hi",
  "isError": true,
  "text": "PreToolUse:Bash hook error: guard-probe: PROBE-DENY-REACHED — the probe blocks every Bash call.",
  "result": "Error: PreToolUse:Bash hook error: guard-probe: PROBE-DENY-REACHED — the probe blocks every Bash call."
}

/** The text a settings hook's deny of `tool` with `reason` reaches a module's `tool.call` result as. */
export const denyText = (reason, tool = 'Bash') => `PreToolUse:${tool} hook error: ${reason}`
