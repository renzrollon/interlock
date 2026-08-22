// Review-finding schemas and the gate decision.
//
// Reviewers produce findings; a gate decides whether the flow may proceed. That
// decision is a count, not a judgement, so it lives here rather than being
// re-argued in prose on every run: a gate blocks if and only if at least one
// surviving finding is severity `blocker`.
//
// The same argument applies to the tolerance band: after two skeptics score
// each surviving finding, one that is too poorly-grounded to be worth a human's
// attention must disappear *before* the gate counts. That filter runs inside
// `evaluateGate` rather than being described in a skill, so no prose path can
// skip it and let a quality-2 finding block a gate.
//
// This module also owns the per-file grouping that remediation fans out over,
// so the fixer agents are spawned against a stable, deduplicated partition
// rather than whatever order the reviewers happened to emit.
//
// Pure: no fs, no agent, no I/O.
// Exposed to skills as `interlock gate --findings <file>`.

export const SEVERITIES = ['blocker', 'warning', 'suggestion']

/**
 * A severity, canonicalized — or null when it is not one of ours.
 *
 * Casing and surrounding whitespace are folded because that is the transform
 * boundary this value has: `"BLOCKER"` and `" blocker "` are the same claim.
 * Everything else is rejected rather than bucketed, and the direction of the
 * bug that motivates it is worth stating: a reviewer emitting `"critical"` — a
 * *more* alarming word than the enum's maximum — used to land in an `unknown`
 * bucket the gate does not block on, so the scarier word passed the gate more
 * easily than `blocker` did.
 *
 * @param {unknown} value
 * @returns {'blocker'|'warning'|'suggestion'|null}
 */
export function normalizeSeverity(value) {
  if (typeof value !== 'string') return null
  const folded = value.trim().toLowerCase()
  return SEVERITIES.includes(folded) ? folded : null
}

/** Schema a review dimension agent must satisfy. */
export const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: [...SEVERITIES] },
          file: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
          description: { type: 'string' },
          suggestion: { type: 'string' }
        },
        required: ['severity', 'file', 'title', 'description']
      }
    }
  },
  required: ['dimension', 'findings']
}

/** Schema a skeptic must satisfy when adversarially verifying one finding. */
export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    findingTitle: { type: 'string' },
    file: {
      type: 'string',
      description:
        'The file of the finding being adjudicated. Optional, but supply it whenever the finding has one: title alone is not unique, and two findings sharing a title in different files would otherwise share one verdict set.'
    },
    isReal: { type: 'boolean', description: 'true if the finding is a genuine issue' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
    evidence: {
      type: 'string',
      description:
        'A file:line span you actually opened, e.g. "src/auth.ts:41-58". REQUIRED to vote a finding not real: an uncited refutation does not dismiss anything, it simply does not count, and the finding survives. Voting a finding real needs no evidence — that direction is already conservative.'
    },
    refinedSeverity: { type: 'string', enum: [...SEVERITIES, 'dismiss'] },
    qualityScore: {
      type: 'integer',
      minimum: 0,
      maximum: 5,
      description:
        'How well-grounded, actionable, and clearly-explained the finding is. 0=incomprehensible, 3=usable, 5=exemplary.'
    },
    severityScore: {
      type: 'integer',
      minimum: 0,
      maximum: 5,
      description:
        'Impact if the finding is real. 0=cosmetic, 3=user-visible bug, 5=data loss / security breach.'
    }
  },
  required: [
    'findingTitle',
    'isReal',
    'confidence',
    'reasoning',
    'refinedSeverity',
    'qualityScore',
    'severityScore'
  ]
}

/**
 * Quality floor applied to skeptic-scored findings before the gate counts them.
 * `drift` is how far the two skeptics may disagree before their disagreement is
 * treated as signal in its own right. Applied by `applyToleranceBand`.
 */
export const TOLERANCE_BAND = {
  minQualityToReport: 3,
  drift: 1
}

export const UNSCOPED_GROUP = '__unscoped__'

function fileOf(finding) {
  const f = finding && finding.file
  if (typeof f !== 'string') return UNSCOPED_GROUP
  const trimmed = f.trim()
  if (!trimmed || trimmed === '-' || /^n\/?a$/i.test(trimmed)) return UNSCOPED_GROUP
  return trimmed
}

// Accept either a bare array, a single { dimension, findings } object, or an
// array of those — reviewers emit all three shapes depending on fan-out.
function flatten(input) {
  if (Array.isArray(input)) {
    return input.flatMap(entry =>
      entry && Array.isArray(entry.findings)
        ? entry.findings.map(f => ({ dimension: entry.dimension, ...f }))
        : [entry]
    )
  }
  if (input && Array.isArray(input.findings)) {
    return input.findings.map(f => ({ dimension: input.dimension, ...f }))
  }
  return []
}

/**
 * Group findings by file.
 * @returns {{ byFile: Array<{file: string, findings: Array}>, unscoped: Array }}
 *   byFile is safe to fan out in parallel (disjoint files); unscoped findings
 *   have no single owning file and must be applied last, sequentially.
 */
export function groupByFile(findings) {
  const map = new Map()
  for (const f of findings) {
    const key = fileOf(f)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(f)
  }
  const unscoped = map.get(UNSCOPED_GROUP) || []
  map.delete(UNSCOPED_GROUP)
  const byFile = [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([file, fs]) => ({ file, findings: fs }))
  return { byFile, unscoped }
}

// Every quality score attached to one finding object: the canonical
// `qualityScores` array plus its own single `qualityScore`, ignoring anything
// non-numeric (a skeptic that answered "n/a" has not scored the finding).
function qualityScoresOf(finding) {
  const out = []
  const many = finding && finding.qualityScores
  if (Array.isArray(many)) {
    for (const s of many) if (typeof s === 'number' && Number.isFinite(s)) out.push(s)
  }
  const one = finding && finding.qualityScore
  if (typeof one === 'number' && Number.isFinite(one)) out.push(one)
  return out
}

// Identity used to pool scores across repeated entries: title, plus the file
// when the finding names one.
function identityOf(finding) {
  const title = finding && typeof finding.title === 'string' ? finding.title : ''
  return `${title}\u0000${fileOf(finding)}`
}

/**
 * Partition findings by the tolerance band — drop the scored-and-weak, keep
 * everything else. Dropping is invisible to the human, so every ambiguous case
 * resolves towards keeping.
 *
 * Semantics:
 * - **Unscored findings are kept.** A missing or non-numeric `qualityScore`
 *   means no skeptic scored it; absence of a score is not evidence of low
 *   quality. The band suppresses *scored-and-weak*, never *unscored*.
 * - A finding is dropped when its effective quality is **strictly below**
 *   `band.minQualityToReport`.
 * - `band.drift` is the tolerance for disagreement between the two skeptics.
 *   When a finding carries more than one score and `max - min > drift`, the
 *   disagreement is itself signal: resolve conservatively and **keep** it. When
 *   the scores agree within `drift`, the **higher** score is the effective
 *   quality.
 *
 * Two multi-score input shapes are supported. Canonical is `qualityScores:
 * number[]` on a single finding object. Repeated entries sharing a title (and
 * file, when present) each carrying their own `qualityScore` are also pooled
 * into one score set — such a group is kept or dropped as a unit.
 *
 * @param {*} input findings in any of the shapes `evaluateGate` accepts
 * @param {{minQualityToReport?: number, drift?: number}|null} [band]
 *   pass `null` to disable the band entirely
 * @returns {{reportable: Array, dropped: Array}} flattened partition of the input
 */
export function applyToleranceBand(input, band = TOLERANCE_BAND) {
  const all = flatten(input).filter(Boolean)
  const min = band ? Number(band.minQualityToReport) : NaN
  if (!Number.isFinite(min)) return { reportable: all, dropped: [] }
  const drift = Number(band.drift)
  const tolerance = Number.isFinite(drift) ? drift : 0

  const pooled = new Map()
  for (const f of all) {
    const key = identityOf(f)
    if (!pooled.has(key)) pooled.set(key, [])
    pooled.get(key).push(...qualityScoresOf(f))
  }

  const reportable = []
  const dropped = []
  for (const f of all) {
    const scores = pooled.get(identityOf(f))
    const high = Math.max(...scores)
    const disagree = scores.length > 1 && high - Math.min(...scores) > tolerance
    const keep = scores.length === 0 || disagree || high >= min
    ;(keep ? reportable : dropped).push(f)
  }
  return { reportable, dropped }
}

/**
 * Decide whether a gate passes.
 * @param {*} input findings in any of the accepted shapes
 * @param {{dismissed?: string[], band?: object|null}} opts
 *   `dismissed` are titles the skeptics verified away; `band` overrides the
 *   tolerance band (`null` disables it — the default is `TOLERANCE_BAND`).
 */
export function evaluateGate(input, opts = {}) {
  const dismissed = new Set(opts.dismissed || [])
  const all = flatten(input).filter(Boolean)

  // Order matters: dismissals first (the finding was verified away), then the
  // quality band (the finding may be real but is not worth reporting), then
  // counting. Both filters run here so no caller can count before filtering.
  const kept = all.filter(f => !dismissed.has(f.title))
  const band = opts.band === undefined ? TOLERANCE_BAND : opts.band
  const { reportable: surviving, dropped } = applyToleranceBand(kept, band)

  // Severity is resolved before anything is counted, and a value outside the
  // enum is a REJECTION rather than a bucket. A finding whose severity the gate
  // does not recognise is a finding the gate cannot act on, so it is reported
  // as malformed and it blocks — silently filing it under a severity nothing
  // blocks on is how "critical" became easier to pass than "blocker".
  const counts = { blocker: 0, warning: 0, suggestion: 0 }
  const malformed = []
  const resolved = []
  for (const f of surviving) {
    const severity = normalizeSeverity(f.severity)
    if (severity === null) {
      malformed.push({
        ...f,
        reason:
          `severity ${JSON.stringify(f.severity)} is not one of ${SEVERITIES.join('|')} — ` +
          `the finding is rejected rather than counted into a bucket the gate ignores`
      })
      continue
    }
    counts[severity] += 1
    resolved.push(severity === f.severity ? f : { ...f, severity })
  }

  const blockers = resolved.filter(f => f.severity === 'blocker')
  const { byFile, unscoped } = groupByFile(resolved)

  const byDimension = {}
  for (const f of resolved) {
    const d = f.dimension || 'unknown'
    byDimension[d] = (byDimension[d] || 0) + 1
  }

  return {
    passed: blockers.length === 0 && malformed.length === 0,
    total: resolved.length,
    // Findings the gate refused to interpret. Never empty-and-ignored: the
    // gate does not pass while one is outstanding.
    malformed,
    // Two different things, reported separately: a skeptic said the finding is
    // not real vs. the skeptics scored it too weakly to be worth reporting.
    dismissedCount: all.length - kept.length,
    droppedByQuality: dropped.length,
    counts,
    byDimension,
    blockers,
    byFile,
    unscoped,
    // What the caller feeds straight back into `interlock autonomy record`.
    autonomyOutcome: { blockers: blockers.length }
  }
}

/** Human-readable gate verdict. */
export function formatGate(result) {
  const lines = []
  const malformed = result.malformed || []
  lines.push(
    result.passed
      ? `GATE PASS — ${result.total} finding(s), no blockers`
      : `GATE BLOCKED — ${result.blockers.length} blocker(s) of ${result.total} finding(s)` +
        (malformed.length ? ` and ${malformed.length} malformed` : '')
  )
  const { blocker, warning, suggestion } = result.counts
  lines.push(`  blocker=${blocker} warning=${warning} suggestion=${suggestion}`)
  for (const m of malformed) {
    lines.push(`  [malformed] ${m.file || '(unscoped)'} — ${m.title}: ${m.reason}`)
  }
  if (result.dismissedCount) lines.push(`  dismissed by skeptics: ${result.dismissedCount}`)
  if (result.droppedByQuality) {
    lines.push(`  dropped by quality band: ${result.droppedByQuality}`)
  }
  for (const b of result.blockers) {
    lines.push(`  [blocker] ${b.file || '(unscoped)'}${b.line ? `:${b.line}` : ''} — ${b.title}`)
  }
  if (result.byFile.length) {
    lines.push(`  remediation groups: ${result.byFile.length} file(s)` +
      (result.unscoped.length ? ` + ${result.unscoped.length} unscoped` : ''))
  }
  return lines.join('\n') + '\n'
}
