// Which review dimensions run, decided by a rule instead of a reviewer's
// judgement (design D4).
//
// The retired text asked the review agent to decide for itself: "devops when
// the diff touches deploy, config or infrastructure; security when it
// touches auth, input handling or data exposure" (`workflows/ship.js:2066-
// 2068`). That question has a deterministic answer the run already computes
// for its risk class — `lib/surface.mjs` classifies exactly "does this path
// suggest infra impact" (its `needsDevopsReview`, the review-devops skip
// rule inverted) and `lib/risk.mjs` classifies exactly "does this path touch
// auth/session/permissions/tenancy" (its `auth-session-permissions-tenancy`
// signal). This module calls those two classifiers rather than re-deriving
// their regexes, so the two places this question is answered cannot drift
// apart.
//
// `security`'s signal only covers authentication/permissions/tenancy paths —
// `lib/risk.mjs` has no separate signal for input-handling or data-exposure
// paths distinct from that one, and this module does not add one of its own;
// widening what counts belongs in `lib/risk.mjs`, where every other severity
// signal is named and tested, not duplicated here.
//
// Pure: no fs, no agent, no I/O, no clock.

import { classifySurface } from '../surface.mjs'
import { classifyRisk } from '../risk.mjs'

/** The four dimensions run every time, in the order they are dispatched. */
export const ALWAYS_ON_DIMENSIONS = Object.freeze(['language', 'architecture', 'qa', 'technical-lead'])

function normalizePaths(changedPaths) {
  return Array.isArray(changedPaths) ? changedPaths.filter(p => typeof p === 'string' && p.trim()) : []
}

// Which of the changed paths, individually, is why `needsDevopsReview` came
// back true — `classifySurface` only reports the aggregate, so the paths
// that drove it are recovered by asking the same pure classifier about each
// path on its own. No infra-impact rule is reimplemented here.
function devopsTriggerPaths(paths) {
  return paths.filter(p => classifySurface([p]).needsDevopsReview)
}

/**
 * Select the review dimensions for one run's observed changed paths.
 *
 * @param {string[]} changedPaths
 * @returns {{dimensions: string[], reasons: Record<string, string>}}
 *   `dimensions` always starts with the four always-on names, in order, then
 *   `devops` and/or `security` when their signal fired. `reasons` carries one
 *   entry per optional dimension actually added — never for the always-on
 *   four, which need no justification.
 */
export function selectDimensions(changedPaths) {
  const paths = normalizePaths(changedPaths)
  const dimensions = [...ALWAYS_ON_DIMENSIONS]
  const reasons = {}

  const surface = classifySurface(paths)
  if (surface.needsDevopsReview) {
    dimensions.push('devops')
    const triggers = devopsTriggerPaths(paths)
    reasons.devops = triggers.length
      ? `deploy/CI/config/infrastructure path(s): ${triggers.join(', ')}`
      : 'a changed path suggests infrastructure impact'
  }

  const risk = classifyRisk({ changedPaths: paths })
  const authSignal = risk.signals.find(s => s.signal === 'auth-session-permissions-tenancy')
  if (authSignal) {
    dimensions.push('security')
    reasons.security = `authentication/permissions/tenancy path(s): ${authSignal.evidence}`
  }

  return { dimensions, reasons }
}
