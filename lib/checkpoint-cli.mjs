// The `interlock checkpoint <change>` subcommand: the spec checkpoint's card,
// printed from the change's own files (make-the-run-surfaces-interactive, spec
// spec/checkpoint-card, design D14, D24).
//
// The card itself is `lib/checkpoint-card.mjs`, the same renderer the spec pane
// draws. This module only gathers its fields through the readers the CLI already
// has: the change's artifacts, the ledger audit, the validate result, and the
// newest review-artifacts findings file with the gate's reading of it.
//
// It writes nothing and starts no process. The gate's reading calls
// `evaluateGate`, never the `--metrics` path, so no corpus line is appended.
//
// The entry file's own output and exit helpers come in as `io` (`emit`,
// `requireChange`), so stdout and exit codes stay exactly the CLI's.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { formatInspection, inspectChange } from './artifacts.mjs'
import { checkpointCard } from './checkpoint-card.mjs'
import { carriesFindingsList, evaluateGate } from './findings.mjs'
import { formatLedger, readLedger } from './ledger.mjs'

const METRICS_DIR = join('.claude', 'metrics')

/** `a-b` as a literal inside a pattern. */
const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The repo-relative path of the newest `review-artifacts-<change>-<stamp>.json`
 * under `.claude/metrics/`, or null. The stamp is `YYYYMMDD-HHMMSS`, so the
 * newest sorts last; a longer change name that merely starts with this one does
 * not match. An unreadable directory reads as no file.
 */
export function newestFindingsFile(root, change) {
  const dir = join(root, METRICS_DIR)
  let entries
  try {
    entries = existsSync(dir) ? readdirSync(dir) : []
  } catch {
    return null
  }
  const pattern = new RegExp(`^review-artifacts-${literal(change)}-\\d{8}-\\d{6}\\.json$`)
  const found = entries.filter(name => pattern.test(name)).sort()
  return found.length ? join(METRICS_DIR, found[found.length - 1]).split('\\').join('/') : null
}

/** The gate's reading of one findings file, as a whole card line. */
function gateLine(root, findings) {
  if (!findings) return 'gate: no findings file is recorded under .claude/metrics/'
  let input
  try {
    input = JSON.parse(readFileSync(join(root, findings), 'utf8'))
  } catch (err) {
    return `gate: ${findings} was not read (${(err && err.message) || String(err)})`
  }
  if (!carriesFindingsList(input)) return `gate: ${findings} carries no findings list`
  const r = evaluateGate(input)
  const { blocker, warning, suggestion } = r.counts
  return `gate: ${r.passed ? 'passed' : 'blocked'} · blocker ${blocker} · warning ${warning} · suggestion ${suggestion} · malformed ${r.malformed.length}`
}

/** One line of text; whitespace collapsed. */
const oneLine = text => String(text).replace(/\s+/g, ' ').trim()

/**
 * The fields `checkpointCard` renders, for a change that resolved. Reads files
 * and writes none.
 *
 * @returns {{change: string, artifacts: Array<{id: string, path: string, status: string}>,
 *   ledger: string, ledgerRows: Array<{id: string, question: string}>,
 *   validate: string, gate: string, findings: string|null}}
 */
export function checkpointFields(root, change) {
  const inspected = inspectChange(root, change)
  const base = `openspec/changes/${change}`
  const statusOf = file => (inspected.present.includes(file) ? 'present' : 'missing')
  const artifacts = [
    { id: 'proposal', path: `${base}/proposal.md`, status: statusOf('proposal.md') },
    { id: 'design', path: `${base}/design.md`, status: statusOf('design.md') },
    { id: 'tasks', path: `${base}/tasks.md`, status: statusOf('tasks.md') },
    { id: 'specs', path: `${base}/specs/`, status: inspected.specFiles.length ? 'present' : 'missing' }
  ]

  const parsed = readLedger(root, change)
  const needsHuman = (parsed.rows || []).filter(r => r.valid && r.class === 'needs_human')
  const ledger = `ledger: ${oneLine(formatLedger(parsed).split('\n')[0])}`
  const ledgerRows = needsHuman.map(r => ({ id: r.id, question: oneLine(r.question || '') }))

  const problems = inspected.problems.map(oneLine).filter(Boolean)
  const validate = `validate: ${oneLine(formatInspection(inspected).split('\n')[0])}${
    problems.length ? ` · ${problems.length} problem(s): ${problems.join('; ')}` : ''
  }`

  const findings = newestFindingsFile(root, change)
  return { change, artifacts, ledger, ledgerRows, validate, gate: gateLine(root, findings), findings }
}

/**
 * `interlock checkpoint [<change>] [--json]`. Exit 0 when the change resolves,
 * whatever the card says: the verb reports the checkpoint and gates nothing. A
 * change that does not resolve exits 1 through `io.requireChange`, naming the
 * open changes.
 */
export function checkpointCommand(io, root, positional, flags, json) {
  const requested = typeof flags.change === 'string' && flags.change.trim() ? flags.change.trim() : positional[1]
  const change = io.requireChange(root, requested, json)
  const fields = checkpointFields(root, change)
  io.emit(json, fields, checkpointCard(fields).map(line => line.text).join('\n') + '\n')
}
