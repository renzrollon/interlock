// Reading the base a review is judged against, and the domain context it is given
// (judge-against-base-and-living-specs, D3, D4).
//
// Moved out of lib/run.mjs for the shipped-file size limit
// (test/spine/package.test.mjs), not for a new seam: lib/run.mjs holds the loop
// itself and had grown to within a few KB of it. Nothing here is called from
// outside the run program; lib/run.mjs imports each name it uses. This module
// must NOT import ./run.mjs: it reads a manifest and a ctx it is handed, and
// nothing else of the run.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { LIMITS } from './limits.mjs'
import { inspectChange, readLivingSpecs } from './artifacts.mjs'
import { livingSpecEdges, readGraphAt } from './drift.mjs'
import { REVIEW_POLICY_FILE, composePolicy, parseReviewPolicy, readReviewPolicy } from './review-core.mjs'
import { applyToleranceBand } from './findings.mjs'
import { citedSelectionInputs } from './prompts/domain-context.mjs'
import { assembleDomainContext, selectDomainCapabilities } from './prompts/index.mjs'
import { canonicalizePath } from './risk.mjs'
import { capabilityOf, parseSpec } from './spec-text.mjs'

// --- the base a review is judged against (judge-against-base-and-living-specs, D3, D4) ---
//
// Two inputs a review reads are enforced, not advisory: the `REVIEW.md` path
// lists and the living requirements the `domain` dimension judges against. A
// change must not be able to edit the copy that is applied to it, so a run reads
// both from the commit it started on (`manifest.startSha`). The policy PROSE
// stays the working tree's: it is advice that cannot relax the gate, and an
// uncommitted edit to it reaching a reviewer is a feature. A run with no start
// commit reads everything from the working tree and says so.

/** The short form of a commit, as banners name it. */
export const shortSha = sha => String(sha).slice(0, 7)

/** HEAD when the run starts, or null — never a guess, and never a crash. */
export function readStartSha(ctx) {
  try {
    const sha = ctx.deps && typeof ctx.deps.headCommit === 'function' ? ctx.deps.headCommit(ctx.root) : null
    return typeof sha === 'string' && sha ? sha : null
  } catch {
    return null
  }
}

/** The start commit this run pinned, or null (none recorded, or an older manifest). */
export function pinnedSha(manifest) {
  return manifest && typeof manifest.startSha === 'string' && manifest.startSha ? manifest.startSha : null
}

/**
 * One repository file, from `ref` or — when `ref` is null — the working tree.
 * `{ text }`, `{ absent: true }`, `{ tooLarge: true, size }` or `{ error }`; it
 * never throws, because the caller decides how each outcome degrades.
 */
export function readFileAt(ctx, ref, relative, { maxBytes } = {}) {
  if (ref === null) {
    const path = join(ctx.root, relative)
    try {
      if (!existsSync(path)) return { absent: true }
      const size = statSync(path).size
      if (Number.isFinite(maxBytes) && size > maxBytes) return { tooLarge: true, size }
      return { text: readFileSync(path, 'utf8') }
    } catch (err) {
      return { error: (err && err.message) || String(err) }
    }
  }
  if (!ctx.deps || typeof ctx.deps.readAtRef !== 'function') {
    return { error: 'this host supplies no reader for a commit' }
  }
  try {
    const read = ctx.deps.readAtRef(ctx.root, ref, relative, { maxBytes })
    return read && typeof read === 'object' ? read : { error: 'the reader returned nothing' }
  } catch (err) {
    return { error: (err && err.message) || String(err) }
  }
}

/** Push a banner onto the manifest unless one with the same label is already there. */
export function raiseOnce(manifest, banner) {
  if (!Array.isArray(manifest.banners)) manifest.banners = []
  const label = banner.slice(0, banner.indexOf(':') + 1)
  if (!manifest.banners.some(b => typeof b === 'string' && b.startsWith(label))) manifest.banners.push(banner)
}

/** The working tree's `REVIEW.md` as text plus its parsed policy, or null when absent. */
function readWorkingPolicy(root) {
  const path = join(root, REVIEW_POLICY_FILE)
  if (!existsSync(path)) return null
  let text = ''
  try {
    if (statSync(path).size <= LIMITS.maxReviewPolicyBytes) text = readFileSync(path, 'utf8')
  } catch {
    // The policy reader below reports an unreadable file as a problem.
  }
  return { text, policy: readReviewPolicy(root) }
}

/**
 * The policy a review is adjudicated by: prose and owner from the working tree,
 * both enforced path lists from the start commit (`composePolicy`).
 *
 * With no start commit the working tree supplies everything, unchanged from
 * before; `reviewStep` has already said so (`REVIEW BASE NOT PINNED`). A start
 * commit that cannot be read degrades the same way and says so here. A working
 * copy that differs from the start commit's raises `POLICY DIFFERS FROM BASE`.
 *
 * @returns {{ policy: object, banners: string[] }}
 */
export function policyForAdjudication(ctx, manifest) {
  const sha = pinnedSha(manifest)
  if (!sha) return { policy: readReviewPolicy(ctx.root), banners: [] }

  const short = shortSha(sha)
  const read = readFileAt(ctx, sha, REVIEW_POLICY_FILE, { maxBytes: LIMITS.maxReviewPolicyBytes })
  if (read.error !== undefined) {
    return {
      policy: readReviewPolicy(ctx.root),
      banners: [
        `REVIEW BASE NOT PINNED: start commit ${short} could not be read (${read.error}); ` +
          `read from the working tree: ${REVIEW_POLICY_FILE} lists`
      ]
    }
  }

  let base = null
  if (typeof read.text === 'string') {
    base = { text: read.text, policy: parseReviewPolicy(read.text) }
  } else if (read.tooLarge) {
    base = {
      text: '',
      policy: {
        prose: '',
        excludePaths: [],
        humanPaths: [],
        owner: null,
        problems: [
          `${REVIEW_POLICY_FILE} is ${read.size} bytes, over the ${LIMITS.maxReviewPolicyBytes}-byte scan ` +
            `cap — not parsed; review proceeds under default policy`
        ]
      }
    }
  }

  const policy = composePolicy({ working: readWorkingPolicy(ctx.root), base, ref: short })
  const banners = []
  if (policy.differsFromBase) {
    banners.push(
      `POLICY DIFFERS FROM BASE: ${REVIEW_POLICY_FILE} differs from ${short}; ` +
        `its Do Not Report paths were read from ${short}`
    )
  }
  return { policy, banners }
}

const SPEC_CITATION_PATH = /^openspec\/specs\/.+\/spec\.md$/

/**
 * What `resolveReview` needs to check requirement citations: for every spec a
 * finding cites, that spec's requirement keys at the base (the start commit, or
 * the working tree for an unpinned run), or `{ unreadable }` when it could not
 * be read. Only canonical `openspec/specs/**\/spec.md` paths are read, so a
 * citation cannot make the run read an arbitrary file.
 */
export function requirementHeadingsFor(ctx, manifest, findings) {
  const ref = pinnedSha(manifest)
  const where = ref ? `at ${shortSha(ref)}` : 'in the working tree'
  const headings = new Map()
  for (const finding of applyToleranceBand(findings, null).reportable) {
    const cited = finding && typeof finding.requirement === 'string' ? finding.requirement : ''
    const hash = cited.indexOf('#')
    if (hash === -1) continue
    const path = canonicalizePath(cited.slice(0, hash).trim())
    if (!path || !SPEC_CITATION_PATH.test(path) || headings.has(path)) continue
    const read = readFileAt(ctx, ref, path)
    if (typeof read.text === 'string') {
      headings.set(path, parseSpec(read.text).requirements.map(r => r.key))
    } else if (read.absent) {
      headings.set(path, { unreadable: `${path} does not exist ${where}` })
    } else {
      headings.set(path, { unreadable: read.error || 'unreadable' })
    }
  }
  return headings
}

/** Where a capability's living spec and a change's delta spec live. */
const livingSpecPathOf = capability => `openspec/specs/${capability}/spec.md`
const deltaSpecPathOf = (change, capability) => `openspec/changes/${change}/specs/${capability}/spec.md`

/**
 * The text of the given capabilities' requirements, read from `ref` (null = the
 * working tree), and the change's own delta specs, which are always the working
 * tree's: they ARE the change. `readErrors` names every file that could not be
 * read, so a degraded assembly says why.
 */
export function assembleDomainFor(ctx, manifest, capabilities, ref, living = {}) {
  const deltas = {}
  const readErrors = []
  for (const { capability } of capabilities) {
    if (!(capability in living)) {
      const read = readFileAt(ctx, ref, livingSpecPathOf(capability))
      if (typeof read.text === 'string') living[capability] = read.text
      else if (read.error) readErrors.push(`${livingSpecPathOf(capability)}: ${read.error}`)
    }
    const delta = readFileAt(ctx, null, deltaSpecPathOf(manifest.change, capability))
    if (typeof delta.text === 'string') deltas[capability] = delta.text
  }
  const assembled = assembleDomainContext({ capabilities, living, deltas, ref })
  return { assembled, readErrors }
}

/**
 * Decide whether `domain` runs and what it is given (design D4).
 *
 * Capabilities are selected from the run's graph (`manifest.graphPath`) and from
 * the capabilities the change's delta specs declare it modifies, the latter only
 * where a living spec exists at the base. The text is assembled from the start
 * commit. Nothing here is silent: a missing graph is `partial` or `skipped`,
 * a graph that links no changed path is recorded as `notSelected` and nothing
 * else (an unlinked file is a coverage gap, not a degraded review).
 */
export function gatherDomain(ctx, manifest, changedPaths) {
  const ref = pinnedSha(manifest)
  const graph = manifest.graphPath
    ? readGraphAt(manifest.graphPath)
    : { links: null, reason: 'no graph has been built — run /interlock:bootstrap once' }
  const edges = Array.isArray(graph.links) ? livingSpecEdges(graph) : null

  const living = {}
  let specFiles = []
  try {
    specFiles = inspectChange(ctx.root, manifest.change).specFiles
  } catch {
    // A change that cannot be inspected declares nothing; the run's own checks say why.
  }
  const declared = []
  for (const rel of specFiles) {
    const capability = capabilityOf(rel)
    if (!capability || declared.includes(capability)) continue
    const read = readFileAt(ctx, ref, livingSpecPathOf(capability))
    if (typeof read.text === 'string') {
      living[capability] = read.text
      declared.push(capability)
    }
  }

  // A changed file the graph lacks selects the capability whose living spec cites it (design D6).
  const cited = edges
    ? citedSelectionInputs({
        graph,
        changedPaths,
        readAll: () => readLivingSpecs(ctx.root, ref, { gitText: ctx.deps?.gitText })
      })
    : {}
  const selection = selectDomainCapabilities({ changedPaths, edges, graphReason: graph.reason, declared, ...cited })
  let assembled = null
  let skipped = selection.skipped
  let readErrors = []
  if (selection.capabilities.length) {
    const result = assembleDomainFor(ctx, manifest, selection.capabilities, ref, living)
    assembled = result.assembled
    readErrors = result.readErrors
    if (assembled.skipped) {
      skipped = result.readErrors.length
        ? `${assembled.skipped} (${result.readErrors.join('; ')})`
        : assembled.skipped
    }
  }
  return { selection, assembled, skipped, readErrors, runs: Boolean(assembled) && !assembled.skipped }
}
