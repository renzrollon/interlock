// The coverage reader — what an lcov report says about a whole project and about
// the lines one change added.
//
// Nothing in the codebase read a coverage report before this: `coverage.report_path`
// was written into a profile and consumed by nothing, and the verify agent's
// result carried no figures, so the merge verdict's coverage signal had no
// producer. This module is the pure half of that producer. The CLI owns git, the
// filesystem and the clock (`interlock verify baseline`, `interlock verify
// coverage`); every function here takes text or plain objects and returns plain
// objects. No fs, no git, no clock.
//
// One thing the figures cannot say is what the report never saw. A report lists
// the files the tests loaded, so a new source file no test loads is absent from
// it, and its lines count neither for nor against any figure: the change that
// most needs the signal would read "nothing to judge". `unreportedChangedSource`
// names those files, from the report and the diff alone, and the coverage input
// carries them so the verdict can say so (design D13 of
// label-and-harden-the-merge-verdict). The changed-line figure itself is
// unchanged: it still counts only lines the report instruments.
//
// The one thing worth being strict about is the path. An lcov `SF:` line is
// spelt however the tool that wrote it felt like — `./lib/a.mjs`, an absolute
// path, a path relative to the directory the report sits in — and a diff hunk
// names `lib/a.mjs`. Matching the first against the second by string would give
// "no changed lines" for a file that is fully covered, which reads exactly like
// a change that touched no code. So every record is resolved to a repository-
// relative path through `canonicalizePath` before anything is matched, and a
// record that resolves outside the repository is counted and dropped, never
// guessed at. design D2 of judge-against-base-and-living-specs.

import { isCoverableSource } from './artifacts.mjs'
import { canonicalizePath } from './risk.mjs'

/** The identifier a coverage baseline file carries. */
export const BASELINE_SCHEMA = 'interlock.coverage-baseline/1'

/** Percentages round to one decimal, as `judgeCoverageResult` does. */
function pct(numerator, denominator) {
  if (!(denominator > 0)) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * Lexically normalise a slash-separated path: collapse `.`, `..` and repeated
 * separators. Keeps a leading `/` or a `C:` drive prefix; a `..` that would climb
 * above the start of a relative path is kept, so the caller can see it escaped.
 */
function lexical(path) {
  const slashed = path.replace(/\\/g, '/')
  const drive = slashed.match(/^[a-zA-Z]:(?=\/)/)?.[0] ?? ''
  const body = drive ? slashed.slice(drive.length) : slashed
  const absolute = body.startsWith('/')
  const out = []
  for (const segment of body.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
      continue
    }
    out.push(segment)
  }
  return `${drive}${absolute ? '/' : ''}${out.join('/')}`
}

const isAbsolute = path => path.startsWith('/') || /^[a-zA-Z]:\//.test(path)

/**
 * Resolve one `SF:` value to a canonical repository-relative path, or null when
 * it lies outside the repository. A relative value is read against `reportDir`
 * (the directory a profile's `report_path` is relative to), an absolute one
 * against nothing.
 */
function resolveSourceFile(sf, root, reportDir) {
  const given = sf.trim().replace(/\\/g, '/')
  if (!given) return null
  const absolute = lexical(isAbsolute(given) ? given : `${reportDir}/${given}`)
  const base = lexical(root).replace(/\/+$/, '')
  // `base + '/'` is the boundary: /work/repo-other shares a name prefix with
  // /work/repo and is not inside it.
  if (!absolute.startsWith(`${base}/`)) return null
  return canonicalizePath(absolute.slice(base.length + 1))
}

/**
 * Parse an lcov report into per-file records.
 *
 * A record is `{ path, lines: Map<line, hits>, lf, lh }`. `lf`/`lh` are the
 * report's own LF/LH summary when the record carries one, and are counted from
 * its DA lines otherwise. A path listed twice is one record, its DA hits summed.
 * `outsideRoot` counts the records that resolved outside the repository: they
 * are not kept and take no part in any figure.
 *
 * @param {string} text
 * @param {{ root: string, reportDir?: string }} opts
 * @returns {{ records: Array<{path: string, lines: Map<number, number>, lf: number, lh: number}>, outsideRoot: number }}
 */
export function parseLcov(text, { root, reportDir } = {}) {
  const dir = reportDir || root
  const byPath = new Map()
  let outsideRoot = 0
  let current = null // { path|null, lines, lf, lh } for the record being read

  const finish = () => {
    if (!current) return
    const done = current
    current = null
    if (done.path === null) {
      outsideRoot += 1
      return
    }
    const existing = byPath.get(done.path)
    if (!existing) {
      byPath.set(done.path, done)
      return
    }
    for (const [line, hits] of done.lines) existing.lines.set(line, (existing.lines.get(line) ?? 0) + hits)
    // Two reports of one file: the summaries no longer describe the union, so
    // both are dropped and the totals are counted from the merged lines.
    existing.lf = null
    existing.lh = null
  }

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('SF:')) {
      finish()
      current = {
        path: resolveSourceFile(line.slice(3), root, dir),
        lines: new Map(),
        lf: null,
        lh: null
      }
    } else if (!current) {
      continue
    } else if (line.startsWith('DA:')) {
      const [lineNo, hits] = line.slice(3).split(',')
      const n = Number(lineNo)
      const h = Number(hits)
      if (Number.isInteger(n) && n > 0 && Number.isFinite(h)) {
        current.lines.set(n, (current.lines.get(n) ?? 0) + h)
      }
    } else if (line.startsWith('LF:')) {
      const n = Number(line.slice(3))
      if (Number.isInteger(n) && n >= 0) current.lf = n
    } else if (line.startsWith('LH:')) {
      const n = Number(line.slice(3))
      if (Number.isInteger(n) && n >= 0) current.lh = n
    } else if (line === 'end_of_record') {
      finish()
    }
  }
  finish() // a report truncated before its last end_of_record

  const records = [...byPath.values()].map(rec => {
    const counted = [...rec.lines.values()]
    return {
      path: rec.path,
      lines: rec.lines,
      lf: rec.lf ?? counted.length,
      lh: rec.lh ?? counted.filter(hits => hits > 0).length
    }
  })
  return { records, outsideRoot }
}

/**
 * The project total over every record. `totalPct` is null when no line is
 * instrumented — a report with nothing in it has no percentage, and zero would
 * read as "tested nothing".
 *
 * @param {Array<{lf: number, lh: number}>} records
 * @returns {{ totalPct: number|null, lf: number, lh: number }}
 */
export function coverageTotals(records) {
  let lf = 0
  let lh = 0
  for (const rec of Array.isArray(records) ? records : []) {
    lf += rec.lf
    lh += rec.lh
  }
  return { totalPct: pct(lh, lf), lf, lh }
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** The path a `+++ ` header names, or null for a deletion or an unusable name. */
function newSidePath(header) {
  let name = header.slice(4).replace(/\t.*$/, '').trim()
  if (name === '/dev/null') return null
  if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
    // git quotes a path with unusual bytes; unescape what a repository path can carry.
    name = name.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (!name.startsWith('b/')) return null
  return canonicalizePath(name.slice(2))
}

/**
 * The lines a diff adds, by new-side path, from `git diff -U0 --no-color
 * --no-ext-diff <base>...HEAD`. A rename lands on its new path; a deletion
 * (`+++ /dev/null`) adds nothing and is not a key; a pure-deletion hunk
 * (`+start,0`) adds nothing.
 *
 * A hunk is read by its own counts, so an added line whose content begins `++ `
 * (which looks like a `+++ ` header) is not mistaken for one.
 *
 * @param {string} diffText
 * @returns {Map<string, Set<number>>}
 */
export function parseAddedLines(diffText) {
  const added = new Map()
  let path = null
  let remOld = 0
  let remNew = 0
  let next = 0

  for (const line of String(diffText ?? '').split('\n')) {
    if (remOld > 0 || remNew > 0) {
      if (line.startsWith('\\')) continue // "\ No newline at end of file"
      if (remOld > 0 && line.startsWith('-')) {
        remOld -= 1
        continue
      }
      if (remNew > 0 && line.startsWith('+')) {
        remNew -= 1
        if (path !== null) {
          if (!added.has(path)) added.set(path, new Set())
          added.get(path).add(next)
        }
        next += 1
        continue
      }
      // A hunk that ends early (a truncated diff): fall through to the headers.
      remOld = 0
      remNew = 0
    }
    if (line.startsWith('diff --git ')) {
      path = null
    } else if (line.startsWith('+++ ')) {
      path = newSidePath(line)
    } else {
      const hunk = line.match(HUNK)
      if (hunk) {
        remOld = hunk[1] === undefined ? 1 : Number(hunk[1])
        remNew = hunk[3] === undefined ? 1 : Number(hunk[3])
        next = Number(hunk[2])
      }
    }
  }
  return added
}

/**
 * Coverage of the lines a change added. An added line counts only if the report
 * instruments it (a DA record exists): a comment, a blank line or a line in a
 * file the report never saw is not a "changed line", so it can neither pass nor
 * fail the figure. `diffPct` is null when no added line is measured — absent,
 * never 100 and never 0.
 *
 * @param {Array<{path: string, lines: Map<number, number>}>} records
 * @param {Map<string, Set<number>>} added
 * @returns {{ changedLines: number, coveredLines: number, diffPct: number|null }}
 */
export function changedLineCoverage(records, added) {
  const byPath = new Map((Array.isArray(records) ? records : []).map(rec => [rec.path, rec]))
  let changedLines = 0
  let coveredLines = 0
  for (const [path, lines] of added instanceof Map ? added : []) {
    const rec = byPath.get(path)
    if (!rec) continue
    for (const line of lines) {
      if (!rec.lines.has(line)) continue
      changedLines += 1
      if (rec.lines.get(line) > 0) coveredLines += 1
    }
  }
  return { changedLines, coveredLines, diffPct: pct(coveredLines, changedLines) }
}

/**
 * The changed source files a report does not list: the files the diff adds at
 * least one line to, that the project counts as coverable source (never a test,
 * a configuration file or a document), and that the report holds no record for.
 * `files` is in path order; `addedLines` is the lines the diff adds in them.
 *
 * A report cannot tell a file no test loaded from one the project left out of
 * coverage on purpose, so this names and never judges.
 *
 * @param {Array<{path: string}>} records
 * @param {Map<string, Set<number>>} added
 * @returns {{ files: string[], addedLines: number }}
 */
export function unreportedChangedSource(records, added) {
  const reported = new Set((Array.isArray(records) ? records : []).map(rec => rec.path))
  const files = []
  let addedLines = 0
  for (const [path, lines] of added instanceof Map ? added : []) {
    const count = lines instanceof Set ? lines.size : 0
    if (!count || reported.has(path) || !isCoverableSource(path)) continue
    files.push(path)
    addedLines += count
  }
  files.sort()
  return { files, addedLines }
}

/**
 * The coverage input the merge verdict reads: exactly the nine fields
 * `readCoverage` consumes, and nothing else. Seven are figures; `unreportedFiles`
 * and `unreportedAddedLines` name the changed source the report does not list.
 * They are null when coverage is not configured and when the caller did not
 * hand them in: not stated is never an empty list.
 *
 * With no coverage configured every figure is null. With no baseline every base
 * field is null and the head and changed-line figures remain. A baseline whose
 * commit is not an ancestor of the head is passed through marked
 * `baseIsAncestor: false` — dropped it would read as "no baseline", and banded
 * it would judge a change against code it never descended from; the reader
 * decides what that means.
 *
 * @param {{
 *   configured: boolean,
 *   head?: { totalPct: number|null }|null,
 *   baseline?: { sha: string, totalPct: number }|null,
 *   baseIsAncestor?: boolean|null,
 *   changed?: { changedLines: number, diffPct: number|null }|null,
 *   unreported?: { files: string[], addedLines: number }|null
 * }} parts
 */
export function buildCoverageInput({ configured, head, baseline, baseIsAncestor, changed, unreported } = {}) {
  if (configured !== true) {
    return {
      configured: false,
      headTotalPct: null,
      baseTotalPct: null,
      baseSha: null,
      baseIsAncestor: null,
      diffPct: null,
      changedLines: null,
      unreportedFiles: null,
      unreportedAddedLines: null
    }
  }
  const hasBaseline = baseline !== null && baseline !== undefined
  const stated = unreported !== null && typeof unreported === 'object' && Array.isArray(unreported.files)
  return {
    configured: true,
    headTotalPct: head?.totalPct ?? null,
    baseTotalPct: hasBaseline ? (baseline.totalPct ?? null) : null,
    baseSha: hasBaseline ? (baseline.sha ?? null) : null,
    baseIsAncestor: hasBaseline && typeof baseIsAncestor === 'boolean' ? baseIsAncestor : null,
    diffPct: changed?.diffPct ?? null,
    changedLines: changed?.changedLines ?? null,
    unreportedFiles: stated ? [...unreported.files] : null,
    unreportedAddedLines: stated ? (unreported.addedLines ?? null) : null
  }
}

/**
 * Check a parsed baseline file. `ref` is the branch the baseline was taken on and
 * may be null (a detached HEAD); everything else is required.
 *
 * @param {unknown} obj
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateBaseline(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, problems: ['the baseline is not a JSON object'] }
  }
  const problems = []
  if (obj.schema !== BASELINE_SCHEMA) {
    problems.push(`schema must be ${BASELINE_SCHEMA}, found ${JSON.stringify(obj.schema ?? null)}`)
  }
  if (typeof obj.sha !== 'string' || !obj.sha.trim()) problems.push('sha must be a non-empty commit id')
  if (obj.ref !== undefined && obj.ref !== null && typeof obj.ref !== 'string') {
    problems.push('ref must be a branch name or null')
  }
  if (typeof obj.totalPct !== 'number' || !Number.isFinite(obj.totalPct) || obj.totalPct < 0 || obj.totalPct > 100) {
    problems.push('totalPct must be a number from 0 to 100')
  }
  if (typeof obj.generatedAt !== 'string' || !obj.generatedAt.trim()) {
    problems.push('generatedAt must be a timestamp string')
  }
  return { ok: problems.length === 0, problems }
}
