// Deterministic risk classifier for one OpenSpec change.
//
// The continuity path (WS-F) can skip the human checkpoint between spec and
// ship. Whether it *may* skip is a blast-radius question — "does this change
// touch auth, money, schemas, or data we cannot get back?" — and that question
// was previously answered nowhere, or in prose inside a skill, which means it
// was answered differently on every run by whichever model happened to read
// the proposal. A gate that can bypass a human cannot rest on a re-derived
// judgement. So the rules live here, in code, and every classification carries
// the signals that produced it.
//
// Two properties are load-bearing:
//
//   1. FAIL CLOSED. Absence of evidence is never evidence of safety. When the
//      caller supplies nothing usable, the class is UNCLASSIFIABLE_CLASS
//      ('high') — not 'low'. When paths are present but nothing matched, the
//      floor is 'medium', not 'low': "no rule fired" means "we did not
//      recognise it", not "it is safe". 'low' is only ever reached by a
//      positive signal (every changed path is docs or tests). An
//      unclassifiable change must never come out 'low', because 'low' is the
//      class that lets a machine skip a person.
//
//   2. MAXIMUM, NEVER AVERAGE. The final class is the maximum over every
//      matched signal. A change that is 90% docs and 10% payment code is a
//      payment change. Averaging risk is how a critical signal gets diluted by
//      volume.
//
// Signals come from two independent sources — changed (or planned) paths, and
// the raw text of the change artifacts. Text matching is deliberately
// generous: a false positive costs one human read, a false negative ships an
// auth change nobody looked at.
//
// Pure: no fs, no git, no agent, no I/O, no clock. Input is never mutated.
// Paths are repo-relative; '\' is normalized to '/'.
//
// Exposed to skills as `interlock risk --change <name> --json`.

// Ordered least to most severe. Order is the API: callers compare by index.
export const RISK_CLASSES = Object.freeze(['low', 'medium', 'high', 'critical'])

const RANK = { low: 0, medium: 1, high: 2, critical: 3 }

// §4.14 "balanced": a change may auto-continue past the human checkpoint at
// `low` or `medium` only. This is THE continuity policy knob — re-tuning §4.14
// to strict (['low']) or loose (['low','medium','high']) is this one edit.
export const CONTINUITY_ALLOWED_CLASSES = Object.freeze(['low', 'medium'])

// Where an input with no usable signal at all lands. Deliberately outside
// CONTINUITY_ALLOWED_CLASSES: "we could not tell" must stop the machine.
export const UNCLASSIFIABLE_CLASS = 'high'

// Floor for any change that touches at least one non-docs, non-test path but
// matched no severity rule. Above 'low' on purpose — see fail-closed, above.
export const UNMATCHED_SOURCE_CLASS = 'medium'

/** Higher of two risk classes. Unknown values are treated as the maximum. */
export function maxClass(a, b) {
  const ra = RANK[a] ?? RANK.critical
  const rb = RANK[b] ?? RANK.critical
  return ra >= rb ? (RISK_CLASSES[ra] ?? 'critical') : (RISK_CLASSES[rb] ?? 'critical')
}

// --- rule tables ---------------------------------------------------------
//
// One named constant per signal group so the rules stay greppable: when a
// classification surprises someone, they should be able to find the exact
// regex from the signal name printed in the output.

// critical — irreversible, or money.
const DATA_DESTRUCTION_PATH =
  /(^|\/)(migrations?|db|database|sql)\/[^/]*(drop|delete|purge|truncate|destroy|prune|backfill)/
const DATA_DESTRUCTION_TEXT =
  /\b(drop\s+(table|column|database|index)|delete\s+from|truncate\s+table|hard[\s-]?delete\w*|purge\w*|cascade\s+delete|destructive\s+migration|data\s+loss|irreversibl\w+|permanently\s+(delete|remove)\w*|wipe\w*)\b/

const PAYMENT_PATH =
  /(^|\/)(payments?|billing|checkout|invoices?|stripe|paypal|braintree|subscriptions?|pricing|wallet|payouts?)([/\-_.]|$)/
const PAYMENT_TEXT =
  /\b(payment\w*|billing|checkout|invoice\w*|refund\w*|payout\w*|charge\s+the\s+(card|customer)|stripe|paypal|braintree|price\s+in\s+cents|credit\s+card|money\s+transfer)\b/

const IDEMPOTENCY_TEXT =
  /\b(idempoten\w*|exactly[\s-]once|at[\s-]least[\s-]once|de[\s-]?duplicat\w*|retry\s+semantics|replay\s+(protection|attack)|double[\s-](charge|submit|write)\w*)\b/

// high — auth/tenancy, and anything that changes a contract or a schema.
const AUTH_PATH =
  /(^|\/)(auth|authn|authz|oauth|session|sessions|login|logout|signin|signup|password\w*|credentials?|permissions?|roles?|rbac|acl|policy|policies|tenant|tenants|tenancy|security)([/\-_.]|$)/
const AUTH_TEXT =
  /\b(authenticat\w+|authoriz\w+|authn|authz|sign[\s-]?(in|up|out)|log\s?in\b|logout|session\s+(token|cookie|store|fixation|id)|password\w*|credential\w*|api\s+keys?|jwt|oauth\d?|saml|sso|permission\w*|role[\s-]based|rbac\b|acl\b|access\s+control|multi[\s-]?tenan\w*|tenant\s+(boundary|isolation|id)|impersonat\w+|csrf|privilege\s+escalation)\b/

const API_SCHEMA_PATH =
  /(^|\/)(migrations?|migrate|schemas?|openapi|swagger|proto|prisma)([/\-_.]|$)|(^|\/)schema\.(prisma|graphql|sql|json|ts)$|\.(sql|proto)$|(^|\/)openapi\.(ya?ml|json)$/
const API_SCHEMA_TEXT =
  /\b(new\s+(public\s+)?(api|endpoint|route)|public\s+api|api\s+contract|breaking\s+change|backwards?[\s-]incompatible|database\s+(migration|schema)|migration\b|migrat(e|ing)\s+(the\s+)?(data|table|column|schema)|schema\s+change|alter\s+table|add\s+column|drop\s+index|new\s+table|openapi|graphql\s+schema|wire\s+format|serialization\s+format)\b/

// medium — the invariant-sweep / shared-value-transform floor from §F3.
const SHARED_TRANSFORM_PATH =
  /(^|\/)(shared|common)\/|(^|\/)(utils?|helpers?|lib)\/[^/]*(format|currency|money|amount|date|time|timezone|tz|unit|round|serializ|transform|convert|normaliz)/
const SHARED_TRANSFORM_TEXT =
  /\b(invariant\s+sweep|invariant\w*|every\s+call\s?site|all\s+call\s?sites|all\s+consumers|every\s+consumer|cross[\s-]cutting|repo[\s-]wide|codebase[\s-]wide|shared\s+(helper|util\w*|value|transform\w*|format\w*|constant)|rename\s+across|sweep\s+(all|every))\b/

// low — the only positive route to 'low'.
export const DOC_PATH = /\.(md|mdx|txt|rst|adoc)$|(^|\/)(docs?|openspec|\.claude)\//
const TEST_PATH =
  /(^|\/)(tests?|__tests__|e2e|cypress|playwright|fixtures|__mocks__)\/|\.(test|spec)\.[a-z]+$/

/** Documentation path — shared with the wave checkpoint skip and verify plan. */
export function isDocsPath(path) {
  const lower = String(path || '').replace(/\\/g, '/').toLowerCase()
  return DOC_PATH.test(lower)
}

// Evaluated in this order; output is sorted by severity afterwards.
const SIGNALS = Object.freeze([
  { signal: 'shared-value-transform', class: 'medium', path: SHARED_TRANSFORM_PATH, text: SHARED_TRANSFORM_TEXT },
  { signal: 'api-schema-migration', class: 'high', path: API_SCHEMA_PATH, text: API_SCHEMA_TEXT },
  { signal: 'auth-session-permissions-tenancy', class: 'high', path: AUTH_PATH, text: AUTH_TEXT },
  { signal: 'data-destruction', class: 'critical', path: DATA_DESTRUCTION_PATH, text: DATA_DESTRUCTION_TEXT },
  { signal: 'payment', class: 'critical', path: PAYMENT_PATH, text: PAYMENT_TEXT },
  { signal: 'idempotency', class: 'critical', path: null, text: IDEMPOTENCY_TEXT }
])

// How many matches to name per signal before collapsing to a count.
const MAX_EVIDENCE = 3

// --- helpers -------------------------------------------------------------

/**
 * The one canonical form of a repo-relative path.
 *
 * Every module that compares two paths — the wave planner's collision key, its
 * changed-file dedup, the docs-only test, the review evidence gate — reads this
 * and nothing else. The transform used to be private here and `lib/waves.mjs`
 * simply did not have it, which is how `src/a.ts` and `./src/a.ts` became two
 * keys for one file and two implementers ended up writing it concurrently.
 *
 * Lexical on purpose. A predicted path names a file that may not exist yet, so
 * `realpath` and `existsSync` are both the wrong instrument.
 *
 * Absolute paths and paths that escape the repository root are **rejected**
 * rather than rewritten. Rewriting `../outside/a.ts` into something in scope
 * would silently attribute an edit to a file the task never named; returning
 * null lets the caller report it as unusable, which is what the spec asks for.
 *
 * @param {unknown} entry
 * @returns {string|null} the canonical form, or null when the input cannot
 *   name a file inside this repository
 */
export function canonicalizePath(entry) {
  if (typeof entry !== 'string') return null
  const trimmed = entry.trim().replace(/\\/g, '/')
  if (!trimmed) return null
  // Rejected, never normalized into scope: POSIX absolute, Windows drive, UNC.
  if (trimmed.startsWith('/') || /^[a-zA-Z]:\//.test(trimmed)) return null

  // posixNormalize collapses '.', '..' and duplicate separators lexically.
  const collapsed = posixNormalize(trimmed).replace(/\/+$/, '')
  if (!collapsed || collapsed === '.' || collapsed === '..') return null
  if (collapsed.startsWith('../')) return null
  return collapsed
}

// `node:path`'s posix.normalize, inlined so this module keeps its "pure, no
// imports beyond what it needs" shape and behaves identically on Windows.
function posixNormalize(path) {
  const absolute = path.startsWith('/')
  const out = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
      continue
    }
    out.push(segment)
  }
  const joined = out.join('/')
  return absolute ? `/${joined}` : joined
}

// Tolerate junk entries: non-strings drop out, surrounding space is trimmed,
// leading './' is stripped, '\' becomes '/'.
//
// Deliberately *not* `canonicalizePath`. Risk classification and collision
// keying want opposite things from an unusable path: keying must reject it,
// because a path we cannot place in the repo cannot be an identity, while
// classification must keep it, because dropping `/srv/payments/charge.ts`
// would lower the blast radius of a change that touches payments. Fail closed
// means the opposite thing in each place, so each gets its own reader.
function normalizePath(entry) {
  if (typeof entry !== 'string') return ''
  const canonical = canonicalizePath(entry)
  if (canonical) return canonical
  let p = entry.trim().replace(/\\/g, '/')
  while (p.startsWith('./')) p = p.slice(2)
  return p
}

function normalizePaths(input) {
  const list = Array.isArray(input) ? input : []
  const out = []
  for (const entry of list) {
    const path = normalizePath(entry)
    if (path) out.push({ path, lower: path.toLowerCase() })
  }
  return out
}

// artifacts is { 'proposal.md': '<text>', ... } — whatever the caller read.
// Non-string and blank values are dropped rather than throwing: a caller that
// could not read design.md still deserves a classification.
function normalizeArtifacts(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const out = []
  for (const name of Object.keys(input)) {
    const value = input[name]
    if (typeof value !== 'string') continue
    if (!value.trim()) continue
    out.push({ name, text: value, lower: value.toLowerCase() })
  }
  return out
}

function snippet(text, index, length) {
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + length + 24)
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = `…${s}`
  if (end < text.length) s = `${s}…`
  return s
}

function joinEvidence(items) {
  if (items.length <= MAX_EVIDENCE) return items.join('; ')
  return `${items.slice(0, MAX_EVIDENCE).join('; ')} (+${items.length - MAX_EVIDENCE} more)`
}

// --- public API ----------------------------------------------------------

/**
 * Classify one change from its changed (or planned) paths plus artifact text.
 *
 * @param {{ changedPaths?: string[], artifacts?: Record<string,string> }} input
 * @param {{ allowedClasses?: string[] }} [opts]
 * @returns {{
 *   riskClass: 'low'|'medium'|'high'|'critical',
 *   signals: Array<{signal: string, class: string, evidence: string}>,
 *   continuityAllowed: boolean,
 *   reasons: string[],
 *   basis: 'no-input'|'signals',
 *   pathCount: number,
 *   artifactNames: string[]
 * }}
 */
export function classifyRisk(input, opts = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const allowed = Array.isArray(opts.allowedClasses) ? opts.allowedClasses : CONTINUITY_ALLOWED_CLASSES

  const paths = normalizePaths(source.changedPaths)
  const artifacts = normalizeArtifacts(source.artifacts)

  const signals = []
  const reasons = []

  // 1. Nothing usable at all. Fail closed, loudly.
  if (paths.length === 0 && artifacts.length === 0) {
    signals.push({
      signal: 'no-input',
      class: UNCLASSIFIABLE_CLASS,
      evidence: 'no changed paths and no artifact text were supplied'
    })
    reasons.push(
      `unclassifiable: no signals available, so the class fails closed to ${UNCLASSIFIABLE_CLASS} rather than low`
    )
    return finish(UNCLASSIFIABLE_CLASS, signals, reasons, allowed, 'no-input', paths, artifacts)
  }

  // 2. Severity signals over both sources. Every group is evaluated — the
  //    result is the maximum, so an early match never short-circuits a later,
  //    worse one.
  for (const def of SIGNALS) {
    const evidence = []
    if (def.path) {
      for (const p of paths) {
        if (def.path.test(p.lower)) evidence.push(`path ${p.path}`)
      }
    }
    if (def.text) {
      for (const a of artifacts) {
        const m = def.text.exec(a.lower)
        if (m) evidence.push(`${a.name}: "${snippet(a.text, m.index, m[0].length)}"`)
      }
    }
    if (evidence.length) {
      signals.push({ signal: def.signal, class: def.class, evidence: joinEvidence(evidence) })
    }
  }

  // 3. Baseline floor. This is where fail-closed does its real work: the floor
  //    is only 'low' when a positive docs/tests-only signal fired.
  const docLike = paths.filter(p => isDocsPath(p.path) || TEST_PATH.test(p.lower))
  if (paths.length > 0 && docLike.length === paths.length) {
    signals.push({
      signal: 'docs-tests-only',
      class: 'low',
      evidence: `all ${paths.length} changed path(s) are docs or tests: ${joinEvidence(docLike.map(p => p.path))}`
    })
    reasons.push('every changed path is documentation or test-only')
  } else if (paths.length > 0) {
    const sourcePaths = paths.filter(p => !isDocsPath(p.path) && !TEST_PATH.test(p.lower))
    signals.push({
      signal: 'unmatched-source-change',
      class: UNMATCHED_SOURCE_CLASS,
      evidence: `${sourcePaths.length} non-docs path(s) with no matching risk rule: ${joinEvidence(sourcePaths.map(p => p.path))}`
    })
    reasons.push(
      `source paths changed with no rule match — floored at ${UNMATCHED_SOURCE_CLASS}, not low (unrecognised is not safe)`
    )
  } else {
    // Artifact text only. Blast radius is unbounded because nobody told us
    // which files move, so the floor stays above 'low'.
    signals.push({
      signal: 'no-changed-paths',
      class: UNMATCHED_SOURCE_CLASS,
      evidence: `artifact text only (${artifacts.map(a => a.name).join(', ')}); no changed paths supplied to bound the blast radius`
    })
    reasons.push(
      `no changed paths supplied — blast radius unbounded, floored at ${UNMATCHED_SOURCE_CLASS}`
    )
  }

  // 4. Maximum, never average.
  let riskClass = 'low'
  for (const s of signals) riskClass = maxClass(riskClass, s.class)

  const driving = signals.filter(s => s.class === riskClass).map(s => s.signal)
  reasons.push(`class ${riskClass} = max over ${signals.length} signal(s), driven by: ${driving.join(', ')}`)

  return finish(riskClass, signals, reasons, allowed, 'signals', paths, artifacts)
}

function finish(riskClass, signals, reasons, allowed, basis, paths, artifacts) {
  const continuityAllowed = allowed.includes(riskClass)
  reasons.push(
    continuityAllowed
      ? `continuity allowed: ${riskClass} ∈ {${allowed.join(', ')}} (§4.14 balanced)`
      : `continuity refused: ${riskClass} ∉ {${allowed.join(', ')}} (§4.14 balanced) — human checkpoint required`
  )
  // Severity-first so the driving signal reads first.
  const ordered = signals.slice().sort((a, b) => (RANK[b.class] ?? 3) - (RANK[a.class] ?? 3))
  return {
    riskClass,
    signals: ordered,
    continuityAllowed,
    reasons,
    basis,
    pathCount: paths.length,
    artifactNames: artifacts.map(a => a.name)
  }
}

/** Human-readable classification, for a skill to echo before it decides. */
export function formatRisk(result) {
  const lines = []
  lines.push(
    `RISK ${result.riskClass.toUpperCase()} — continuity ${result.continuityAllowed ? 'allowed' : 'NOT allowed'} ` +
      `(${result.pathCount} path(s), artifacts: ${result.artifactNames.length ? result.artifactNames.join(', ') : 'none'})`
  )
  for (const s of result.signals) lines.push(`  [${s.class}] ${s.signal}: ${s.evidence}`)
  for (const r of result.reasons) lines.push(`  reason: ${r}`)
  return lines.join('\n') + '\n'
}
