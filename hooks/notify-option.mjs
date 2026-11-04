// SessionStart hook: hand the saved plugin options to the session's commands.
//
// Run as `node hooks/notify-option.mjs`, with no argument. The host exports each
// plugin option to hook processes as `CLAUDE_PLUGIN_OPTION_<KEY>` (plugins
// reference, "User configuration"), and this hook reads the two push options
// from there.
//
// WHY IT EXISTS. The host gives a plugin option to hook processes only. The
// command that pushes when a ship run stops (`interlock run close --notify`,
// `interlock notify`) is run through the Bash tool or by `interlock-run`, and
// is not a hook. The session's environment file is the host's channel between
// a hook and those commands, so this hook appends one `export` of the matching
// variable there, and `lib/notify.mjs` reads that variable and nothing else.
//
// WHY NOT AN ARGUMENT. The manifest could pass `${user_config.KEY}` in the
// hook's arguments, and 1.6.0 to 1.13.0 did. The plugin directory refuses a
// hook command holding any variable other than `${CLAUDE_PLUGIN_ROOT}` ("Command
// path can't be followed"), and its remedy is to read the value from the
// environment (change read-plugin-options-from-the-hook-environment). This file
// is the only shipped file that names the host's option variables; a pin in
// test/spine/package.test.mjs holds that.
//
// WHAT IT NEVER DOES. It prints nothing to standard output, because a
// session-start hook's output becomes context and the topic is a capability.
// It exits 0 on every path, including one where lib/session-env.mjs cannot be
// loaded (it is imported inside the try). It leaves a variable the operator
// already provided as it is. It writes nothing for a value that is empty, that
// carries a line break or a NUL, or that still reads as a reference nobody
// substituted. It never judges the value's shape: `readNotifyConfig` does that
// where the value is used, and names the variable without the value.

/** Each host option variable, and the variable it is exported as. */
const OPTIONS = [
  ['CLAUDE_PLUGIN_OPTION_NTFY_TOPIC', 'INTERLOCK_NTFY_TOPIC'],
  ['CLAUDE_PLUGIN_OPTION_NTFY_URL', 'INTERLOCK_NTFY_URL']
]

let appendExport
try {
  // Loaded inside the try, not at link time: a missing or broken module must
  // reach the stderr line below and exit 0, as the preflight's handoff does.
  // (The specifier is a literal: it resolves against this file, and the
  // import-closure pin in test/hooks.test.mjs reads it.)
  ;({ appendExport } = await import('../lib/session-env.mjs'))
} catch (err) {
  fail('the options', err)
}
if (appendExport) {
  for (const [option, variable] of OPTIONS) {
    // One option's failure does not cost the other its export.
    try {
      // The quoting, the publishable check and the operator's own value are
      // lib/session-env.mjs's, shared with the preflight's PATH handoff.
      appendExport(process.env.CLAUDE_ENV_FILE, variable, process.env[option], process.env)
    } catch (err) {
      fail(variable, err)
    }
  }
}
process.exit(0)

/** One stderr line naming what was not exported and why, never the value. */
function fail(what, err) {
  const reason = String((err && err.message) || err).replace(/\s+/g, ' ')
  process.stderr.write(`interlock notify option: ${what} was not exported (ignored): ${reason}\n`)
}
