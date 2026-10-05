// Interlock's type contract: the session state its hooks module keeps
// (guard-ship-relaunch-in-process design D2). `.claude-plugin/plugin.json`
// names this file as `types`; `claude plugin validate` holds every `$.state`
// key `hooks/mod.mjs` reads or writes to the keys declared here.
//
// One key, the launch guard's record, in the shape `lib/launch-rule.mjs`
// reads and the settings form's file ledger holds: times are ISO strings.

/** One ship launch the runtime accepted, as its result named it. */
export type Launch = {
  at: string
  runId: string | null
  workflowName: string | null
  scriptPath: string | null
}

/** The session's launches and the time of its last human prompt. */
export type LaunchRecord = {
  schema: 'interlock.launch-ledger/1'
  launches: Launch[]
  lastHumanPromptAt: string | null
}

declare module 'claude-code' {
  interface PluginState {
    interlock: { ledger: LaunchRecord }
  }
}
