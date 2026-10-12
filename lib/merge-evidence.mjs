// The merge-confidence gather and the run's evidence file.
//
// `lib/merge-confidence.mjs` is pure: it takes one plain object and never reads
// a file. Something has to assemble that object, and it used to be assembled
// inline by `interlock merge-confidence`. A ship run's close needs the same
// object, and two assemblers of one shape drift — the drift would show as two
// verdicts for one change. So the assembly lives here, once, and both callers
// reach it (design D1 of complete-and-record-the-merge-verdict).
//
// WHAT IT READS. From the working tree: the change and its artifacts, the
// decision ledger, the delta checklist, drift (unarchived changes and broken
// citations only — the aging tier costs one `git log` per spec and no signal
// reads it), the living list and, when no base is named, the living text. From
// the base: the review policy, the living text the list is built from, and the
// living specs the diff changed. Git is reached ONLY through `deps`
// (`diffShape`, `nameStatus`, `listFiles`, `readAtRef`), each taking the root
// first, so the module is testable without a repository and a caller with no
// git still gets an answer.
//
// DEGRADATION IS SPOKEN. A `deps` function that is absent, or that throws, never
// ends the gather: the fact that needed it stays null — which the signal reads
// as unobserved, never green — and one note per function says what could not be
// read and why. The caller speaks the notes: the command on standard error, the
// close in its degradation block.
//
// THE EVIDENCE FILE. What only a run observed (the adjudicated review, the final
// verdict, the handoff counts, the coverage figures, the run record) is written
// by the close to `.claude/ship/merge-confidence.json` and read back by
// `interlock merge-confidence --run`. It is evidence about the commit that run
// made and about nothing else (design D9), so `readRunEvidence` refuses a file
// for another commit, another change, or a run that made no commit. It is also
// evidence about one DIFF: a run reviews from its start commit to the commit it
// made, so when the caller names the base under assessment the file is used only
// when that is where the run started (design D8 of
// label-and-harden-the-merge-verdict). The assessment recorded beside the
// evidence is for a reader of the file and is never returned as an input.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspectChange, resolveChange } from './artifacts.mjs'
import { buildChecklist, buildLivingChecklist } from './conformance.mjs'
import { detectStaleSpecs, detectUnarchived, livingSpecEdges, readGraphAt } from './drift.mjs'
import { readLedger, summarize as summarizeLedger } from './ledger.mjs'
import { LIMITS } from './limits.mjs'
import { assembleDomainContext, selectDomainCapabilities } from './prompts/domain-context.mjs'
import { REVIEW_POLICY_FILE, composePolicy, parseReviewPolicy, readReviewPolicy } from './review-core.mjs'
import { canonicalizePath } from './risk.mjs'
import { specCoverageFacts } from './spec-coverage.mjs'
import { capabilityOf } from './spec-text.mjs'

/** The identifier a run's evidence file carries. A reader refuses any other. */
export const RUN_EVIDENCE_SCHEMA = 'interlock.merge-evidence/1'

/** The inputs only a caller can hand in, in the order the input object lists them. */
const SUPPLIED_KEYS = Object.freeze(['review', 'verify', 'handoff', 'pipeline', 'coverage', 'run'])

/** The evidence a run's file carries: the supplied inputs a run can observe (never the pipeline). */
const RUN_EVIDENCE_KEYS = Object.freeze(['review', 'verify', 'handoff', 'coverage', 'run'])

/** Where a repository's graph lives when the caller names no other. */
const GRAPH_FILE = join('.claude', 'graph', 'graph.json')

/** A living spec, on the canonical path form. Only these are read as specs. */
const LIVING_SPEC_PATH = /^openspec\/specs\/.+\/spec\.md$/

const livingSpecPathOf = capability => `openspec/specs/${capability}/spec.md`

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
const strings = value => (Array.isArray(value) ? value.filter(v => typeof v === 'string' && v) : [])
const messageOf = err => (err && err.message) || String(err)

/**
 * What each git function is needed for, as a note names it. One note per
 * function however many reads failed: three unreadable files at one unreachable
 * base are one fact, not three.
 */
const DEP_WHAT = Object.freeze({
  diffShape: () => 'the diff against the base',
  nameStatus: () => 'spec coverage: the files the diff adds, edits and deletes',
  listFiles: () => 'spec coverage: the tracked files at the head',
  readAtRef: uses => `files at the base (${[...uses].join(', ')})`
})

/**
 * Calls into `deps` that never throw, and the notes for the ones that could not
 * answer. `call(name, use, ...args)` returns `{ value }` or `{ failed: true }`.
 */
function gitThrough(deps) {
  const source = isObject(deps) ? deps : {}
  /** dep name -> { reason, uses } for every function that was absent or threw. */
  const failures = new Map()
  const fail = (name, use, reason) => {
    if (!failures.has(name)) failures.set(name, { reason, uses: new Set() })
    failures.get(name).uses.add(use)
    return { failed: true }
  }
  return {
    call(name, use, ...args) {
      if (typeof source[name] !== 'function') {
        return fail(name, use, `no ${name} function was supplied, so this caller has no means of reading it`)
      }
      try {
        return { value: source[name](...args) }
      } catch (err) {
        return fail(name, use, messageOf(err))
      }
    },
    notes() {
      const out = []
      for (const name of Object.keys(DEP_WHAT)) {
        const failure = failures.get(name)
        if (failure) out.push({ what: DEP_WHAT[name](failure.uses), reason: failure.reason })
      }
      return out
    }
  }
}

/** One working-tree file: `{ text }`, `{ absent: true }` or `{ error }`; never throws. */
function readWorking(root, relative) {
  const path = join(root, relative)
  try {
    if (!existsSync(path)) return { absent: true }
    return { text: readFileSync(path, 'utf8') }
  } catch (err) {
    return { error: messageOf(err) }
  }
}

/** A change's artifacts as text, keyed as `lib/risk.mjs` and the checklist read them. */
function readChangeArtifacts(root, change) {
  const info = inspectChange(root, change)
  const artifacts = {}
  for (const name of info.present) artifacts[name] = readFileSync(join(info.path, name), 'utf8')
  for (const rel of info.specFiles) {
    const path = join(info.path, 'specs', rel)
    if (existsSync(path)) artifacts[join('specs', rel)] = readFileSync(path, 'utf8')
  }
  return artifacts
}

/**
 * A change's capabilities: the capability each delta spec belongs to, through
 * `capabilityOf`, the one derivation domain selection and the spec audit share.
 */
function capabilitiesOf(root, change) {
  return inspectChange(root, change).specFiles.map(rel => capabilityOf(rel)).filter(Boolean)
}

/** The working tree's `REVIEW.md` as text plus its parsed policy, or null when absent. */
function workingPolicyCopy(root) {
  const path = join(root, REVIEW_POLICY_FILE)
  if (!existsSync(path)) return null
  let text = ''
  try {
    if (statSync(path).size <= LIMITS.maxReviewPolicyBytes) text = readFileSync(path, 'utf8')
  } catch {
    // `readReviewPolicy` reports an unreadable file as a problem.
  }
  return { text, policy: readReviewPolicy(root) }
}

/**
 * The always-human-review list, read from the base as a hosting platform reads
 * CODEOWNERS from the base branch, with the working copy compared against it.
 * Null when the base copy could not be reached at all: an unread policy is
 * unobserved, never an empty list.
 */
function reviewPolicyAtBase(root, base, git) {
  const read = git.call('readAtRef', REVIEW_POLICY_FILE, root, base, REVIEW_POLICY_FILE, {
    maxBytes: LIMITS.maxReviewPolicyBytes
  })
  if (read.failed) return null
  const at = isObject(read.value) ? read.value : {}
  let committed = null
  if (typeof at.text === 'string') {
    committed = { text: at.text, policy: parseReviewPolicy(at.text) }
  } else if (!at.absent) {
    const policy = parseReviewPolicy('')
    policy.problems.push(
      at.tooLarge
        ? `${REVIEW_POLICY_FILE} is ${at.size} bytes, over the ${LIMITS.maxReviewPolicyBytes}-byte scan ` +
            `cap — not parsed; review proceeds under default policy`
        : `${REVIEW_POLICY_FILE} at ${base} could not be read: the reader returned nothing`
    )
    committed = { text: '', policy }
  }
  const policy = composePolicy({ working: workingPolicyCopy(root), base: committed, ref: base })
  // Only the base copy's problems: an unreadable committed always-human-review
  // section is what the signal names, and a Do Not Report slip is not its business.
  const problems = (committed ? committed.policy.problems : []).filter(
    p => !/Do Not Report|excludes nothing|no exclusions applied/.test(p)
  )
  return { ref: base, humanPaths: policy.humanPaths, problems, differsFromBase: policy.differsFromBase }
}

/**
 * The living list (design D5): the selection and bounded text the `domain`
 * reviewer is given, turned into locations by `buildLivingChecklist`. The living
 * text is read from the base when one is named and from the working tree
 * otherwise. Null when a base read it needed could not be made — a list built
 * from half the text would count the wrong denominator.
 */
function gatherLiving(root, { name, changedPaths, base, graphPath, git }) {
  const readLiving = capability => {
    const relative = livingSpecPathOf(capability)
    if (!base) return readWorking(root, relative)
    const read = git.call('readAtRef', 'the living requirements', root, base, relative)
    if (read.failed) return { failed: true }
    return isObject(read.value) ? read.value : { error: 'the reader returned nothing' }
  }

  const graph = readGraphAt(graphPath || join(root, GRAPH_FILE))
  const edges = Array.isArray(graph.links) ? livingSpecEdges(graph) : null

  // Declared: a capability the change's delta specs modify that has a living spec.
  const living = {}
  const declared = []
  let specFiles = []
  if (name) {
    try {
      specFiles = inspectChange(root, name).specFiles
    } catch {
      // A change that cannot be inspected declares nothing.
    }
  }
  for (const rel of specFiles) {
    const capability = capabilityOf(rel)
    if (!capability || declared.includes(capability)) continue
    const read = readLiving(capability)
    if (read.failed) return null
    if (typeof read.text === 'string') {
      living[capability] = read.text
      declared.push(capability)
    }
  }

  const selection = selectDomainCapabilities({ changedPaths, edges, graphReason: graph.reason, declared })
  const source = base ? `base ${base}` : 'the working tree'
  if (!selection.capabilities.length) return buildLivingChecklist({ selection, assembled: { source } })

  const deltas = {}
  for (const { capability } of selection.capabilities) {
    if (!(capability in living)) {
      const read = readLiving(capability)
      if (read.failed) return null
      if (typeof read.text === 'string') living[capability] = read.text
    }
    if (name) {
      const delta = readWorking(root, `openspec/changes/${name}/specs/${capability}/spec.md`)
      if (typeof delta.text === 'string') deltas[capability] = delta.text
    }
  }
  const assembled = assembleDomainContext({ capabilities: selection.capabilities, living, deltas, ref: base })
  return buildLivingChecklist({ selection, assembled })
}

/**
 * The spec-coverage facts (design D7, D8), from text alone: the diff's added,
 * edited and deleted paths, the tracked files at the head, every living spec as
 * the working tree has it, the base text of each living spec the diff changed or
 * deleted (an untouched spec mentions the same paths on both sides), and the
 * change's own delta specs. Null when any of them could not be read.
 */
function gatherSpecCoverage(root, { name, artifacts, base, headSha, git }) {
  const status = git.call('nameStatus', 'spec coverage', root, base, headSha)
  const listed = git.call('listFiles', 'spec coverage', root, headSha || 'HEAD')
  if (status.failed || listed.failed) return null
  const changed = isObject(status.value) ? status.value : {}
  const sourceFiles = strings(listed.value)

  const livingAtHead = []
  for (const tracked of sourceFiles) {
    const path = canonicalizePath(tracked)
    if (!path || !LIVING_SPEC_PATH.test(path)) continue
    const read = readWorking(root, path)
    if (typeof read.text === 'string') livingAtHead.push({ path, text: read.text })
  }

  const changedSpecsAtBase = []
  const seen = new Set()
  for (const entry of [...strings(changed.modified), ...strings(changed.deleted)]) {
    const path = canonicalizePath(entry)
    if (!path || seen.has(path) || !LIVING_SPEC_PATH.test(path)) continue
    seen.add(path)
    const read = git.call('readAtRef', 'the living specs the diff changed', root, base, path)
    if (read.failed) return null
    if (isObject(read.value) && typeof read.value.text === 'string') {
      changedSpecsAtBase.push({ path, text: read.value.text })
    }
  }

  const deltaSpecs = []
  if (name) {
    for (const [key, text] of Object.entries(artifacts)) {
      const relative = key.replace(/\\/g, '/')
      if (relative.startsWith('specs/')) deltaSpecs.push({ path: `openspec/changes/${name}/${relative}`, text })
    }
  }

  return specCoverageFacts({
    added: strings(changed.added),
    modified: strings(changed.modified),
    sourceFiles,
    livingAtHead,
    changedSpecsAtBase,
    deltaSpecs
  })
}

/**
 * The living list on its own, for `interlock conformance --living` (design D5):
 * the same selection, text and bound the merge gather uses, so the list a person
 * prints by hand and the one the verdict counts cannot differ for one change,
 * base and graph. `living` is null when a base read it needed could not be made,
 * and `notes` then says why.
 *
 * @param {string} root
 * @param {{ change?: string|null, changedPaths?: string[], base?: string|null, graphPath?: string,
 *   deps?: { readAtRef?: Function } }} given
 * @returns {{ living: object|null, notes: { what: string, reason: string }[] }}
 */
export function gatherLivingList(root = '.', { change, changedPaths, base: baseRef, graphPath, deps } = {}) {
  const base = typeof baseRef === 'string' && baseRef ? baseRef : null
  const git = gitThrough(deps)
  const living = gatherLiving(root, {
    name: typeof change === 'string' && change ? change : null,
    changedPaths: [...new Set(strings(changedPaths))],
    base,
    graphPath,
    git
  })
  return { living, notes: git.notes() }
}

/**
 * Gather the input `assessMergeConfidence` takes (design D1).
 *
 * @param {string} root
 * @param {object} given
 * @param {string|null} [given.change]  the requested change name; resolved from the repository when omitted
 * @param {string[]} [given.changedPaths]  the caller's changed paths; git's own list is added when a base is named
 * @param {string|null} [given.base]  the ref the diff, the review policy and the living text are read against
 * @param {string|null} [given.headSha]
 * @param {object} [given.supplied]  what only a caller can hand in: review, verify, handoff, pipeline, coverage, run
 * @param {object} [given.deps]  git, root first: diffShape(root, base, headSha), nameStatus(root, base, headSha),
 *   listFiles(root, ref), readAtRef(root, ref, path, { maxBytes })
 * @param {string} [given.graphPath]  the graph to select living requirements from; the root's own when omitted
 * @returns {{ input: object, notes: { what: string, reason: string }[] }}
 */
export function gatherMergeEvidence(
  root = '.',
  { change: requested, changedPaths: given, base: baseRef, headSha: head, supplied, deps, graphPath } = {}
) {
  const base = typeof baseRef === 'string' && baseRef ? baseRef : null
  const headSha = typeof head === 'string' && head ? head : null
  const git = gitThrough(deps)
  const notes = []

  // With a base, git's own file list is a changed-path source: a path the
  // caller left out still reaches risk, conformance and drift.
  let changedPaths = [...new Set(strings(given))]
  let diff = null
  if (base) {
    const shape = git.call('diffShape', 'the diff', root, base, headSha)
    if (!shape.failed && isObject(shape.value)) {
      diff = shape.value
      const named = new Set(changedPaths)
      changedPaths = [...changedPaths, ...strings(diff.paths).filter(p => !named.has(p))]
      changedPaths = [...new Set(changedPaths)]
    }
  }

  // What the repository itself says.
  const name = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined
  const resolved = resolveChange(root, name)
  const changeName = resolved.error ? null : resolved.name
  if (!changeName) {
    notes.push({
      what: 'no change under assessment',
      reason: `${resolved.error} — its ledger, artifacts and scenarios are not read`
    })
  }
  const change = changeName ? { name: changeName, capabilities: capabilitiesOf(root, changeName) } : null
  const artifacts = changeName ? readChangeArtifacts(root, changeName) : {}
  let ledger = null
  if (changeName) {
    const parsed = readLedger(root, changeName)
    ledger = {
      ...summarizeLedger(parsed),
      rows: parsed.rows.map(r => ({ id: r.id, question: r.question, class: r.class, valid: r.valid }))
    }
  }
  const checklist = buildChecklist(root, changeName || name, { changed: changedPaths })

  // Drift, for what the signal reads and no more: complete, unarchived changes
  // (each with its capabilities, so the overlap can be read) and broken
  // citations. A `lastCommit` that knows nothing skips the per-spec `git log`
  // the aging tier needs, and the aging tier is left out rather than reported
  // empty.
  const { aging: _notAsked, ...stale } = detectStaleSpecs(root, { lastCommit: () => null })
  const drift = {
    unarchived: detectUnarchived(root).map(u => ({ ...u, capabilities: capabilitiesOf(root, u.change) })),
    stale
  }

  const reviewPolicy = base ? reviewPolicyAtBase(root, base, git) : null
  const living = gatherLiving(root, { name: changeName, changedPaths, base, graphPath, git })
  // A diff that is empty by construction has no added or edited file to judge.
  const specCoverage =
    base && !(diff && typeof diff.nothingToDiff === 'string')
      ? gatherSpecCoverage(root, { name: changeName, artifacts, base, headSha, git })
      : null

  // Passed through as given, and null when not given: a signal reads null as unobserved.
  const fromCaller = isObject(supplied) ? supplied : {}
  const handed = Object.fromEntries(SUPPLIED_KEYS.map(key => [key, fromCaller[key] ?? null]))

  return {
    input: {
      change,
      changedPaths,
      headSha,
      artifacts,
      review: handed.review,
      verify: handed.verify,
      checklist,
      handoff: handed.handoff,
      pipeline: handed.pipeline,
      coverage: handed.coverage,
      diff,
      ledger,
      drift,
      reviewPolicy,
      run: handed.run,
      living,
      specCoverage
    },
    notes: [...notes, ...git.notes()]
  }
}

/**
 * The object a run's close writes to `.claude/ship/merge-confidence.json`
 * (design D9). The five evidence entries are always present, null for what the
 * run did not observe; `result` is the assessment, for a reader of the file.
 */
export function buildRunEvidence({ change, runId, base, headSha, committed, evidence, result } = {}) {
  const observed = isObject(evidence) ? evidence : {}
  return {
    schema: RUN_EVIDENCE_SCHEMA,
    change: change ?? null,
    runId: runId ?? null,
    base: base ?? null,
    headSha: headSha ?? null,
    committed: committed === true,
    evidence: Object.fromEntries(RUN_EVIDENCE_KEYS.map(key => [key, observed[key] ?? null])),
    result: result ?? null
  }
}

/**
 * Whether a run's evidence file may be used for the commit under assessment
 * (design D9), and what it supplies when it may. Usable only when the file
 * carries the published schema identifier, names the change under assessment,
 * says the run committed, and records as that commit the head. Otherwise nothing
 * is taken from it and `reason` names the condition that failed. The recorded
 * assessment is never returned. Never throws and never mutates the file.
 *
 * `base` adds one condition, applied after those four and only when it is given
 * (design D8 of label-and-harden-the-merge-verdict). A run reviewed the diff
 * from the commit it started on to the commit it made, and the file ends at the
 * same head whatever lies under it: a pull request of five commits whose last
 * came from a reviewed run is not a reviewed pull request. So `{ sha }`, the
 * merge base of the base under assessment and the head, must equal the base the
 * file records; `{ unreadable: true }` (git gave no merge base, as in a shallow
 * clone) refuses the file. Left `undefined`, nothing changes: no base is ever
 * taken from the file, so the signals that need one stay unobserved.
 *
 * @param {unknown} file  the parsed file
 * @param {{ change?: string|null, headSha?: string|null,
 *   base?: { sha: string } | { unreadable: true } }} against
 * @returns {{ usable: true, evidence: object } | { usable: false, reason: string }}
 */
export function readRunEvidence(file, { change, headSha, base } = {}) {
  const refuse = reason => ({ usable: false, reason })
  if (!isObject(file)) return refuse('it does not hold a JSON object')
  if (file.schema !== RUN_EVIDENCE_SCHEMA) {
    return refuse(
      `its schema identifier is ${JSON.stringify(file.schema ?? null)}, not ${JSON.stringify(RUN_EVIDENCE_SCHEMA)}`
    )
  }
  if (!isObject(file.evidence)) return refuse(`it carries the schema identifier ${RUN_EVIDENCE_SCHEMA} and no evidence`)
  if (typeof change !== 'string' || !change || file.change !== change) {
    return refuse(
      `it names the change ${JSON.stringify(file.change ?? null)}, not the change under assessment ` +
        `(${JSON.stringify(change ?? null)})`
    )
  }
  if (file.committed !== true) {
    return refuse('the run that wrote it made no commit, so it describes a working tree no later command can name')
  }
  if (typeof headSha !== 'string' || !headSha) {
    return refuse(`the head commit could not be read, so the commit it records (${file.headSha}) matches nothing`)
  }
  if (file.headSha !== headSha) {
    return refuse(`it describes another commit: it records ${file.headSha}, and the head is ${headSha}`)
  }
  if (base !== undefined && base !== null) {
    const reviewedFrom = typeof file.base === 'string' && file.base ? file.base : null
    const reviewed = `the run reviewed the diff from ${reviewedFrom ?? 'a base it did not record'} to ${file.headSha}`
    const mergeBase = isObject(base) && typeof base.sha === 'string' && base.sha ? base.sha : null
    if (!mergeBase) {
      return refuse(
        `${reviewed}, and the merge base of the base under assessment and the head could not be read, ` +
          `so the two diffs cannot be compared (a shallow clone lacks it: raise the fetch depth)`
      )
    }
    if (reviewedFrom !== mergeBase) {
      return refuse(`${reviewed}, and the diff under assessment runs from the merge base ${mergeBase} to ${headSha}`)
    }
  }
  return {
    usable: true,
    evidence: Object.fromEntries(RUN_EVIDENCE_KEYS.map(key => [key, file.evidence[key] ?? null]))
  }
}
