// `interlock review`, `interlock review proof`, `interlock review brief` and
// `interlock domain-context` (prove-the-review-covered-the-diff design §3, §4).
//
// The `review` case moved here from `cli/interlock`, which sits at the shipped
// file-size cap, so the proof and the two brief verbs could join it without
// growing that file. The entry file hands in what only it has (its readers,
// `die`, the policy and git helpers, the metrics writer) through `io`, as it does
// for `settleCommand`.
//
// `resolveReview` is unchanged: `coverage` and `proof` are added around it, from
// the per-dimension answers read before they are flattened.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { inspectChange, isReviewSource, readLivingSpecs, resolveChange } from './artifacts.mjs'
import { livingSpecEdges } from './drift.mjs'
import { applyToleranceBand } from './findings.mjs'
import {
  assembleDomainContext,
  citedSelectionInputs,
  domainPartialReason,
  emptiedCapabilities,
  selectDomainCapabilities
} from './prompts/domain-context.mjs'
import { assembleDimensionPrompt } from './prompts/review-dimension.mjs'
import { assembleSkepticPrompts } from './prompts/review-skeptics.mjs'
import {
  REVIEW_POLICY_FILE,
  carryForward,
  formatReview,
  readCarryFile,
  resolveReview,
  reviewRecordFlags,
  writeReviewOut
} from './review-core.mjs'
import {
  answersOf,
  computeProof,
  coverageRecord,
  mergeRerun,
  proofAnswer,
  rejectedLines,
  verdictedIds
} from './review-proof.mjs'
import { REVIEW_DEPTHS, listRouting } from './routing.mjs'
import { capabilityOf } from './spec-text.mjs'

/** Where the bundled dimension briefs live, under the plugin root. */
const DIMENSIONS_DIR = join('skills', 'review-code', 'dimensions')
/** The optional review primer a dimension prompt quotes when present. */
const REVIEW_CONTEXT_FILE = join('.claude', 'graph', 'REVIEW_CONTEXT.md')

/** The bundled dimension names, sorted: every `<name>.md` under the briefs directory. */
function bundledDimensions(pluginRoot) {
  try {
    return readdirSync(join(pluginRoot, DIMENSIONS_DIR))
      .filter(f => f.endsWith('.md'))
      .map(f => f.slice(0, -3))
      .sort()
  } catch {
    return []
  }
}

/** `--changed` as the review reads it: comma-separated, or `-` for newline-separated stdin. */
function changedOf(io, flags) {
  if (flags.changed === undefined) return []
  const given = [].concat(flags.changed)
  return given.length === 1 && given[0] === '-'
    ? io.readStdin().split('\n').map(p => p.trim()).filter(Boolean)
    : io.splitPaths(given.join(','))
}

/**
 * The changed files the proof is judged against: the union of `--changed` and
 * git's own list for `--base`, as the merge evidence takes it, so a typed list
 * that leaves a file out cannot narrow the proof. A rename's source is left out:
 * the file is cited under its new path, and no brief names the old one. Null
 * when neither was given, and when git cannot list `--base`: a proof over the
 * typed list alone could hold on a subset, so it holds on nothing (`NO_DIFF`).
 */
function provenPaths(io, root, base, given) {
  const out = [...new Set(given)]
  if (base) {
    let shape
    try {
      shape = io.diffShape(root, base)
    } catch (err) {
      io.warn(`the proof does not hold: git could not list ${base}...HEAD (${err.message})`)
      return null
    }
    if (shape.nothingToDiff) io.warn(`the proof reads only --changed: ${shape.nothingToDiff}`)
    const renamedFrom = new Set(Array.isArray(shape.renamedFrom) ? shape.renamedFrom : [])
    for (const p of Array.isArray(shape.paths) ? shape.paths : []) if (!out.includes(p) && !renamedFrom.has(p)) out.push(p)
  }
  return out.length || base ? out : null
}

/** A JSON file the review reads, or `die` naming it. */
function readJson(io, file, what) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return io.die(`${what} ${file} could not be read as JSON: ${err.message}`)
  }
}

/**
 * The files changed since `head` among `paths`, for a carried ledger's stale
 * rule: empty when there is no head to diff from, and every path, said aloud,
 * when git cannot diff it.
 */
function changedSince(io, root, head, paths) {
  if (!head) return []
  try {
    const shape = io.diffShape(root, head)
    const since = new Set(Array.isArray(shape.paths) ? shape.paths : [])
    return paths.filter(p => since.has(p))
  } catch (err) {
    if (paths.length) io.warn(`a carried entry from ${head} covers nothing: git could not diff it against HEAD (${err.message})`)
    return paths
  }
}

/**
 * A `--draft` and a `--rerun-of` write keep the per-dimension answers, so an
 * input that also holds findings outside one (a flat list, or `{ findings }`
 * with no dimension) would lose them at the next merge: refused here.
 */
function requireAnswers(io, input, what) {
  const list = Array.isArray(input) ? input : [input]
  const loose = list.filter(e => !answersOf(e).length)
  if (loose.length) {
    io.die(
      `${what} needs per-dimension answers, { "dimension", "findings", "coverage" }: ${loose.length} entr${loose.length === 1 ? 'y is' : 'ies are'} ` +
        'not one, and a draft merges answers only'
    )
  }
}

// --- interlock review ---------------------------------------------------------

function reviewRecord(io, root, flags, json) {
  // Read and validated before anything is written or printed, metrics included.
  // A `degraded` entry naming a dimension other than domain or blast-radius is
  // refused there, before anything is written.
  const { dimensions, head } = reviewRecordFlags(flags, io.die)
  // --carry keeps a scoped re-review's record whole: it needs --dimensions to
  // know what ran, and its file is read here, before anything is written.
  if (flags.carry === true) io.die('--carry needs a file')
  if (flags.carry !== undefined && !dimensions) io.die('--carry needs --dimensions: the record of what this review ran says which findings to carry')
  const carry = flags.carry === undefined ? null : readCarryFile(String(flags.carry), io.die)
  if (flags['rerun-of'] === true) io.die('--rerun-of needs a draft file')
  const draft = flags['rerun-of'] === undefined ? null : readJson(io, String(flags['rerun-of']), '--rerun-of')
  if (draft && !(draft.inputs && typeof draft.inputs === 'object')) {
    io.die(`--rerun-of ${flags['rerun-of']} carries no inputs, so it is not a draft: write it with --draft`)
  }

  // A --rerun-of write merges the re-run into the draft's inputs (D22); with no
  // --findings it promotes the draft unchanged.
  let answers
  let verdicts
  let reruns = 0
  if (draft) {
    const rerun =
      flags.findings === undefined
        ? {}
        : { answers: io.readFindingsInput(flags.findings), verdicts: flags.verdicts === undefined ? [] : io.readInput(flags.verdicts, '--verdicts') }
    if (rerun.answers !== undefined) requireAnswers(io, rerun.answers, '--rerun-of --findings')
    const merged = mergeRerun(draft, rerun)
    answers = merged.answers
    verdicts = merged.verdicts
    reruns = merged.reruns
  } else {
    answers = io.readFindingsInput(flags.findings)
    if (flags.draft !== undefined) requireAnswers(io, answers, '--draft --findings')
    verdicts = io.readInput(flags.verdicts, '--verdicts')
  }
  const findings = answers
  const changedPaths = changedOf(io, flags)

  // The repo-root REVIEW.md, if any. Its do-not-report paths are enforced
  // here as a survival filter — never handed to a model as a request. With
  // --base the two enforced lists are read from the commit at that ref (design
  // D3 of judge-against-base-and-living-specs).
  const base = io.baseRefOf(root, flags)
  const { policy, differsFromBase } = io.reviewPolicyAt(root, base)

  const result = resolveReview(findings, verdicts, {
    band: io.parseBand(flags),
    changedPaths,
    excludePaths: policy.excludePaths,
    requirementHeadings: io.requirementHeadingsAt(root, base, findings)
  })
  if (carry) carryForward(result, carry, dimensions.ran)
  const raisedCounts = carry ? { ...result.counts, surviving: result.counts.surviving - result.counts.carried } : result.counts

  // The proof of coverage, from the per-dimension answers before they were
  // flattened, beside an unchanged resolution (design §3).
  const perDimension = answersOf(findings)
  const ran = dimensions ? dimensions.ran : [...new Set(perDimension.map(a => a.dimension))]
  const proofChanged = provenPaths(io, root, base, changedPaths)
  const carriedLedgers = {}
  for (const [d, ledger] of Object.entries(result.carriedCoverage || {})) {
    const cited = ledger.checked.map(c => String(c.at).replace(/:\d+(?:-\d+)?$/, ''))
    carriedLedgers[d] = { ...ledger, staleFiles: changedSince(io, root, ledger.carriedFrom, cited) }
  }
  const carriedFindings = result.surviving
    .filter(f => f.carried === true)
    .map(f => ({ ...f, staleFiles: typeof f.file === 'string' ? changedSince(io, root, f.carriedFrom, [f.file]) : [] }))
  const { rejected, ...proof } = computeProof({
    ran,
    answers: perDimension,
    changedPaths: proofChanged,
    carried: carriedLedgers,
    carriedFindings,
    reruns
  })
  for (const line of rejectedLines(rejected)) process.stderr.write(`${line}\n`)
  const coverage = coverageRecord(perDimension, result.carriedCoverage || {})
  delete result.carriedCoverage

  // Metrics are bookkeeping: they report their own failure and never touch the
  // exit code. A draft writes none: --metrics is written once, for the final record.
  let metrics = null
  if (flags.metrics !== undefined && flags.draft === undefined) {
    if (flags.metrics === true) io.die('--metrics requires a change name')
    metrics = io.writeReviewMetrics(String(flags.metrics), raisedCounts)
    if (!metrics.written) io.warn(`metrics not written: ${metrics.reason}`)
  }

  const policyProblems = policy.problems.length
    ? `  policy: ${policy.problems.length} problem(s) in REVIEW.md\n` + policy.problems.map(p => `    - ${p}`).join('\n') + '\n'
    : ''
  const policyBase = base ? { ref: base, differsFromBase } : null
  const policyDiffers = differsFromBase
    ? `  policy: ${REVIEW_POLICY_FILE} differs from ${base}; its Do Not Report paths were read from ${base}\n`
    : ''
  const proofText = proof.proven
    ? `  proof: proven (${proof.cited} of ${proof.changed} changed source file(s) cited)\n`
    : `  proof: not proven (${proof.unproven.length} unproven, ${proof.unread.length} with unread inputs, ${proof.uncited.length} uncited${proof.reason === 'no diff given' ? '; no diff given' : ''})\n`
  const text =
    formatReview(result) +
    policyDiffers +
    policyProblems +
    proofText +
    (metrics ? `  metrics: ${metrics.written ? metrics.path : `not written (${metrics.reason})`}\n` : '') +
    (head ? `  head: ${head}\n` : '') +
    (flags.draft !== undefined ? '  draft: yes\n' : '')
  const payload = {
    ...result,
    policyProblems: policy.problems,
    ...(policyBase ? { policyBase } : {}),
    ...(metrics ? { metrics } : {}),
    ...(head ? { head } : {}),
    ...(dimensions ? { dimensions } : {}),
    coverage,
    proof,
    ...(flags.draft !== undefined ? { draft: true, inputs: { answers: perDimension.length ? perDimension : answers, verdicts } } : {})
  }
  // Written before anything is printed (see writeReviewOut).
  if (typeof flags.out === 'string') writeReviewOut(flags.out, payload, io.die)
  io.emit(json, payload, text)
}

// --- interlock review proof ---------------------------------------------------

function reviewProof(io, flags) {
  if (typeof flags.review !== 'string' || !flags.review) io.die('review proof requires --review <file>')
  let record
  try {
    record = JSON.parse(readFileSync(flags.review, 'utf8'))
  } catch (err) {
    process.stderr.write(`interlock: --review ${flags.review} could not be read as a review record: ${err.message}\n`)
    process.exit(2)
  }
  const answer = proofAnswer(record)
  if (answer.exit === 2) {
    process.stderr.write(`interlock: --review ${flags.review}: ${answer.error}\n`)
    process.exit(2)
  }
  process.stdout.write([answer.first, ...answer.reasons.map(r => `  ${r}`)].join('\n') + '\n')
  if (answer.exit !== 0) process.exitCode = answer.exit
}

// --- interlock review brief ---------------------------------------------------

/** `@@ -a,b +c,d @@` hunks of `git diff -U0 <base>...HEAD`, as `{ path, ranges }` per file. */
function changedRanges(io, root, base) {
  let out
  try {
    out = io.gitText(root, ['diff', '-U0', '--no-color', `${base}...HEAD`])
  } catch (err) {
    return io.die(`--base ${base}: git could not diff it against HEAD: ${err.message}`)
  }
  const files = []
  let current = null
  let preImage = null
  // `---`/`+++` are headers only between `diff --git` and the first hunk, so a
  // deleted line `-- x` or an added line `++ x` is never read as one.
  let inHeader = false
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHeader = true
      current = null
      preImage = null
      continue
    }
    const was = inHeader && line.match(/^--- (?:a\/)?(.+)$/)
    if (was) {
      preImage = was[1] === '/dev/null' ? null : was[1]
      continue
    }
    const file = inHeader && line.match(/^\+\+\+ (?:b\/)?(.+)$/)
    if (file) {
      // A deleted file has no post-image; it is named under its old path, with no ranges.
      current = file[1] === '/dev/null' ? null : { path: file[1], ranges: [] }
      if (current) files.push(current)
      else if (preImage) files.push({ path: preImage, ranges: [] })
      continue
    }
    if (line.startsWith('@@')) inHeader = false
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunk && current) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      if (count > 0) current.ranges.push([start, start + count - 1])
    }
  }
  return files
}

function briefDimension(io, root, flags, pluginRoot) {
  const name = String(flags.dimension)
  const names = bundledDimensions(pluginRoot)
  if (!names.includes(name)) {
    io.die(`review brief: no bundled dimension named ${JSON.stringify(name)}; the bundled dimensions are ${names.join(', ')}`)
  }
  const base = io.baseRefOf(root, flags)
  if (!base) io.die('review brief --dimension requires --base <ref>: the scope is computed from the diff against it')
  const changed = changedRanges(io, root, base)
  for (const p of changedOf(io, flags)) if (!changed.some(c => c.path === p)) changed.push({ path: p, ranges: [] })
  if (!changed.length) io.die(`review brief: ${base}...HEAD changes no file, so there is nothing to review`)

  const requested = typeof flags.change === 'string' ? flags.change : null
  let change = null
  let artifactPaths = []
  let archivedDir = null
  if (requested) {
    const resolved = resolveChange(root, requested, { archived: true })
    if (resolved.error) io.die(`review brief: ${resolved.error}`)
    change = resolved.name
    const info = inspectChange(root, resolved.name, { dir: resolved.dir, archived: resolved.archived })
    artifactPaths = [...info.present.map(f => `${resolved.dir}/${f}`), ...info.specFiles.map(f => `${resolved.dir}/specs/${f}`)]
    if (resolved.archived) {
      archivedDir = resolved.dir
      process.stderr.write(`CHANGE READ FROM ARCHIVE: ${resolved.dir}\n`)
    }
  }
  const rubric = readFileSync(join(pluginRoot, DIMENSIONS_DIR, `${name}.md`), 'utf8')
  const { policy } = io.reviewPolicyAt(root, base)
  const contextPath = join(root, REVIEW_CONTEXT_FILE)
  const reviewContext = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : null
  const domainText = name === 'domain' ? domainContextOut(io, root, { ...flags, change: change ?? undefined }, []).out.text : null
  process.stdout.write(
    assembleDimensionPrompt({
      dimension: name,
      rubric,
      base,
      head: io.headShaOf(root),
      changed,
      changedSources: changed.map(c => c.path).filter(isReviewSource),
      change,
      artifactPaths,
      archivedDir,
      policyProse: policy.prose,
      reviewContext,
      domainText
    })
  )
}

function briefSkeptics(io, flags, json) {
  if (!json) io.die('review brief --skeptics prints its prompts only as JSON, one entry per agent, so two are never run together: pass --json')
  const findings = applyToleranceBand(io.readFindingsInput(flags.findings), null).reportable
  let depth
  if (flags.depth !== undefined) {
    if (!REVIEW_DEPTHS.includes(String(flags.depth))) io.die(`--depth must be one of ${REVIEW_DEPTHS.join(', ')}`)
    depth = String(flags.depth)
  }
  const exclude = flags['rerun-of'] === undefined ? [] : verdictedIds(readJson(io, String(flags['rerun-of']), '--rerun-of'))
  const { review } = listRouting({}, { depth })
  const out = assembleSkepticPrompts({ findings, skeptics: review.skeptics, exclude })
  if (!out.prompts.length) process.stderr.write('interlock: review brief --skeptics: there is nothing to judge (no blocker or warning without a verdict)\n')
  io.emit(true, out, '')
}

// --- interlock domain-context -------------------------------------------------

/**
 * The selection and assembly a ship run's review step makes, for a hand-run
 * review (design D4 of judge-against-base-and-living-specs), with the run's
 * ordering, cited selection and partial wording (prove-the-review-covered-the-diff
 * design §5). Returns the `out` the verb prints and the lines it would print.
 */
function domainContextOut(io, root, flags, positional) {
  const base = io.baseRefOf(root, flags)
  const changed = changedOf(io, flags)
  const requested = typeof flags.change === 'string' ? flags.change : positional[1]
  const resolved = resolveChange(root, requested, { archived: true })
  const name = resolved.error ? null : resolved.name
  const dir = resolved.error ? null : resolved.dir
  if (!name) io.warn(`no change under assessment: ${resolved.error} — only the graph selects a capability`)

  const graph = io.readGraphFor(root, flags)
  const edges = Array.isArray(graph.links) ? livingSpecEdges(graph) : null

  const living = {}
  const declared = []
  let specFiles = []
  if (name) {
    try {
      specFiles = inspectChange(root, name, { dir }).specFiles
    } catch {
      // A change that cannot be inspected declares nothing.
    }
  }
  for (const rel of specFiles) {
    const capability = capabilityOf(rel)
    if (!capability || declared.includes(capability)) continue
    const read = io.readSpecText(root, base, `openspec/specs/${capability}/spec.md`)
    if (typeof read.text === 'string') {
      living[capability] = read.text
      declared.push(capability)
    }
  }
  const cited = edges
    ? citedSelectionInputs({
        graph,
        changedPaths: changed,
        readAll: () => readLivingSpecs(root, base, { gitText: io.gitText })
      })
    : {}

  const selection = selectDomainCapabilities({ changedPaths: changed, edges, graphReason: graph.reason, declared, ...cited })
  let assembled = null
  let skipped = selection.skipped
  if (selection.capabilities.length) {
    const deltas = {}
    const readErrors = []
    for (const { capability } of selection.capabilities) {
      if (!(capability in living)) {
        const read = io.readSpecText(root, base, `openspec/specs/${capability}/spec.md`)
        if (typeof read.text === 'string') living[capability] = read.text
        else if (read.error) readErrors.push(`openspec/specs/${capability}/spec.md: ${read.error}`)
      }
      if (name) {
        const delta = io.readSpecText(root, null, `${dir}/specs/${capability}/spec.md`)
        if (typeof delta.text === 'string') deltas[capability] = delta.text
      }
    }
    assembled = assembleDomainContext({ capabilities: selection.capabilities, living, deltas, ref: base })
    if (assembled.skipped) skipped = readErrors.length ? `${assembled.skipped} (${readErrors.join('; ')})` : assembled.skipped
  }
  const selected = selection.capabilities.length > 0
  const hasText = Boolean(assembled) && !assembled.skipped
  const source = assembled ? assembled.source : base ? `base ${base}` : 'the working tree'
  // `partial` is the selection's own reason or the cut, worded as the run's
  // banner words it; the cut never goes on `selection.partial` (design D6).
  const partial = hasText ? domainPartialReason(selection, assembled) : selection.partial || null
  const out = {
    change: name,
    selected,
    ref: base,
    source,
    capabilities: selection.capabilities,
    skipped: skipped || null,
    partial,
    notSelected: selection.notSelected || null,
    ungraphed: selection.ungraphed || null,
    citedUnread: selection.citedUnread || null,
    text: hasText ? assembled.text : '',
    superseded: assembled ? assembled.superseded : [],
    omitted: assembled ? assembled.omitted : [],
    emptied: assembled ? emptiedCapabilities(assembled) : [],
    specifiedByChange: assembled ? assembled.specifiedByChange : [],
    ...(resolved.archived ? { archived: true, dir } : {})
  }

  const lines = []
  if (resolved.archived) lines.push(`CHANGE READ FROM ARCHIVE: ${dir}`)
  if (out.skipped) lines.push(`DOMAIN REVIEW SKIPPED: ${out.skipped} (base: ${source})`)
  if (out.citedUnread) lines.push(`DOMAIN CITATIONS UNREAD: ${out.citedUnread}`)
  if (selected) {
    lines.push(`DOMAIN CONTEXT — ${out.capabilities.length} capabilit${out.capabilities.length === 1 ? 'y' : 'ies'}, read from ${source}`)
    for (const c of out.capabilities) {
      lines.push(`  ${c.capability}  (${c.via}${c.files.length ? `: ${c.files.join(', ')}` : ''})`)
    }
    if (out.partial && hasText) lines.push(`DOMAIN REVIEW PARTIAL: ${out.partial}`)
    if (out.omitted.length) lines.push(`  ${out.omitted.length} requirement(s) left out to fit the size cap`)
    if (out.ungraphed) for (const f of out.ungraphed.files) lines.push(`  ungraphed: ${f.path}${f.citedBy.length ? ` (cited by ${f.citedBy.join(', ')})` : ''}`)
    if (hasText) lines.push('', out.text)
  } else if (!out.skipped && out.notSelected) {
    lines.push(`DOMAIN NOT SELECTED: ${out.notSelected.reason} (base: ${source})`)
    for (const path of out.notSelected.unlinkedPaths) lines.push(`  unlinked: ${path}`)
  } else if (!out.skipped) {
    lines.push(`DOMAIN NOT SELECTED: no changed path was given (base: ${source})`)
  }
  return { out, lines }
}

/** `interlock domain-context`: exit 0 on a completed report, a skip spoken and never a failure. */
export function domainContextCommand(io, root, positional, flags, json) {
  const { out, lines } = domainContextOut(io, root, flags, positional)
  if (json && out.archived) process.stderr.write(`CHANGE READ FROM ARCHIVE: ${out.dir}\n`)
  if (json && out.citedUnread) process.stderr.write(`DOMAIN CITATIONS UNREAD: ${out.citedUnread}\n`)
  io.emit(json, out, lines.join('\n') + '\n')
}

// --- dispatch -----------------------------------------------------------------

/**
 * `interlock review [proof|brief] …`. `positional[0]` is `review`; a second
 * word `proof` or `brief` names a verb, and none is the record write.
 */
export function reviewCommand(io, root, positional, flags, json) {
  switch (positional[1]) {
    case undefined:
      return reviewRecord(io, root, flags, json)
    case 'proof':
      return reviewProof(io, flags)
    case 'brief':
      if (flags.skeptics !== undefined) return briefSkeptics(io, flags, json)
      if (typeof flags.dimension === 'string' && flags.dimension) return briefDimension(io, root, flags, io.pluginRoot)
      return io.die('review brief needs --dimension <name> or --skeptics --findings <file> --json')
    default:
      return io.die(`unknown review verb ${JSON.stringify(positional[1])}: expected proof or brief, or none to write the record`)
  }
}
