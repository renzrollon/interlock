// `interlock review-policy suggest [--all] [--summary] [--json]` (change
// `scope-suggest-and-evaluate-the-artifact-gate`, spec `review/policy-suggestions`,
// design §4): the I/O half. It reads the git window, the compound notes, the
// review-metrics records joined to their findings files, the archived decision
// ledgers and `REVIEW.md` at HEAD, hands them to the pure `review-policy-suggest`
// module with the published caps, and prints the answer.
//
// It writes nothing and exits 0 whatever it finds; a source it cannot read is
// said on that source's status line, never dropped quietly. The entry file's
// own `emit` and the helpers `reviewIo` already carries come in as `io`, plus
// `home`, the corpus home `interlock report` reads the records from.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { LIMITS } from './limits.mjs'
import { parseLedger } from './ledger.mjs'
import { METRICS_DIR, REVIEW_METRICS_SCHEMA } from './metrics.mjs'
import { NOTES_PATH, parseNotes } from './notes.mjs'
import { formatSuggest, suggestPolicy, summaryLine } from './review-policy-suggest.mjs'

const ARCHIVE_DIR = join('openspec', 'changes', 'archive')
const ARCHIVE_NAME = /^(\d{4}-\d{2}-\d{2})-(.+)$/

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const stringOrNull = v => (typeof v === 'string' && v !== '' ? v : null)

/** `{ since: {day, time}, commit }` from the newest commit at HEAD touching REVIEW.md, or `{}`. */
function windowOf(io, root) {
  try {
    const out = io.gitText(root, ['log', '-1', '--format=%H%x09%cI', 'HEAD', '--', 'REVIEW.md']).trim()
    const [commit, time] = out.split('\t')
    if (!commit || !time || !/^\d{4}-\d{2}-\d{2}/.test(time)) return {}
    return { since: { day: time.slice(0, 10), time }, commit }
  } catch {
    return {}
  }
}

/** The parsed notes table, or `null` when it is absent or unreadable. */
function readNotes(root) {
  let text
  try {
    text = readFileSync(join(root, NOTES_PATH), 'utf8')
  } catch {
    return null
  }
  const table = parseNotes(text)
  if (!table.parseable) return null
  return { rows: table.rows, problems: Array.isArray(table.problems) ? table.problems.length : 0 }
}

/** Every archived change's ledger, dated by the directory name. `dirExists` is false when no archive is there. */
function readLedgers(root) {
  const dir = join(root, ARCHIVE_DIR)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return { ledgers: [], dirExists: false }
  }
  const ledgers = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const named = entry.isDirectory() ? ARCHIVE_NAME.exec(entry.name) : null
    if (!named) continue
    try {
      const parsed = parseLedger(readFileSync(join(dir, entry.name, 'decisions.md'), 'utf8'))
      ledgers.push({ date: named[1], change: named[2], rows: parsed.rows })
    } catch {
      // A change with no ledger, or one that does not read, has no rows to cite.
    }
  }
  return { ledgers, dirExists: true }
}

/**
 * The artifact-stage records under `home`, each joined to the findings file it
 * names. A record naming none, or one that cannot be read, is counted and never
 * joined another way.
 */
function readGates(root, home) {
  const dir = join(home, METRICS_DIR)
  const out = { gates: [], noFindings: 0, unreadable: 0, dirExists: existsSync(dir) }
  let names
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json')).sort()
  } catch {
    return out
  }
  for (const name of names) {
    let record
    try {
      record = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      continue
    }
    if (!isObject(record) || record.schema !== REVIEW_METRICS_SCHEMA || record.stage !== 'artifacts') continue
    const named = stringOrNull(record.findings)
    if (!named) {
      out.noFindings++
      continue
    }
    const abs = isAbsolute(named) ? resolve(named) : resolve(root, named)
    const rel = relative(resolve(root), abs)
    let content
    try {
      if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('outside the root')
      content = JSON.parse(readFileSync(abs, 'utf8'))
    } catch {
      out.unreadable++
      continue
    }
    out.gates.push({
      change: stringOrNull(record.change) ?? 'unnamed',
      timestamp: stringOrNull(record.timestamp),
      depth: stringOrNull(record.depth),
      reviewer: stringOrNull(record.reviewer),
      findings: named,
      content
    })
  }
  return out
}

/** The Artifact Checks at HEAD, or `null` (no commit, no REVIEW.md there, or it carries none). */
function readChecks(io, root) {
  if (!io.headShaOf(root)) return null
  try {
    const checks = io.reviewPolicyAt(root, 'HEAD').policy.artifactChecks
    return Array.isArray(checks) && checks.length ? checks : null
  } catch {
    return null
  }
}

export function reviewPolicySuggestCommand(io, root, flags, json) {
  const win = windowOf(io, root)
  const notes = readNotes(root)
  const { ledgers, dirExists: archived } = readLedgers(root)
  const joined = readGates(root, io.home)

  const result = suggestPolicy({
    window: { all: flags.all === true, ...win },
    notes,
    gates: joined.gates,
    ledgers,
    checks: readChecks(io, root),
    caps: {
      minSuggestChanges: LIMITS.minSuggestChanges,
      staleCheckGates: LIMITS.staleCheckGates,
      maxArtifactChecks: LIMITS.maxArtifactChecks
    },
    unjoined: { noFindings: joined.noFindings, unreadable: joined.unreadable }
  })
  // A source that is not there at all says so, rather than reading as an empty one.
  if (!archived) result.sources.ledgers = `${ARCHIVE_DIR.split(sep).join('/')}: absent, so T4 read nothing`
  if (!joined.dirExists) result.sources.records = `${METRICS_DIR.split(sep).join('/')}: absent, so T2 and T3 read no record`

  if (json) io.emit(true, result, '')
  else if (flags.summary === true) {
    const line = summaryLine(result)
    if (line) io.emit(false, result, line + '\n')
  } else io.emit(false, result, formatSuggest(result))
}
