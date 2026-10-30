// Lines a SessionStart hook appends to the session's environment file.
//
// The host runs that file as shell code before each later Bash command
// (`CLAUDE_ENV_FILE`), so it is the one channel from a hook to the commands a
// session runs. Two hooks write to it: `hooks/notify-option.mjs` exports a
// saved plugin option, and `hooks/preflight.mjs` extends PATH with the plugin's
// `cli/` and the provisioned OpenSpec directory, and exports the plugin's data
// directory (spec: hooks/session-preflight; design "The preflight hands the
// session its PATH").
//
// Every value is written single-quoted, and a value holding a line break or a
// NUL is never written: one such byte would let a value add a line of its own
// to a file the shell runs. Nothing here prints, because a session-start hook's
// output becomes context. A failed write throws to the caller, which says so in
// one stderr line and still exits 0.
//
// It imports `node:fs` and nothing else, so a hook that uses it still makes no
// request of its own.

import { appendFileSync, readFileSync } from 'node:fs'

/** How a plugin-option reference the host passed through as written begins. */
const UNSUBSTITUTED = '${user_config.'

/** A single-quoted shell word. */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** A value worth exporting: text, not blank, on one line, and not a reference left as written. */
export function publishable(value) {
  return typeof value === 'string' && value.trim() !== '' && !/[\0\r\n]/.test(value) && !value.includes(UNSUBSTITUTED)
}

/** A variable the operator's own environment already carries. */
export function provided(name, env = process.env) {
  const value = env ? env[name] : undefined
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Append `export NAME='value'` to `file`, unless there is no file, the value is
 * not publishable, or `env` already carries the variable. The value is trimmed.
 * Throws when the append fails.
 *
 * @returns {boolean} whether a line was written
 */
export function appendExport(file, name, value, env = process.env) {
  if (typeof file !== 'string' || !file) return false
  if (!publishable(value) || provided(name, env)) return false
  // One short line in a single write: another hook may append beside this one.
  appendFileSync(file, `export ${name}=${shellQuote(value.trim())}\n`)
  return true
}

/**
 * A PATH entry as the session's shell reads it. On win32 that shell is Git
 * Bash, which reads `C:\x` as two entries at the drive's colon, so a drive path
 * is written in its `/c/x` form (unprobed, as the plugin's `bin/` on Windows was).
 */
export function shellPathEntry(entry, platform = process.platform) {
  if (platform !== 'win32') return entry
  const drive = /^([A-Za-z]):[\\/]?/.exec(entry)
  const rest = drive ? entry.slice(drive[0].length) : entry
  const posix = rest.replace(/\\/g, '/')
  return drive ? `/${drive[1].toLowerCase()}/${posix}` : posix
}

/** An entry PATH can carry as one entry: text, not blank, no line break, no NUL, no delimiter. */
function carriable(entry) {
  return typeof entry === 'string' && entry.trim() !== '' && !/[\0\r\n:]/.test(entry)
}

/**
 * Append `export PATH="$PATH":'<entry>':…` to `file`: after the PATH the
 * session already has, never before it, so a user's own command of the same
 * name still runs first. An entry holding a line break or a NUL, or one PATH
 * cannot carry as a single entry, is dropped and counted. The line is not
 * appended when the file already holds it, so a second session start in the
 * same session writes nothing. Throws when the file cannot be read for a
 * reason other than its absence, or cannot be appended to.
 *
 * @param {string|undefined} file
 * @param {string[]} entries
 * @param {string} [platform]
 * @returns {{ written: boolean, line: string|null, dropped: number }}
 */
export function appendPath(file, entries, platform = process.platform) {
  const kept = []
  let dropped = 0
  for (const raw of Array.isArray(entries) ? entries : []) {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) {
      dropped++
      continue
    }
    const entry = shellPathEntry(raw, platform)
    if (!carriable(entry)) dropped++
    else kept.push(entry)
  }
  if (!kept.length) return { written: false, line: null, dropped }
  const line = `export PATH="$PATH":${kept.map(shellQuote).join(':')}`
  if (typeof file !== 'string' || !file) return { written: false, line, dropped }
  let existing = ''
  try {
    existing = readFileSync(file, 'utf8')
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err
  }
  if (existing.split(/\r?\n/).includes(line)) return { written: false, line, dropped }
  // A file that does not end in a line break would join this line to its last one.
  const lead = existing && !existing.endsWith('\n') ? '\n' : ''
  appendFileSync(file, `${lead}${line}\n`)
  return { written: true, line, dropped }
}
