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

/**
 * Select the review dimensions for one run's observed changed paths.
 *
 * `domain` is the one dimension a path classifier cannot decide: it needs the
 * graph and the change's own specs. The caller selects its capabilities
 * (`selectDomainCapabilities` in `./domain-context.mjs`) and passes the result as
 * `{ domain }`; called with one argument this returns exactly what it always did.
 *
 * @param {string[]} changedPaths
 * @param {{domain?: {capabilities: Array<{capability: string, via?: string, files?: string[]}>}|null}} [options]
 * @returns {{dimensions: string[], reasons: Record<string, string>}}
 *   `dimensions` always starts with the four always-on names, in order, then
 *   `devops` and/or `security` when their signal fired, then `domain` when
 *   `options.domain` selected a capability. `reasons` carries one
 *   entry per optional dimension actually added — never for the always-on
 *   four, which need no justification.
 */
export function selectDimensions(changedPaths, options) {
  const paths = normalizePaths(changedPaths)
  const dimensions = [...ALWAYS_ON_DIMENSIONS]
  const reasons = {}

  const surface = classifySurface(paths)
  if (surface.needsDevopsReview) {
    dimensions.push('devops')
    // Which paths, individually, drove the rollup — read off the single
    // classifier pass that already computed each file's own verdict. Asking the
    // classifier again per path would be a second place the answer could
    // diverge, which is what this module's header says it exists to prevent.
    const triggers = surface.files.filter(f => f.infra).map(f => f.path)
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

  const domainCapabilities = Array.isArray(options?.domain?.capabilities) ? options.domain.capabilities : []
  if (domainCapabilities.length) {
    dimensions.push('domain')
    reasons.domain =
      `living requirements of ${domainCapabilities.length} capability(ies): ` +
      domainCapabilities.map(describeCapability).join('; ')
  }

  return { dimensions, reasons }
}

function describeCapability(entry) {
  const files = Array.isArray(entry?.files) ? entry.files : []
  return files.length
    ? `${entry.capability} (linked to ${files.join(', ')})`
    : `${entry.capability} (declared by the change)`
}
