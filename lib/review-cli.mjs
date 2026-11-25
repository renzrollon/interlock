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

import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { detectLenses, selectLenses } from './artifact-lenses.mjs'
import { compareSnapshot, readChangeFiles, readSnapshot } from './artifact-snapshot.mjs'
import { inspectChange, isReviewSource, readLivingSpecs, resolveChange } from './artifacts.mjs'
import { livingSpecEdges } from './drift.mjs'
import { applyToleranceBand } from './findings.mjs'
import { LIMITS } from './limits.mjs'
import { NOTES_PATH, matchNotes, parseNotes } from './notes.mjs'
import {
  assembleDomainContext,
  citedSelectionInputs,
  domainPartialReason,
  emptiedCapabilities,
  selectDomainCapabilities
} from './prompts/domain-context.mjs'
import { summaryOf, survivingOf } from './comment-parts.mjs'
import { assembleArtifactPrompt } from './prompts/artifact-review.mjs'
import { assembleDimensionPrompt } from './prompts/review-dimension.mjs'
import { PINNED_DIFF, changedRanges, lineCount as lineCountOf } from './review-scope.mjs'
import { confirmPreExisting, renderReviewerComment, weightOf } from './review-comment.mjs'
import { assembleSkepticPrompts } from './prompts/review-skeptics.mjs'
import {
  REVIEW_POLICY_FILE,
  carryForward,
  formatReview,
  proofSourcePaths,
  readCarryFile,
  resolveReview,
  reviewRecordFlags,
  sectionOfProblem,
  writeReviewOut
} from './review-core.mjs'
import {
  answersOf,
  computeProof,
  coverageRecord,
  ignoredPathsLines,
  keptLedgerLines,
  mergeRerun,
  proofAnswer,
  rerunTargets,
  rejectedLines,
  verdictedIds
} from './review-proof.mjs'
import { targetFromGithub, targetFromGitlab, validateTarget } from './review-target.mjs'
import { REVIEW_DEPTHS, listRouting } from './routing.mjs'
import { shellQuote } from './session-env.mjs'
import { loadReview } from './settle-cli.mjs'
import { capabilityOf, specMentionedPaths } from './spec-text.mjs'

/** Where the bundled dimension briefs live, under the plugin root. */
const DIMENSIONS_DIR = join('skills', 'review-code', 'dimensions')
/** The optional review primer a dimension prompt quotes when present. */
const REVIEW_CONTEXT_FILE = join('.claude', 'graph', 'REVIEW_CONTEXT.md')
/** Where the artifact gate's bundled rubric, re-gate rules and lenses live, under the plugin root. */
const ARTIFACT_REVIEW_DIR = join('skills', 'review-artifacts')
/** The invariant sweep the base rubric names, under the plugin root. */
const INVARIANT_SWEEP_FILE = join('shared', 'INVARIANT-SWEEP.md')

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

// --- --target: a pinned pull request ----------------------------------------

/**
 * `--target <file>` on `review`, `review brief` and `domain-context` (design D11 of
 * review-a-teammates-pull-request-read-only): the root is the target's worktree, the
 * base and the head its pinned commits. `--base`, `--head` and `--root` beside it are
 * refused, so two sources never disagree, and a worktree whose own HEAD is not the
 * pinned head is refused, so a record of the wrong commit cannot be written. Null
 * without the flag. Run before any input is read.
 *
 * @returns {null | { target: object, root: string, base: string, head: string }}
 */
function bindTarget(io, flags) {
  if (flags.target === undefined) return null
  if (flags.target === true) io.die('--target needs the file interlock review target wrote')
  for (const key of ['base', 'head', 'root']) {
    if (flags[key] !== undefined) io.die(`--${key} cannot be given beside --target: the target supplies it`)
  }
  const file = String(flags.target)
  const target = readTargetFile(io, file)
  if (!existsSync(target.worktree)) {
    io.die(`--target ${file}: its worktree ${target.worktree} does not exist; create it with the target's commands.worktreeAdd`)
  }
  const at = io.headShaOf(target.worktree)
  if (at !== target.head.sha) {
    io.die(`--target ${file}: the worktree ${target.worktree} is at ${at || 'no commit'}, not the pinned head ${target.head.sha}`)
  }
  return { target, root: target.worktree, base: target.base.sha, head: target.head.sha }
}

/** The target file at `file`, checked with `validateTarget`, or `die` naming the file. */
function readTargetFile(io, file) {
  let target
  try {
    target = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return io.die(`--target ${file} could not be read as a review target: ${err.message}`)
  }
  const valid = validateTarget(target)
  if (!valid.ok) io.die(`--target ${file} is not a review target: ${valid.reason}`)
  return target
}

/** The prompt assemblers' `target` option for a bound target, or null. */
const promptTarget = bound => (bound ? { root: bound.root, runCode: bound.target.runCode === true } : null)

// --- interlock review ---------------------------------------------------------

function reviewRecord(io, root, flags, json) {
  // Under --target the code, the base and the head are the pinned pull request's;
  // the metrics still go to the state home of the directory the command runs in.
  const bound = bindTarget(io, flags)
  if (bound) root = bound.root
  // Read and validated before anything is written or printed, metrics included.
  // A `degraded` entry naming a dimension other than domain or blast-radius is
  // refused there, before anything is written.
  const { dimensions, head } = reviewRecordFlags(bound ? { ...flags, head: bound.head } : flags, io.die)
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
  let ledgerKept = []
  // The answers this write received, before any merge: a re-run's are merged
  // from validated ledgers, so a `paths` it dropped is spoken from these.
  let received = []
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
    ledgerKept = merged.ledgerKept
    received = rerun.answers || []
  } else {
    answers = io.readFindingsInput(flags.findings)
    received = answers
    if (flags.draft !== undefined) requireAnswers(io, answers, '--draft --findings')
    verdicts = io.readInput(flags.verdicts, '--verdicts')
  }
  const findings = answers
  const changedPaths = changedOf(io, flags)

  // The repo-root REVIEW.md, if any. Its do-not-report paths are enforced
  // here as a survival filter — never handed to a model as a request. With
  // --base the two enforced lists are read from the commit at that ref (design
  // D3 of judge-against-base-and-living-specs).
  const base = bound ? bound.base : io.baseRefOf(root, flags)
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
    reruns,
    sourcePaths: proofSourcePaths(policy)
  })
  for (const line of rejectedLines(rejected)) process.stderr.write(`${line}\n`)
  for (const line of keptLedgerLines(ledgerKept)) process.stderr.write(`${line}\n`)
  for (const line of ignoredPathsLines(answersOf(received))) process.stderr.write(`${line}\n`)
  const coverage = coverageRecord(perDimension, result.carriedCoverage || {})
  delete result.carriedCoverage

  // Metrics are bookkeeping: they report their own failure and never touch the
  // exit code. A draft writes none: --metrics is written once, for the final record.
  let metrics = null
  if (flags.metrics !== undefined && flags.draft === undefined) {
    if (flags.metrics === true) io.die('--metrics requires a change name')
    // A code review read by spawned agents, at the depth its dimension record names (design §6).
    const recorded = { stage: 'code', reviewer: 'agent', depth: dimensions?.depth ?? null }
    metrics = io.writeReviewMetrics(String(flags.metrics), raisedCounts, recorded)
    if (!metrics.written) io.warn(`metrics not written: ${metrics.reason}`)
  }

  const policyProblems = policy.problems.length
    ? `  policy: ${policy.problems.length} problem(s) in REVIEW.md\n` + policy.problems.map(p => `    - ${p}`).join('\n') + '\n'
    : ''
  const policyBase = base ? { ref: base, differsFromBase } : null
  const policyDiffers = differsFromBase
    ? `  policy: ${REVIEW_POLICY_FILE} differs from ${base}; its Do Not Report paths were read from ${base}\n`
    : ''
  const proseUnreadDims = (proof.proseUnread || []).map(u => u.dimension)
  const proseTail = proseUnreadDims.length ? `; prose left unread: ${proseUnreadDims.join(', ')}` : ''
  const proofText = proof.proven
    ? `  proof: proven (${proof.cited} of ${proof.changed} changed source file(s) cited${proseTail})\n`
    : `  proof: not proven (${proof.unproven.length} unproven, ${proof.unread.length} with unread inputs, ${proof.uncited.length} uncited${proof.reason === 'no diff given' ? '; no diff given' : ''}${proseTail})\n`
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

/** The hunks of `git diff -U0 <base>...HEAD`, pinned by `PINNED_DIFF`, as `{ path, ranges }` per file (`changedRanges` of `lib/review-scope.mjs`). */
function diffRanges(io, root, base, observed) {
  let out
  try {
    out = io.gitText(root, ['diff', ...PINNED_DIFF, `${base}...HEAD`])
  } catch (err) {
    return io.die(`--base ${base}: git could not diff it against HEAD: ${err.message}`)
  }
  return changedRanges(out, observed)
}

function briefDimension(io, root, flags, pluginRoot) {
  const name = String(flags.dimension)
  const names = bundledDimensions(pluginRoot)
  if (!names.includes(name)) {
    io.die(`review brief: no bundled dimension named ${JSON.stringify(name)}; the bundled dimensions are ${names.join(', ')}`)
  }
  // The review context is the reviewer's own primer: read from the directory the
  // command runs in, never from a target's worktree (D15).
  const contextPath = join(root, REVIEW_CONTEXT_FILE)
  const bound = bindTarget(io, flags)
  if (bound) root = bound.root
  const base = bound ? bound.base : io.baseRefOf(root, flags)
  if (!base) io.die('review brief --dimension requires --base <ref>: the scope is computed from the diff against it')
  // Read once: `--changed -` drains standard input, and the domain text below reads the same list.
  const givenChanged = changedOf(io, flags)
  let changed = diffRanges(io, root, base, givenChanged)
  if (!changed.length) io.die(`review brief: ${base}...HEAD changes no file, so there is nothing to review`)

  // --rerun-of <draft>: the draft's proof says what this dimension is re-run for (D4, D8, D10).
  // It never reads the cap; `review proof` is the one place that counts re-runs.
  let rerunUncited = false
  if (flags['rerun-of'] !== undefined) {
    if (flags['rerun-of'] === true) io.die('review brief: --rerun-of needs a draft file')
    const file = String(flags['rerun-of'])
    const draft = readJson(io, file, '--rerun-of')
    const proof = draft && typeof draft === 'object' && draft.proof && typeof draft.proof === 'object' ? draft.proof : null
    if (!proof || !Array.isArray(proof.dimensions)) {
      io.die(`review brief: --rerun-of ${file} carries no proof, so it names no re-run; write it with interlock review --draft`)
    }
    const unproven = Array.isArray(proof.unproven) && proof.unproven.some(u => u && u.dimension === name)
    if (!unproven) {
      if (!rerunTargets(proof).includes(name)) {
        io.die(`review brief: --rerun-of ${file} names no re-run for ${name}; the dimensions it names are ${rerunTargets(proof).join(', ') || 'none'}`)
      }
      const uncited = new Set(Array.isArray(proof.uncited) ? proof.uncited.filter(p => typeof p === 'string') : [])
      changed = changed.filter(c => uncited.has(c.path))
      if (!changed.length) {
        io.die(`review brief: none of the draft's uncited files (${[...uncited].join(', ')}) is in the changed list computed from ${base}...HEAD and --changed, so there is nothing to scope the re-run to; pass --changed with them`)
      }
      rerunUncited = true
    }
  }

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
  const reviewContext = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : null
  const domainText = name === 'domain' ? domainContextOut(io, root, { ...flags, change: change ?? undefined }, [], base, givenChanged).out.text : null
  process.stdout.write(
    assembleDimensionPrompt({
      dimension: name,
      rubric,
      base,
      head: bound ? bound.head : io.headShaOf(root),
      changed,
      changedSources: changed.map(c => c.path).filter(isReviewSource),
      change,
      artifactPaths,
      archivedDir,
      policyProse: policy.prose,
      reviewContext,
      domainText,
      rerunUncited,
      target: promptTarget(bound)
    })
  )
}

// --- interlock review brief --artifacts ---------------------------------------

/** The bundled lens names, sorted: every `<name>.md` under the lenses directory. */
function bundledLenses(pluginRoot) {
  try {
    return readdirSync(join(pluginRoot, ARTIFACT_REVIEW_DIR, 'lenses'))
      .filter(f => f.endsWith('.md'))
      .map(f => f.slice(0, -3))
      .sort()
  } catch {
    return []
  }
}

/** A bundled file the brief needs, whole, or `die` naming it: an empty rubric is never printed in its place. */
function readBundled(io, pluginRoot, rel) {
  const path = join(pluginRoot, rel)
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    return io.die(`review brief --artifacts: the bundled file ${path} could not be read: ${err.message}`)
  }
}

/** `n` with its noun, pluralised: `1 check`, `2 checks`. */
const countOf = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The review policy the artifact brief reads (design §3, D23): the prose from the
 * working tree, the lens list and the checks from HEAD, so a change being spec'd
 * cannot edit the checks it is judged under. With no commit it reads the working
 * tree for the prose alone, says the artifact sections were not read, and never
 * asks for a ref that does not resolve.
 */
function artifactPolicy(io, root) {
  const committed = Boolean(io.headShaOf(root))
  const read = io.reviewPolicyAt(root, committed ? 'HEAD' : null)
  const policy = read.policy
  const problems = []
  for (const problem of Array.isArray(policy.problems) ? policy.problems : []) {
    // Both copies report the same problem; the artifact sections are read from HEAD, so its copy is the
    // one that speaks for them, and a section-less problem is read from the working tree's copy.
    const section = sectionOfProblem(problem)
    if (section === 'artifact') {
      if (committed && problem.endsWith('(HEAD)')) problems.push(problem)
    } else if (section === null) {
      problems.push(problem.replace(/ \((working tree|HEAD)\)$/, ''))
    }
  }
  return {
    committed,
    prose: typeof policy.prose === 'string' ? policy.prose : '',
    lenses: committed ? policy.artifactLenses || [] : [],
    checks: committed ? policy.artifactChecks || [] : [],
    differs: committed && read.differsFromBase === true,
    present: existsSync(join(root, 'REVIEW.md')),
    problems: [...new Set(problems)]
  }
}

/**
 * The scoped re-gate's input (design §2 of `scope-suggest-and-evaluate-the-artifact-gate`):
 * the snapshot the gate kept beside the `--since` findings file, compared with the
 * change as it is now. Every unusable snapshot answers `{ fallback }`, a reason the
 * opening block prints beside the re-gate rules' git scoping; nothing here exits.
 */
function changedSinceOf(change, changeDir, since) {
  const target = join(dirname(resolve(since)), 'snapshots', basename(since))
  if (!existsSync(target)) return { fallback: 'no snapshot beside it' }
  let text
  try {
    text = readFileSync(target, 'utf8')
  } catch (err) {
    return { fallback: `snapshot unreadable — ${err.message}` }
  }
  const read = readSnapshot(text, change)
  if (!read.ok) {
    return { fallback: typeof read.otherChange === 'string' ? `snapshot is of ${read.otherChange}` : `snapshot unreadable — ${read.reason}` }
  }
  let files
  try {
    files = readChangeFiles(changeDir)
  } catch (err) {
    return { fallback: `snapshot unreadable — the change's files could not be read (${err.message})` }
  }
  const diff = compareSnapshot(read.snapshot, files)
  return { ...diff, totalFiles: diff.changedFiles + diff.unchanged.length, bound: LIMITS.maxRegateReworkPercent }
}

/**
 * `interlock review brief --artifacts <change> [--lens <a,b>] [--since <file>]`: the
 * artifact reviewer's whole prompt (design §1 of brief-and-record-the-artifact-gate).
 * Every I/O lives here and the assembler is pure. A refusal exits 1 through `die`
 * before anything is printed; every other degraded input is a status line in the
 * opening block and never an exit.
 */
function briefArtifacts(io, root, flags, pluginRoot) {
  if (typeof flags.artifacts !== 'string' || !flags.artifacts) {
    io.die('review brief --artifacts needs a change name: interlock review brief --artifacts <change>')
  }
  for (const other of ['dimension', 'skeptics']) {
    if (flags[other] !== undefined) {
      io.die(`review brief: --artifacts and --${other} cannot be combined: each prints a different brief, so name one`)
    }
  }
  if (flags.lens === true) io.die('review brief --artifacts: --lens needs a comma-separated list of lens names')
  if (flags.since === true) io.die('review brief --artifacts: --since needs the earlier findings file')

  const resolved = resolveChange(root, flags.artifacts)
  if (resolved.error) {
    const names = Array.isArray(resolved.candidates) && resolved.candidates.length ? `; the active changes are ${resolved.candidates.join(', ')}` : ''
    io.die(`review brief --artifacts: ${resolved.error}${names}`)
  }
  const change = resolved.name
  let since = null
  if (typeof flags.since === 'string') {
    since = flags.since
    if (!existsSync(resolve(since))) io.die(`review brief --artifacts: --since ${since} does not exist`)
  }

  // The bundled files first: a missing one is an error, never an empty part.
  const rubric = readBundled(io, pluginRoot, join(ARTIFACT_REVIEW_DIR, 'rubric.md'))
  const regate = since ? readBundled(io, pluginRoot, join(ARTIFACT_REVIEW_DIR, 're-gate.md')) : null

  const info = inspectChange(root, change)
  const regateScope = since ? changedSinceOf(change, info.path, since) : null
  const dir = `openspec/changes/${change}`
  const has = rel => existsSync(join(info.path, rel))
  const artifactPaths = [
    ...info.present.filter(f => f === 'proposal.md'),
    ...info.specFiles.map(f => `specs/${f}`),
    ...info.present.filter(f => f !== 'proposal.md'),
    ...(has('decisions.md') ? ['decisions.md'] : [])
  ].map(f => `${dir}/${f}`)
  let tasksText = ''
  if (info.present.includes('tasks.md')) {
    try {
      tasksText = readFileSync(join(info.path, 'tasks.md'), 'utf8')
    } catch {
      // An unreadable tasks.md names no path; the notes line says so.
    }
  }
  const paths = specMentionedPaths(tasksText)

  // --- the policy and the lenses
  const policy = artifactPolicy(io, root)
  const flagLenses = typeof flags.lens === 'string' ? flags.lens.split(',').map(n => n.trim()).filter(Boolean) : []
  const bundled = bundledLenses(pluginRoot)
  let detection = { detected: [], partial: null }
  if (!flagLenses.length && !policy.lenses.length) {
    let uiFiles
    try {
      uiFiles = io.gitText(root, ['ls-files', '--', '*.tsx', '*.jsx', '*.vue', '*.svelte']).split('\n').filter(Boolean)
    } catch (err) {
      uiFiles = String(err && err.message ? err.message : err)
    }
    let packageJson = null
    try {
      packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    } catch {
      // No root package.json, or one that does not parse: web-ui is then read from the tracked files alone.
    }
    const hasMarker = rel => {
      if (rel !== 'skills/*/SKILL.md') return existsSync(join(root, rel))
      try {
        return readdirSync(join(root, 'skills'), { withFileTypes: true }).some(e => e.isDirectory() && existsSync(join(root, 'skills', e.name, 'SKILL.md')))
      } catch {
        return false
      }
    }
    detection = detectLenses({ has: hasMarker, packageJson, uiFiles })
  }
  const chosen = selectLenses({
    flag: flagLenses,
    policyLenses: policy.lenses,
    detected: detection.detected,
    bundled,
    cap: LIMITS.maxArtifactLenses
  })
  const lenses = chosen.lenses.map(l => ({
    ...l,
    text: readBundled(io, pluginRoot, join(ARTIFACT_REVIEW_DIR, 'lenses', `${l.name}.md`))
  }))

  const checks = policy.checks.slice(0, LIMITS.maxArtifactChecks)
  const checksLeftOut = policy.checks.length - checks.length
  const policyStatus = [
    !policy.present && !policy.differs && !policy.checks.length && !policy.lenses.length
      ? 'no REVIEW.md'
      : policy.committed
        ? `prose from the working tree; artifact sections from HEAD (${countOf(policy.checks.length, 'check')})`
        : 'prose from the working tree; artifact sections not read: HEAD names no commit',
    ...(policy.differs ? ['REVIEW.md differs from HEAD'] : []),
    ...(checksLeftOut > 0 ? [`${countOf(checksLeftOut, 'check')} left out to fit the cap`] : [])
  ].join('; ')

  // --- the review context
  const contextPath = join(root, REVIEW_CONTEXT_FILE)
  let context = { status: `none — ${REVIEW_CONTEXT_FILE.split('\\').join('/')} is absent`, text: null }
  if (existsSync(contextPath)) {
    try {
      const text = readFileSync(contextPath, 'utf8')
      context = text.trim()
        ? { status: REVIEW_CONTEXT_FILE.split('\\').join('/'), text }
        : { status: `none — ${REVIEW_CONTEXT_FILE.split('\\').join('/')} is empty`, text: null }
    } catch (err) {
      context = { status: `unreadable — ${err.message}`, text: null }
    }
  }

  // --- the living requirements, framed once by the domain context under an artifacts lead
  const domain = domainContextOut(io, root, { ...flags, change }, [], null, paths, { subject: 'artifacts' })
  const out = domain.out
  let living
  if (out.selected && out.text) {
    const n = out.capabilities.length
    living = {
      status:
        `${n} capabilit${n === 1 ? 'y' : 'ies'} from ${out.source}` +
        (out.omitted.length ? `; ${out.omitted.length} requirement(s) left out to fit the cap` : '') +
        (out.superseded.length ? `; ${out.superseded.length} superseded by this change's delta specs, not shown` : '') +
        (domain.graphAbsent ? '; graph absent, declared capabilities only' : '') +
        (out.citedUnread ? `; partial: ${out.citedUnread}` : ''),
      text: out.text
    }
  } else if (out.selected) {
    living = { status: `none quoted — ${out.skipped || 'no requirement is in force to quote'}`, text: null }
  } else {
    const reason =
      out.skipped ||
      (out.notSelected && out.notSelected.reason) ||
      (paths.length
        ? 'no path tasks.md names is linked to a capability, and the change declares none it modifies'
        : 'tasks.md names no path, and the change declares no capability it modifies')
    living = { status: `none — ${reason}`, text: null }
  }

  // --- the compound notes: a table that cannot be read is a line, never an exit
  let notes
  const notesFile = join(root, NOTES_PATH)
  if (!paths.length) notes = { status: 'none — tasks.md names no path', rows: [] }
  else if (!existsSync(notesFile)) notes = { status: 'none — no compound notes file', rows: [] }
  else {
    try {
      const table = parseNotes(readFileSync(notesFile, 'utf8'))
      if (!table.parseable) {
        notes = { status: `unreadable — ${table.problems.map(p => p.reason).join('; ')}`, rows: [] }
      } else {
        const matched = matchNotes(table.rows, paths, LIMITS)
        const unreadable = Array.isArray(table.problems) ? table.problems.length : 0
        notes = matched.rows.length
          ? {
              status:
                countOf(matched.rows.length, 'row') +
                (matched.omitted ? `; ${matched.omitted} omitted over the cap` : '') +
                (unreadable ? `; ${unreadable} rows unreadable` : ''),
              rows: matched.rows.map(r => `${r.id} ${r.file} (${r.change}) — ${r.surprise} Rule: ${r.rule}`)
            }
          : { status: `none matched${unreadable ? `; ${unreadable} rows unreadable` : ''}`, rows: [] }
      }
    } catch (err) {
      notes = { status: `unreadable — ${err.message}`, rows: [] }
    }
  }

  process.stdout.write(
    assembleArtifactPrompt({
      change,
      artifactPaths,
      missing: info.missing,
      sweepPath: join(pluginRoot, INVARIANT_SWEEP_FILE),
      rubric,
      regate,
      since,
      changedSince: regateScope,
      lenses,
      lensNotes: { unknown: chosen.unknown, bundled, capped: chosen.capped, partial: detection.partial },
      policy: { status: policyStatus, problems: policy.problems, prose: policy.prose, checks },
      context,
      living,
      notes
    })
  )
}

function briefSkeptics(io, flags, json) {
  if (!json) io.die('review brief --skeptics prints its prompts only as JSON, one entry per agent, so two are never run together: pass --json')
  const bound = bindTarget(io, flags)
  const findings = applyToleranceBand(io.readFindingsInput(flags.findings), null).reportable
  let depth
  if (flags.depth !== undefined) {
    if (!REVIEW_DEPTHS.includes(String(flags.depth))) io.die(`--depth must be one of ${REVIEW_DEPTHS.join(', ')}`)
    depth = String(flags.depth)
  }
  const exclude = flags['rerun-of'] === undefined ? [] : verdictedIds(readJson(io, String(flags['rerun-of']), '--rerun-of'))
  const { review } = listRouting({}, { depth })
  const out = assembleSkepticPrompts({ findings, skeptics: review.skeptics, exclude, target: promptTarget(bound) })
  if (!out.prompts.length) process.stderr.write('interlock: review brief --skeptics: there is nothing to judge (no blocker or warning without a verdict)\n')
  io.emit(true, out, '')
}

// --- interlock domain-context -------------------------------------------------

/**
 * The selection and assembly a ship run's review step makes, for a hand-run
 * review (design D4 of judge-against-base-and-living-specs), with the run's
 * ordering, cited selection and partial wording (prove-the-review-covered-the-diff
 * design §5). Returns the `out` the verb prints and the lines it would print.
 * `givenBase`, when the caller already resolved it (a brief, or a bound target),
 * is used in place of `--base`; `givenChanged`, when the caller already read
 * `--changed` (a brief, whose `-` has drained standard input), in place of it.
 * `opts.subject` words the text's lead for what is judged (`'artifacts'` for the
 * artifact brief; the default keeps the diff's lead). Also returns `graphAbsent`.
 */
function domainContextOut(io, root, flags, positional, givenBase, givenChanged, opts = {}) {
  const base = givenBase !== undefined ? givenBase : io.baseRefOf(root, flags)
  const changed = givenChanged !== undefined ? givenChanged : changedOf(io, flags)
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
    assembled = assembleDomainContext({ capabilities: selection.capabilities, living, deltas, ref: base, subject: opts.subject })
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
  return { out, lines, graphAbsent: !Array.isArray(graph.links) }
}

/** `interlock domain-context`: exit 0 on a completed report, a skip spoken and never a failure. */
export function domainContextCommand(io, root, positional, flags, json) {
  // Under --target the change, the graph and the living text are read from the
  // worktree, the requirements at the target's base commit.
  const bound = bindTarget(io, flags)
  const { out, lines } = bound ? domainContextOut(io, bound.root, flags, positional, bound.base) : domainContextOut(io, root, flags, positional)
  if (json && out.archived) process.stderr.write(`CHANGE READ FROM ARCHIVE: ${out.dir}\n`)
  if (json && out.citedUnread) process.stderr.write(`DOMAIN CITATIONS UNREAD: ${out.citedUnread}\n`)
  io.emit(json, out, lines.join('\n') + '\n')
}

// --- interlock review target --------------------------------------------------

/** A word a shell reads as itself, unquoted: anything else is single-quoted. */
const PLAIN_WORD = /^[A-Za-z0-9_\/.,:@+-]+$/

/**
 * One argv as the one shell line that runs it: each word as itself when a shell reads it
 * as itself, single-quoted otherwise, so a root holding a space or a ref holding a quote
 * stays one word. The skill runs this line and never assembles one from the argv (M3).
 */
const shellLine = argv => argv.map(word => (PLAIN_WORD.test(word) ? word : shellQuote(word))).join(' ')

/**
 * `interlock review target --github <file|-> | --gitlab <file|-> [--run-code]`: the
 * platform's document in, one target file out (design "The target file is the contract").
 * Offline: the skill runs `gh` or `glab` and pipes the document in. A refusal exits 1
 * through `die` and writes nothing. What it prints carries each command a second time,
 * as the one shell line to run (`lines` under `--json`); the file does not, since
 * `validateTarget` rebuilds every command a file carries and the lines are read from
 * the printed target alone.
 */
function reviewTarget(io, root, flags, json) {
  const given = ['github', 'gitlab'].filter(k => flags[k] !== undefined)
  if (given.length !== 1) io.die('review target needs exactly one of --github <file|-> or --gitlab <file|->, the document the platform\'s CLI printed')
  const platform = given[0]
  const source = flags[platform]
  if (source === true) io.die(`--${platform} needs a file, or "-" for standard input`)
  if (flags['run-code'] !== undefined && flags['run-code'] !== true) io.die('--run-code takes no value')
  let raw
  if (source === '-') raw = io.readStdin()
  else {
    try {
      raw = readFileSync(String(source), 'utf8')
    } catch (err) {
      io.die(`--${platform} ${source} could not be read: ${err.message}`)
    }
  }
  const where = source === '-' ? '(stdin)' : source
  // An empty input, or text that is not JSON, is what the pipe carries when gh or glab
  // failed in front of it: refused before either reader runs.
  let doc
  try {
    doc = raw.trim() ? JSON.parse(raw) : undefined
  } catch {
    doc = undefined
  }
  if (doc === undefined) io.die(`--${platform} ${where}: the platform's CLI printed no document, so there is no pull request to pin`)
  let absRoot = resolve(root)
  try {
    absRoot = realpathSync(absRoot)
  } catch {
    // A root that does not resolve stays as given; the worktree command then names it.
  }
  const read = (platform === 'github' ? targetFromGithub : targetFromGitlab)(doc, { root: absRoot, runCode: flags['run-code'] === true })
  if (!read.ok) io.die(`review target: ${read.reason}`)
  const { target } = read
  const path = join(absRoot, target.file)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(target, null, 2) + '\n')
  } catch (err) {
    io.die(`review target: could not write ${path}: ${err.message}`)
  }
  const lines = Object.fromEntries(Object.entries(target.commands).map(([name, argv]) => [name, shellLine(argv)]))
  const text = [
    `target: ${target.platform} ${target.number}${target.draft ? ' (draft)' : ''} ${target.url}`,
    `  base: ${target.base.ref} ${target.base.sha}`,
    `  head: ${target.head.ref} ${target.head.sha}`,
    `  runCode: ${target.runCode}`,
    `  file: ${target.file}`,
    `  worktree: ${target.worktree}`,
    ...Object.entries(lines).map(([name, line]) => `  ${name}: ${line}`)
  ].join('\n')
  io.emit(json, { ...target, lines }, text + '\n')
}

// --- interlock review comment -------------------------------------------------

/**
 * Git's diff of `<base>...<head>`, pinned against the person's configuration (PR #46 review,
 * M1): no external diff or textconv driver, no relative mode, and the `a/` and `b/` prefixes
 * the parser strips. The files git lists as changed are read beside it, and a parsed header
 * git does not list (a configuration the pins did not reach) checks nothing. Either failure
 * is said on stderr as `PRE-EXISTING NOT CHECKED:` and confirms no mark.
 *
 * @returns {{ ranges: Array<object>|null, changedNames: string[]|null }}
 */
function preExistingDiff(io, root, base, head) {
  const range = `${base}...${head}`
  const notChecked = why => {
    process.stderr.write(`PRE-EXISTING NOT CHECKED: ${why}, so no finding reads Pre-existing\n`)
    return { ranges: null, changedNames: null }
  }
  let ranges
  let changedNames
  try {
    ranges = changedRanges(io.gitText(root, ['-c', 'core.quotePath=false', 'diff', ...PINNED_DIFF, range]), [], { marks: true })
    changedNames = io.gitText(root, ['diff', '--no-ext-diff', '--no-relative', '--name-only', '-z', range]).split('\0').filter(Boolean)
  } catch (err) {
    return notChecked(`git could not diff ${range} (${err.message})`)
  }
  const listed = new Set(changedNames)
  const stray = ranges.find(r => !listed.has(r.path))
  if (stray) return notChecked(`the diff of ${range} names ${JSON.stringify(stray.path)}, which git does not list as changed`)
  return { ranges, changedNames }
}

/**
 * `interlock review comment --review <record> --target <file> [--out <file>]`: the one
 * comment a colleague reads (design "The comment and its weights", "Pre-existing"). The
 * record must be bound to the target's head. The target's base is diffed against its head
 * in the directory the command runs in, which holds the fetched commits, and the changed
 * ranges decide which `preExisting` marks hold; a diff git cannot produce confirms none,
 * said on stderr. `--out` is written before anything is printed.
 */
function reviewComment(io, root, flags, json) {
  if (typeof flags.review !== 'string' || !flags.review) io.die('review comment requires --review <file>, the record interlock review --target wrote')
  if (typeof flags.target !== 'string' || !flags.target) io.die('review comment requires --target <file>, the file interlock review target wrote')
  if (flags.out === true) io.die('--out needs a file')
  const target = readTargetFile(io, flags.target)
  const record = loadReview(io, flags.review, '--review')
  const head = target.head.sha
  if (record.head !== head) {
    io.die(`--review ${flags.review} describes another commit: it records ${record.head || 'no head'}, and the target's head is ${head}`)
  }
  const { ranges, changedNames } = preExistingDiff(io, root, target.base.sha, head)
  // A reviewer answers under the worktree the prompt named, or under the person's own tree;
  // both are a path on the person's machine, never a name the comment publishes.
  let real = resolve(root)
  try {
    real = realpathSync(real)
  } catch {
    // An unresolvable root is still made relative as given.
  }
  const roots = [target.worktree, resolve(root), real]
  const lineCount = path => {
    try {
      return lineCountOf(io.gitText(root, ['cat-file', 'blob', `${head}:${path}`]))
    } catch {
      return null
    }
  }
  const { confirmed, refused } = confirmPreExisting(record.surviving, ranges, { changedNames, lineCount, roots })
  const findings = survivingOf(record)
  const proof = record.proof && typeof record.proof === 'object' && !Array.isArray(record.proof) ? record.proof : null
  const text = renderReviewerComment({ head, findings, proof, runCode: target.runCode === true, confirmed, roots })
  if (typeof flags.out === 'string') {
    try {
      mkdirSync(dirname(flags.out), { recursive: true })
      writeFileSync(flags.out, text)
    } catch (err) {
      io.die(`review comment: could not write --out ${flags.out}: ${err.message}`)
    }
  }
  if (refused.length) {
    process.stderr.write(
      `${refused.length} pre-existing mark${refused.length === 1 ? '' : 's'} refused; ${refused.length === 1 ? 'that finding reads' : 'those findings read'} by its severity:\n` +
        refused.map(r => `  ${r.id}: ${r.reason}\n`).join('')
    )
  }
  io.emit(
    json,
    { head, findings: findings.map(f => ({ ...summaryOf(f), weight: weightOf(f, confirmed) })), proof, runCode: target.runCode === true, preExistingRefused: refused },
    text
  )
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
    case 'target':
      return reviewTarget(io, root, flags, json)
    case 'comment':
      return reviewComment(io, root, flags, json)
    case 'brief':
      if (flags.artifacts !== undefined) return briefArtifacts(io, root, flags, io.pluginRoot)
      if (flags.skeptics !== undefined) return briefSkeptics(io, flags, json)
      if (typeof flags.dimension === 'string' && flags.dimension) return briefDimension(io, root, flags, io.pluginRoot)
      return io.die('review brief needs --dimension <name>, --skeptics --findings <file> --json, or --artifacts <change>')
    default:
      return io.die(`unknown review verb ${JSON.stringify(positional[1])}: expected proof, brief, target or comment, or none to write the record`)
  }
}
