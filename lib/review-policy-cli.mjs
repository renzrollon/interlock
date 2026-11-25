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

import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import { carriesFindingsList } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { parseLedger } from './ledger.mjs'
import { METRICS_DIR, REVIEW_METRICS_SCHEMA } from './metrics.mjs'
import { NOTES_PATH, parseNotes } from './notes.mjs'
import { readRepoFile } from './repo-file.mjs'
import { formatSuggest, suggestPolicy, summaryLine } from './review-policy-suggest.mjs'

const ARCHIVE_DIR = join('openspec', 'changes', 'archive')
const ARCHIVE_NAME = /^(\d{4}-\d{2}-\d{2})-(.+)$/

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const stringOrNull = v => (typeof v === 'string' && v !== '' ? v : null)
const codeOf = err => (err && typeof err.code === 'string' ? err.code : 'an error')

/**
 * The closed evidence window's test for a record's timestamp, or null when the
 * window is open (`--all`, or no commit touches REVIEW.md) or its own start does
 * not parse, so the pure module alone decides. Used to skip work: a record or a
 * ledger outside the window is never joined or read (PR #47 review, M6 and M9).
 */
function closedWindow(win, all) {
  if (all || !win.since) return null
  const start = Date.parse(win.since.time)
  if (Number.isNaN(start)) return null
  return {
    day: win.since.day,
    time: ts => {
      const t = typeof ts === 'string' ? Date.parse(ts) : NaN
      return !Number.isNaN(t) && t >= start
    }
  }
}

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

/**
 * The parsed notes table as `{ notes, problem }`: `notes` is null when the file
 * is absent or unusable, and `problem` says why when it is there but unusable.
 */
function readNotes(root) {
  const read = readRepoFile(root, NOTES_PATH)
  if (read.absent) return { notes: null, problem: null }
  if (!read.ok) return { notes: null, problem: read.reason }
  const table = parseNotes(read.text)
  if (!table.parseable) return { notes: null, problem: 'a table that does not parse' }
  return { notes: { rows: table.rows, problems: Array.isArray(table.problems) ? table.problems.length : 0 }, problem: null }
}

/**
 * Every archived change's ledger, dated by the directory name. `dirExists` is
 * false when no archive is there; `dirProblem` says why one that is there could
 * not be listed. Under a closed window an archive dated before it is not read
 * (`older`); a `decisions.md` that is there and does not read is `unreadable`.
 */
function readLedgers(root, win) {
  const dir = join(root, ARCHIVE_DIR)
  const out = { ledgers: [], dirExists: true, dirProblem: null, older: 0, unreadable: 0 }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ...out, dirExists: false }
    return { ...out, dirProblem: codeOf(err) }
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const named = entry.isDirectory() ? ARCHIVE_NAME.exec(entry.name) : null
    if (!named) continue
    if (win && named[1] < win.day) {
      out.older++
      continue
    }
    // A change with no ledger has no rows to cite; one that is there and does not read is counted.
    const read = readRepoFile(root, join(dir, entry.name, 'decisions.md'))
    if (read.absent) continue
    if (!read.ok) {
      out.unreadable++
      continue
    }
    try {
      out.ledgers.push({ date: named[1], change: named[2], rows: parseLedger(read.text).rows })
    } catch {
      out.unreadable++
    }
  }
  return out
}

/**
 * A findings file a record names, parsed, or null. The path is relative to the
 * root the gate ran in, which is this root or, from a linked worktree, the state
 * home the records live in (round-0 F-a45c2a5b): it is tried under each, and only
 * a file inside that root once its links are resolved is read. A file that is
 * not a findings list is null too, since `evaluateGate` would read anything else
 * as a clean pass (PR #47 review, H3).
 */
function readFindingsOf(named, roots, cache) {
  for (const root of roots) {
    const key = resolve(root, named)
    if (cache.has(key)) {
      if (cache.get(key) === undefined) continue
      return cache.get(key)
    }
    const read = readRepoFile(root, named)
    let content
    if (read.ok) {
      try {
        const parsed = JSON.parse(read.text)
        content = carriesFindingsList(parsed) ? parsed : null
      } catch {
        content = null
      }
    }
    // undefined: not there under this root, so the next one is tried; null: there and unusable.
    cache.set(key, read.ok ? content : read.absent ? undefined : null)
    if (read.ok) return content
  }
  return null
}

/**
 * The artifact-stage records under `home`, each joined to the findings file it
 * names. A record naming none, or one that cannot be read, is counted and never
 * joined another way. Under a closed window a record dated outside it is neither
 * joined nor counted; a record file that does not parse is counted in `corrupt`.
 */
function readGates(root, home, win) {
  const dir = join(home, METRICS_DIR)
  const out = { gates: [], noFindings: 0, unreadable: 0, corrupt: 0, dirProblem: null, dirExists: existsSync(dir) }
  let names
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json')).sort()
  } catch (err) {
    if (out.dirExists) out.dirProblem = codeOf(err)
    return out
  }
  const roots = [...new Set([resolve(root), resolve(home)])]
  const cache = new Map()
  for (const name of names) {
    const file = readRepoFile(home, join(dir, name))
    let record
    try {
      if (!file.ok) throw new Error(file.reason)
      record = JSON.parse(file.text)
    } catch {
      out.corrupt++
      continue
    }
    if (!isObject(record) || record.schema !== REVIEW_METRICS_SCHEMA || record.stage !== 'artifacts') continue
    if (win && !win.time(record.timestamp)) continue
    const named = stringOrNull(record.findings)
    if (!named) {
      out.noFindings++
      continue
    }
    const content = readFindingsOf(named, roots, cache)
    if (content === null) {
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

/**
 * The Artifact Checks at HEAD, or `null` (no commit, no REVIEW.md there, or it
 * carries none). No commit at HEAD touching REVIEW.md means HEAD has none, so
 * the window's own answer saves the policy read (PR #47 review, M9).
 */
function readChecks(io, root, win) {
  if (!win.commit) return null
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
  const closed = closedWindow(win, flags.all === true)
  const { notes, problem: notesProblem } = readNotes(root)
  const read = readLedgers(root, closed)
  const { ledgers, dirExists: archived } = read
  const joined = readGates(root, io.home, closed)

  const result = suggestPolicy({
    window: { all: flags.all === true, ...win },
    notes,
    gates: joined.gates,
    ledgers,
    checks: readChecks(io, root, win),
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
  // A source that is there but does not read is said, never folded into an empty one (PR #47 review, M11).
  if (notesProblem) result.sources.notes = `${NOTES_PATH.split(sep).join('/')}: ${notesProblem}, so T1 read nothing`
  if (joined.dirProblem) result.sources.records = `${METRICS_DIR.split(sep).join('/')}: not listed (${joined.dirProblem}), so T2 and T3 read no record`
  else if (joined.corrupt) result.sources.records += `; ${joined.corrupt} record file(s) that do not parse`
  if (read.dirProblem) result.sources.ledgers = `${ARCHIVE_DIR.split(sep).join('/')}: not listed (${read.dirProblem}), so T4 read nothing`
  else {
    if (read.unreadable) result.sources.ledgers += `; ${read.unreadable} decisions.md that do not read`
    if (read.older) result.sources.ledgers += `; ${read.older} archive(s) dated before the window, not read`
  }

  if (json) io.emit(true, result, '')
  else if (flags.summary === true) {
    const line = summaryLine(result)
    if (line) io.emit(false, result, line + '\n')
  } else io.emit(false, result, formatSuggest(result))
}
