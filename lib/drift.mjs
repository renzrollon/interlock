// Spec drift — has the written spec fallen behind the code it describes?
//
// Spec drift is the standing criticism of every spec-driven framework: the spec
// is written once, the code moves, and nothing notices until someone reads a
// document that has been wrong for a month. Worse for agents than for people —
// a stale doc misleads the next reader, a stale spec misleads every future run.
//
// OpenSpec's answer is `openspec archive`, which merges a completed change's
// delta specs into `openspec/specs/`. That answer is correct and Interlock does
// not replace it. What Interlock adds is noticing when it has not happened.
//
// Two signals, deliberately kept apart because their confidence is not the same:
//
//   A. UNARCHIVED  Every task in a change is ticked, but the change is still
//                  sitting in openspec/changes/. Its deltas never reached the
//                  living specs, so the living specs are stale by construction.
//                  Read straight off the filesystem. This cannot false-positive.
//
//   B. STALE       A living spec links to files that have been committed since
//                  the spec itself was last touched. Derived from the graph's
//                  `implements_spec` edges, which are INFERRED — regex path
//                  mentions, not a parsed contract. This is a hint, not a fact.
//
// Merging them into one score would launder B's uncertainty through A's
// precision, so they stay separate all the way to the printed report.
//
// WHY THIS NEVER BLOCKS. Every other gating subcommand in `interlock` exits
// non-zero when it blocks, so the obvious assumption is that this one does too.
// It does not, and that is deliberate: signal B rests on INFERRED edges, and
// `shared/TOOL-ECONOMY.md` says to treat those as hints needing verification. A
// blocking gate built on a regex that matched a filename in a sentence would be
// wrong often enough to be turned off, and a gate everyone disables protects
// nothing. The Spec Growth Engine (arXiv 2606.27045) can block a merge on graph
// disagreement because its specs are machine-readable contracts; prose specs
// cannot carry that weight. So: report, and let a person decide.
//
// Exposed to skills as `interlock drift [--json]`.

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { inspectChange, listChanges } from './artifacts.mjs'

const GRAPH_PATH = join('.claude', 'graph', 'graph.json')

/** Living specs only. A spec inside an in-flight change is *supposed* to move. */
const LIVING_SPEC_PREFIX = 'openspec/specs/'

/**
 * Only weight-1 edges, which are the `file:` targets extracted from an explicit
 * path mention. The 0.5 edges are symbol-name guesses and are far looser — a
 * spec saying "the AuthService" links to every AuthService in the repo, so a
 * staleness claim built on them would be noise.
 */
const RELIABLE_EDGE_WEIGHT = 1

/** Last commit time for a path, as an ISO string, or null when git has nothing. */
function gitLastCommit(root, path) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', path], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const trimmed = out.trim()
    return trimmed || null
  } catch {
    // Not a git repo, git missing, or a path git has never seen. All three mean
    // "no timestamp available", which is a skip — never a zero and never a now.
    return null
  }
}

/**
 * Signal A — changes that are complete but were never archived.
 *
 * A change qualifies when it has tasks and none remain. A change with zero
 * tasks is not "complete", it is unstarted or malformed, and reporting it as
 * drift would train people to ignore the report.
 *
 * @param {string} root
 * @returns {Array<{change: string, tasks: number, path: string}>}
 */
export function detectUnarchived(root = '.') {
  const found = []
  for (const name of listChanges(root)) {
    const info = inspectChange(root, name)
    if (!info || !info.exists) continue
    const tasks = info.tasks || {}
    const total = Number(tasks.total) || 0
    const remaining = Number(tasks.remaining) || 0
    if (total > 0 && remaining === 0) {
      found.push({ change: name, tasks: total, path: info.path })
    }
  }
  return found
}

/** Read the graph, or say why we could not. Never reports absence as cleanliness. */
function readGraph(root) {
  const path = join(root, GRAPH_PATH)
  if (!existsSync(path)) {
    return { links: null, reason: 'no graph has been built — run /interlock:bootstrap once' }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    // node-link format: edges live under `links`, not `edges`.
    if (!Array.isArray(parsed.links)) {
      return { links: null, reason: 'graph.json has no links array — rebuild it' }
    }
    return { links: parsed.links, reason: null }
  } catch (err) {
    return { links: null, reason: `graph.json could not be read: ${err.message}` }
  }
}

/**
 * Signal B — living specs whose linked files have moved since the spec did.
 *
 * @param {string} root
 * @param {{lastCommit?: (path: string) => string|null}} [opts]
 *   `lastCommit` is injected so this is testable without a git repo.
 * @returns {{skipped: boolean, reason: string|null, specs: Array}}
 */
export function detectStaleSpecs(root = '.', opts = {}) {
  const lastCommit =
    typeof opts.lastCommit === 'function' ? opts.lastCommit : path => gitLastCommit(root, path)

  const { links, reason } = readGraph(root)
  if (!links) return { skipped: true, reason, specs: [] }

  // spec path -> set of file paths it claims to describe
  const bySpec = new Map()
  for (const link of links) {
    if (!link || link.relation !== 'implements_spec') continue
    if (link.weight !== RELIABLE_EDGE_WEIGHT) continue
    const spec = typeof link.source_file === 'string' ? link.source_file : ''
    if (!spec.startsWith(LIVING_SPEC_PREFIX)) continue
    const target = typeof link.target === 'string' ? link.target : ''
    if (!target.startsWith('file:')) continue
    const file = target.slice('file:'.length)
    if (!file) continue
    if (!bySpec.has(spec)) bySpec.set(spec, new Set())
    bySpec.get(spec).add(file)
  }

  const specs = []
  for (const [spec, files] of [...bySpec].sort(([a], [b]) => a.localeCompare(b))) {
    const specTime = lastCommit(spec)
    // A spec git has never seen cannot be compared against anything. Skipping it
    // is the honest outcome; guessing a timestamp would invent the finding.
    if (!specTime) continue

    const newer = []
    for (const file of [...files].sort()) {
      const fileTime = lastCommit(file)
      if (!fileTime) continue
      if (fileTime > specTime) newer.push({ file, committed: fileTime })
    }
    if (newer.length) {
      specs.push({ spec, specCommitted: specTime, newerFiles: newer, linkedFiles: files.size })
    }
  }

  // `indexed` separates "checked them, all fresh" from "there was nothing to
  // check" — the same distinction readGraph draws above. A repo with no living
  // specs reporting "none stale" reads like a passed check, and it is not one.
  return { skipped: false, reason: null, specs, indexed: bySpec.size }
}

/**
 * Both signals, in one report.
 *
 * @param {string} root
 * @param {{lastCommit?: (path: string) => string|null}} [opts]
 */
export function analyzeDrift(root = '.', opts = {}) {
  const unarchived = detectUnarchived(root)
  const stale = detectStaleSpecs(root, opts)
  return {
    root,
    unarchived,
    stale,
    // A convenience for callers that only want to know whether to print anything.
    // Never a pass/fail: this command has no fail.
    hasFindings: unarchived.length > 0 || stale.specs.length > 0
  }
}

/**
 * `2026-08-13 14:02:31` — seconds, not date. A spec and the file that outran it
 * are often committed minutes apart, and two identical-looking timestamps under
 * a "has fallen behind" heading read like a bug in the report rather than a
 * narrow margin. The extra characters are cheaper than that doubt.
 */
function stamp(iso) {
  return typeof iso === 'string' ? iso.slice(0, 19).replace('T', ' ') : String(iso)
}

/** Human-readable report. Signal A first, because it is the one that is certain. */
export function formatDrift(report) {
  const lines = []
  const { unarchived, stale } = report

  if (unarchived.length) {
    lines.push(`UNARCHIVED — ${unarchived.length} completed change${unarchived.length === 1 ? '' : 's'} still in openspec/changes/`)
    lines.push('')
    for (const item of unarchived) {
      lines.push(`  ${item.change}  (${item.tasks} task${item.tasks === 1 ? '' : 's'}, all done)`)
    }
    lines.push('')
    lines.push('  Its delta specs never reached openspec/specs/, so the living specs do not')
    lines.push('  describe what shipped. Archive each one once its MR has merged:')
    lines.push('')
    for (const item of unarchived) lines.push(`    openspec archive ${item.change}`)
    lines.push('')
  } else {
    lines.push('UNARCHIVED — none. Every completed change has been archived.')
    lines.push('')
  }

  if (stale.skipped) {
    lines.push(`STALE SPECS — not checked: ${stale.reason}`)
  } else if (!stale.indexed) {
    lines.push('STALE SPECS — nothing to check: no living spec under openspec/specs/ links')
    lines.push('  to a file the graph knows. That is not a clean result, it is an empty one.')
  } else if (!stale.specs.length) {
    lines.push(
      `STALE SPECS — none of ${stale.indexed} living spec${stale.indexed === 1 ? '' : 's'} is older than the files it describes.`
    )
  } else {
    lines.push(`STALE SPECS — ${stale.specs.length} may have fallen behind (advisory)`)
    lines.push('')
    for (const item of stale.specs) {
      lines.push(`  ${item.spec}  last touched ${stamp(item.specCommitted)}`)
      for (const f of item.newerFiles) {
        lines.push(`    ${f.file} committed ${stamp(f.committed)}`)
      }
    }
    lines.push('')
    lines.push('  These come from INFERRED graph edges — a path mentioned in spec prose, not a')
    lines.push('  parsed contract. Read the spec before believing it: a file can move without')
    lines.push('  the behaviour it implements changing at all.')
  }

  lines.push('')
  lines.push('Nothing here blocks. Drift is reported so a person can decide.')
  return lines.join('\n')
}
