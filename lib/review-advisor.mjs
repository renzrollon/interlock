// The review-findings advisor's draft check, renderer and Review Range tally.
//
// The model drafts; this module decides what of the draft survives, by code.
// Ids are positional (`F<n>`) and any id the model wrote is ignored. A flag is
// kept only when its kind is on the closed list and its targets resolve against
// the index `interlock review --advisor-brief` wrote beside the brief: a `D<n>`
// the index lists, two or more distinct `S<n>` it lists, or a path in its
// changed-file list. A draft is validated first and capped second, so an
// invalid flag never pushes a valid one over the cap. Nothing the model wrote
// disappears without a row in `## Dropped` saying why.
//
// Nothing here reads a clock or a file: the stamp and the brief's path are the
// caller's, so the same inputs give the same bytes. The generic parts (table,
// did-not-run stanza, validate-then-cap) live in `lib/advisor-kit.mjs`, shared
// with the checkpoint advisor.
//
// See add-review-findings-advisor design.md D5, D6, D7, D8, D10, D14, D16.

import { LIMITS } from './limits.mjs'
import { canonicalizePath } from './risk.mjs'
import { verdictFromLabels } from './advisor.mjs'
import { table, didNotRunStanza, keepThenCap } from './advisor-kit.mjs'

/** The closed list of flag kinds. The brief prints it; the check drops anything else. */
export const FLAG_KINDS = Object.freeze(['dismissal-doubt', 'shared-root-cause', 'uncovered'])

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = v => (typeof v === 'string' ? v.trim() : '')

const didNotRunResult = reason => ({ status: 'did-not-run', reason, flags: [], dropped: [] })

/**
 * Resolve a flag's targets against the index. Returns the canonical targets to
 * keep, or a string naming what failed.
 */
function resolveTargets(kind, rawTargets, index) {
  const targets = Array.isArray(rawTargets) ? rawTargets.map(text).filter(Boolean) : []
  const known = (rows, id) => (Array.isArray(rows) ? rows : []).some(r => r?.id === id)

  if (kind === 'dismissal-doubt') {
    if (targets.length !== 1) return 'no such dismissal: needs one D<n> target'
    return known(index?.dismissed, targets[0]) ? targets : `no such dismissal: ${targets[0]}`
  }

  if (kind === 'shared-root-cause') {
    const distinct = [...new Set(targets)]
    const missing = distinct.filter(id => !known(index?.survivors, id))
    if (missing.length > 0 && distinct.length - missing.length < 2) {
      return `needs two or more survivors (no such survivor: ${missing.join(', ')})`
    }
    if (missing.length > 0) return `no such survivor: ${missing.join(', ')}`
    return distinct.length >= 2 ? distinct : 'needs two or more survivors'
  }

  // uncovered
  if (targets.length !== 1) return 'path not changed: needs one changed path'
  const wanted = canonicalizePath(targets[0])
  const changed = (Array.isArray(index?.changed) ? index.changed : []).map(canonicalizePath)
  return wanted !== null && changed.includes(wanted) ? [wanted] : `path not changed: ${targets[0]}`
}

/**
 * Validate a draft by code.
 *
 * @param {unknown} draft  the parsed reply
 * @param {{ survivors?: Array<{id,file,title}>, dismissed?: Array<{id,file,title}>, changed?: string[] }} index
 *   the id index the review wrote beside the brief
 * @param {{ maxReviewAdvisorFlags?: number }} limits
 * @returns {{ status: 'drafted'|'did-not-run', reason?: string,
 *             flags: Array<{id,kind,targets,why,check}>,
 *             dropped: Array<{id,reason}> }}
 */
export function checkFlags(draft, index, limits = LIMITS) {
  if (!isObject(draft)) return didNotRunResult('draft is not a JSON object')
  if (!Array.isArray(draft.flags)) return didNotRunResult('flags is not an array')

  const cap = limits.maxReviewAdvisorFlags ?? LIMITS.maxReviewAdvisorFlags
  const { kept, dropped } = keepThenCap(
    draft.flags,
    f => {
      if (!isObject(f) || !text(f.why) || !text(f.check)) return 'missing field'
      const kind = typeof f.kind === 'string' ? f.kind : ''
      if (!FLAG_KINDS.includes(kind)) return `unknown kind: ${kind || 'none'}`
      const targets = resolveTargets(kind, f.targets, index)
      if (typeof targets === 'string') return targets
      return { kind, targets, why: text(f.why), check: text(f.check) }
    },
    cap,
    { prefix: 'F' }
  )
  return { status: 'drafted', flags: kept, dropped }
}

const CLOSING =
  'This file is advisory: no gate reads it, and `interlock gate`, `interlock autonomy`, `interlock note derive`, ' +
  '`interlock ready`, `interlock validate` and `interlock merge-confidence` decide the same with or without it.'

const title = change => (change ? `# Review-findings advisor — ${change}` : '# Review-findings advisor')

/**
 * The stanza for a consult that did not run: heading, the stamp, the reason,
 * the closing line, and no tables.
 */
export function reviewAdvisorDidNotRun(reason, { change, stamp } = {}) {
  return didNotRunStanza(reason, { title: title(change), closing: CLOSING, stamp })
}

/** A target with the finding title (or path) the index shows for it. */
function describeTarget(target, index) {
  const row = [...(index?.survivors ?? []), ...(index?.dismissed ?? [])].find(r => r?.id === target)
  return row ? `${target} (${row.title})` : target
}

/**
 * Render `review-advisor.md`. A result that did not run renders as the
 * did-not-run stanza.
 *
 * @param {ReturnType<typeof checkFlags>} result
 * @param {{ change?: string, stamp?: string, briefPath?: string, index?: object }} opts
 */
export function renderReviewAdvisor(result, { change, stamp, briefPath, index } = {}) {
  if (result.status !== 'drafted') return reviewAdvisorDidNotRun(result.reason, { change, stamp })
  const status = `drafted ${stamp ?? ''}${briefPath ? ` from ${briefPath}` : ''}`.replace(/\s+$/, '')
  return [
    title(change),
    '',
    status,
    '',
    '## Flags',
    '',
    table(
      ['id', 'kind', 'targets', 'why', 'check'],
      result.flags.map(f => [f.id, f.kind, f.targets.map(t => describeTarget(t, index)).join('; '), f.why, f.check])
    ),
    '',
    '## Dropped',
    '',
    table(['id', 'reason'], result.dropped.map(d => [d.id, d.reason])),
    '',
    '## Not a gate',
    '',
    CLOSING,
    ''
  ].join('\n')
}

// --- the Review Range tally -------------------------------------------------

/**
 * Tally the Review Range's human labels against the review advisor's own caps:
 * `verdictFromLabels` aimed at `review-range-*` cases and their two graders.
 * A statement for a person, never a gate.
 *
 * @param {string} evalsDir
 * @param {object} limits
 */
export function reviewVerdict(evalsDir, limits = LIMITS) {
  return verdictFromLabels(evalsDir, limits, {
    prefix: 'review-range-',
    graders: ['matches-label', 'repeats-survivor'],
    minLabels: limits.reviewAdvisorVerdictMinLabels ?? LIMITS.reviewAdvisorVerdictMinLabels,
    keepMin: limits.reviewAdvisorKeepMinMatches ?? LIMITS.reviewAdvisorKeepMinMatches
  })
}
