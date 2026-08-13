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
import { inspectChange, isCoverableSource, listChanges } from './artifacts.mjs'

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
    const meta = parsed.graph && typeof parsed.graph === 'object' ? parsed.graph : {}
    return {
      links: parsed.links,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      builtAt: typeof meta.built_at === 'string' ? meta.built_at : null,
      reason: null
    }
  } catch (err) {
    return { links: null, reason: `graph.json could not be read: ${err.message}` }
  }
}

/** spec path -> set of files it claims to describe. Living specs, weight-1 edges only. */
function specToFiles(links) {
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
  return bySpec
}

/**
 * Signal B — living specs that no longer match the code they describe.
 *
 * Two tiers, and the split is the point:
 *
 *   broken  A spec cites a file that is not there any more. The edge was gated
 *           by `knownFiles` when the graph was built, so the file provably
 *           existed then. Evidence.
 *   aging   A spec is older than a file it cites that DOES still exist. A
 *           proxy: a file can be refactored without the behaviour the spec
 *           describes changing at all. Advisory.
 *
 * A file that is gone appears in `broken` only — never in both. `aging` would
 * otherwise report the same file a second time under a weaker heading, and the
 * reader would have to work out that the two findings are one.
 *
 * @param {string} root
 * @param {{lastCommit?: (path: string) => string|null, exists?: (path: string) => boolean}} [opts]
 *   Both injected so this is testable without a git repo or a real tree.
 */
export function detectStaleSpecs(root = '.', opts = {}) {
  const lastCommit =
    typeof opts.lastCommit === 'function' ? opts.lastCommit : path => gitLastCommit(root, path)
  const exists =
    typeof opts.exists === 'function' ? opts.exists : path => existsSync(join(root, path))

  const { links, builtAt, reason } = readGraph(root)
  if (!links) return { skipped: true, reason, broken: [], aging: [], graphBuiltAt: null }

  const bySpec = specToFiles(links)

  const broken = []
  const aging = []
  for (const [spec, files] of [...bySpec].sort(([a], [b]) => a.localeCompare(b))) {
    const present = []
    for (const file of [...files].sort()) {
      if (exists(file)) present.push(file)
      else broken.push({ spec, file })
    }

    const specTime = lastCommit(spec)
    // A spec git has never seen cannot be compared against anything. Skipping it
    // is the honest outcome; guessing a timestamp would invent the finding.
    if (!specTime) continue

    const newer = []
    for (const file of present) {
      const fileTime = lastCommit(file)
      if (!fileTime) continue
      if (fileTime > specTime) newer.push({ file, committed: fileTime })
    }
    if (newer.length) {
      aging.push({ spec, specCommitted: specTime, newerFiles: newer, linkedFiles: files.size })
    }
  }

  // `indexed` separates "checked them, all fresh" from "there was nothing to
  // check" — the same distinction readGraph draws above. A repo with no living
  // specs reporting "none stale" reads like a passed check, and it is not one.
  return { skipped: false, reason: null, broken, aging, indexed: bySpec.size, graphBuiltAt: builtAt }
}

/**
 * Signal C — changed source files that no living spec describes.
 *
 * §5.4 of the Spec Growth Engine calls an unowned source file a hard error. That
 * works there because every node is required to have a SPEC.md; run it repo-wide
 * on a brownfield project and it reports the whole tree. Scoped to the files one
 * change actually touched, it is the useful version: "you just wrote code
 * nothing describes."
 *
 * The repo-wide coverage figure travels with the finding on purpose. "2 files
 * have no spec" reads as an alarm; "2 of 6, in a repo where 34% of source files
 * have one" reads as what it is. No threshold decides whether to report — a
 * number nobody can defend would drift, which is the argument in lib/limits.mjs.
 *
 * @param {string} root
 * @param {string[]} changed  repo-relative paths from the caller's diff
 */
export function detectOrphans(root = '.', changed = [], opts = {}) {
  const { links, nodes, reason } = readGraph(root)
  if (!links) return { skipped: true, reason, orphans: [], considered: 0 }

  const bySpec = specToFiles(links)
  if (bySpec.size === 0) {
    // No spec describes any file, so every file is "unowned" and the finding
    // means nothing. Reporting it would be the loudest possible way to say
    // nothing at all.
    return {
      skipped: true,
      reason: 'no living spec links to any file — orphan detection needs spec coverage to mean anything',
      orphans: [],
      considered: 0
    }
  }

  const owned = new Set()
  for (const files of bySpec.values()) for (const f of files) owned.add(f)

  // Only real source counts. A doc or a config file having no spec is not a gap.
  const considered = (Array.isArray(changed) ? changed : []).filter(isCoverableSource)
  const orphans = considered.filter(f => !owned.has(f)).sort()

  // Denominator from the graph's own file nodes, filtered the same way, so the
  // ratio compares like with like.
  const allSource = (nodes || [])
    .filter(n => n && n.type === 'file' && typeof n.source_file === 'string')
    .map(n => n.source_file)
    .filter(isCoverableSource)
  const ownedSource = allSource.filter(f => owned.has(f))

  return {
    skipped: false,
    reason: null,
    orphans,
    considered: considered.length,
    coverage: {
      owned: ownedSource.length,
      total: allSource.length,
      percent: allSource.length ? Math.round((ownedSource.length / allSource.length) * 100) : 0
    }
  }
}

/**
 * Every signal, in one report.
 *
 * @param {string} root
 * @param {{
 *   lastCommit?: (path: string) => string|null,
 *   exists?: (path: string) => boolean,
 *   changed?: string[]
 * }} [opts]
 *   `changed` is the caller's diff. Orphan detection is only meaningful against
 *   one, so it is computed only when a diff is supplied — absent, the signal is
 *   reported as not-run rather than as clean.
 */
export function analyzeDrift(root = '.', opts = {}) {
  const unarchived = detectUnarchived(root)
  const stale = detectStaleSpecs(root, opts)
  const changed = Array.isArray(opts.changed) ? opts.changed : null
  const orphans = changed
    ? detectOrphans(root, changed, opts)
    : { skipped: true, reason: 'no --changed file list was supplied', orphans: [], considered: 0 }

  return {
    root,
    unarchived,
    stale,
    orphans,
    // A convenience for callers that only want to know whether to print anything.
    // Never a pass/fail: this command has no fail.
    hasFindings:
      unarchived.length > 0 ||
      stale.broken.length > 0 ||
      stale.aging.length > 0 ||
      orphans.orphans.length > 0
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
  const { unarchived, stale, orphans } = report

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

  // Broken references before aging ones: one is a fact about the tree as it is
  // now, the other is an inference from two dates. Printing them at the same
  // weight would tell the reader they deserve the same attention.
  if (stale.skipped) {
    lines.push(`SPEC REFERENCES — not checked: ${stale.reason}`)
  } else if (!stale.indexed) {
    lines.push('SPEC REFERENCES — nothing to check: no living spec under openspec/specs/ links')
    lines.push('  to a file the graph knows. That is not a clean result, it is an empty one.')
  } else {
    if (stale.broken.length) {
      lines.push(
        `BROKEN REFERENCES — ${stale.broken.length} spec→file link${stale.broken.length === 1 ? '' : 's'} whose file no longer exists`
      )
      lines.push('')
      for (const item of stale.broken) lines.push(`  ${item.spec}  →  ${item.file}  (missing)`)
      lines.push('')
      lines.push('  The file existed when the graph was built and does not exist now, so the spec')
      lines.push('  describes something that is not there. Either the spec needs updating or the')
      lines.push('  file was renamed and the graph has not caught up.')
      if (stale.graphBuiltAt) lines.push(`  Graph built ${stamp(stale.graphBuiltAt)} — rebuild it if that is old.`)
      lines.push('')
    } else {
      lines.push(
        `BROKEN REFERENCES — none. Every file cited by ${stale.indexed} living spec${stale.indexed === 1 ? '' : 's'} still exists.`
      )
      lines.push('')
    }

    if (stale.aging.length) {
      lines.push(`AGING SPECS — ${stale.aging.length} older than code they describe (advisory)`)
      lines.push('')
      for (const item of stale.aging) {
        lines.push(`  ${item.spec}  last touched ${stamp(item.specCommitted)}`)
        for (const f of item.newerFiles) {
          lines.push(`    ${f.file} committed ${stamp(f.committed)}`)
        }
      }
      lines.push('')
      lines.push('  Weaker than the above: this compares dates, not behaviour, on INFERRED graph')
      lines.push('  edges. A file can be refactored without the spec becoming wrong. Read before')
      lines.push('  believing.')
    } else {
      lines.push('AGING SPECS — none is older than the files it describes.')
    }
  }

  if (orphans.skipped) {
    lines.push('')
    lines.push(`ORPHAN CODE — not checked: ${orphans.reason}`)
  } else {
    lines.push('')
    const c = orphans.coverage
    if (orphans.orphans.length) {
      lines.push(
        `ORPHAN CODE — ${orphans.orphans.length} of ${orphans.considered} changed source file${orphans.considered === 1 ? '' : 's'} described by no spec`
      )
      lines.push('')
      for (const f of orphans.orphans) lines.push(`  ${f}`)
      lines.push('')
      lines.push(`  Repo-wide, ${c.owned} of ${c.total} source files (${c.percent}%) have a spec. Read this`)
      lines.push('  count against that: on a repo still being specced, unowned files are expected.')
    } else if (!orphans.considered) {
      // Vacuous truth reads as a bug. "All 0 files are covered" invites the
      // reader to wonder whether the check ran at all.
      lines.push('ORPHAN CODE — nothing to check: no changed file was a source file.')
    } else {
      lines.push(
        `ORPHAN CODE — none. All ${orphans.considered} changed source file${orphans.considered === 1 ? '' : 's'} ` +
          `${orphans.considered === 1 ? 'is' : 'are'} described by a spec (repo-wide ${c.percent}%).`
      )
    }
  }

  lines.push('')
  lines.push('Nothing here blocks. Drift is reported so a person can decide.')
  return lines.join('\n')
}
