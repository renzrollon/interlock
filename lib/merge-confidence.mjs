// Merge confidence: one answer to "can this be merged?".
//
// After a ship run the only machine facts about mergeability were "no blocker
// survived" and "the unit suite is green". Everything else a merge decision
// needs was computed somewhere and never combined — surviving warnings, the
// risk class over the paths actually touched, skipped verifications,
// unconfirmed conformance scenarios, open ledger rows, the diff's size, the
// platform's own checks — and the one surface that pronounced on it was prose
// a model re-argued on every run. This module combines them, in code.
//
// The output is a three-way verdict a platform rule can branch on (MERGE,
// HUMAN, BLOCK) and a bounded score a person can sort by:
//
//   - THE WORST BAND WINS. Each gating signal reads green, amber, red or
//     unobserved; the verdict is BLOCK on any red, MERGE only when every signal
//     is green, HUMAN otherwise. Unobserved ranks as amber. No count of greens
//     lifts a single amber or red — averaging is how a critical signal gets
//     diluted by volume, which `lib/risk.mjs` already refuses.
//   - A FLAG LOWERS THE SCORE AND NEVER MOVES A BAND. "No e2e suite exists
//     here" is worth knowing and worth a point, and is not a reason to stop.
//   - THE SCORE IS BOUNDED BY THE WORST BAND. Its range comes from
//     `MERGE_BANDS.ceiling`; the share of gating signals that are green with no
//     flag positions it inside the range, so a red can never outscore an amber
//     and two changes in one band still sort.
//
// Signals live in one frozen registry. The formula (`combineSignals`) never
// names a signal, so adding one is one registry entry and one fixture. Every
// registered gating signal has a producer, so a clean, reviewed, verified change
// can read MERGE; a signal whose fact the caller did not gather reads
// unobserved and says so, never green by default.
//
// Every threshold is read from `MERGE_BANDS` (lib/limits.mjs) and cited by its
// published name in the reason that applies it. A threshold restated here as a
// literal is a test failure.
//
// Pure: no fs, no git, no network, no agent, no clock. The CLI gathers every
// fact (`interlock merge-confidence`) and hands this module one plain object.

import { MERGE_BANDS } from './limits.mjs'
import { classifyRisk, canonicalizePath, MERGE_ALLOWED_CLASSES } from './risk.mjs'
import { BLOCKING_KINDS, SKIP_REASONS } from './verify.mjs'
import { normalizeSeverity, SEVERITIES } from './findings.mjs'
import { pathExcludedBy } from './review-core.mjs'
import { PIPELINE_STATES } from './pipeline.mjs'

/** The four bands a gating signal may read. */
const BANDS = Object.freeze(['green', 'amber', 'red', 'unobserved'])

// Worse is later. Used both for the worst band over signals and, inside one
// signal, to take the worse of two facts: there amber outranks unobserved,
// because a stated fact is worse news than a missing one.
const SEVERITY_ORDER = Object.freeze(['green', 'unobserved', 'amber', 'red'])
const rank = band => SEVERITY_ORDER.indexOf(band)

/** What would lift a non-green signal: a person, more evidence, or a fix. */
const KINDS = Object.freeze(['person', 'evidence', 'finding'])
// When two facts at one band disagree on what would lift them, the one that
// no evidence can lift is the one to report.
const KIND_PRIORITY = Object.freeze(['finding', 'person', 'evidence'])
const KIND_LABELS = Object.freeze({
  finding: 'needs a fix',
  person: 'needs a person',
  evidence: 'needs more evidence'
})

/**
 * The published flag vocabulary (design D2). A flag outside it is a defect and
 * is rejected, never carried: this list is the only vocabulary a reader has to
 * match against. `domain-skipped` is raised by the review.ran reader from a
 * review record that names the domain dimension as skipped, and
 * `blast-radius-skipped` the same way for the blast-radius dimension; `legacy-unspecced`
 * is raised by the spec-coverage reader for an edited file nothing names;
 * `no-graph` by the drift and living-conformance readers; `requirements-omitted`
 * by the living-conformance reader when the size bound cut the list;
 * `unmeasured-source` by the coverage reader when the input names changed source
 * the report does not list.
 */
export const FLAGS = Object.freeze([
  'no-e2e',
  'no-typecheck',
  'no-coverage',
  'no-baseline',
  'no-pipeline',
  'docs-only-changes',
  'dimensions-unrecorded',
  'domain-skipped',
  'blast-radius-skipped',
  'legacy-unspecced',
  'no-graph',
  'requirements-omitted',
  'unmeasured-source'
])

/**
 * The labels a merge request carries for a verdict and a score, defined here and
 * nowhere else (design D14 of label-and-harden-the-merge-verdict). The command
 * prints them under `labels`; the `mr` skill applies what it is handed and holds
 * no label name of its own. `color` is six hexadecimal digits with no `#`, the
 * form a platform's label command takes. The score label's name is `scorePrefix`
 * followed by the integer score, unpadded.
 */
export const MERGE_LABELS = Object.freeze({
  verdicts: Object.freeze({
    MERGE: Object.freeze({
      name: 'interlock/merge',
      color: '0e8a16',
      description: 'Interlock merge confidence: every gating signal is green for the assessed commit'
    }),
    HUMAN: Object.freeze({
      name: 'interlock/human-review',
      color: 'fbca04',
      description: 'Interlock merge confidence: the assessed commit needs a person or more evidence'
    }),
    BLOCK: Object.freeze({
      name: 'interlock/blocked',
      color: 'b60205',
      description: 'Interlock merge confidence: a gating signal is red for the assessed commit'
    })
  }),
  scorePrefix: 'interlock/score-',
  score: Object.freeze({
    color: 'c5def5',
    description: 'Interlock merge-confidence score for the assessed commit, bounded by its worst band'
  })
})

/**
 * How to recognise a label this module names, with no verdict behind it: the
 * three verdict label names and the prefix every score label starts with. The
 * command prints it for a caller whose assessment stopped, which has a label
 * from an earlier assessment to take off and no verdict of its own to read the
 * names from.
 *
 * @returns {{ verdictNames: string[], scorePrefix: string }}
 */
export function mergeLabelNames() {
  return {
    verdictNames: Object.values(MERGE_LABELS.verdicts).map(label => label.name),
    scorePrefix: MERGE_LABELS.scorePrefix
  }
}

/** The labels for one verdict and score: the two to apply, and how to recognise their predecessors. */
function labelsFor(verdict, score) {
  return {
    verdict: { ...MERGE_LABELS.verdicts[verdict] },
    score: {
      name: `${MERGE_LABELS.scorePrefix}${score}`,
      color: MERGE_LABELS.score.color,
      description: MERGE_LABELS.score.description
    },
    ...mergeLabelNames()
  }
}

// Coverage figures are percentages a tool printed; this absorbs the binary
// representation error of a subtraction, so a decline of exactly the tolerance
// is judged as exactly the tolerance.
const ROUNDING_SLACK = 1e-9

function fail(message) {
  const err = new Error(message)
  err.userFacing = true
  throw err
}

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)
const list = v => (Array.isArray(v) ? v : [])
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const tally = v => (Array.isArray(v) ? v.length : num(v) ?? 0)
const notGiven = flag => `the ${flag} input was not given`

// --- result builders -----------------------------------------------------------

const evidenceOr = (evidence, reason) => (evidence && evidence.length ? evidence : [reason])
const green = (reason, evidence, flags = []) => ({ band: 'green', flags, kind: null, reason, evidence: evidenceOr(evidence, reason) })
const amber = (kind, reason, evidence) => ({ band: 'amber', flags: [], kind, reason, evidence: evidenceOr(evidence, reason) })
const red = (reason, evidence) => ({ band: 'red', flags: [], kind: 'finding', reason, evidence: evidenceOr(evidence, reason) })
const unobserved = (reason, evidence) => ({ band: 'unobserved', flags: [], kind: 'evidence', reason, evidence: evidenceOr(evidence, reason) })

// --- review (design D5) ----------------------------------------------------------

const reviewOf = input => (isObject(input.review) ? input.review : null)
const findingLabel = f => `${f.file || '(unscoped)'} — ${f.title || '(untitled)'}`
const verdictsOf = f => (isObject(f.votes) ? num(f.votes.total) ?? 0 : 0)

/** The surviving findings, or a result saying why there are none to read. */
function survivingOf(input, what) {
  const review = reviewOf(input)
  if (!review) return { stop: unobserved(`no review to ${what}: ${notGiven('--review')}`) }
  if (!Array.isArray(review.surviving)) {
    return { stop: unobserved(`the --review input carries no "surviving" list, so no finding could be ${what === 'read' ? 'read' : 'adjudicated'}`) }
  }
  return { review, found: review.surviving.filter(isObject) }
}

function readReviewBlockers(input) {
  const { stop, found } = survivingOf(input, 'read')
  if (stop) return stop
  const blockers = found.filter(f => normalizeSeverity(f.severity) === 'blocker')
  const malformed = found.filter(f => normalizeSeverity(f.severity) === null)
  if (blockers.length || malformed.length) {
    const parts = []
    if (blockers.length) parts.push(`${blockers.length} surviving blocker(s)`)
    if (malformed.length) parts.push(`${malformed.length} surviving finding(s) with a severity outside ${SEVERITIES.join('|')}`)
    return red(parts.join(' and '), [
      ...blockers.map(f => `blocker: ${findingLabel(f)}`),
      ...malformed.map(
        f => `severity ${JSON.stringify(f.severity)} is not one of ${SEVERITIES.join('|')}, rejected: ${findingLabel(f)}`
      )
    ])
  }
  return green(`no surviving blocker among ${found.length} surviving finding(s)`, [
    `${found.length} surviving finding(s): no blocker, no unrecognised severity`
  ])
}

function readReviewWarnings(input, bands) {
  const { stop, found } = survivingOf(input, 'read')
  if (stop) return stop
  const cap = bands.maxWarningsForMerge
  const cite = `MERGE_BANDS.maxWarningsForMerge = ${cap}`
  const warnings = found.filter(f => normalizeSeverity(f.severity) === 'warning')
  const evidence = warnings.map(f => `warning: ${findingLabel(f)}`)
  if (warnings.length > cap) {
    return amber('finding', `${warnings.length} surviving warning(s) exceed ${cite}`, evidence)
  }
  return green(`${warnings.length} surviving warning(s), at or under ${cite}`, evidence.length ? evidence : ['no surviving warning'])
}

function readReviewRan(input) {
  const review = reviewOf(input)
  if (!review) return amber('evidence', `no review ran: ${notGiven('--review')}`)
  const dims = review.dimensions
  if (!isObject(dims)) {
    return green(
      'the review carries its counts but no dimension record, so which dimensions ran is unrecorded',
      [`counts: ${JSON.stringify(isObject(review.counts) ? review.counts : null)}`, 'no dimension record in the review input'],
      ['dimensions-unrecorded']
    )
  }
  const named = v => list(v).filter(s => typeof s === 'string')
  const evidence = [
    `selected: ${named(dims.selected).join(', ') || '(none)'}`,
    `ran: ${named(dims.ran).join(', ') || '(none)'}`
  ]
  const problems = []
  if (dims.completed === false) problems.push('the review did not complete')
  const unavailable = named(dims.unavailable)
  if (unavailable.length) problems.push(`selected dimension(s) could not run with their rubric: ${unavailable.join(', ')}`)
  // A selected dimension the record says neither ran, nor was unavailable, nor
  // was a permitted skip has no record of running, so "every selected dimension
  // ran" would be a guess. Only a `domain` or `blast-radius` skip accounts for a
  // selected dimension (the review-code record lists a graphless blast-radius in
  // `selected` and `skipped`, not `ran`); any other skipped name stays unaccounted.
  const permittedSkips = list(dims.skipped)
    .filter(s => isObject(s) && (s.name === 'domain' || s.name === 'blast-radius'))
    .map(s => s.name)
  const accounted = new Set([...named(dims.ran), ...unavailable, ...permittedSkips])
  const unaccounted = named(dims.selected).filter(id => !accounted.has(id))
  if (unaccounted.length) problems.push(`selected dimension(s) with no record that they ran: ${unaccounted.join(', ')}`)
  // A skipped domain or blast-radius review lowers the score and moves no band:
  // the other dimensions still ran with their rubrics. Only the names `domain`
  // and `blast-radius` raise the flags.
  const domainSkipped = list(dims.skipped).find(s => isObject(s) && s.name === 'domain')
  const flags = []
  if (domainSkipped) {
    flags.push('domain-skipped')
    const why = typeof domainSkipped.reason === 'string' && domainSkipped.reason ? `: ${domainSkipped.reason}` : ''
    evidence.push(`domain review skipped${why}`)
  }
  const blastSkipped = list(dims.skipped).find(s => isObject(s) && s.name === 'blast-radius')
  if (blastSkipped) {
    flags.push('blast-radius-skipped')
    const why = typeof blastSkipped.reason === 'string' && blastSkipped.reason ? `: ${blastSkipped.reason}` : ''
    evidence.push(`blast-radius review skipped${why}`)
  }
  if (problems.length) return { ...amber('evidence', problems.join('; '), evidence), flags }
  return green(
    flags.length
      ? 'every selected dimension ran with its rubric, or was a recorded domain or blast-radius skip'
      : 'every selected dimension ran with its rubric',
    evidence,
    flags
  )
}

function readReviewAdversarial(input, bands) {
  const { stop, review, found } = survivingOf(input, 'adjudicate')
  if (stop) return stop
  const floor = bands.minVerdictsPerFinding
  const cite = `MERGE_BANDS.minVerdictsPerFinding = ${floor}`
  const rejected = isObject(review.counts) ? num(review.counts.dismissalsRejected) ?? 0 : 0
  const thin = found
    .filter(f => ['blocker', 'warning'].includes(normalizeSeverity(f.severity)))
    .filter(f => verdictsOf(f) < floor)
  // A finding the quality band removed is in neither `surviving` nor
  // `dismissed`: the skeptics' vote kept it, and their scores said it was badly
  // written. For a warning that is the band doing its job. For a blocker, or a
  // severity the gate would reject, it is a blocker no signal above can see, and
  // a verdict that lets a change merge with nobody looking must not rest on it.
  const dropped = list(review.droppedByQuality)
    .filter(isObject)
    .filter(f => !['warning', 'suggestion'].includes(normalizeSeverity(f.severity)))
  const problems = []
  if (dropped.length) problems.push(`${dropped.length} blocker(s) the skeptics' vote kept and the quality band then removed`)
  if (rejected > 0) problems.push(`${rejected} refutation(s) refused for citing nothing`)
  if (thin.length) problems.push(`${thin.length} surviving blocker or warning finding(s) with fewer verdicts than ${cite}`)
  const evidence = [
    `refused refutations: ${rejected}`,
    ...thin.map(f => `${verdictsOf(f)} verdict(s): ${findingLabel(f)}`),
    ...dropped.map(f => `dropped by the quality band, severity ${JSON.stringify(f.severity ?? null)}: ${findingLabel(f)}`)
  ]
  // More verdicts or a citation lift the other two; a dropped blocker is lifted
  // by someone reading it.
  if (problems.length) return amber(dropped.length ? 'person' : 'evidence', problems.join('; '), evidence)
  return green(`every surviving blocker and warning has at least ${cite}, no refutation was refused, and the quality band removed no blocker`, evidence)
}

// --- risk (design D8; paths only at merge, design D9 of close-the-merge-request-loop) ---

// The merge-time reading is the touched paths and nothing else: the change's
// artifact prose is not handed in, documentation and test paths sit outside the
// severity path rules, and the text-only idempotency signal cannot fire here.
// Reversal is this one call: drop `pathsOnly` and pass the artifacts again.
function readRisk(input, bands, policy) {
  const result = classifyRisk({ changedPaths: list(input.changedPaths) }, { pathsOnly: true })
  const allowed = list(policy.allowedClasses)
  const cite = `MERGE_ALLOWED_CLASSES (${allowed.join(', ')})`
  const driving = result.signals.filter(s => s.class === result.riskClass)
  const evidence = [`class ${result.riskClass}`, ...driving.map(s => `${s.signal}: ${s.evidence}`)]
  if (allowed.includes(result.riskClass)) return green(`class ${result.riskClass} is within ${cite}`, evidence)
  // Never red: touching a sensitive path is a reason for a person to decide,
  // not a defect the machine found. The classifier's own fail-closed answer for
  // empty input is amber too, not unobserved — the classifier did answer.
  const why = result.basis === 'no-input' ? ` — ${result.reasons[0]}` : ''
  return amber('person', `class ${result.riskClass} is outside ${cite}, so a person decides${why}`, evidence)
}

// --- verification (design D3, D6) -----------------------------------------------------

const verdictOfInput = input => (isObject(input.verify) ? input.verify : null)
const skippedEntry = (verdict, kind) => list(verdict.skipped).find(s => isObject(s) && s.kind === kind) || null

/** One fact inside a signal: a band, what would lift it, and a line saying why. */
const fact = (band, kind, text, flags = []) => ({ band, kind: band === 'green' ? null : kind, text, flags })

/**
 * The worse of several facts, as one signal result. The band, kind and reason
 * come from the worst fact; the flags come from every fact, because a flag is
 * reported with its signal whatever the band.
 */
function worseOf(facts) {
  const worst = facts.reduce((w, f) => (rank(f.band) > rank(w) ? f.band : w), 'green')
  const atWorst = facts.filter(f => f.band === worst)
  const kind = worst === 'green' ? null : KIND_PRIORITY.find(k => atWorst.some(f => f.kind === k)) || 'evidence'
  const flags = [...new Set(facts.flatMap(f => f.flags))]
  return {
    band: worst,
    flags,
    kind,
    reason: atWorst.map(f => f.text).join('; '),
    evidence: facts.map(f => f.text)
  }
}

/** How one skipped verification kind resolves, one band per skip reason. */
function skipFact(verdict, kind) {
  const entry = skippedEntry(verdict, kind)
  if (!entry) return fact('unobserved', 'evidence', `${kind} was planned and no result was reported`)
  const reason = entry.reason
  const detail = entry.detail ? ` (${entry.detail})` : ''
  if (reason === SKIP_REASONS.DOCS_ONLY) {
    return fact('green', null, `${kind} skipped: every changed path is documentation (${reason})`, ['docs-only-changes'])
  }
  if (reason === SKIP_REASONS.BUDGET_EXCEEDED) {
    return fact('unobserved', 'evidence', `${kind} was skipped: ${reason} — the verification budget was spent before it ran${detail}`)
  }
  if (reason === SKIP_REASONS.PRE_EXISTING) {
    return fact('amber', 'person', `${kind} was skipped: ${reason} — the suite was red before this change, so merging onto it is a person's call`)
  }
  if (kind === 'typecheck' && reason === SKIP_REASONS.NO_COMMAND) {
    return fact('green', null, `typecheck skipped: the profile names no type-check command (${reason})`, ['no-typecheck'])
  }
  if (kind === 'unit' && (reason === SKIP_REASONS.NO_PROFILE || reason === SKIP_REASONS.NO_COMMAND)) {
    // Never a flag: the ship loop refuses to run unattended without a test
    // profile, so a repository with no unit evidence has not merely skipped a tool.
    return fact('amber', 'evidence', `unit was skipped: ${reason} — this change has no unit evidence${detail}`)
  }
  return fact('amber', 'evidence', `${kind} was skipped for a reason this signal does not name (${reason}), so it fails closed`)
}

function unitFact(verdict) {
  const unit = isObject(verdict.unit) ? verdict.unit : null
  if (!unit) return skipFact(verdict, 'unit')
  if (unit.halt === true || ['red', 'weakened', 'error'].includes(unit.status)) {
    return fact('red', 'finding', `unit failed: ${unit.reason || unit.status}`)
  }
  if (unit.status === 'red-pre-existing') {
    return fact(
      'amber',
      'person',
      `unit is red and its failures are pre-existing (${SKIP_REASONS.PRE_EXISTING}): this change did not make it red, and merging onto a red suite is a person's call`
    )
  }
  if (unit.status === 'green') return fact('green', null, `unit: ${unit.reason || 'green'}`)
  return fact('amber', 'evidence', `unit reported a status this signal does not name (${unit.status}), so it fails closed`)
}

function typecheckFact(verdict) {
  const typecheck = isObject(verdict.typecheck) ? verdict.typecheck : null
  if (!typecheck) return skipFact(verdict, 'typecheck')
  if (typecheck.passed === true) return fact('green', null, 'typecheck passed')
  if (typecheck.passed === false) {
    const how = typecheck.ran === false ? 'it could not run' : `exit ${typecheck.exitCode}`
    return fact('red', 'finding', `typecheck failed (${how})`)
  }
  return fact('unobserved', 'evidence', 'typecheck reported a result with no "passed" field')
}

const KIND_FACTS = Object.freeze({ unit: unitFact, typecheck: typecheckFact })

/** The final verdict, or the result saying why it cannot be read. */
function finalVerdictOf(input) {
  const verdict = verdictOfInput(input)
  if (!verdict) return { stop: unobserved(`no verification verdict to read: ${notGiven('--verify')}`) }
  if (verdict.context !== 'final') {
    return {
      stop: unobserved(
        `the verification verdict is from the ${JSON.stringify(verdict.context ?? null)} gate, not the final one`
      )
    }
  }
  return { verdict }
}

function readSuite(input) {
  const { stop, verdict } = finalVerdictOf(input)
  if (stop) return stop
  // Each blocking kind on its own, never `verdict.halt`: the final gate does
  // not halt on a failed type check, and that is a statement about whether the
  // run stops, not about whether the result can be merged.
  return worseOf(BLOCKING_KINDS.map(kind => KIND_FACTS[kind](verdict)))
}

function readE2e(input) {
  const { stop, verdict } = finalVerdictOf(input)
  if (stop) return stop
  const e2e = isObject(verdict.e2e) ? verdict.e2e : null
  if (e2e) {
    if (e2e.passed === true) return green('e2e passed', [`e2e: ${e2e.reason || 'green'}`])
    return amber('finding', `e2e ran and failed (${e2e.reason || e2e.status || 'no reason given'})`)
  }
  const entry = skippedEntry(verdict, 'e2e')
  if (!entry) return unobserved('e2e was planned and no result was reported')
  const reason = entry.reason
  if (reason === SKIP_REASONS.DOCS_ONLY) return green(`e2e skipped: every changed path is documentation (${reason})`)
  if (
    [SKIP_REASONS.E2E_DISABLED, SKIP_REASONS.E2E_NOT_REQUESTED, SKIP_REASONS.NO_PROFILE, SKIP_REASONS.NO_COMMAND].includes(
      reason
    )
  ) {
    return green(`no end-to-end suite is enabled or requested here (${reason})`, [`e2e skipped: ${reason}`], ['no-e2e'])
  }
  if (reason === SKIP_REASONS.BUDGET_EXCEEDED) {
    return unobserved(`e2e was skipped: ${reason} — the verification budget was spent before it ran`)
  }
  return amber('evidence', `e2e was skipped for a reason this signal does not name (${reason}), so it fails closed`)
}

// --- coverage (design D7) -------------------------------------------------------------

function readCoverage(input, bands) {
  const coverage = isObject(input.coverage) ? input.coverage : null
  if (coverage && coverage.configured === false) {
    return green('coverage is not configured in this repository (the --coverage input says so)', [], ['no-coverage'])
  }
  if (!coverage) {
    const verdict = verdictOfInput(input)
    const entry = verdict && verdict.context === 'final' ? skippedEntry(verdict, 'coverage') : null
    if (entry && entry.reason === SKIP_REASONS.COVERAGE_NOT_CONFIGURED) {
      return green(
        `coverage is not configured in this repository (the final verification verdict skipped it as ${entry.reason})`,
        [],
        ['no-coverage']
      )
    }
    return unobserved(`no coverage figures to read: ${notGiven('--coverage')}`)
  }

  const sizeFloor = bands.minChangedLinesForCoverage
  const tolerance = bands.maxCoverageDeclinePts
  const patchFloor = bands.patchCoverageFloorPct
  const lines = num(coverage.changedLines)
  const head = num(coverage.headTotalPct)
  const base = num(coverage.baseTotalPct)
  const diffPct = num(coverage.diffPct)
  const evidence = [
    `changed lines: ${lines ?? 'unknown'}`,
    `head total: ${head ?? 'unknown'}%`,
    `base total: ${base ?? 'none'}%${coverage.baseSha ? ` at ${coverage.baseSha}` : ''}`,
    `changed-line coverage: ${diffPct ?? 'unknown'}%`
  ]

  // Changed source the report never saw (design D13). A report lists the files
  // the tests loaded, so a new file no test loads counts neither for nor against
  // any figure above. It is named in the evidence of every reading and flags a
  // green one; it never moves a band, because a report cannot tell a file no
  // test loaded from one the project left out of coverage on purpose.
  const stated = Array.isArray(coverage.unreportedFiles)
  const unreported = stated ? coverage.unreportedFiles.filter(f => typeof f === 'string' && f) : []
  if (!stated) {
    evidence.push('the coverage input does not state unreported files, so changed source the report never saw cannot be named')
  } else if (unreported.length) {
    const added = num(coverage.unreportedAddedLines)
    evidence.push(
      `${unreported.length} changed source file(s) the coverage report does not list, ` +
        `${added ?? 'an unstated number of'} added line(s) in them: ${unreported.join(', ')}`
    )
  } else {
    evidence.push('no changed source file is missing from the coverage report')
  }
  const greenWith = (reason, flags = []) => green(reason, evidence, unreported.length ? [...flags, 'unmeasured-source'] : flags)

  // A change of exactly the floor is judged; only a smaller one is exempt.
  if (lines !== null && lines < sizeFloor) {
    return greenWith(`${lines} changed line(s) is under MERGE_BANDS.minChangedLinesForCoverage = ${sizeFloor}, so coverage is not judged`)
  }
  if (base !== null) {
    if (coverage.baseIsAncestor !== true) {
      return unobserved(
        `the baseline commit ${coverage.baseSha || '(unnamed)'} is not an ancestor of the head, so its total says nothing certain about this change`,
        evidence
      )
    }
    if (head === null) return unobserved('the coverage input carries a base total but no head total', evidence)
    const compared = `head ${head}% against base ${base}% (MERGE_BANDS.maxCoverageDeclinePts = ${tolerance})`
    if (base - head <= tolerance + ROUNDING_SLACK) return greenWith(`coverage held within the tolerance: ${compared}`)
    return amber('finding', `coverage fell by more than the tolerance: ${compared}`, evidence)
  }
  if (diffPct === null) {
    return unobserved('the coverage input carries neither a base total nor a changed-line coverage figure', evidence)
  }
  const patch = `${diffPct}% of changed lines covered (MERGE_BANDS.patchCoverageFloorPct = ${patchFloor}), with no baseline to compare against`
  if (diffPct >= patchFloor) return greenWith(patch, ['no-baseline'])
  return amber('finding', `changed-line coverage is below the patch floor: ${patch}`, evidence)
}

// --- the platform's pipeline (design D7) -----------------------------------------------

function readPipeline(input) {
  const pipeline = isObject(input.pipeline) ? input.pipeline : null
  if (!pipeline) return unobserved(`no pipeline checks to read: ${notGiven('--pipeline')}`)

  // A check the caller left out stays visible wherever the verdict is shown,
  // whatever band the signal reads (design D6).
  const excluded = list(pipeline.excluded).filter(n => typeof n === 'string' && n)
  const named = result =>
    excluded.length ? { ...result, evidence: [...result.evidence, ...excluded.map(n => `excluded by the caller: ${n}`)] } : result

  // An input that is not well-formed is never an input with no checks (design
  // D7). The command refuses such a file before assessing; this is the second
  // line of defence, for a caller that builds the input itself. An absent or
  // misspelt list and an empty list are different statements: read alike, a
  // misspelt key hides a failed required check behind a green signal.
  if (!Array.isArray(pipeline.checks)) {
    return named(unobserved('the pipeline input is not well-formed: it carries no "checks" list, and an absent list is not an empty one'))
  }
  const stray = pipeline.checks.findIndex(c => !isObject(c))
  if (stray !== -1) {
    return named(unobserved(`the pipeline input is not well-formed: checks[${stray}] is not an object`))
  }
  const checks = pipeline.checks
  const nameOf = c => c.name || '(unnamed check)'
  const failedRequired = checks.filter(c => c.state === 'fail' && c.required === true)
  const head = typeof input.headSha === 'string' && input.headSha ? input.headSha : null

  // The commit check runs first on purpose: a failure on another commit says
  // nothing certain about the head, which may have fixed it. It is named in
  // the evidence so it is not hidden, and it does not read red.
  if (!head || pipeline.sha !== head) {
    const reason = head
      ? `the pipeline input describes another commit (${pipeline.sha || '(none)'}), not the head (${head})`
      : 'the head commit is unknown, so the pipeline input cannot be matched to it'
    return named(
      unobserved(reason, [
        `pipeline sha: ${pipeline.sha || '(none)'}; head: ${head || 'unknown'}`,
        ...failedRequired.map(c => `failed required check on another commit: ${nameOf(c)}`)
      ])
    )
  }
  const evidence = checks.map(c => `${nameOf(c)}: ${c.state}${c.required === true ? ' (required)' : ''}`)
  if (failedRequired.length) {
    return named(
      red(
        `${failedRequired.length} required check(s) failed on the head commit: ${failedRequired.map(nameOf).join(', ')}`,
        failedRequired.map(c => `failed required check: ${nameOf(c)}`)
      )
    )
  }
  const pending = checks.filter(c => c.state === 'pending')
  if (pending.length) {
    return named(unobserved(`${pending.length} check(s) still pending on the head commit: ${pending.map(nameOf).join(', ')}`, evidence))
  }
  const failedOptional = checks.filter(c => c.state === 'fail')
  if (failedOptional.length) {
    return named(
      amber('finding', `${failedOptional.length} non-required check(s) failed on the head commit: ${failedOptional.map(nameOf).join(', ')}`, evidence)
    )
  }
  if (!checks.length) {
    return named(green('the pipeline input records no checks for the head commit', [`pipeline sha ${pipeline.sha}: no checks`], ['no-pipeline']))
  }
  const unknown = checks.filter(c => !PIPELINE_STATES.includes(c.state))
  if (unknown.length) {
    return named(
      amber(
        'evidence',
        `check(s) in a state this signal does not name, so it fails closed: ${unknown.map(c => `${nameOf(c)}=${c.state}`).join(', ')}`,
        evidence
      )
    )
  }
  return named(green(`${checks.length} check(s) passed or were skipped on the head commit`, evidence))
}

// --- delta conformance (design D6) ---------------------------------------------------

function readDeltaConformance(input) {
  const checklist = isObject(input.checklist) ? input.checklist : null
  if (!checklist || checklist.skipped === true) {
    const why = checklist && checklist.reason ? checklist.reason : 'no checklist was gathered'
    return amber('evidence', `the conformance checklist could not be built: ${why}`)
  }
  // The denominator is always the command's own count. A count carried in the
  // handoff is never read, so a caller cannot shrink it.
  const counted = Number.isInteger(checklist.verdictsRequired) ? checklist.verdictsRequired : null
  if (counted === null) return amber('evidence', 'the conformance checklist carries no scenario count')
  const source = list(checklist.changedFiles).filter(f => typeof f === 'string')
  if (counted === 0) {
    if (source.length) {
      return amber(
        'finding',
        'the delta specs carry no scenario, so the change promised no behaviour for the source it changed',
        source.map(f => `changed source: ${f}`)
      )
    }
    return green('the delta specs carry no scenario and no changed path is coverable source, so there is nothing to confirm', [
      'no scenario counted; no changed coverable source'
    ])
  }
  const handoff = isObject(input.handoff) ? input.handoff : null
  if (!handoff) return unobserved(`the delta specs carry ${counted} scenario(s) and ${notGiven('--handoff')}`)
  const checked = Number.isInteger(handoff.scenariosChecked) ? handoff.scenariosChecked : null
  const unconfirmed = Number.isInteger(handoff.scenariosUnconfirmed) ? handoff.scenariosUnconfirmed : null
  if (checked === null || unconfirmed === null) {
    return amber('evidence', 'the handoff input carries no scenariosChecked or scenariosUnconfirmed count')
  }
  const evidence = [`${checked} of ${counted} scenario(s) checked (the command counted ${counted}); ${unconfirmed} unconfirmed`]
  if (handoff.verdictsRequired !== undefined) {
    evidence.push(`the handoff's own count (${JSON.stringify(handoff.verdictsRequired)}) is ignored`)
  }
  if (unconfirmed > 0) return amber('evidence', `${unconfirmed} of ${counted} scenario(s) unconfirmed`, evidence)
  if (checked !== counted) {
    return amber('evidence', `${checked} of ${counted} scenario(s) were checked; the denominator is the command's own count`, evidence)
  }
  return green(`${checked} of ${counted} scenario(s) checked, none unconfirmed`, evidence)
}

// --- living conformance (design D6) -----------------------------------------------------

const withFlags = (result, flags) => ({ ...result, flags })

function readLivingConformance(input) {
  const living = isObject(input.living) ? input.living : null
  if (!living) return unobserved('the living-requirement list was not gathered')
  // A list built without a graph and with nothing declared selects nothing: the
  // change touches no requirement anyone can name, which the flag says.
  if (typeof living.skipped === 'string' && living.skipped) {
    return green(`no living requirement could be selected: ${living.skipped}`, [`living list skipped: ${living.skipped}`], ['no-graph'])
  }
  // The denominator is always the command's own count. A count carried in the
  // handoff is never read, so a caller cannot shrink it.
  const counted = Number.isInteger(living.requirementsRequired) ? living.requirementsRequired : null
  if (counted === null) return amber('evidence', 'the living-requirement list carries no requirement count')
  const partial = typeof living.partial === 'string' && living.partial ? living.partial : null
  const omitted = list(living.omitted).filter(isObject)
  const partialLine = partial ? [`partial list: ${partial}`] : []
  // What the size bound left out: a flag, and how many were asked beside how
  // many were not. It is said whatever the count is, a count of none included.
  const omittedLines = omitted.length
    ? [
        `${counted} requirement(s) asked and ${omitted.length} left out by the size bound`,
        ...omitted.map(o => `left out: ${o.capability}: ${o.heading}`)
      ]
    : []
  // Both flags describe the list, not the answers, so every reading of the
  // answers carries them: a cut list whose answers came back unconfirmed was
  // still cut, and the reader of an amber signal is the one who needs to know.
  const flags = [...(partial ? ['no-graph'] : []), ...(omitted.length ? ['requirements-omitted'] : [])]
  const listLines = [...partialLine, ...omittedLines]
  if (counted === 0) {
    return green(
      omitted.length
        ? 'no living requirement was asked: the size bound left every one of them out, so there is nothing to confirm'
        : 'no living requirement is in force for the capabilities this change touches, so there is nothing to confirm',
      ['0 living requirement(s) listed', ...listLines],
      flags
    )
  }
  const handoff = isObject(input.handoff) ? input.handoff : null
  if (!handoff) {
    return unobserved(`${counted} living requirement(s) listed and no answers: ${notGiven('--handoff')}`)
  }
  const checked = Number.isInteger(handoff.requirementsChecked) ? handoff.requirementsChecked : null
  const unconfirmed = Number.isInteger(handoff.requirementsUnconfirmed) ? handoff.requirementsUnconfirmed : null
  if (checked === null || unconfirmed === null) {
    return withFlags(
      amber('evidence', `${counted} living requirement(s) listed and the handoff input carries no requirementsChecked or requirementsUnconfirmed count`, listLines),
      flags
    )
  }
  const evidence = [
    `${checked} of ${counted} living requirement(s) checked (the command counted ${counted}); ${unconfirmed} unconfirmed`,
    ...partialLine
  ]
  if (handoff.requirementsRequired !== undefined) {
    evidence.push(`the handoff's own count (${JSON.stringify(handoff.requirementsRequired)}) is ignored`)
  }
  evidence.push(...omittedLines)
  if (unconfirmed > 0) {
    return withFlags(amber('evidence', `${unconfirmed} of ${counted} living requirement(s) unconfirmed`, evidence), flags)
  }
  if (checked !== counted) {
    return withFlags(
      amber('evidence', `${checked} of ${counted} living requirement(s) were checked; the denominator is the command's own count`, evidence),
      flags
    )
  }
  return green(`${checked} of ${counted} living requirement(s) checked, none unconfirmed`, evidence, flags)
}

// --- spec coverage (design D8) -------------------------------------------------------------

function readSpecCoverage(input) {
  const diff = isObject(input.diff) ? input.diff : null
  if (!diff) return unobserved(`no base to tell an added file from an edited one: ${notGiven('--base')}`)
  if (typeof diff.nothingToDiff === 'string') return unobserved(diff.nothingToDiff)
  const facts = isObject(input.specCoverage) ? input.specCoverage : null
  if (!facts) return unobserved('the spec-coverage facts were not gathered')

  const added = list(facts.added).filter(isObject)
  const unnamed = added.filter(a => !a.namedBy)
  const lost = list(facts.lost).filter(isObject)
  const legacy = list(facts.legacy).filter(f => typeof f === 'string')
  const repo = isObject(facts.repo) ? facts.repo : null
  const repoLine = repo && num(repo.named) !== null && num(repo.total) !== null
    ? `${repo.named} of ${repo.total} tracked coverable source file(s) are named by a spec`
    : null

  if (unnamed.length || lost.length) {
    const parts = []
    if (unnamed.length) parts.push(`${unnamed.length} added source file(s) no spec names: ${unnamed.map(a => a.path).join(', ')}`)
    if (lost.length) {
      parts.push(`${lost.length} kept file(s) lost the spec that named them: ${lost.map(l => `${l.path} (${l.spec})`).join(', ')}`)
    }
    return amber('finding', parts.join('; '), [
      ...unnamed.map(a => `added, named by no spec: ${a.path}`),
      ...lost.map(l => `named by ${l.spec} at the base, by nothing now: ${l.path}`),
      ...(repoLine ? [repoLine] : [])
    ])
  }

  const evidence = [
    ...added.map(a => `${a.path} is named by a ${a.namedBy === 'living' ? 'living spec' : 'delta spec of this change'} (${a.namedBy})`)
  ]
  if (legacy.length) evidence.push(`${legacy.length} edited file(s) no spec names: ${legacy.join(', ')}`)
  if (repoLine) evidence.push(repoLine)
  const reason = added.length
    ? `every one of the ${added.length} added source file(s) is named by a spec`
    : 'the diff adds no coverable source file, so there is nothing to name'
  return green(reason, evidence, legacy.length ? ['legacy-unspecced'] : [])
}

// --- the review policy, read from the base (design D3) -----------------------------------

function readHumanPaths(input) {
  const policy = isObject(input.reviewPolicy) ? input.reviewPolicy : null
  if (!policy) return unobserved('no --base was given: there is no base to read the review policy from')
  const ref = typeof policy.ref === 'string' && policy.ref ? policy.ref : 'the base'
  const prefixes = list(policy.humanPaths).filter(p => typeof p === 'string')
  const listed = prefixes.map(p => ({ raw: p, canonical: canonicalizePath(p) })).filter(p => p.canonical)
  const facts = []

  const problems = list(policy.problems).filter(p => typeof p === 'string')
  for (const problem of problems) facts.push(fact('amber', 'person', `${ref} REVIEW.md: ${problem}`))

  if (policy.differsFromBase === true) {
    facts.push(
      fact(
        'amber',
        'person',
        `REVIEW.md differs from ${ref}; its always-human-review list was read from ${ref}${listed.length ? ` (${listed.map(p => p.canonical).join(', ')})` : ''}`
      )
    )
  }

  const touched = list(input.changedPaths).filter(p => typeof p === 'string')
  for (const path of touched) {
    const under = listed.find(p => pathExcludedBy(path, p.canonical))
    if (under) facts.push(fact('amber', 'person', `${path} falls under ${under.canonical}/, listed under Always Human Review in ${ref} REVIEW.md`))
  }

  if (facts.length) return worseOf(facts)
  return green(`no changed path falls under the ${listed.length} always-human-review path(s) listed at ${ref}`, [
    `always-human-review paths read from ${ref}: ${listed.map(p => p.canonical).join(', ') || '(none)'}`,
    `${touched.length} changed path(s), none under a listed path`
  ])
}

// --- diff shape, ledger, run, drift ------------------------------------------------------

function readDiffShape(input, bands) {
  const diff = isObject(input.diff) ? input.diff : null
  if (!diff) return unobserved(`no base to diff against: ${notGiven('--base')}`)
  // A base that is HEAD or ahead of it diffs empty by construction: an empty
  // diff there proves nothing about the change, so it is never read as small.
  if (typeof diff.nothingToDiff === 'string') return unobserved(diff.nothingToDiff)
  const lines = num(diff.changedLines)
  const files = num(diff.changedFiles)
  if (lines === null || files === null) return unobserved('the diff carries no changed-line or changed-file count')
  const maxLines = bands.maxChangedLinesForMerge
  const maxFiles = bands.maxChangedFilesForMerge
  const evidence = [`${lines} changed line(s) (added plus deleted), ${files} changed file(s)`]
  if (num(diff.binaryFiles)) evidence.push(`${diff.binaryFiles} binary file(s), each counted as one file and no lines`)
  const over = []
  if (lines > maxLines) over.push(`${lines} changed line(s) exceed MERGE_BANDS.maxChangedLinesForMerge = ${maxLines}`)
  if (files > maxFiles) over.push(`${files} changed file(s) exceed MERGE_BANDS.maxChangedFilesForMerge = ${maxFiles}`)
  if (over.length) return amber('person', over.join('; '), evidence)
  return green(
    `${lines} changed line(s) and ${files} changed file(s), at or under MERGE_BANDS.maxChangedLinesForMerge = ${maxLines} and MERGE_BANDS.maxChangedFilesForMerge = ${maxFiles}`,
    evidence
  )
}

function readDecisions(input) {
  const ledger = isObject(input.ledger) ? input.ledger : null
  if (!ledger) return amber('evidence', 'no decision ledger was read: no change is under assessment, so name one')
  if (ledger.changeExists === false) return amber('person', 'the change directory does not exist, so no ledger can clear it')
  // Missing is a failure of the audit, never "nothing to decide".
  if (ledger.missing === true || ledger.exists === false) {
    return amber('person', 'the decision ledger is missing (decisions.md): a failure of the audit, not an empty ledger')
  }
  if (ledger.unparseable === true) return amber('person', 'the decision ledger is present and nobody can parse it')
  const rows = list(ledger.rows).filter(isObject)
  const needsHuman = num(ledger.needsHuman) ?? 0
  const invalid = num(ledger.invalidCount) ?? num(ledger.invalid) ?? 0
  const problems = []
  const evidence = []
  if (needsHuman > 0) {
    problems.push(`${needsHuman} needs-human row(s)`)
    evidence.push(...rows.filter(r => r.class === 'needs_human').map(r => `needs_human ${r.id}: ${r.question}`))
  }
  if (invalid > 0) {
    problems.push(`${invalid} invalid row(s)`)
    evidence.push(...rows.filter(r => r.valid === false).map(r => `invalid ${r.id}: ${r.question}`))
  }
  if (problems.length) return amber('person', `the decision ledger holds ${problems.join(' and ')}`, evidence)
  return green(`${num(ledger.total) ?? rows.length} ledger row(s), none needing a person and none invalid`, rows.map(r => `${r.class} ${r.id}`))
}

/**
 * The observations a run's close records, by the keys the record uses for them
 * (design D9), and what counts as each having been made.
 */
const isFlag = v => typeof v === 'boolean'
const isCount = v => Array.isArray(v) || num(v) !== null
const RUN_OBSERVATIONS = Object.freeze([
  ['halted', isFlag],
  ['trajectoryComplete', isFlag],
  ['stageMarkerGaps', isCount],
  ['rejectedReports', isCount],
  ['permissionPrompts', isCount],
  ['autoModeDenials', isCount],
  ['leftoverTasks', isCount]
])

function readRunIntegrity(input) {
  const run = isObject(input.run) ? input.run : null
  if (!run) return unobserved('no run record: this assessment was not made by a ship run, which writes one at close')
  const problems = []
  if (run.halted === true) problems.push('the run halted')
  if (run.trajectoryComplete === false) problems.push('its trajectory is incomplete')
  if (tally(run.stageMarkerGaps) > 0) problems.push(`${tally(run.stageMarkerGaps)} stage marker(s) were not published`)
  if (tally(run.rejectedReports) > 0) problems.push(`${tally(run.rejectedReports)} handoff report(s) were rejected`)
  if (tally(run.permissionPrompts) > 0) problems.push(`${tally(run.permissionPrompts)} permission prompt(s) occurred`)
  if (tally(run.autoModeDenials) > 0) problems.push(`${tally(run.autoModeDenials)} auto-mode denial(s) occurred`)
  if (tally(run.leftoverTasks) > 0) problems.push(`${tally(run.leftoverTasks)} task(s) of the change left unticked`)
  // A REVIEW.md that differs from the base ref is policy.humanPaths' question,
  // not the run's; reading it here too would move two signals on one fact.
  // A recorded degradation wins: a halt beside missing counts still needs a person.
  if (problems.length) return amber('person', `the run degraded: ${problems.join('; ')}`)
  // An observation the record does not carry is unobserved, never a zero: a host
  // that observed no permission prompt and a host that could not observe one are
  // different facts.
  const missing = RUN_OBSERVATIONS.filter(([key, made]) => !made(run[key])).map(([key]) => key)
  if (missing.length) {
    return unobserved(
      `the run record does not carry every observation, and one nobody made is not a zero: ${missing.join(', ')}`,
      missing.map(key => `not observed: ${key}`)
    )
  }
  return green('the run completed with no degradation')
}

function readDrift(input) {
  const drift = isObject(input.drift) ? input.drift : null
  if (!drift) return unobserved('drift was not gathered for this assessment')
  const stale = isObject(drift.stale) ? drift.stale : {}
  const canonical = p => canonicalizePath(p) || p
  const touched = new Set(list(input.changedPaths).filter(p => typeof p === 'string').map(canonical))

  // Only what this change did: a citation of a file this change touched and
  // that no longer exists. A broken citation elsewhere is drift's backlog.
  const broken = list(stale.broken)
    .filter(isObject)
    .filter(b => typeof b.file === 'string' && touched.has(canonical(b.file)))

  const change = isObject(input.change) ? input.change : null
  const name = change && typeof change.name === 'string' ? change.name : null
  const mine = new Set(change ? list(change.capabilities) : [])
  const competing = []
  for (const other of list(drift.unarchived).filter(isObject)) {
    if (name && other.change === name) continue
    if (!name) {
      competing.push(`${other.change} is complete and unarchived, and with no change under assessment every one counts`)
      continue
    }
    if (!Array.isArray(other.capabilities)) {
      competing.push(`${other.change} is complete and unarchived, and its capabilities were not gathered, so the overlap fails closed`)
      continue
    }
    const shared = other.capabilities.filter(c => mine.has(c))
    if (shared.length) {
      competing.push(`${other.change} is complete and unarchived and also has delta specs for ${shared.join(', ')}`)
    }
  }

  const noGraph = stale.skipped === true
  const flags = noGraph ? ['no-graph'] : []
  const evidence = [
    ...(noGraph ? [`the stale-citation check did not run: ${stale.reason || 'no usable graph'}`] : []),
    ...broken.map(b => `${b.spec} cites ${b.file}, which this change removed`),
    ...competing
  ]
  if (broken.length || competing.length) {
    const parts = []
    if (broken.length) parts.push(`${broken.length} living-spec citation(s) of a file this change removed`)
    if (competing.length) parts.push(`${competing.length} other complete, unarchived change(s) on a capability this change also touches`)
    return { band: 'amber', flags, kind: broken.length ? 'finding' : 'person', reason: parts.join('; '), evidence }
  }
  if (noGraph) {
    return green(`the stale-citation check did not run, so its empty result is not read as clean: ${stale.reason || 'no usable graph'}`, evidence, flags)
  }
  return green('no living spec cites a file this change removed, and no other unarchived change shares its capabilities', [
    `${list(stale.broken).length} broken citation(s) repo-wide, none of a file this change touched`,
    `${list(drift.unarchived).length} unarchived change(s), none on this change's capabilities`
  ])
}

// --- informational -------------------------------------------------------------------------

function readPlanFidelity(input) {
  const reason = isObject(input.run)
    ? 'the run record carries no planned and touched path sets in this version'
    : 'no run record'
  return {
    band: null,
    flags: [],
    kind: null,
    reason,
    evidence: [isObject(input.run) ? reason : 'no run record: plan fidelity is reported from a ship run, and this assessment has none']
  }
}

// --- the registry ----------------------------------------------------------------------------

const signal = (id, read, gating = true) => Object.freeze({ id, family: id.slice(0, id.indexOf('.')), gating, read })

/**
 * Every registered signal, in the order the spec lists them: seventeen gating
 * signals, then the one informational signal. `read(input, bands, policy)`
 * returns `{ band, flags, evidence, reason, kind }`. The formula never names a
 * signal; adding one is an entry here and a fixture.
 */
export const SIGNALS = Object.freeze([
  signal('review.blockers', readReviewBlockers),
  signal('review.warnings', readReviewWarnings),
  signal('review.ran', readReviewRan),
  signal('review.adversarial', readReviewAdversarial),
  signal('risk.class', readRisk),
  signal('verify.suite', readSuite),
  signal('verify.e2e', readE2e),
  signal('verify.coverage', readCoverage),
  signal('ci.pipeline', readPipeline),
  signal('conformance.delta', readDeltaConformance),
  signal('conformance.living', readLivingConformance),
  signal('spec.coverage', readSpecCoverage),
  signal('diff.shape', readDiffShape),
  signal('decisions.open', readDecisions),
  signal('run.integrity', readRunIntegrity),
  signal('drift.stale', readDrift),
  signal('policy.humanPaths', readHumanPaths),
  signal('plan.fidelity', readPlanFidelity, false)
])

// --- the formula ----------------------------------------------------------------------------

/** The score range of a worst band. Unobserved takes amber's, as it takes amber's rank. */
function rangeOf(worst, bands) {
  const ceiling = isObject(bands) && isObject(bands.ceiling) ? bands.ceiling : fail('merge bands carry no ceiling table')
  if (worst === 'green') return { band: 'green', floor: ceiling.amber + 1, ceiling: ceiling.green }
  if (worst === 'red') return { band: 'red', floor: 0, ceiling: ceiling.red }
  return { band: 'amber', floor: ceiling.red + 1, ceiling: ceiling.amber }
}

/** Check one result against the published vocabulary and copy it. Never mutates. */
function checked(entry) {
  if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id) fail('every signal result needs a string "id"')
  const gating = entry.gating !== false
  const flags = list(entry.flags)
  for (const flag of flags) {
    if (!FLAGS.includes(flag)) {
      fail(`${entry.id}: flag ${JSON.stringify(flag)} is not in the published FLAGS list (${FLAGS.join(', ')})`)
    }
  }
  if (gating) {
    if (!BANDS.includes(entry.band)) fail(`${entry.id}: band ${JSON.stringify(entry.band)} is not one of ${BANDS.join('|')}`)
    if (entry.band !== 'green' && !KINDS.includes(entry.kind)) {
      fail(`${entry.id}: a ${entry.band} result must say what would lift it, one of ${KINDS.join('|')}`)
    }
  } else if (entry.band !== null && entry.band !== undefined) {
    fail(`${entry.id}: an informational signal carries no band`)
  }
  const reason = typeof entry.reason === 'string' ? entry.reason : ''
  return {
    id: entry.id,
    family: typeof entry.family === 'string' ? entry.family : entry.id.slice(0, entry.id.indexOf('.')),
    gating,
    band: gating ? entry.band : null,
    flags: [...flags],
    kind: gating && entry.band !== 'green' ? entry.kind : null,
    reason,
    evidence: list(entry.evidence).map(String)
  }
}

/**
 * Combine signal results into the verdict and the score (design D1). The same
 * list always yields the same answer, whatever input produced it.
 *
 * @param {Array<{id: string, family?: string, gating?: boolean, band: string|null,
 *   flags: string[], kind: string|null, reason: string, evidence: string[]}>} results
 * @param {{bands?: object}} [opts] defaults to the published `MERGE_BANDS`
 * @returns {{verdict: 'MERGE'|'HUMAN'|'BLOCK', score: number, worstBand: string,
 *   range: {band: string, floor: number, ceiling: number},
 *   counts: {gating: number, clean: number, green: number, amber: number, red: number,
 *     unobserved: number, flagged: number},
 *   driving: Array<{id: string, band: string, kind: string, reason: string, evidence: string[]}>,
 *   flags: Array<{id: string, flag: string}>, signals: Array, reasons: string[],
 *   labels: {verdict: {name: string, color: string, description: string},
 *     score: {name: string, color: string, description: string}, verdictNames: string[], scorePrefix: string}}}
 */
export function combineSignals(results, { bands = MERGE_BANDS } = {}) {
  if (!Array.isArray(results)) fail('combineSignals needs an array of signal results')
  const signals = results.map(checked)
  const gating = signals.filter(s => s.gating)
  if (!gating.length) fail('combineSignals needs at least one gating signal result')

  // The worst band wins; nothing is averaged.
  const worstBand = gating.reduce((worst, s) => (rank(s.band) > rank(worst) ? s.band : worst), 'green')
  const verdict = worstBand === 'red' ? 'BLOCK' : worstBand === 'green' ? 'MERGE' : 'HUMAN'

  // The score: the band's floor plus its width scaled by the clean share.
  const clean = gating.filter(s => s.band === 'green' && !s.flags.length).length
  const range = rangeOf(worstBand, bands)
  const score = range.floor + Math.round(((range.ceiling - range.floor) * clean) / gating.length)

  const howMany = band => gating.filter(s => s.band === band).length
  const counts = {
    gating: gating.length,
    clean,
    green: howMany('green'),
    amber: howMany('amber'),
    red: howMany('red'),
    unobserved: howMany('unobserved'),
    flagged: gating.filter(s => s.flags.length).length
  }

  // Everything that stands between the change and MERGE, worst first, each
  // saying whether a person, more evidence or a fix would lift it.
  const driving = gating
    .map((s, order) => ({ s, order }))
    .filter(({ s }) => s.band !== 'green')
    .sort((a, b) => rank(b.s.band) - rank(a.s.band) || a.order - b.order)
    .map(({ s }) => ({ id: s.id, band: s.band, kind: s.kind, reason: s.reason, evidence: [...s.evidence] }))

  const flags = signals.flatMap(s => s.flags.map(flag => ({ id: s.id, flag })))

  const ids = band => gating.filter(s => s.band === band).map(s => s.id).join(', ')
  const reasons = []
  if (verdict === 'MERGE') reasons.push(`MERGE: all ${gating.length} gating signal(s) are green`)
  else if (verdict === 'BLOCK') reasons.push(`BLOCK: red on ${ids('red')}`)
  else {
    const held = []
    if (counts.amber) held.push(`amber on ${ids('amber')}`)
    if (counts.unobserved) held.push(`unobserved on ${ids('unobserved')}`)
    reasons.push(`HUMAN: ${held.join('; ')}`)
  }
  reasons.push(
    `score ${score}: the ${range.band} range ${range.floor}–${range.ceiling} (MERGE_BANDS.ceiling), ` +
      `positioned by ${clean} of ${gating.length} gating signal(s) green with no flag`
  )

  return { verdict, score, worstBand, range, counts, driving, flags, signals, reasons, labels: labelsFor(verdict, score) }
}

/**
 * A review, verification or handoff record that names a commit (its `head`) is
 * evidence about that commit and nothing else (design D3 of
 * close-the-merge-request-loop). One naming another commit is refused out loud,
 * through `warn`, and read as if it had not been given (`null`); one with no
 * `head` is read as it always was.
 *
 * @param {unknown} record
 * @param {string|null} headSha
 * @param {string} label  how the caller names the file (`--review <path>`)
 * @param {(line: string) => void} warn
 */
export function boundToHead(record, headSha, label, warn) {
  if (!record || typeof record.head !== 'string' || record.head === headSha) return record
  warn(`${label} describes another commit: it records ${record.head}, and the head is ${headSha ?? 'unreadable'}, so it is not used`)
  return null
}

/**
 * Assess one change: run every registered signal over the input, then combine.
 *
 * The input is a plain object the CLI assembles (design D4): `change`,
 * `changedPaths`, `headSha`, `artifacts`, `review`, `verify`, `checklist`,
 * `handoff`, `pipeline`, `coverage`, `diff`, `ledger`, `drift`, `run`, `living`
 * (the living-requirement list's counts and flags: `skipped`, `partial`,
 * `requirementsRequired`, `omitted`, `source`) and `specCoverage` (`added`,
 * `lost`, `legacy`, `repo`, from `lib/spec-coverage.mjs`). The handoff may carry
 * `requirementsChecked` and `requirementsUnconfirmed`; the run record may carry
 * `leftoverTasks`. Any of them may be null; a signal whose input is absent says so.
 *
 * @param {object} input
 * @param {{bands?: object, allowedClasses?: string[]}} [opts]
 *   default to the published `MERGE_BANDS` and `MERGE_ALLOWED_CLASSES`
 */
export function assessMergeConfidence(input, { bands = MERGE_BANDS, allowedClasses = MERGE_ALLOWED_CLASSES } = {}) {
  const source = isObject(input) ? input : {}
  const policy = { allowedClasses }
  const results = SIGNALS.map(entry => {
    const read = entry.read(source, bands, policy)
    return {
      id: entry.id,
      family: entry.family,
      gating: entry.gating,
      band: read.band,
      flags: read.flags,
      kind: read.kind,
      reason: read.reason,
      evidence: evidenceOr(read.evidence, read.reason)
    }
  })
  return combineSignals(results, { bands })
}

/**
 * The one-line statement of an assessment. `formatMergeConfidence` prints it
 * first and a ship run's close summary prints the same string, so a reader
 * greps one form. design D10 of complete-and-record-the-merge-verdict.
 */
export function mergeConfidenceHeadline(result) {
  if (!isObject(result) || !isObject(result.range) || !isObject(result.counts)) {
    fail('mergeConfidenceHeadline needs an assessment result')
  }
  const { verdict, score, range, counts } = result
  return (
    `MERGE CONFIDENCE ${verdict} — score ${score} (${range.band} range ${range.floor}–${range.ceiling}; ` +
    `${counts.clean} of ${counts.gating} gating signals clean)`
  )
}

/** Human-readable assessment: verdict and score first, then what drives it, then every signal. */
export function formatMergeConfidence(result) {
  if (!isObject(result) || !Array.isArray(result.signals)) fail('formatMergeConfidence needs an assessment result')
  const lines = []
  lines.push(mergeConfidenceHeadline(result))
  lines.push('')
  if (result.driving.length) {
    lines.push('driving:')
    for (const kind of KIND_PRIORITY) {
      const group = result.driving.filter(d => d.kind === kind)
      if (!group.length) continue
      lines.push(`  ${KIND_LABELS[kind]}:`)
      for (const d of group) lines.push(`    ${d.id} [${d.band}] ${d.reason}`)
    }
  } else {
    lines.push('driving: none')
  }
  lines.push(result.flags.length ? `flags: ${result.flags.map(f => `${f.id} ${f.flag}`).join(', ')}` : 'flags: none')
  if (isObject(result.labels)) lines.push(`labels: ${result.labels.verdict.name}, ${result.labels.score.name}`)
  lines.push('')
  lines.push('signals:')
  const width = Math.max(...result.signals.map(s => s.id.length))
  for (const s of result.signals) {
    const band = s.gating ? s.band : 'info'
    const flagged = s.flags.length ? ` (${s.flags.join(', ')})` : ''
    lines.push(`  ${s.id.padEnd(width)}  ${band}${flagged}  ${s.reason}`)
    for (const line of s.evidence) if (line !== s.reason) lines.push(`  ${''.padEnd(width)}    ${line}`)
  }
  lines.push('')
  for (const reason of result.reasons || []) lines.push(`reason: ${reason}`)
  return lines.join('\n') + '\n'
}

// --- the description block (design D15) ------------------------------------------------------

// The longest a quoted string runs before it is cut. A display bound for the
// block, never a limit the verdict reads.
const SPAN_MAX_CHARS = 240

const MARKDOWN_GROUPS = Object.freeze({
  finding: 'Needs a fix',
  person: 'Needs a person',
  evidence: 'Needs more evidence'
})

/**
 * One string as inert text: an inline code span. Reasons and evidence quote
 * names this repository does not control (a check is named by the workflow that
 * defines it, a finding by the reviewer, a ledger question by its author), and
 * the block is posted under the account of whoever ran the skill. A code span
 * renders no mention, no link and no markup, so the only things that can end it
 * are removed: a backtick is replaced and a line break folded. The text is cut
 * with an ellipsis at `SPAN_MAX_CHARS`.
 */
export function inertSpan(text, { inTable = false } = {}) {
  let body = String(text ?? '')
    .replace(/`/g, "'")
    .replace(/[\r\n\f\v\u2028\u2029]+/g, ' ')
    .trim()
  if (!body) body = '(empty)'
  if (body.length > SPAN_MAX_CHARS) body = `${body.slice(0, SPAN_MAX_CHARS - 1)}…`
  // A pipe ends a table cell even inside a code span, so there it is escaped.
  if (inTable) body = body.replace(/\|/g, '\\|')
  return `\`${body}\``
}

/**
 * The line printed directly after the verdict line of every Markdown block.
 * `MERGE` is the local signals' reading and not the platform's: the branch
 * rules are a separate gate. One constant, no interpolation, so every verdict
 * says the same thing.
 */
export const MERGE_LEGEND =
  '_`MERGE` means every local signal is green. It does not say the platform’s branch rules would let ' +
  'this merge request merge: required checks, required approvals, code owners, a draft state, ' +
  'unresolved review threads and a merge queue are not read here._'

/**
 * The description block for a merge request: one Markdown block, rendered from
 * the assessment and from the head, the base and the excluded check names the
 * command holds. `head` is `{ sha }` or null, `base` is `{ ref, sha }` (`sha`
 * null when the merge base could not be read) or null, `excluded` a list of
 * names. Every string a platform, a review or a ledger supplied is an inline
 * code span; the full signal table sits in one collapsed section, last.
 *
 * @param {object} result  an assessment, as `assessMergeConfidence` returns it
 * @param {{ head?: {sha: string}|null, base?: {ref: string, sha: string|null}|null, excluded?: string[] }} [given]
 * @returns {string}
 */
export function formatMergeConfidenceMarkdown(result, { head, base, excluded } = {}) {
  if (!isObject(result) || !Array.isArray(result.signals) || !isObject(result.range) || !isObject(result.counts)) {
    fail('formatMergeConfidenceMarkdown needs an assessment result')
  }
  const { verdict, score, range, counts } = result
  const labels = isObject(result.labels) ? result.labels : labelsFor(verdict, score)
  const lines = ['## Merge confidence', '']
  lines.push(
    `**${verdict}** · score ${score} (${range.band} range ${range.floor}–${range.ceiling}; ` +
      `${counts.clean} of ${counts.gating} gating signals clean)`
  )
  lines.push(MERGE_LEGEND)
  lines.push('')

  const headSha = isObject(head) && typeof head.sha === 'string' && head.sha ? head.sha : null
  const baseRef = isObject(base) && typeof base.ref === 'string' && base.ref ? base.ref : null
  const baseSha = isObject(base) && typeof base.sha === 'string' && base.sha ? base.sha : null
  const commit = headSha ? `Assessed commit ${inertSpan(headSha)}` : 'The assessed commit could not be read'
  const against = !baseRef
    ? '; no base was given.'
    : baseSha
      ? ` against ${inertSpan(baseRef)} (merge base ${inertSpan(baseSha)}).`
      : ` against ${inertSpan(baseRef)}, whose merge base could not be read.`
  lines.push(`${commit}${against}`)
  lines.push('')

  // Everything that stands between the change and MERGE, by what would lift it.
  const driving = list(result.driving)
  if (!driving.length) {
    lines.push('Nothing is driving: every gating signal is green.')
    lines.push('')
  }
  for (const kind of KIND_PRIORITY) {
    const group = driving.filter(d => d.kind === kind)
    if (!group.length) continue
    lines.push(`**${MARKDOWN_GROUPS[kind]}**`)
    lines.push('')
    for (const d of group) lines.push(`- ${inertSpan(d.id)} (${d.band}): ${inertSpan(d.reason)}`)
    lines.push('')
  }

  // Each its own paragraph: a list here would join the group's list above it.
  const flags = list(result.flags)
  lines.push(`**Flags:** ${flags.length ? flags.map(f => `${inertSpan(f.id)} ${f.flag}`).join(', ') : 'none'}`)
  lines.push('')
  const left = list(excluded).filter(n => typeof n === 'string' && n)
  if (left.length) {
    lines.push(`**Excluded from the pipeline input:** ${left.map(n => inertSpan(n)).join(', ')}`)
    lines.push('')
  }
  lines.push(`**Labels:** ${inertSpan(labels.verdict.name)}, ${inertSpan(labels.score.name)}`)
  lines.push('')

  lines.push('<details>')
  lines.push(`<summary>All ${result.signals.length} signals</summary>`)
  lines.push('')
  lines.push('| Signal | Band | Flags | Reason and evidence |')
  lines.push('| --- | --- | --- | --- |')
  for (const s of result.signals) {
    const said = [s.reason, ...list(s.evidence).filter(line => line !== s.reason)]
    lines.push(
      `| ${inertSpan(s.id, { inTable: true })} | ${s.gating ? s.band : 'info'} | ${list(s.flags).join(', ')} | ` +
        `${said.map(line => inertSpan(line, { inTable: true })).join('<br>')} |`
    )
  }
  lines.push('')
  lines.push('</details>')
  return lines.join('\n') + '\n'
}
