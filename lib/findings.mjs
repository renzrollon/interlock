// Review-finding schemas and the gate decision.
//
// Reviewers produce findings; a gate decides whether the flow may proceed. That
// decision is a count, not a judgement, so it lives here rather than being
// re-argued in prose on every run: a gate blocks if and only if at least one
// surviving finding is severity `blocker`.
//
// This module also owns the per-file grouping that remediation fans out over,
// so the fixer agents are spawned against a stable, deduplicated partition
// rather than whatever order the reviewers happened to emit.
//
// Pure: no fs, no agent, no I/O.
// Exposed to skills as `specflow gate --findings <file>`.

export const SEVERITIES = ['blocker', 'warning', 'suggestion']

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
    isReal: { type: 'boolean', description: 'true if the finding is a genuine issue' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
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

/**
 * Decide whether a gate passes.
 * @param {*} input findings in any of the accepted shapes
 * @param {{dismissed?: string[]}} opts titles verified away by skeptics
 */
export function evaluateGate(input, opts = {}) {
  const dismissed = new Set(opts.dismissed || [])
  const all = flatten(input).filter(Boolean)

  const surviving = all.filter(f => !dismissed.has(f.title))
  const counts = { blocker: 0, warning: 0, suggestion: 0, unknown: 0 }
  for (const f of surviving) {
    if (Object.prototype.hasOwnProperty.call(counts, f.severity)) counts[f.severity] += 1
    else counts.unknown += 1
  }

  const blockers = surviving.filter(f => f.severity === 'blocker')
  const { byFile, unscoped } = groupByFile(surviving)

  const byDimension = {}
  for (const f of surviving) {
    const d = f.dimension || 'unknown'
    byDimension[d] = (byDimension[d] || 0) + 1
  }

  return {
    passed: blockers.length === 0,
    total: surviving.length,
    dismissedCount: all.length - surviving.length,
    counts,
    byDimension,
    blockers,
    byFile,
    unscoped,
    // What the caller feeds straight back into `specflow autonomy record`.
    autonomyOutcome: { blockers: blockers.length }
  }
}

/** Human-readable gate verdict. */
export function formatGate(result) {
  const lines = []
  lines.push(
    result.passed
      ? `GATE PASS — ${result.total} finding(s), no blockers`
      : `GATE BLOCKED — ${result.blockers.length} blocker(s) of ${result.total} finding(s)`
  )
  const { blocker, warning, suggestion, unknown } = result.counts
  lines.push(
    `  blocker=${blocker} warning=${warning} suggestion=${suggestion}` +
      (unknown ? ` unknown=${unknown}` : '')
  )
  if (result.dismissedCount) lines.push(`  dismissed by skeptics: ${result.dismissedCount}`)
  for (const b of result.blockers) {
    lines.push(`  [blocker] ${b.file || '(unscoped)'}${b.line ? `:${b.line}` : ''} — ${b.title}`)
  }
  if (result.byFile.length) {
    lines.push(`  remediation groups: ${result.byFile.length} file(s)` +
      (result.unscoped.length ? ` + ${result.unscoped.length} unscoped` : ''))
  }
  return lines.join('\n') + '\n'
}
