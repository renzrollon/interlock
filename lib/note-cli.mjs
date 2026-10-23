// The `interlock note` subcommand: the compound-notes table's CLI (add, derive,
// match), moved out of the advisor CLI module, which has since been removed.
//
// The entry file's own output and exit helpers come in as `io` — `emit`, `die`,
// `requireChange`, `readFindingsInput`, `splitPaths` — so stdout and exit codes
// stay exactly the CLI's.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { carriesFindingsList } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { NOTES_PATH, appendNotes, deriveNotes, matchNotes, parseNotes } from './notes.mjs'
import { specMentionedPaths } from './spec-text.mjs'

export const readOr = path => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The flat finding list of any shape `gate` accepts, or null when it carries none. */
export function findingsListOf(input) {
  if (!carriesFindingsList(input)) return null
  const list = Array.isArray(input) ? input : Array.isArray(input.surviving) ? input.surviving : input.findings
  return list.flatMap(f => (f && Array.isArray(f.findings) ? f.findings : [f]))
}

function noteWrite(io, root, rows, json) {
  let out
  try {
    out = appendNotes(root, rows)
  } catch (err) {
    const banner = `COMPOUND NOTES NOT WRITTEN: ${err.message}`
    io.emit(json, { appended: 0, skipped: 0, written: false, banner }, banner + '\n')
    if (json) process.stderr.write(banner + '\n')
    return
  }
  io.emit(json, out, `notes: appended ${out.appended}, skipped ${out.skipped} (${out.path})\n`)
}

export function noteCommand(io, root, positional, flags, json) {
  const sub = positional[1]
  const str = k => (typeof flags[k] === 'string' ? flags[k] : '')
  if (sub === 'add') {
    for (const k of ['change', 'file', 'surprise', 'rule']) if (!str(k).trim()) io.die(`note add requires --${k}`)
    noteWrite(io, root, [{ change: str('change'), file: str('file'), surprise: str('surprise'), rule: str('rule'), source: str('source') || 'manual' }], json)
  } else if (sub === 'derive') {
    const list = findingsListOf(io.readFindingsInput(flags.findings))
    if (!str('change').trim()) io.die('note derive requires --change <change>')
    noteWrite(io, root, deriveNotes(list, { change: str('change'), source: str('source') || 'review' }), json)
  } else if (sub === 'match') {
    if (!positional[2]) io.die('note match requires a change')
    const name = io.requireChange(root, positional[2], json)
    const text = readOr(join(root, NOTES_PATH))
    const table = text === undefined ? { parseable: true, rows: [] } : parseNotes(text)
    if (!table.parseable) io.die(`${NOTES_PATH}: ${table.problems.map(p => p.reason).join('; ')}`)
    const paths = [
      ...specMentionedPaths(readOr(join(root, 'openspec', 'changes', name, 'tasks.md')) ?? ''),
      ...(str('paths') ? io.splitPaths(str('paths')) : [])
    ]
    const m = matchNotes(table.rows, paths, LIMITS)
    // Malformed rows of a table that did parse: counted, so a row that never
    // reaches a match is said and not silently absent.
    const unreadable = Array.isArray(table.problems) ? table.problems.length : 0
    io.emit(json, { change: name, rows: m.rows, omitted: m.omitted, unreadable }, [
      ...m.rows.map(r => `${r.id} ${r.file} (${r.change}) — ${r.surprise} Rule: ${r.rule}`),
      ...(m.rows.length ? [] : ['(no notes matched)']),
      ...(m.omitted ? [`${m.omitted} more omitted (over the matched-notes cap)`] : []),
      ...(unreadable ? [`compound notes: ${unreadable} rows unreadable`] : [])
    ].join('\n') + '\n')
  } else {
    io.die(`unknown note subcommand: ${sub || '(none)'} — expected add|derive|match`)
  }
}
