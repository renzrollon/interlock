// SessionStart hook: hand one saved plugin option to the session's commands.
//
// Run as `node hooks/notify-option.mjs <topic|url> <value>`, where the value is
// what the manifest wrote as an option reference and the host substituted.
//
// WHY IT EXISTS. The host gives a plugin option to hook processes only. The
// command that pushes when a ship run stops (`interlock run close --notify`,
// `interlock notify`) is run through the Bash tool or by `interlock-run`, and
// is not a hook. The session's environment file is the host's channel between
// a hook and those commands, so this hook appends one `export` of the matching
// variable there, and `lib/notify.mjs` reads that variable and nothing else.
//
// WHY ONE HOOK TO AN OPTION. The host does not run a hook whose arguments name
// an option with no saved value, and prints nothing about it (probed on Claude
// Code 2.1.296 and 2.1.161; clear-the-plugin-directory-holds design D4). So
// the reference cannot sit in the preflight's entry, which must run for
// everyone, and the topic and the server cannot share an entry, or a person
// who saved a topic and left the server alone would have neither exported.
// Each entry exists, for the host, only when the person saved that option.
//
// WHAT IT NEVER DOES. It prints nothing to standard output, because a
// session-start hook's output becomes context and the topic is a capability.
// It exits 0 on every path. It leaves a variable the operator already provided
// as it is. It writes nothing for a value that is empty, that carries a line
// break or a NUL, or that still reads as a reference nobody substituted. It
// never judges the value's shape: `readNotifyConfig` does that where the value
// is used, and names the variable without the value.

import { appendFileSync } from 'node:fs'

/** The variable each kind of option is exported as. */
const VARIABLES = new Map([
  ['topic', 'INTERLOCK_NTFY_TOPIC'],
  ['url', 'INTERLOCK_NTFY_URL']
])

/** How a reference the host passed through as written begins. */
const UNSUBSTITUTED = '${user_config.'

/** A single-quoted shell word. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** A value worth exporting: text, not blank, on one line, and not a reference left as written. */
function publishable(value) {
  return typeof value === 'string' && value.trim() !== '' && !/[\0\r\n]/.test(value) && !value.includes(UNSUBSTITUTED)
}

/** A variable the operator's own environment already carries. */
function provided(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== ''
}

let variable
try {
  const [kind, value] = process.argv.slice(2)
  variable = VARIABLES.get(kind)
  const file = process.env.CLAUDE_ENV_FILE
  if (variable && publishable(value) && typeof file === 'string' && file && !provided(variable)) {
    // One short line in a single write: the other option's hook appends beside this one.
    appendFileSync(file, `export ${variable}=${shellQuote(value.trim())}\n`)
  }
} catch (err) {
  const reason = String((err && err.message) || err).replace(/\s+/g, ' ')
  process.stderr.write(`interlock notify option: ${variable || 'the option'} was not exported (ignored): ${reason}\n`)
}
process.exit(0)
