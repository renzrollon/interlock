// The snapshot `interlock gate` keeps of the artifacts it judged (change
// `scope-suggest-and-evaluate-the-artifact-gate`, design §1-§2, D4-D6).
//
// Pure parts: building the payload, validating one read back, comparing it with
// the current files. One I/O helper, `snapshotForGate`, checks the conditions,
// reads the files and writes the file. A failed write never touches a verdict.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { diffLines, reworkShare } from './line-diff.mjs'

export const ARTIFACT_SNAPSHOT_SCHEMA = 'interlock.artifact-snapshot/1'

const sha256 = text => createHash('sha256').update(text).digest('hex')

/** A text's '\n'-separated lines; a trailing newline is not one more line. */
function linesOf(text) {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * @param {{ change: string, findings: string, files: {path: string, text: string}[], takenAt?: string }} input
 */
export function buildSnapshot({ change, findings, files, takenAt }) {
  return {
    schema: ARTIFACT_SNAPSHOT_SCHEMA,
    change,
    findings,
    takenAt: takenAt ?? new Date().toISOString(),
    files: files.map(f => ({ path: f.path, sha256: sha256(f.text), text: f.text }))
  }
}

/**
 * Validate a payload read back.
 * @returns {{ ok: true, snapshot: object } | { ok: false, reason: string, otherChange?: string }}
 *   `otherChange` names the change a snapshot of another change is of.
 */
export function readSnapshot(text, change) {
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    return { ok: false, reason: `not valid JSON (${err.message})` }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'not a JSON object' }
  }
  if (data.schema !== ARTIFACT_SNAPSHOT_SCHEMA) {
    return { ok: false, reason: `schema is ${JSON.stringify(data.schema)}, not ${ARTIFACT_SNAPSHOT_SCHEMA}` }
  }
  if (data.change !== change) {
    return {
      ok: false,
      reason: `snapshot is of ${JSON.stringify(data.change)}, not ${JSON.stringify(change)}`,
      otherChange: typeof data.change === 'string' ? data.change : String(data.change)
    }
  }
  if (!Array.isArray(data.files) || !data.files.every(f => f && typeof f.path === 'string' && typeof f.text === 'string')) {
    return { ok: false, reason: 'files is not a list of path and text' }
  }
  return { ok: true, snapshot: data }
}

/**
 * Compare a snapshot with the current files.
 * @param {{ files: {path: string, text: string}[] }} snapshot
 * @param {{ path: string, text: string }[]} files
 */
export function compareSnapshot(snapshot, files) {
  const before = new Map(snapshot.files.map(f => [f.path, f.text]))
  const now = new Map(files.map(f => [f.path, f.text]))
  const out = {
    changed: [],
    addedFiles: [],
    removedFiles: [],
    unchanged: [],
    linesAdded: 0,
    linesRemoved: 0,
    linesBefore: 0,
    linesAfter: 0,
    changedFiles: 0,
    share: 0
  }
  const tally = (d, b, a) => {
    out.linesAdded += d.added
    out.linesRemoved += d.removed
    out.linesBefore += b
    out.linesAfter += a
  }
  for (const [path, was] of before) {
    const a = linesOf(was)
    if (!now.has(path)) {
      const d = diffLines(a, [])
      out.removedFiles.push({ path, hunks: d.hunks })
      tally(d, a.length, 0)
      continue
    }
    const b = linesOf(now.get(path))
    const d = diffLines(a, b)
    tally(d, a.length, b.length)
    if (was === now.get(path)) out.unchanged.push(path)
    else out.changed.push({ path, hunks: d.hunks })
  }
  for (const [path, text] of now) {
    if (before.has(path)) continue
    const b = linesOf(text)
    const d = diffLines([], b)
    out.addedFiles.push({ path, hunks: d.hunks })
    tally(d, 0, b.length)
  }
  out.changedFiles = out.changed.length + out.addedFiles.length + out.removedFiles.length
  out.share = reworkShare({
    added: out.linesAdded,
    removed: out.linesRemoved,
    before: out.linesBefore,
    after: out.linesAfter
  })
  return out
}

function specFiles(dir) {
  const found = []
  const walk = d => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full)
    }
  }
  walk(dir)
  return found
}

/**
 * The artifact files of a change directory the snapshot keeps and a scoped
 * re-gate compares: the four top-level artifacts that exist, then every `.md`
 * under `specs/`, paths relative to the change directory with `/` separators.
 * One reader for both, so a snapshot and the comparison always cover one set.
 */
export function readChangeFiles(dir) {
  const paths = ['proposal.md', 'design.md', 'tasks.md', 'decisions.md']
    .map(name => join(dir, name))
    .filter(p => existsSync(p))
  const specs = join(dir, 'specs')
  if (existsSync(specs) && statSync(specs).isDirectory()) paths.push(...specFiles(specs))
  return paths.map(p => ({
    path: relative(dir, p).split('\\').join('/'),
    text: readFileSync(p, 'utf8')
  }))
}

/**
 * The gate's snapshot step. Returns null when the conditions are not all met
 * (`--stage artifacts`, `--metrics <change>`, a `--findings` path other than
 * `-`); otherwise `{ written, path, reason? }`. Never throws; `warn` is called
 * once on a failure.
 *
 * @param {string} root
 * @param {{ findings?: unknown, metrics?: unknown, stage?: unknown }} flags
 * @param {(message: string) => void} [warn]
 */
export function snapshotForGate(root, flags, warn = () => {}) {
  if (flags.stage !== 'artifacts') return null
  if (typeof flags.metrics !== 'string' || flags.metrics === '') return null
  if (typeof flags.findings !== 'string' || flags.findings === '' || flags.findings === '-') return null

  const change = flags.metrics
  const findingsPath = resolve(root, flags.findings)
  const target = join(dirname(findingsPath), 'snapshots', basename(findingsPath))
  const fail = reason => {
    warn(`snapshot not written: ${reason}`)
    return { written: false, path: target, reason }
  }
  try {
    const dir = join(root, 'openspec', 'changes', change)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return fail(`change ${JSON.stringify(change)} has no directory at openspec/changes/${change}`)
    }
    const files = readChangeFiles(dir)
    const payload = buildSnapshot({ change, findings: basename(findingsPath), files })
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(payload) + '\n')
    return { written: true, path: target }
  } catch (err) {
    return fail(err.message)
  }
}
